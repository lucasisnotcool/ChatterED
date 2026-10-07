/**
 * The index over a notebook's tutorial sheets' docs (2026-10-07, search.md §10), against a real
 * migrated database and a fake embedder of hashed word counts (as `index.test.ts`): a part is
 * found and named as the sheet's, it shows its block's explain, and it follows the sheet's
 * version, role and comments.
 */
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { importComments } from '../db/repos/comments.js';
import { stem, tokens } from '../../shared/search/keyword.js';
import { tutorialContentKey } from '../../shared/tutorial.js';
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

const attrs = (blockId: string, reason: string | null, pages: number[] = []) => ({ blockId, pages, reason, objectiveIds: [] });
const para = (id: string, text: string, reason: string | null, pages: number[] = []) => ({ type: 'paragraph', attrs: attrs(id, reason, pages), content: [{ type: 'text', text }] });
const heading = (id: string, level: number, text: string, reason: string | null, pages: number[] = []) => ({
  type: 'heading',
  attrs: { ...attrs(id, reason, pages), level },
  content: [{ type: 'text', text }],
});
const LONG = ' This paragraph runs past forty words so that it stands as a group of its own in the index and is never merged with the paragraph that follows it under the same heading here.';

const NOTES = JSON.stringify({
  type: 'doc',
  content: [heading('n_h1', 1, 'Rational decisions', null), heading('n_eu', 2, 'Expected utility', null, [12]), para('n_eu1', 'Weight each outcome by its probability and add.' + LONG, null, [12])],
});

function sheet(solution: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      heading('t_title', 1, 'Tutorial 2 Week 4: Rational Decision Making', 'title'),
      heading('t_p3', 2, 'Problem 3: Allais Paradox', 'sheet', [48]),
      {
        type: 'tut_part',
        attrs: { ...attrs('t_p3b', 'sheet_part', [48]), partId: 'P3b', label: 'Problem 3 b)', answerKind: 'text', origin: 'sheet' },
        content: [
          para('t_q3b', 'Prove that preferring B to A and C to D violates the substitutability axiom.', 'sheet', [48]),
          { type: 'tut_answer', attrs: { ...attrs('t_a3b', 'answer_slot', [48]), answerKind: 'text' }, content: [para('', 'Decompose C and D as compound lotteries.', null)] },
          para('t_s3b', solution, 'exam_prep_solution', [48, 22]),
        ],
      },
    ],
  });
}

let db: SqlDatabase;
let index: SearchIndex;

function insertDoc(id: string, key: string, fileId: string, title: string, doc: string, version = 1): void {
  db.prepare(
    `INSERT INTO notes_docs (id, content_sha, file_id, title, doc_json, ingest_status, ingest_version, version, created_at, updated_at)
     VALUES (@id, @k, @f, @title, @doc, 'ready', 1, @v, @t, @t)`,
  ).run({ id, k: key, f: fileId, title, doc, v: version, t: NOW });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb_a', 'Rational Decision Making', @t, @t)").run({ t: NOW });
  insertDoc('doc_nb', 'nb:nb_a', 'nb_a', 'Rational decisions', NOTES);
  db.prepare(
    `INSERT INTO notebook_sources (file_id, notebook_id, display_name, page_base, page_count, status, added_at, role, ord)
     VALUES ('f_lec', 'nb_a', 'Lecture 4.pdf', 0, 46, 'ready', @t, 'lecture', 0), ('f_tut', 'nb_a', 'Tutorial2.pdf', 46, 2, 'ready', @t, 'tutorial', 1)`,
  ).run({ t: NOW });
  insertDoc('doc_tut', tutorialContentKey('nb_a', 'f_tut'), 'f_tut', 'Tutorial 2 Week 4: Rational Decision Making', sheet('Solution: substitutability says mixing both with the same third lottery keeps the order; the 0.25 mix of A and B gives C and D.'));
  index = new SearchIndex({ db, embedder, scope: () => ['nb_a'], now: () => NOW, explainMode: () => 'append' });
});

afterEach(() => index.dispose());

describe('search over tutorial sheets', () => {
  it('finds a part by its solution, names the sheet, and keeps the pages it cites', async () => {
    index.start();
    await settle();
    const r = await index.query('substitutability mixing same third lottery keeps the order', { folderId: null });
    const top = r.hits[0]!;
    expect(top).toMatchObject({
      kind: 'note',
      title: 'Tutorial 2 Week 4: Rational Decision Making',
      section: ['Problem 3 b)'],
      tutorial: { fileId: 'f_tut', title: 'Tutorial 2 Week 4: Rational Decision Making', label: 'Problem 3 b)' },
      pages: [22, 48],
    });
    expect(top.key.startsWith('tut:nb_a:f_tut:')).toBe(true);
    expect(top.blockIds).toEqual(['t_q3b', 't_a3b', 't_s3b']);
    // A notes hit stays the notebook's.
    const notes = await index.query('weight each outcome by its probability', { folderId: null });
    expect(notes.hits[0]).toMatchObject({ blockId: 'n_eu1', tutorial: null });
  });

  it('shows and matches an explain on a sheet\'s line (comments keyed by the sheet\'s doc)', async () => {
    importComments(db, [{ doc_id: 'doc_tut', block_id: 't_q3b', text_sha: 'x', body: 'The **Allais** trap: certainty effect, people overweight a sure thing.', model: 'sonnet' }], { now: NOW });
    index.start();
    await settle();
    const r = await index.query('certainty effect overweight sure thing', { folderId: null });
    expect(r.hits[0]).toMatchObject({ blockId: 't_q3b', via: 'explain', tutorial: { fileId: 'f_tut' } });
    expect(r.hits[0]!.explain).toContain('**Allais** trap');
  });

  it('follows the sheet: a new version re-chunks it, a role change takes it out', async () => {
    index.start();
    await settle();
    expect(index.reconcile('nb_a')).toBe(false);
    db.prepare("UPDATE notes_docs SET doc_json = @d, version = 2 WHERE id = 'doc_tut'").run({ d: sheet('Solution: zebra crossing argument.') });
    expect(index.reconcile('nb_a')).toBe(true);
    // The changed part waits for its vector: the first query kicks the pump.
    await index.query('zebra crossing argument', { folderId: null });
    await settle();
    const r = await index.query('zebra crossing argument', { folderId: null });
    expect(r.hits[0]!.tutorial?.fileId).toBe('f_tut');

    db.prepare("UPDATE notebook_sources SET role = 'lecture' WHERE file_id = 'f_tut'").run();
    expect(index.reconcile('nb_a')).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM search_chunks WHERE key LIKE 'tut:%'").get<{ n: number }>()!.n).toBe(0);
  });

  it('a tutorial page\'s slide hit opens the sheet; a lecture page\'s, the notes', async () => {
    db.prepare("INSERT INTO file_text (body, name, file_id, page) VALUES ('Problem 3 Allais paradox lotteries A B C D', 'Tutorial2.pdf', 'f_tut', 2)").run();
    db.prepare("INSERT INTO file_text (body, name, file_id, page) VALUES ('Expected utility of a lottery', 'Lecture 4.pdf', 'f_lec', 12)").run();
    index.start();
    await settle();
    const tut = (await index.query('Allais paradox lotteries', { folderId: null })).hits.find((h) => h.kind === 'page')!;
    expect(tut).toMatchObject({ page: 48, tutorial: { fileId: 'f_tut' } });
    const lec = (await index.query('expected utility of a lottery', { folderId: null })).hits.find((h) => h.kind === 'page')!;
    expect(lec).toMatchObject({ page: 12, blockId: 'n_eu1', tutorial: null });
  });
});
