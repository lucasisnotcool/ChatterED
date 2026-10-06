/**
 * The headless explain-comment import (`importcommentscli.ts`) on a real file database left at
 * migration 032 by an older build: it refuses while the app holds the file, backs up, migrates with
 * the app's own runner, then imports; `--dry-run` writes nothing.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openNodeDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { parseImportArgs, runImportCommentsCli } from './importcommentscli.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));
const T = '2026-10-07T00:00:00.000Z';
const DOC = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { blockId: 'b_1', pages: [1] }, content: [{ type: 'text', text: 'Value iteration' }] }],
});

let tmp = '';
let dbPath = '';
let input = '';

/** A database exactly as a build with migrations 001–032 leaves it, with one notes doc. */
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-import-'));
  const upTo32 = join(tmp, 'migrations-032');
  mkdirSync(upTo32);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && Number(f.slice(0, 3)) <= 32)) {
    copyFileSync(join(MIGRATIONS_DIR, f), join(upTo32, f));
  }
  mkdirSync(join(tmp, 'userData'));
  dbPath = join(tmp, 'userData', 'app.db');
  const db = openNodeDatabase(dbPath);
  expect(runMigrations(db, upTo32)).toBe(32);
  db.prepare(
    `INSERT INTO notes_docs (id, content_sha, title, doc_json, ingest_status, ingest_version, version, created_at, updated_at)
     VALUES ('doc_a', 'nb:nb_a', 'Notes', @d, 'ready', 1, 1, @t, @t)`,
  ).run({ d: DOC, t: T });
  db.close();
  input = join(tmp, 'comments.jsonl');
  writeFileSync(
    input,
    [
      { doc_id: 'doc_a', block_id: 'b_1', text_sha: 's', body: 'A **contraction**.', model: 'sonnet' },
      { doc_id: 'doc_a', block_id: 'b_gone', text_sha: 's', body: 'x', model: 'sonnet' },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n'),
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const read = <T>(sql: string): T => {
  const db = openNodeDatabase(dbPath);
  try {
    return db.prepare(sql).get<T>()!;
  } finally {
    db.close();
  }
};
const run = (...extra: string[]) =>
  runImportCommentsCli(['--db', dbPath, '--in', input, ...extra], { migrationsDir: MIGRATIONS_DIR, now: () => new Date(T) });

describe('import-comments, headless', () => {
  it('backs up, migrates a 032 database with the app runner, and imports', () => {
    const out = run();
    expect(out.schema).toMatchObject({ from: 32, to: 34 });
    expect(out.report).toMatchObject({ lines: 2, inserted: 1, skipped: [{ line: 2 }] });
    expect(out.backup).toBe(join(tmp, 'userData', 'backups', 'before-import-comments-2026-10-07T00-00-00-000Z.db'));
    expect(existsSync(out.backup!)).toBe(true);
    expect(read<{ user_version: number }>('PRAGMA user_version').user_version).toBe(34);
    expect(read<{ body: string }>(`SELECT body FROM block_comments WHERE doc_id = 'doc_a' AND block_id = 'b_1'`).body).toBe('A **contraction**.');
    // The backup is the database as it was: still at 032.
    const backup = openNodeDatabase(out.backup!);
    expect(backup.prepare('PRAGMA user_version').get()).toEqual({ user_version: 32 });
    backup.close();
    // Again: the same line is unchanged, and there is nothing left to migrate.
    expect(run('--no-backup')).toMatchObject({ backup: null, schema: { from: 34, to: 34 }, report: { unchanged: 1, inserted: 0 } });
  });

  it('--dry-run reports the real counts and writes nothing: no backup, no migration, no comment', () => {
    const out = run('--dry-run');
    expect(out).toMatchObject({ dryRun: true, backup: null, schema: { from: 32, to: 34 }, report: { inserted: 1 } });
    expect(read<{ user_version: number }>('PRAGMA user_version').user_version).toBe(32);
    expect(existsSync(join(tmp, 'userData', 'backups'))).toBe(false);
  });

  it('refuses while the app holds the database, unless forced', () => {
    symlinkSync(`host-${process.pid}`, join(tmp, 'userData', 'SingletonLock'));
    expect(() => run()).toThrow(/has this database open/);
    expect(read<{ user_version: number }>('PRAGMA user_version').user_version).toBe(32);
    expect(run('--force', '--no-backup').report.inserted).toBe(1);
  });

  it('parses its arguments', () => {
    expect(parseImportArgs(['--db', 'a.db', '--in', 'c.jsonl'])).toEqual({ db: 'a.db', in: 'c.jsonl', dryRun: false, backup: true, force: false });
    expect(() => parseImportArgs(['--db', 'a.db'])).toThrow(/--in are required/);
    expect(() => parseImportArgs(['--db', 'a.db', '--in', 'x', '--nope'])).toThrow(/Unknown argument/);
  });
});
