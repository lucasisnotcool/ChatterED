/**
 * Migration 031 on a populated database (6 Oct afternoon, decisions 8 and 9 on #67): the rebuild of
 * `objective_activity` keeps every press written under 030, a question to Ellie can then be stored,
 * and an outcome written before 031 has no card, honestly (NULL), rather than an invented one.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openTestDatabase } from './driver.js';
import { runMigrations } from './migrations.js';

const DIR = fileURLToPath(new URL('./migrations', import.meta.url));

function migrateTo(dbPath: string, upTo: number): ReturnType<typeof openTestDatabase> {
  const db = openTestDatabase(dbPath);
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let applied = 0;
  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (version > upTo) break;
    db.exec('BEGIN');
    db.exec(readFileSync(join(DIR, file), 'utf8'));
    db.exec('COMMIT');
    applied = version;
  }
  db.exec(`PRAGMA user_version = ${String(applied)}`);
  return db;
}

describe('migration 031', () => {
  it('keeps the presses written under 030, takes a question, and leaves old outcomes without a card', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'chattered-031-')), 'app.db');
    const before = migrateTo(path, 30);
    before.exec(`
      INSERT INTO objective_activity (id, content_sha, room_id, objective_id, kind, block_id, created_at)
        VALUES ('oa1', 'sha-a', 'r1', 'o1', 'explain', 'b1', '2026-10-06T10:00:00Z'),
               ('oa2', 'sha-a', 'r1', 'o1', 'example', NULL, '2026-10-06T10:01:00Z');
      INSERT INTO quiz_outcomes
        (id, content_sha, room_id, objective_id, question_id, kind, verdict, released_by,
         message_id, source, created_at)
        VALUES ('qo1', 'sha-a', 'r1', 'o1', 'q1', 'verdict', 'complete', NULL, 'm1', 'chat',
                '2026-10-06T10:02:00Z');
    `);
    // 030 refuses a question; that is what 031 is for.
    expect(() =>
      before.exec(`INSERT INTO objective_activity (id, content_sha, room_id, objective_id, kind, block_id, created_at)
                   VALUES ('oa3', 'sha-a', 'r1', 'o1', 'question', 'b1', '2026-10-06T10:03:00Z')`),
    ).toThrow();
    before.close();

    const db = openTestDatabase(path);
    runMigrations(db, DIR);

    const rows = db
      .prepare('SELECT id, kind, block_id FROM objective_activity ORDER BY id')
      .all<{ id: string; kind: string; block_id: string | null }>();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: 'oa1', kind: 'explain', block_id: 'b1' },
      { id: 'oa2', kind: 'example', block_id: null },
    ]);
    db.exec(`INSERT INTO objective_activity (id, content_sha, room_id, objective_id, kind, block_id, created_at)
             VALUES ('oa3', 'sha-a', 'r1', 'o1', 'question', 'b1', '2026-10-06T10:03:00Z')`);
    expect(() =>
      db.exec(`INSERT INTO objective_activity (id, content_sha, room_id, objective_id, kind, block_id, created_at)
               VALUES ('oa4', 'sha-a', 'r1', 'o1', 'shrug', 'b1', '2026-10-06T10:04:00Z')`),
    ).toThrow();
    const index = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'objective_activity'`)
      .all<{ name: string }>()
      .map((r) => r.name);
    expect(index).toContain('idx_objective_activity_sha');

    const outcome = db.prepare(`SELECT card_id FROM quiz_outcomes WHERE id = 'qo1'`).get<{ card_id: string | null }>();
    expect(outcome?.card_id).toBeNull();
  });
});
