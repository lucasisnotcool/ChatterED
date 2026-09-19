/**
 * **Every call site files its call under the right document, thread, turn and scope** (#42 item A).
 *
 * The ledger's own tests prove the arithmetic; this proves the *attribution*, which is the half
 * that cannot be checked by looking at a summary — a call filed under a null anchor still adds up
 * correctly at app level and simply disappears from the surface the learner was looking at. That
 * is exactly how the whisper gap got to today unnoticed.
 *
 * So the whole room runs for real: the scripted backend, the real orchestrator, the real ledger
 * call, the real doc-edit planner, the real latency floor — with `costedClient` wrapped around
 * the client exactly as `backend.createClient()` wraps it in the app, writing into a real
 * `CostLedger` over a migrated in-memory database. What the table says afterwards is what the app
 * would have said.
 *
 * The table these tests defend, one row per call site:
 *
 *   call site                      scope           room  file  thread  turn
 *   ─────────────────────────────  ──────────────  ────  ────  ──────  ────
 *   agent turn (#generate)         group            ✓     ✓      ✓      ✓
 *   Ellie's cue (peer_guess)       group            ✓     ✓      ✓      ✓
 *   orchestrator decision          orchestrator     ✓     ✓      ✓      ✓
 *   ledger coding                  ledger           ✓     ✓      ✓      ✓
 *   doc-edit planner               docedit          ✓     ✓      ✓      ✓
 *   private thread (sendWhisper)   whisper          ✓     ✓      ✓      ✓
 *   summary card                   summary          ✓     ✓      ✓      ✓
 *   notes ingest window            notes            –     ✓      –      –
 *   objectives ingest              objectives       –     ✓      –      –
 *   concept ingest                 ingest           –     ✓      –      –
 *
 * A `–` is a deliberate absence, not a gap: the three ingests run **before the room exists**,
 * which is the whole reason `file_id` is a column of its own rather than a join through `rooms`.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../../shared/types.js';
import type { AgentDocOpBatch, OutlineEntry, QuizOutcome } from '../../shared/doc/types.js';
import { groupView } from '../db/store.js';
import { FakeClock } from '../../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, openTestDb, seedRoom } from '../../test-support/db.js';
import { rosterFor } from '../../room/agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from '../../room/concepts/psd-hessian-convexity-v1.js';
import { RoomActor, type RoomActorDeps } from '../../room/actor.js';
import type { DocPort } from '../../room/docport.js';
import { ScriptedClient } from '../../room/llm/scripted.js';
import { NOTES_SCRIPT } from '../../room/llm/script.notes.js';
import { EMPTY_USAGE, LlmAbortedError, type LLMClient, type LlmRequest } from '../../room/llm/types.js';
import { API_PLAN } from '../../room/llm/models.js';
import { CostLedger, type UsageRow } from './ledger.js';
import { costedClient } from './client.js';
import { analytics, messageCosts } from './analytics.js';

const DOC = 'doc';
const SPAN = 'span_0123456789ab';
const FILE = 'file_under_test';

function docPort(): { port: DocPort; edits: AgentDocOpBatch[] } {
  const edits: AgentDocOpBatch[] = [];
  const outline: OutlineEntry[] = [
    { blockId: 'b_aaa', kind: 'heading', path: [], text: 'The side channel', pages: [3], learnerText: false, questionId: null },
    { blockId: 'b_bbb', kind: 'paragraph', path: ['The side channel'], text: 'A private turn with one agent.', pages: [3], learnerText: false, questionId: null },
  ];
  const port: DocPort = {
    docId: () => 'doc_1',
    frozen: () => false,
    outlineNear: () => outline,
    blocksForPages: () => ['b_bbb'],
    hasQuestion: () => false,
    recordEdit: (input) => edits.push(input.batch),
    recordOutcome: (_o: Omit<QuizOutcome, 'id' | 'contentSha' | 'createdAt'>) => undefined,
  };
  return { port, edits };
}

/**
 * The scripted backend, plus JSON for the two schema-bound scopes it does not script.
 *
 * `usage` is non-zero on purpose. A row of zeroes proves that a row was written and nothing about
 * whether the numbers reached it, and the point of this file is that they reach it *with the right
 * ids on them*.
 */
