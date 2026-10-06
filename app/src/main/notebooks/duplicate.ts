/**
 * **Duplicate a folder or a notebook** (2026-10-07): a deep copy that opens, renders and searches
 * exactly like the original, with none of its conversation.
 *
 * Plain Node — no Electron, no logging, no pdf.js — so the app (`NotebookService`) and the
 * headless CLI (`scripts/duplicate-folder.mjs`) run this same file.
 *
 * ## What is copied, and how
 *
 * A folder is copied as a new sibling ("<name> (copy)" or a given name) with its whole subtree:
 * every subfolder and every notebook in it. A notebook is copied with new ids throughout:
 *
 *   on disk      every managed copy of each source (`<root>/<nb>/<fileId>-…`, a Word file's
 *                converted `.txt` included) into `<root>/<new nb>/<new fileId>-…`. `files.id` is
 *                `notebook_sources`' PRIMARY KEY, so a source cannot be shared between notebooks;
 *                the copy is an APFS clone where the volume allows it (no extra space until
 *                one side changes), a plain copy elsewhere.
 *   rows         `notebooks`; `files` (same sha, page count and index stamps, new `rel_path`);
 *                the FTS rows of `file_text`, page by page; `notebook_sources` (role, ord, base,
 *                status; a solutions sheet's `key_for` points at the copied tutorial); the page
 *                high-water mark; `notes_docs` (new id and content key; `doc_json`, `version`,
 *                `learner_touched`, `overview_json` kept, the overview's source fingerprint
 *                re-pointed at the new file ids); `notes_slide_groups`, `notes_objective_blocks`,
 *                `tutorial_parts` and the stored explain comments (`block_comments`) per doc;
 *                the objective tree with its cards (`learning_trees`); the search index
 *                (`search_chunks` with their vectors, and `search_state`), so search works at once
 *                without re-embedding.
 *   shared       everything keyed on the **bytes** of a source rather than on its id: rendered
 *                page images under `<userData>/notes-pages/<sha>/`, the page-geometry cache and
 *                `file_segmentations`. The copy has the same bytes, so it finds them.
 *   not copied   the chat and its record: materials, rooms, messages, private threads, notes
 *                threads, doc edits and suggestions, turn decisions, events; and the progress
 *                that came from them (quiz outcomes, objective states and activity), and usage.
 *                The copy starts with a fresh conversation and an empty progress bar.
 *
 * Every id inside a copied value (the notebook's, a source's, a doc's) is rewritten to its copy's:
 * ids are minted `<prefix>_<12 hex>`, so a plain substring swap cannot touch anything else.
 *
 * The rows go in one transaction; the files are copied first and removed again if it fails.
 */
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { SqlDatabase } from '../db/driver.js';

export const COPY_SUFFIX = ' (copy)';
const MAX_NAME_CHARS = 120;

export interface DuplicateDeps {
  db: SqlDatabase;
  /** `<userData>/notebooks`: the managed vault's root. */
  root: string;
  now?: () => string;
}

export interface DuplicatedNotebook {
  from: string;
  to: string;
  name: string;
  folderId: string | null;
  researchExclude: boolean;
  /** Old `files.id` → new. */
  files: Record<string, string>;
  /** Old `notes_docs.id` → new: the notes doc, and each tutorial's. */
  docs: Record<string, string>;
  /** Paths under the root that were copied, new side. */
  copied: string[];
  /** A source whose managed copy was not on disk: its rows are copied, its bytes cannot be. */
  missing: string[];
  bytes: number;
}

export interface DuplicatedFolder {
  from: string;
  to: string;
  name: string;
  parentId: string | null;
  researchExclude: boolean;
  /** Old folder id → new, the root included. */
  folders: Record<string, string>;
  notebooks: DuplicatedNotebook[];
}

type Row = Record<string, unknown>;

