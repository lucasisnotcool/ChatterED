/**
 * The deterministic half of the orchestrator, after the Teacher + Tester reframe (#32, #33).
 *
 * The property these tests exist to protect is one sentence: **the model can never put the
 * Tester on the floor.** `handOffDue()` decides, on a clock, and the rule stage is the only path
 * to a `challenger` turn. If that stops being true the hand-off stops being "a rule I can see and
 * turn down" (video beat 10) and becomes a model's whim, which is the claim the report makes.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../test-support/clock.js';
import {
  answerQuiz,
  markAnswerShown,
  markCueGiven,
  markFeedbackGiven,
  openQuiz,
  type HandOffVerdict,
  type QuizzableItem,
} from './flow.js';
import {
  blockActionDecision,
  classifyAgentTurn,
  closureDecision,
  decideTurn,
  followupDue,
  lessonStartDecision,
  maxFollowupDecision,
  roleFromMove,
  roleFromName,
  ruleDecision,
  type DecisionInput,
  type TurnDecision,
} from './orchestrator.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';

function item(elementId: string, recency: number): QuizzableItem {
  return { elementId, taughtAt: 0, by: 'teacher', ageMs: 600_000, recency };
}

function due(overrides: Partial<HandOffVerdict> = {}): HandOffVerdict {
  const candidates = [item('R1', 0.9), item('R2', 0.5)];
  return {
    due: true,
    reasons: [],
    candidates,
    target: candidates[0]!,
    learnerTurnsInWindow: 3,
    learnerTurnsSinceHandOff: 3,
    youngestQuizzableAgeMs: 600_000,
    ...overrides,
  };
}

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return { trigger: 'student_message', consecutiveAgentTurns: 0, ...overrides };
}

describe('the hand-off rule', () => {
  it('puts the Tester on the floor, with a target and the Teacher’s line', () => {
    const d = ruleDecision(input({ handOff: due(), handOffLine: "You've covered X and Y — Max, over to you." }))!;
    expect(d.speak).toBe(true);
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz');
    expect(d.targetElementId).toBe('R1');
    expect(d.challenges).toEqual(['R1']);
    expect(d.decidedBy).toBe('rule:handoff');
    // The line comes from flow.handOffLine(), through the rules, never from the model.
    expect(d.handOffLine).toContain('over to you');
  });

  it('defers to the model when the flow rule is not satisfied', () => {
    expect(ruleDecision(input({ handOff: due({ due: false, reasons: ['r1_engagement'] }) }))).toBeNull();
  });

  it('is not put on the floor by a silence, even when the hand-off is due', () => {
    // Narrowed by #37, not dropped: the Tester speaks into a silence in exactly one case —
    // stage 2 of a quiet that followed his own question — and never on a hand-off verdict.
    const d = ruleDecision(input({ trigger: 'silence', silenceStage: 1, handOff: due() }))!;
    expect(d.role).toBe('peer');
    expect(d.moveType).toBe('content_free_nudge');
    expect(d.decidedBy).toBe('rule:silence_peer');
  });

  it('never fires when the learner is closing the thread', () => {
    const d = ruleDecision(input({ trigger: 'wrap_up', handOff: due() }))!;
    expect(d.speak).toBe(false);
    expect(d.decidedBy).toBe('rule:last_word');
  });

  it('yields to the anti-dog-pile cap rather than piling a quiz on top of two agent turns', () => {
    const d = ruleDecision(input({ consecutiveAgentTurns: 2, handOff: due() }))!;
    expect(d.speak).toBe(false);
    expect(d.decidedBy).toBe('rule:no_dogpile');
  });
});

/**
 * **The REFERENCE gate is retired** (#48; was `rule:reference_locked`).
 *
 * It silenced both agents on a thread whose REFERENCE answer was waiting for *"Explain it back"*.
 * #41 stopped anything inserting such a card — `actor.#answers` is constructed empty and never
 * appended to — so the rule has been unreachable in the running app since then, and
 * `collab-doc.md` §9 retires the card itself. The field is still accepted, and now ignored: this
 * test is the old one inverted, so that a future edit which re-introduces the branch has to argue
 * with something rather than quietly change behaviour.
 */
describe('the retired REFERENCE gate', () => {
  it('no longer silences anyone, and no rule reads the flag', () => {
    for (const trigger of ['student_message', 'promote'] as const) {
      const d = ruleDecision(input({ trigger, referenceLocked: true, handOff: due() }))!;
      expect(d.decidedBy, trigger).not.toBe('rule:reference_locked');
      expect(d.speak, trigger).toBe(true);
    }
    // And a locked flag on a silence leaves the silence rules exactly where they were.
    const quiet = ruleDecision(input({ trigger: 'silence', silenceStage: 1, referenceLocked: true }))!;
    expect(quiet.decidedBy).toBe('rule:silence_peer');
  });
});

