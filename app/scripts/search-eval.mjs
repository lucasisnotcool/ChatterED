// The search regression check (docs/research/search.md §7, §8 step 6): headless, read-only, with
// the app's own chunker (shared/search/chunk.ts via build.ts), its own ranking (shared/search/
// rank.ts) and the bundled EmbeddingGemma with the app's prompts. Reports S@1, S@5, MRR and N@1,
// overall and by query kind.
//
//   node app/scripts/search-eval.mjs --db <app.db> --queries <queries.json> --mode off|append|separate|all
//        [--folder <fd_id>] [--map slug=nb_id,… | --map <map.json>] [--model-dir <dir>]
//        [--cache <dir>] [--limit 40] [--json <out.json>] [--verbose]
//
// queries.json is an array of {id, notebook | slug, query, gold_pages: [int], kind}. A hit is
// correct when it is in that notebook and its pages intersect gold_pages. `notebook`/`slug` is
// resolved through --map, then as a notebook id, then as an exact notebook name.
//
// The scope is every notebook (or --folder and everything under it), as the search page's scope
// chip would have it. The database is opened read-only. Embeddings are cached on disk by text
// hash (and seeded from the database's own index where its model matches), so a repeated run,
// or a run in another mode, embeds only what it has not seen.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { appDir, loadKit } from './lib/loadts.mjs';

const require = createRequire(join(appDir, 'package.json'));

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}
function fail(message) {
  console.error(`search-eval: ${message}`);
  process.exit(1);
}

const dbPath = arg('--db');
const queriesPath = arg('--queries');
const modeArg = arg('--mode', 'separate');
const folderId = arg('--folder', null);
const mapArg = arg('--map', '');
const modelDir = resolve(arg('--model-dir', join(appDir, 'models', 'embeddinggemma-300m')));
const cacheDir = resolve(arg('--cache', join(appDir, 'node_modules', '.cache', 'chattered-eval')));
const limit = Number.parseInt(arg('--limit', '40'), 10);
const jsonOut = arg('--json', null);
const verbose = process.argv.includes('--verbose');
if (!dbPath || !queriesPath) fail('usage: --db <app.db> --queries <queries.json> --mode off|append|separate|all [--folder <id>] [--map slug=nb,…]');
if (!existsSync(dbPath)) fail(`no database at ${dbPath}`);

const kit = await loadKit();
const modes = modeArg === 'all' ? [...kit.EXPLAIN_MODES] : [modeArg];
for (const m of modes) if (!kit.EXPLAIN_MODES.includes(m)) fail(`--mode must be off, append, separate or all (got ${m})`);

// ── the corpus, read-only ──────────────────────────────────────────────────────────────────
const Database = require('better-sqlite3-node');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const has = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

let notebookRows;
if (folderId) {
  notebookRows = db
    .prepare(
      `WITH RECURSIVE sub(id) AS (SELECT id FROM folders WHERE id = @f UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
       SELECT id, name FROM notebooks WHERE folder_id IN (SELECT id FROM sub) ORDER BY name`,
    )
    .all({ f: folderId });
  if (notebookRows.length === 0) fail(`no notebooks under folder ${folderId}`);
} else {
  notebookRows = db.prepare('SELECT id, name FROM notebooks ORDER BY name').all();
}
const allNotebooks = db.prepare('SELECT id, name FROM notebooks').all();

let map = {};
if (mapArg) map = existsSync(mapArg) ? JSON.parse(readFileSync(mapArg, 'utf8')) : kit.parseMapArg(mapArg);
const { queries, errors } = kit.resolveQueries(JSON.parse(readFileSync(queriesPath, 'utf8')), map, allNotebooks);
for (const e of errors) console.warn(`  skipped query ${e}`);
if (queries.length === 0) fail('no usable queries');
const inScope = new Set(notebookRows.map((n) => n.id));
for (const q of queries) if (!inScope.has(q.notebook)) console.warn(`  query ${q.id}: its notebook ${q.notebook} is outside the scope; it can only miss`);

