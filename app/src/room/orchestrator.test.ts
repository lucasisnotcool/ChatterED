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
  markFeedbackGiven,
  openQuiz,
  type HandOffVerdict,
  type QuizzableItem,
} from './flow.js';
import {
  classifyAgentTurn,
  decideTurn,
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

describe('the REFERENCE gate', () => {
  it('silences both agents on a thread waiting for “Explain it back”', () => {
    // pivot-spec.md §B1 / flow-build-plan.md §4.3 property 4 — the single most important line in
    // that section, and the reason this check runs before every other rule.
    for (const trigger of ['student_message', 'silence', 'open', 'promote'] as const) {
      const d = ruleDecision(input({ trigger, referenceLocked: true, handOff: due() }))!;
      expect(d.speak, trigger).toBe(false);
      expect(d.decidedBy, trigger).toBe('rule:reference_locked');
    }
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

  it('is still refused inside a locked REFERENCE thread', () => {
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10', { attempt: true });
    const d = ruleDecision(input({ pendingQuiz: quiz, referenceLocked: true }))!;
    expect(d.decidedBy).toBe('rule:reference_locked');
  });
});

/**
 * **The answer lock** (issue #47, `attempt-first.md` §2.3).
 *
 * The property: *while Max's question is open, what the learner's turn is decides the reply, and no
 * model is consulted.* The evidence it encodes is R6 — both hints followed by a bare `answer?`, the
 * answer given both times, and attempts appearing only after the learner imposed the rule by hand.
 */
describe('the answer lock while a Tester question is open', () => {
  const clock = new FakeClock();
  const asked = () => openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now());
  const attempted = () => answerQuiz(asked(), 'm_10', { attempt: true });

  it('withholds the answer before the first attempt, and hints instead', () => {
    const d = ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'answer_request' }))!;
    expect(d.speak).toBe(true);
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_hint');
    expect(d.targetElementId).toBe('R2');
    // A hint puts nothing under test: `challenges` is the gate on the ledger's `defended` state.
    expect(d.challenges).toEqual([]);
    expect(d.decidedBy).toBe('rule:answer_withheld');
  });

  it('gives the answer once the learner has attempted, on the same ask', () => {
    const d = ruleDecision(input({ pendingQuiz: attempted(), learnerTurn: 'answer_request' }))!;
    expect(d.role).toBe('challenger');
    expect(d.moveType).toBe('quiz_answer');
    expect(d.decidedBy).toBe('rule:answer_shown');
  });

  it('gives the answer on the button, which is the same rule by another door', () => {
    const d = ruleDecision(input({ trigger: 'promote', pendingQuiz: attempted(), showAnswer: true }))!;
    expect(d.moveType).toBe('quiz_answer');
    expect(d.decidedBy).toBe('rule:answer_shown');
  });

  it('will not honour the button before an attempt', () => {
    // The actor refuses first and never runs a turn; this is the second line of the same defence.
    expect(ruleDecision(input({ trigger: 'promote', pendingQuiz: asked(), showAnswer: true }))).toBeNull();
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

  it('is still open after feedback, so a later ask is answered rather than re-locked', () => {
    const quiz = markFeedbackGiven(attempted());
    const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: 'answer_request' }))!;
    expect(d.decidedBy).toBe('rule:answer_shown');
  });

  it('is closed once the answer has been shown: nothing here fires again', () => {
    const quiz = markAnswerShown(markFeedbackGiven(attempted()));
    for (const turn of ['answer_request', 'question', 'other'] as const) {
      // Back to the ordinary rules — in a segment thread that is `rule:teacher_answers`.
      const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: turn, anchoredThread: true }))!;
      expect(d.decidedBy, turn).toBe('rule:teacher_answers');
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
      for (const turn of ['attempt', 'answer_request', 'question', 'other'] as const) {
        const d = ruleDecision(input({ pendingQuiz: quiz, learnerTurn: turn, askedHere: true, anchoredThread: true }))!;
        expect(d.decidedBy, turn).toBe('rule:teacher_answers');
        expect(d.role, turn).toBe('peer');
      }
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

  it('never fires into a silence: a hint on a timer is the silence rule’s business', () => {
    const d = ruleDecision(
      input({ trigger: 'silence', silenceStage: 1, pendingQuiz: asked(), learnerTurn: 'answer_request', lastAgentTurn: 'tester_question' }),
    )!;
    expect(d.decidedBy).toBe('rule:silence_peer');
  });

  it('still yields to the REFERENCE lock and to the learner’s last word', () => {
    expect(
      ruleDecision(input({ pendingQuiz: asked(), learnerTurn: 'answer_request', referenceLocked: true }))!.decidedBy,
    ).toBe('rule:reference_locked');
    expect(ruleDecision(input({ trigger: 'wrap_up', pendingQuiz: asked(), learnerTurn: 'answer_request' }))!.decidedBy).toBe(
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
   * `open`, `wrap_up`, the REFERENCE lock, the dog-pile cap, the feedback debt, the hand-off,
   * both silence stages and (since `rule:teacher_answers`) every anchored learner turn. The
   * model's whole remaining job is the pre-flow room-level stream, which is why a failure here
   * can always be answered by the Teacher rather than by nothing.
   */
  it('leaves nothing but the room-level learner turn to the model', () => {
    for (const trigger of ['open', 'wrap_up', 'silence'] as const) {
      expect(ruleDecision(input({ trigger }))).not.toBeNull();
    }
  });
});

describe('the Teacher answers a segment thread without a model call', () => {
  it('needs no model to know who answers a learner turn under a segment', () => {
    const d = ruleDecision(input({ anchoredThread: true, handOff: due({ due: false }) }))!;
    expect(d.speak).toBe(true);
    expect(d.role).toBe('peer');
    // `answer_then_teach`, not `respond`, since #36: a move called "respond" is satisfied by a
    // Socratic probe, which is the turn this rule exists to produce the opposite of.
    expect(d.moveType).toBe('answer_then_teach');
    expect(d.decidedBy).toBe('rule:teacher_answers');
  });

  it('does not outrank the hand-off, the feedback debt or the REFERENCE lock', () => {
    expect(ruleDecision(input({ anchoredThread: true, handOff: due() }))!.decidedBy).toBe('rule:handoff');
    expect(ruleDecision(input({ anchoredThread: true, referenceLocked: true }))!.decidedBy).toBe('rule:reference_locked');
    expect(ruleDecision(input({ anchoredThread: true, consecutiveAgentTurns: 2 }))!.decidedBy).toBe('rule:no_dogpile');
  });

  it('leaves the room-level stream to the model', () => {
    expect(ruleDecision(input({ anchoredThread: false, handOff: due({ due: false }) }))).toBeNull();
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
    const quiz = openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0);
    const s1 = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: 1, pendingQuiz: quiz });
    expect(s1.speak).toBe(true);
    expect(s1.role).toBe('challenger');
    expect(s1.moveType).toBe('content_free_nudge');
    expect(s1.decidedBy).toBe('rule:silence_quiz_waiting');
    const s2 = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: 2, pendingQuiz: quiz });
    expect(s2.role).toBe('challenger');
    expect(s2.moveType).toBe('quiz_hint');
    expect(s2.targetElementId).toBe('R2');
    expect(s2.decidedBy).toBe('rule:silence_hint');
  });

  it('still says nothing after an explanation once the answer has been shown (no debt)', () => {
    const quiz = { ...openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0), answerShown: true };
    const d = silence({ lastAgentTurn: 'teacher_explanation', silenceStage: 1, pendingQuiz: quiz });
    expect(d.speak).toBe(false);
    expect(d.decidedBy).toBe('rule:silence_after_explanation');
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
      // Asked, not yet answered — so `feedbackDue` is false and the quiz is genuinely pending.
      pendingQuiz: openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0),
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
      pendingQuiz: openQuiz({ quizMessageId: 'm1', elementId: 'R2' }, 0),
    });
    expect(d.speak).toBe(true);
    expect(d.decidedBy).toBe('rule:silence_hint');
    // The cap still governs everything that is not a silence.
    expect(ruleDecision(input({ consecutiveAgentTurns: 2 }))!.decidedBy).toBe('rule:no_dogpile');
  });

  it('still yields to the REFERENCE lock, which outranks every fill', () => {
    const d = ruleDecision(
      input({ trigger: 'silence', silenceStage: 1, lastAgentTurn: 'tester_question', referenceLocked: true }),
    )!;
    expect(d.speak).toBe(false);
    expect(d.decidedBy).toBe('rule:reference_locked');
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

  it('does not let a fill, a yield or the opener rewrite what the thread is about', () => {
    for (const move of ['yield', 'content_free_nudge', 'incomplete_scaffold', 'reexplain_simpler', 'offer_step_back', 'quiz_hint']) {
      expect(classifyAgentTurn(decision(move), 'tester_question')).toBe('tester_question');
      expect(classifyAgentTurn(decision(move), 'teacher_explanation')).toBe('teacher_explanation');
    }
    expect(classifyAgentTurn(decision('opener'), 'teacher_explanation')).toBe('none');
    expect(classifyAgentTurn(decision('anything', null), 'tester_question')).toBe('tester_question');
  });
});