/**
 * The tables keyed on a doc that a copy carries, `doc_id` re-pointed: slide groups, objective
 * blocks, tutorial parts, and (migration 033) the blocks' stored explain comments — block ids are
 * kept in a copied `doc_json`, so each comment still lands on its block.
 */
const PER_DOC_TABLES = ['notes_slide_groups', 'notes_objective_blocks', 'tutorial_parts', 'block_comments'] as const;

function mint(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableExists(db: SqlDatabase, table: string): boolean {
  return db.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = @t`).get<{ x: number }>({ t: table }) !== undefined;
}

function columns(db: SqlDatabase, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${q(table)})`).all<{ name: string }>().map((c) => c.name));
}

/** Insert a row as it is: values pass through untouched (a BLOB stays a Buffer). */
function insertRow(db: SqlDatabase, table: string, row: Row): void {
  const cols = Object.keys(row);
  const params: Row = {};
  cols.forEach((c, i) => (params[`p${i}`] = row[c] === undefined ? null : row[c]));
  db.prepare(`INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `@p${i}`).join(', ')})`).run(params);
}

/** A function that rewrites every old id in a string to its new one. */
function remapper(map: ReadonlyMap<string, string>): (value: string) => string {
  const keys = [...map.keys()].filter((k) => k.length > 0).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return (v) => v;
  const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return (v) => v.replace(re, (m) => map.get(m) ?? m);
}

function remapRow(row: Row, remap: (v: string) => string): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' ? remap(v) : v;
  return out;
}

function trimName(name: string): string {
  return name.trim().slice(0, MAX_NAME_CHARS);
}