function client(docEdit: Record<string, unknown> | null = null): LLMClient & { requests: LlmRequest[] } {
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const requests: LlmRequest[] = [];
  const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 400, cache_creation_input_tokens: 10 };
  return {
    kind: 'scripted',
    requests,
    async complete(request, onDelta, signal) {
      requests.push(request);
      if (request.meta.scope === 'docedit') {
        const body = JSON.stringify(docEdit ?? { edit: 'none', points_to: 'b_bbb', why: 'the notes already say it' });
        return { text: body, model: request.model, usage, ttftMs: 1, backend: 'scripted' as const };
      }
      /**
       * Ellie's cue (#48 §4.3) is the one agent turn that is schema-bound rather than streamed,
       * and it takes a different branch of `#generate`. It is here because a call that leaves by
       * a different door is exactly the kind that gets its `meta` set on the door it does not use.
       */
      if (request.meta.scope === 'group' && request.jsonSchema) {
        const body = JSON.stringify({ text: 'I think it is the forwarding that costs, but I am not sure.', has_mistake: false, claim: '' });
        return { text: body, model: request.model, usage, ttftMs: 1, backend: 'scripted' as const };
      }
      if (request.meta.scope === 'orchestrator') {
        const body = JSON.stringify({ speak: true, role: 'peer', move_type: 'respond', rationale: 'x' });
        return { text: body, model: request.model, usage, ttftMs: 1, backend: 'scripted' as const };
      }
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage, ttftMs: 1, backend: 'scripted' as const };
      }
      const result = await scripted.complete(request, onDelta, signal);
      return { ...result, usage };
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}) {
  const { db, store } = openTestDb();
  const seeded = seedRoom(store);
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const raw = client();
  const ledger = new CostLedger({
    db,
    readSetting: () => undefined,
    // The seeded material carries no file id; the app resolves this through `materials.file_id`
    // and a test that wants to assert file-level attribution has to answer it somehow.
    fileForRoom: () => FILE,
    startedAt: '2026-09-19T00:00:00.000Z',
  });
  const llm = costedClient(raw, ledger);
  const doc = docPort();
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm,
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    models: API_PLAN,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    docPort: doc.port,
    ...over,
  });
  actor.start();
  const rows = (): UsageRow[] => db.prepare('SELECT * FROM llm_usage ORDER BY rowid').all<UsageRow>();
  return { ...seeded, db, clock, events, actor, llm: raw, doc, ledger, rows };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 120_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const scopes = (rows: UsageRow[]): string[] => [...new Set(rows.map((r) => r.scope))].sort();

/** `turn_id → the scopes billed to it`. The shape item B rests on. */
function byTurn(rows: UsageRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.turn_id === null) continue;
    const set = out.get(row.turn_id) ?? new Set<string>();
    set.add(row.scope);
    out.set(row.turn_id, set);
  }
  return out;
}

// ── the group chat ──────────────────────────────────────────────────────────

