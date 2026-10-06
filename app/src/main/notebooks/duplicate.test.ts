/**
 * Duplicate a folder or a notebook (`duplicate.ts`), its service methods and the headless CLI
 * (`duplicatecli.ts`), against a real migrated SQLite and a real temp folder of source copies.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { excludedNotebookIds } from '../research/exclude.js';
import { seedFolder, seedManagedVault, seedNotebook, SEED_T } from '../../test-support/notebookseed.js';
import { copyName, duplicateFolder, duplicateNotebook, verifyDuplicate } from './duplicate.js';
import { liveAppPid, parseArgs, runDuplicateCli } from './duplicatecli.js';
import { NotebookService } from './service.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const NOW = '2026-10-07T12:00:00.000Z';

let tmp = '';
let root = '';
let db: SqlDatabase;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-dup-'));
  root = join(tmp, 'notebooks');
  mkdirSync(root);
  db = openTestDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  seedManagedVault(db, root);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* closed by the test */
  }
  rmSync(tmp, { recursive: true, force: true });
});

const deps = () => ({ db, root, now: () => NOW });
const count = (sql: string, params: Record<string, unknown> = {}) => db.prepare(sql).get<{ n: number }>(params)!.n;

/** CS4246 ─ Week 3 (subfolder); a notebook in each, plus extras the copy has to carry. */
function seedTerm() {
  seedFolder(db, 'fd_cs', 'CS4246');
  seedFolder(db, 'fd_wk', 'Week 3', 'fd_cs');
  const a = seedNotebook(db, 'a', { folderId: 'fd_cs', root });
  const b = seedNotebook(db, 'b', { folderId: 'fd_wk', root });
  // A solutions sheet keyed to a's tutorial, and a Word source: its copy and its converted text.
  db.prepare(
    `INSERT INTO files (id, vault_id, rel_path, name, ext, kind, size, mtime_ms, sha256) VALUES
       ('f_asol', 'vault_notebooks', 'nb_a/f_asol-Sol.pdf', 'Sol.pdf', 'pdf', 'pdf', 3, 1, 'sha_sol'),
       ('f_aword', 'vault_notebooks', 'nb_a/f_aword-Notes.docx.txt', 'Notes.docx', 'txt', 'text', 5, 1, 'sha_word')`,
  ).run();
  db.prepare(
    `INSERT INTO notebook_sources (file_id, notebook_id, display_name, page_base, page_count, ord, status, added_at, role, key_for) VALUES
       ('f_asol', 'nb_a', 'Sol.pdf', 5, 1, 5, 'ready', @t, 'solutions', 'f_atut'),
       ('f_aword', 'nb_a', 'Notes.docx', 6, 1, 6, 'ready', @t, 'lecture', NULL)`,
  ).run({ t: SEED_T });
  writeFileSync(join(root, 'nb_a', 'f_asol-Sol.pdf'), 'sol');
  writeFileSync(join(root, 'nb_a', 'f_aword-Notes.docx'), 'docx!');
  writeFileSync(join(root, 'nb_a', 'f_aword-Notes.docx.txt'), 'words');
  db.prepare(`INSERT INTO file_text (body, name, file_id, page) VALUES ('converted words about bellman', 'Notes.docx', 'f_aword', 1)`).run();
  return { a, b };
}