/** "<name> (copy)", cut so the suffix always fits. */
export function copyName(name: string): string {
  return `${name.trim().slice(0, MAX_NAME_CHARS - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

interface NotebookPlan {
  from: string;
  to: string;
  name: string;
  folderId: string | null;
  researchExclude: boolean;
  files: Map<string, string>;
  docs: Map<string, string>;
  sources: { fileId: string; relPath: string | null }[];
}

class Duplicator {
  readonly #db: SqlDatabase;
  readonly #root: string;
  readonly #now: () => string;
  readonly #hasExclude: { folders: boolean; notebooks: boolean };

  constructor(deps: DuplicateDeps) {
    this.#db = deps.db;
    this.#root = resolve(deps.root);
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#hasExclude = {
      folders: columns(this.#db, 'folders').has('research_exclude'),
      notebooks: columns(this.#db, 'notebooks').has('research_exclude'),
    };
  }

  #dirOf(notebookId: string): string {
    if (!/^nb_[A-Za-z0-9]+$/.test(notebookId)) throw new Error(`Not a notebook id: ${notebookId}`);
    return join(this.#root, notebookId);
  }

  #abs(relPath: string): string {
    const abs = join(this.#root, ...relPath.split('/'));
    if (!abs.startsWith(this.#root + sep)) throw new Error('A source is outside the notebook storage.');
    return abs;
  }

  /** Ids, sources and docs of one notebook's copy. Reads only. */
  plan(notebookId: string, name: string, folderId: string | null, researchExclude: boolean): NotebookPlan {
    const row = this.#db.prepare('SELECT id FROM notebooks WHERE id = @id').get<{ id: string }>({ id: notebookId });
    if (!row) throw new Error(`No notebook ${notebookId}.`);
    const sources = this.#db
      .prepare(
        `SELECT s.file_id AS fileId, f.rel_path AS relPath FROM notebook_sources s LEFT JOIN files f ON f.id = s.file_id
          WHERE s.notebook_id = @n ORDER BY s.ord, s.file_id`,
      )
      .all<{ fileId: string; relPath: string | null }>({ n: notebookId });
    const files = new Map(sources.map((s) => [s.fileId, mint('f')]));
    const docs = new Map(
      this.#docIds(notebookId).map((id) => [id, mint('doc')] as const),
    );
    return { from: notebookId, to: mint('nb'), name, folderId, researchExclude, files, docs, sources };
  }

  /** The notebook's notes doc (`nb:<id>`) and each tutorial's (`nb:<id>:tut:<file>`). */
  #docIds(notebookId: string): string[] {
    const key = `nb:${notebookId}`;
    return this.#db
      .prepare(
        `SELECT id FROM notes_docs WHERE content_sha = @k OR substr(content_sha, 1, length(@k) + 1) = @k || ':' ORDER BY created_at, id`,
      )
      .all<{ id: string }>({ k: key })
      .map((r) => r.id);
  }

  /** Copy every managed file of each source. Returns what to remove if the rows then fail. */
  copyFiles(plan: NotebookPlan): { copied: string[]; missing: string[]; bytes: number } {
    const fromDir = this.#dirOf(plan.from);
    const toDir = this.#dirOf(plan.to);
    mkdirSync(toDir, { recursive: true });
    const entries = existsSync(fromDir) ? readdirSync(fromDir) : [];
    const copied: string[] = [];
    const missing: string[] = [];
    let bytes = 0;
    for (const source of plan.sources) {
      const newId = plan.files.get(source.fileId)!;
      const mine = entries.filter((e) => e.startsWith(`${source.fileId}-`));
      // The indexed path is normally among them; one outside the notebook's folder is copied too.
      const extra =
        source.relPath && !source.relPath.startsWith(`${plan.from}/${source.fileId}-`) && existsSync(this.#abs(source.relPath))
          ? [source.relPath]
          : [];
      if (mine.length === 0 && extra.length === 0) {
        missing.push(source.relPath ?? source.fileId);
        continue;
      }
      for (const entry of mine) {
        const to = join(toDir, `${newId}-${entry.slice(source.fileId.length + 1)}`);
        copyFileSync(join(fromDir, entry), to, constants.COPYFILE_FICLONE);
        bytes += statSync(to).size;
        copied.push(`${plan.to}/${newId}-${entry.slice(source.fileId.length + 1)}`);
      }
      for (const rel of extra) {
        const base = rel.split('/').at(-1)!;
        const to = join(toDir, `${newId}-${base}`);
        copyFileSync(this.#abs(rel), to, constants.COPYFILE_FICLONE);
        bytes += statSync(to).size;
        copied.push(`${plan.to}/${newId}-${base}`);
      }
    }
    return { copied, missing, bytes };
  }

  removeCopies(plan: NotebookPlan): void {
    rmSync(this.#dirOf(plan.to), { recursive: true, force: true });
  }

  /** The rows of one notebook's copy. Inside the caller's transaction. */
  writeRows(plan: NotebookPlan): void {
    const db = this.#db;
    const now = this.#now();
    const ids = new Map<string, string>([[plan.from, plan.to], ...plan.files, ...plan.docs]);
    const remap = remapper(ids);
    const fileIds = JSON.stringify([...plan.files.keys()]);
    const docIds = JSON.stringify([...plan.docs.keys()]);
    const copy = (table: string, where: string, params: Row, override: (row: Row) => Row = (r) => r) => {
      if (!tableExists(db, table)) return 0;
      const rows = db.prepare(`SELECT * FROM ${q(table)} WHERE ${where}`).all<Row>(params);
      for (const row of rows) insertRow(db, table, override(remapRow({ ...row }, remap)));
      return rows.length;
    };

    const nb = db.prepare('SELECT * FROM notebooks WHERE id = @id').get<Row>({ id: plan.from })!;
    const notebook: Row = {
      ...remapRow({ ...nb }, remap),
      name: plan.name,
      created_at: now,
      updated_at: now,
      opened_at: null,
      legacy_file_id: null,
      folder_id: plan.folderId,
    };
    if (this.#hasExclude.notebooks) notebook.research_exclude = plan.researchExclude ? 1 : 0;
    insertRow(db, 'notebooks', notebook);

    copy('files', `id IN (SELECT value FROM json_each(@f))`, { f: fileIds });
    // FTS5: the four columns, never the hidden rowid.
    const text = db
      .prepare(`SELECT body, name, file_id, page FROM file_text WHERE file_id IN (SELECT value FROM json_each(@f)) ORDER BY rowid`)
      .all<Row>({ f: fileIds });
    const putText = db.prepare('INSERT INTO file_text (body, name, file_id, page) VALUES (@body, @name, @file_id, @page)');
    for (const t of text) putText.run({ ...t, file_id: plan.files.get(String(t.file_id)) ?? t.file_id });
    copy('notebook_sources', 'notebook_id = @n', { n: plan.from });
    copy('settings', 'key = @k', { k: `notebook_page_hwm:${plan.from}` }, (r) => ({ ...r, updated_at: now }));

    copy('notes_docs', `id IN (SELECT value FROM json_each(@d))`, { d: docIds }, (r) => ({ ...r, created_at: now, updated_at: now }));
    for (const t of PER_DOC_TABLES) {
      copy(t, `doc_id IN (SELECT value FROM json_each(@d))`, { d: docIds });
    }
    // The objective tree and its cards: keyed on the notebook (or, for a tutorial's, on its file).
    copy('learning_trees', `file_id = @n OR file_id IN (SELECT value FROM json_each(@f))`, { n: plan.from, f: fileIds });
    copy('search_chunks', 'notebook_id = @n', { n: plan.from });
    copy('search_state', 'notebook_id = @n', { n: plan.from });
  }

  folderRow(id: string): Row | undefined {
    return this.#db.prepare('SELECT * FROM folders WHERE id = @id').get<Row>({ id });
  }

  nextFolderOrd(parentId: string | null): number {
    return (
      (this.#db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM folders WHERE parent_id IS @p').get<{ m: number }>({ p: parentId })?.m ?? -1) + 1
    );
  }

  get hasFolderExclude(): boolean {
    return this.#hasExclude.folders;
  }

  get now(): string {
    return this.#now();
  }

  get db(): SqlDatabase {
    return this.#db;
  }

  /** Run `plans`: files first, then every row in one transaction; undo the files on a failure. */
  run(plans: NotebookPlan[], extraRows: () => void): DuplicatedNotebook[] {
    const done: { plan: NotebookPlan; copied: string[]; missing: string[]; bytes: number }[] = [];
    try {
      for (const plan of plans) done.push({ plan, ...this.copyFiles(plan) });
      const sp = `dup_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      this.#db.exec(`SAVEPOINT ${sp}`);
      try {
        extraRows();
        for (const plan of plans) this.writeRows(plan);
        this.#db.exec(`RELEASE ${sp}`);
      } catch (err) {
        this.#db.exec(`ROLLBACK TO ${sp}`);
        this.#db.exec(`RELEASE ${sp}`);
        throw err;
      }
    } catch (err) {
      for (const plan of plans) this.removeCopies(plan);
      throw err;
    }
    return done.map(({ plan, copied, missing, bytes }) => ({
      from: plan.from,
      to: plan.to,
      name: plan.name,
      folderId: plan.folderId,
      researchExclude: plan.researchExclude,
      files: Object.fromEntries(plan.files),
      docs: Object.fromEntries(plan.docs),
      copied,
      missing,
      bytes,
    }));
  }
}

