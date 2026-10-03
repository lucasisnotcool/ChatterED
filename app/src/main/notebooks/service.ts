/**
 * **Notebooks: the main-process service** (`docs/research/notebooks.md` §1–§2, contract C1–C3).
 *
 * A notebook is a named set of sources. A source is a file the learner added, **copied** into the
 * managed vault (`vault/managed.ts`) at `<userData>/notebooks/<nbId>/<fileId>-<safe name>`, so
 * the original can move or vanish without breaking anything, and removing a source deletes the
 * copy and never the original.
 *
 * ## Adding a source, and reading it
 *
 * `addSources` does only what has to happen before it returns: check the file (kind, size, not a
 * duplicate of a source already here), copy it, and write its `files` and `notebook_sources`
 * rows with status `reading`. Everything slow — converting a Word file with `textutil`, opening
 * a PDF with pdf.js, cutting a text into pages — runs afterwards on one background queue, one
 * source at a time, and each step is pushed on `notebook:changed`.
 *
 * **A source's `page_base` is fixed when it becomes `ready`, not when it is added.** Its page
 * count is not known until it has been read, and three files dropped together would otherwise
 * all start at the same base. The queue is FIFO, so bases still follow the order the sources
 * were added; a `reading` source holds a provisional base that nothing may cite (it has no pages
 * yet), and a `failed` one never takes any. The base is `nextPageBase` over every source present
 * and the persisted high-water mark (`repo.ts` says why that is a settings row), written in the
 * same transaction that writes the source's FTS rows and marks it `ready`.
 *
 * **The FTS rows are written here, one per notebook page**, rather than by the folder vault's
 * background indexer: that indexer stores a text file as one page-less chunk, and a notebook's
 * text source has pages (`shared/paginate.ts`). A PDF's rows are its pages, as the indexer would
 * write them. `files.sha256` is the sha of the **bytes the learner added** — for a Word file the
 * `.docx`, not the converted text — set at add time so a duplicate can be refused before anything
 * is copied, and kept through the read.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { copyFile, readFile, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, join, resolve, sep } from 'node:path';
import type { SqlDatabase } from '../db/driver.js';
import { objectivesRepo } from '../db/repos/objectives.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import type { ConfirmRequest } from '../dochost.js';
import { log } from '../log.js';
import { extractFile, NO_TEXT_LAYER } from '../vault/extract.js';
import { createVaultRepo, newVaultId, type VaultRepo } from '../vault/repo.js';
import { MANAGED_VAULT_ID } from '../vault/managed.js';
import type { FileKind } from '../vault/kinds.js';
import { paginateText } from '../../shared/paginate.js';
import { progressFill } from '../../shared/doc/progress.js';
import type { QuizOutcome } from '../../shared/doc/types.js';
import {
  EXPORT_AS_PDF_EXTENSIONS,
  extensionOf,
  MAX_SOURCE_BYTES,
  nextPageBase,
  notebookContentKey,
  NOTEBOOK_ID_PREFIX,
  sourceKindFor,
  type AddSourcesResult,
  type NotebookChange,
  type NotebookSourceView,
  type NotebookSummary,
  type NotebookView,
  type SourceRefusal,
} from '../../shared/notebook.js';
import {
  childFolders,
  FOLDER_ID_PREFIX,
  freshFolderName,
  MAX_FOLDER_NAME_CHARS,
  moveFolderRefusal,
  type FolderView,
} from '../../shared/folders.js';
import { folderView, notebooksRepo, sourceView, type NotebooksRepo, type SourceRecord } from './repo.js';

/** Converted to text on import with macOS `textutil` (`SOURCE_EXTENSIONS` in shared/notebook.ts). */
export const CONVERT_EXTENSIONS: ReadonlySet<string> = new Set(['doc', 'docx', 'rtf']);

export const DEFAULT_NOTEBOOK_NAME = 'Untitled notebook';
const MAX_NAME_CHARS = 120;

// ── The learner-facing sentences (one place, because they are a design decision) ─────────────