const pageQuery = db.prepare('SELECT CAST(page AS INTEGER) AS page, body FROM file_text WHERE file_id = ? ORDER BY CAST(page AS INTEGER)');
const commentsOf = has('block_comments')
  ? db.prepare(
      `SELECT c.block_id, c.body FROM block_comments c JOIN notes_docs d ON d.id = c.doc_id WHERE d.content_sha = ? AND c.kind = 'explain'`,
    )
  : null;

function inputsOf(nb) {
  const doc = db.prepare('SELECT doc_json, title FROM notes_docs WHERE content_sha = ?').get(`nb:${nb.id}`);
  const sources = db
    .prepare('SELECT file_id, display_name, page_base, status FROM notebook_sources WHERE notebook_id = ? ORDER BY ord, added_at, file_id')
    .all(nb.id)
    .map((s) => ({ displayName: s.display_name, pageBase: s.page_base, status: s.status, pages: s.status === 'ready' ? pageQuery.all(s.file_id) : [] }));
  const bodies = new Map((commentsOf ? commentsOf.all(`nb:${nb.id}`) : []).map((c) => [c.block_id, c.body]));
  return { doc: doc ? { docJson: doc.doc_json, title: doc.title.trim() || nb.name } : null, sources, bodies };
}
const inputs = new Map(notebookRows.map((nb) => [nb.id, inputsOf(nb)]));
const commentCount = [...inputs.values()].reduce((n, i) => n + i.bodies.size, 0);

// ── the vector cache ───────────────────────────────────────────────────────────────────────
mkdirSync(cacheDir, { recursive: true });
const cacheFile = join(cacheDir, `vectors-${kit.MODEL_ID.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`);
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : { d: {}, q: {} };
let cacheDirty = false;
const toB64 = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const fromB64 = (s) => {
  const buf = Buffer.from(s, 'base64');
  const out = new Float32Array(buf.byteLength / 4);
  new Uint8Array(out.buffer).set(buf);
  return out;
};

// Seed from the app's own index: the same text hash under the same model is the same vector.
let seeded = 0;
if (has('search_chunks')) {
  for (const r of db.prepare('SELECT hash, vec FROM search_chunks WHERE model_id = ? AND vec IS NOT NULL').iterate(kit.MODEL_ID)) {
    if (!cache.d[r.hash]) {
      cache.d[r.hash] = Buffer.from(r.vec).toString('base64');
      seeded += 1;
      cacheDirty = true;
    }
  }
}

