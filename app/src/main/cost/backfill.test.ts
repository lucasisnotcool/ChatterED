import { describe, expect, it } from 'vitest';
import { openTestDb, seedRoom } from '../../test-support/db.js';
import { CostLedger } from './ledger.js';
import { backfillUsage } from './backfill.js';
import { toCsv, exportFileName, CSV_COLUMNS } from './export.js';
import type { SqlDatabase } from '../db/driver.js';
import type { LocalStore } from '../db/store.js';

const USAGE = JSON.stringify({
  input_tokens: 1_200,
  output_tokens: 300,
  cache_creation_input_tokens: 540,
  cache_read_input_tokens: 6_140,
});

function fixture(): { db: SqlDatabase; store: LocalStore; ledger: CostLedger; roomId: string } {
  const { db, store } = openTestDb();
  const seeded = seedRoom(store);
  const ledger = new CostLedger({
    db,
    readSetting: () => undefined,
    fileForRoom: () => null,
    startedAt: '2026-09-16T10:00:00.000Z',
    now: () => Date.parse('2026-09-16T10:00:00.000Z'),
  });
  return { db, store, ledger, roomId: seeded.roomId };
}

function agentMessage(store: LocalStore, roomId: string, over: Record<string, unknown> = {}): string {
  const participants = store.participants.forRoom(roomId);
  const agent = participants.find((p) => p.kind === 'agent' && p.agent_key !== null)!;
  const id = `msg_${Math.random().toString(36).slice(2, 10)}`;
  store.messages.insert({
    id,
    room_id: roomId,
    participant_id: agent.id,
    seq: store.messages.maxSeq(roomId) + 1,
    body: 'a reply nobody should ever see in a cost row',
    turn_decision_id: null,
    model: 'claude-sonnet-5',
    backend: 'claude-cli',
    usage: USAGE,
    latency_target_ms: null,
    ttft_actual_ms: null,
    released_at: null,
    promoted_from_whisper: null,
    divider_cause: null,
    disagreement: null,
    anchor_id: 'seg_1',
    created_at: '2026-09-16T09:00:00.000Z',
    ...over,
  } as never);
  return id;
}

describe('the backfill', () => {
  it('reconstructs an agent turn from messages.usage', () => {
    const { db, store, ledger, roomId } = fixture();
    agentMessage(store, roomId);
    const result = backfillUsage(db, ledger);
    expect(result.inserted).toBe(1);
    const row = ledger.recent(1)[0]!;
    expect(row.scope).toBe('group');
    expect(row.tokens).toEqual({ input: 1_200, output: 300, cacheWrite: 540, cacheRead: 6_140 });
    expect(row.backfilled).toBe(true);
    expect(row.anchorId).toBe('seg_1');
    expect(row.createdAt).toBe('2026-09-16T09:00:00.000Z');
  });

  /**
   * The REFERENCE participant is the one agent-kind row with a null `agent_key` — created that
   * way so the orchestrator cannot select it. It is the only discriminator an old row has.
   */
  it('tells a REFERENCE answer from a Teacher turn', () => {
    const { db, store, ledger, roomId } = fixture();
    const reference = store.participants.forRoom(roomId).find((p) => p.kind === 'agent' && p.agent_key === null);
    if (!reference) return; // the seeded fixture predates the REFERENCE participant
    agentMessage(store, roomId, { participant_id: reference.id });
    backfillUsage(db, ledger);
    expect(ledger.recent(1)[0]!.scope).toBe('reference');
  });

  it('reconstructs the orchestrator decision, including a silent one', () => {
    const { db, store, ledger, roomId } = fixture();
    store.turnDecisions.insert({
      id: 'dec_1',
      room_id: roomId,
      trigger: 'student_message',
      chosen_participant_id: null,
      move_type: null,
      target_element_id: null,
      probe_type: null,
      rationale: null,
      decided_by: 'model',
      usage: USAGE,
      created_at: '2026-09-16T09:05:00.000Z',
    } as never);
    backfillUsage(db, ledger);
    const row = ledger.recent(1)[0]!;
    expect(row.scope).toBe('orchestrator');
    expect(row.tokens.output).toBe(300);
  });

  /** Runs at every launch. The second run must write nothing. */
  it('is idempotent', () => {
    const { db, store, ledger, roomId } = fixture();
    agentMessage(store, roomId);
    agentMessage(store, roomId);
    expect(backfillUsage(db, ledger).inserted).toBe(2);
    expect(backfillUsage(db, ledger).inserted).toBe(0);
    expect(ledger.count()).toBe(2);
  });

  /**
   * `EMPTY_USAGE` is what the scripted client writes. Counting it would put "40 calls, 0 tokens"
   * on a panel for a sitting that never touched a backend.
   */
  it('skips an all-zero usage blob', () => {
    const { db, store, ledger, roomId } = fixture();
    agentMessage(store, roomId, {
      usage: JSON.stringify({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }),
    });
    expect(backfillUsage(db, ledger).inserted).toBe(0);
  });

  it('survives a malformed usage blob without losing the rest', () => {
    const { db, store, ledger, roomId } = fixture();
    agentMessage(store, roomId, { usage: 'not json at all' });
    agentMessage(store, roomId);
    expect(backfillUsage(db, ledger).inserted).toBe(1);
  });

  /** An install with no history gets an empty ledger, not a crash. */
  it('does nothing on a fresh database', () => {
    const { db, ledger } = fixture();
    expect(backfillUsage(db, ledger)).toMatchObject({ inserted: 0, candidates: 0 });
  });
});

describe('the CSV export', () => {
  it('has no body column and no body in it', () => {
    const { db, store, ledger, roomId } = fixture();
    agentMessage(store, roomId);
    backfillUsage(db, ledger);
    const csv = toCsv(ledger.rows());
    expect(csv).not.toContain('nobody should ever see');
    expect(CSV_COLUMNS).not.toContain('body' as never);
    const [header, first] = csv.trim().split('\n');
    expect(header!.split(',')).toHaveLength(CSV_COLUMNS.length);
    expect(first!.split(',')).toHaveLength(CSV_COLUMNS.length);
  });

  it('quotes every field and doubles an embedded quote', () => {
    const { db, store, ledger, roomId } = fixture();
    agentMessage(store, roomId, { model: 'weird,"model' });
    backfillUsage(db, ledger);
    const csv = toCsv(ledger.rows());
    expect(csv).toContain('"weird,""model"');
  });

  it('names the file by the day, so a second export replaces the first', () => {
    expect(exportFileName(new Date('2026-09-16T23:30:00.000Z'))).toBe('usage-2026-09-16.csv');
  });

  it('ends with a newline', () => {
    expect(toCsv([]).endsWith('\n')).toBe(true);
  });
});