export const MESSAGES = {
  exportAsPdf: "Keynote and PowerPoint files can't be read here. Export it as a PDF first.",
  exportAsPdfDocs: "Pages and OpenDocument files can't be read here. Export it as a PDF first.",
  unknownKind: (ext: string) =>
    ext
      ? `ChatterED can't read .${ext} files. Add a PDF, a Word or text file, Markdown, or an image.`
      : "ChatterED can't tell what kind of file this is. Add a PDF, a Word or text file, Markdown, or an image.",
  tooBig: 'This file is over 200 MB. Add a smaller copy, or split it into parts.',
  duplicate: 'This file is already in the notebook.',
  unreadable: "Couldn't open this file. Check it still exists and isn't a folder, then add it again.",
  pdfNoText: 'This PDF has no text to read (a scanned copy?). Export a version with selectable text, then add that.',
  pdfBroken: "Couldn't read this PDF. It may be damaged or password-protected; export a fresh copy and add that.",
  convertFailed: "Couldn't convert this document to text. Save it as a PDF from Word or Pages, then add that.",
  notText: "This file isn't text ChatterED can read. Save it as UTF-8 text or a PDF, then add that.",
  empty: 'This file has no text in it.',
  copyMissing: "ChatterED's copy of this file is missing. Remove it and add the file again.",
} as const;

export interface NotebookServiceDeps {
  db: SqlDatabase;
  /** `<userData>/notebooks`: the managed vault's root. The managed vault row must exist. */
  root: string;
  now?: () => string;
  /** Pushed on every change to a notebook or one of its sources (`notebook:changed`). */
  onChanged?: (change: NotebookChange) => void;
  /** The native confirm sheet (`DocHost.confirm`). Absent ⟹ destructive actions are refused. */
  confirm?: (input: ConfirmRequest) => Promise<boolean>;
  /** After a notebook is deleted: the app retires its room. */
  onDeleted?: (notebookId: string) => void;
  /** `textutil -convert txt`. Injectable so the tests run off macOS. */
  convertToText?: (input: string, output: string) => Promise<void>;
}

/** macOS `textutil`, via execFile: no shell, so no file name is ever interpreted. */
export function textutilConvert(input: string, output: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile('/usr/bin/textutil', ['-convert', 'txt', '-output', output, input], { timeout: 120_000 }, (err) =>
      err ? reject(err) : resolvePromise(),
    );
  });
}

/** sha256 of a file, streamed: a source can be 200 MB. */
export function hashFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/**
 * A name that is safe as one path component on macOS: no separators, no control characters, no
 * leading dot (a dotfile is hidden in Finder), and short enough to stay under the 255-byte limit
 * with the `f_<12 hex>-` prefix in front. The extension is kept, so the copy opens in Preview.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
    .replace(/[/\\:\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const base = cleaned.length > 0 ? cleaned : 'source';
  if (base.length <= 120) return base;
  const ext = extensionOf(base);
  const keep = ext ? `.${ext}` : '';
  return `${base.slice(0, 120 - keep.length)}${keep}`;
}

/** The notebook name a file gives: its name without the extension. */
export function nameFromPath(path: string): string {
  const file = basename(path);
  const ext = extensionOf(file);
  const bare = ext ? file.slice(0, -(ext.length + 1)) : file;
  return bare.trim() || DEFAULT_NOTEBOOK_NAME;
}

/** `files.kind` for a source added under this name. */
export function fileKindFor(name: string): FileKind | null {
  const ext = extensionOf(name);
  const kind = sourceKindFor(name);
  if (kind === null) return null;
  if (kind === 'pdf') return 'pdf';
  if (kind === 'image') return 'image';
  return ext === 'md' || ext === 'markdown' ? 'markdown' : 'text';
}

/** `nb_<12 hex>`, the same shape as every other id the vault mints. */
/** `fd_<12 hex>`, minted the same way as a notebook's id. */
export function newFolderId(): string {
  return newVaultId(FOLDER_ID_PREFIX.slice(0, -1));
}

export function newNotebookId(): string {
  return newVaultId(NOTEBOOK_ID_PREFIX.slice(0, -1));
}

let savepointSeq = 0;

/** A savepoint, so it nests inside a caller's transaction (the legacy import is one). */
export function inSavepoint<T>(db: SqlDatabase, fn: () => T): T {
  const sp = `nb_${(savepointSeq += 1)}`;
  db.exec(`SAVEPOINT ${sp}`);
  try {
    const out = fn();
    db.exec(`RELEASE ${sp}`);
    return out;
  } catch (err) {
    db.exec(`ROLLBACK TO ${sp}`);
    db.exec(`RELEASE ${sp}`);
    throw err;
  }
}