let embedFn = null;
async function embedder() {
  if (embedFn) return embedFn;
  if (!existsSync(join(modelDir, 'config.json'))) fail(`no model at ${modelDir}: run node app/scripts/fetch-model.mjs (or pass --model-dir)`);
  const { AutoModel, AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  env.localModelPath = dirname(modelDir);
  env.cacheDir = dirname(modelDir);
  const id = modelDir.split(/[\\/]/).pop();
  const tokenizer = await AutoTokenizer.from_pretrained(id, { local_files_only: true });
  const model = await AutoModel.from_pretrained(id, { dtype: kit.MODEL_DTYPE, device: 'cpu', local_files_only: true });
  embedFn = async (kind, texts) => {
    const prefix = kind === 'query' ? kit.QUERY_PREFIX : kit.DOC_PREFIX;
    const enc = await tokenizer(texts.map((t) => prefix + t), { padding: true, truncation: true, max_length: kit.MAX_LENGTH });
    const out = await model(enc);
    const normed = out.sentence_embedding.normalize(2, -1);
    const dims = normed.dims[normed.dims.length - 1];
    const data = Float32Array.from(normed.data);
    return texts.map((_, i) => data.slice(i * dims, (i + 1) * dims));
  };
  return embedFn;
}

async function ensureDocs(rows) {
  const missing = new Map();
  for (const r of rows) if (!cache.d[r.hash] && !missing.has(r.hash)) missing.set(r.hash, r.embedText);
  if (missing.size === 0) return 0;
  const embed = await embedder();
  const entries = [...missing.entries()];
  const t0 = Date.now();
  for (let i = 0; i < entries.length; i += 8) {
    const batch = entries.slice(i, i + 8);
    const vecs = await embed('docs', batch.map(([, t]) => t));
    batch.forEach(([h], j) => (cache.d[h] = toB64(vecs[j])));
    cacheDirty = true;
    if (verbose) process.stderr.write(`\r  embedded ${Math.min(i + 8, entries.length)} / ${entries.length}`);
  }
  if (verbose) process.stderr.write(` in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  return entries.length;
}

async function queryVec(text) {
  const key = kit.hashText(text);
  if (!cache.q[key]) {
    const embed = await embedder();
    cache.q[key] = toB64((await embed('query', [text]))[0]);
    cacheDirty = true;
  }
  return fromB64(cache.q[key]);
}

// ── one run per mode ───────────────────────────────────────────────────────────────────────
const report = { db: dbPath, folder: folderId, notebooks: notebookRows.length, comments: commentCount, seeded, runs: {} };
console.log(
  `${notebookRows.length} notebooks in scope${folderId ? ` (folder ${folderId})` : ''}, ${commentCount} explain comments, ` +
    `${queries.length} queries; ${seeded} vectors seeded from the database`,
);
for (const mode of modes) {
  const notebooks = new Map();
  const allRows = [];
  for (const nb of notebookRows) {
    const input = inputs.get(nb.id);
    const explains = new Map([...input.bodies].map(([b, body]) => [b, kit.explainPlainText(body)]));
    const rows = kit.notebookRows({ notebookId: nb.id, doc: input.doc, sources: input.sources, explains, explainMode: mode });
    allRows.push(...rows);
    notebooks.set(nb.id, { name: nb.name, rows, bodies: input.bodies });
  }
  const embedded = await ensureDocs(allRows);
  const held = new Map();
  for (const [id, n] of notebooks) {
    const rank = n.rows.map((r) => ({
      key: r.key,
      kind: r.kind,
      notebookId: id,
      blockIds: r.blockIds,
      page: r.page,
      pages: r.pages,
      section: r.section,
      title: r.title,
      text: r.text,
      match: kit.matchText(r.kind, r.section, r.text, r.embedText),
      vec: fromB64(cache.d[r.hash]),
    }));
    held.set(id, {
      name: n.name,
      rows: rank.filter((r) => r.kind !== 'unit'),
      units: new Map(rank.filter((r) => r.kind === 'unit').map((r) => [r.blockIds[0], r])),
      explains: n.bodies,
    });
  }
  const scored = [];
  for (const q of queries) {
    const qv = await queryVec(q.query);
    const { hits } = kit.rankQuery({ query: q.query, qv, notebooks: held, limit, explainMode: mode });
    const s = kit.scoreQuery(q, hits);
    scored.push({ ...s, top: hits.slice(0, 5).map((h) => ({ kind: h.kind, via: h.via, notebook: h.notebookName, pages: h.pages, blockId: h.blockId, snippet: h.snippet.slice(0, 100) })) });
  }
  const summary = kit.summarise(scored);
  const counts = allRows.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {});
  console.log(`\n${kit.formatSummary(summary, `mode ${mode}: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}; ${embedded} embedded this run`)}`);
  if (verbose) {
    for (const s of scored) {
      console.log(`  ${s.id.padEnd(10)} rank ${String(s.rank ?? '-').padStart(2)}  ${s.viaExplain ? 'via explain ' : ''}${s.query}`);
      for (const [i, t] of s.top.entries()) console.log(`      ${i + 1}. ${t.kind}${t.via === 'explain' ? '/explain' : ''} ${t.notebook} p.${t.pages.join(',')}  ${t.snippet}`);
    }
  }
  report.runs[mode] = { summary, queries: scored };
}

if (cacheDirty) writeFileSync(cacheFile, JSON.stringify(cache));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
db.close();
