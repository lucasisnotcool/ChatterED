/**
 * The attempt loop's renderer-side rules (issue #47, `attempt-first.md` §2).
 *
 * These are the assertions that keep the decision from being repealed by a refactor: **no
 * *Show the answer* before one attempt**, in any quiz state the main process can hand over.
 */
import { describe, expect, it } from 'vitest';
import type { FlowQuizView } from '../../shared/types.js';
import {
  ATTEMPT_PLACEHOLDER,
  EXPLAIN_PLACEHOLDER,
  attemptNote,
  quizControls,
  ruleTag,
  tryHereState,
} from './quiz.js';

const quiz = (over: Partial<FlowQuizView> = {}): FlowQuizView => ({
  quizMessageId: 'm7',
  elementId: 'obj-1',
  attempts: 0,
  feedbackGiven: false,
  answerShown: false,
  ...over,
});

describe('quizControls', () => {
  it('offers nothing and says nothing when no quiz is open', () => {
    const c = quizControls(null);
    expect(c.open).toBe(false);
    expect(c.placeholder).toBe(EXPLAIN_PLACEHOLDER);
    expect(c.note).toBeNull();
    expect(c.tryAnother).toBe(false);
    expect(c.showAnswer).toBe(false);
    // `undefined` is what a thread view from a build without the field gives us.
    expect(quizControls(undefined)).toEqual(c);
  });

  it('asks for the attempt, and states the rule, before the first try', () => {
    const c = quizControls(quiz());
    expect(c.open).toBe(true);
    expect(c.placeholder).toBe(ATTEMPT_PLACEHOLDER);
    expect(c.note).toBe(attemptNote('Max'));
    // The whole decision: neither control exists yet.
    expect(c.tryAnother).toBe(false);
    expect(c.showAnswer).toBe(false);
  });

  it('names the Tester the room actually has', () => {
    expect(quizControls(quiz(), 'Sam').note).toContain('Sam');
  });

  it('offers neither control between the attempt and its feedback', () => {
    const c = quizControls(quiz({ attempts: 1 }));
    expect(c.tryAnother).toBe(false);
    expect(c.showAnswer).toBe(false);
    // The note has been earned away: an attempt exists, so nothing is being withheld any more.
    expect(c.note).toBeNull();
    expect(c.placeholder).toBe(EXPLAIN_PLACEHOLDER);
  });

  it('offers Try another and Show the answer once feedback has landed', () => {
    const c = quizControls(quiz({ attempts: 1, feedbackGiven: true }));
    expect(c.tryAnother).toBe(true);
    expect(c.showAnswer).toBe(true);
  });

  it('never offers Show the answer with no attempt, whatever else is set', () => {
    for (const q of [
      quiz({ attempts: 0, feedbackGiven: true }),
      quiz({ attempts: 0, answerShown: false }),
      quiz({ attempts: 0, feedbackGiven: true, answerShown: false }),
    ]) {
      expect(quizControls(q).showAnswer).toBe(false);
    }
  });

  it('drops Show the answer once it has been shown, and keeps Try another', () => {
    const c = quizControls(quiz({ attempts: 2, feedbackGiven: true, answerShown: true }));
    expect(c.showAnswer).toBe(false);
    expect(c.tryAnother).toBe(true);
    // The quiz closes on a shown answer, so the composer is an ordinary composer again.
    expect(c.placeholder).toBe(EXPLAIN_PLACEHOLDER);
    expect(c.note).toBeNull();
  });

  it('shows no withholding note on a quiz whose answer is already out', () => {
    expect(quizControls(quiz({ attempts: 0, answerShown: true })).note).toBeNull();
  });
});

describe('tryHereState', () => {
  it('is live on a ready tree', () => {
    expect(tryHereState({ tree: { status: 'ready' } })).toEqual({ enabled: true, reason: null });
  });

  it('says who is still reading while the tree is pending', () => {
    const s = tryHereState({ tree: { status: 'pending' }, teacherName: 'Ellie' });
    expect(s.enabled).toBe(false);
    expect(s.reason).toBe('Ellie is still reading the deck.');
  });

  it('prefers the tree’s own error on a failure', () => {
    const s = tryHereState({ tree: { status: 'failed', error: 'The deck has no extractable text.' } });
    expect(s.enabled).toBe(false);
    expect(s.reason).toBe('The deck has no extractable text.');
  });

  it("uses the backend's honest sentence when there is one", () => {
    const note = 'Objectives for this deck need a live backend.';
    expect(tryHereState({ tree: { status: 'pending' }, note }).reason).toBe(note);
    expect(tryHereState({ tree: null, note }).reason).toBe(note);
  });

  it('is disabled, with a reason, when there is no tree at all', () => {
    const s = tryHereState({ tree: null, teacherName: 'Ellie' });
    expect(s.enabled).toBe(false);
    expect(s.reason).toBe('Ellie has not read this deck yet.');
  });
});

describe('ruleTag', () => {
  it('tags the two decisions the learner has to be able to see', () => {
    expect(ruleTag('rule:answer_withheld')?.label).toBe('answer withheld until you try');
    expect(ruleTag('rule:answer_shown')?.label).toBe('answer shown · ledger unchanged');
  });

  it('leaves the ordinary course of the loop untagged', () => {
    for (const rule of ['rule:quiz_feedback', 'rule:quiz_clarify', 'rule:quiz_nudge', 'rule:try_here', 'model:sonnet']) {
      expect(ruleTag(rule)).toBeNull();
    }
    expect(ruleTag(null)).toBeNull();
    expect(ruleTag(undefined)).toBeNull();
  });
});