/**
 * Copy one notebook. Defaults: "<name> (copy)", in the same folder, **excluded from research
 * data** (a copy is made to study with, outside the trial's record, unless asked otherwise).
 */
export function duplicateNotebook(
  deps: DuplicateDeps,
  input: { notebookId: string; name?: string | null; folderId?: string | null; researchExclude?: boolean },
): DuplicatedNotebook {
  const d = new Duplicator(deps);
  const row = d.db.prepare('SELECT name, folder_id FROM notebooks WHERE id = @id').get<{ name: string; folder_id: string | null }>({
    id: input.notebookId,
  });
  if (!row) throw new Error('That notebook no longer exists.');
  const folderId = input.folderId === undefined ? (row.folder_id ?? null) : input.folderId;
  if (folderId !== null && !d.folderRow(folderId)) throw new Error('That folder no longer exists.');
  const name = trimName(input.name ?? '') || copyName(row.name);
  const plan = d.plan(input.notebookId, name, folderId, input.researchExclude ?? true);
  return d.run([plan], () => undefined)[0]!;
}

/**
 * Copy a folder and everything under it into a new sibling. Defaults: "<name> (copy)", and the new
 * folder **excluded from research data**, which covers its whole subtree. Subfolders and notebooks
 * keep their own names and their own flags.
 */
