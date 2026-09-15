/**
 * The REFERENCE path, and the four properties that make an `answer` not an agent turn.
 *
 * `flow-build-plan.md` §4.3 lists them and says why the fourth matters most: the lock is *"the
 * mechanism that turns 'the AI gave me the answer' from the disease into the hook"*. All four are
 * asserted against the real actor, the real timer and the real ledger — not against a mock.
 */
import { describe, expect, it } from 'vitest';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { RoomActor } from './actor.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { ScriptedClient } from './llm/scripted.js';
import type { RoomEvent } from '../shared/types.js';
import {
  HAND_BACK_LINE,
  REFERENCE_WORD_CAP,
  RULE_LINE,
  anyAnchorLocked,
  buildReferenceRequest,
  composeReferenceBody,
  explainBack,
  findReferenceParticipant,
  isAnchorLocked,
  messagesForAnchor,
  truncateToWords,
  type ReferenceAnswerState,
} from './reference.js';

const SEGMENT_TEXT =
  'Theorem 3.2. A twice-differentiable f is convex on an open convex S iff ∇²f(x) is positive semidefinite for all x ∈ S.';

function build() {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm: new ScriptedClient(),
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    config: DEFAULT_ROOM_CONFIG,
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
  });
  actor.start();
  return { ...seeded, clock, events, actor };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 30_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

describe('the 120-word cap, applied in code', () => {
  it('leaves a short answer exactly as it was written', () => {
    const short = 'A symmetric matrix H is positive semidefinite when zᵀHz ≥ 0 for every vector z.';
    expect(truncateToWords(short).truncated).toBe(false);
    expect(truncateToWords(short).text).toBe(short);
  });

  it('hard-truncates a long one, whatever the model or the script supplied', () => {
    // pivot-spec.md §B1: "Capped at 120 words, hard-truncated in code". A cap a model is asked
    // to respect is a cap that is exceeded on the take you keep.
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const cut = truncateToWords(long);
    expect(cut.truncated).toBe(true);
    expect(cut.text.split(/\s+/).length).toBeLessThanOrEqual(REFERENCE_WORD_CAP + 1);
  });

  it('cuts on a sentence end when one is close, and never mid-clause without an ellipsis', () => {
    const sentences = `${Array.from({ length: 40 }, () => 'alpha beta gamma delta epsilon').join('. ')}.`;
    const cut = truncateToWords(sentences);
    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith('.') || cut.text.endsWith('…')).toBe(true);
  });

  it('composes the card as answer, rule, hand-back', () => {
    const { body } = composeReferenceBody('PSD is a statement about zᵀHz, not about the entries.');
    expect(body).toContain(RULE_LINE);
    expect(body.endsWith(HAND_BACK_LINE)).toBe(true);
    // The hand-back is the point of the card: reading is not explaining.
    expect(body).toContain('in your own words');
  });
});

describe('the request', () => {
  const request = buildReferenceRequest({
    model: 'claude-sonnet-5',
    roomId: 'room_test',
    deckTitle: 'Convexity and the Hessian',
    segmentText: SEGMENT_TEXT,
    question: 'what does positive semidefinite actually mean?',
  });

  it('is its own scope, not a group turn wearing a different name', () => {
    expect(request.meta.scope).toBe('reference');
    expect(request.meta.agentKey).toBeUndefined();
  });

  it('sees the segment and the question, and nothing else', () => {
    const everything = `${request.system.map((b) => b.text).join('\n')}\n${request.messages.map((m) => m.content).join('\n')}`;
    expect(everything).toContain(SEGMENT_TEXT);
    expect(everything).toContain('positive semidefinite actually mean');
    // No transcript, no ledger, no concept pack, no roster.
    expect(everything).not.toMatch(/Ellie|Max|ledger|HOUSE RULES|SAFEGUARDS/);
  });

  it('states register-not-disguise, and forbids a persona rather than asking nicely', () => {
    const system = request.system[0]!.text;
    expect(system).toContain('REGISTER, NOT DISGUISE');
    expect(system).toMatch(/not a person/i);
    expect(system).toMatch(/never speak in the first person/i);
    // It must not ask a question: the hand-back is the app's line, not the voice's.
    expect(system).toMatch(/do not end with a question/i);
    // The cap is NOT in the prompt. It is in truncateToWords().
    expect(system).not.toContain('120');
  });
});

describe('the gate — Ellie and Max are locked out until "Explain it back"', () => {
  const answers: ReferenceAnswerState[] = [{ answerId: 'm_2', anchorId: 'seg_3', explainedBackAt: null }];

  it('locks the anchor the answer landed on, and only that one', () => {
    expect(isAnchorLocked(answers, 'seg_3')).toBe(true);
    expect(isAnchorLocked(answers, 'seg_4')).toBe(false);
    expect(anyAnchorLocked(answers)).toBe(true);
  });

  it('cannot lock an unanchored answer, because there is no thread to keep anyone out of', () => {
    expect(isAnchorLocked([{ answerId: 'm_2', anchorId: null, explainedBackAt: null }], null)).toBe(false);
    expect(anyAnchorLocked([{ answerId: 'm_2', anchorId: null, explainedBackAt: null }])).toBe(false);
  });

  it('unlocks on the press, and the press is not undoable by a second answer id', () => {
    const after = explainBack(answers, 'm_2', 1_000);
    expect(isAnchorLocked(after, 'seg_3')).toBe(false);
    expect(explainBack(after, 'm_9', 2_000)).toEqual(after);
  });
});

