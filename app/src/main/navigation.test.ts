/**
 * The navigation merge (ui-review-code.md §3, ui-review-ux.md M1–M3, m1).
 *
 * Two dead data paths were deleted, and both of them are the kind that grow back: a hard-coded
 * module code that fed a second course taxonomy in the nav rail, and a `slides_folder` setting
 * that first run wrote and nothing ever read — so a learner pointed ChatterED at their files and
 * was immediately asked again in different words.
 *
 * The sweep is the same shape as the one in `apikey.test.ts`: the forbidden strings are
 * assembled from halves so this file is not itself a hit.
 */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTestDatabase, type SqlDatabase } from './db/driver.js';
import { runMigrations } from './db/migrations.js';
import { openTestDb } from '../test-support/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const SELF = resolve(HERE, 'navigation.test.ts');
const MIGRATIONS = resolve(HERE, 'db/migrations');

const SLIDES_KEY = 'slides_' + 'folder';
const SLIDES_CAMEL = 'slides' + 'Folder';
const FABRICATED_MODULE = 'MA' + '3236';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte|sql)$/.test(entry)) out.push(full);
  }
  return out;
}

/** A database as it stood before this pass: every migration up to 006 and no further. */
function upgradingInstall(): SqlDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'chattered-mig-'));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && Number(f.slice(0, 3)) <= 6)) {
    copyFileSync(join(MIGRATIONS, file), join(dir, file));
  }
  const db = openTestDatabase(':memory:');
  runMigrations(db, dir);
  return db;
}

describe('the deleted first-run slides folder', () => {
  it('is named nowhere in src/ except the migration that deletes it', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      if (file === SELF) continue;
      const text = readFileSync(file, 'utf8');
      if (!text.includes(SLIDES_KEY) && !text.includes(SLIDES_CAMEL)) continue;
      // The two migrations are history and are never edited once shipped; 007 is the delete.
      if (file.endsWith('007_drop_slides_folder.sql') || file.endsWith('005_vault_topics_files.sql')) continue;
      // A prose mention in a comment is fine; a live reference is not.
      const live = text
        .split('\n')
        .filter((line) => (line.includes(SLIDES_KEY) || line.includes(SLIDES_CAMEL)))
        .filter((line) => !/^\s*(\/\/|\*|--|\/\*)/.test(line));
      if (live.length > 0) hits.push(`${file}: ${live[0]!.trim()}`);
    }
    expect(hits).toEqual([]);
  });

  it('is removed from a database that already had one', () => {
    const db = upgradingInstall();
    const now = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (:k, :v, :t)').run({
      k: SLIDES_KEY,
      v: '/Users/someone/Documents/MA3236',
      t: now,
    });
    db.prepare(
      'INSERT INTO vaults (id, root_path, display_name, created_at, last_scan_at) VALUES (:i, :r, :d, :c, NULL)',
    ).run({ i: 'v1', r: '/Users/someone/Notes', d: 'Notes', c: now });

    // …and now they update. Migrations are forward-only on `user_version`, so this is the real
    // upgrade path, not a rewind.
    runMigrations(db, MIGRATIONS);

    expect(db.prepare('SELECT value FROM settings WHERE key = :k').get<{ value: string }>({ k: SLIDES_KEY })).toBeUndefined();
    // The vault they actually opened is where the root lives, and it is untouched.
    expect(db.prepare('SELECT COUNT(*) AS n FROM vaults').get<{ n: number }>()!.n).toBe(1);
    db.close();
  });
});

describe('the fabricated module code', () => {
  it('is not a literal anywhere outside a test or a migration comment', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      if (file === SELF || file.endsWith('.test.ts')) continue;
      // Test fixtures seed a room the way a real one used to look, on purpose.
      if (file.includes('/test-support/')) continue;
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.includes(FABRICATED_MODULE)) continue;
        if (/^\s*(\/\/|\*|--|\/\*)/.test(line)) continue;
        // Two legitimate mentions: the dev-only mock bridge replays the demo transcript, and
        // the committed demo Concept Pack records the module its slide actually came from.
        if (file.endsWith('mockBridge.ts')) continue;
        if (file.endsWith('psd-hessian-convexity-v1.ts')) continue;
        hits.push(`${file}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps the column, because every historical prefix hash was taken with it in place', () => {
    const { db } = openTestDb();
    const columns = db.prepare('PRAGMA table_info(rooms)').all<{ name: string }>().map((c) => c.name);
    expect(columns).toContain('module_code');
    const materialColumns = db.prepare('PRAGMA table_info(materials)').all<{ name: string }>().map((c) => c.name);
    expect(materialColumns).toContain('module_code');
  });
});