export function duplicateFolder(
  deps: DuplicateDeps,
  input: { folderId: string; name?: string | null; researchExclude?: boolean },
): DuplicatedFolder {
  const d = new Duplicator(deps);
  const root = d.folderRow(input.folderId);
  if (!root) throw new Error('That folder no longer exists.');
  const parentId = (root.parent_id as string | null) ?? null;
  const name = trimName(input.name ?? '') || copyName(String(root.name));
  const researchExclude = input.researchExclude ?? true;

  // The subtree, parents before children.
  const order: Row[] = [];
  const queue: Row[] = [root];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const f = queue.shift()!;
    if (seen.has(String(f.id))) continue;
    seen.add(String(f.id));
    order.push(f);
    queue.push(...d.db.prepare('SELECT * FROM folders WHERE parent_id = @p ORDER BY ord, name, id').all<Row>({ p: f.id }));
  }
  const folders = new Map(order.map((f) => [String(f.id), mint('fd')]));

  const plans: NotebookPlan[] = [];
  for (const f of order) {
    const nbs = d.db
      .prepare(`SELECT * FROM notebooks WHERE folder_id = @f ORDER BY COALESCE(opened_at, created_at), id`)
      .all<Row>({ f: f.id });
    for (const nb of nbs) {
      plans.push(d.plan(String(nb.id), String(nb.name), folders.get(String(f.id))!, nb.research_exclude === 1));
    }
  }

  const now = d.now;
  const ord = d.nextFolderOrd(parentId);
  const out = d.run(plans, () => {
    for (const f of order) {
      const isRoot = f.id === root.id;
      const row: Row = {
        ...f,
        id: folders.get(String(f.id))!,
        parent_id: isRoot ? parentId : folders.get(String(f.parent_id))!,
        name: isRoot ? name : f.name,
        ord: isRoot ? ord : f.ord,
        created_at: now,
        updated_at: now,
      };
      if (d.hasFolderExclude) row.research_exclude = isRoot ? (researchExclude ? 1 : 0) : (f.research_exclude ?? 0);
      insertRow(d.db, 'folders', row);
    }
  });
  return {
    from: input.folderId,
    to: folders.get(input.folderId)!,
    name,
    parentId,
    researchExclude,
    folders: Object.fromEntries(folders),
    notebooks: out,
  };
}

// ── Checking a copy against its original ─────────────────────────────────────────────────────

export interface DuplicateCheck {
  notebook: string;
  what: string;
  original: number | string;
  copy: number | string;
  ok: boolean;
}

/**
 * Compare a copied notebook with its original, row family by row family; check that the copy's
 * page text is found by the full-text index, and that every copied source's file is on disk with
 * the original's size. The CLI prints this; the tests assert it. Reads only.
 */