describe('a learner question in the doc chat', () => {
  it('files every call it caused under the file, the thread and the turn that made it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const rows = h.rows();
    expect(rows.length).toBeGreaterThan(0);
    /**
     * Ellie's answer, Max's follow-up, the ledger coding and the doc-edit planner. **No
     * `orchestrator` row, and that is the correct answer** on this path: `rule:ellie_answers`
     * and `rule:max_followup` decide it in code and `decideTurn` returns before it reaches a
     * model, so there is nothing to bill. The room-level path below is where the decision does
     * consult one, and it is asserted there.
     */
    expect(scopes(rows)).toEqual(expect.arrayContaining(['group', 'ledger', 'docedit']));
    expect(scopes(rows)).not.toContain('orchestrator');

    for (const row of rows) {
      expect(row.room_id, `${row.scope} lost its room`).toBe(h.roomId);
      expect(row.file_id, `${row.scope} lost its file`).toBe(FILE);
      expect(row.anchor_id, `${row.scope} lost its thread`).toBe(DOC);
      expect(row.turn_id, `${row.scope} lost its turn`).toMatch(/^turn_/);
      expect(row.outcome).toBe('ok');
      // The numbers travelled with the ids: an attribution test that passed on zeroes would be
      // asserting that a row exists, not that it says anything.
      expect(row.input_tokens + row.output_tokens + row.cache_read_tokens).toBeGreaterThan(0);
    }
  });

  it('keeps a span thread’s calls on the span and not on the doc chat', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('what does a strict subset mean here?', SPAN));

    const anchors = new Set(h.rows().map((r) => r.anchor_id));
    expect(anchors).toEqual(new Set([DOC, SPAN]));
    // The nesting the three levels rest on: every call in the narrower thread is in the file.
    expect(h.rows().every((r) => r.file_id === FILE)).toBe(true);
  });

  /**
   * **One turn, one id, several calls** — which is the whole of item B. If the decision, the
   * ledger coding and the generation did not share a `turn_id`, a per-message meter would show
   * the generation alone and under-report every reply in the app by the orchestrator's tokens.
   */
  it('gives the generation, the ledger coding and the doc edit the same turn id', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const shared = [...byTurn(h.rows()).values()].filter((s) => s.size > 1);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some((s) => s.has('group') && s.has('ledger'))).toBe(true);
  });

  /**
   * **The orchestrator's own call.** It is only made where no rule decides the turn — the
   * pre-flow room-level stream, which is a message with no anchor — and when it is made it has
   * to carry the turn it is deciding, or a per-message meter would under-report every reply in
   * the app by the decision's tokens.
   */
  it('bills the orchestrator decision to the turn it decided', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', null));

    const decisions = h.rows().filter((r) => r.scope === 'orchestrator');
    expect(decisions.length).toBeGreaterThan(0);
    for (const row of decisions) {
      expect(row.room_id).toBe(h.roomId);
      expect(row.file_id).toBe(FILE);
      expect(row.turn_id).toMatch(/^turn_/);
      // No thread, because the room-level stream is not one. A null here is the schema being
      // honest, not a dropped id.
      expect(row.anchor_id).toBeNull();
    }
    const shared = [...byTurn(h.rows()).values()];
    expect(shared.some((s) => s.has('group') && s.has('orchestrator'))).toBe(true);
  });
});

// ── the doc-edit planner (#48 §5) ───────────────────────────────────────────

describe('the doc-edit planner', () => {
  it('bills to the file, the thread and the turn that caused it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const docedit = h.rows().filter((r) => r.scope === 'docedit');
    expect(docedit.length).toBeGreaterThan(0);
    for (const row of docedit) {
      expect(row.file_id).toBe(FILE);
      expect(row.anchor_id).toBe(DOC);
      expect(row.turn_id).toMatch(/^turn_/);
    }
    // And it is the *same* turn as the reply it ran beside, not a turn of its own — the edit is
    // part of what that message cost.
    const group = h.rows().filter((r) => r.scope === 'group').map((r) => r.turn_id);
    expect(group).toContain(docedit[0]!.turn_id);
  });
});

// ── the private threads (#48 §4.6) ──────────────────────────────────────────

describe('a private thread', () => {
  /**
   * The gap this file was written to find. Before 2026-09-19 `buildWhisperContext` set no
   * `anchorId` at all, so every whisper call landed with a null anchor: it counted at file level
   * and was invisible in the thread the learner was reading.
   */
  it('bills the whisper to its own thread, not to nothing', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendWhisper('wt_1', 'is this going to be on the test?'));

    const whispers = h.rows().filter((r) => r.scope === 'whisper');
    expect(whispers).toHaveLength(1);
    expect(whispers[0]!.anchor_id).toBe('wt_1');
    expect(whispers[0]!.room_id).toBe(h.roomId);
    expect(whispers[0]!.file_id).toBe(FILE);
    expect(whispers[0]!.turn_id).toMatch(/^turn_/);
  });

  it('puts the same turn id on the whisper row, so the reply can be priced', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendWhisper('wt_1', 'is this going to be on the test?'));

    const reply = h.store.whispers.forThread('wt_1').find((w) => w.sender === 'agent')!;
    const call = h.rows().find((r) => r.scope === 'whisper')!;
    expect(reply.turn_id).toBe(call.turn_id);

    // …and the join really answers, which is what `cost:messages` does for a `PrivateThread`.
    const priced = messageCosts({ db: h.db, sessionStart: '2026-09-19T00:00:00.000Z' }, { roomId: h.roomId });
    const row = priced.find((p) => p.messageId === reply.id);
    expect(row?.kind).toBe('whisper');
    expect(row?.byScope.map((s) => s.key)).toEqual(['whisper']);
  });

  /**
   * The learner's own private message carries the turn id too (both halves of the exchange do,
   * so the reply is findable from either) — and it must not therefore be *charged* for it. The
   * query filters to `sender = 'agent'` for exactly this reason.
   */
  it('does not report the learner’s own private message as a cost', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendWhisper('wt_1', 'is this going to be on the test?'));

    const mine = h.store.whispers.forThread('wt_1').find((w) => w.sender === 'student')!;
    const priced = messageCosts({ db: h.db, sessionStart: '2026-09-19T00:00:00.000Z' }, { roomId: h.roomId });
    expect(priced.map((p) => p.messageId)).not.toContain(mine.id);
  });
});

