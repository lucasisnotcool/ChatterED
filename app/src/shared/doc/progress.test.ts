/**
 * The bar's one number (§6). The assertions that matter are the zeroes: a released answer, and a
 * question the learner has not yet got, fill nothing — that is the counterweight §1 names for an
 * AI-written document, and it is the ledger's verbatim rule in its smallest form.
 */

import { describe, expect, it } from 'vitest';
import { progressFill } from './progress.js';
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
