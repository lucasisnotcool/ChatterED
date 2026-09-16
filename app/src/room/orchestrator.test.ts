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
import { ruleDecision, type DecisionInput } from './orchestrator.js';

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