// ── the summary card (#41) ──────────────────────────────────────────────────

describe('a summary card', () => {
  it('bills the card’s own call to its thread and to a turn of its own', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const before = h.rows().length;
    await settle(h.clock, h.actor.summarise(DOC));

    const added = h.rows().slice(before);
    const summary = added.find((r) => r.scope === 'summary');
    expect(summary, 'the summary call was not billed as `summary`').toBeDefined();
    expect(summary!.anchor_id).toBe(DOC);
    expect(summary!.file_id).toBe(FILE);
    expect(summary!.turn_id).toMatch(/^turn_/);
    // Its own turn: the learner pressed a button, and it must not be added to the reply above it.
    expect(h.rows().filter((r) => r.turn_id === summary!.turn_id)).toHaveLength(1);
  });
});

// ── per message (#42 item B) ────────────────────────────────────────────────

describe('cost:messages', () => {
  it('prices each agent reply by every call its turn made, and prices no learner message', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const messages = h.store.messages.forRoom(h.roomId);
    const priced = messageCosts({ db: h.db, sessionStart: '2026-09-19T00:00:00.000Z' }, { roomId: h.roomId });
    const byId = new Map(priced.map((p) => [p.messageId, p]));

    const learner = messages[0]!;
    expect(byId.has(learner.id), 'a learner message must carry no meter').toBe(false);

    const ellie = messages[1]!;
    const row = byId.get(ellie.id);
    expect(row, 'the agent reply was not priced').toBeDefined();
    expect(row!.calls).toBeGreaterThan(1);
    expect(row!.byScope.map((s) => s.key)).toEqual(expect.arrayContaining(['group', 'ledger']));
    expect(row!.tokens.input).toBeGreaterThan(0);
    expect(row!.mode).toBe('none'); // the scripted backend bills nothing, and says so

    // The message sums are a partition of the room's rows: nothing double-counted, because one
    // call has one turn id and one turn belongs to one message.
    const total = priced.reduce((n, p) => n + p.calls, 0);
    const withTurns = h.rows().filter((r) => r.turn_id !== null).length;
    expect(total).toBeLessThanOrEqual(withTurns);
  });

  it('narrows to one thread when asked', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('what does a strict subset mean here?', SPAN));

    const deps = { db: h.db, sessionStart: '2026-09-19T00:00:00.000Z' };
    const span = messageCosts(deps, { roomId: h.roomId, threadId: SPAN });
    expect(span.length).toBeGreaterThan(0);
    expect(span.every((p) => p.anchorId === SPAN)).toBe(true);
    expect(span.length).toBeLessThan(messageCosts(deps, { roomId: h.roomId }).length);
  });
});

// ── the failure path (#42's known gap) ──────────────────────────────────────

