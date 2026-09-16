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
import { answerQuiz, openQuiz, type HandOffVerdict, type QuizzableItem } from './flow.js';
import { decideTurn, roleFromMove, roleFromName, ruleDecision, type DecisionInput } from './orchestrator.js';
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

  it('never fires on a silence — the Teacher fills a silence, not the Tester', () => {
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
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10');
    const d = ruleDecision(input({ pendingQuiz: quiz }))!;
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
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10');
    const d = ruleDecision(input({ consecutiveAgentTurns: 2, pendingQuiz: quiz }))!;
    expect(d.decidedBy).toBe('rule:quiz_feedback');
  });

  it('is still refused inside a locked REFERENCE thread', () => {
    const quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R2' }, clock.now()), 'm_10');
    const d = ruleDecision(input({ pendingQuiz: quiz, referenceLocked: true }))!;
    expect(d.decidedBy).toBe('rule:reference_locked');
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