describe('feedback after a quiz answer', () => {
  const clock = new FakeClock();

  it('is a rule, and it outranks everything the model might prefer', () => {
    // flow-session.md §8.3: Rowland 2014, g = 0.73 with feedback against 0.39 without.
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10', { attempt: true });
    const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: 'attempt' }))!;
    expect(d.speak).toBe(true);
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_feedback');
    expect(d.targetElementId).toBe('R2');
    expect(d.decidedBy).toBe('rule:quiz_feedback');
  });

  it('is not owed while the question is still unanswered', () => {
    const quiz = openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now());
    expect(ruleDecision(input({ pendingQuiz: quiz }))).toBeNull();
  });

  it('still owes feedback when two agent turns have already run', () => {
    // The learner has just spoken, so nothing is being piled on; the debt is discharged first.
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10', { attempt: true });
    const d = ruleDecision(input({ consecutiveAgentTurns: 2, pendingQuiz: quiz }))!;
    expect(d.decidedBy).toBe('rule:quiz_feedback');
  });

  /**
   * **`@Ellie` is the one thing that defers it** (#48, brief §4.2 row 2). Naming the Teacher while
   * Max's question is open is the collab doc's "+ Ask here": she explains, the question stays
   * open, and Max's feedback is owed on the learner's *next* answer rather than on the aside.
   */
  it('stands aside for an @Ellie, and for nothing else', () => {
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10', { attempt: true });
    const d = ruleDecision(input({ pendingQuiz: quiz, mention: 'ellie', threadKind: 'doc' }))!;
    expect(d.decidedBy).toBe('rule:mention');
    expect(d.role).toBe('peer');
    expect(ruleDecision(input({ pendingQuiz: quiz, mention: 'max', threadKind: 'doc' }))!.decidedBy).toBe(
      'rule:quiz_feedback',
    );
  });
});

/**
 * **The answer is released, not withheld** (#48, `collab-doc.md` §4.4; supersedes
 * `attempt-first.md` §2.3).
 *
 * The property that survives: *while Max's question is open, what the learner's turn is decides
 * the reply, and no model is consulted.* What changed is the answer to one of the four cases.
 * `rule:answer_withheld` is **deleted** — the brief's §1 records it as a knowing departure from
 * the evidence rather than as something the transcripts settled: *"a learner must never see a
 * question they never get the answer to, and a refused answer teaches less than a lowered
 * question"*. The refusal's job is taken over by `pitch.pitchInputs`, which makes the next
 * question on that objective easier.
 *
 * `rule:answer_shown` is renamed `rule:answer_released` and its attempt precondition is gone, on
 * both doors: the give-up phrase and the **Pass** control.
 */
describe('releasing the answer while a Tester question is open', () => {
  const clock = new FakeClock();
  const asked = () => openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now());
  const attempted = () => answerQuiz(asked(), 'm_10', { attempt: true });

  it('releases the answer on a give-up before any attempt', () => {
    const d = ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'give_up' }))!;
    expect(d.speak).toBe(true);
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_answer');
    expect(d.targetElementId).toBe('R2');
    // Nothing is put under test by a released answer: `challenges` gates `defended`, and the
    // learner has defended nothing. §4.4: "It fills no progress."
    expect(d.challenges).toEqual([]);
    expect(d.decidedBy).toBe('rule:answer_released');
  });

  it('never produces the retired rule:answer_withheld, at any attempt count', () => {
    for (const quiz of [asked(), attempted()]) {
      const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: 'give_up' }))!;
      expect(d.decidedBy).toBe('rule:answer_released');
      expect(d.moveType).not.toBe('quiz_hint');
    }
  });

  it('releases it on a give-up after an attempt, which is where #47 already stood', () => {
    const d = ruleDecision(input({ pendingQuiz: attempted(), learnerTurn: 'give_up' }))!;
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_answer');
    expect(d.decidedBy).toBe('rule:answer_released');
  });

  it('releases it on Pass, which is the same rule by another door', () => {
    for (const quiz of [asked(), attempted()]) {
      const d = ruleDecision(input({ trigger: 'promote', pendingQuiz: quiz, showAnswer: true }))!;
      expect(d.moveType).toBe('quiz_answer');
      expect(d.decidedBy).toBe('rule:answer_released');
    }
  });

  it('clarifies a question about the question without answering it', () => {
    const d = ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'question' }))!;
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_clarify');
    expect(d.decidedBy).toBe('rule:quiz_clarify');
  });

  it('nudges on agreement, which is not an answer', () => {
    const d = ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'other' }))!;
    expect(d.moveType).toBe('quiz_hint');
    expect(d.decidedBy).toBe('rule:quiz_nudge');
  });

  it('lets an attempt through to the mandatory-feedback rule', () => {
    expect(ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'attempt' }))).toBeNull();
    const d = ruleDecision(input({ pendingQuiz: attempted(), learnerTurn: 'attempt' }))!;
    expect(d.decidedBy).toBe('rule:quiz_feedback');
  });

  it('is still open after feedback, so a later give-up is answered rather than ignored', () => {
    const quiz = markFeedbackGiven(attempted());
    const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: 'give_up' }))!;
    expect(d.decidedBy).toBe('rule:answer_released');
  });

  it('is closed once the answer has been released: nothing here fires again', () => {
    const quiz = markAnswerShown(markFeedbackGiven(attempted()), 'give_up');
    for (const turn of ['give_up', 'question', 'other'] as const) {
      // Back to the ordinary rules — in the doc chat that is `rule:ellie_answers`.
      const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: turn, anchoredThread: true }))!;
      expect(d.decidedBy, turn).toBe('rule:ellie_answers');
    }
  });

  /**
   * **The explain path is the Teacher's, mid-question** (§6, `flow-build-plan.md` §2 beat 11). An
   * Ask is an explicit request for Ellie, so none of the four rules above may take it — not even
   * when its words would classify as an attempt or a clarification.
   */
  it('lets an Ask through to the Teacher, whatever its words would have classified as', () => {
    // Asked, and asked again after an attempt has been answered — the two states an Ask can land in.
    for (const quiz of [asked(), markFeedbackGiven(attempted())]) {
      for (const turn of ['attempt', 'give_up', 'question', 'other'] as const) {
        const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: turn, askedHere: true, anchoredThread: true }))!;
        expect(d.decidedBy, turn).toBe('rule:ellie_answers');
        expect(d.role, turn).toBe('peer');
      }
    }
  });

  /** The same exemption, said by the learner instead of by a button (#48, brief §4.2 row 2). */
  it('lets an @Ellie through to the Teacher while Max’s question is open', () => {
    for (const turn of ['attempt', 'give_up', 'question', 'other'] as const) {
      const d = ruleDecision(input({ pendingQuiz: asked(), learnerTurn: turn, mention: 'ellie', threadKind: 'doc' }))!;
      expect(d.decidedBy, turn).toBe('rule:mention');
      expect(d.role, turn).toBe('peer');
    }
  });

  /**
   * The one thing an Ask does **not** outrank: feedback the Tester already owes for an attempt that
   * was made and never answered (`rule:quiz_feedback`, Rowland 2014). That state only arises when a
   * feedback turn failed, and discharging the debt first is the brief's strongest constraint — the
   * actor never produces it from an Ask, because an Ask does not touch `pendingQuiz` at all.
   */
  it('does not cancel a feedback debt that is already owed', () => {
    const d = ruleDecision(input({ pendingQuiz: attempted(), learnerTurn: 'attempt', askedHere: true }))!;
    expect(d.decidedBy).toBe('rule:quiz_feedback');
  });

  it('never fires into a silence: what a timer does is the silence rule’s business', () => {
    const d = ruleDecision(
      input({ trigger: 'silence', silenceStage: 1, pendingQuiz: asked(), learnerTurn: 'give_up', lastAgentTurn: 'tester_question' }),
    )!;
    // Since #48 an unattempted question in a silence draws Ellie's cue (§4.3); what matters here
    // is that no rule about the learner's *typed* turn fired into a silence.
    expect(d.decidedBy).toBe('rule:ellie_cue');
    expect(d.decidedBy).not.toMatch(/^rule:(answer_released|quiz_clarify|quiz_nudge)$/);
  });

  it('still yields to the learner’s last word', () => {
    expect(ruleDecision(input({ trigger: 'wrap_up', pendingQuiz: asked(), learnerTurn: 'give_up' }))!.decidedBy).toBe(
      'rule:last_word',
    );
  });

  it('outranks the hand-off: an open question is answered before a new one is set', () => {
    const d = ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'other', handOff: due() }))!;
    expect(d.decidedBy).toBe('rule:quiz_nudge');
  });
});

