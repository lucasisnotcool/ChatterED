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
  lastSentenceEnd,
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
  segmentContext,
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
    context: segmentContext({ text: SEGMENT_TEXT }),
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
      h.actor.askHere({ anchorId: 'seg_3', question: 'what does PSD actually mean?', context: segmentContext({ text: SEGMENT_TEXT }) }),
      6_000,
    );
    const thread = messagesForAnchor(h.store.messages.forRoom(h.roomId), 'seg_3');
    expect(thread).toHaveLength(2); // the question and the card
    expect(thread.map((m) => m.seq)).toEqual([...thread.map((m) => m.seq)].sort((a, b) => a - b));
    // The opener is a room-level message and stays out of it.
    expect(messagesForAnchor(h.store.messages.forRoom(h.roomId), 'seg_9')).toEqual([]);
  });
});

describe('an Ask is a Teacher turn (#41)', () => {
  /**
   * **The four properties of `pivot-spec.md` \u00a7B1, three of them now inverted on purpose.**
   *
   * The card did not take the floor, did not reset the timer, could not be evidence, and locked
   * the thread. #41: the Teacher answers the entry question, so the first three are just what an
   * ordinary turn does, and the fourth is gone with the card. **The one that does not move is the
   * ledger**, because it never rested on the card \u2014 rule 1 requires evidence to be a verbatim
   * substring of a *learner* message, which no agent turn can ever be.
   */
  it('takes the floor and the timer, and still moves no ledger row', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());

    const room = () => h.store.rooms.get(h.roomId)!;
    const epochBefore = room().timer_epoch;
    const ledgerBefore = h.store.ledger.forSession(h.sessionId).map((r) => r.level);

    const out = await settle(
      h.clock,
      h.actor.askHere({ anchorId: 'seg_3', question: 'what does PSD actually mean?', context: segmentContext({ text: SEGMENT_TEXT }) }),
      30_000,
    );

    // It is a turn: one agent reply on the floor, the silence timer re-armed behind it.
    expect(room().consecutive_agent_turns).toBe(1);
    expect(room().pending_turn_id).toBeNull();
    expect(room().timer_epoch).toBeGreaterThan(epochBefore);
    // And the ledger has not moved, which is the property that was never the card's.
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.level)).toEqual(ledgerBefore);

    // The answer is the Teacher's, anchored, with no hand-back line appended to it.
    const answer = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(answer.anchor_id).toBe('seg_3');
    expect(answer.body.endsWith(HAND_BACK_LINE)).toBe(false);
    const author = h.store.participants.get(answer.participant_id)!;
    expect(author.agent_key).toBe('peer.ellie');
    // The learner's question is theirs, and is anchored to the same segment.
    expect(h.store.messages.get(out.questionId)!.anchor_id).toBe('seg_3');
    // What it was answered from still rides on the row (issue #35's footer).
    expect(answer.scope_shown).toBe(out.scopeShown);
  });

  it('is written by the voice the room was created with, which is not in the roster', async () => {
    const h = build();
    const reference = findReferenceParticipant(h.store.participants.forRoom(h.roomId))!;
    expect(reference).toBeDefined();
    expect(h.actor.snapshot().agents.map((a) => a.role)).toEqual(['peer', 'challenger']);
  });

  it('(4) no longer locks the thread, and explainBack is a logged no-op', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(
      h.clock,
      h.actor.askHere({ anchorId: 'seg_3', question: 'what does PSD actually mean?', context: segmentContext({ text: SEGMENT_TEXT }) }),
      30_000,
    );

    // A follow-up in the same thread reaches the Teacher by rule \u2014 nothing refuses it.
    await settle(h.clock, h.actor.sendMessage('ok but is that the same as all entries being \u2265 0?', 'seg_3'), 30_000);
    const decisions = h.store.turnDecisions.forRoom(h.roomId);
    expect(decisions.at(-1)!.decided_by).toBe('rule:ellie_answers');
    expect(decisions.every((d) => d.decided_by !== 'rule:reference_locked')).toBe(true);

    // The old button still answers, does nothing, and says so in the log.
    expect(h.actor.explainBack('m_whatever')).toEqual({ unlocked: true, anchorId: null });
    expect(
      h.store.events
        .forSession(h.sessionId)
        .some((e) => e.type === 'reference.explain_back'),
    ).toBe(true);
  });

  it('refuses an empty question rather than inserting an empty card', async () => {
    const h = build();
    await expect(h.actor.askHere({ anchorId: 'seg_3', question: '   ', context: segmentContext({ text: SEGMENT_TEXT }) })).rejects.toThrow(
      /needs a question/,
    );
  });
});