describe('duplicateFolder', () => {
  it('copies the folder and its subtree into a new sibling, every notebook with new ids, and checks out', () => {
    const { a, b } = seedTerm();
    const out = duplicateFolder(deps(), { folderId: 'fd_cs' });

    // The folders: "<name> (copy)" beside the original, its subfolder under it, the copy excluded.
    expect(out.name).toBe('CS4246 (copy)');
    const folders = db.prepare(`SELECT id, parent_id, name, research_exclude FROM folders ORDER BY created_at, name`).all<Record<string, unknown>>();
    expect(folders).toContainEqual({ id: out.to, parent_id: null, name: 'CS4246 (copy)', research_exclude: 1 });
    expect(folders).toContainEqual({ id: out.folders.fd_wk, parent_id: out.to, name: 'Week 3', research_exclude: 0 });
    expect(out.notebooks.map((n) => n.from).sort()).toEqual(['nb_a', 'nb_b']);
    const copyA = out.notebooks.find((n) => n.from === 'nb_a')!;
    const copyB = out.notebooks.find((n) => n.from === 'nb_b')!;
    expect(copyA.folderId).toBe(out.to);
    expect(copyB.folderId).toBe(out.folders.fd_wk);

    // Every check of every copy passes: sources, FTS rows found by MATCH, bytes on disk, docs …
    for (const c of out.notebooks) {
      const checks = verifyDuplicate(deps(), c);
      expect(checks.filter((x) => !x.ok)).toEqual([]);
      expect(checks.length).toBeGreaterThan(15);
    }

    // The copy's research mark covers it; the original stays in.
    expect(excludedNotebookIds(db).sort()).toEqual([copyA.to, copyB.to].sort());

    // Sources: new file ids, same bytes, the solutions sheet answering the *copied* tutorial.
    const src = db
      .prepare(`SELECT file_id, role, key_for, page_base FROM notebook_sources WHERE notebook_id = @n ORDER BY ord`)
      .all<{ file_id: string; role: string; key_for: string | null; page_base: number }>({ n: copyA.to });
    expect(src.map((s) => s.file_id)).toEqual([copyA.files[a.lectureFile], copyA.files[a.tutorialFile], copyA.files.f_asol, copyA.files.f_aword]);
    expect(src[2]).toMatchObject({ role: 'solutions', key_for: copyA.files[a.tutorialFile], page_base: 5 });
    // The Word source: both its copy and its converted text, the files row naming the text.
    const word = copyA.files.f_aword!;
    expect(readdirSync(join(root, copyA.to)).filter((f) => f.startsWith(word)).sort()).toEqual([`${word}-Notes.docx`, `${word}-Notes.docx.txt`]);
    expect(db.prepare(`SELECT rel_path FROM files WHERE id = @f`).get({ f: word })).toEqual({ rel_path: `${copyA.to}/${word}-Notes.docx.txt` });
    expect(count(`SELECT COUNT(*) AS n FROM file_text WHERE file_text MATCH 'bellman' AND file_id = @f`, { f: word })).toBe(1);

    // Docs: new ids and content keys; doc, version, learner_touched and overview kept, its fingerprint re-pointed.
    const doc = db.prepare(`SELECT * FROM notes_docs WHERE id = @d`).get<Record<string, unknown>>({ d: copyA.docs[a.docId] })!;
    const orig = db.prepare(`SELECT * FROM notes_docs WHERE id = @d`).get<Record<string, unknown>>({ d: a.docId })!;
    expect(doc).toMatchObject({ content_sha: `nb:${copyA.to}`, file_id: copyA.to, version: 7, learner_touched: 1, doc_json: orig.doc_json });
    expect(JSON.parse(String(doc.overview_json))).toEqual({ fingerprint: `${copyA.files[a.lectureFile]}@0`, greeting: `hi ${a.mark}` });
    const tut = db.prepare(`SELECT content_sha, file_id FROM notes_docs WHERE id = @d`).get({ d: copyA.docs[a.tutorialDocId] });
    expect(tut).toEqual({ content_sha: `nb:${copyA.to}:tut:${copyA.files[a.tutorialFile]}`, file_id: copyA.files[a.tutorialFile] });
    // Per-doc tables, the tree with its file id, the search index with its vectors.
    expect(db.prepare(`SELECT group_key, group_title FROM notes_slide_groups WHERE doc_id = @d`).get({ d: copyA.docs[a.docId] })).toEqual({
      group_key: 'b_a1',
      group_title: `Group ${a.mark}`,
    });
    expect(count(`SELECT COUNT(*) AS n FROM tutorial_parts WHERE doc_id = @d AND status = 'correct'`, { d: copyA.docs[a.tutorialDocId] })).toBe(1);
    // The stored explain comments (migration 033), on the same block of the copied doc.
    expect(db.prepare(`SELECT block_id, kind, body FROM block_comments WHERE doc_id = @d`).all({ d: copyA.docs[a.docId] })).toEqual([
      { block_id: 'b_a1', kind: 'explain', body: `explain ${a.mark}` },
    ]);
    expect(verifyDuplicate(deps(), copyA).find((c) => c.what === `block_comments of ${copyA.docs[a.docId]}`)).toMatchObject({ original: 1, copy: 1, ok: true });
    const treeJson = db.prepare(`SELECT content_sha, json FROM learning_trees WHERE file_id = @n`).get<{ content_sha: string; json: string }>({ n: copyA.to })!;
    expect(treeJson.content_sha).toBe(`nb:${copyA.to}`);
    expect(JSON.parse(treeJson.json)[0].fileId).toBe(copyA.to);
    const chunk = db.prepare(`SELECT key, vec FROM search_chunks WHERE notebook_id = @n`).get<{ key: string; vec: Buffer }>({ n: copyA.to })!;
    expect(chunk.key).toBe(`page:${copyA.to}:1`);
    expect([...chunk.vec]).toEqual([1, 2, 3, 4]);
    expect(db.prepare(`SELECT sources_sig FROM search_state WHERE notebook_id = @n`).get({ n: 'nb_a' })).toEqual({
      sources_sig: `${a.lectureFile}:ready|${a.tutorialFile}:ready`,
    });
    expect(db.prepare(`SELECT sources_sig FROM search_state WHERE notebook_id = @n`).get({ n: copyA.to })).toEqual({
      sources_sig: `${copyA.files[a.lectureFile]}:ready|${copyA.files[a.tutorialFile]}:ready`,
    });
    expect(db.prepare(`SELECT value FROM settings WHERE key = @k`).get({ k: `notebook_page_hwm:${copyA.to}` })).toEqual({ value: '5' });

    // Not copied: the chat and what came from it.
    for (const c of [copyA, copyB]) {
      expect(count(`SELECT COUNT(*) AS n FROM materials WHERE file_id = @n`, { n: c.to })).toBe(0);
      expect(count(`SELECT COUNT(*) AS n FROM quiz_outcomes WHERE content_sha LIKE @k`, { k: `nb:${c.to}%` })).toBe(0);
      expect(count(`SELECT COUNT(*) AS n FROM objective_activity WHERE content_sha = @k`, { k: `nb:${c.to}` })).toBe(0);
      expect(count(`SELECT COUNT(*) AS n FROM learning_objective_states WHERE file_id = @n`, { n: c.to })).toBe(0);
      expect(count(`SELECT COUNT(*) AS n FROM llm_usage WHERE file_id = @n`, { n: c.to })).toBe(0);
      for (const d of Object.values(c.docs)) {
        for (const t of ['notes_doc_edits', 'notes_suggestions', 'notes_threads']) {
          expect(count(`SELECT COUNT(*) AS n FROM ${t} WHERE doc_id = @d`, { d })).toBe(0);
        }
      }
    }
    expect(count(`SELECT COUNT(*) AS n FROM rooms`)).toBe(2);

    // The originals are untouched.
    expect(db.prepare(`SELECT folder_id, research_exclude FROM notebooks WHERE id = 'nb_b'`).get()).toEqual({ folder_id: 'fd_wk', research_exclude: 0 });
    expect(count(`SELECT COUNT(*) AS n FROM notebook_sources WHERE notebook_id = 'nb_a'`)).toBe(4);
    expect(readdirSync(join(root, 'nb_a')).length).toBe(5);
    expect(readFileSync(join(root, copyB.to, `${copyB.files[b.lectureFile]}-Lecture b.pdf`), 'utf8')).toBe('%PDF-1.4 bytes of Lecture b.pdf');
  });

  it('takes a given name, and can leave the copy in the research data', () => {
    seedTerm();
    const out = duplicateFolder(deps(), { folderId: 'fd_wk', name: '  Week 3 (exam prep) ', researchExclude: false });
    expect(out.name).toBe('Week 3 (exam prep)');
    expect(db.prepare(`SELECT parent_id, research_exclude FROM folders WHERE id = @id`).get({ id: out.to })).toEqual({ parent_id: 'fd_cs', research_exclude: 0 });
    expect(excludedNotebookIds(db)).toEqual([]);
    expect(out.notebooks).toHaveLength(1);
  });

  it('copies the rows of a source whose file is missing from disk, and says so', () => {
    const { a } = seedTerm();
    unlinkSync(join(root, 'nb_a', `${a.tutorialFile}-Tutorial a.pdf`));
    const out = duplicateFolder(deps(), { folderId: 'fd_cs' });
    const copyA = out.notebooks.find((n) => n.from === 'nb_a')!;
    expect(copyA.missing).toEqual([`nb_a/${a.tutorialFile}-Tutorial a.pdf`]);
    expect(count(`SELECT COUNT(*) AS n FROM notebook_sources WHERE notebook_id = @n`, { n: copyA.to })).toBe(4);
    const failed = verifyDuplicate(deps(), copyA).filter((c) => !c.ok);
    // Both sides are missing, so the sizes agree (-1); nothing else differs.
    expect(failed).toEqual([]);
  });

  it('writes nothing, on disk or in the database, when a row fails', () => {
    seedTerm();
    db.exec(`CREATE TRIGGER no_copies BEFORE INSERT ON notes_docs WHEN NEW.created_at = '${NOW}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    const folders = count(`SELECT COUNT(*) AS n FROM folders`);
    const notebooks = count(`SELECT COUNT(*) AS n FROM notebooks`);
    const dirs = readdirSync(root).sort();
    expect(() => duplicateFolder(deps(), { folderId: 'fd_cs' })).toThrow(/boom/);
    expect(count(`SELECT COUNT(*) AS n FROM folders`)).toBe(folders);
    expect(count(`SELECT COUNT(*) AS n FROM notebooks`)).toBe(notebooks);
    expect(count(`SELECT COUNT(*) AS n FROM file_text`)).toBe(11);
    expect(readdirSync(root).sort()).toEqual(dirs);
  });

  it('refuses a folder that does not exist', () => {
    expect(() => duplicateFolder(deps(), { folderId: 'fd_none' })).toThrow(/no longer exists/);
  });
});

describe('duplicateNotebook', () => {
  it('copies one notebook beside itself, "(copy)", excluded by its own mark', () => {
    const { b } = seedTerm();
    const out = duplicateNotebook(deps(), { notebookId: 'nb_b' });
    expect(out.name).toBe(`Notebook ${b.mark} (copy)`);
    expect(db.prepare(`SELECT folder_id, research_exclude, legacy_file_id, opened_at FROM notebooks WHERE id = @id`).get({ id: out.to })).toEqual({
      folder_id: 'fd_wk',
      research_exclude: 1,
      legacy_file_id: null,
      opened_at: null,
    });
    expect(verifyDuplicate(deps(), out).filter((c) => !c.ok)).toEqual([]);
    expect(excludedNotebookIds(db)).toEqual([out.to]);
  });

  it('cuts a long name so the suffix fits', () => {
    expect(copyName('x'.repeat(200))).toHaveLength(120);
    expect(copyName('x'.repeat(200)).endsWith(' (copy)')).toBe(true);
  });
});

describe('the service', () => {
  it('duplicates and marks through NotebookService, and the home sees the marks', () => {
    seedTerm();
    const changed: string[] = [];
    const service = new NotebookService({ db, root, now: () => NOW, onChanged: (c) => changed.push(c.notebookId) });
    try {
      const out = service.duplicateFolder({ folderId: 'fd_cs', name: 'CS4246 (exam prep)' });
      expect(changed.sort()).toEqual(out.notebooks.map((n) => n.to).sort());
      expect(service.folders().find((f) => f.id === out.to)).toMatchObject({ name: 'CS4246 (exam prep)', researchExclude: true });

      expect(service.setFolderResearchExclude(out.to, false).researchExclude).toBe(false);
      expect(excludedNotebookIds(db)).toEqual([]);
      service.setNotebookResearchExclude('nb_a', true);
      expect(service.list().find((n) => n.id === 'nb_a')?.researchExclude).toBe(true);
      expect(excludedNotebookIds(db)).toEqual(['nb_a']);

      const one = service.duplicateNotebook({ notebookId: 'nb_a', researchExclude: false });
      expect(service.list().find((n) => n.id === one.to)).toMatchObject({ researchExclude: false, folderId: 'fd_cs', sourceCount: 4 });
    } finally {
      service.dispose();
    }
  });
});

describe('the headless CLI', () => {
  function fileDb(): string {
    db.close();
    const dir = join(tmp, 'userData');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'app.db');
    const file = openTestDatabase(path);
    runMigrations(file, MIGRATIONS_DIR);
    db = file;
    seedManagedVault(db, '/somewhere/else/live');
    // The source copies live beside the database, as the app keeps them.
    rmSync(root, { recursive: true, force: true });
    root = join(dir, 'notebooks');
    mkdirSync(root);
    seedTerm();
    db.close();
    return path;
  }

  it('parses its arguments, with research exclusion on by default', () => {
    expect(parseArgs(['--db', 'a.db', '--folder', 'fd_x'])).toMatchObject({ db: 'a.db', folder: 'fd_x', researchExclude: true, backup: true });
    expect(parseArgs(['--db', 'a.db', '--notebook', 'nb_x', '--include-research', '--no-backup', '--name', 'N'])).toMatchObject({
      notebook: 'nb_x',
      researchExclude: false,
      backup: false,
      name: 'N',
    });
    expect(() => parseArgs(['--db', 'a.db'])).toThrow(/exactly one/);
    expect(() => parseArgs(['--folder', 'fd_x'])).toThrow(/--db is required/);
    expect(() => parseArgs(['--db', 'a.db', '--folder', 'fd_x', '--bogus'])).toThrow(/Unknown argument/);
  });

  it('backs up, migrates, duplicates beside the database, and prints the id maps and passing checks', () => {
    const path = fileDb();
    const out = runDuplicateCli(['--db', path, '--folder', 'fd_cs', '--name', 'CS4246 (exam prep)', '--exclude-research'], {
      migrationsDir: MIGRATIONS_DIR,
      now: () => new Date(NOW),
    });
    expect(out.ok).toBe(true);
    expect(out.checks.failed).toEqual([]);
    expect(out.root).toBe(root);
    expect(out.backup && existsSync(out.backup)).toBe(true);
    expect(out.folder).toMatchObject({ from: 'fd_cs', name: 'CS4246 (exam prep)', researchExclude: true });
    expect(out.notebooks).toHaveLength(2);
    for (const n of out.notebooks) {
      expect(n.researchExcluded).toBe(true);
      expect(Object.keys(n.docs).length).toBeGreaterThan(0);
      for (const rel of n.copiedOnDisk) expect(existsSync(join(root, ...rel.split('/')))).toBe(true);
    }
    // Never into the vault row's path, which is not this database's folder.
    expect(existsSync('/somewhere/else/live')).toBe(false);
  });

  it('refuses while the app holds the database, unless forced', () => {
    const path = fileDb();
    symlinkSync(`host-${process.pid}`, join(tmp, 'userData', 'SingletonLock'));
    expect(liveAppPid(path)).toBe(process.pid);
    expect(() => runDuplicateCli(['--db', path, '--folder', 'fd_cs'], { migrationsDir: MIGRATIONS_DIR })).toThrow(/has this database open/);
    const out = runDuplicateCli(['--db', path, '--notebook', 'nb_a', '--force', '--no-backup'], { migrationsDir: MIGRATIONS_DIR });
    expect(out.ok).toBe(true);
    expect(out.backup).toBeNull();
    expect(out.folder).toBeNull();
  });
});
