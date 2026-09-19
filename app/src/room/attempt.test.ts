/**
 * The classifier the answer lock runs on (issue #47, `attempt-first.md` §2.2).
 *
 * The `answer_request` cases are **R6's own lines**, copied out of the coded study
 * (`ai-use-transcripts/analysis/findings.md` §3.0): that transcript is the only one of the six
 * that produced attempts at all, and the phrasings it used to ask for the answer are the
 * behaviour this rule has to recognise.
 */
import { describe, expect, it } from 'vitest';
import { ANSWER_REQUEST_PHRASES, classifyLearnerTurn, quizCue } from './attempt.js';

describe('classifyLearnerTurn', () => {
  it('reads R6’s own asks as answer requests', () => {
    for (const line of [
      'answer?',
      'please solve the question',
      "what's the answer",
      'send me the answer',
      'how would you do it?',
    ]) {
      expect(classifyLearnerTurn(line), line).toBe('answer_request');
    }
  });

  it('reads the other phrasings of the same ask', () => {
    for (const line of ['just tell me', 'I give up', 'skip', 'show me the answer', 'solve it']) {
      expect(classifyLearnerTurn(line), line).toBe('answer_request');
    }
  });

  /**
   * The lock is about having tried, not about having explained: **a two-word answer is an
   * attempt.** Rule 4's eight-word floor still stops it moving the ledger, which is the division
   * §2.2 draws and the reason `isAgreementPhrase` exists separately from `isAgreementOnly`.
   */
  it('counts a two-word answer as an attempt', () => {
    expect(classifyLearnerTurn('positive semidefinite')).toBe('attempt');
    expect(classifyLearnerTurn('the Hessian')).toBe('attempt');
  });

  it('counts agreement as other — “ok” is what R6 replied to eleven wrong verdicts', () => {
    expect(classifyLearnerTurn('ok')).toBe('other');
    expect(classifyLearnerTurn('okay got it')).toBe('other');
    expect(classifyLearnerTurn('   ')).toBe('other');
  });

  it('reads a short clarification as a question, not an attempt', () => {
    expect(classifyLearnerTurn('what does T mean?')).toBe('question');
    expect(classifyLearnerTurn('is that the same as the gradient?')).toBe('question');
  });

  /**
   * A hedge is not a clarification. An answer that ends "is that right?" has earned the feedback
   * turn, and classifying it as a question would withhold it.
   */
  it('reads a long answer that ends “is that right?” as an attempt', () => {
    const answer =
      'The Hessian has to be positive semidefinite at every point for the function to be convex, is that right?';
    expect(classifyLearnerTurn(answer)).toBe('attempt');
  });

  /**
   * **A guess phrased as a question is an attempt** (Lucas, 2026-09-19, on the MDP deck). This line
   * drew `rule:quiz_clarify`: Max clarified, nothing was marked, and the learner did not know
   * whether he had answered. It opens like a question and carries two candidate answers.
   */
  it('reads a hedged guess, or a choice between alternatives, as an attempt', () => {
    expect(
      classifyLearnerTurn('is it an action, or a series of actions that lead to the goal state from the current state?'),
    ).toBe('attempt');
    expect(classifyLearnerTurn('is it trying to find the best possible action from the current state towards the goal?')).toBe(
      'attempt',
    );
    expect(classifyLearnerTurn('The entire output is a list of actions and states from I to G?')).toBe('attempt');
    expect(classifyLearnerTurn('could it be the transition model?')).toBe('attempt');
    expect(classifyLearnerTurn('is the answer discrete and deterministic?')).toBe('attempt');
    expect(classifyLearnerTurn('deterministic, or fully observable?')).toBe('attempt');
  });

  it('still reads a question about a term, or about the question, as a question', () => {
    expect(classifyLearnerTurn('what are you asking here?')).toBe('question');
    expect(classifyLearnerTurn('what does the or in step 3 mean?')).toBe('question');
    expect(classifyLearnerTurn('do you mean the whole plan?')).toBe('question');
  });

  /**
   * *"can you help me out here"* (the same run): nothing to mark, and not a request for the
   * answer. `other` draws `rule:quiz_nudge` — one hint, no answer — which is the turn it wanted.
   */
  it('reads a request for help as other, so it draws a hint and not a mark', () => {
    for (const line of ['can you help me out here', 'hint?', 'give me a hint', "i'm stuck", 'help']) {
      expect(classifyLearnerTurn(line), line).toBe('other');
    }
    // But an answer that happens to contain "help" is still an answer.
    expect(classifyLearnerTurn('heuristics help the search by estimating the distance to the goal')).toBe('attempt');
  });

  it('does not read an answer that mentions the word answer as a request for one', () => {
    expect(classifyLearnerTurn('my answer is that the Hessian is positive semidefinite')).toBe('attempt');
  });

  it('does not read a long turn as a bare request, however it opens', () => {
    const long = `just tell me ${'more about how the second derivative test generalises to several variables '.repeat(2)}because I want to understand the whole picture properly here`;
    expect(classifyLearnerTurn(long)).toBe('attempt');
  });

  it('keeps the phrase list exported, so the transcript is the source of the rule', () => {
    expect(ANSWER_REQUEST_PHRASES.some((p) => p.phrase === 'answer' && p.match === 'whole')).toBe(true);
  });
});

describe('quizCue', () => {
  it('names every turn of one Tester question with the same number', () => {
    expect(quizCue('try', 2)).toBe('try:2');
    expect(quizCue('handoff', 1)).toBe('handoff:1');
    expect(quizCue('feedback', 2)).toBe('feedback:2');
    expect(quizCue('hint', 2)).toBe('hint:2');
    expect(quizCue('clarify', 2)).toBe('clarify:2');
    expect(quizCue('answer', 2)).toBe('answer:2');
  });
});
