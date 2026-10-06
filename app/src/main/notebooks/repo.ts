/**
 * **The notebooks' SQLite layer** (migration 024, `docs/research/notebooks.md`).
 *
 * Two tables of its own (`notebooks`, `notebook_sources`), a join to `files` for what each source
 * *is* (its kind and the sha of its bytes), and one settings row per notebook for the page
 * high-water mark. Main-process only, like the vault's repository beside it.
 *
 * ## Why the high-water mark is a settings row
 *
 * A source's `page_base` is append-only and never reused (`shared/notebook.ts`, contract C1): a
 * notebook page must keep naming the same slide after a source is removed, so a removed source's
 * pages become a gap and the next source starts *after* them. That needs the highest page the
 * notebook ever used, and it cannot be derived from what is left:
 *
 *  - `notebook_sources` loses the row when a source is removed (the copy and its `files` row go
 *    with it, as the brief asks), and its CHECK has no `removed` status to keep it under;
 *  - the notes doc's block pages are a lower bound only (an overview need not cite the last page
 *    of the last source), and they belong to another track's table.
 *
 * So the mark is written, in the same transaction that makes a source ready, to
 * `settings['notebook_page_hwm:<id>']`, and every read takes the larger of it and the end of the
 * highest source still present — so a lost or stale row can only make a base *larger*, never
 * reuse one. Deleted with the notebook.
 */
import type { SqlDatabase } from '../db/driver.js';
import { insert, plain, plainAll } from '../db/sql.js';
import type { FileKind } from '../vault/kinds.js';
import type { FolderView } from '../../shared/folders.js';
import { isSourceRole, type SourceRole } from '../../shared/tutorial.js';
import {
  contextFingerprint,
  virtualPageCount,
  type NotebookSourceView,
  type NotebookView,
  type SourceKind,
  type SourceStatus,
} from '../../shared/notebook.js';

export interface NotebookRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  opened_at: string | null;
  legacy_file_id: string | null;
  /** Migration 026: the folder it sits in, or null at the top level. */
  folder_id?: string | null;
  /** Migration 032: 1 when the learner marked it "Exclude from research data". */
  research_exclude?: number;
}

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  ord: number;
  created_at: string;
  updated_at: string;
  /** Migration 032: 1 when marked "Exclude from research data"; covers the whole subtree. */
  research_exclude?: number;
}

export function folderView(row: FolderRow): FolderView {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    ord: row.ord,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    researchExclude: row.research_exclude === 1,
  };
}

export interface SourceRow {
  file_id: string;
  notebook_id: string;
  display_name: string;
  page_base: number;
  page_count: number;
  enabled: number;
  ord: number;
  status: SourceStatus;
  error: string | null;
  added_at: string;
  /** Migration 028. Optional on an insert: the column defaults to `lecture`. */
  role?: SourceRole;
  key_for?: string | null;
}

/** A source with what its `files` row says about it. `file_*` are null if that row is gone. */
export interface SourceRecord extends SourceRow {
  file_kind: FileKind | null;
  sha256: string | null;
  rel_path: string | null;
}

export function hwmKey(notebookId: string): string {
  return `notebook_page_hwm:${notebookId}`;
}

/** What a `files.kind` reads as in a notebook. Everything that is not a PDF or an image is text. */
export function sourceKindOf(kind: FileKind | null): SourceKind {
  if (kind === 'pdf') return 'pdf';
  if (kind === 'image') return 'image';
  return 'text';
}

export function sourceView(row: SourceRecord): NotebookSourceView {
  return {
    fileId: row.file_id,
    name: row.display_name,
    kind: sourceKindOf(row.file_kind),
    pageBase: row.page_base,
    pageCount: row.page_count,
    enabled: row.enabled === 1,
    status: row.status,
    error: row.error,
    addedAt: row.added_at,
    role: isSourceRole(row.role) ? row.role : 'lecture',
    keyFor: row.role === 'solutions' ? (row.key_for ?? null) : null,
  };
}

export interface NotebooksRepo {
  get(id: string): NotebookRow | undefined;
  /** Most recently opened first; a notebook never opened counts from when it was made. */
  list(): NotebookRow[];
  byLegacyFile(fileId: string): NotebookRow | undefined;
  insert(row: NotebookRow): void;
  rename(id: string, name: string, now: string): void;
  touch(id: string, now: string): void;
  markOpened(id: string, now: string): void;
  /** The row and, by cascade, its sources' rows. The caller deletes the files and copies. */
  remove(id: string): void;

