/**
 * **The semantic search index** (`docs/research/search.md` §3-§5, migration 027).
 *
 * Main-process only. It keeps `search_chunks` in step with every notebook's notes doc and sources,
 * fills in vectors through the embedding process in the background, and answers a query over a
 * folder's notebooks.
 *
 * ## Keeping it current
 *
 * A notebook's index is a pure function of two things: its notes doc (`notes_docs.version` bumps
 * on every accepted write, whoever made it: ingest, overview, an agent's edit or the learner) and
 * its sources (status, base, page count). `search_state` holds the pair the rows were made from,
 * so "is this notebook current?" is one row. `reconcile()` re-chunks a stale notebook (pure, a few
 * milliseconds), keeps every row whose text hash and model are unchanged, and clears the vector of
 * the rest. The pump then embeds what has no vector: notes and slides first, the per-block units
 * (used only to choose the highlight) after.
 *
 * Triggers: boot (every notebook), a `notebook:changed` push (`touch`), a 20 s sweep that catches
 * doc saves from any writer, and every query (the scope is checked before it is searched, so an
 * edit made on the search page itself is found).
 *
 * ## Ranking
 *
 * Notes and slides are ranked together by cosine similarity (the eval's best system: no keyword
 * fusion, no reranker). A chunk still waiting for its vector is not left out: those are ranked by
 * keyword and merged in by reciprocal rank. With no model at all, keyword ranks everything.
 */
import type { SqlDatabase } from '../db/driver.js';
import { log } from '../log.js';
import { noteChunks, pageChunks } from '../../shared/search/chunk.js';
import { keywordScores } from '../../shared/search/keyword.js';
import type { SearchHit, SearchResult, SearchStatus } from '../../shared/search/types.js';
import type { Embedder } from './embedder.js';

const SWEEP_MS = 20_000;
const TOUCH_DEBOUNCE_MS = 1500;
const PUMP_BATCH = 16;
const SNIPPET_CHARS = 260;
/** Reciprocal-rank constant for merging the keyword-ranked pending chunks in. */
const RRF_K = 60;

export interface SearchIndexDeps {
  db: SqlDatabase;
  embedder: Embedder;
  /** The notebooks a folder covers (`NotebookService.scopeNotebookIds`). */
  scope(folderId: string | null): string[];
  now?: () => string;
}

interface Row {
  key: string;
  kind: 'note' | 'page' | 'unit';
  notebookId: string;
  blockIds: string[];
  page: number | null;
  pages: number[];
  section: string[];
  title: string;
  text: string;
  vec: Float32Array | null;
}

interface Held {
  rows: Row[];
  /** unit rows by block id */
  units: Map<string, Row>;
}

interface DbRow {
  key: string;
  kind: Row['kind'];
  notebook_id: string;
  block_ids: string;
  page: number | null;
  pages: string;
  section: string;
  title: string;
  text: string;
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

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function snippetOf(text: string, max = SNIPPET_CHARS): string {
  const flat = text.replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max - 1);
  // Cut mid-word: drop the partial word. Cut at a space: keep every whole word.
  if (flat[max - 1] !== ' ') cut = cut.replace(/\s+\S*$/, '');
  return `${cut.trimEnd()}…`;
}

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

export class SearchIndex {
  readonly #db: SqlDatabase;
  readonly #embedder: Embedder;
  readonly #scope: (folderId: string | null) => string[];
  readonly #now: () => string;
  readonly #cache = new Map<string, Held>();
  readonly #touched = new Map<string, ReturnType<typeof setTimeout>>();
  #sweep: ReturnType<typeof setInterval> | null = null;
  #pumping = false;
  #disposed = false;

  constructor(deps: SearchIndexDeps) {
    this.#db = deps.db;
    this.#embedder = deps.embedder;
    this.#scope = deps.scope;
    this.#now = deps.now ?? (() => new Date().toISOString());
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

  /** What the notebook's rows are made from now: the doc's version and the sources' signature. */
  #inputs(notebookId: string): { version: number; sig: string; doc: { doc_json: string; title: string } | null; sources: { file_id: string; display_name: string; page_base: number; status: string }[] } | null {
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
    return {
      version: doc?.version ?? -1,
      sig: `${nb.name}#${sig}`,
      doc: doc ? { doc_json: doc.doc_json, title: doc.title.trim() || nb.name } : null,
      sources,
    };
  }