describe('the opener', () => {
  it('is the Teacher, so the learner is asked rather than lectured', () => {
    const d = ruleDecision(input({ trigger: 'open' }))!;
    expect(d.role).toBe('peer');
    expect(d.moveType).toBe('opener');
  });
});

/**
 * **The model half, and the 2026-09-16 silence.**
 *
 * The bug, in one line: the live model answered with a move, a target and a rationale, and a
 * `role` string the code turned into `null` — and `decideTurn` turned *that* into deliberate
 * silence, which `actor.#runAgentTurn` cannot tell from a rule that chose to say nothing. The
 * learner saw no feedback, no streaming, and then two identical nudges for being quiet.
 *
 * Every reply shape a model plausibly returns is exercised here, and the property is the same
 * for all of them: **a learner turn resolves to a dispatch, or to a surfaced failure. Never to
 * silence.**
 */
function fakeClient(reply: string | Error): LLMClient {
  return {
    kind: 'scripted',
    complete: async () => {
      if (reply instanceof Error) throw reply;
      return { text: reply, model: 'sonnet', usage: EMPTY_USAGE, ttftMs: 1 };
    },
  };
}

const REQUEST: LlmRequest = {
  model: 'sonnet',
  max_tokens: 400,
  system: [{ type: 'text', text: 'x' }],
  messages: [{ role: 'user', content: 'y' }],
  meta: { scope: 'orchestrator' },
};

/** The room-level stream: the one place the model still decides anything (`anchoredThread` off). */
function modelInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return { trigger: 'student_message', consecutiveAgentTurns: 0, handOff: due({ due: false }), ...overrides };
}

async function decide(reply: string | Error, overrides: Partial<DecisionInput> = {}) {
  return decideTurn({ client: fakeClient(reply), request: REQUEST, input: modelInput(overrides) });
}

