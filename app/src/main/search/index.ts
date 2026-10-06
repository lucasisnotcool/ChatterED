/**
 * **The semantic search index** (`docs/research/search.md` §3-§5, migrations 027 and 033).
 *
 * Main-process only. It keeps `search_chunks` in step with every notebook's notes doc and sources,
 * fills in vectors through the embedding process in the background, and answers a query over a
 * folder's notebooks.
 *
 * ## Keeping it current
 *
 * A notebook's index is a pure function (`shared/search/build.ts`) of its notes doc
 * (`notes_docs.version` bumps on every accepted write, whoever made it: ingest, overview, an
 * agent's edit or the learner), its sources (status, base, page count), and its blocks' stored
 * explain comments (`block_comments`, 033) read in the current `ExplainMode`. `search_state` holds
 * the doc version and a signature of the rest, so "is this notebook current?" is one row.
 * `reconcile()` re-chunks a stale notebook (pure, a few milliseconds), keeps every row whose text
 * hash and model are unchanged, and clears the vector of the rest. The pump then embeds what has
 * no vector: notes, explains and slides first, the per-block units (used only to choose the
 * highlight) after.
 *
 * Triggers: boot (every notebook), a `notebook:changed` push (`touch`), a 20 s sweep that catches
 * doc saves from any writer and comments imported with the app quit, and every query (the scope
 * is checked before it is searched, so an edit made on the search page itself is found).
 *
 * ## Ranking
 *
 * `shared/search/rank.ts`, shared with the headless eval (`scripts/search-eval.mjs`).
 */
import type { SqlDatabase } from '../db/driver.js';
import { log } from '../log.js';
import { commentsRepo } from '../db/repos/comments.js';
import { explainPlainText } from '../../shared/doc/comments.js';
import { notebookRows, type IndexRow } from '../../shared/search/build.js';
import { matchText, rankQuery, snippetOf, type RankNotebook, type RankRow } from '../../shared/search/rank.js';
import { DEFAULT_EXPLAIN_MODE, type ExplainMode, type SearchResult, type SearchStatus } from '../../shared/search/types.js';
import type { Embedder } from './embedder.js';

export { snippetOf };

const SWEEP_MS = 20_000;
const TOUCH_DEBOUNCE_MS = 1500;
const PUMP_BATCH = 16;

export interface SearchIndexDeps {
  db: SqlDatabase;
  embedder: Embedder;
  /** The notebooks a folder covers (`NotebookService.scopeNotebookIds`). */
  scope(folderId: string | null): string[];
  now?: () => string;
  /**
   * How the blocks' explain comments are read (`ExplainMode`), asked at every reconcile: a change
   * re-chunks every notebook on the next sweep. Default `DEFAULT_EXPLAIN_MODE`.
   */
  explainMode?: () => ExplainMode;
}

interface DbRow {
  key: string;
  kind: RankRow['kind'];
  notebook_id: string;
  block_ids: string;
  page: number | null;
  pages: string;
  section: string;
  title: string;
  text: string;
  embed_text: string;
  vec: Buffer | null;
}

function toVec(buf: Buffer | null): Float32Array | null {
  if (!buf || buf.byteLength === 0) return null;
  // Copy: a Buffer from SQLite may share a pool and need not be 4-byte aligned.
  const out = new Float32Array(buf.byteLength / 4);
  new Uint8Array(out.buffer).set(buf);
  return out;
}