describe('anchored threads', () => {
  it('reads one segment\u2019s thread and leaves the rest of the room alone', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(
      h.clock,
      h.actor.askHere({ anchorId: 'seg_3', question: 'what does PSD actually mean?', segmentText: SEGMENT_TEXT }),
      6_000,
    );
    const thread = messagesForAnchor(h.store.messages.forRoom(h.roomId), 'seg_3');
    expect(thread).toHaveLength(2); // the question and the card
    expect(thread.map((m) => m.seq)).toEqual([...thread.map((m) => m.seq)].sort((a, b) => a - b));
    // The opener is a room-level message and stays out of it.
    expect(messagesForAnchor(h.store.messages.forRoom(h.roomId), 'seg_9')).toEqual([]);
  });
});

describe('an answer is not an agent turn', () => {
  it('does not take the floor, reset the timer, or move the ledger', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());

    const room = () => h.store.rooms.get(h.roomId)!;
    const timerBefore = { deadline: room().deadline_ts, epoch: room().timer_epoch, fires: room().nudge_fires_this_round };
    const floorBefore = room().consecutive_agent_turns;
    const ledgerBefore = h.store.ledger.forSession(h.sessionId).map((r) => r.level);

    const out = await settle(
      h.clock,
      h.actor.askHere({ anchorId: 'seg_3', question: 'what does PSD actually mean?', segmentText: SEGMENT_TEXT }),
      6_000,
    );

    // (1) no floor.
    expect(room().consecutive_agent_turns).toBe(floorBefore);
    expect(room().pending_turn_id).toBeNull();
    // (2) no timer. The deadline, the fence and the nudge budget are all where they were.
    expect(room().deadline_ts).toBe(timerBefore.deadline);
    expect(room().timer_epoch).toBe(timerBefore.epoch);
    expect(room().nudge_fires_this_round).toBe(timerBefore.fires);
    // (3) no ledger.
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.level)).toEqual(ledgerBefore);

    // The card itself is real, anchored, capped and signed by nobody.
    const answer = h.store.messages.get(out.answerId)!;
    expect(answer.anchor_id).toBe('seg_3');
    expect(answer.body.endsWith(HAND_BACK_LINE)).toBe(true);
    expect(answer.body.split(/\s+/).length).toBeLessThan(REFERENCE_WORD_CAP + 20);
    const author = h.store.participants.get(answer.participant_id)!;
    expect(author.agent_key).toBeNull();
    expect(author.display_name).toBe('REFERENCE');
    // The learner's question is theirs, and is anchored to the same segment.
    expect(h.store.messages.get(out.questionId)!.anchor_id).toBe('seg_3');
  });

  it('is written by the voice the room was created with, which is not in the roster', async () => {
    const h = build();
    const reference = findReferenceParticipant(h.store.participants.forRoom(h.roomId))!;
    expect(reference).toBeDefined();
    expect(h.actor.snapshot().agents.map((a) => a.role)).toEqual(['peer', 'challenger']);
  });

  it('(4) keeps Ellie and Max out of that thread until the learner presses Explain it back', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const before = h.store.messages.forRoom(h.roomId).length;
    const out = await settle(
      h.clock,
      h.actor.askHere({ anchorId: 'seg_3', question: 'what does PSD actually mean?', segmentText: SEGMENT_TEXT }),
      6_000,
    );

    // While it is locked, a learner turn schedules nobody: the rules refuse before the model is
    // consulted at all, and the refusal is on the record.
    await settle(h.clock, h.actor.sendMessage('ok but is that the same as all entries being ≥ 0?'));
    const decisions = h.store.turnDecisions.forRoom(h.roomId);
    expect(decisions.at(-1)!.decided_by).toBe('rule:reference_locked');
    // Two rows added by the Ask (question + card) and one by the learner. No agent turn.
    expect(h.store.messages.forRoom(h.roomId).length).toBe(before + 3);

    // The press is what makes them eligible for the first time.
    expect(h.actor.explainBack(out.answerId)).toEqual({ unlocked: true, anchorId: 'seg_3' });
    await settle(h.clock, h.actor.sendMessage('it is about zᵀHz being ≥ 0 for every z, not the entries.'));
    expect(h.store.turnDecisions.forRoom(h.roomId).at(-1)!.decided_by).not.toBe('rule:reference_locked');
    expect(
      h.store.events
        .forSession(h.sessionId)
        .some((e) => e.type === 'reference.explain_back'),
    ).toBe(true);
  });

  it('refuses an empty question rather than inserting an empty card', async () => {
    const h = build();
    await expect(h.actor.askHere({ anchorId: 'seg_3', question: '   ', segmentText: SEGMENT_TEXT })).rejects.toThrow(
      /needs a question/,
    );
  });
});