export interface CopiedSource {
  fileId: string;
  /** Where the bytes the learner added were copied. */
  copyPath: string;
  /** The path the `files` row names: the copy, or the `.txt` it will be converted to. */
  indexedPath: string;
}

export class NotebookService {
  readonly #db: SqlDatabase;
  readonly #repo: NotebooksRepo;
  readonly #vault: VaultRepo;
  readonly #root: string;
  readonly #now: () => string;
  readonly #onChanged: (change: NotebookChange) => void;
  readonly #confirm: ((input: ConfirmRequest) => Promise<boolean>) | null;
  readonly #onDeleted: (notebookId: string) => void;
  readonly #convert: (input: string, output: string) => Promise<void>;

  readonly #queue: string[] = [];
  #draining: Promise<void> | null = null;
  #stopped = false;

  constructor(deps: NotebookServiceDeps) {
    this.#db = deps.db;
    this.#repo = notebooksRepo(deps.db);
    this.#vault = createVaultRepo(deps.db);
    this.#root = resolve(deps.root);
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#onChanged = deps.onChanged ?? (() => undefined);
    this.#confirm = deps.confirm ?? null;
    this.#onDeleted = deps.onDeleted ?? (() => undefined);
    this.#convert = deps.convertToText ?? textutilConvert;
  }

  get repo(): NotebooksRepo {
    return this.#repo;
  }

  get root(): string {
    return this.#root;
  }

  /** The absolute path of a managed `files` row, checked to stay under the notebook root. */
  absPath(relPath: string): string {
    const abs = join(this.#root, ...relPath.split('/'));
    if (!abs.startsWith(this.#root + sep)) throw new Error('That source is outside the notebook storage.');
    return abs;
  }

  #dirOf(notebookId: string): string {
    if (!/^nb_[A-Za-z0-9]+$/.test(notebookId)) throw new Error('Not a notebook id.');
    return join(this.#root, notebookId);
  }

  // ── Reading the list and one notebook ─────────────────────────────────────────────────────

  get(notebookId: string): NotebookView | null {
    return this.#repo.view(notebookId);
  }

  #require(notebookId: string): NotebookView {
    const view = this.#repo.view(notebookId);
    if (!view) throw new Error('That notebook no longer exists.');
    return view;
  }

  /** The Notebooks home: every notebook, most recently opened first. */
  list(): NotebookSummary[] {
    return this.#repo.list().map((row) => {
      const sources = this.#repo.sources(row.id);
      const key = notebookContentKey(row.id);
      const doc = this.#db
        .prepare('SELECT title, updated_at FROM notes_docs WHERE content_sha = @k')
        .get<{ title: string; updated_at: string }>({ k: key });
      const title = doc?.title.trim() ?? '';
      return {
        id: row.id,
        name: row.name,
        sourceCount: sources.length,
        enabledCount: sources.filter((s) => s.enabled === 1).length,
        subtitle: title.length > 0 ? title : null,
        fill: this.#fill(row.id),
        // "Last edited" is the notebook's or its doc's, whichever moved last.
        updatedAt: doc && doc.updated_at > row.updated_at ? doc.updated_at : row.updated_at,
        openedAt: row.opened_at,
        folderId: row.folder_id ?? null,
      };
    });
  }