describe('what each scope is shown (issue #35)', () => {
  const OUTLINE = 'p. 1 — Uninformed search\np. 14 — A* search';

  const deck = buildReferenceRequest({
    model: 'claude-sonnet-5',
    roomId: 'room_test',
    deckTitle: 'Search and planning',
    context: {
      scope: 'deck',
      passageText: 'THE-WHOLE-DECK',
      outline: OUTLINE,
      retrievedPages: [],
      scopeShown: 'whole deck',
    },
    question: 'Can you summarise what I will be learning',
  });
  const page = buildReferenceRequest({
    model: 'claude-sonnet-5',
    roomId: 'room_test',
    deckTitle: 'Search and planning',
    context: segmentContext({ text: 'ONE-PAGE', page: 14, outline: OUTLINE }),
    question: 'what does admissible mean',
  });

  it('gives a deck question the whole document, and says so', () => {
    const system = deck.system.map((b) => b.text).join('\n');
    expect(system).toContain('THE DOCUMENT, IN FULL:');
    expect(system).toContain('THE-WHOLE-DECK');
    expect(system).toContain('name the topics it actually covers');
  });

  it('gives a page question the page — and the outline, but only as a locator', () => {
    const system = page.system.map((b) => b.text).join('\n');
    expect(system).toContain('ONE-PAGE');
    expect(system).toContain(OUTLINE);
    expect(system).toContain('not for answering from');
    expect(system).toContain('Answer from the passage.');
    expect(system).not.toContain('THE DOCUMENT, IN FULL');
  });

  it('names the retrieved pages rather than implying it read the file', () => {
    const retrieved = buildReferenceRequest({
      model: 'claude-sonnet-5',
      roomId: 'room_test',
      deckTitle: 'A long reading',
      context: {
        scope: 'deck',
        passageText: '[p. 3]\nthree',
        outline: OUTLINE,
        retrievedPages: [3, 40],
        scopeShown: 'outline + pp. 3, 40',
      },
      question: 'what is the argument',
    });
    expect(retrieved.system.map((b) => b.text).join('\n')).toContain('pages 3, 40 of this document');
  });
});

/**
 * **The first live #41 summary card ended `…a different action (e.g.`** — 137 words of a 150-word
 * cap, cut at the abbreviation's own full stop. A card that ends mid-clause reads as a bug, which
 * is this function's own docstring; a maths deck is full of `e.g.`, `Fig.` and `p.`
 */
describe('truncation does not mistake an abbreviation for a sentence end', () => {
  it('walks back past e.g., Fig. and a single-letter symbol', () => {
    // The only later candidate is the abbreviation's own stop, so the answer is the earlier one.
    const text = 'One sentence ends here. Then a different action (e.g. Up) follows on';
    expect(lastSentenceEnd(text)).toBe(text.indexOf('here.') + 'here'.length);

    // Nothing but abbreviations and a decimal point: no sentence end at all.
    expect(lastSentenceEnd('See Fig. 17.1 for the grid')).toBe(-1);
    expect(lastSentenceEnd('Take the state S. It is the whole board')).toBe(-1);
    expect(lastSentenceEnd('no sentence end at all')).toBe(-1);
    // And a real one is still found, including at the very end of the string.
    expect(lastSentenceEnd('It sums to one.')).toBe('It sums to one'.length);
  });

  it('cuts the over-long card on a real sentence boundary', () => {
    const body =
      `${'word '.repeat(120)}The numbers sum to 1. That holds for a different action (e.g. Up) as well, ` +
      `${'tail '.repeat(60)}`;
    const { text, truncated } = truncateToWords(body, 150);
    expect(truncated).toBe(true);
    expect(text.endsWith('(e.g.')).toBe(false);
  });
});
