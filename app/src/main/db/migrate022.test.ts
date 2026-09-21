/**
 * Migration 022 on a populated `quiz_outcomes`: the two measures the bar could not carry
 * (`docs/research/measurement.md` M2 and M3) arrive without disturbing a row written before them.
 *
 * The assertion that matters is the NULL. A row from before 022 marked *some* attempt, but nobody
 * counted which, and defaulting it to 1 would invent a first attempt and make every pre-022
 * question look like it was never revised.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
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

describe('migration 022', () => {
  it('leaves a pre-022 outcome intact, with its new columns honestly empty', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'chattered-022-')), 'app.db');
    const before = migrateTo(path, 21);
    before.exec(`
      INSERT INTO quiz_outcomes
        (id, content_sha, room_id, objective_id, question_id, kind, verdict, released_by,
         message_id, source, created_at)
        VALUES ('qo1', 'sha-a', 'r1', 'o1', 'q1', 'verdict', 'partial', NULL, 'm1', 'chat',
                '2026-09-20T00:00:00Z');
    `);
    before.close();

    const db = openTestDatabase(path);
    runMigrations(db, DIR);

    const row = db
      .prepare('SELECT * FROM quiz_outcomes WHERE id = @id')
      .get<{
        verdict: string;
        attempt_index: number | null;
        own_words_block: number | null;
        own_words_cue: number | null;
        own_words_question: number | null;
      }>({ id: 'qo1' })!;
    expect(row.verdict).toBe('partial');
    expect(row.attempt_index).toBeNull();
    expect(row.own_words_block).toBeNull();
    expect(row.own_words_cue).toBeNull();
    expect(row.own_words_question).toBeNull();
    db.close();
  });

  it('round-trips the new values on a row written after it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'chattered-022b-')), 'app.db');
    const db = openTestDatabase(path);
    runMigrations(db, DIR);
    db.exec(`
      INSERT INTO quiz_outcomes
        (id, content_sha, room_id, objective_id, question_id, kind, verdict, released_by,
         message_id, source, attempt_index, own_words_block, own_words_cue, own_words_question,
         created_at)
        VALUES ('qo2', 'sha-a', 'r1', 'o1', 'q1', 'verdict', 'complete', NULL, 'm2', 'chat',
                2, 0.25, 0.8, 0.1, '2026-09-21T00:00:00Z');
    `);
    const row = db
      .prepare('SELECT attempt_index, own_words_cue FROM quiz_outcomes WHERE id = @id')
      .get<{ attempt_index: number; own_words_cue: number }>({ id: 'qo2' })!;
    // Attempt 2 with a Well done is the recovery the bar reads as an ordinary first-try success.
    expect(row.attempt_index).toBe(2);
    expect(row.own_words_cue).toBe(0.8);
    db.close();
  });
});
