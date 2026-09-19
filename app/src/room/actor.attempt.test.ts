/**
 * **The attempt loop, through the actor** (issue #47, `docs/research/attempt-first.md` §2).
 *
 * `orchestrator.test.ts` proves the rules; this proves the wiring the rules cannot see: that
 * "+ Try this" opens a quiz at the *Teacher's* latency band, that an answer request before a try
 * gets a hint and after a try gets the answer, that the ledger is never run on the answer, that the
 * script cues of one question all carry its number, and that the thread reports its own quiz.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { LATENCY, rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor, type RoomActorDeps } from './actor.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';

const REPLY = 'On p. 2: “the Hessian is positive semidefinite” — that is the condition you needed.';
/** The element the fixture pack's first objective is, which is what the Try is aimed at. */
const ELEMENT = PSD_HESSIAN_CONVEXITY_V1.elements[0]!.id;
const SEG = 'seg_1';

function client(): LLMClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    kind: 'claude-cli',
    requests,
    async complete(request, onDelta) {
      requests.push(request);
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
      }
      onDelta?.(REPLY);
      return { text: REPLY, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
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

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 60_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const TRY = { anchorId: SEG, objectiveId: ELEMENT };
const cues = (h: ReturnType<typeof build>) =>
  h.llm.requests.filter((r) => r.meta.scope !== 'ledger' && r.meta.scope !== 'orchestrator').map((r) => r.meta.scriptCue);
const decisions = (h: ReturnType<typeof build>) => h.store.turnDecisions.forRoom(h.roomId);

describe('“+ Try this”', () => {
  it('is one Tester question on the card, decided by rule and not by a model', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));

    const messages = h.store.messages.forRoom(h.roomId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.anchor_id).toBe(SEG);
    expect(messages[0]!.participant_id).toBe(h.store.participants.byAgentKey(h.roomId, 'challenger.max')!.id);
    const decision = decisions(h).at(-1)!;
    expect(decision.move_type).toBe('quiz');
    expect(decision.decided_by).toBe('rule:try_here');
    expect(decision.target_element_id).toBe(ELEMENT);
    // §2.1: no model is asked who should speak — that is the same argument `rule:teacher_answers`
    // makes, and the hand-off is no longer the Tester's only door.
    expect(h.llm.requests.some((r) => r.meta.scope === 'orchestrator')).toBe(false);
  });

  /**
   * §2.1: *"the question uses the short band (the Teacher's): the learner asked for it. The feedback
   * keeps the Tester's 9–12 s: that is the considered judgement Tan et al. is about."*
   */
  it('arrives at the Teacher’s latency band, because the learner asked for it', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    const target = h.store.messages.forRoom(h.roomId)[0]!.latency_target_ms!;
    expect(target).toBeGreaterThanOrEqual(LATENCY.peer.ttftMinMs);
    expect(target).toBeLessThanOrEqual(LATENCY.peer.ttftMaxMs);
    expect(target).toBeLessThan(LATENCY.challenger.ttftMinMs);
  });

  it('opens the quiz, tags the thread with the objective, and reports it on that thread', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));

    expect(h.store.messages.forRoom(h.roomId)[0]!.objective_id).toBe(ELEMENT);
    const view = h.actor.pendingQuizView()!;
    expect(view.anchorId).toBe(SEG);
    expect(view.quiz.elementId).toBe(ELEMENT);
    expect(view.quiz.attempts).toBe(0);
    expect(view.quiz.feedbackGiven).toBe(false);
    expect(view.quiz.answerShown).toBe(false);
    expect(h.events.some((e) => e.type === 'timer.updated')).toBe(true);
    expect(h.actor.flowSnapshot().pendingQuiz!.attempts).toBe(0);
  });

  it('gives Max the page, so the grounds he is asked for are quotable', async () => {
    const h = build();
    await settle(
      h.clock,
      h.actor.tryHere({
        ...TRY,
        context: {
          scope: 'segment',
          passageText: 'A twice-differentiable f is convex iff its Hessian is PSD everywhere.',
          outline: '',
          retrievedPages: [],
          scopeShown: 'p. 2',
          page: 2,
          label: 'convexity and the Hessian',
        },
      }),
    );
    const prompt = h.llm.requests.find((r) => r.meta.scope === 'group')!.messages.at(-1)!.content;
    expect(prompt).toContain('WHERE THE LEARNER IS ASKING');
    expect(prompt).toContain('Hessian is PSD everywhere');
  });
});

