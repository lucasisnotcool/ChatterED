/**
 * **The headless Duplicate** — `scripts/duplicate-folder.mjs` bundles this file and runs it under
 * plain Node, with the app quit, against a database path. It runs the app's own code: the same
 * migrations, the same `duplicate.ts`, the same driver (its Node-ABI build).
 *
 *   node scripts/duplicate-folder.mjs --db <app.db> --folder fd_… [--name "…"] [--exclude-research]
 *   node scripts/duplicate-folder.mjs --db <app.db> --notebook nb_… [--name "…"]
 *
 * In order, it:
 *
 *  1. refuses while the app has the database open (Chromium's `SingletonLock` beside it names a
 *     live process), unless `--force`;
 *  2. backs the database up with `VACUUM INTO <dir>/backups/before-duplicate-<time>.db`, unless
 *     `--no-backup` (nothing is pruned: the app's own `app-before-v…` backups are left alone);
 *  3. brings the schema up to date with the app's migrations, and adds migration 032's columns and
 *     034's table if a later migration already ran without them (`ensureResearchExcludeColumns`);
 *  4. duplicates, then checks the copy against the original (`verifyDuplicate`), and prints one
 *     JSON object: the new folder id, each new notebook id with its old → new doc and file ids,
 *     what was copied on disk, and every check. Exit code 1 if any check failed.
 *
 * `--exclude-research` is the default for a duplicate; `--include-research` turns it off.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openNodeDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { ensureResearchExcludeColumns, excludedNotebookIds } from '../research/exclude.js';
import { MANAGED_VAULT_ID } from '../vault/managed.js';
import { duplicateFolder, duplicateNotebook, verifyDuplicate, type DuplicatedNotebook, type DuplicateCheck } from './duplicate.js';

export interface CliArgs {
  db: string;
  folder: string | null;
  notebook: string | null;
  name: string | null;
  researchExclude: boolean;
  root: string | null;
  backup: boolean;
  force: boolean;
}

export const USAGE = `usage: node scripts/duplicate-folder.mjs --db <path to app.db> (--folder fd_… | --notebook nb_…)
         [--name "<new name>"] [--exclude-research | --include-research] [--root <notebooks dir>]
         [--no-backup] [--force]`;

export function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { db: '', folder: null, notebook: null, name: null, researchExclude: true, root: null, backup: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value.\n${USAGE}`);
      return v;
    };
    if (a === '--db') out.db = value();
    else if (a === '--folder') out.folder = value();
    else if (a === '--notebook') out.notebook = value();
    else if (a === '--name') out.name = value();
    else if (a === '--root') out.root = value();
    else if (a === '--exclude-research') out.researchExclude = true;
    else if (a === '--include-research') out.researchExclude = false;
    else if (a === '--no-backup') out.backup = false;
    else if (a === '--force') out.force = true;
    else throw new Error(`Unknown argument ${a}.\n${USAGE}`);
  }
  if (!out.db) throw new Error(`--db is required.\n${USAGE}`);
  if ((out.folder === null) === (out.notebook === null)) throw new Error(`Give exactly one of --folder and --notebook.\n${USAGE}`);
  return out;
}

/** The pid in Chromium's `SingletonLock` (a symlink to `<host>-<pid>`) when that process is alive. */
export function liveAppPid(dbPath: string): number | null {
  const lock = join(dirname(dbPath), 'SingletonLock');
  try {
    if (!lstatSync(lock).isSymbolicLink()) return null;
    const pid = Number(/-(\d+)$/.exec(readlinkSync(lock))?.[1]);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function userVersion(db: SqlDatabase): number {
  return db.prepare('PRAGMA user_version').get<{ user_version: number }>()?.user_version ?? 0;
}

export interface CliResult {
  db: string;
  root: string;
  backup: string | null;
  schema: { from: number; to: number; addedColumns: string[] };
  folder: { from: string; id: string; name: string; parentId: string | null; researchExclude: boolean; folders: Record<string, string> } | null;
  notebooks: {
    from: string;
    id: string;
    name: string;
    folderId: string | null;
    /** Its own mark. */
    researchExclude: boolean;
    /** Left out of research exports, by its own mark or a folder's: what the export will do. */
    researchExcluded: boolean;
    docs: Record<string, string>;
    files: Record<string, string>;
    copiedOnDisk: string[];
    missingOnDisk: string[];
    bytes: number;
  }[];
  checks: { passed: number; failed: DuplicateCheck[]; all: DuplicateCheck[] };
  ok: boolean;
}

export function runDuplicateCli(argv: readonly string[], opts: { migrationsDir: string; now?: () => Date }): CliResult {
  const args = parseArgs(argv);
  const dbPath = resolve(args.db);
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);
  const pid = args.force ? null : liveAppPid(dbPath);
  if (pid !== null) {
    throw new Error(`ChatterED (pid ${pid}) has this database open. Quit the app first, or pass --force if that lock is stale.`);
  }
  const now = opts.now ?? (() => new Date());
  const db = openNodeDatabase(dbPath);
  try {
    let backup: string | null = null;
    if (args.backup) {
      const dir = join(dirname(dbPath), 'backups');
      mkdirSync(dir, { recursive: true });
      backup = join(dir, `before-duplicate-${now().toISOString().replace(/[:.]/g, '-')}.db`);
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    }
    const from = userVersion(db);
    const to = runMigrations(db, opts.migrationsDir);
    const addedColumns = ensureResearchExcludeColumns(db);

    // `<db dir>/notebooks` before the vault row's path: the app keeps them together, and a copy of
    // the database elsewhere must never write into the live app's folder by default.
    const beside = join(dirname(dbPath), 'notebooks');
    const vaultRoot = db.prepare('SELECT root_path FROM vaults WHERE id = @id').get<{ root_path: string }>({ id: MANAGED_VAULT_ID })?.root_path;
    const root = resolve(args.root ?? (existsSync(beside) ? beside : (vaultRoot ?? beside)));
    if (!existsSync(root)) throw new Error(`The notebooks folder ${root} does not exist. Pass --root.`);
    const deps = { db, root, now: () => now().toISOString() };

    let folder: CliResult['folder'] = null;
    let copies: DuplicatedNotebook[];
    if (args.folder) {
      const out = duplicateFolder(deps, { folderId: args.folder, name: args.name, researchExclude: args.researchExclude });
      folder = { from: out.from, id: out.to, name: out.name, parentId: out.parentId, researchExclude: out.researchExclude, folders: out.folders };
      copies = out.notebooks;
    } else {
      copies = [duplicateNotebook(deps, { notebookId: args.notebook!, name: args.name, researchExclude: args.researchExclude })];
    }
    const all = copies.flatMap((c) => verifyDuplicate(deps, c));
    const failed = all.filter((c) => !c.ok);
    const excluded = new Set(excludedNotebookIds(db));
    return {
      db: dbPath,
      root,
      backup,
      schema: { from, to, addedColumns },
      folder,
      notebooks: copies.map((c) => ({
        from: c.from,
        id: c.to,
        name: c.name,
        folderId: c.folderId,
        researchExclude: c.researchExclude,
        researchExcluded: excluded.has(c.to),
        docs: c.docs,
        files: c.files,
        copiedOnDisk: c.copied,
        missingOnDisk: c.missing,
        bytes: c.bytes,
      })),
      checks: { passed: all.length - failed.length, failed, all },
      ok: failed.length === 0,
    };
  } finally {
    db.close();
  }
}
