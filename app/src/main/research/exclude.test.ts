/**
 * Which notebooks and folders "Exclude from research data" covers (migration 032), and the rule
 * set's reach, on a real migrated SQLite. The export end to end is in `export.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { openTestDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { openTestDb } from '../../test-support/db.js';
import { seedFolder, seedManagedVault, seedNotebook } from '../../test-support/notebookseed.js';
import {
  applyResearchExclusion,
  ensureResearchExcludeColumns,
  excludedCounts,
  excludedFolderIds,
  excludedNotebookIds,
  exclusionScope,
} from './exclude.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

function tree() {
  const { db } = openTestDb();
  seedManagedVault(db, '/root');
  // term (marked) ─ week ─ day ;  kept ─ inner
  seedFolder(db, 'fd_term', 'Term', null, true);
  seedFolder(db, 'fd_week', 'Week', 'fd_term');
  seedFolder(db, 'fd_day', 'Day', 'fd_week');
  seedFolder(db, 'fd_kept', 'Kept');
  seedFolder(db, 'fd_inner', 'Inner', 'fd_kept');
  return db;
}

describe('what is excluded', () => {
  it("a folder's mark covers every folder and notebook under it, at any depth", () => {
    const db = tree();
    seedNotebook(db, 'deep', { folderId: 'fd_day' });
    seedNotebook(db, 'top', { folderId: 'fd_term' });
    seedNotebook(db, 'kept', { folderId: 'fd_inner' });
    seedNotebook(db, 'loose');
    expect(excludedFolderIds(db)).toEqual(['fd_day', 'fd_term', 'fd_week']);
    expect(excludedNotebookIds(db)).toEqual(['nb_deep', 'nb_top']);
  });

  it("a notebook's own mark excludes it wherever it is; moving it changes nothing else", () => {
    const db = tree();
    seedNotebook(db, 'own', { folderId: 'fd_inner', researchExclude: true });
    seedNotebook(db, 'moved', { folderId: 'fd_inner' });
    expect(excludedNotebookIds(db)).toEqual(['nb_own']);
    // Into an excluded folder: excluded with no write to the notebook's own flag.
    db.prepare(`UPDATE notebooks SET folder_id = 'fd_week' WHERE id = 'nb_moved'`).run();
    expect(excludedNotebookIds(db)).toEqual(['nb_moved', 'nb_own']);
    expect(db.prepare(`SELECT research_exclude FROM notebooks WHERE id = 'nb_moved'`).get()).toEqual({ research_exclude: 0 });
    // Unmarking the folder releases it.
    db.prepare(`UPDATE folders SET research_exclude = 0 WHERE id = 'fd_term'`).run();
    expect(excludedNotebookIds(db)).toEqual(['nb_own']);
    expect(excludedFolderIds(db)).toEqual([]);
  });

  it('follows the keys to every row family: sources, docs, tutorial docs, room, sessions, turns', () => {
    const db = tree();
    const s = seedNotebook(db, 'x', { researchExclude: true });
    seedNotebook(db, 'y');
    const scope = exclusionScope(db);
    expect(scope.notebooks).toEqual(['nb_x']);
    expect(scope.files.sort()).toEqual([s.lectureFile, s.tutorialFile].sort());
    expect(scope.docs.sort()).toEqual([s.docId, s.tutorialDocId].sort());
    expect(scope.contentKeys.sort()).toEqual(['nb:nb_x', 'nb:nb_x:tut:f_xtut']);
    expect(scope.materials).toEqual(['mat_x']);
    expect(scope.rooms).toEqual(['room_x']);
    expect(scope.sessions).toEqual(['sess_x']);
    expect(scope.turns).toEqual(['turn_x']);
    // The bytes' cache goes only when no remaining file has the sha.
    expect(scope.shas.sort()).toEqual(['sha_x_lecture', 'sha_x_tutorial']);
  });

  it("keeps a sha's cache when an included file shares the bytes", () => {
    const db = tree();
    seedNotebook(db, 'x', { researchExclude: true });
    seedNotebook(db, 'y');
    db.prepare(`UPDATE files SET sha256 = 'sha_x_lecture' WHERE id = 'f_ylec'`).run();
    expect(exclusionScope(db).shas).toEqual(['sha_x_tutorial']);
  });

  it('counts read-only, and deletes only where it is told to, from a copy', () => {
    const db = tree();
    seedNotebook(db, 'x', { folderId: 'fd_week' });
    seedNotebook(db, 'y');
    const counts = excludedCounts(db);
    expect(counts).toMatchObject({ notebooks: 1, notes_docs: 2, rooms: 1, messages: 2, whispers: 1, llm_usage: 3, file_text: 5, folders: 3 });
    // The live tables are untouched by counting, and the chat record's triggers are still there.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM messages`).get()).toEqual({ n: 4 });
    expect(() => db.prepare(`DELETE FROM messages WHERE room_id = 'room_x'`).run()).toThrow(/never deleted/);

    const report = applyResearchExclusion(db);
    expect(report.notebooks).toBe(1);
    expect(report.folders).toBe(3);
    expect(report.rows).toMatchObject(counts);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM messages`).get()).toEqual({ n: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM file_text WHERE file_id LIKE 'f_y%'`).get()).toEqual({ n: 5 });
    expect(excludedNotebookIds(db)).toEqual([]);
  });

  it('is empty, and changes nothing, when nothing is marked', () => {
    const db = tree();
    db.prepare(`UPDATE folders SET research_exclude = 0`).run();
    seedNotebook(db, 'y');
    expect(excludedCounts(db)).toEqual({});
    expect(applyResearchExclusion(db)).toEqual({ notebooks: 0, folders: 0, rows: {} });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM notebooks`).get()).toEqual({ n: 1 });
  });
});

describe('ensureResearchExcludeColumns', () => {
  it('adds the columns to a database that a later migration reached without 032, once', () => {
    const db = openTestDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    // Simulate a database that went 031 → 033 without 032: drop the columns' effect by rebuilding.
    db.exec(`CREATE TABLE f2 AS SELECT id, parent_id, name, ord, created_at, updated_at FROM folders`);
    db.exec(`PRAGMA foreign_keys = OFF; DROP TABLE folders; ALTER TABLE f2 RENAME TO folders; PRAGMA foreign_keys = ON`);
    expect(excludedFolderIds(db)).toEqual([]);
    expect(ensureResearchExcludeColumns(db)).toEqual(['folders']);
    expect(ensureResearchExcludeColumns(db)).toEqual([]);
    db.prepare(`INSERT INTO folders (id, name, ord, created_at, updated_at, research_exclude) VALUES ('fd_a', 'A', 0, 't', 't', 1)`).run();
    expect(excludedFolderIds(db)).toEqual(['fd_a']);
  });
});
