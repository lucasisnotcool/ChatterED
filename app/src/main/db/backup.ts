/**
 * **A copy of the database before a schema upgrade** (release review P1-4).
 *
 * `runMigrations` calls `beforeUpgrade` only when an existing database is about to move to a newer
 * schema — i.e. the first launch after an update. The copy is taken with `VACUUM INTO`, which
 * writes a consistent, self-contained file from a live connection: a plain file copy of `app.db`
 * would miss whatever is still in the WAL.
 *
 * Only the newest `keep` backups are kept, so a learner who updates every week does not
 * accumulate a copy of their notes per release. Restoring one is by hand, for now: quit, replace
 * `app.db` with the backup, relaunch.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase } from './driver.js';

export const BACKUP_DIR_NAME = 'backups';
export const BACKUPS_KEPT = 3;

const PREFIX = 'app-before-v';

/** `app-before-v022-2026-09-25T10-00-00-000Z.db`: sorts by time within a schema version too. */
export function backupFileName(fromVersion: number, now: Date): string {
  const v = String(fromVersion).padStart(3, '0');
  return `${PREFIX}${v}-${now.toISOString().replace(/[:.]/g, '-')}.db`;
}

export function backupDatabase(
  db: SqlDatabase,
  userDataDir: string,
  fromVersion: number,
  opts: { now?: Date; keep?: number } = {},
): string {
  const dir = join(userDataDir, BACKUP_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, backupFileName(fromVersion, opts.now ?? new Date()));
  // SQLite string literal: the only character to escape is the quote itself.
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  pruneBackups(dir, opts.keep ?? BACKUPS_KEPT);
  return path;
}

/** Deletes all but the newest `keep` backups. The time is in the name, so the name order is it. */
export function pruneBackups(dir: string, keep: number): string[] {
  const ours = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    .sort((a, b) => stamp(a).localeCompare(stamp(b)));
  const drop = ours.slice(0, Math.max(0, ours.length - keep));
  for (const f of drop) rmSync(join(dir, f), { force: true });
  return drop;
}

/** The timestamp half of a backup's name — the version prefix must not decide the order. */
function stamp(name: string): string {
  return name.slice(PREFIX.length + 4);
}