describe('a call that never returns', () => {
  const request: LlmRequest = {
    model: 'claude-sonnet-5',
    max_tokens: 100,
    system: [{ type: 'text', text: 'x' }],
    messages: [{ role: 'user', content: 'y' }],
    meta: { scope: 'notes', costScope: 'notes', fileId: FILE },
  };

  function ledgerOnly() {
    const { db } = openTestDb();
    const ledger = new CostLedger({ db, readSetting: () => undefined, fileForRoom: () => null });
    const rows = (): UsageRow[] => db.prepare('SELECT * FROM llm_usage ORDER BY rowid').all<UsageRow>();
    return { db, ledger, rows };
  }

  function throwing(err: Error): LLMClient {
    return { kind: 'claude-cli', complete: async () => { throw err; } };
  }

  it('is still recorded, flagged, and keeps its attribution', async () => {
    const h = ledgerOnly();
    const client = costedClient(throwing(new Error('The Claude CLI exited 1: no output')), h.ledger);
    await expect(client.complete(request)).rejects.toThrow(/exited 1/);

    const [row] = h.rows();
    expect(row!.outcome).toBe('error');
    expect(row!.scope).toBe('notes');
    expect(row!.file_id).toBe(FILE);
    expect(row!.backend).toBe('claude-cli');
  });

  it('separates the learner’s Stop from a failure', async () => {
    const h = ledgerOnly();
    const client = costedClient(throwing(new LlmAbortedError()), h.ledger);
    await expect(client.complete(request)).rejects.toThrow(LlmAbortedError);
    expect(h.rows()[0]!.outcome).toBe('aborted');
  });

  it('records a pre-empted notes window, with whatever the backend had reported', async () => {
    const h = ledgerOnly();
    const err = new Error('The lane was taken.');
    err.name = 'CliPreemptedError';
    Object.defineProperty(err, 'llmUsage', {
      value: { usage: { ...EMPTY_USAGE, input_tokens: 42, cache_read_input_tokens: 900 }, model: 'claude-sonnet-5', costUsd: 0.004 },
      enumerable: false,
    });
    const client = costedClient(throwing(err), h.ledger);
    await expect(client.complete(request)).rejects.toThrow('The lane was taken.');

    const [row] = h.rows();
    expect(row!.outcome).toBe('preempted');
    expect(row!.input_tokens).toBe(42);
    expect(row!.cache_read_tokens).toBe(900);
    expect(row!.reported_cost_usd).toBe(0.004);
    // The re-queued window that follows is a *second* row. Both are real; the flag is what stops
    // the pair from reading as an ingest that invented a call.
    expect(row!.estimated_cost_usd).toBeGreaterThan(0);
  });

  it('never lets an accounting failure change what the caller sees', async () => {
    const broken = { record: () => { throw new Error('disk full'); } };
    const ok = costedClient(
      { kind: 'claude-cli', complete: async () => ({ text: 'hi', model: 'm', usage: EMPTY_USAGE, ttftMs: 1 }) },
      broken,
      () => ({ info: () => undefined, warn: () => undefined, error: () => undefined, event: () => undefined }) as never,
    );
    await expect(ok.complete(request)).resolves.toMatchObject({ text: 'hi' });

    const failing = costedClient(throwing(new Error('boom')), broken, () => ({ info: () => undefined, warn: () => undefined, error: () => undefined, event: () => undefined }) as never);
    await expect(failing.complete(request)).rejects.toThrow('boom');
  });
});

// ── the background ingests ──────────────────────────────────────────────────

describe('the ingests, which have no room', () => {
  /**
   * The notes ingest, the objectives tree and the concept pack all run **before a room exists**,
   * and all three are per-file costs a learner must be able to see against the deck they opened.
   * Their meta is set at the call site (`notes/ingest.ts`, `objectives/ingest.ts`,
   * `sessions.ts`); what this checks is that the ledger keeps a file-level row that has no room.
   */
  it('are visible at file level with no room and no thread', () => {
    const { db } = openTestDb();
    const ledger = new CostLedger({ db, readSetting: () => undefined, fileForRoom: () => null });
    const tokens = { input: 4_000, output: 900, cacheWrite: 0, cacheRead: 22_000 };
    ledger.record({ scope: 'notes', model: 'claude-sonnet-5', backend: 'claude-cli', tokens, fileId: FILE });
    ledger.record({ scope: 'objectives', model: 'claude-sonnet-5', backend: 'claude-cli', tokens, fileId: FILE });
    ledger.record({ scope: 'ingest', model: 'claude-sonnet-5', backend: 'claude-cli', tokens, fileId: FILE });

    const summary = ledger.summary({ level: 'file', fileId: FILE });
    expect(summary.calls).toBe(3);
    expect(summary.byScope.map((s) => s.key).sort()).toEqual(['ingest', 'notes', 'objectives']);
    const rows = db.prepare('SELECT * FROM llm_usage').all<UsageRow>();
    expect(rows.every((r) => r.room_id === null && r.anchor_id === null)).toBe(true);
  });
});

