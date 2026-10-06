/**
 * The index reading the blocks' explain comments (migration 033), in each `ExplainMode`, against a
 * real migrated database and a fake embedder of hashed word counts (as `index.test.ts`).
 */
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { importComments } from '../db/repos/comments.js';
import { stem, tokens } from '../../shared/search/keyword.js';
import type { ExplainMode } from '../../shared/search/types.js';
import type { Embedder } from './embedder.js';
import { SearchIndex } from './index.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const DIMS = 256;
const NOW = '2026-10-07T00:00:00.000Z';

function fakeVec(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  for (const w of tokens(text)) {
    let h = 2166136261;
    for (const ch of stem(w)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[(h >>> 0) % DIMS]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

const embedder: Embedder = {
  modelId: 'fake@1',
  dims: DIMS,
  available: () => true,
  embedDocuments: async (texts) => texts.map(fakeVec),
  embedQuery: async (text) => fakeVec(text),
  dispose() {},
};

const para = (id: string, text: string, pages: number[]) => ({ type: 'paragraph', attrs: { blockId: id, pages, reason: null, objectiveIds: [] }, content: [{ type: 'text', text }] });
const heading = (id: string, level: number, text: string, pages: number[] = []) => ({ type: 'heading', attrs: { level, blockId: id, pages, reason: null, objectiveIds: [] }, content: [{ type: 'text', text }] });
const LONG = ' This paragraph runs past forty words so that it stands as a group of its own in the index and is never merged with the paragraph that follows it under the same heading here.';
const DOC = JSON.stringify({
  type: 'doc',
  content: [
    heading('h1', 1, 'Decision making'),
    heading('h_v', 2, 'Value iteration', [20]),
    para('b_bell', 'Apply the update to every state until the values stop changing.' + LONG, [20]),
    heading('h_p', 2, 'Policy evaluation', [30]),
    para('b_pol', 'Fix a policy and solve the linear system for its values.' + LONG, [30]),
  ],
});

let db: SqlDatabase;
let mode: ExplainMode;
let index: SearchIndex;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb_a', 'Lecture-mdp', @t, @t)").run({ t: NOW });
  db.prepare(
    `INSERT INTO notes_docs (id, content_sha, title, doc_json, ingest_status, ingest_version, version, created_at, updated_at)
     VALUES ('doc_a', 'nb:nb_a', 'Decision making', @d, 'ready', 1, 1, @t, @t)`,
  ).run({ d: DOC, t: NOW });
  importComments(db, [{ doc_id: 'doc_a', block_id: 'b_bell', text_sha: 'x', body: 'This is the **Bellman** backup: a contraction, so it converges geometrically.', model: 'sonnet' }], { now: NOW });
  mode = 'separate';
  index = new SearchIndex({ db, embedder, scope: () => ['nb_a'], now: () => NOW, explainMode: () => mode });
});

afterEach(() => index.dispose());

describe('search over explain comments', () => {
  it('separate: a query in the explain\'s words finds its block, says so, and shows the explain', async () => {
    index.start();
    await settle();
    const r = await index.query('bellman contraction converges', { folderId: null });
    const top = r.hits[0]!;
    expect(top).toMatchObject({ kind: 'note', blockId: 'b_bell', via: 'explain', pages: [20], page: 20 });
    expect(top.explain).toContain('**Bellman** backup');
    expect(top.snippet).toContain('Apply the update to every state');
    // The block's group does not come back a second time as an ordinary hit.
    expect(r.hits.filter((h) => h.blockId === 'b_bell')).toHaveLength(1);
  });

  it('off: the explain is shown on its block\'s hit but never matched', async () => {
    mode = 'off';
    index.start();
    await settle();
    expect(db.prepare("SELECT COUNT(*) AS n FROM search_chunks WHERE kind = 'explain'").get<{ n: number }>()!.n).toBe(0);
    const r = await index.query('apply the update to every state', { folderId: null });
    expect(r.hits[0]).toMatchObject({ blockId: 'b_bell', via: 'text' });
    expect(r.hits[0]!.explain).toContain('Bellman');
    const viaExplain = await index.query('bellman contraction converges', { folderId: null });
    expect(viaExplain.hits.every((h) => h.via === 'text')).toBe(true);
  });

  it('append: the explain\'s words lift its block, attributed to the explain', async () => {
    mode = 'append';
    index.start();
    await settle();
    const r = await index.query('bellman contraction converges', { folderId: null });
    expect(r.hits[0]).toMatchObject({ blockId: 'b_bell', via: 'explain' });
    expect(r.hits[0]!.snippet).not.toContain('Bellman');
  });

  it('re-chunks when comments are imported, or the mode changes', async () => {
    index.start();
    await settle();
    expect(index.reconcile('nb_a')).toBe(false);
    importComments(db, [{ doc_id: 'doc_a', block_id: 'b_pol', text_sha: 'y', body: 'Exact, not iterative.', model: 'sonnet' }], { now: '2026-10-07T01:00:00.000Z' });
    expect(index.reconcile('nb_a')).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM search_chunks WHERE kind = 'explain'").get<{ n: number }>()!.n).toBe(2);
    mode = 'off';
    expect(index.reconcile('nb_a')).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM search_chunks WHERE kind = 'explain'").get<{ n: number }>()!.n).toBe(0);
  });
});