describe('a learner turn never resolves to silence', () => {
  /** The exact shape room_6a9609d5c6fb recorded: a real move, a real rationale, an unmapped role. */
  it('maps the display-name roles the prompt actually teaches the model', () => {
    // `prompts.roleBlock` says "You are Ellie, the teacher here" and "You are Max, the tester
    // here". Nothing the model reads contains the words `peer` or `challenger` except the schema
    // enum, so the answer comes back in the vocabulary it was taught and the code must speak it.
    expect(roleFromName('teacher')).toBe('peer');
    expect(roleFromName('Ellie')).toBe('peer');
    expect(roleFromName('peer')).toBe('peer');
    expect(roleFromName('tester')).toBe('challenger');
    expect(roleFromName(' Max ')).toBe('challenger');
    expect(roleFromName(null)).toBeNull();
    expect(roleFromName('narrator')).toBeNull();
    // And the move names the speaker when the role field does not — the Teacher is the floor.
    expect(roleFromMove('correct_misconception')).toBe('peer');
    expect(roleFromMove('explain')).toBe('peer');
    expect(roleFromMove('quiz')).toBe('challenger');
    expect(roleFromMove('probe_assumptions')).toBe('challenger');
  });

  it('gives a `correct_misconception` with no usable role to the Teacher, not to nobody', async () => {
    const d = await decide(
      JSON.stringify({
        speak: true,
        role: null,
        move_type: 'correct_misconception',
        target_element_id: 'admissible-heuristics',
        rationale: 'Learner inverted the admissibility of Manhattan vs straight-line.',
      }),
    );
    expect(d.speak).toBe(true);
    expect(d.role).toBe('peer');
    expect(d.moveType).toBe('correct_misconception');
    expect(d.targetElementId).toBe('admissible-heuristics');
    expect(d.failure).toBeNull();
  });

  it('gives a move-only answer to the Teacher when `role` is missing entirely', async () => {
    const d = await decide(JSON.stringify({ speak: true, move_type: 'explain', rationale: 'r' }));
    expect(d.role).toBe('peer');
  });

  it('still refuses to let the model put the Tester on the floor', async () => {
    const d = await decide(JSON.stringify({ speak: true, role: 'challenger', move_type: 'quiz', rationale: 'r' }));
    expect(d.role).toBe('peer');
  });

  it('routes a quiz-shaped move to the Tester only when the flow rule already agreed', async () => {
    const asked = await decide(JSON.stringify({ speak: true, move_type: 'quiz_followup', rationale: 'r' }), {
      handOff: due(),
    });
    expect(asked.role).toBe('challenger');
    const refused = await decide(JSON.stringify({ speak: true, move_type: 'quiz_followup', rationale: 'r' }));
    expect(refused.role).toBe('peer');
  });

  it('overrides `speak: false` — every legitimate silence is a rule, and they have all run', async () => {
    const d = await decide(JSON.stringify({ speak: false, role: null, move_type: 'yield', rationale: 'r' }));
    expect(d.speak).toBe(true);
    expect(d.role).toBe('peer');
    expect(d.decidedBy).toContain('declined_overridden');
  });

  it('unwraps an object the model buried in prose', async () => {
    const d = await decide('Here you go:\n```json\n{"speak":true,"role":"teacher","move_type":"explain","rationale":"r"}\n```');
    expect(d.role).toBe('peer');
    expect(d.moveType).toBe('explain');
  });

  it('answers anyway when the reply is not JSON at all, and says the turn failed', async () => {
    const d = await decide('Manhattan distance *is* admissible for the 8-puzzle.');
    expect(d.speak).toBe(true);
    expect(d.role).toBe('peer');
    expect(d.decidedBy).toBe('rule:orchestrator_error');
    expect(d.failure?.reason).toBe('the orchestrator call failed');
  });

  it('answers anyway when the CLI itself fails, and says so', async () => {
    const d = await decide(new Error('The Claude CLI exited 1: not logged in'));
    expect(d.speak).toBe(true);
    expect(d.role).toBe('peer');
    expect(d.failure?.detail).toContain('exited 1');
  });

  /**
   * There is no longer any *other* trigger that reaches the model: `ruleDecision` settles
   * `open`, `wrap_up`, the dog-pile cap, the feedback debt, the hand-off,
   * both silence stages and (since `rule:ellie_answers`) every learner turn in the doc chat. The
   * model's whole remaining job is the pre-flow room-level stream, which is why a failure here
   * can always be answered by the Teacher rather than by nothing.
   */
  it('leaves nothing but the room-level learner turn to the model', () => {
    for (const trigger of ['open', 'wrap_up', 'silence'] as const) {
      expect(ruleDecision(input({ trigger }))).not.toBeNull();
    }
  });
});