  sources(notebookId: string): SourceRecord[];
  source(fileId: string): SourceRecord | undefined;
  insertSource(row: SourceRow): void;
  updateSource(fileId: string, patch: Partial<Omit<SourceRow, 'file_id' | 'notebook_id'>>): void;
  removeSource(fileId: string): void;
  setEnabled(notebookId: string, fileIds: readonly string[], enabled: boolean): number;
  nextOrd(notebookId: string): number;
  /** Every source still `reading`, across notebooks, oldest first: the queue at boot. */
  reading(): SourceRecord[];

  /** The page high-water mark (see the header). 0 when none was written. */
  highWater(notebookId: string): number;
  setHighWater(notebookId: string, value: number, now: string): void;
  clearHighWater(notebookId: string): void;

  /** `view()` for one notebook, or null. */
  view(id: string): NotebookView | null;

  // ── Folders (migration 026) ──
  folders(): FolderRow[];
  folder(id: string): FolderRow | undefined;
  insertFolder(row: FolderRow): void;
  renameFolder(id: string, name: string, now: string): void;
  setFolderParent(id: string, parentId: string | null, ord: number, now: string): void;
  /** The row only. The service has already moved its contents up. */
  removeFolder(id: string): void;
  setNotebookFolder(notebookId: string, folderId: string | null): void;
  /** Notebooks directly in `folderId` (null: the top level). */
  notebooksIn(folderId: string | null): string[];
  /** Notebooks in `folderId` or any folder under it; every notebook for null. */
  subtreeNotebookIds(folderId: string | null): string[];
  nextFolderOrd(parentId: string | null): number;

  // ── Exclude from research data (migration 032) ──
  setNotebookResearchExclude(notebookId: string, exclude: boolean): void;
  setFolderResearchExclude(folderId: string, exclude: boolean): void;
}

const SOURCE_SELECT = `SELECT s.*, f.kind AS file_kind, f.sha256 AS sha256, f.rel_path AS rel_path
  FROM notebook_sources s LEFT JOIN files f ON f.id = s.file_id`;

