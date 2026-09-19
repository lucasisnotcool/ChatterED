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
    // §2.1: no model is asked who should speak — that is the same argument `rule:ellie_answers`
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

/**
 * **The release, end to end** (#48, `collab-doc.md` §4.4; supersedes the answer lock of #47 §2.3).
 *
 * Every test below was an assertion that the answer was *withheld*. The brief deletes that rule
 * and records the deletion as a knowing departure from the transcript evidence rather than as a
 * finding: *"a learner must never see a question they never get the answer to, and a refused
 * answer teaches less than a lowered question."* So the same situations are asserted here with
 * the opposite outcome, and what took over the refusal's job — `pitch.pitchInputs`, which makes
 * the next question on that objective easier — is tested in `pitch.test.ts`.
 */
describe('releasing the answer, end to end', () => {
  async function asked() {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    return h;
  }

  it('releases the answer and logs it when the learner gives up before a try', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('answer?', SEG));

    const decision = decisions(h).at(-1)!;
    expect(decision.decided_by).toBe('rule:answer_released');
    expect(decision.move_type).toBe('quiz_answer');
    const logged = h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_released');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.payload).attempts).toBe(0);
    expect(JSON.parse(logged[0]!.payload).released_by).toBe('give_up');
    // §4.4: "It fills no progress." The question closes; nothing was credited.
    expect(JSON.parse(logged[0]!.payload).fills_progress).toBe(false);
    expect(h.actor.pendingQuizView()!.quiz.attempts).toBe(0);
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
  });

  it('never asks Max to claim the answer is locked behind an attempt', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('please solve the question', SEG));
    const prompt = h.llm.requests.filter((r) => r.meta.scope === 'group').at(-1)!.messages.at(-1)!.content;
    expect(prompt).not.toContain('not given before one attempt');
    expect(prompt).not.toContain('one try unlocks it');
    // What it says instead: give it, and do not reproach them for asking.
    expect(prompt).toContain('GIVE THE ANSWER');
    expect(prompt).toContain('No reproach');
  });

  /**
   * §4.4's "at any time, **with or without an attempt**", and the phrasings the brief adds to the
   * classifier. Each of these used to draw a hint and now draws the answer.
   */
  it('releases it on every one of the brief’s give-up phrasings', async () => {
    for (const line of ["I don't know", 'this is too hard', "I'm lost", 'idk']) {
      const h = await asked();
      await settle(h.clock, h.actor.sendMessage(line, SEG));
      expect(decisions(h).at(-1)!.decided_by, line).toBe('rule:answer_released');
      expect(h.actor.pendingQuizView()!.quiz.answerShown, line).toBe(true);
    }
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

  /**
   * **Pass no longer has an attempt precondition** (#48 §4.4). The composer's quiet line —
   * *"Max won't give the answer until you've tried once."* — goes with the rule it described.
   * The only refusal left is the one about the world rather than about the learner.
   */
  it('honours Pass before a try, and releases the answer', async () => {
    const h = await asked();
    const out = await settle(h.clock, h.actor.pass(SEG));
    expect(out).toEqual({ released: true, refused: null });
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:answer_released');
    const logged = h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_released');
    expect(JSON.parse(logged[0]!.payload).released_by).toBe('pass');
  });

  it('refuses it on a thread with no open question of its own', async () => {
    const h = await asked();
    const out = await h.actor.pass('seg_9');
    expect(out.released).toBe(false);
    expect(out.refused).toBe('There is no open question here.');
    // `showAnswer` is the same call under its frozen IPC name.
    expect(await h.actor.showAnswer('seg_9')).toEqual({ shown: false, refused: 'There is no open question here.' });
  });

  /**
   * §2.3: *"The quiz closes; **the ledger is not run on this turn** and never moves on a shown
   * answer."* The ledger call is the one this asserts on, because it is the only mechanism by which
   * anything could be credited to the learner.
   */
  it('releases it on Pass after a try, closes the question, and never runs the ledger on it', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    const ledgerCallsBefore = h.llm.requests.filter((r) => r.meta.scope === 'ledger').length;

    const out = await settle(h.clock, h.actor.showAnswer(SEG));
    expect(out).toEqual({ shown: true, refused: null });
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:answer_released');
    expect(decisions(h).at(-1)!.move_type).toBe('quiz_answer');
    expect(h.llm.requests.filter((r) => r.meta.scope === 'ledger')).toHaveLength(ledgerCallsBefore);

    const logged = h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_released');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.payload).released_by).toBe('pass');
    expect(JSON.parse(logged[0]!.payload).ledger_touched).toBe(false);
    // Closed: the renderer stops offering it, and no rule can fire on this question again.
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
    expect((await h.actor.showAnswer(SEG)).refused).toBe('There is no open question here.');
  });

  it('releases the same ask in the composer after a try, and skips the ledger there too', async () => {
    const h = await asked();
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    const ledgerCallsBefore = h.llm.requests.filter((r) => r.meta.scope === 'ledger').length;

    await settle(h.clock, h.actor.sendMessage("what's the answer", SEG));
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:answer_released');
    expect(h.llm.requests.filter((r) => r.meta.scope === 'ledger')).toHaveLength(ledgerCallsBefore);
    expect(
      JSON.parse(h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_released')[0]!.payload).released_by,
    ).toBe('give_up');
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
    await settle(h.clock, h.actor.sendMessage('what does PSD mean?', SEG));
    await settle(h.clock, h.actor.sendMessage('ok', SEG));
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    // #48: Pass releases the answer, which is the turn that used to be `answer:1`.
    await settle(h.clock, h.actor.pass(SEG));

    expect(cues(h)).toEqual(['try:1', 'clarify:1', 'hint:1', 'feedback:1', 'release:1']);
  });

  /** A give-up closes the question, so everything after it belongs to the *next* one. */
  it('cues a release, and stops cueing the question it closed', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(h.clock, h.actor.sendMessage('answer?', SEG));
    expect(cues(h)).toEqual(['try:1', 'release:1']);
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

/**
 * **Every path that writes a learner message must say what kind of turn it was** (#47 §2.2).
 *
 * The lock reads one field, and a stale value is a wrong verdict: a relayed whisper question, or a
 * document brought over, arriving while a quiz is open must not be answered as if the learner had
 * just typed "what's the answer" for the second time.
 */
describe('the classification never goes stale', () => {
  it('re-reads it when a document is brought over mid-question', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));
    await settle(h.clock, h.actor.sendMessage("what's the answer", SEG));
    // The answer has been shown, so the question is closed and the lock is out of the picture.
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);

    await settle(
      h.clock,
      h.actor.showDocument({
        fileId: 'f1',
        fileName: 'lecture.pdf',
        relPath: 'lecture.pdf',
        kind: 'pdf',
        pageFrom: 2,
        pageTo: 2,
        selection: null,
        pageText: 'PAGE',
      }),
    );
    // Not a second release: one `quiz.answer_released` in the whole sitting.
    expect(h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.answer_released')).toHaveLength(1);
  });

  it('classifies a relayed whisper question as the learner turn it is', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    // #48: an "answer?" here would *release* the answer and close the question, which is the
    // opposite of what this test is about — so the learner goes quiet instead and the question
    // stays open for the relayed clarification to land on.
    const whisper = h.actor.openSegmentWhisper(SEG);
    await settle(h.clock, h.actor.sendWhisper(whisper.threadId, 'is PSD the same as positive definite?'));
    const turn = h.store.whispers.forThread(whisper.threadId).find((w) => w.sender === 'agent')!;

    await settle(
      h.clock,
      h.actor.relay({
        threadId: whisper.threadId,
        whisperId: turn.id,
        attribution: 'as_me',
        text: 'Does PSD allow a zero eigenvalue?',
        anchorId: SEG,
      }),
    );
    // A relayed *question* is a clarification, not a second request for the answer.
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:quiz_clarify');
  });
});

