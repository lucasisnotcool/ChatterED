import { describe, expect, it } from 'vitest';
import { openTestStore, seedRoom } from '../../test-support/db.js';

describe('migrations and the repository layer', () => {
  it('creates every table in architecture-mac.md §D.1', () => {
    const store = openTestStore();
    const room = store.rooms.get('nope');
    expect(room).toBeUndefined();
    // A round trip through each repo proves the table exists and the columns line up.
    const seeded = seedRoom(store);
    expect(seeded.store.materials.get(seeded.materialId)?.module_code).toBe('MA3236');
    expect(seeded.store.rooms.get(seeded.roomId)?.state).toBe('open');
    expect(seeded.store.participants.forRoom(seeded.roomId)).toHaveLength(4);
    expect(seeded.store.sessions.forRoom(seeded.roomId)?.id).toBe(seeded.sessionId);
    expect(seeded.store.ledger.forSession(seeded.sessionId)).toHaveLength(3);
  });

  it('enforces the cache-floor check on materials', () => {
    const { store } = seedRoom();
    expect(() =>
      store.materials.insert({
        id: 'mat_short',
        module_code: 'MA3236',
        title: 'too short to cache',
        source_kind: 'pasted_text',
        file_path: null,
        file_sha256: null,
        file_mtime: null,
        page_from: null,
        page_to: null,
        page_count: null,
        extracted_text: 'x',
        extract_engine: 'paste',
        padding_text: '',
      topic_context: '',
        concept_pack: '{}',
        pack_provenance: 'fixed',
        pack_confirmed_at: null,
        token_count: 900,
        cache_eligible: 1, // claims cacheable while under the 4,096 floor → must be refused
        prefix_sha256: 'p',
        created_at: '2026-09-13T10:00:00.000Z',
      }),
    ).toThrow();
  });

  it('keeps messages ordered by seq and unique per room', () => {
    const { store, roomId } = seedRoom(undefined, ['opener', 'student reply', 'challenge']);
    const msgs = store.messages.forRoom(roomId);
    expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(store.messages.maxSeq(roomId)).toBe(3);
    expect(store.messages.tail(roomId, 2).map((m) => m.body)).toEqual(['student reply', 'challenge']);
    expect(store.messages.bodyAtSeq(roomId, 2)).toBe('student reply');
    expect(store.messages.forRoomUpToSeq(roomId, 2)).toHaveLength(2);
  });

  it('upserts ledger rows and appends history', () => {
    const { store, sessionId } = seedRoom();
    const before = store.ledger.forSession(sessionId)[0]!;
    store.ledger.upsert({ ...before, level: 2, level_proposed: 2, evidence_text: 'because the copy is needed' });
    const after = store.ledger.forSession(sessionId)[0]!;
    expect(after.level).toBe(2);
    expect(store.ledger.forSession(sessionId)).toHaveLength(3);

    store.ledger.appendHistory({
      session_id: sessionId,
      message_id: 'm_1',
      element_id: before.element_id,
      level_before: 0,
      level_proposed: 2,
      level_after: 2,
      gate: null,
      created_at: '2026-09-13T10:01:00.000Z',
    });
    expect(store.ledger.historyForSession(sessionId)).toHaveLength(1);
  });

  it('appends events with a monotonic per-session seq', () => {
    const { store, roomId, sessionId } = seedRoom();
    for (const type of ['session.start', 'message.send', 'silence.timer.set']) {
      store.events.append({
        room_id: roomId,
        session_id: sessionId,
        actor: 'system',
        type,
        envelope: '{}',
        payload: '{}',
        client_ts: null,
        server_ts: '2026-09-13T10:00:00.000Z',
      });
    }
    expect(store.events.forSession(sessionId).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('queues outbox rows with deterministic doc paths and drains them', () => {
    const { store, roomId } = seedRoom();
    store.outbox.enqueue({
      collection: 'messages',
      doc_path: `rooms/${roomId}/messages/1`,
      op: 'set',
      body: '{"body":"hello"}',
      last_error: null,
      enqueued_at: '2026-09-13T10:00:00.000Z',
    });
    const [pending] = store.outbox.pending();
    expect(pending?.doc_path).toBe(`rooms/${roomId}/messages/1`);
    store.outbox.markSent(pending!.id!, '2026-09-13T10:00:01.000Z');
    expect(store.outbox.pending()).toHaveLength(0);
  });

  it('rolls a failed transaction back', () => {
    const { store, roomId } = seedRoom();
    expect(() =>
      store.transaction(() => {
        store.rooms.update(roomId, { topic: 'changed' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.rooms.get(roomId)?.topic).toBe('convexity and the Hessian');
  });
});