  /**
   * The own-words fill on a home card: the same number as the bar (`docroom/progress.ts`), from
   * the same two inputs — the tree's counted objectives and `progressFill` over the outcomes for
   * the notebook's content key. Null before there is a ready tree with something to count.
   */
  #fill(notebookId: string): number | null {
    try {
      const tree = objectivesRepo(this.#db).tree(notebookId);
      if (!tree || tree.status !== 'ready') return null;
      const counted = tree.objectives.filter((o) => !o.assumedByDeck);
      if (counted.length === 0) return null;
      const byObjective = new Map<string, QuizOutcome[]>();
      for (const outcome of outcomesRepo(this.#db).forContent(notebookContentKey(notebookId))) {
        if (!outcome.objectiveId) continue;
        byObjective.set(outcome.objectiveId, [...(byObjective.get(outcome.objectiveId) ?? []), outcome]);
      }
      const sum = counted.reduce((acc, o) => acc + progressFill(byObjective.get(o.id) ?? []), 0);
      return sum / counted.length;
    } catch {
      return null;
    }
  }

  // ── Making, naming, opening, deleting ─────────────────────────────────────────────────────

  /**
   * A new notebook. With `paths`, they are its first sources and the name defaults to the first
   * file's name without its extension; with none it is "Untitled notebook".
   */
  async create(input: { name?: string | null; paths?: string[]; folderId?: string | null }): Promise<AddSourcesResult> {
    const paths = input.paths ?? [];
    const typed = (input.name ?? '').trim();
    const name = (typed || (paths[0] ? nameFromPath(paths[0]) : DEFAULT_NOTEBOOK_NAME)).slice(0, MAX_NAME_CHARS);
    // Made in the folder the learner is looking at; a folder deleted meanwhile means the top level.
    const folderId = input.folderId && this.#repo.folder(input.folderId) ? input.folderId : null;
    const id = this.createRow({ name, folderId });
    log().info('notebook.created', { notebook_id: id, paths: paths.length });
    if (paths.length > 0) return this.addSources(id, paths);
    this.#emit(id);
    return { notebook: this.#require(id), added: [], refused: [] };
  }

  /** The row alone. Exposed for the legacy import, which supplies its own name and stamps. */
  createRow(input: { id?: string; name: string; legacyFileId?: string | null; updatedAt?: string; folderId?: string | null }): string {
    const id = input.id ?? newNotebookId();
    const now = this.#now();
    this.#repo.insert({
      id,
      name: input.name,
      created_at: now,
      updated_at: input.updatedAt ?? now,
      opened_at: null,
      legacy_file_id: input.legacyFileId ?? null,
      folder_id: input.folderId ?? null,
    });
    return id;
  }

  rename(notebookId: string, name: string): NotebookView {
    this.#require(notebookId);
    const trimmed = name.trim().slice(0, MAX_NAME_CHARS);
    if (trimmed.length === 0) throw new Error('A notebook needs a name.');
    this.#repo.rename(notebookId, trimmed, this.#now());
    return this.#emit(notebookId)!;
  }

  /** Stamps `opened_at`, which orders the home grid. */
  open(notebookId: string): NotebookView {
    this.#require(notebookId);
    this.#repo.markOpened(notebookId, this.#now());
    return this.#require(notebookId);
  }

