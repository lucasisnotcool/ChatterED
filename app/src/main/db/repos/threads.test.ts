import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../../test-support/db.js';
import { threadsRepo } from './threads.js';
import { DOC_ANCHOR_ID } from '../../../shared/doc/types.js';

const T0 = '2026-09-19T10:00:00.000Z';
const T1 = '2026-09-19T10:05:00.000Z';

function repo() {
  return threadsRepo(openTestDb().db);
}

describe('threadsRepo', () => {
  it('ensures the doc thread once and returns the same row on a second call', () => {
    const r = repo();
    const first = r.ensureDocThread({ roomId: 'room_a', docId: 'doc_1', threadId: DOC_ANCHOR_ID, now: T0 });
    const second = r.ensureDocThread({ roomId: 'room_a', docId: 'doc_1', threadId: DOC_ANCHOR_ID, now: T1 });

    expect(first.kind).toBe('doc');
    expect(first.threadId).toBe(DOC_ANCHOR_ID);
    // `created_at` is what the thread *is*; a later ensure must not move it.
    expect(second.createdAt).toBe(T0);
    expect(r.forRoom('room_a')).toHaveLength(1);
  });

  it('keys on (room, thread) so two files each have their own doc chat', () => {
    const r = repo();
    r.ensureDocThread({ roomId: 'room_a', docId: 'doc_1', threadId: DOC_ANCHOR_ID, now: T0 });
    r.ensureDocThread({ roomId: 'room_b', docId: 'doc_2', threadId: DOC_ANCHOR_ID, now: T0 });

    expect(r.get('room_a', DOC_ANCHOR_ID)?.docId).toBe('doc_1');
    expect(r.get('room_b', DOC_ANCHOR_ID)?.docId).toBe('doc_2');
    expect(r.forRoom('room_a')).toHaveLength(1);
  });

  it('stores a span thread with its block, its verbatim quote and its objective', () => {
    const r = repo();
    const made = r.createSpanThread({
      roomId: 'room_a',
      docId: 'doc_1',
      threadId: 'span_0123456789ab',
      blockId: 'b_aaaaaaaaaaaa',
      quote: 'the Hessian is positive semidefinite',
      objectiveId: 'obj_1',
      now: T0,
    });

    expect(made).toMatchObject({
      kind: 'span',
      blockId: 'b_aaaaaaaaaaaa',
      quote: 'the Hessian is positive semidefinite',
      objectiveId: 'obj_1',
    });
    expect(r.forBlock('room_a', 'b_aaaaaaaaaaaa')?.threadId).toBe('span_0123456789ab');
    expect(r.forBlock('room_a', 'b_missing')).toBeNull();
  });

  it('gives back the oldest span thread for a block, so a reused block keeps one thread', () => {
    const r = repo();
    r.createSpanThread({
      roomId: 'room_a',
      docId: 'doc_1',
      threadId: 'span_first0000',
      blockId: 'b_x',
      quote: 'first',
      now: T0,
    });
    r.createSpanThread({
      roomId: 'room_a',
      docId: 'doc_1',
      threadId: 'span_second000',
      blockId: 'b_x',
      quote: 'second',
      now: T1,
    });

    expect(r.forBlock('room_a', 'b_x')?.threadId).toBe('span_first0000');
  });

  it('registers a private thread against its agent and reads only the two agents back', () => {
    const r = repo();
    r.registerPrivateThread({
      roomId: 'room_a',
      docId: 'doc_1',
      threadId: 'wthread_1',
      agentKey: 'max',
      now: T0,
    });

    expect(r.get('room_a', 'wthread_1')).toMatchObject({ kind: 'private', agentKey: 'max' });
  });

  it('late-binds an objective and resolves a thread', () => {
    const r = repo();
    r.createSpanThread({
      roomId: 'room_a',
      docId: null,
      threadId: 'span_late000000',
      blockId: 'b_y',
      quote: 'q',
      now: T0,
    });
    expect(r.get('room_a', 'span_late000000')?.objectiveId).toBeNull();

    r.setObjective('room_a', 'span_late000000', 'obj_2');
    r.resolve('room_a', 'span_late000000', T1);

    const row = r.get('room_a', 'span_late000000');
    expect(row?.objectiveId).toBe('obj_2');
    expect(row?.resolvedAt).toBe(T1);
  });

  it('fills in the doc id a later call knows and never clears one it does not', () => {
    const r = repo();
    // The doc chat can exist before the ingest has finished: the room is created by the first
    // question, the doc by the ingest, and neither waits for the other.
    r.ensureDocThread({ roomId: 'room_a', docId: null, threadId: DOC_ANCHOR_ID, now: T0 });
    r.ensureDocThread({ roomId: 'room_a', docId: 'doc_1', threadId: DOC_ANCHOR_ID, now: T1 });
    expect(r.get('room_a', DOC_ANCHOR_ID)?.docId).toBe('doc_1');

    r.ensureDocThread({ roomId: 'room_a', docId: null, threadId: DOC_ANCHOR_ID, now: T1 });
    expect(r.get('room_a', DOC_ANCHOR_ID)?.docId).toBe('doc_1');
  });

  it('lists a room’s threads oldest first', () => {
    const r = repo();
    r.createSpanThread({
      roomId: 'room_a',
      docId: 'doc_1',
      threadId: 'span_bbbbbbbbbbbb',
      blockId: 'b_1',
      quote: 'q',
      now: T1,
    });
    r.ensureDocThread({ roomId: 'room_a', docId: 'doc_1', threadId: DOC_ANCHOR_ID, now: T0 });

    expect(r.forRoom('room_a').map((t) => t.threadId)).toEqual([DOC_ANCHOR_ID, 'span_bbbbbbbbbbbb']);
  });

  it('removes one row, and only that room’s', () => {
    const r = repo();
    for (const roomId of ['room_a', 'room_b']) {
      r.createSpanThread({ roomId, docId: 'doc_1', threadId: 'span_cccccccccccc', blockId: 'b_1', quote: 'q', now: T0 });
    }
    r.remove('room_a', 'span_cccccccccccc');
    expect(r.get('room_a', 'span_cccccccccccc')).toBeNull();
    expect(r.forBlock('room_a', 'b_1')).toBeNull();
    expect(r.get('room_b', 'span_cccccccccccc')).not.toBeNull();
  });
});