describe('the answer lock, end to end', () => {
  async function asked() {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    return h;
  }

  it('hints and logs it when the answer is asked for before a try', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('answer?', SEG));

    const decision = decisions(h).at(-1)!;
    expect(decision.decided_by).toBe('rule:answer_withheld');
    expect(decision.move_type).toBe('quiz_hint');
    const logged = h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_withheld');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.payload).attempts).toBe(0);
    // Still open, still nothing attempted: asking twice cannot work.
    expect(h.actor.pendingQuizView()!.quiz.attempts).toBe(0);
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);
  });

  it('tells Max, in the directive, that one try unlocks it', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('please solve the question', SEG));
    const prompt = h.llm.requests.filter((r) => r.meta.scope === 'group').at(-1)!.messages.at(-1)!.content;
    expect(prompt).toContain('not given before one attempt');
    expect(prompt).toContain('one try unlocks it');
  });

  it('counts an attempt, owes feedback for it, and keeps the question open afterwards', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));

    expect(decisions(h).at(-1)!.decided_by).toBe('rule:quiz_feedback');
    const view = h.actor.pendingQuizView()!;
    expect(view.quiz.attempts).toBe(1);
    expect(view.quiz.feedbackGiven).toBe(true);
    expect(view.quiz.answerShown).toBe(false);
  });

  it('refuses “Show the answer” before a try, in the words the composer uses', async () => {
    const h = await asked();
    const out = await h.actor.showAnswer(SEG);
    expect(out.shown).toBe(false);
    expect(out.refused).toBe("Max won't give the answer until you've tried once.");
    // Nothing was said and nothing was logged as shown.
    expect(h.store.messages.forRoom(h.roomId)).toHaveLength(1);
    expect(h.store.events.forSession(h.sessionId).some((e) => e.type === 'quiz.answer_shown')).toBe(false);
  });

  it('refuses it on a thread with no open question of its own', async () => {
    const h = await asked();
    const out = await h.actor.showAnswer('seg_9');
    expect(out.shown).toBe(false);
    expect(out.refused).toBe('There is no open question here.');
  });

  /**
   * §2.3: *"The quiz closes; **the ledger is not run on this turn** and never moves on a shown
   * answer."* The ledger call is the one this asserts on, because it is the only mechanism by which
   * anything could be credited to the learner.
   */
  it('shows the answer after a try, closes the question, and never runs the ledger on it', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    const ledgerCallsBefore = h.llm.requests.filter((r) => r.meta.scope === 'ledger').length;

    const out = await settle(h.clock, h.actor.showAnswer(SEG));
    expect(out).toEqual({ shown: true, refused: null });
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:answer_shown');
    expect(decisions(h).at(-1)!.move_type).toBe('quiz_answer');
    expect(h.llm.requests.filter((r) => r.meta.scope === 'ledger')).toHaveLength(ledgerCallsBefore);

    const logged = h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_shown');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.payload).by).toBe('button');
    expect(JSON.parse(logged[0]!.payload).ledger_touched).toBe(false);
    // Closed: the renderer stops offering it, and no lock rule can fire on this question again.
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
    expect((await h.actor.showAnswer(SEG)).refused).toBe('There is no open question here.');
  });

  it('answers the same ask in the composer once there has been a try, and skips the ledger there too', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    const ledgerCallsBefore = h.llm.requests.filter((r) => r.meta.scope === 'ledger').length;

    await settle(h.clock, h.actor.sendMessage("what's the answer", SEG));
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:answer_shown');
    expect(h.llm.requests.filter((r) => r.meta.scope === 'ledger')).toHaveLength(ledgerCallsBefore);
    expect(JSON.parse(h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_shown')[0]!.payload).by).toBe(
      'answer_request',
    );
  });

  it('clarifies a question about the question without counting it as an attempt', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('what does PSD mean?', SEG));
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:quiz_clarify');
    expect(h.actor.pendingQuizView()!.quiz.attempts).toBe(0);
  });

  it('nudges an “ok”, which ledger rule 4 has always refused to credit', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('ok', SEG));
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:quiz_nudge');
    expect(h.actor.pendingQuizView()!.quiz.attempts).toBe(0);
  });
});

/**
 * **The script cues** (§2.1 and the scripted backend's beats). Every turn of question N carries
 * `:N`, across both doors, so a second question's feedback can never be played against the first.
 */
describe('the script cues of one Tester question', () => {
  it('numbers the question and everything that belongs to it', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(h.clock, h.actor.sendMessage('answer?', SEG));
    await settle(h.clock, h.actor.sendMessage('what does PSD mean?', SEG));
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    await settle(h.clock, h.actor.showAnswer(SEG));

    expect(cues(h)).toEqual(['try:1', 'hint:1', 'clarify:1', 'feedback:1', 'answer:1']);
  });

  it('counts a second question, so its turns cannot be cued as the first’s', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(h.clock, h.actor.sendMessage('It fails as soon as one eigenvalue is negative.', SEG));

    expect(cues(h)).toEqual(['try:1', 'feedback:1', 'try:2', 'feedback:2']);
  });
});