  /**
   * Delete a notebook, after the native confirm. Its copies and its rows go — the notebook, its
   * sources, their `files` and FTS rows, the high-water mark — and the originals are never
   * touched. The notes doc, the room and the outcomes are **kept** as the record, the way
   * `retireFlowRoom` keeps a reset room's rows; nothing can open them again.
   */
  async delete(notebookId: string): Promise<{ deleted: boolean }> {
    const view = this.#repo.view(notebookId);
    if (!view) return { deleted: false };
    const ok = await this.#ask({
      message: `Delete “${view.name}”?`,
      detail:
        "ChatterED's copies of its sources are deleted, and its notes and chat can't be opened again. " +
        'The original files on your Mac are not touched.',
      confirmLabel: 'Delete Notebook',
    });
    if (!ok) return { deleted: false };
    inSavepoint(this.#db, () => {
      for (const s of view.sources) this.#deleteFileRows(s.fileId);
      this.#repo.remove(notebookId);
      this.#repo.clearHighWater(notebookId);
    });
    rmSync(this.#dirOf(notebookId), { recursive: true, force: true });
    log().info('notebook.deleted', { notebook_id: notebookId, sources: view.sources.length });
    this.#onDeleted(notebookId);
    this.#onChanged({ notebookId, view: null });
    return { deleted: true };
  }

  // ── Folders (`docs/research/search.md` §1) ────────────────────────────────────────────────

  folders(): FolderView[] {
    return this.#repo.folders().map(folderView);
  }

  #requireFolder(folderId: string): FolderView {
    const row = this.#repo.folder(folderId);
    if (!row) throw new Error('That folder no longer exists.');
    return folderView(row);
  }

  #parentOrTop(parentId: string | null | undefined): string | null {
    if (!parentId) return null;
    this.#requireFolder(parentId);
    return parentId;
  }

  /** A new folder at the end of its siblings, named so it does not clash with one of them. */
  createFolder(input: { name?: string | null; parentId?: string | null }): FolderView {
    const parentId = this.#parentOrTop(input.parentId);
    const siblings = childFolders(this.folders(), parentId);
    const typed = (input.name ?? '').trim().slice(0, MAX_FOLDER_NAME_CHARS);
    const now = this.#now();
    const id = newFolderId();
    this.#repo.insertFolder({
      id,
      parent_id: parentId,
      name: typed || freshFolderName(siblings),
      ord: this.#repo.nextFolderOrd(parentId),
      created_at: now,
      updated_at: now,
    });
    log().info('folder.created', { folder_id: id });
    return this.#requireFolder(id);
  }

  renameFolder(folderId: string, name: string): FolderView {
    this.#requireFolder(folderId);
    const trimmed = name.trim().slice(0, MAX_FOLDER_NAME_CHARS);
    if (trimmed.length === 0) throw new Error('A folder needs a name.');
    this.#repo.renameFolder(folderId, trimmed, this.#now());
    return this.#requireFolder(folderId);
  }

  /** Into another folder or to the top level. Refuses a move that would put it inside itself. */
  moveFolder(folderId: string, parentId: string | null): FolderView {
    const folder = this.#requireFolder(folderId);
    const target = this.#parentOrTop(parentId);
    if (folder.parentId === target) return folder;
    const refusal = moveFolderRefusal(this.folders(), folderId, target);
    if (refusal) throw new Error(refusal);
    this.#repo.setFolderParent(folderId, target, this.#repo.nextFolderOrd(target), this.#now());
    log().info('folder.moved', { folder_id: folderId });
    return this.#requireFolder(folderId);
  }

  /**
   * Delete a folder. Its notebooks and subfolders move up one level first, in the same
   * transaction: a folder delete never deletes a notebook, so it needs no confirmation sheet.
   */
  deleteFolder(folderId: string): { deleted: boolean; movedNotebooks: number; movedFolders: number } {
    const row = this.#repo.folder(folderId);
    if (!row) return { deleted: false, movedNotebooks: 0, movedFolders: 0 };
    const up = row.parent_id;
    const notebooks = this.#repo.notebooksIn(folderId);
    const subfolders = childFolders(this.folders(), folderId);
    inSavepoint(this.#db, () => {
      for (const id of notebooks) this.#repo.setNotebookFolder(id, up);
      const now = this.#now();
      for (const f of subfolders) this.#repo.setFolderParent(f.id, up, this.#repo.nextFolderOrd(up), now);
      this.#repo.removeFolder(folderId);
    });
    log().info('folder.deleted', { folder_id: folderId, notebooks: notebooks.length, folders: subfolders.length });
    for (const id of notebooks) this.#emit(id);
    return { deleted: true, movedNotebooks: notebooks.length, movedFolders: subfolders.length };
  }

  /** A notebook into a folder, or to the top level with null. */
  moveNotebook(notebookId: string, folderId: string | null): NotebookView {
    this.#require(notebookId);
    this.#repo.setNotebookFolder(notebookId, this.#parentOrTop(folderId));
    log().info('notebook.moved', { notebook_id: notebookId });
    return this.#emit(notebookId)!;
  }

  /** The notebooks search covers from `folderId`: it and every folder under it (null: all). */
  scopeNotebookIds(folderId: string | null): string[] {
    if (folderId !== null && !this.#repo.folder(folderId)) return [];
    return this.#repo.subtreeNotebookIds(folderId);
  }

  // ── Sources ───────────────────────────────────────────────────────────────────────────────

  /**
   * Copy files into the notebook (`notebooks.md` §1). Returns as soon as the copies exist; each
   * is then read in the background (`reading` → `ready` | `failed`), every step pushed.
   */
  async addSources(notebookId: string, paths: string[]): Promise<AddSourcesResult> {
    this.#require(notebookId);
    const added: NotebookSourceView[] = [];
    const refused: SourceRefusal[] = [];
    const seen = new Set(
      this.#repo
        .sources(notebookId)
        .map((s) => s.sha256)
        .filter((s): s is string => s !== null),
    );

    for (const path of paths) {
      const name = basename(path);
      const refuse = (reason: SourceRefusal['reason'], message: string) => refused.push({ name, reason, message });
      const ext = extensionOf(name);
      if (EXPORT_AS_PDF_EXTENSIONS.includes(ext)) {
        refuse('unsupported', ext === 'pages' || ext === 'odt' ? MESSAGES.exportAsPdfDocs : MESSAGES.exportAsPdf);
        continue;
      }
      const kind = fileKindFor(name);
      if (kind === null) {
        refuse('unsupported', MESSAGES.unknownKind(ext));
        continue;
      }
      let size: number;
      try {
        const st = await stat(path);
        if (!st.isFile()) throw new Error('not a file');
        size = st.size;
      } catch {
        refuse('unreadable', MESSAGES.unreadable);
        continue;
      }
      if (size > MAX_SOURCE_BYTES) {
        refuse('too_big', MESSAGES.tooBig);
        continue;
      }
      let sha: string;
      try {
        sha = await hashFile(path);
      } catch {
        refuse('unreadable', MESSAGES.unreadable);
        continue;
      }
      if (seen.has(sha)) {
        refuse('duplicate', MESSAGES.duplicate);
        continue;
      }
      try {
        const copied = await this.#copyIn(notebookId, path, name, kind, sha, size);
        seen.add(sha);
        const record = this.#repo.source(copied.fileId);
        if (record) added.push(sourceView(record));
        this.#enqueue(copied.fileId);
      } catch (err) {
        log().warn('notebook.copy_failed', { notebook_id: notebookId, cause: (err as Error).message.slice(0, 200) });
        refuse('unreadable', MESSAGES.unreadable);
      }
    }

    if (added.length > 0) this.#repo.touch(notebookId, this.#now());
    log().info('notebook.sources_added', {
      notebook_id: notebookId,
      added: added.length,
      refused: refused.map((r) => r.reason),
    });
    const notebook = this.#emit(notebookId)!;
    return { notebook, added, refused };
  }

  async #copyIn(notebookId: string, from: string, name: string, kind: FileKind, sha: string, size: number): Promise<CopiedSource> {
    const fileId = newVaultId('f');
    const dir = this.#dirOf(notebookId);
    mkdirSync(dir, { recursive: true });
    const copyName = `${fileId}-${safeFileName(name)}`;
    const copyPath = join(dir, copyName);
    await copyFile(from, copyPath);
    try {
      const st = await stat(copyPath);
      return this.insertCopiedSource({ notebookId, fileId, name, kind, sha, size: st.size || size, mtimeMs: Math.round(st.mtimeMs), copyName });
    } catch (err) {
      await unlink(copyPath).catch(() => undefined);
      throw err;
    }
  }

  /**
   * The rows for a copy that already exists on disk: a `files` row in the managed vault and a
   * `notebook_sources` row, `reading`. A Word/RTF source's `files` row names the `.txt` it will
   * be converted to (kind `text`), with the original copy kept beside it. Shared with the legacy
   * import, which copies synchronously at boot.
   */
  insertCopiedSource(input: {
    notebookId: string;
    fileId: string;
    name: string;
    kind: FileKind;
    sha: string;
    size: number;
    mtimeMs: number;
    copyName: string;
    pageBase?: number;
  }): CopiedSource {
    const ext = extensionOf(input.name);
    const converts = CONVERT_EXTENSIONS.has(ext);
    const indexedName = converts ? `${input.copyName}.txt` : input.copyName;
    const relPath = `${input.notebookId}/${indexedName}`;
    inSavepoint(this.#db, () => {
      this.#db
        .prepare(
          `INSERT INTO files (id, vault_id, topic_id, rel_path, name, ext, kind, size, mtime_ms, sha256,
                              page_count, indexed_at, indexed_size, indexed_mtime_ms, index_error)
           VALUES (@id, @v, NULL, @rel, @name, @ext, @kind, @size, @mtime, @sha, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run({
          id: input.fileId,
          v: MANAGED_VAULT_ID,
          rel: relPath,
          name: input.name,
          ext: converts ? 'txt' : ext,
          kind: input.kind,
          size: input.size,
          mtime: input.mtimeMs,
          sha: input.sha,
        });
      const present = this.#repo.sources(input.notebookId).map(sourceView);
      this.#repo.insertSource({
        file_id: input.fileId,
        notebook_id: input.notebookId,
        display_name: input.name,
        // Provisional until the read fixes it (see the header): nothing cites a `reading` source.
        page_base: input.pageBase ?? nextPageBase(present, this.#repo.highWater(input.notebookId)),
        page_count: 0,
        enabled: 1,
        ord: this.#repo.nextOrd(input.notebookId),
        status: 'reading',
        error: null,
        added_at: this.#now(),
      });
    });
    const dir = join(this.#root, input.notebookId);
    return { fileId: input.fileId, copyPath: join(dir, input.copyName), indexedPath: join(dir, indexedName) };
  }

  /** The checkboxes, and **All** (`notebooks.md` §2). Never rewrites the overview (§2). */
  setEnabled(notebookId: string, fileIds: string[], enabled: boolean): NotebookView {
    this.#require(notebookId);
    const changed = this.#repo.setEnabled(notebookId, fileIds, enabled);
    if (changed > 0) this.#repo.touch(notebookId, this.#now());
    return this.#emit(notebookId)!;
  }

  /**
   * Remove one source, after the native confirm: its copy (and a Word file's converted text), its
   * `files` row and its FTS rows. Its pages become a gap; nothing else is renumbered.
   */
  async removeSource(notebookId: string, fileId: string): Promise<{ removed: boolean; notebook: NotebookView }> {
    const view = this.#require(notebookId);
    const source = view.sources.find((s) => s.fileId === fileId);
    if (!source) return { removed: false, notebook: view };
    const ok = await this.#ask({
      message: `Remove “${source.name}” from this notebook?`,
      detail:
        "ChatterED's copy is deleted; your original file is not touched. Notes that cite it keep their " +
        'text, and their citations say the source was removed.',
      confirmLabel: 'Remove Source',
    });
    if (!ok) return { removed: false, notebook: this.#require(notebookId) };
    const record = this.#repo.source(fileId);
    inSavepoint(this.#db, () => {
      // A ready source's pages stay used: lift the mark to cover them before the row goes.
      if (source.status === 'ready' && source.pageCount > 0) {
        const end = source.pageBase + source.pageCount;
        if (end > this.#repo.highWater(notebookId)) this.#repo.setHighWater(notebookId, end, this.#now());
      }
      this.#deleteFileRows(fileId);
      this.#repo.removeSource(fileId);
      this.#repo.touch(notebookId, this.#now());
    });
    this.#deleteCopies(notebookId, fileId, record?.rel_path ?? null);
    log().info('notebook.source_removed', { notebook_id: notebookId, file_id: fileId, kind: source.kind });
    return { removed: true, notebook: this.#emit(notebookId)! };
  }

  #deleteFileRows(fileId: string): void {
    this.#db.prepare('DELETE FROM file_text WHERE file_id = @f').run({ f: fileId });
    this.#db.prepare('DELETE FROM files WHERE id = @f AND vault_id = @v').run({ f: fileId, v: MANAGED_VAULT_ID });
  }

  /** Every file in the notebook's folder that belongs to this source: `<fileId>-…`. */
  #deleteCopies(notebookId: string, fileId: string, relPath: string | null): void {
    const dir = this.#dirOf(notebookId);
    const paths = new Set<string>();
    if (relPath) {
      const indexed = this.absPath(relPath);
      paths.add(indexed);
      if (indexed.endsWith('.txt')) paths.add(indexed.slice(0, -4));
    }
    try {
      for (const entry of existsSync(dir) ? readdirSync(dir) : []) {
        if (entry.startsWith(`${fileId}-`)) paths.add(join(dir, entry));
      }
    } catch {
      /* the folder is gone already */
    }
    for (const p of paths) rmSync(p, { force: true });
  }

  async #ask(input: ConfirmRequest): Promise<boolean> {
    if (!this.#confirm) return false;
    return this.#confirm(input);
  }

  #emit(notebookId: string): NotebookView | null {
    const view = this.#repo.view(notebookId);
    this.#onChanged({ notebookId, view });
    return view;
  }

  // ── The read queue ────────────────────────────────────────────────────────────────────────

  /** Re-queue every source left `reading` (an app quit mid-read; the legacy import). */
  resumeReading(): void {
    for (const s of this.#repo.reading()) this.#enqueue(s.file_id);
  }

  /** Resolves when the queue is empty. The tests wait on it; the app never does. */
  async whenIdle(): Promise<void> {
    while (this.#draining) await this.#draining;
  }

  dispose(): void {
    this.#stopped = true;
  }

  #enqueue(fileId: string): void {
    if (this.#queue.includes(fileId)) return;
    this.#queue.push(fileId);
    if (this.#draining) return;
    this.#draining = (async () => {
      try {
        for (;;) {
          if (this.#stopped) return;
          const next = this.#queue.shift();
          if (!next) return;
          await this.#read(next);
          // Yield, so a drop of twenty PDFs does not hold the main process through twenty reads.
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        this.#draining = null;
      }
    })();
  }

  async #read(fileId: string): Promise<void> {
    const source = this.#repo.source(fileId);
    if (!source || source.status !== 'reading' || source.rel_path === null) return;
    const started = Date.now();
    let outcome: { pageCount: number; chunks: { page: number; body: string }[] } | { error: string };
    try {
      outcome = await this.#extract(source);
    } catch (err) {
      outcome = { error: MESSAGES.unreadable };
      log().warn('notebook.read_threw', { file_id: fileId, cause: (err as Error).message.slice(0, 200) });
    }

    // Removed while it was being read: nothing to write.
    const still = this.#repo.source(fileId);
    if (!still || still.status !== 'reading') return;

    if ('error' in outcome) {
      this.#repo.updateSource(fileId, { status: 'failed', error: outcome.error, page_count: 0 });
      log().info('notebook.source_failed', { file_id: fileId, notebook_id: source.notebook_id, reason: outcome.error });
      this.#emit(source.notebook_id);
      return;
    }

    const { pageCount, chunks } = outcome;
    let base = 0;
    try {
      const abs = this.absPath(source.rel_path);
      const st = await stat(abs);
      inSavepoint(this.#db, () => {
        const others = this.#repo
          .sources(source.notebook_id)
          .filter((s) => s.file_id !== fileId && s.status === 'ready')
          .map(sourceView);
        base = nextPageBase(others, this.#repo.highWater(source.notebook_id));
        this.#repo.updateSource(fileId, { status: 'ready', error: null, page_base: base, page_count: pageCount });
        this.#vault.text.replace(fileId, source.display_name, chunks);
        this.#vault.files.markIndexed(fileId, {
          at: this.#now(),
          size: st.size,
          mtimeMs: Math.round(st.mtimeMs),
          pageCount,
          sha256: source.sha256,
        });
        this.#repo.setHighWater(source.notebook_id, base + pageCount, this.#now());
      });
    } catch (err) {
      this.#repo.updateSource(fileId, { status: 'failed', error: MESSAGES.copyMissing, page_count: 0 });
      log().warn('notebook.commit_failed', { file_id: fileId, cause: (err as Error).message.slice(0, 200) });
      this.#emit(source.notebook_id);
      return;
    }
    log().info('notebook.source_ready', {
      file_id: fileId,
      notebook_id: source.notebook_id,
      kind: source.file_kind,
      pages: pageCount,
      page_base: base,
      ms: Date.now() - started,
    });
    this.#emit(source.notebook_id);
  }

  /** The slow half: convert, open, count, cut into pages. Never writes the database. */
  async #extract(
    source: SourceRecord,
  ): Promise<{ pageCount: number; chunks: { page: number; body: string }[] } | { error: string }> {
    const abs = this.absPath(source.rel_path!);
    const ext = extensionOf(source.display_name);
    if (CONVERT_EXTENSIONS.has(ext)) {
      const original = abs.endsWith('.txt') ? abs.slice(0, -4) : abs;
      if (!existsSync(original)) return { error: MESSAGES.copyMissing };
      try {
        await this.#convert(original, abs);
      } catch (err) {
        log().warn('notebook.convert_failed', { file_id: source.file_id, cause: (err as Error).message.slice(0, 200) });
        return { error: MESSAGES.convertFailed };
      }
    }
    if (!existsSync(abs)) return { error: MESSAGES.copyMissing };

    if (source.file_kind === 'image') return { pageCount: 1, chunks: [] };

    if (source.file_kind === 'pdf') {
      try {
        const result = await extractFile(abs, 'pdf', { maxBytes: MAX_SOURCE_BYTES });
        return {
          pageCount: result.pageCount ?? 0,
          chunks: result.chunks.filter((c): c is { page: number; body: string } => c.page !== null),
        };
      } catch (err) {
        if ((err as Error).message === NO_TEXT_LAYER) return { error: MESSAGES.pdfNoText };
        log().warn('notebook.pdf_failed', { file_id: source.file_id, cause: (err as Error).message.slice(0, 200) });
        return { error: MESSAGES.pdfBroken };
      }
    }

    // Text: Markdown, plain text, or a Word/RTF file's converted text.
    const bytes = await readFile(abs);
    const text = bytes.toString('utf8');
    if (text.includes('�')) return { error: MESSAGES.notText };
    const pages = paginateText(text);
    if (pages.length === 0) return { error: MESSAGES.empty };
    return { pageCount: pages.length, chunks: pages.map((body, i) => ({ page: i + 1, body })) };
  }
}