describe('rule:ellie_answers — Ellie answers the doc chat without a model call', () => {
  it('needs no model to know who answers a learner turn in the doc chat', () => {
    const d = ruleDecision(input({ threadKind: 'doc', handOff: due({ due: false }) }))!;
    expect(d.speak).toBe(true);
    expect(d.role).toBe('peer');
    // `answer_then_teach`, not `respond`, since #36: a move called "respond" is satisfied by a
    // Socratic probe, which is the turn this rule exists to produce the opposite of.
    expect(d.moveType).toBe('answer_then_teach');
    expect(d.decidedBy).toBe('rule:ellie_answers');
  });

  it('fires in a span thread too — Ctrl+E is part of the doc chat (brief §4.1)', () => {
    expect(ruleDecision(input({ threadKind: 'span' }))!.decidedBy).toBe('rule:ellie_answers');
  });

  /**
   * **A private thread never runs the orchestrator at all** (brief §4.1) — `sendPrivate` goes
   * through the whisper path. The gate is stated here anyway, because the failure it prevents is
   * a private turn that leaks into the group context, and the whisper canary is the repo's crown
   * jewel precisely because that failure is invisible until it is not.
   */
  it('never fires in a private thread', () => {
    expect(ruleDecision(input({ threadKind: 'private' }))).toBeNull();
  });

  /** A mention names the answerer, so the default does not apply. */
  it('gives way to an explicit mention', () => {
    expect(ruleDecision(input({ threadKind: 'doc', mention: 'ellie' }))!.decidedBy).toBe('rule:mention');
    const max = ruleDecision(input({ threadKind: 'doc', mention: 'max' }))!;
    expect(max.decidedBy).toBe('rule:mention');
    expect(max.role).toBe('challenger');
    expect(max.moveType).toBe('mention_reply');
  });

  /**
   * **#49: the hand-off is not a door in the doc chat** (brief §9 supersedes `flow-session.md` §8.2's
   * time-based hand-off with `rule:max_followup`). This test used to assert the opposite order —
   * `rule:handoff` ahead of `rule:ellie_answers` — which let a due hand-off give the learner's
   * question to Max as a quiz with no answer, against §4.2 row 1.
   */
  it('outranks the old hand-off in the doc chat and a span thread, and not the dog-pile cap', () => {
    for (const threadKind of ['doc', 'span'] as const) {
      const d = ruleDecision(input({ threadKind, handOff: due(), handOffLine: 'Max, over to you.' }))!;
      expect(d.decidedBy).toBe('rule:ellie_answers');
      expect(d.role).toBe('peer');
      expect(d.handOffLine).toBeNull();
    }
    expect(ruleDecision(input({ threadKind: 'doc', consecutiveAgentTurns: 2 }))!.decidedBy).toBe('rule:no_dogpile');
  });

  /** The legacy room screen (no collab-doc channel) keeps its hand-off, unchanged. */
  it('leaves the hand-off in place outside the collab doc', () => {
    expect(ruleDecision(input({ handOff: due() }))!.decidedBy).toBe('rule:handoff');
    expect(ruleDecision(input({ anchoredThread: true, handOff: due() }))!.decidedBy).toBe('rule:handoff');
  });

  it('still reads the old `anchoredThread` flag when no thread kind is given', () => {
    expect(ruleDecision(input({ anchoredThread: true }))!.decidedBy).toBe('rule:ellie_answers');
  });

  it('leaves the pre-flow room-level stream to the model', () => {
    expect(ruleDecision(input({ anchoredThread: false, handOff: due({ due: false }) }))).toBeNull();
  });
});

/**
 * **`rule:max_followup`** (#48, brief §4.2 row 1): Ellie answers in full, then Max asks one
 * Socratic follow-up. The gate is the brief's own invariant — *"One open Max question at a time
 * per file"* — and it is a pure function so this test can quote it.
 */
describe('rule:max_followup', () => {
  const clock = new FakeClock();

  it('is due after an Ellie answer with no question open', () => {
    expect(followupDue({ decidedBy: 'rule:ellie_answers', threadKind: 'doc' })).toBe(true);
  });

  it('is not due while a Max question is already open', () => {
    const open = openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now());
    expect(followupDue({ decidedBy: 'rule:ellie_answers', pendingQuiz: open, threadKind: 'doc' })).toBe(false);
    // …and is due again once that question has been released.
    const closed = markAnswerShown(open, 'give_up');
    expect(followupDue({ decidedBy: 'rule:ellie_answers', pendingQuiz: closed, threadKind: 'doc' })).toBe(true);
  });

  it('is not due after a mention — @Ellie draws no follow-up, and @Max does not follow himself', () => {
    expect(followupDue({ decidedBy: 'rule:mention', mention: 'ellie', threadKind: 'doc' })).toBe(false);
    expect(followupDue({ decidedBy: 'rule:ellie_answers', mention: 'ellie', threadKind: 'doc' })).toBe(false);
    expect(followupDue({ decidedBy: 'rule:mention', mention: 'max', threadKind: 'doc' })).toBe(false);
  });

  it('is never due in a private thread, or after any other rule', () => {
    expect(followupDue({ decidedBy: 'rule:ellie_answers', threadKind: 'private' })).toBe(false);
    for (const by of ['rule:handoff', 'rule:quiz_feedback', 'rule:answer_released', 'rule:lesson_start']) {
      expect(followupDue({ decidedBy: by, threadKind: 'doc' }), by).toBe(false);
    }
  });

  it('asks a question aimed at the objective, which is what puts it under test', () => {
    const d = maxFollowupDecision('obj_3');
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz');
    expect(d.targetElementId).toBe('obj_3');
    expect(d.challenges).toEqual(['obj_3']);
    expect(d.decidedBy).toBe('rule:max_followup');
  });
});

/** The two turns the actor writes in code rather than deciding (brief §4.7, §6). */
describe('the code-written decisions', () => {
  it('releases the answer at closure, closing the question the way every other release does', () => {
    const d = closureDecision('R2');
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_answer');
    expect(d.decidedBy).toBe('rule:closure');
  });

  it('opens a lesson with Ellie, teaching nothing yet', () => {
    const d = lessonStartDecision('obj_1');
    expect(d.role).toBe('peer');
    expect(d.moveType).toBe('lesson_start');
    expect(d.decidedBy).toBe('rule:lesson_start');
    // It asks the learner to ask, so it is not an explanation a silence should be read against.
    expect(classifyAgentTurn(d, 'none')).toBe('none');
  });
});