/**
 * **The two seams the scripted take found on 2026-09-19**, fixed here and pinned in both places:
 * the ledger proposal has to travel with the turn that judges the attempt, and an Ask is the
 * Teacher's even while Max is waiting.
 */
describe('“+ Ask here” while a question is open', () => {
  it('is the Teacher’s, and is not the attempt that unlocks the answer', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(
      h.clock,
      h.actor.askHere({
        anchorId: SEG,
        // 39 words: long enough that §2.2 would read it as an attempt if the origin did not say
        // otherwise, which is exactly the shape of the line the video's beat 11 types.
        question:
          'Before I try that, can you explain what positive semidefinite actually means for a matrix, ' +
          'and how that relates to the second derivative test I learned for one variable, because I ' +
          'think that is the bit I am missing here',
        context: {
          scope: 'segment',
          passageText: 'PAGE',
          outline: '',
          retrievedPages: [],
          scopeShown: 'p. 2',
        },
      }),
    );
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:ellie_answers');
    expect(h.actor.pendingQuizView()!.quiz.attempts).toBe(0);
    // #48 §4.4: the refusal is gone. An Ask still did not count as an attempt — what changed
    // is that the answer was never behind one.
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);
  });

  it('is the Teacher’s for a short Ask too, which would have classified as a clarification', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(
      h.clock,
      h.actor.askHere({
        anchorId: SEG,
        question: 'what does semidefinite mean?',
        context: { scope: 'segment', passageText: 'PAGE', outline: '', retrievedPages: [], scopeShown: 'p. 2' },
      }),
    );
    expect(decisions(h).at(-1)!.decided_by).toBe('rule:ellie_answers');
    expect(h.actor.pendingQuizView()!.quiz.attempts).toBe(0);
  });
});

describe('the ledger call on a feedback turn', () => {
  /**
   * The judgement of an attempt belongs to the turn that judges it, so the ledger call carries
   * `feedback:N` — **with the learner cue behind it**, because `script.psd-hessian.ts` keys its own
   * ledger blocks to `student:N` and must keep replaying.
   */
  it('is cued feedback:N with the learner cue as the fallback', async () => {
    const h = build();
    await settle(h.clock, h.actor.tryHere(TRY));
    await settle(h.clock, h.actor.sendMessage('The Hessian has to be positive semidefinite everywhere.', SEG));

    const ledger = h.llm.requests.filter((r) => r.meta.scope === 'ledger').at(-1)!;
    expect(ledger.meta.scriptCue).toBe('feedback:1');
    expect(ledger.meta.scriptCueFallback).toBe('student:1');
  });

  it('keeps the learner cue, with no fallback, on an ordinary turn', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('A function is convex when its Hessian is PSD.', SEG));
    const ledger = h.llm.requests.filter((r) => r.meta.scope === 'ledger').at(-1)!;
    expect(ledger.meta.scriptCue).toBe('student:1');
    expect(ledger.meta.scriptCueFallback).toBeUndefined();
  });
});
