/**
 * **021 on a database that already has rows in it.**
 *
 * `openTestDb()` migrates an empty file, which is the one condition under which a broken
 * migration cannot fail — 014 shipped a `DROP TABLE` that only broke on a populated database and
 * no test caught it (see `migrations.ts`). 021 is three `ALTER TABLE ... ADD COLUMN`s and two
 * indexes, which is about as safe as SQLite gets, so this is cheap insurance rather than a
 * suspicion: migrate to 020, write a row into each of the three tables it touches, then migrate
 * the rest of the way and read them back.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openTestDatabase } from './driver.js';
import { runMigrations } from './migrations.js';

const DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * The highest migration on disk, read rather than written down. The assertion below is "the
 * directory ran to completion", not "the head is 21": hard-coding the number makes every later
 * migration fail a test about an earlier one, which says nothing about either.
 */
const HEAD = Math.max(
  ...readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => Number.parseInt(f.slice(0, 3), 10)),
);

/** The migrations directory, truncated at `upTo`. 021 has to run *after* the rows exist. */
function migrateTo(dbPath: string, upTo: number): ReturnType<typeof openTestDatabase> {
  const db = openTestDatabase(dbPath);
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (version > upTo) break;
    db.exec('BEGIN');
    db.exec(readFileSync(join(DIR, file), 'utf8'));
    db.exec('COMMIT');
    applied = version;
  }
  db.exec(`PRAGMA user_version = ${applied}`);
  return db;
}

describe('migration 021', () => {
  it('adds its columns to a populated database without losing a row', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'chattered-021-')), 'app.db');
    const before = migrateTo(path, 20);
    before.exec(`
      INSERT INTO users (id, code, created_at) VALUES ('u1', 'P1', '2026-09-18T00:00:00Z');
      INSERT INTO materials
        (id, module_code, title, source_kind, extracted_text, extract_engine, concept_pack,
         pack_provenance, token_count, cache_eligible, prefix_sha256, created_at)
        VALUES ('mat1', 'CS3249', 'Deck', 'pasted_text', 'text', 'paste', '{}', 'fixed', 10, 0, 'sha', '2026-09-18T00:00:00Z');
      INSERT INTO rooms (id, module_code, material_id, topic, state, config, created_at)
        VALUES ('r1', 'CS3249', 'mat1', 't', 'open', '{}', '2026-09-18T00:00:00Z');
      INSERT INTO agents (key, role, display_name, colour, prompt_version, model, latency_profile)
        VALUES ('peer.ellie', 'peer', 'Ellie', '#2f7', 'v1', 'claude-sonnet-5', '{}');
      INSERT INTO participants (id, room_id, kind, user_id, agent_key, display_name, joined_at)
        VALUES ('p1', 'r1', 'student', 'u1', NULL, 'You', '2026-09-18T00:00:00Z'),
               ('p2', 'r1', 'agent', NULL, 'peer.ellie', 'Ellie', '2026-09-18T00:00:00Z');
      INSERT INTO messages (id, room_id, participant_id, seq, body, created_at)
        VALUES ('m1', 'r1', 'p1', 1, 'a message written before 021', '2026-09-18T00:00:00Z');
      INSERT INTO whispers (id, room_id, thread_id, student_participant_id, agent_participant_id, seq, sender, body, group_seq_snapshot, created_at)
        VALUES ('w1', 'r1', 'wt1', 'p1', 'p2', 1, 'student', 'a whisper written before 021', 0, '2026-09-18T00:00:00Z');
      INSERT INTO llm_usage (id, created_at, scope, model, backend)
        VALUES ('use1', '2026-09-18T00:00:00Z', 'group', 'claude-sonnet-5', 'claude-cli');
    `);
    before.close();

    const db = openTestDatabase(path);
    expect(runMigrations(db, DIR)).toBe(HEAD);

    // The rows survived, and the new columns read as the absence they are.
    expect(db.prepare('SELECT turn_id FROM messages WHERE id = @id').get<{ turn_id: string | null }>({ id: 'm1' })!.turn_id).toBeNull();
    expect(db.prepare('SELECT turn_id FROM whispers WHERE id = @id').get<{ turn_id: string | null }>({ id: 'w1' })!.turn_id).toBeNull();
    // …except `outcome`, which reads as 'ok', because that is what every row written before
    // today was: a call that returned.
    expect(db.prepare('SELECT outcome FROM llm_usage WHERE id = @id').get<{ outcome: string }>({ id: 'use1' })!.outcome).toBe('ok');
    db.close();
  });
});