/**
 * **What a silence means depends on what was said into it** (#37).
 *
 * `product-design.md` §C5 makes stage 1 content-free unconditionally, and the argument it gives
 * — *"a nudge that supplies subject matter converts a persistence problem into a comprehension
 * shortcut"* — is about a room where the learner's job was to explain and the silence was them
 * not starting. #32 made the Teacher explain, so the commonest silence in the flow is now a
 * learner who did not follow the explanation, and to that silence "Take your time" is not
 * neutral, it is a non-answer (#37's transcript). §C5 is narrowed to the case its argument is
 * about, and kept whole there.
 */
describe('the silence rule reads what the quiet is quiet about', () => {
  const silence = (overrides: Partial<DecisionInput> = {}) =>
    ruleDecision(input({ trigger: 'silence', silenceStage: 1, ...overrides }))!;

  /**
   * **Superseded by `attempt-first.md` §5** (issue #47). #37's re-explanation and its stage-2
   * "step back" were answering a silence that the transcripts say means *reading*: the median gap
   * before the next learner turn in the six studied sessions is 3–6 minutes, against AI turns of
   * 246–1,190 words (`findings.md` RQ5). Nothing is said at either stage now.
   */
  it('says nothing at all when the quiet followed a Teacher explanation', () => {
    for (const stage of [1, 2] as const) {
      const d = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: stage });
      expect(d.speak, `stage ${stage}`).toBe(false);
      expect(d.role, `stage ${stage}`).toBeNull();
      expect(d.decidedBy, `stage ${stage}`).toBe('rule:silence_after_explanation');
    }
  });

  /**
   * The live run of 2026-09-19 (STATUS, "#47 live"): "+ Try this", then an Ask to Ellie in the same
   * thread, then quiet. `lastAgentTurn` was the explanation, so nothing was said over an open
   * question with no attempt — against §5's own rule. What the learner owes decides, not who spoke.
   */
  it('fills the silence over an open quiz even when the last agent turn was an explanation', () => {
    // Since #48 an *unattempted* question draws §4.3's pair; the property under test here is
    // unchanged — an open question outranks whoever spoke last.
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0), 'm2', { attempt: true });
    const answered = markFeedbackGiven(quiz, 'partial', 'partial');
    const s1 = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: 1, pendingQuiz: answered });
    expect(s1.speak).toBe(true);
    expect(s1.role).toBe('challenger');
    expect(s1.moveType).toBe('content_free_nudge');
    expect(s1.decidedBy).toBe('rule:silence_quiz_waiting');
    const s2 = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: 2, pendingQuiz: answered });
    expect(s2.role).toBe('challenger');
    expect(s2.moveType).toBe('quiz_hint');
    expect(s2.targetElementId).toBe('R2');
    expect(s2.decidedBy).toBe('rule:silence_hint');
  });

  it('still says nothing after an explanation once the answer has been released (no debt)', () => {
    const quiz = markAnswerShown(openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0), 'give_up');
    const d = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: 1, pendingQuiz: quiz });
    expect(d.speak).toBe(false);
    expect(d.decidedBy).toBe('rule:silence_after_explanation');
  });

  /**
   * **§4.3, the design decision the A1 report is built on** (#48, `collab-doc.md` §4.3).
   *
   * Max's question has waited past the reading-time threshold and the learner has not attempted
   * it. What goes into that silence is a *peer's partial take and a prompt aimed at the learner* —
   * Xu et al. (2026)'s "something to improve on, in place of an answer" — and not a hint, which
   * would be the app doing the retrieval, and not a content-free line, which would be the app
   * saying nothing. R6: 5 of 6 questions handed back unattempted, both hints followed by `answer?`.
   */
  describe('Ellie’s cue and Max’s prompt', () => {
    const unattempted = () => openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0);

    it('gives stage 1 to Ellie as a peer, aimed at the open question', () => {
      const d = silence({ lastAgentTurn: 'tester_question', silenceStage: 1, pendingQuiz: unattempted() });
      expect(d.speak).toBe(true);
      expect(d.role).toBe('peer');
      expect(d.moveType).toBe('peer_guess');
      expect(d.targetElementId).toBe('R2');
      // A guess by Ellie defends nothing: `challenges` is the ledger's `defended` gate.
      expect(d.challenges).toEqual([]);
      expect(d.decidedBy).toBe('rule:ellie_cue');
    });

    it('gives stage 2 to Max, answering her but aimed at the learner', () => {
      const d = silence({ lastAgentTurn: 'tester_question', silenceStage: 2, pendingQuiz: unattempted() });
      expect(d.role).toBe('challenger');
      expect(d.moveType).toBe('max_prompt');
      expect(d.targetElementId).toBe('R2');
      expect(d.decidedBy).toBe('rule:max_prompt');
    });

    /**
     * The pair is one event across the two stages of one round: stage 2 with the cue already
     * given is Max's prompt, and a *second* round's stage 1 is the gate closing.
     */
    it('fires once per question: after the pair, the silence is left to closure', () => {
      const spent = markCueGiven(unattempted(), { at: 1_000, hasMistake: true, claim: 'a plausible wrong claim' });
      expect(silence({ lastAgentTurn: 'tester_question', silenceStage: 2, pendingQuiz: spent }).decidedBy).toBe(
        'rule:max_prompt',
      );
      const again = silence({ lastAgentTurn: 'tester_question', silenceStage: 1, pendingQuiz: spent });
      expect(again.speak).toBe(false);
      expect(again.decidedBy).toBe('rule:cue_spent');
    });

    it('stands down once the learner has attempted: the old pair takes the silence back', () => {
      const attempted = answerQuiz(unattempted(), 'm2', { attempt: true });
      const answered = markFeedbackGiven(attempted, 'partial', 'partial');
      expect(silence({ silenceStage: 1, pendingQuiz: answered }).decidedBy).toBe('rule:silence_quiz_waiting');
      expect(silence({ silenceStage: 2, pendingQuiz: answered }).decidedBy).toBe('rule:silence_hint');
    });

    /**
     * **E5, asserted because it is a one-line regression waiting to happen.** `rule:ellie_answers`
     * and `rule:max_followup` spend both consecutive agent turns, so the cue would be unreachable
     * if the dog-pile cap were ever checked before the silence branch.
     */
    it('still fires after two consecutive agent turns — the cap is checked after the silence', () => {
      const d = silence({ consecutiveAgentTurns: 2, silenceStage: 1, pendingQuiz: unattempted() });
      expect(d.decidedBy).toBe('rule:ellie_cue');
      const s2 = silence({ consecutiveAgentTurns: 2, silenceStage: 2, pendingQuiz: unattempted() });
      expect(s2.decidedBy).toBe('rule:max_prompt');
    });
  });

  it('keeps §C5 whole while the Tester is waiting: stage 1 adds no subject matter', () => {
    const d = silence({ lastAgentTurn: 'tester_question' });
    expect(d.role).toBe('peer');
    expect(d.moveType).toBe('content_free_nudge');
    expect(d.decidedBy).toBe('rule:silence_peer');
  });

  it('hints from the Tester at stage 2, because the Teacher hinting would answer the quiz', () => {
    const d = silence({
      lastAgentTurn: 'tester_question',
      silenceStage: 2,
      // Attempted and marked *Partly there*, so §4.3's cue has stood down and the quiz is still
      // genuinely pending (`feedbackDue` false, `quizOpen` true).
      pendingQuiz: markFeedbackGiven(
        answerQuiz(openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0), 'm2', { attempt: true }),
        'partial',
        'partial',
      ),
    });
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_hint');
    expect(d.targetElementId).toBe('R2');
    expect(d.decidedBy).toBe('rule:silence_hint');
  });

  it('leaves a REFERENCE card and an empty thread on the old behaviour', () => {
    for (const last of ['reference', 'none'] as const) {
      expect(silence({ lastAgentTurn: last }).moveType).toBe('content_free_nudge');
      expect(silence({ lastAgentTurn: last, silenceStage: 2 }).moveType).toBe('incomplete_scaffold');
    }
    // And with the field absent altogether, which is every caller that predates #37.
    expect(silence().moveType).toBe('content_free_nudge');
  });

  it('is checked before the dog-pile cap, because a silence is nobody piling on', () => {
    // A question (1) plus a stage-1 fill (2) sits at the cap, so before #37 stage 2 could never be
    // reached at all — `incomplete_scaffold` and the Tester's hint were both dead code.
    const d = silence({
      lastAgentTurn: 'tester_question',
      silenceStage: 2,
      consecutiveAgentTurns: 2,
      pendingQuiz: markFeedbackGiven(
        answerQuiz(openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0), 'm2', { attempt: true }),
        'partial',
        'partial',
      ),
    });
    expect(d.speak).toBe(true);
    expect(d.decidedBy).toBe('rule:silence_hint');
    // The cap still governs everything that is not a silence.
    expect(ruleDecision(input({ consecutiveAgentTurns: 2 }))!.decidedBy).toBe('rule:no_dogpile');
  });
});

