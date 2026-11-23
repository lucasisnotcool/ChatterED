/**
 * **Write a notebook out as a seed, headless** — `scripts/export-notebook-seed.mjs` bundles this
 * file and runs it under plain Node, with the app quit, against a profile's database:
 *
 *   node scripts/export-notebook-seed.mjs --db <profile>/app.db --out samples/graph-traversal-seed
 *        [--notebook nb_…]
 *
 * It is how the grading copy's sample is made (`seed.ts`, `docs/STUDY-RELEASE.md` §9): open a
 * fresh grading copy on a scratch profile, press *Try the sample tutorial*, wait until the sheet
 * is in, quit, then run this. The profile is only read. With one notebook in the profile,
 * `--notebook` can be left out. Prints one JSON object: what was written, and a count of each
 * kind of row in the seed.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openNodeDatabase } from '../db/driver.js';
import { liveAppPid } from './duplicatecli.js';
import { SEED_DB, writeNotebookSeed } from './seed.js';

export const SEED_USAGE = `usage: node scripts/export-notebook-seed.mjs --db <path to app.db> --out <seed dir> [--notebook nb_…] [--force]`;

export interface SeedCliResult {
  ok: boolean;
  out: string;
  notebook: { from: string; id: string; name: string; sources: number; missing: string[]; bytes: number };
  pages: string[];
  rows: Record<string, number>;
}

const COUNTED = ['notebooks', 'files', 'file_text', 'notebook_sources', 'notes_docs', 'notes_objective_blocks', 'notes_slide_groups', 'tutorial_parts', 'learning_trees', 'search_chunks', 'search_state'] as const;

export function runSeedCli(argv: readonly string[], opts: { migrationsDir: string }): SeedCliResult {
  let dbArg = '';
  let out = '';
  let notebook: string | null = null;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value.\n${SEED_USAGE}`);
      return v;
    };
    if (a === '--db') dbArg = value();
    else if (a === '--out') out = value();
    else if (a === '--notebook') notebook = value();
    else if (a === '--force') force = true;
    else throw new Error(`Unknown option ${a}.\n${SEED_USAGE}`);
  }
  if (!dbArg || !out) throw new Error(SEED_USAGE);
  const dbPath = resolve(dbArg);
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}.`);
  const pid = force ? null : liveAppPid(dbPath);
  if (pid !== null) throw new Error(`ChatterED (pid ${pid}) has this database open. Quit the app first, or pass --force if that lock is stale.`);
  const userDataDir = dirname(dbPath);
  const db = openNodeDatabase(dbPath);
  try {
    const ids = db.prepare('SELECT id FROM notebooks ORDER BY created_at, id').all<{ id: string }>().map((r) => r.id);
    const notebookId = notebook ?? (ids.length === 1 ? ids[0]! : null);
    if (!notebookId) throw new Error(`The profile has ${ids.length} notebooks. Name one with --notebook.`);
    const outDir = resolve(out);
    const written = writeNotebookSeed({
      from: { db, root: join(userDataDir, 'notebooks'), userDataDir },
      notebookId,
      outDir,
      migrationsDir: opts.migrationsDir,
      open: openNodeDatabase,
    });
    const seed = openNodeDatabase(join(outDir, SEED_DB));
    const rows: Record<string, number> = {};
    try {
      for (const t of COUNTED) rows[t] = seed.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get<{ n: number }>()?.n ?? 0;
      seed.exec('PRAGMA journal_mode = DELETE');
    } finally {
      seed.close();
    }
    const n = written.notebook;
    return {
      ok: n.missing.length === 0,
      out: outDir,
      notebook: { from: n.from, id: n.to, name: n.name, sources: Object.keys(n.files).length, missing: n.missing, bytes: n.bytes },
      pages: written.pages,
      rows,
    };
  } finally {
    db.close();
  }
}
