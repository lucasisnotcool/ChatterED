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
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    applied = version;
  }
  return applied;
}
