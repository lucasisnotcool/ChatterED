/**
 * **Ledger calls that could only ever be thrown away** (#49).
 *
 * Two shapes, both measured in `main.log`: 30 of 124 ledger calls judged a message that rule 4
 * (`isAgreementOnly`) then rejected whatever the model said, and 25 re-judged a `promote` turn with
 * no new learner message since the last run. Neither may be paid for, and the rail must end up
 * exactly where it would have.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor } from './actor.js';
import { isAgreementOnly } from './ledger.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';

const REPLY = 'On p. 2: “the Hessian is positive semidefinite” — that is the condition you needed.';
const ELEMENT = PSD_HESSIAN_CONVEXITY_V1.elements[0]!.id;
const SEG = 'seg_1';
const EXPLAINED =
  'The function is convex because its Hessian is positive semidefinite at every point of the domain.';
const AGREED = 'ok that makes sense';

interface Harness {
  ledgerCalls: () => number;
  failNextLedger: () => void;
  holdLedger: () => () => void;
}

function client(): LLMClient & { requests: LlmRequest[] } & Harness {
  const requests: LlmRequest[] = [];
  let fail = false;
  let hold: Promise<void> | null = null;
  return {
    kind: 'claude-cli',
    requests,
    ledgerCalls: () => requests.filter((r) => r.meta.scope === 'ledger').length,
    failNextLedger: () => {
      fail = true;
    },
    holdLedger: () => {
      let release: () => void = () => {};
      hold = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    async complete(request, onDelta) {
      requests.push(request);
      if (request.meta.scope === 'ledger') {
        if (hold) await hold;
        if (fail) {
          fail = false;
          throw new Error('The Claude CLI exited 1: no output');
        }
        // A proposal that would advance an element on the learner's own words, so rule 1 passes
        // and only rule 4 (or nothing) can stop it.
        const body = JSON.stringify({
          schema: 'ledger.v1',
          concept_id: PSD_HESSIAN_CONVEXITY_V1.concept_id,
          message_id: 'm',
          elements: [{ id: ELEMENT, level: 1, evidence: EXPLAINED, confidence: 0.9 }],
        });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
      }
      onDelta?.(REPLY);
      return { text: REPLY, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
    },
  };
}

function build() {
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
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 60_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const progressUpdates = (h: ReturnType<typeof build>) =>
  h.store.events
    .forSession(h.sessionId)
    .filter((e) => e.type === 'progress.update')
    .map((e) => JSON.parse(e.payload) as Record<string, unknown>)
    // The flow-state variant shares the event name; only the ledger's own rows are counted.
    .filter((p) => p.flow === undefined);
const levels = (h: ReturnType<typeof build>) =>
  Object.fromEntries(h.store.ledger.forSession(h.sessionId).map((r) => [r.element_id, r.level]));

describe('a ledger call rule 4 would throw away', () => {
  it('is not made, and the rail records the same skip it always did', async () => {
    expect(isAgreementOnly(AGREED)).toBe(true);
    const h = build();
    const before = levels(h);
    await settle(h.clock, h.actor.sendMessage(AGREED, SEG));

    expect(h.llm.ledgerCalls()).toBe(0);
    expect(levels(h)).toEqual(before);
    const update = progressUpdates(h).at(-1)!;
    expect(update.skipped).toBe('agreement_not_evidence');
    expect(update.changed).toEqual([]);
    // The rail is still told, exactly as when the rule rejected a real proposal.
    const rail = h.events.filter((e) => e.type === 'ledger.updated');
    expect(rail).toHaveLength(1);
    expect(rail[0]!.type === 'ledger.updated' && rail[0]!.changed).toEqual([]);
  });

  it('is still made for a message with a claim in it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage(EXPLAINED, SEG));
    expect(h.llm.ledgerCalls()).toBe(1);
    expect(levels(h)[ELEMENT]).toBe(1);
  });
});

describe('a ledger re-run with no new learner message', () => {
  it('is skipped when the last run on that message succeeded', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage(EXPLAINED, SEG));
    expect(h.llm.ledgerCalls()).toBe(1);
    const updates = progressUpdates(h).length;

    // "+ Try this" is a `promote` turn: the learner pressed a button, and said nothing new.
    await settle(h.clock, h.actor.tryHere({ anchorId: SEG, objectiveId: ELEMENT }));
    expect(h.llm.ledgerCalls()).toBe(1);
    expect(progressUpdates(h)).toHaveLength(updates);
    expect(levels(h)[ELEMENT]).toBe(1);
  });

  it('is skipped when the run on that message is still in flight, once it succeeds', async () => {
    const h = build();
    const release = h.llm.holdLedger();
    await settle(h.clock, h.actor.sendMessage(EXPLAINED, SEG));
    await settle(h.clock, h.actor.tryHere({ anchorId: SEG, objectiveId: ELEMENT }));
    release();
    await settle(h.clock, Promise.resolve());
    expect(h.llm.ledgerCalls()).toBe(1);
    expect(levels(h)[ELEMENT]).toBe(1);
  });

  it('still runs when the last run on that message failed', async () => {
    const h = build();
    h.llm.failNextLedger();
    await settle(h.clock, h.actor.sendMessage(EXPLAINED, SEG));
    expect(levels(h)[ELEMENT]).toBe(0);
    await settle(h.clock, h.actor.tryHere({ anchorId: SEG, objectiveId: ELEMENT }));
    expect(h.llm.ledgerCalls()).toBe(2);
    expect(levels(h)[ELEMENT]).toBe(1);
  });

  it('runs again for a new learner message', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage(EXPLAINED, SEG));
    await settle(h.clock, h.actor.sendMessage(`${EXPLAINED} And a PSD Hessian everywhere is the condition.`, SEG));
    expect(h.llm.ledgerCalls()).toBe(2);
  });
});
