/**
 * The pre-upgrade backup (release review P1-4): taken only when an existing database is about to
 * move to a newer schema, readable as a database, and pruned to the newest few.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './driver.js';
import { runMigrations } from './migrations.js';
import { BACKUP_DIR_NAME, backupDatabase, backupFileName, pruneBackups } from './backup.js';

const MIGRATIONS = fileURLToPath(new URL('./migrations', import.meta.url));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-backup-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A copy of the migrations directory holding only the first `n` files. */
function partialMigrations(n: number): string {
  const out = mkdtempSync(join(dir, 'mig-'));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().slice(0, n);
  for (const f of files) writeFileSync(join(out, f), readFileSync(join(MIGRATIONS, f)));
  return out;
}

describe('runMigrations beforeUpgrade', () => {
  it('is not called for a fresh database — there is nothing to lose', () => {
    const db = openTestDatabase(join(dir, 'fresh.db'));
    const calls: [number, number][] = [];
    runMigrations(db, MIGRATIONS, { beforeUpgrade: (from, to) => calls.push([from, to]) });
    expect(calls).toEqual([]);
    db.close();
  });

  it('is called once, before the first pending migration, on an existing database', () => {
    const db = openTestDatabase(join(dir, 'old.db'));
    const old = runMigrations(db, partialMigrations(5));
    const calls: [number, number][] = [];
    const latest = runMigrations(db, MIGRATIONS, {
      beforeUpgrade: (from, to) => {
        // Still on the old schema when the hook runs.
        const v = db.prepare('PRAGMA user_version').get<{ user_version: number }>()!.user_version;
        calls.push([from, to]);
        expect(v).toBe(old);
      },
    });
    expect(calls).toEqual([[old, latest]]);
    db.close();
  });

  it('is not called when the schema is already current', () => {
    const db = openTestDatabase(join(dir, 'current.db'));
    runMigrations(db, MIGRATIONS);
    const calls: number[] = [];
    runMigrations(db, MIGRATIONS, { beforeUpgrade: (from) => calls.push(from) });
    expect(calls).toEqual([]);
    db.close();
  });
});

describe('backupDatabase', () => {
  it('writes a consistent copy that opens as a database at the old schema', () => {
    const db = openTestDatabase(join(dir, 'app.db'));
    const old = runMigrations(db, partialMigrations(5));
    let path = '';
    runMigrations(db, MIGRATIONS, { beforeUpgrade: (from) => (path = backupDatabase(db, dir, from)) });
    expect(path.startsWith(join(dir, BACKUP_DIR_NAME))).toBe(true);
    const copy = openTestDatabase(path);
    expect(copy.prepare('PRAGMA user_version').get<{ user_version: number }>()!.user_version).toBe(old);
    copy.close();
    db.close();
  });

  it('keeps only the newest few', () => {
    const db = openTestDatabase(join(dir, 'app.db'));
    runMigrations(db, MIGRATIONS);
    for (let i = 0; i < 5; i += 1) {
      backupDatabase(db, dir, 20 + i, { now: new Date(Date.UTC(2026, 8, 20 + i)), keep: 3 });
    }
    const left = readdirSync(join(dir, BACKUP_DIR_NAME)).sort();
    expect(left).toEqual([
      backupFileName(22, new Date(Date.UTC(2026, 8, 22))),
      backupFileName(23, new Date(Date.UTC(2026, 8, 23))),
      backupFileName(24, new Date(Date.UTC(2026, 8, 24))),
    ]);
    db.close();
  });

  it('orders by time, not by the schema version in the name', () => {
    const names = [
      backupFileName(30, new Date(Date.UTC(2026, 0, 1))),
      backupFileName(10, new Date(Date.UTC(2026, 5, 1))),
    ];
    const target = mkdtempSync(join(dir, 'prune-'));
    for (const n of names) writeFileSync(join(target, n), '');
    writeFileSync(join(target, 'unrelated.db'), '');
    expect(pruneBackups(target, 1)).toEqual([names[0]]);
    expect(readdirSync(target).sort()).toEqual([names[1], 'unrelated.db'].sort());
  });
});