  /** Re-chunk a notebook if its doc or sources moved since its rows were made. True if it did. */
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

    type Want = { key: string; kind: Row['kind']; blockIds: string[]; page: number | null; pages: number[]; section: string[]; title: string; text: string; embedText: string; hash: string };
    const want: Want[] = [];
    if (input.doc) {
      const { chunks, units } = noteChunks(input.doc.doc_json, { notebookId, title: input.doc.title });
      const byBlock = new Map<string, (typeof chunks)[number]>();
      for (const c of chunks) {
        want.push({ key: c.key, kind: 'note', blockIds: c.blockIds, page: null, pages: c.pages, section: c.section, title: input.doc.title, text: c.text, embedText: c.embedText, hash: c.hash });
        for (const b of c.blockIds) if (!byBlock.has(b)) byBlock.set(b, c);
      }
      for (const u of units) {
        const owner = byBlock.get(u.blockId);
        const text = u.embedText.slice(u.embedText.indexOf('\n') + 1);
        want.push({ key: `unit:${notebookId}:${u.blockId}`, kind: 'unit', blockIds: [u.blockId], page: null, pages: owner?.pages ?? [], section: owner?.section ?? [], title: input.doc.title, text, embedText: u.embedText, hash: u.hash });
      }
    }
    const pageRows = this.#db.prepare('SELECT CAST(page AS INTEGER) AS page, body FROM file_text WHERE file_id = @f ORDER BY CAST(page AS INTEGER)');
    for (const s of input.sources) {
      if (s.status !== 'ready') continue;
      const title = stripExt(s.display_name);
      const pages = pageRows.all<{ page: number; body: string }>({ f: s.file_id }).map((r) => ({ page: s.page_base + r.page, text: r.body }));
      for (const c of pageChunks(pages, { notebookId, title })) {
        want.push({ key: c.key, kind: 'page', blockIds: [], page: c.page, pages: c.pages, section: [title], title, text: c.text, embedText: c.embedText, hash: c.hash });
      }
    }

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
    log().info('search.reconciled', { notebook_id: notebookId, chunks: want.length, changed });
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

