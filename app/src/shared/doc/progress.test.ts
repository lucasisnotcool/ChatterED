/**
 * The bar's one number (§6). The assertions that matter are the zeroes: a released answer, and a
 * question the learner has not yet got, fill nothing — that is the counterweight §1 names for an
 * AI-written document, and it is the ledger's verbatim rule in its smallest form.
 */

import { describe, expect, it } from 'vitest';
import { progressFill, revisionStats } from './progress.js';
import type { QuizOutcome, QuizVerdict3 } from './types.js';

let seq = 0;

function verdict(verdict: QuizVerdict3, source: 'chat' | 'doc_text' = 'chat'): QuizOutcome {
  seq += 1;
  return {
    id: `o_${String(seq)}`,
    contentSha: 'sha',
    roomId: 'room_1',
    objectiveId: 'obj_1',
    questionId: `q_${String(seq)}`,
    kind: 'verdict',
    verdict,
    releasedBy: null,
    messageId: `m_${String(seq)}`,
    source,
    attemptIndex: 1,
    ownWords: null,
    createdAt: '2026-09-19T14:00:00.000Z',
  };
}

function released(by: 'give_up' | 'pass' | 'closure'): QuizOutcome {
  return { ...verdict('not_yet'), kind: 'released', verdict: null, releasedBy: by };
}

describe('progressFill', () => {
  it('is 0 for no outcomes at all', () => {
    expect(progressFill([])).toBe(0);
  });

  it('is 1 on a Well done', () => {
    expect(progressFill([verdict('complete')])).toBe(1);
  });

  it('is 0.5 on a Partly there', () => {
    expect(progressFill([verdict('partial')])).toBe(0.5);
  });

  it('is 0 on a Not yet', () => {
    expect(progressFill([verdict('not_yet'), verdict('not_yet')])).toBe(0);
  });

  it('fills nothing for a released answer, however it was released', () => {
    expect(progressFill([released('give_up'), released('pass'), released('closure')])).toBe(0);
  });

  it('takes the best verdict, not the last', () => {
    expect(progressFill([verdict('complete'), verdict('not_yet')])).toBe(1);
    expect(progressFill([verdict('partial'), verdict('not_yet')])).toBe(0.5);
    expect(progressFill([verdict('not_yet'), verdict('partial'), verdict('complete')])).toBe(1);
  });

  it('does not let a release cancel a verdict the learner earned', () => {
    expect(progressFill([verdict('complete'), released('give_up')])).toBe(1);
    expect(progressFill([released('closure'), verdict('partial')])).toBe(0.5);
  });

  it('counts the learner’s own doc text the same as their chat words (§6)', () => {
    expect(progressFill([verdict('complete', 'doc_text')])).toBe(1);
  });
});

/**
 * M2 (`docs/research/measurement.md` §4). The learning goal has two clauses and `progressFill`
 * answers one; these are the assertions that the second one is now visible.
 */
describe('revisionStats', () => {
  function at(index: number, v: QuizVerdict3, questionId = 'q_1'): QuizOutcome {
    return { ...verdict(v), questionId, attemptIndex: index };
  }

  it('has no rate at all when nothing was ever eligible to be revised', () => {
    // Right every time. Reporting 0 here would read as a failure to revise, and there was
    // nothing to revise.
    expect(revisionStats([at(1, 'complete')])).toEqual({ eligible: 0, revised: 0, rate: null });
    expect(revisionStats([])).toEqual({ eligible: 0, revised: 0, rate: null });
  });

  it('counts a Partly there that was never tried again as eligible and unrevised', () => {
    // The baseline: 0 of 17 attempts was a second try at the same question.
    expect(revisionStats([at(1, 'partial')])).toEqual({ eligible: 1, revised: 0, rate: 0 });
  });

  it('counts the recovery the bar cannot see', () => {
    // progressFill reads these two as a plain `complete` — identical to getting it right first
    // try. That is exactly the blindness this function exists to fix.
    const outcomes = [at(1, 'partial'), at(2, 'complete')];
    expect(progressFill(outcomes)).toBe(1);
    expect(revisionStats(outcomes)).toEqual({ eligible: 1, revised: 1, rate: 1 });
  });

  it('counts a second try that did not succeed as a revision all the same', () => {
    // The clause is "revise that answer after feedback", not "revise it correctly".
    expect(revisionStats([at(1, 'not_yet'), at(2, 'not_yet')])).toEqual({
      eligible: 1,
      revised: 1,
      rate: 1,
    });
  });

  it('is one recovery per question, not one per extra attempt', () => {
    const outcomes = [at(1, 'not_yet'), at(2, 'partial'), at(3, 'complete')];
    expect(revisionStats(outcomes)).toEqual({ eligible: 1, revised: 1, rate: 1 });
  });

  it('keeps questions apart', () => {
    const outcomes = [
      at(1, 'partial', 'q_a'),
      at(2, 'complete', 'q_a'),
      at(1, 'partial', 'q_b'),
      at(1, 'complete', 'q_c'),
    ];
    expect(revisionStats(outcomes)).toEqual({ eligible: 2, revised: 1, rate: 0.5 });
  });

  it('ignores releases, and rows written before the attempt index existed', () => {
    // A release marks no attempt, so it is neither a missed revision nor a recovery; and a
    // pre-022 row cannot honestly claim to be attempt 1.
    const pre = { ...verdict('partial'), questionId: 'q_old', attemptIndex: null };
    expect(revisionStats([pre, released('give_up')])).toEqual({
      eligible: 0,
      revised: 0,
      rate: null,
    });
  });
});