export function verifyDuplicate(
  deps: Pick<DuplicateDeps, 'db' | 'root'>,
  copy: Pick<DuplicatedNotebook, 'from' | 'to' | 'files' | 'docs'>,
): DuplicateCheck[] {
  const db = deps.db;
  const root = resolve(deps.root);
  const checks: DuplicateCheck[] = [];
  const n = (sql: string, params: Row) => db.prepare(sql).get<{ n: number }>(params)?.n ?? 0;
  const add = (what: string, original: number | string, copied: number | string) =>
    checks.push({ notebook: copy.to, what, original, copy: copied, ok: original === copied });
  const count = (table: string, column: string, id: string) =>
    tableExists(db, table) ? n(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q(column)} = @id`, { id }) : 0;

  add('sources', count('notebook_sources', 'notebook_id', copy.from), count('notebook_sources', 'notebook_id', copy.to));
  add('page high-water mark', count('settings', 'key', `notebook_page_hwm:${copy.from}`), count('settings', 'key', `notebook_page_hwm:${copy.to}`));
  type FileRow = { rel_path: string; size: number; sha256: string | null };
  const fileRow = (id: string) => db.prepare('SELECT rel_path, size, sha256 FROM files WHERE id = @id').get<FileRow>({ id });
  const onDisk = (rel: string) => {
    const p = join(root, ...rel.split('/'));
    return existsSync(p) ? statSync(p).size : -1;
  };
  for (const [from, to] of Object.entries(copy.files)) {
    add(`page text rows (FTS) of ${to}`, count('file_text', 'file_id', from), count('file_text', 'file_id', to));
    // Findable by the index, not only stored: one MATCH on a word of the copy's first page.
    const sample = db.prepare('SELECT body FROM file_text WHERE file_id = @f ORDER BY rowid LIMIT 1').get<{ body: string }>({ f: to });
    const word = /[A-Za-z]{5,}/.exec(sample?.body ?? '')?.[0];
    if (word) {
      const hit = n(`SELECT COUNT(*) AS n FROM file_text WHERE file_text MATCH @w AND file_id = @f`, { w: `"${word}"`, f: to }) > 0;
      add(`full-text search finds "${word}" in ${to}`, 'yes', hit ? 'yes' : 'no');
    }
    const a = fileRow(from);
    const b = fileRow(to);
    add(`files row of ${to}`, a ? 1 : 0, b ? 1 : 0);
    if (a && b) {
      add(`sha256 of ${to}`, a.sha256 ?? '', b.sha256 ?? '');
      add(`bytes on disk at ${b.rel_path}`, onDisk(a.rel_path), onDisk(b.rel_path));
    }
  }
  // What a copied value must equal: the original with every id swapped for its copy's.
  const remap = remapper(new Map<string, string>([[copy.from, copy.to], ...Object.entries(copy.files), ...Object.entries(copy.docs)]));
  for (const [from, to] of Object.entries(copy.docs)) {
    type DocRow = { version: number; learner_touched: number; doc_json: string; overview_json: string | null };
    const doc = (id: string) =>
      db.prepare('SELECT version, learner_touched, doc_json, overview_json FROM notes_docs WHERE id = @id').get<DocRow>({ id });
    const a = doc(from);
    const b = doc(to);
    add(`doc ${to}`, a ? 1 : 0, b ? 1 : 0);
    add(`doc ${to} version`, a?.version ?? -1, b?.version ?? -1);
    add(`doc ${to} learner_touched`, a?.learner_touched ?? -1, b?.learner_touched ?? -1);
    const same = (x: string | null | undefined, y: string | null | undefined) => (remap(x ?? '') === (y ?? '') ? 'same' : 'differs');
    add(`doc ${to} doc_json (${a?.doc_json.length ?? 0} chars)`, 'same', same(a?.doc_json, b?.doc_json));
    // The overview's source fingerprint names file ids: equal once they are swapped.
    add(`doc ${to} overview_json`, 'same', same(a?.overview_json, b?.overview_json));
    for (const t of PER_DOC_TABLES) {
      if (tableExists(db, t)) add(`${t} of ${to}`, count(t, 'doc_id', from), count(t, 'doc_id', to));
    }
  }
  add('objective tree', count('learning_trees', 'file_id', copy.from), count('learning_trees', 'file_id', copy.to));
  add('search chunks', count('search_chunks', 'notebook_id', copy.from), count('search_chunks', 'notebook_id', copy.to));
  return checks;
}
