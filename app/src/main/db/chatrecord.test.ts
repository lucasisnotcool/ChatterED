/**
 * Migration 029: the conversation record is never deleted. New Conversation, deleting a notebook,
 * or any later code path may hide a conversation from the learner, but the rows stay for the
 * research export: the doc chat, the highlight threads, and the private threads with Ellie and Max.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppService } from '../ipc.js';
import { openTestDb, seedRoom } from '../../test-support/db.js';
import type { SqlDatabase } from './driver.js';

const KEPT = [
  'rooms',
  'sessions',
  'participants',
  'messages',
  'message_revisions',
  'whispers',
  'turn_decisions',
  'events',
  'ledger_history',
];

const T1 = '2026-10-06T09:00:00.000Z';

function whisper(db: SqlDatabase, id: string, seq: number, sender: 'student' | 'agent', body: string): void {
  db.prepare(
    `INSERT INTO whispers (id, room_id, thread_id, student_participant_id, agent_participant_id, seq, sender,
                           body, group_seq_snapshot, created_at)
     VALUES (@id, 'room_test', 'w_ellie', 'p_student', 'p_peer', @seq, @sender, @body, 0, @at)`,
  ).run({ id, seq, sender, body, at: T1 });
}

function count(db: SqlDatabase, table: string): number {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get<{ n: number }>()!.n;
}

function seeded(): { db: SqlDatabase; store: ReturnType<typeof openTestDb>['store'] } {
  const t = openTestDb();
  seedRoom(t.store, ['What is a Hessian?', 'The matrix of second derivatives.', 'Why symmetric?']);
  whisper(t.db, 'w1', 1, 'student', 'Is it fine that I do not get this?');
  whisper(t.db, 'w2', 2, 'agent', 'Yes. Start from the 1-D case.');
  return t;
}

describe('the chat record (migration 029)', () => {
  it('has every guard in place after the migrations run', () => {
    const { db } = openTestDb();
    const triggers = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
      .all<{ name: string }>()
      .map((r) => r.name);
    for (const table of KEPT) expect(triggers).toContain(`${table}_kept`);
    expect(triggers).toEqual(
      expect.arrayContaining(['message_body_revision', 'whisper_body_kept', 'notes_threads_kept_when_used']),
    );
  });

  it('refuses to delete a message, a private message, a session or a room, and keeps every row', () => {
    const { db } = seeded();
    expect(() => db.prepare(`DELETE FROM messages WHERE id = 'm_1'`).run()).toThrow(/never deleted/);
    expect(() => db.prepare('DELETE FROM whispers').run()).toThrow(/private messages are never deleted/);
    expect(() => db.prepare('DELETE FROM sessions').run()).toThrow(/never deleted/);
    // The cascade path: a room's messages and whispers would go with it.
    expect(() => db.prepare(`DELETE FROM rooms WHERE id = 'room_test'`).run()).toThrow(/never deleted/);
    expect(count(db, 'messages')).toBe(3);
    expect(count(db, 'whispers')).toBe(2);
    expect(count(db, 'rooms')).toBe(1);
  });

  it('files the old text of a rewritten message, and only when the text changed', () => {
    const { db, store } = seeded();
    store.messages.updateBody('m_2', 'A regenerated summary.', T1);
    store.messages.updateBody('m_2', 'A regenerated summary.', T1);
    expect(store.messages.get('m_2')?.body).toBe('A regenerated summary.');
    const revisions = db.prepare('SELECT * FROM message_revisions').all<Record<string, unknown>>();
    expect(revisions).toEqual([
      expect.objectContaining({
        message_id: 'm_2',
        room_id: 'room_test',
        body: 'The matrix of second derivatives.',
        released_at: null,
        replaced_at: T1,
      }),
    ]);
    expect(() => db.prepare('DELETE FROM message_revisions').run()).toThrow(/never deleted/);
  });

  it('never rewrites a private message, but may still mark it promoted', () => {
    const { db } = seeded();
    expect(() => db.prepare(`UPDATE whispers SET body = 'gone' WHERE id = 'w1'`).run()).toThrow(/never rewritten/);
    db.prepare(`UPDATE whispers SET promoted_message_id = 'm_1' WHERE id = 'w1'`).run();
    expect(db.prepare(`SELECT body FROM whispers WHERE id = 'w1'`).get()).toEqual({
      body: 'Is it fine that I do not get this?',
    });
  });

  it('discards an empty thread but keeps one that has messages in it', () => {
    const { db } = seeded();
    const thread = db.prepare(
      `INSERT INTO notes_threads (thread_id, room_id, doc_id, kind, created_at)
       VALUES (@t, 'room_test', NULL, @k, @at)`,
    );
    thread.run({ t: 'span_empty', k: 'span', at: T1 });
    thread.run({ t: 'span_used', k: 'span', at: T1 });
    thread.run({ t: 'w_ellie', k: 'private', at: T1 });
    db.prepare(`UPDATE messages SET anchor_id = 'span_used' WHERE id = 'm_3'`).run();

    const remove = db.prepare(`DELETE FROM notes_threads WHERE room_id = 'room_test' AND thread_id = @t`);
    for (const t of ['span_empty', 'span_used', 'w_ellie']) expect(() => remove.run({ t })).not.toThrow();
    const left = db
      .prepare(`SELECT thread_id FROM notes_threads ORDER BY thread_id`)
      .all<{ thread_id: string }>()
      .map((r) => r.thread_id);
    expect(left).toEqual(['span_used', 'w_ellie']);
  });
});

describe('New Conversation keeps the record', () => {
  let dir = '';
  let app: AppService | null = null;
  afterEach(() => {
    app?.dispose();
    app = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('retires the room and leaves the doc chat and both private threads in the database', () => {
    dir = mkdtempSync(join(tmpdir(), 'chattered-chatrecord-'));
    const t = seeded();
    app = new AppService({
      ...t,
      appVersion: '0.0.0-test',
      osVersion: 'darwin test',
      userDataDir: join(dir, 'ChatterED'),
      logDir: join(dir, 'logs'),
      getWindow: () => null as never,
    });
    const before = Object.fromEntries(KEPT.map((table) => [table, count(t.db, table)]));

    app.docHost().retireFlowRoom('room_test', 'learner_reset');

    expect(t.store.rooms.get('room_test')?.state).toBe('closed');
    expect(Object.fromEntries(KEPT.map((table) => [table, count(t.db, table)]))).toEqual(before);
    expect(t.store.messages.forRoom('room_test').map((m) => m.body)).toEqual([
      'What is a Hessian?',
      'The matrix of second derivatives.',
      'Why symmetric?',
    ]);
    expect(count(t.db, 'whispers')).toBe(2);
  });
});
