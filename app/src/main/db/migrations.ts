import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase } from './driver.js';

/**
 * Forward-only migrations keyed on SQLite's `user_version`. Files are named `NNN_name.sql`
 * and applied in numeric order; a file is never edited after it has shipped.
 *
 * The directory is passed in rather than resolved here so that the same code works from the
 * compiled `dist/` tree, from the source tree under Vitest, and from a packaged `app.asar`.
 */
export function runMigrations(db: SqlDatabase, migrationsDir: string): number {
  const current = (db.prepare('PRAGMA user_version').get<{ user_version: number }>()?.user_version ?? 0) | 0;
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let applied = current;
  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (!Number.isFinite(version)) throw new Error(`Migration ${file} must start with a 3-digit version`);
    if (version <= applied) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    /**
     * **Foreign keys off for the duration, which is SQLite's own documented procedure for the
     * one migration shape that cannot be done in place**: widening a CHECK constraint means
     * creating a new table, copying, `DROP TABLE`, `RENAME` — and `DROP TABLE materials` with
     * `rooms.material_id REFERENCES materials(id)` and enforcement on is an immediate
     * violation, whatever the new table is about to contain. 014 failed exactly there, on a
     * populated database and only on a populated one, which is why no test caught it: a test
     * database is migrated before it has a single row.
     *
     * `PRAGMA foreign_keys` is a no-op inside a transaction, so it has to be set here, outside
     * the BEGIN. `PRAGMA foreign_key_check` inside it is the price of turning it off: a
     * migration that genuinely leaves a dangling reference still fails and still rolls back,
     * rather than being waved through by the pragma that was meant to let it rebuild a table.
     */
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      const violations = db.prepare('PRAGMA foreign_key_check').all<Record<string, unknown>>();
      if (violations.length > 0) {
        throw new Error(`${violations.length} dangling reference(s) after it ran, e.g. ${JSON.stringify(violations[0])}`);
      }
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    applied = version;
  }
  return applied;
}
