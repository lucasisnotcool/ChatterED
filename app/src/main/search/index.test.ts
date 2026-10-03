/**
 * The index against a real migrated database and a fake embedder whose vectors are hashed word
 * counts: enough meaning for "the passage that shares words ranks first", and deterministic.
 */
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { stem, tokens } from '../../shared/search/keyword.js';
import type { Embedder } from './embedder.js';
import { SearchIndex, snippetOf } from './index.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const DIMS = 128;
const NOW = '2026-10-03T00:00:00.000Z';

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

function fakeEmbedder(o: { available?: boolean; modelId?: string } = {}): Embedder & { docs: number } {
  const e = {
    modelId: o.modelId ?? 'fake@1',
    dims: DIMS,
    docs: 0,
    available: () => o.available ?? true,
    async embedDocuments(texts: string[]) {
      e.docs += texts.length;
      // The header line is context; the fake embeds the whole text like the real one.
      return texts.map(fakeVec);
    },
    async embedQuery(text: string) {
      return fakeVec(text);
    },
    dispose() {},
  };
  return e;
}

// ── fixtures: a notebook with a notes doc and a two-page deck ───────────────────────────────
const para = (id: string, text: string, pages: number[] = []) => ({
  type: 'paragraph',
  attrs: { blockId: id, pages, reason: null, objectiveIds: [] },
  content: [{ type: 'text', text }],
});
const heading = (id: string, level: number, text: string, pages: number[] = []) => ({
  type: 'heading',
  attrs: { level, blockId: id, pages, reason: null, objectiveIds: [] },
  content: [{ type: 'text', text }],
});
const LONG = ' It is a long enough paragraph to stand as a group of its own in the index, past forty words of text so the chunker does not merge it with its neighbour under the same heading at all.';

function docJson(heurText: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      heading('h1', 1, 'Real World Planning and Acting'),
      heading('h_heur', 2, 'Heuristics for search-based planning', [13]),
      para('b_adm', heurText + LONG, [13]),
      para('b_blank', ''),
      heading('h_hla', 2, 'Hierarchical planning and HLAs', [31]),
      para('b_hla', 'To refine an HLA, select it in the plan and replace it with one of its refinements, repeating until only primitive actions remain.' + LONG, [31]),
    ],
  });
}

let db: SqlDatabase;
let index: SearchIndex;
let embedder: ReturnType<typeof fakeEmbedder>;
let scope: Record<string, string[]>;

function addNotebook(id: string, name: string, doc: string | null, pages: [number, string][], fileId = `f_${id}`): void {
  db.prepare('INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (@id, @name, @t, @t)').run({ id, name, t: NOW });
  if (doc !== null) {
    db.prepare(
      `INSERT INTO notes_docs (id, content_sha, file_id, title, doc_json, ingest_status, ingest_version, version, created_at, updated_at)
       VALUES (@id, @k, @n, @title, @doc, 'ready', 1, 1, @t, @t)`,
    ).run({ id: `doc_${id}`, k: `nb:${id}`, n: id, title: name, doc, t: NOW });
  }
  db.prepare(
    `INSERT INTO notebook_sources (file_id, notebook_id, display_name, page_base, page_count, status, added_at)
     VALUES (@f, @n, @d, 0, @c, 'ready', @t)`,
  ).run({ f: fileId, n: id, d: `${name}.pdf`, c: pages.length, t: NOW });
  for (const [page, body] of pages) {
    db.prepare('INSERT INTO file_text (body, name, file_id, page) VALUES (@b, @name, @f, @p)').run({ b: body, name: `${name}.pdf`, f: fileId, p: page });
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  embedder = fakeEmbedder();
  scope = {};
  index = new SearchIndex({ db, embedder, scope: (f) => scope[f ?? 'top'] ?? [], now: () => NOW });
});

afterEach(() => index.dispose());

