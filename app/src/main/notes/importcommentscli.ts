/**
 * **The headless explain-comment import** — `scripts/import-comments.mjs` bundles this file and runs
 * it under plain Node, with the app quit, against a database path. It runs the app's own code: the
 * same migrations, the same `importComments` (`db/repos/comments.ts`), the same driver (its
 * Node-ABI build), exactly as the headless Duplicate does (`notebooks/duplicatecli.ts`).
 *
 *   node scripts/import-comments.mjs --db <app.db> --in <comments.jsonl> [--dry-run] [--no-backup] [--force]
 *
 * In order, it:
 *
 *  1. refuses while the app has the database open (Chromium's `SingletonLock` beside it names a
 *     live process), unless `--force`;
 *  2. backs the database up with `VACUUM INTO <dir>/backups/before-import-comments-<time>.db`,
 *     unless `--no-backup`;
 *  3. brings the schema up to date with the app's migrations (033 makes `block_comments`), plus the
 *     safety net for 032's columns and 034's table (`ensureResearchExcludeColumns`), so a database
 *     an older build left at 032 needs no "open the new build once first";
 *  4. imports: a line whose doc or block does not exist is skipped and reported; the rest are
 *     upserted on (doc_id, block_id, 'explain') in one transaction.
 *
 * `--dry-run` writes nothing to the database: no backup, and the migrations and the import run on a
 * temporary snapshot (`VACUUM INTO`), removed afterwards, so the counts are the real ones.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openNodeDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { importComments, parseJsonl, type ImportReport } from '../db/repos/comments.js';
import { liveAppPid } from '../notebooks/duplicatecli.js';
import { ensureResearchExcludeColumns } from '../research/exclude.js';

export interface ImportCliArgs {
  db: string;
  in: string;
  dryRun: boolean;
  backup: boolean;
  force: boolean;
}

export const IMPORT_USAGE = `usage: node scripts/import-comments.mjs --db <path to app.db> --in <comments.jsonl>
         [--dry-run] [--no-backup] [--force]`;

export function parseImportArgs(argv: readonly string[]): ImportCliArgs {
  const out: ImportCliArgs = { db: '', in: '', dryRun: false, backup: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value.\n${IMPORT_USAGE}`);
      return v;
    };
    if (a === '--db') out.db = value();
    else if (a === '--in') out.in = value();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-backup') out.backup = false;
    else if (a === '--force') out.force = true;
    else throw new Error(`Unknown argument ${a}.\n${IMPORT_USAGE}`);
  }
  if (!out.db || !out.in) throw new Error(`--db and --in are required.\n${IMPORT_USAGE}`);
  return out;
}

function userVersion(db: SqlDatabase): number {
  return db.prepare('PRAGMA user_version').get<{ user_version: number }>()?.user_version ?? 0;
}

const quoted = (path: string) => `'${path.replace(/'/g, "''")}'`;

export interface ImportCliResult {
  db: string;
  dryRun: boolean;
  backup: string | null;
  schema: { from: number; to: number; added: string[] };
  report: ImportReport;
}

export function runImportCommentsCli(argv: readonly string[], opts: { migrationsDir: string; now?: () => Date }): ImportCliResult {
  const args = parseImportArgs(argv);
  const dbPath = resolve(args.db);
  const inPath = resolve(args.in);
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);
  if (!existsSync(inPath)) throw new Error(`No file at ${inPath}.`);
  const pid = args.force ? null : liveAppPid(dbPath);
  if (pid !== null) {
    throw new Error(`ChatterED (pid ${pid}) has this database open. Quit the app first, or pass --force if that lock is stale.`);
  }
  const lines = parseJsonl(readFileSync(inPath, 'utf8'));
  const now = opts.now ?? (() => new Date());

  const live = openNodeDatabase(dbPath);
  let scratch: string | null = null;
  let db = live;
  try {
    let backup: string | null = null;
    if (args.dryRun) {
      scratch = mkdtempSync(join(tmpdir(), 'chattered-import-dry-'));
      const copy = join(scratch, 'app.db');
      live.exec(`VACUUM INTO ${quoted(copy)}`);
      db = openNodeDatabase(copy);
    } else if (args.backup) {
      const dir = join(dirname(dbPath), 'backups');
      mkdirSync(dir, { recursive: true });
      backup = join(dir, `before-import-comments-${now().toISOString().replace(/[:.]/g, '-')}.db`);
      live.exec(`VACUUM INTO ${quoted(backup)}`);
    }
    const from = userVersion(db);
    const to = runMigrations(db, opts.migrationsDir);
    const added = ensureResearchExcludeColumns(db);
    const report = importComments(db, lines, { now: now().toISOString(), dryRun: args.dryRun });
    return { db: dbPath, dryRun: args.dryRun, backup, schema: { from, to, added }, report };
  } finally {
    if (db !== live) db.close();
    live.close();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
