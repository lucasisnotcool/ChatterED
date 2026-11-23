/**
 * A notebook that ships already read (`seed.ts`): written out of one profile and brought into
 * another, against real migrated SQLite and real temp folders. And the seed that ships in
 * `samples/`, read into an empty profile as the grading copy's button does.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { GRADER_SAMPLE_NOTEBOOK, GRADER_SEED_DIR } from '../../shared/grader.js';
import { seedManagedVault, seedNotebook } from '../../test-support/notebookseed.js';
import { hasNotebookSeed, readNotebookSeed, SEED_DB, writeNotebookSeed } from './seed.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const SHIPPED_SEED = fileURLToPath(new URL(`../../../samples/${GRADER_SEED_DIR}`, import.meta.url));

interface Profile {
  dir: string;
  root: string;
  db: SqlDatabase;
}

let made: Profile[] = [];
let temps: string[] = [];

function profile(): Profile {
  const dir = mkdtempSync(join(tmpdir(), 'chattered-seed-'));
  temps.push(dir);
  const root = join(dir, 'notebooks');
  mkdirSync(root);
  const db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  seedManagedVault(db, root);
  const p = { dir, root, db };
  made.push(p);
  return p;
}

const side = (p: Profile) => ({ db: p.db, root: p.root, userDataDir: p.dir });
const count = (db: SqlDatabase, sql: string, params: Record<string, unknown> = {}) => db.prepare(sql).get<{ n: number }>(params)!.n;

beforeEach(() => {
  made = [];
  temps = [];
});

afterEach(() => {
  for (const p of made) {
    try {
      p.db.close();
    } catch {
      /* closed by the test */
    }
  }
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

describe('a notebook seed', () => {
  it('carries a read notebook from one profile into another, under new ids and with none of its conversation', () => {
    const a = profile();
    const nb = seedNotebook(a.db, 'a', { root: a.root });
    mkdirSync(join(a.dir, 'notes-pages', 'sha_a_lecture'), { recursive: true });
    writeFileSync(join(a.dir, 'notes-pages', 'sha_a_lecture', 'p-1.jpg'), 'jpeg');
    expect(count(a.db, 'SELECT COUNT(*) AS n FROM messages')).toBeGreaterThan(0);

    const outDir = join(a.dir, 'seed');
    const written = writeNotebookSeed({ from: side(a), notebookId: nb.notebookId, outDir, migrationsDir: MIGRATIONS_DIR, open: openTestDatabase });
    expect(written.notebook.missing).toEqual([]);
    expect(written.pages).toEqual(['sha_a_lecture']);
    // One database file with no journal beside it, the sources and the page images.
    expect(readdirSync(outDir).sort()).toEqual(['notebooks', 'notes-pages', SEED_DB]);
    expect(hasNotebookSeed(outDir)).toBe(true);

    // The seed holds the notebook and nothing said in it.
    const seed = openTestDatabase(join(outDir, SEED_DB));
    try {
      expect(count(seed, 'SELECT COUNT(*) AS n FROM notebooks')).toBe(1);
      for (const t of ['messages', 'rooms', 'events', 'llm_usage']) expect(count(seed, `SELECT COUNT(*) AS n FROM ${t}`)).toBe(0);
      // Under ids of its own: the profile's ids are not in it.
      expect(count(seed, 'SELECT COUNT(*) AS n FROM notebooks WHERE id = @id', { id: nb.notebookId })).toBe(0);
      expect(count(seed, 'SELECT COUNT(*) AS n FROM notes_docs WHERE id = @id OR content_sha = @k', { id: nb.docId, k: `nb:${nb.notebookId}` })).toBe(0);
      seed.exec('PRAGMA journal_mode = DELETE');
    } finally {
      seed.close();
    }

    const b = profile();
    const read = readNotebookSeed({ into: side(b), seedDir: outDir, name: 'Sample', open: openTestDatabase });
    expect(read.sources).toBe(2);
    expect(read.missing).toBe(0);
    expect(b.db.prepare('SELECT id, name, folder_id FROM notebooks').all()).toEqual([{ id: read.notebookId, name: 'Sample', folder_id: null }]);
    expect(read.notebookId).not.toBe(nb.notebookId);

    // Both sources ready, on disk, and the sheet named as the one to open.
    const sources = b.db
      .prepare(`SELECT s.file_id, s.role, s.status, f.rel_path FROM notebook_sources s JOIN files f ON f.id = s.file_id WHERE s.notebook_id = @n ORDER BY s.ord`)
      .all<{ file_id: string; role: string; status: string; rel_path: string }>({ n: read.notebookId });
    expect(sources.map((s) => [s.role, s.status])).toEqual([
      ['lecture', 'ready'],
      ['tutorial', 'ready'],
    ]);
    expect(read.tutorialFileId).toBe(sources[1]!.file_id);
    for (const s of sources) expect(existsSync(join(b.root, ...s.rel_path.split('/')))).toBe(true);

    // Every row family a duplicate carries arrived, row for row.
    const same = (table: string, column: string, from: string, to: string) =>
      expect(count(b.db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = @id`, { id: to })).toBe(
        count(a.db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = @id`, { id: from }),
      );
    same('search_chunks', 'notebook_id', nb.notebookId, read.notebookId);
    same('learning_trees', 'file_id', nb.notebookId, read.notebookId);
    const docs = b.db.prepare('SELECT id, content_sha FROM notes_docs ORDER BY content_sha').all<{ id: string; content_sha: string }>();
    expect(docs.map((d) => d.content_sha)).toEqual([`nb:${read.notebookId}`, `nb:${read.notebookId}:tut:${read.tutorialFileId}`]);
    expect(count(b.db, 'SELECT COUNT(*) AS n FROM tutorial_parts')).toBe(count(a.db, 'SELECT COUNT(*) AS n FROM tutorial_parts WHERE doc_id = @d', { d: nb.tutorialDocId }));
    expect(count(b.db, 'SELECT COUNT(*) AS n FROM tutorial_parts')).toBeGreaterThan(0);
    expect(count(b.db, 'SELECT COUNT(*) AS n FROM file_text')).toBe(count(a.db, 'SELECT COUNT(*) AS n FROM file_text'));
    expect(count(b.db, 'SELECT COUNT(*) AS n FROM messages')).toBe(0);

    // The page images, by content sha; and nothing of the seed's database left behind.
    expect(readFileSync(join(b.dir, 'notes-pages', 'sha_a_lecture', 'p-1.jpg'), 'utf8')).toBe('jpeg');
    expect(readdirSync(join(b.dir, 'grader'))).toEqual([]);

    // Pressed again, the sample comes in again as a second notebook: no id is reused.
    const again = readNotebookSeed({ into: side(b), seedDir: outDir, open: openTestDatabase });
    expect(again.notebookId).not.toBe(read.notebookId);
    expect(count(b.db, 'SELECT COUNT(*) AS n FROM notebooks')).toBe(2);
  });

  it('refuses a folder that is not a seed, and writes nothing into the profile when a seed cannot be read', () => {
    const a = profile();
    const nb = seedNotebook(a.db, 'a', { root: a.root });
    const full = join(a.dir, 'not-a-seed');
    mkdirSync(full);
    writeFileSync(join(full, 'keep.txt'), 'mine');
    expect(() => writeNotebookSeed({ from: side(a), notebookId: nb.notebookId, outDir: full, migrationsDir: MIGRATIONS_DIR, open: openTestDatabase })).toThrow(/not a seed/);
    expect(readFileSync(join(full, 'keep.txt'), 'utf8')).toBe('mine');

    const b = profile();
    expect(hasNotebookSeed(full)).toBe(false);
    expect(() => readNotebookSeed({ into: side(b), seedDir: full, open: openTestDatabase })).toThrow();
    const broken = join(a.dir, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, SEED_DB), 'this is not a database');
    expect(() => readNotebookSeed({ into: side(b), seedDir: broken, open: openTestDatabase })).toThrow();
    expect(count(b.db, 'SELECT COUNT(*) AS n FROM notebooks')).toBe(0);
    expect(readdirSync(b.root)).toEqual([]);
  });
});