describe('classifying the turn a silence follows', () => {
  const decision = (moveType: string, role: 'peer' | 'challenger' | null = 'peer'): TurnDecision => ({
    speak: role !== null,
    role,
    moveType,
    probeType: null,
    targetElementId: null,
    challenges: [],
    rationale: '',
    decidedBy: '',
    handOffLine: null,
    failure: null,
  });

  it('reads the move, not the role — a demoted probe is still a question', () => {
    // `decideTurn` demotes `challenger` to `peer` whenever the hand-off is not due (#33), so the
    // role on a dispatched probe is unreliable and the move is what says who owes an answer.
    expect(classifyAgentTurn(decision('probing_assumptions', 'peer'), 'none')).toBe('tester_question');
    expect(classifyAgentTurn(decision('quiz', 'challenger'), 'none')).toBe('tester_question');
    expect(classifyAgentTurn(decision('answer_then_teach'), 'none')).toBe('teacher_explanation');
    expect(classifyAgentTurn(decision('correct_misconception'), 'none')).toBe('teacher_explanation');
  });

  it('treats quiz feedback as teaching, because that is what it is', () => {
    expect(classifyAgentTurn(decision('quiz_feedback', 'challenger'), 'tester_question')).toBe('teacher_explanation');
  });

  /**
   * Issue #47. A hint and a clarification both leave the learner owing the answer, so the thread
   * still belongs to Max's question and a stage-2 quiet still earns his hint. The shown answer is
   * the one Tester move that closes it: after it, §5 leaves the silence alone.
   */
  it('keeps the question outstanding through a hint and a clarification, and closes it on the answer', () => {
    expect(classifyAgentTurn(decision('quiz_hint', 'challenger'), 'tester_question')).toBe('tester_question');
    expect(classifyAgentTurn(decision('quiz_clarify', 'challenger'), 'tester_question')).toBe('tester_question');
    expect(classifyAgentTurn(decision('quiz_clarify', 'challenger'), 'none')).toBe('tester_question');
    expect(classifyAgentTurn(decision('quiz_answer', 'challenger'), 'tester_question')).toBe('teacher_explanation');
  });

  /**
   * §4.3's pair is an answer to a silence, not new material: after Ellie's guess and Max's prompt
   * the thread is still about Max's open question. Max's prompt matters most — it matches none of
   * the `quiz*` patterns, so without the allowlist it would read as teaching and the closure rule
   * would be looking at a thread the app believed had moved on.
   */
  it('leaves the thread about Max’s question through Ellie’s cue and Max’s prompt', () => {
    expect(classifyAgentTurn(decision('peer_guess', 'peer'), 'tester_question')).toBe('tester_question');
    expect(classifyAgentTurn(decision('max_prompt', 'challenger'), 'tester_question')).toBe('tester_question');
  });

  it('does not let a fill, a yield or the opener rewrite what the thread is about', () => {
    for (const move of ['yield', 'content_free_nudge', 'incomplete_scaffold', 'reexplain_simpler', 'offer_step_back', 'quiz_hint']) {
      expect(classifyAgentTurn(decision(move), 'tester_question')).toBe('tester_question');
      expect(classifyAgentTurn(decision(move), 'teacher_explanation')).toBe('teacher_explanation');
    }
    expect(classifyAgentTurn(decision('opener'), 'teacher_explanation')).toBe('none');
    expect(classifyAgentTurn(decision('anything', null), 'tester_question')).toBe('tester_question');
  });
});