  #held(notebookId: string): Held {
    const cached = this.#cache.get(notebookId);
    if (cached) return cached;
    const rows = this.#db
      .prepare('SELECT key, kind, notebook_id, block_ids, page, pages, section, title, text, vec FROM search_chunks WHERE notebook_id = @n')
      .all<DbRow>({ n: notebookId })
      .map(
        (r): Row => ({
          key: r.key,
          kind: r.kind,
          notebookId: r.notebook_id,
          blockIds: JSON.parse(r.block_ids) as string[],
          page: r.page,
          pages: JSON.parse(r.pages) as number[],
          section: JSON.parse(r.section) as string[],
          title: r.title,
          text: r.text,
          vec: toVec(r.vec),
        }),
      );
    const held: Held = { rows: rows.filter((r) => r.kind !== 'unit'), units: new Map(rows.filter((r) => r.kind === 'unit').map((r) => [r.blockIds[0]!, r])) };
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
    const helds = new Map(ids.map((id) => [id, this.#held(id)]));
    const rows = [...helds.values()].flatMap((h) => h.rows);

    let qv: Float32Array | null = null;
    if (this.#embedder.available()) {
      try {
        qv = await this.#embedder.embedQuery(q);
      } catch (err) {
        log().warn('search.query_embed_failed', { error: String(err) });
      }
    }

    const score = new Map<string, number>();
    let ranked: Row[];
    const pending = rows.filter((r) => !r.vec);
    if (pending.length > 0) this.#kick();
    if (qv) {
      const dense = rows.filter((r) => r.vec).map((r) => ({ r, s: dot(qv, r.vec!) }));
      dense.sort((a, b) => b.s - a.s);
      for (const d of dense) score.set(d.r.key, d.s);
      if (pending.length === 0) {
        ranked = dense.map((d) => d.r);
      } else {
        // Chunks still waiting for a vector join by keyword, merged by reciprocal rank.
        const kw = keywordScores(q, pending.map((r) => `${r.section.join(' ')} ${r.text}`));
        const lexical = pending.map((r, i) => ({ r, s: kw[i]! })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        const rrf = new Map<Row, number>();
        dense.forEach((d, i) => rrf.set(d.r, 1 / (RRF_K + i + 1)));
        lexical.forEach((d, i) => rrf.set(d.r, (rrf.get(d.r) ?? 0) + 1 / (RRF_K + i + 1)));
        ranked = [...rrf.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
      }
    } else {
      const kw = keywordScores(q, rows.map((r) => `${r.section.join(' ')} ${r.text}`));
      const lexical = rows.map((r, i) => ({ r, s: kw[i]! })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      for (const d of lexical) score.set(d.r.key, d.s);
      ranked = lexical.map((d) => d.r);
    }

    const pageScore = (notebookId: string, page: number): number => score.get(`page:${notebookId}:${page}`) ?? -Infinity;
    const bestUnit = (row: Row): Row | null => {
      const units = row.blockIds.map((b) => helds.get(row.notebookId)!.units.get(b)).filter((u): u is Row => !!u);
      if (units.length === 0) return null;
      // A learner's label ("PREREQ: HUERISTICS") heads the group; it is never the answer to show
      // while the group has a block with something in it.
      const real = units.filter((u) => u.text.split(/\s+/).filter(Boolean).length > 5);
      const pool = real.length > 0 ? real : units;
      if (!qv) return pool[0]!;
      return pool.reduce((best, u) => ((u.vec ? dot(qv!, u.vec) : -1) > (best.vec ? dot(qv!, best.vec) : -1) ? u : best));
    };

    const hits: SearchHit[] = [];
    const seenPageText = new Map<string, SearchHit>();
    for (const row of ranked) {
      if (hits.length >= limit) break;
      const notebookName = names.get(row.notebookId) ?? '';
      if (row.kind === 'page') {
        // The same slide in two decks of the scope is one hit, "also in" the other.
        const twin = seenPageText.get(row.text);
        if (twin) {
          twin.alsoIn.push({ notebookId: row.notebookId, notebookName, page: row.page! });
          continue;
        }
        // The notes that cite this page: the best-scoring note chunk of the notebook that does.
        const citing = helds
          .get(row.notebookId)!
          .rows.filter((r) => r.kind === 'note' && r.pages.includes(row.page!))
          .sort((a, b) => (score.get(b.key) ?? -Infinity) - (score.get(a.key) ?? -Infinity))[0];
        const unit = citing ? bestUnit(citing) : null;
        const hit: SearchHit = {
          key: row.key,
          kind: 'page',
          notebookId: row.notebookId,
          notebookName,
          title: row.title,
          section: row.section,
          snippet: snippetOf(row.text.split('\n').slice(1).join('\n') || row.text),
          heading: row.text.split('\n')[0] ?? '',
          score: score.get(row.key) ?? 0,
          page: row.page,
          blockId: unit?.blockIds[0] ?? citing?.blockIds[0] ?? null,
          blockIds: citing?.blockIds ?? [],
          alsoIn: [],
        };
        seenPageText.set(row.text, hit);
        hits.push(hit);
        continue;
      }
      const unit = bestUnit(row);
      // The slide this note came from: of its provenance pages, the one the query matches best.
      const page = row.pages.length === 0 ? null : row.pages.reduce((best, p) => (pageScore(row.notebookId, p) > pageScore(row.notebookId, best) ? p : best), row.pages[0]!);
      hits.push({
        key: row.key,
        kind: 'note',
        notebookId: row.notebookId,
        notebookName,
        title: row.title,
        section: row.section,
        snippet: snippetOf(unit?.text ?? row.text),
        heading: row.section.at(-1) ?? row.title,
        score: score.get(row.key) ?? 0,
        page,
        blockId: unit?.blockIds[0] ?? row.blockIds[0] ?? null,
        blockIds: row.blockIds,
        alsoIn: [],
      });
    }
    return {
      query: q,
      hits,
      mode: qv ? 'semantic' : 'keyword',
      pending: pending.length,
      ms: Date.now() - started,
    };
  }
}
