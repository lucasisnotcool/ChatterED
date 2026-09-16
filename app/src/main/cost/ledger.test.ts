import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { CostLedger } from './ledger.js';
import { recordFor, costedClient } from './client.js';
import type { LlmRequest, LlmResult, LLMClient } from '../../room/llm/types.js';
import { SESSION_WINDOW } from '../../shared/cost.js';

const T0 = Date.parse('2026-09-16T10:00:00.000Z');

function ledgerAt(now = () => T0, settings: Record<string, string> = {}): { ledger: CostLedger; rooms: Map<string, string> } {
  const { db } = openTestDb();
  const rooms = new Map<string, string>();
  const ledger = new CostLedger({
    db,
    readSetting: (k) => settings[k],
    fileForRoom: (roomId) => rooms.get(roomId) ?? null,
    startedAt: new Date(T0).toISOString(),
    now,
  });
  return { ledger, rooms };
}

function write(
  ledger: CostLedger,
  over: Partial<Parameters<CostLedger['record']>[0]> = {},
): ReturnType<CostLedger['record']> {
  return ledger.record({
    scope: 'group',
    model: 'claude-sonnet-5',
    backend: 'claude-cli',
    tokens: { input: 1_000, output: 100, cacheWrite: 0, cacheRead: 0 },
    ...over,
  });
}

describe('recording a call', () => {
  it('writes the four counts, both money columns and the rate card that priced it', () => {
    const { ledger } = ledgerAt();
    const view = write(ledger, {
      tokens: { input: 2_000, output: 500, cacheWrite: 540, cacheRead: 6_140 },
      reportedUsd: 0.0057,
      durationMs: 4_060,
      roomId: 'room_1',
      anchorId: 'seg_a',
      fileId: 'file_1',
      turnId: 'turn_7',
    });
    expect(view.tokens).toEqual({ input: 2_000, output: 500, cacheWrite: 540, cacheRead: 6_140 });
    expect(view.reportedUsd).toBe(0.0057);
    expect(view.estimatedUsd).toBeCloseTo(11_578 / 1_000_000, 9);
    expect(view.durationMs).toBe(4_060);
    expect(view.backfilled).toBe(false);

    const row = ledger.recent(1)[0]!;
    expect(row.id).toBe(view.id);
    expect(row.anchorId).toBe('seg_a');
  });

  /**
   * The CLI's own number and this app's estimate disagree by ~1.7× (§UNVERIFIED 6). Both are
   * kept; nothing anywhere adds them. The assertion is that they stay distinct on the row.
   */
  it('keeps the CLI-reported figure apart from the estimate', () => {
    const { ledger } = ledgerAt();
    // §UNVERIFIED 6's own numbers: one Haiku image call, $0.0057 reported against $0.0033
    // computed from the rate card. The ratio is the finding; the point here is that the two
    // survive to the summary as two numbers.
    write(ledger, {
      model: 'claude-haiku-4-5',
      reportedUsd: 0.0057,
      tokens: { input: 2_744, output: 150, cacheWrite: 0, cacheRead: 0 },
    });
    const s = ledger.summary({ level: 'app' });
    expect(s.reportedUsd).toBe(0.0057);
    expect(s.estimatedUsd).toBeCloseTo(0.0035, 4);
    expect(s.reportedUsd! / s.estimatedUsd).toBeGreaterThan(1.5);
    expect(s.reportedCalls).toBe(1);
  });

  it('resolves a missing fileId through the room', () => {
    const { ledger, rooms } = ledgerAt();
    rooms.set('room_1', 'file_9');
    const view = write(ledger, { roomId: 'room_1' });
    expect(view.fileId).toBe('file_9');
  });

  /** A scripted sitting costs nothing, and "nothing" is a fact worth being able to show. */
  it('records a scripted call at zero rather than not recording it', () => {
    const { ledger } = ledgerAt();
    write(ledger, { backend: 'scripted', tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } });
    const s = ledger.summary({ level: 'app' });
    expect(s.calls).toBe(1);
    expect(s.estimatedUsd).toBe(0);
    expect(s.mode).toBe('none');
  });
});