// ── the budgeting numbers, and the rule none of this may break ──────────────

describe('cost per learner message', () => {
  /**
   * The numbers a course-wide deployment is budgeted from. Counted through the rooms the
   * *filtered calls* belong to rather than through `rooms.material_id`, because the ledger's
   * `file_id` is the one that already survives an ingest that happened before the room existed —
   * and two definitions of "this document's rooms" on one page is how a ratio comes to be off by
   * the decks that were opened and never talked to.
   */
  it('divides by the learner messages in the rooms the calls came from', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('the learner pays it when they forward', DOC));

    const a = analytics({ db: h.db, sessionStart: '2026-09-19T00:00:00.000Z' });
    expect(a.perMessage.learnerMessages).toBe(2);
    expect(a.perMessage.agentMessages).toBeGreaterThan(0);
    expect(a.perMessage.meanTokensPerLearnerMessage).toBeGreaterThan(0);
    // Mean over learner messages, median over agent replies: two different denominators on
    // purpose, and both are reported because a budget built on either alone is wrong in a
    // predictable direction.
    expect(a.perMessage.medianTokensPerAgentMessage).toBeGreaterThan(0);
  });
});

describe('no learner text may reach a cost surface', () => {
  /**
   * The invariant the CSV export already holds, extended to the two new channels. `llm_usage` has
   * no body column, so half of this is enforced by the schema — but `cost:messages` joins
   * `messages` and `whispers`, which are full of the learner's own words, and a careless `SELECT
   * m.*` would have carried every one of them to the renderer.
   */
  it('is true of cost:messages and of the analytics payload', async () => {
    const secret = 'zqxjkv the learner said this out loud';
    const h = build();
    await settle(h.clock, h.actor.sendMessage(secret, DOC));
    await settle(h.clock, h.actor.sendWhisper('wt_1', `${secret} privately`));

    const deps = { db: h.db, sessionStart: '2026-09-19T00:00:00.000Z' };
    const serialised = JSON.stringify([messageCosts(deps, { roomId: h.roomId }), analytics(deps)]);
    expect(serialised).not.toContain('zqxjkv');
    // And nothing that came back is a body under another name: the only strings on these shapes
    // are ids, model names, scopes and timestamps.
    expect(serialised).not.toContain('side channel');
  });
});

describe('Ellie’s cue', () => {
  /**
   * The schema-bound turn (#48 §4.3). It leaves `#generate` by a different door from every other
   * agent turn, which is exactly the kind of call that ends up with its `meta` set on the door it
   * does not use — so it is asserted on its own rather than assumed to be covered by `group`.
   */
  it('is billed like any other turn, to the thread and the turn that fired it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const before = h.rows().length;
    // Max's question has waited past the reading time with no attempt: `rule:ellie_cue`.
    await settle(h.clock, Promise.resolve(), 200_000);

    const cued = h.llm.requests.find((r) => r.meta.scope === 'group' && r.jsonSchema !== undefined);
    expect(cued, 'the cue never fired').toBeDefined();
    expect(cued!.meta.turnId).toMatch(/^turn_/);
    expect(cued!.meta.anchorId).toBe(DOC);

    const added = h.rows().slice(before).filter((r) => r.scope === 'group');
    expect(added.length).toBeGreaterThan(0);
    for (const row of added) {
      expect(row.anchor_id).toBe(DOC);
      expect(row.file_id).toBe(FILE);
      expect(row.turn_id).toMatch(/^turn_/);
    }
  });
});

describe('a doc-text assessment', () => {
  /**
   * §6's carrier: the learner's own writing in the document, inserted as a synthetic learner
   * message in the span's thread and then judged by the existing pipeline. There is no call *for*
   * the carrier — it is the learner's words — so the row that matters is the turn it triggers,
   * and it has to land on the span rather than on the doc chat.
   */
  it('bills the turn it triggers to the span thread the text came from', async () => {
    const h = build();
    await settle(
      h.clock,
      h.actor.assessDocText({ anchorId: SPAN, objectiveId: 'obj_1', blockId: 'b_mine', text: 'the cost moves to forwarding' }),
    );

    const rows = h.rows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.anchor_id === SPAN)).toBe(true);
    expect(rows.every((r) => r.file_id === FILE && r.turn_id !== null)).toBe(true);
  });
});