describe('the sample seed that ships with a grading copy', () => {
  it('opens in an empty profile as a read notebook: a lecture with its notes, a sheet with its parts linked', () => {
    expect(hasNotebookSeed(SHIPPED_SEED)).toBe(true);
    const p = profile();
    const read = readNotebookSeed({ into: side(p), seedDir: SHIPPED_SEED, name: GRADER_SAMPLE_NOTEBOOK, open: openTestDatabase });
    expect(read.sources).toBe(2);
    expect(read.missing).toBe(0);
    expect(read.tutorialFileId).not.toBeNull();
    expect(p.db.prepare('SELECT name FROM notebooks').all()).toEqual([{ name: GRADER_SAMPLE_NOTEBOOK }]);
    const sources = p.db.prepare(`SELECT role, status, page_count FROM notebook_sources ORDER BY ord`).all();
    expect(sources).toEqual([
      { role: 'lecture', status: 'ready', page_count: 12 },
      { role: 'tutorial', status: 'ready', page_count: 2 },
    ]);
    // The notes doc and the sheet's doc, and a hidden key for each of the sheet's nine parts.
    expect(count(p.db, 'SELECT COUNT(*) AS n FROM notes_docs')).toBe(2);
    expect(count(p.db, 'SELECT COUNT(*) AS n FROM tutorial_parts')).toBe(9);
    // Nothing of the profile it was made on: no path, no usage, no conversation.
    expect(count(p.db, 'SELECT COUNT(*) AS n FROM llm_usage')).toBe(0);
    expect(count(p.db, 'SELECT COUNT(*) AS n FROM messages')).toBe(0);
    const raw = readFileSync(join(SHIPPED_SEED, SEED_DB)).toString('latin1');
    for (const trace of ['/Users/', '/private/', 'sk-ant']) expect(raw.includes(trace)).toBe(false);
    // Page images for both sources, so a prompt can show the tutors the pages.
    expect(readdirSync(join(p.dir, 'notes-pages')).length).toBe(2);
  });
});
