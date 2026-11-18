/**
 * **A rolled-back build on a newer database** (bricking review, 2026-11-18). While the field study
 * runs, migrations are expand-only (add tables and columns), so build N-1 must open, migrate and
 * read a database that build N migrated. This stands in for "N-1 boots on N's populated schema":
 * the current migrations, then a future expand-only one, then the current code again.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './driver.js';
import { runMigrations } from './migrations.js';
import { createStore } from './store.js';
import { backupDatabase, BACKUP_DIR_NAME, pruneBackups } from './backup.js';

const MIGRATIONS = fileURLToPath(new URL('./migrations', import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('an older build on a newer schema', () => {
  it('opens, says so, and reads and writes as before', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chattered-newer-'));
    dirs.push(dir);
    const db = openTestDatabase(join(dir, 'app.db'));
    const known = runMigrations(db, MIGRATIONS);
    const store = createStore(db);
    store.settings.set('probe', 'before', 't0');

    const future = join(dir, 'future');
    mkdirSync(future);
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) writeFileSync(join(future, f), readFileSync(join(MIGRATIONS, f)));
    const next = String(known + 1).padStart(3, '0');
    writeFileSync(
      join(future, `${next}_future_expand_only.sql`),
      'CREATE TABLE future_thing (id TEXT PRIMARY KEY, v TEXT);\nALTER TABLE settings ADD COLUMN future_col TEXT;\n',
    );
    expect(runMigrations(db, future)).toBe(known + 1);

    const seen: [number, number][] = [];
    expect(runMigrations(db, MIGRATIONS, { onNewer: (c, k) => seen.push([c, k]) })).toBe(known + 1);
    expect(seen).toEqual([[known + 1, known]]);
    const again = createStore(db);
    expect(again.settings.get('probe')).toBe('before');
    again.settings.set('probe', 'after', 't1');
    expect(again.settings.get('probe')).toBe('after');
    db.close();
  });
});

describe('pruneBackups', () => {
  it('always keeps the backup just written, even when a clock correction sorts it oldest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chattered-prune-'));
    dirs.push(dir);
    const db = openTestDatabase(join(dir, 'app.db'));
    runMigrations(db, MIGRATIONS);
    for (const d of ['2027-01-01', '2027-01-02', '2027-01-03']) backupDatabase(db, dir, 30, { now: new Date(`${d}T00:00:00Z`) });
    const fresh = backupDatabase(db, dir, 31, { now: new Date('2026-11-18T00:00:00Z') });
    const left = readdirSync(join(dir, BACKUP_DIR_NAME));
    expect(left).toContain(fresh.slice(fresh.lastIndexOf('/') + 1));
    expect(left).toHaveLength(3);
    expect(pruneBackups(join(dir, BACKUP_DIR_NAME), 3)).toEqual([]);
    db.close();
  });
});
