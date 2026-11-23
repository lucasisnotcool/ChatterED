/**
 * **A notebook that ships already read** (the grading copy's sample, 2026-11-23).
 *
 * Reading a lecture and a sheet is about a minute of model calls. A grader who presses *Try the
 * sample tutorial* should not spend that minute watching a waiting line, so the sample is read
 * once, by us, with the app's own pipeline, and what that read left is shipped: the button then
 * brings the finished notebook in and makes no model call. A sheet the grader adds themselves is
 * still read live.
 *
 * A seed is a folder:
 *
 *   seed.db        an empty migrated database holding one notebook's rows and nothing else
 *   notebooks/     that notebook's managed source copies, as `<root>/<nb>/<file>-<name>`
 *   notes-pages/   the page images of its sources, by content sha (`notes/pageimages.ts`)
 *
 * Both directions are `importNotebook` (`duplicate.ts`), the deep copy Duplicate uses, so a seed
 * carries exactly what a duplicated notebook carries and none of a conversation: no messages,
 * no progress, no usage, no settings. Writing copies a notebook out of a profile into a fresh
 * database; reading copies it from the seed into the running app's, under new ids each time.
 *
 * Plain Node, no Electron: the caller passes how to open a database.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { pageImageDir } from '../notes/pageimages.js';
import { ensureManagedVault } from '../vault/managed.js';
import { importNotebook, type DuplicatedNotebook } from './duplicate.js';

export const SEED_DB = 'seed.db';
export const SEED_NOTEBOOKS = 'notebooks';
export const SEED_PAGES = 'notes-pages';

export interface SeedProfile {
  db: SqlDatabase;
  /** `<userData>/notebooks`. */
  root: string;
  userDataDir: string;
}

export interface WrittenSeed {
  dir: string;
  notebook: DuplicatedNotebook;
  /** Content shas whose page images were carried. */
  pages: string[];
}

export interface ReadSeed {
  notebookId: string;
  /** The sheet to open as the main view, when the seed has one. */
  tutorialFileId: string | null;
  sources: number;
  missing: number;
}

/** True when `dir` holds a seed's database. */
export function hasNotebookSeed(dir: string | null | undefined): boolean {
  try {
    return !!dir && statSync(join(dir, SEED_DB)).isFile();
  } catch {
    return false;
  }
}

/** The content shas of every source in a database: the keys of their page-image folders. */
function sourceShas(db: SqlDatabase): string[] {
  return db
    .prepare(`SELECT DISTINCT sha256 AS sha FROM files WHERE sha256 IS NOT NULL AND sha256 <> '' ORDER BY sha256`)
    .all<{ sha: string }>()
    .map((r) => r.sha)
    .filter((sha) => /^[A-Za-z0-9_-]+$/.test(sha));
}

/**
 * Write `notebookId` of a profile out as a seed in `outDir`, which must be absent, empty, or an
 * earlier seed (it is replaced). The profile is only read.
 */
export function writeNotebookSeed(o: {
  from: SeedProfile;
  notebookId: string;
  outDir: string;
  migrationsDir: string;
  open: (path: string) => SqlDatabase;
  now?: () => string;
}): WrittenSeed {
  const now = o.now ?? (() => new Date().toISOString());
  if (existsSync(o.outDir)) {
    const entries = readdirSync(o.outDir);
    if (entries.length > 0 && !entries.includes(SEED_DB)) throw new Error(`${o.outDir} is not empty and is not a seed.`);
    rmSync(o.outDir, { recursive: true, force: true });
  }
  mkdirSync(join(o.outDir, SEED_NOTEBOOKS), { recursive: true });
  const seed = o.open(join(o.outDir, SEED_DB));
  try {
    runMigrations(seed, o.migrationsDir);
    // `files.vault_id` needs its vault row. The path is a placeholder: a seed is never opened as a profile.
    ensureManagedVault(seed, SEED_NOTEBOOKS, now());
    const notebook = importNotebook(
      { db: seed, root: join(o.outDir, SEED_NOTEBOOKS), now, from: { db: o.from.db, root: o.from.root } },
      { notebookId: o.notebookId },
    );
    const pages: string[] = [];
    for (const sha of sourceShas(seed)) {
      const dir = pageImageDir(o.from.userDataDir, sha);
      if (!existsSync(dir)) continue;
      cpSync(dir, join(o.outDir, SEED_PAGES, sha), { recursive: true });
      pages.push(sha);
    }
    // One file, with no journal beside it: the seed ships inside a read-only app bundle.
    seed.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    seed.exec('PRAGMA journal_mode = DELETE');
    seed.exec('VACUUM');
    return { dir: o.outDir, notebook, pages };
  } finally {
    seed.close();
  }
}

/**
 * Bring a seed's notebook into the running profile, under new ids, named `name` (its own name
 * otherwise). The seed's database is copied beside the profile before it is opened, because the
 * shipped one sits in a folder that cannot be written to. Throws when the seed cannot be read;
 * the caller then falls back to reading the sample live.
 */
export function readNotebookSeed(o: {
  into: SeedProfile;
  seedDir: string;
  name?: string | null;
  open: (path: string) => SqlDatabase;
  now?: () => string;
}): ReadSeed {
  if (!hasNotebookSeed(o.seedDir)) throw new Error('No seed there.');
  const scratch = join(o.into.userDataDir, 'grader');
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  const tmp = join(scratch, `seed-${process.pid}-${Date.now()}.db`);
  const clean = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${tmp}${suffix}`, { force: true });
  };
  copyFileSync(join(o.seedDir, SEED_DB), tmp);
  chmodSync(tmp, 0o600);
  let seed: SqlDatabase | null = null;
  try {
    seed = o.open(tmp);
    const copy = importNotebook(
      { db: o.into.db, root: o.into.root, ...(o.now ? { now: o.now } : {}), from: { db: seed, root: join(o.seedDir, SEED_NOTEBOOKS) } },
      { name: o.name ?? null },
    );
    // Page images are keyed on a source's bytes, so a profile that already has them keeps its own.
    const pagesDir = join(o.seedDir, SEED_PAGES);
    if (existsSync(pagesDir)) {
      for (const sha of readdirSync(pagesDir)) {
        if (!/^[A-Za-z0-9_-]+$/.test(sha)) continue;
        const dest = pageImageDir(o.into.userDataDir, sha);
        if (existsSync(dest)) continue;
        try {
          cpSync(join(pagesDir, sha), dest, { recursive: true });
        } catch {
          // A deck without its images is still read and shown; only the pictures in a prompt go.
        }
      }
    }
    const tutorial = o.into.db
      .prepare(`SELECT file_id FROM notebook_sources WHERE notebook_id = @n AND role = 'tutorial' ORDER BY ord, file_id LIMIT 1`)
      .get<{ file_id: string }>({ n: copy.to });
    return {
      notebookId: copy.to,
      tutorialFileId: tutorial?.file_id ?? null,
      sources: Object.keys(copy.files).length,
      missing: copy.missing.length,
    };
  } finally {
    try {
      seed?.close();
    } catch {
      // Already closed.
    }
    clean();
  }
}