/**
 * **Max asks only when asked** (`notebooks.md` §5.2, contract C8). The actor closes the follow-up
 * chain and runs the Tester `reactive`; these pin the orchestrator's own half, which holds even if
 * a caller hands it a due hand-off: no rule and no model opens a new Max question unprompted, and
 * everything about a question he was asked is unchanged.
 */
describe('maxOnlyOnRequest', () => {
  it('skips the hand-off even when the verdict says it is due', () => {
    const d = ruleDecision(input({ handOff: due(), handOffLine: 'over to you', maxOnlyOnRequest: true }));
    expect(d === null || d.decidedBy !== 'rule:handoff').toBe(true);
  });

  it('demotes a model that names the Tester, even on a due hand-off', async () => {
    const reply = JSON.stringify({ speak: true, role: 'challenger', move_type: 'quiz', rationale: 'x' });
    const d = await decide(reply, { handOff: due(), maxOnlyOnRequest: true });
    expect(d.role).toBe('peer');
    // The legacy loop still lets a due hand-off through, which is what the flag changes.
    const legacy = await decide(reply, { handOff: due() });
    expect(legacy.role).toBe('challenger');
  });

  it('still reaches Max by @Max', () => {
    const d = ruleDecision(input({ threadKind: 'doc', mention: 'max', maxOnlyOnRequest: true }))!;
    expect(d.role).toBe('challenger');
    expect(d.decidedBy).toBe('rule:mention');
  });

  it('leaves feedback, clarify, release and the silence pair on a question he was asked', () => {
    const asked = openQuiz({ elementId: 'R1', quizMessageId: 'm_q' }, 0);
    const answered = answerQuiz(asked, 'm_a', { attempt: true, text: 'an answer' });
    expect(ruleDecision(input({ pendingQuiz: answered, maxOnlyOnRequest: true }))!.decidedBy).toBe('rule:quiz_feedback');
    expect(ruleDecision(input({ pendingQuiz: asked, learnerTurn: 'question', maxOnlyOnRequest: true }))!.decidedBy).toBe(
      'rule:quiz_clarify',
    );
    expect(ruleDecision(input({ pendingQuiz: asked, learnerTurn: 'give_up', maxOnlyOnRequest: true }))!.decidedBy).toBe(
      'rule:answer_released',
    );
    const cue = ruleDecision(input({ trigger: 'silence', silenceStage: 1, pendingQuiz: asked, maxOnlyOnRequest: true }))!;
    expect(cue.decidedBy).toBe('rule:ellie_cue');
    const prompt = ruleDecision(
      input({ trigger: 'silence', silenceStage: 2, pendingQuiz: markCueGiven(asked, { at: 1, hasMistake: false, claim: null }), maxOnlyOnRequest: true }),
    )!;
    expect(prompt.decidedBy).toBe('rule:max_prompt');
  });
});

describe('rule:block_action', () => {
  it('gives Explain and Example to Ellie, with nothing put under test', () => {
    for (const [kind, move] of [
      ['explain', 'block_explain'],
      ['example', 'block_example'],
    ] as const) {
      const d = blockActionDecision(kind);
      expect(d.role).toBe('peer');
      expect(d.moveType).toBe(move);
      expect(d.decidedBy).toBe('rule:block_action');
      expect(d.challenges).toEqual([]);
      expect(classifyAgentTurn(d, 'none')).toBe('teacher_explanation');
    }
  });
});