describe('the three levels', () => {
  /**
   * **`thread ≤ file ≤ app`**, the invariant the whole feature rests on. Built out of calls that
   * exercise every way a row can fail to belong to a narrower level: a call on another file, a
   * call on another thread of the same file, and a call with no file at all.
   */
  function populated(): CostLedger {
    const { ledger } = ledgerAt();
    const t = (n: number) => new Date(T0 + n * 1_000).toISOString();
    // file_A, thread seg_1 — the thread under test
    write(ledger, { fileId: 'file_A', anchorId: 'seg_1', scope: 'reference', at: t(1) });
    write(ledger, { fileId: 'file_A', anchorId: 'seg_1', scope: 'group', at: t(2) });
    write(ledger, { fileId: 'file_A', anchorId: 'seg_1', scope: 'ledger', at: t(3) });
    // file_A, a different thread
    write(ledger, { fileId: 'file_A', anchorId: 'seg_2', scope: 'group', at: t(4) });
    // file_A, the background ingest — no room, no anchor. Must still be inside file level.
    write(ledger, { fileId: 'file_A', anchorId: null, scope: 'objectives', at: t(5) });
    // another document entirely
    write(ledger, { fileId: 'file_B', anchorId: 'seg_9', scope: 'group', at: t(6) });
    // a call belonging to no document — the concept draft on pasted text
    write(ledger, { fileId: null, anchorId: null, scope: 'ingest', at: t(7) });
    return ledger;
  }

  it('nests: thread <= file <= app, on calls and on tokens', () => {
    const ledger = populated();
    const app = ledger.summary({ level: 'app' });
    const file = ledger.summary({ level: 'file', fileId: 'file_A' });
    const thread = ledger.summary({ level: 'thread', fileId: 'file_A', anchorId: 'seg_1' });

    expect(app.calls).toBe(7);
    expect(file.calls).toBe(5);
    expect(thread.calls).toBe(3);
    expect(thread.calls).toBeLessThanOrEqual(file.calls);
    expect(file.calls).toBeLessThanOrEqual(app.calls);
    expect(thread.tokens.input).toBeLessThanOrEqual(file.tokens.input);
    expect(file.tokens.input).toBeLessThanOrEqual(app.tokens.input);
    expect(thread.estimatedUsd).toBeLessThanOrEqual(file.estimatedUsd);
    expect(file.estimatedUsd).toBeLessThanOrEqual(app.estimatedUsd);
  });

  /**
   * The ingest and the objectives tree have no room and no anchor. A file-level sum reached
   * through `room_id` would have missed them, which is why `file_id` is its own column.
   */
  it('puts the background ingest inside its file', () => {
    const file = populated().summary({ level: 'file', fileId: 'file_A' });
    expect(file.byScope.map((s) => s.key)).toContain('objectives');
  });

  it('breaks down by model, scope and backend, biggest first', () => {
    const ledger = populated();
    const app = ledger.summary({ level: 'app' });
    expect(app.byBackend).toHaveLength(1);
    expect(app.byBackend[0]!.calls).toBe(7);
    expect(app.byScope.reduce((n, s) => n + s.calls, 0)).toBe(app.calls);
    expect(app.byModel.reduce((n, s) => n + s.tokens.output, 0)).toBe(app.tokens.output);
    const totals = app.byScope.map((s) => s.tokens.input);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('refuses a level it cannot answer rather than returning a wrong number', () => {
    const ledger = populated();
    expect(() => ledger.summary({ level: 'file' })).toThrow(/fileId/);
    expect(() => ledger.summary({ level: 'thread' })).toThrow(/anchorId/);
    // 'deck' is the same literal on every document, so it is not a thread on its own.
    expect(() => ledger.summary({ level: 'thread', anchorId: 'deck' })).toThrow(/not unique/);
    expect(() => ledger.summary({ level: 'thread', anchorId: 'deck', fileId: 'file_A' })).not.toThrow();
  });
});

describe('windows', () => {
  it('counts only calls since the app started for the session window', () => {
    const { ledger } = ledgerAt();
    write(ledger, { at: new Date(T0 - 60_000).toISOString() });
    write(ledger, { at: new Date(T0 + 60_000).toISOString() });
    expect(ledger.summary({ level: 'app' }).calls).toBe(2);
    const session = ledger.summary({ level: 'app', since: SESSION_WINDOW });
    expect(session.calls).toBe(1);
    expect(session.windowStart).toBe(new Date(T0).toISOString());
  });

  it('has no window start for all time', () => {
    const { ledger } = ledgerAt();
    write(ledger);
    expect(ledger.summary({ level: 'app' }).windowStart).toBeNull();
  });

  /**
   * On a subscription the 5-hour window is the constraint, not a bill. It is rolling from now,
   * it counts only CLI calls, and it is absent when there are none.
   */
  it('reports the rolling 5-hour CLI window and nothing else', () => {
    let now = T0;
    const { ledger } = ledgerAt(() => now);
    write(ledger, { at: new Date(T0 - 6 * 3_600_000).toISOString(), tokens: { input: 99_999, output: 0, cacheWrite: 0, cacheRead: 0 } });
    write(ledger, { at: new Date(T0 - 2 * 3_600_000).toISOString(), tokens: { input: 1_000, output: 100, cacheWrite: 0, cacheRead: 0 } });
    write(ledger, { backend: 'anthropic', at: new Date(T0 - 60_000).toISOString(), tokens: { input: 5_000, output: 0, cacheWrite: 0, cacheRead: 0 } });

    const w = ledger.cliWindow()!;
    expect(w.hours).toBe(5);
    expect(w.calls).toBe(1);
    expect(w.tokens.input).toBe(1_000);

    // Move the clock past the window and it empties.
    now = T0 + 4 * 3_600_000;
    expect(ledger.cliWindow()).toBeNull();
  });

  it('gives an API-only install no CLI window at all', () => {
    const { ledger } = ledgerAt();
    write(ledger, { backend: 'anthropic' });
    expect(ledger.summary({ level: 'app' }).cliWindow).toBeNull();
    expect(ledger.summary({ level: 'app' }).mode).toBe('api');
  });
});

describe('recordIfNew', () => {
  it('is idempotent on the same deterministic id', () => {
    const { ledger } = ledgerAt();
    const input = {
      id: 'use_backfill_1',
      scope: 'group' as const,
      model: 'claude-sonnet-5',
      backend: 'claude-cli' as const,
      tokens: { input: 10, output: 1, cacheWrite: 0, cacheRead: 0 },
    };
    expect(ledger.recordIfNew(input)).toBe(true);
    expect(ledger.recordIfNew(input)).toBe(false);
    expect(ledger.count()).toBe(1);
    expect(ledger.summary({ level: 'app' }).backfilledCalls).toBe(1);
  });
});

// ── the decorator ───────────────────────────────────────────────────────────

const REQUEST: LlmRequest = {
  model: 'sonnet',
  max_tokens: 100,
  system: [{ type: 'text', text: 'x' }],
  messages: [{ role: 'user', content: 'y' }],
  meta: { scope: 'group', roomId: 'room_1', turnId: 'turn_3', anchorId: 'seg_1', fileId: 'file_A' },
};

const RESULT: LlmResult = {
  text: 'hello',
  model: 'claude-sonnet-5-20260401',
  usage: {
    input_tokens: 12,
    output_tokens: 3,
    cache_read_input_tokens: 6_140,
    cache_creation_input_tokens: 540,
  },
  ttftMs: 100,
  backend: 'claude-cli',
  costUsd: 0.0057,
};

describe('the client decorator', () => {
  it('maps a completed call onto a ledger row, keeping the model that actually answered', () => {
    const input = recordFor(REQUEST, RESULT, 'claude-cli', 4_060);
    expect(input.model).toBe('claude-sonnet-5-20260401');
    expect(input.scope).toBe('group');
    expect(input.tokens).toEqual({ input: 12, output: 3, cacheWrite: 540, cacheRead: 6_140 });
    expect(input.reportedUsd).toBe(0.0057);
    expect(input.anchorId).toBe('seg_1');
    expect(input.fileId).toBe('file_A');
    expect(input.turnId).toBe('turn_3');
    expect(input.durationMs).toBe(4_060);
  });

  it('honours costScope, so the objectives ingest is not billed as the concept ingest', () => {
    const req = { ...REQUEST, meta: { ...REQUEST.meta, scope: 'ingest' as const, costScope: 'objectives' as const } };
    expect(recordFor(req, RESULT, 'claude-cli', 0).scope).toBe('objectives');
  });

  /** A broken accounting write must never cost the learner their turn. */
  it('returns the reply even when the ledger throws', async () => {
    const inner: LLMClient = { kind: 'claude-cli', complete: async () => RESULT };
    const client = costedClient(
      inner,
      {
        record() {
          throw new Error('disk full');
        },
      },
      () => ({ warn: () => {}, info: () => {}, debug: () => {}, error: () => {} }) as never,
    );
    await expect(client.complete(REQUEST)).resolves.toMatchObject({ text: 'hello' });
  });

  it('records exactly one row per call, through the decorator', async () => {
    const { ledger } = ledgerAt();
    const inner: LLMClient = { kind: 'claude-cli', complete: async () => RESULT };
    const client = costedClient(inner, ledger);
    await client.complete(REQUEST);
    await client.complete(REQUEST);
    expect(ledger.count()).toBe(2);
    expect(ledger.summary({ level: 'thread', fileId: 'file_A', anchorId: 'seg_1' }).calls).toBe(2);
  });
});