function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export class SearchIndex {
  readonly #db: SqlDatabase;
  readonly #embedder: Embedder;
  readonly #scope: (folderId: string | null) => string[];
  readonly #now: () => string;
  readonly #mode: () => ExplainMode;
  readonly #cache = new Map<string, RankNotebook>();
  readonly #touched = new Map<string, ReturnType<typeof setTimeout>>();
  #sweep: ReturnType<typeof setInterval> | null = null;
  #pumping = false;
  #disposed = false;

  constructor(deps: SearchIndexDeps) {
    this.#db = deps.db;
    this.#embedder = deps.embedder;
    this.#scope = deps.scope;
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#mode = deps.explainMode ?? (() => DEFAULT_EXPLAIN_MODE);
  }

  /** Boot: a new model clears old vectors, every notebook is reconciled, the pump starts. */
  start(): void {
    this.#db
      .prepare('UPDATE search_chunks SET vec = NULL, model_id = NULL WHERE model_id IS NOT NULL AND model_id <> @m')
      .run({ m: this.#embedder.modelId });
    this.#sweepAll();
    this.#sweep = setInterval(() => this.#sweepAll(), SWEEP_MS);
    this.#sweep.unref?.();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#sweep) clearInterval(this.#sweep);
    for (const t of this.#touched.values()) clearTimeout(t);
    this.#touched.clear();
  }

  /** A notebook changed (sources, name, deletion): re-check it shortly. */
  touch(notebookId: string): void {
    const prev = this.#touched.get(notebookId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.#touched.delete(notebookId);
      this.reconcile(notebookId);
      this.#kick();
    }, TOUCH_DEBOUNCE_MS);
    t.unref?.();
    this.#touched.set(notebookId, t);
  }

  #sweepAll(): void {
    if (this.#disposed) return;
    try {
      const ids = this.#db.prepare('SELECT id FROM notebooks').all<{ id: string }>().map((r) => r.id);
      for (const id of ids) this.reconcile(id);
      // Rows of notebooks that no longer exist.
      const gone = this.#db
        .prepare('SELECT DISTINCT notebook_id AS id FROM search_chunks WHERE notebook_id NOT IN (SELECT id FROM notebooks)')
        .all<{ id: string }>();
      for (const { id } of gone) this.forget(id);
    } catch (err) {
      log().warn('search.sweep_failed', { error: String(err) });
    }
    this.#kick();
  }

  forget(notebookId: string): void {
    this.#db.prepare('DELETE FROM search_chunks WHERE notebook_id = @n').run({ n: notebookId });
    this.#db.prepare('DELETE FROM search_state WHERE notebook_id = @n').run({ n: notebookId });
    this.#cache.delete(notebookId);
  }

  /** What the notebook's rows are made from now: the doc's version and the rest's signature. */
  #inputs(notebookId: string): {
    version: number;
    sig: string;
    mode: ExplainMode;
    doc: { doc_json: string; title: string } | null;
    sources: { file_id: string; display_name: string; page_base: number; status: string }[];
  } | null {
    const nb = this.#db.prepare('SELECT name FROM notebooks WHERE id = @n').get<{ name: string }>({ n: notebookId });
    if (!nb) return null;
    const doc = this.#db
      .prepare('SELECT doc_json, title, version FROM notes_docs WHERE content_sha = @k')
      .get<{ doc_json: string; title: string; version: number }>({ k: `nb:${notebookId}` });
    const sources = this.#db
      .prepare(
        'SELECT file_id, display_name, page_base, page_count, status FROM notebook_sources WHERE notebook_id = @n ORDER BY ord, added_at, file_id',
      )
      .all<{ file_id: string; display_name: string; page_base: number; page_count: number; status: string }>({ n: notebookId });
    const sig = sources.map((s) => `${s.file_id}:${s.status}:${s.page_base}:${s.page_count}:${s.display_name}`).join('|');
    const mode = this.#mode();
    // The comments are part of the signature in every mode: a hit shows its block's explain.
    const comments = commentsRepo(this.#db).signature(notebookId);
    return {
      version: doc?.version ?? -1,
      sig: `${nb.name}#${sig}#explain:${mode}:${comments}`,
      mode,
      doc: doc ? { doc_json: doc.doc_json, title: doc.title.trim() || nb.name } : null,
      sources,
    };
  }

  /** Block id → explain body, for a notebook. */
  #explainBodies(notebookId: string): Map<string, string> {
    return new Map(commentsRepo(this.#db).forNotebook(notebookId).map((c) => [c.blockId, c.body]));
  }

  /** Re-chunk a notebook if its doc, sources or comments moved since its rows were made. True if it did. */
  reconcile(notebookId: string, force = false): boolean {
    const input = this.#inputs(notebookId);
    if (!input) {
      this.forget(notebookId);
      return true;
    }
    const state = this.#db
      .prepare('SELECT doc_version, sources_sig FROM search_state WHERE notebook_id = @n')
      .get<{ doc_version: number; sources_sig: string }>({ n: notebookId });
    if (!force && state && state.doc_version === input.version && state.sources_sig === input.sig) return false;

    const pageRows = this.#db.prepare('SELECT CAST(page AS INTEGER) AS page, body FROM file_text WHERE file_id = @f ORDER BY CAST(page AS INTEGER)');
    const explains = new Map([...this.#explainBodies(notebookId)].map(([b, body]) => [b, explainPlainText(body)]));
    const want: IndexRow[] = notebookRows({
      notebookId,
      doc: input.doc ? { docJson: input.doc.doc_json, title: input.doc.title } : null,
      sources: input.sources.map((s) => ({
        displayName: s.display_name,
        pageBase: s.page_base,
        status: s.status,
        pages: s.status === 'ready' ? pageRows.all<{ page: number; body: string }>({ f: s.file_id }) : [],
      })),
      explains,
      explainMode: input.mode,
    });

    const have = new Map(
      this.#db
        .prepare('SELECT key, hash, model_id FROM search_chunks WHERE notebook_id = @n')
        .all<{ key: string; hash: string; model_id: string | null }>({ n: notebookId })
        .map((r) => [r.key, r]),
    );
    const now = this.#now();
    const keep = new Set(want.map((w) => w.key));
    const upsert = this.#db.prepare(
      `INSERT INTO search_chunks (key, notebook_id, kind, block_ids, page, pages, section, title, text, embed_text, hash, model_id, vec, updated_at)
       VALUES (@key, @n, @kind, @block_ids, @page, @pages, @section, @title, @text, @embed_text, @hash, NULL, NULL, @now)
       ON CONFLICT(key) DO UPDATE SET notebook_id = @n, kind = @kind, block_ids = @block_ids, page = @page, pages = @pages,
         section = @section, title = @title, text = @text, embed_text = @embed_text, hash = @hash, updated_at = @now,
         vec = CASE WHEN search_chunks.hash = @hash THEN search_chunks.vec ELSE NULL END,
         model_id = CASE WHEN search_chunks.hash = @hash THEN search_chunks.model_id ELSE NULL END`,
    );
    const del = this.#db.prepare('DELETE FROM search_chunks WHERE key = @key');
    let changed = 0;
    this.#db.exec('SAVEPOINT search_reconcile');
    try {
      for (const k of have.keys()) if (!keep.has(k)) del.run({ key: k });
      for (const w of want) {
        if (have.get(w.key)?.hash !== w.hash) changed += 1;
        upsert.run({
          key: w.key,
          n: notebookId,
          kind: w.kind,
          block_ids: JSON.stringify(w.blockIds),
          page: w.page,
          pages: JSON.stringify(w.pages),
          section: JSON.stringify(w.section),
          title: w.title,
          text: w.text,
          embed_text: w.embedText,
          hash: w.hash,
          now,
        });
      }
      this.#db
        .prepare(
          `INSERT INTO search_state (notebook_id, doc_version, sources_sig, updated_at) VALUES (@n, @v, @s, @now)
           ON CONFLICT(notebook_id) DO UPDATE SET doc_version = @v, sources_sig = @s, updated_at = @now`,
        )
        .run({ n: notebookId, v: input.version, s: input.sig, now });
      this.#db.exec('RELEASE search_reconcile');
    } catch (err) {
      this.#db.exec('ROLLBACK TO search_reconcile');
      this.#db.exec('RELEASE search_reconcile');
      throw err;
    }
    this.#cache.delete(notebookId);
    log().info('search.reconciled', { notebook_id: notebookId, chunks: want.length, changed, explain_mode: input.mode });
    return true;
  }

  /** Embed what has no vector, a batch at a time, until there is nothing left. */
  #kick(): void {
    if (this.#pumping || this.#disposed || !this.#embedder.available()) return;
    this.#pumping = true;
    void this.#pump().finally(() => {
      this.#pumping = false;
    });
  }

  async #pump(): Promise<void> {
    const next = this.#db.prepare(
      `SELECT key, embed_text, hash, notebook_id FROM search_chunks WHERE vec IS NULL
       ORDER BY CASE kind WHEN 'unit' THEN 1 ELSE 0 END, notebook_id, key LIMIT ${PUMP_BATCH}`,
    );
    const write = this.#db.prepare(
      'UPDATE search_chunks SET vec = @vec, model_id = @m WHERE key = @key AND hash = @hash',
    );
    while (!this.#disposed && this.#embedder.available()) {
      const batch = next.all<{ key: string; embed_text: string; hash: string; notebook_id: string }>();
      if (batch.length === 0) return;
      let vecs: Float32Array[];
      try {
        vecs = await this.#embedder.embedDocuments(batch.map((b) => b.embed_text));
      } catch (err) {
        log().warn('search.embed_failed', { error: String(err) });
        return;
      }
      const touched = new Set<string>();
      batch.forEach((b, i) => {
        // `hash` guards a chunk that was edited while its old text was being embedded.
        write.run({ vec: toBlob(vecs[i]!), m: this.#embedder.modelId, key: b.key, hash: b.hash });
        touched.add(b.notebook_id);
      });
      for (const id of touched) this.#cache.delete(id);
    }
  }

  #held(notebookId: string, name: string): RankNotebook {
    const cached = this.#cache.get(notebookId);
    if (cached) return { ...cached, name };
    const rows = this.#db
      .prepare('SELECT key, kind, notebook_id, block_ids, page, pages, section, title, text, embed_text, vec FROM search_chunks WHERE notebook_id = @n')
      .all<DbRow>({ n: notebookId })
      .map((r): RankRow => {
        const section = JSON.parse(r.section) as string[];
        return {
          key: r.key,
          kind: r.kind,
          notebookId: r.notebook_id,
          blockIds: JSON.parse(r.block_ids) as string[],
          page: r.page,
          pages: JSON.parse(r.pages) as number[],
          section,
          title: r.title,
          text: r.text,
          match: matchText(r.kind, section, r.text, r.embed_text),
          vec: toVec(r.vec),
        };
      });
    const held: RankNotebook = {
      name,
      rows: rows.filter((r) => r.kind !== 'unit'),
      units: new Map(rows.filter((r) => r.kind === 'unit').map((r) => [r.blockIds[0]!, r])),
      explains: this.#explainBodies(notebookId),
    };
    this.#cache.set(notebookId, held);
    return held;
  }

  status(folderId: string | null = null): SearchStatus {
    const ids = this.#scope(folderId);
    let chunks = 0;
    let pending = 0;
    for (const id of ids) {
      const r = this.#db
        .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN vec IS NULL THEN 1 ELSE 0 END) AS p FROM search_chunks WHERE notebook_id = @n AND kind <> 'unit'")
        .get<{ n: number; p: number | null }>({ n: id });
      chunks += r?.n ?? 0;
      pending += r?.p ?? 0;
    }
    return { notebooks: ids.length, chunks, pending, semantic: this.#embedder.available() };
  }

  async query(text: string, opts: { folderId: string | null; limit?: number }): Promise<SearchResult> {
    const started = Date.now();
    const q = text.trim();
    const ids = this.#scope(opts.folderId);
    const limit = opts.limit ?? 40;
    if (q.length === 0 || ids.length === 0) return { query: q, hits: [], mode: 'semantic', pending: 0, ms: 0 };
    for (const id of ids) this.reconcile(id);

    const names = new Map(
      this.#db
        .prepare('SELECT id, name FROM notebooks')
        .all<{ id: string; name: string }>()
        .map((r) => [r.id, r.name]),
    );
    const notebooks = new Map(ids.map((id) => [id, this.#held(id, names.get(id) ?? '')]));

    let qv: Float32Array | null = null;
    if (this.#embedder.available()) {
      try {
        qv = await this.#embedder.embedQuery(q);
      } catch (err) {
        log().warn('search.query_embed_failed', { error: String(err) });
      }
    }
    const ranked = rankQuery({ query: q, qv, notebooks, limit, explainMode: this.#mode() });
    if (ranked.pending > 0) this.#kick();
    return { query: q, hits: ranked.hits, mode: ranked.mode, pending: ranked.pending, ms: Date.now() - started };
  }
}