export function notebooksRepo(db: SqlDatabase): NotebooksRepo {
  const repo: NotebooksRepo = {
    get: (id) => plain(db.prepare('SELECT * FROM notebooks WHERE id = @id').get<NotebookRow>({ id })),
    list: () =>
      plainAll(
        db
          .prepare('SELECT * FROM notebooks ORDER BY COALESCE(opened_at, created_at) DESC, updated_at DESC, id')
          .all<NotebookRow>(),
      ),
    byLegacyFile: (fileId) =>
      plain(db.prepare('SELECT * FROM notebooks WHERE legacy_file_id = @f').get<NotebookRow>({ f: fileId })),
    insert: (row) => insert(db, 'notebooks', row as unknown as Record<string, unknown>),
    rename: (id, name, now) =>
      void db.prepare('UPDATE notebooks SET name = @name, updated_at = @now WHERE id = @id').run({ id, name, now }),
    touch: (id, now) => void db.prepare('UPDATE notebooks SET updated_at = @now WHERE id = @id').run({ id, now }),
    markOpened: (id, now) => void db.prepare('UPDATE notebooks SET opened_at = @now WHERE id = @id').run({ id, now }),
    remove: (id) => void db.prepare('DELETE FROM notebooks WHERE id = @id').run({ id }),

    sources: (notebookId) =>
      plainAll(
        db
          .prepare(`${SOURCE_SELECT} WHERE s.notebook_id = @n ORDER BY s.ord, s.added_at, s.file_id`)
          .all<SourceRecord>({ n: notebookId }),
      ),
    source: (fileId) => plain(db.prepare(`${SOURCE_SELECT} WHERE s.file_id = @f`).get<SourceRecord>({ f: fileId })),
    insertSource: (row) => insert(db, 'notebook_sources', row as unknown as Record<string, unknown>),
    updateSource(fileId, patch) {
      const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
      if (keys.length === 0) return;
      const sets = keys.map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE notebook_sources SET ${sets} WHERE file_id = @file_id`).run({ ...patch, file_id: fileId });
    },
    removeSource: (fileId) => void db.prepare('DELETE FROM notebook_sources WHERE file_id = @f').run({ f: fileId }),
    setEnabled(notebookId, fileIds, enabled) {
      let changed = 0;
      const stmt = db.prepare('UPDATE notebook_sources SET enabled = @e WHERE notebook_id = @n AND file_id = @f');
      for (const f of new Set(fileIds)) changed += stmt.run({ e: enabled ? 1 : 0, n: notebookId, f }).changes;
      return changed;
    },
    nextOrd: (notebookId) =>
      (db
        .prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM notebook_sources WHERE notebook_id = @n')
        .get<{ m: number }>({ n: notebookId })?.m ?? -1) + 1,
    reading: () =>
      plainAll(
        db
          .prepare(`${SOURCE_SELECT} WHERE s.status = 'reading' ORDER BY s.added_at, s.ord, s.file_id`)
          .all<SourceRecord>(),
      ),

    highWater(notebookId) {
      const raw = db.prepare('SELECT value FROM settings WHERE key = @k').get<{ value: string }>({ k: hwmKey(notebookId) });
      const n = Number(raw?.value ?? 0);
      return Number.isInteger(n) && n > 0 ? n : 0;
    },
    setHighWater(notebookId, value, now) {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (@k, @v, @t)
           ON CONFLICT(key) DO UPDATE SET value = @v, updated_at = @t`,
      ).run({ k: hwmKey(notebookId), v: String(value), t: now });
    },
    clearHighWater: (notebookId) => void db.prepare('DELETE FROM settings WHERE key = @k').run({ k: hwmKey(notebookId) }),

    folders: () => plainAll(db.prepare('SELECT * FROM folders ORDER BY ord, name, id').all<FolderRow>()),
    folder: (id) => plain(db.prepare('SELECT * FROM folders WHERE id = @id').get<FolderRow>({ id })),
    insertFolder: (row) => insert(db, 'folders', row as unknown as Record<string, unknown>),
    renameFolder: (id, name, now) =>
      void db.prepare('UPDATE folders SET name = @name, updated_at = @now WHERE id = @id').run({ id, name, now }),
    setFolderParent: (id, parentId, ord, now) =>
      void db
        .prepare('UPDATE folders SET parent_id = @p, ord = @ord, updated_at = @now WHERE id = @id')
        .run({ id, p: parentId, ord, now }),
    removeFolder: (id) => void db.prepare('DELETE FROM folders WHERE id = @id').run({ id }),
    // A move is not an edit: `updated_at` ("edited today" on the card) is left alone.
    setNotebookFolder: (notebookId, folderId) =>
      void db.prepare('UPDATE notebooks SET folder_id = @f WHERE id = @id').run({ id: notebookId, f: folderId }),
    notebooksIn: (folderId) =>
      db
        .prepare('SELECT id FROM notebooks WHERE folder_id IS @f ORDER BY id')
        .all<{ id: string }>({ f: folderId })
        .map((r) => r.id),
    subtreeNotebookIds(folderId) {
      if (folderId === null) return db.prepare('SELECT id FROM notebooks ORDER BY id').all<{ id: string }>().map((r) => r.id);
      return db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT @f UNION SELECT folders.id FROM folders JOIN sub ON folders.parent_id = sub.id
           )
           SELECT n.id FROM notebooks n JOIN sub ON n.folder_id = sub.id ORDER BY n.id`,
        )
        .all<{ id: string }>({ f: folderId })
        .map((r) => r.id);
    },
    nextFolderOrd: (parentId) =>
      (db
        .prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM folders WHERE parent_id IS @p')
        .get<{ m: number }>({ p: parentId })?.m ?? -1) + 1,

    // Not an edit either: neither `updated_at` moves.
    setNotebookResearchExclude: (notebookId, exclude) =>
      void db.prepare('UPDATE notebooks SET research_exclude = @e WHERE id = @id').run({ id: notebookId, e: exclude ? 1 : 0 }),
    setFolderResearchExclude: (folderId, exclude) =>
      void db.prepare('UPDATE folders SET research_exclude = @e WHERE id = @id').run({ id: folderId, e: exclude ? 1 : 0 }),

    view(id) {
      const row = repo.get(id);
      if (!row) return null;
      const sources = repo.sources(id).map(sourceView);
      return {
        id: row.id,
        name: row.name,
        sources,
        pageCount: Math.max(virtualPageCount(sources), repo.highWater(id)),
        contextFingerprint: contextFingerprint(sources),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
  };
  return repo;
}
