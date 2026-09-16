/**
 * The actor's half of the learning-objective tree (issue #38): **Teach me this**, the objective
 * tag a thread carries, and the two callbacks the main process mirrors states through.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor, type RoomActorDeps } from './actor.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';

const TEACH_REPLY = 'A context window is the span of tokens the model can attend to in one call.';

function client(): LLMClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    kind: 'claude-cli',
    requests,
    async complete(request, onDelta) {
      requests.push(request);
      if (request.meta.scope === 'ledger') {
        // A well-formed proposal that moves nothing: this test is not about the ledger's rules.
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
      }
      onDelta?.(TEACH_REPLY);
      return { text: TEACH_REPLY, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client();
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
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'live' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    ...over,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 30_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const TEACH = {
  anchorId: 'seg_3',
  objectiveId: 'obj_ctx',
  title: 'What a context window is',
  statement: 'The bounded span of tokens a model can attend to in one call.',
  criteria: ['says it is bounded'],
  assumedByDeck: true,
  requiring: 'State what /btw promises to do',
};

describe('Teach me this', () => {
  it('posts a Teacher turn on the requiring objective’s anchor', async () => {
    const h = build();
    await settle(h.clock, h.actor.teachObjective(TEACH));

    const messages = h.store.messages.forRoom(h.roomId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe(TEACH_REPLY);
    expect(messages[0]!.anchor_id).toBe('seg_3');
    expect(messages[0]!.participant_id).toBe(h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!.id);
  });

  /**
   * The learner named the move. Asking a model who should speak would buy nothing and cost the
   * twenty seconds `orchestrator.ts` already refuses to spend on an anchored learner turn.
   */
  it('does not ask the orchestrator who should speak', async () => {
    const h = build();
    await settle(h.clock, h.actor.teachObjective(TEACH));
    expect(h.llm.requests.some((r) => r.meta.scope === 'orchestrator')).toBe(false);
    const decision = h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
    expect(decision.move_type).toBe('teach_objective');
    expect(decision.target_element_id).toBe('obj_ctx');
  });

  it('tells the Teacher the deck never teaches it, and what it is needed for', async () => {
    const h = build();
    await settle(h.clock, h.actor.teachObjective(TEACH));
    const group = h.llm.requests.find((r) => r.meta.scope === 'group')!;
    const prompt = group.messages.at(-1)!.content;
    expect(prompt).toContain('What a context window is');
    expect(prompt).toContain('general knowledge');
    expect(prompt).toContain('State what /btw promises to do');
  });

  it('records it as taught, so the Tester may quiz it later', async () => {
    const taught: { elementId: string; at: string }[] = [];
    const h = build({ onTaught: (input) => taught.push(input) });
    await settle(h.clock, h.actor.teachObjective(TEACH));
    expect(taught.map((t) => t.elementId)).toEqual(['obj_ctx']);
    expect(h.actor.flowSnapshot().taught.map((t) => t.elementId)).toContain('obj_ctx');
  });
});

describe('the objective a thread is about', () => {
  it('tags every message in the thread, not only the first', async () => {
    const h = build();
    await settle(h.clock, h.actor.teachObjective(TEACH));
    await settle(h.clock, h.actor.sendMessage('So it is bounded, and everything I add competes for it.', 'seg_3'));

    const rows = h.store.messages.forRoom(h.roomId);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.filter((r) => r.anchor_id === 'seg_3')) {
      expect(row.objective_id).toBe('obj_ctx');
    }
  });

  it('leaves another thread’s messages untagged', async () => {
    const h = build();
    await settle(h.clock, h.actor.teachObjective(TEACH));
    await settle(h.clock, h.actor.sendMessage('A question about a different slide.', 'seg_9'));
    const rows = h.store.messages.forRoom(h.roomId);
    expect(rows.find((r) => r.anchor_id === 'seg_9')!.objective_id).toBeNull();
  });

  it('survives a relaunch, so the next turn in the thread is still about the node', async () => {
    const h = build();
    await settle(h.clock, h.actor.teachObjective(TEACH));
    const snapshot = h.actor.flowSnapshot();
    expect(snapshot.objectives).toEqual({ seg_3: 'obj_ctx' });

    const again = build({ flowState: snapshot });
    await settle(again.clock, again.actor.sendMessage('Said again after a quit.', 'seg_3'));
    expect(again.store.messages.forRoom(again.roomId).at(-2)!.objective_id).toBe('obj_ctx');
  });
});

describe('the ledger callback', () => {
  it('fires after the rules, with the rows they produced', async () => {
    const seen: { rows: number; changed: string[] }[] = [];
    const h = build({ onLedgerApplied: ({ rows, changed }) => seen.push({ rows: rows.length, changed }) });
    await settle(h.clock, h.actor.sendMessage('An explanation in my own words about the Hessian.', 'seg_1'));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.rows).toBe(PSD_HESSIAN_CONVEXITY_V1.elements.length);
    // The stub proposal moves nothing, which is the point: the callback reports the rules'
    // output, it does not decide anything of its own.
    expect(seen[0]!.changed).toEqual([]);
  });
});