describe('the search index', () => {
  it('chunks a notebook into notes, units and pages, and embeds them all', async () => {
    addNotebook('nb_a', 'Lecture-complex', docJson('Admissible: a heuristic never overestimates the true cost.'), [
      [13, 'Improving Efficiency\n• Admissible heuristics never overestimate'],
      [31, 'HTN Planning\n• Select an HLA, replace with one refinement, repeat'],
    ]);
    scope.top = ['nb_a'];
    index.start();
    await settle();
    const kinds = db.prepare('SELECT kind, COUNT(*) AS n FROM search_chunks GROUP BY kind ORDER BY kind').all<{ kind: string; n: number }>();
    expect(kinds).toEqual([
      { kind: 'note', n: 2 },
      { kind: 'page', n: 2 },
      { kind: 'unit', n: 2 },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM search_chunks WHERE vec IS NULL').get<{ n: number }>()!.n).toBe(0);
    expect(index.status(null)).toEqual({ notebooks: 1, chunks: 4, pending: 0, semantic: true });
  });

  it('ranks the passage that answers first, with its block to highlight and the slide it came from', async () => {
    addNotebook('nb_a', 'Lecture-complex', docJson('Admissible: a heuristic never overestimates the true cost.'), [
      [13, 'Improving Efficiency\n• Admissible heuristics never overestimate'],
      [31, 'HTN Planning\n• Select an HLA, replace with one refinement, repeat'],
    ]);
    scope.top = ['nb_a'];
    index.start();
    await settle();
    const r = await index.query('how to refine an HLA', { folderId: null });
    expect(r.mode).toBe('semantic');
    const note = r.hits.find((h) => h.kind === 'note')!;
    expect(note.blockId).toBe('b_hla');
    expect(note.page).toBe(31);
    expect(note.section).toEqual(['Hierarchical planning and HLAs']);
    const slide = r.hits.find((h) => h.kind === 'page')!;
    expect(slide.page).toBe(31);
    expect(slide.heading).toBe('HTN Planning');
    // The notes that cite p. 31, for the notes column.
    expect(slide.blockId).toBe('b_hla');
  });

  it('re-embeds only the chunk an edit changed', async () => {
    addNotebook('nb_a', 'Lecture-complex', docJson('Admissible: a heuristic never overestimates.'), [[13, 'Improving Efficiency']]);
    scope.top = ['nb_a'];
    index.start();
    await settle();
    const before = embedder.docs;
    db.prepare("UPDATE notes_docs SET doc_json = @d, version = 2 WHERE content_sha = 'nb:nb_a'").run({
      d: docJson('Admissible: a heuristic never overestimates; consistent implies admissible.'),
    });
    expect(index.reconcile('nb_a')).toBe(true);
    expect(index.reconcile('nb_a')).toBe(false);
    await index.query('consistent', { folderId: null });
    await settle();
    // One note group and its one unit; the other group, its unit and the page kept their vectors.
    expect(embedder.docs - before).toBe(2);
  });

  it('searches only the folder in scope', async () => {
    addNotebook('nb_a', 'Planning', docJson('Admissible: a heuristic never overestimates.'), [[13, 'Heuristics']]);
    addNotebook('nb_b', 'Utility', null, [[10, 'Maximum expected utility\n• choose the action with the highest expected utility']]);
    scope.top = ['nb_a', 'nb_b'];
    scope.fd_util = ['nb_b'];
    index.start();
    await settle();
    const all = await index.query('admissible heuristic', { folderId: null });
    expect(all.hits.some((h) => h.notebookId === 'nb_a')).toBe(true);
    const inUtil = await index.query('admissible heuristic', { folderId: 'fd_util' });
    expect(inUtil.hits.every((h) => h.notebookId === 'nb_b')).toBe(true);
  });

  it('folds the same slide in two decks into one hit, "also in" the other', async () => {
    const slide = 'Example: Air Cargo Transport Planning\n• Load, Fly, Unload';
    addNotebook('nb_a', 'Lecture-classic', null, [[3, slide]]);
    addNotebook('nb_b', 'Lecture-complex', null, [[18, slide]]);
    scope.top = ['nb_a', 'nb_b'];
    index.start();
    await settle();
    const r = await index.query('air cargo example', { folderId: null });
    const cargo = r.hits.filter((h) => h.heading.startsWith('Example: Air Cargo'));
    expect(cargo).toHaveLength(1);
    expect(cargo[0]!.alsoIn).toHaveLength(1);
  });

  it('falls back to keyword search, typo and all, when the model is unavailable', async () => {
    index.dispose();
    embedder = fakeEmbedder({ available: false });
    index = new SearchIndex({ db, embedder, scope: () => ['nb_a'], now: () => NOW });
    addNotebook('nb_a', 'Lecture-complex', docJson('Admissible heuristic: never overestimates. Heuristics compared below.'), [
      [13, 'Heuristics for planning\n• admissible heuristics'],
    ]);
    index.start();
    await settle();
    const r = await index.query('properties of hueristic', { folderId: null });
    expect(r.mode).toBe('keyword');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.pending).toBeGreaterThan(0);
    expect(embedder.docs).toBe(0);
  });

  it('forgets a deleted notebook, and clears vectors written by another model', async () => {
    addNotebook('nb_a', 'Lecture-complex', docJson('Admissible.'), [[13, 'Heuristics']]);
    scope.top = ['nb_a'];
    index.start();
    await settle();
    index.dispose();
    const next = fakeEmbedder({ available: false, modelId: 'fake@2' });
    index = new SearchIndex({ db, embedder: next, scope: () => ['nb_a'], now: () => NOW });
    index.start();
    expect(db.prepare('SELECT COUNT(*) AS n FROM search_chunks WHERE vec IS NOT NULL').get<{ n: number }>()!.n).toBe(0);
    db.prepare("DELETE FROM notebooks WHERE id = 'nb_a'").run();
    index.reconcile('nb_a');
    expect(db.prepare('SELECT COUNT(*) AS n FROM search_chunks').get<{ n: number }>()!.n).toBe(0);
  });

  it('never highlights a short label when its group has a block with content', async () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        heading('h1', 1, 'Real World Planning and Acting'),
        heading('h_heur', 2, 'Heuristics', [13]),
        para('b_label', 'PREREQ: HUERISTICS'),
        para('b_body', 'Consistent: h(s) is at most the step cost plus h(s2); consistency implies admissibility, so A* never re-expands a state.'),
      ],
    });
    addNotebook('nb_a', 'Lecture-complex', doc, []);
    scope.top = ['nb_a'];
    index.start();
    await settle();
    const r = await index.query('hueristics prereq', { folderId: null });
    expect(r.hits[0]!.blockIds).toEqual(['b_label', 'b_body']);
    expect(r.hits[0]!.blockId).toBe('b_body');
  });

  it('cuts a snippet at a word, and flattens lines', () => {
    expect(snippetOf('Title\nfirst line\nsecond')).toBe('Title · first line · second');
    expect(snippetOf('word '.repeat(100), 20)).toBe('word word word word…');
  });
});
