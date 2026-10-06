/**
 * Items 3 and 17 (6 Oct afternoon, `notebooks.md` §11.10): Max's hidden model answer, the verdict
 * decided in code from the points the learner's answers state, and what a release may credit.
 *
 * The fixtures are the first 6 Oct session's question (#34) and its tries (#35–#43): the learner
 * had the idea by #41 and #43, in his own words, and was marked *Partly there* five times.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_KEY_POINTS,
  allCovered,
  coveredUnion,
  creditedPoints,
  parseFeedbackReply,
  parseQuestionReply,
  verdictFromPoints,
} from './marking.js';

const MODEL = {
  answer:
    'For a fixed $s$ and $a$, $T(s,a,\\cdot)$ is a probability distribution over next states: the action must lead ' +
    'somewhere, so the outcomes total 1. At 0.9 the expected utility sum would miss mass and undervalue the action.',
  points: [
    'For a fixed state and action, the outcomes cover every possibility, so their probabilities total 1',
    'With a total of 0.9 the expected utility of that action is undervalued',
  ],
};

describe('parseQuestionReply', () => {
  it('reads the question, the model answer and its points', () => {
    const raw = JSON.stringify({
      text: 'Why must $\\sum_{s\'} T(s,a,s\')$ equal 1 for every state and action?',
      model_answer: MODEL.answer,
      key_points: MODEL.points,
    });
    expect(parseQuestionReply(raw)).toEqual({
      text: "Why must $\\sum_{s'} T(s,a,s')$ equal 1 for every state and action?",
      model: MODEL,
    });
  });

  it('keeps at most three points and drops empty ones', () => {
    const raw = JSON.stringify({ text: 'Q?', model_answer: 'A.', key_points: ['a', '', 'b', 'c', 'd'] });
    expect(MAX_KEY_POINTS).toBe(3);
    expect(parseQuestionReply(raw).model?.points).toEqual(['a', 'b', 'c']);
  });

  it('reads JSON wrapped in prose or a fence', () => {
    const raw = '```json\n{"text":"Q?","model_answer":"A.","key_points":["a"]}\n```';
    expect(parseQuestionReply(raw)).toEqual({ text: 'Q?', model: { answer: 'A.', points: ['a'] } });
  });

  it('falls back to the plain words with no model answer when the reply is not the object', () => {
    expect(parseQuestionReply('What must hold before Fly runs?')).toEqual({ text: 'What must hold before Fly runs?', model: null });
    expect(parseQuestionReply('{"text":"Q?","key_points":[]}')).toEqual({ text: 'Q?', model: null });
  });
});

describe('parseFeedbackReply', () => {
  it('reads the text and the points covered, dropping numbers out of range', () => {
    const raw = JSON.stringify({ text: '**Well done.** That is it.', covered: [2, 1, 1, 7, '2'] });
    expect(parseFeedbackReply(raw, 2)).toEqual({ text: '**Well done.** That is it.', covered: [1, 2] });
  });

  it('falls back to the plain words with no coverage', () => {
    expect(parseFeedbackReply('**Partly there.** Close.', 2)).toEqual({ text: '**Partly there.** Close.', covered: null });
    expect(parseFeedbackReply('{"text":"**Not yet.**"}', 2)).toEqual({ text: '**Not yet.**', covered: null });
  });
});

describe('verdictFromPoints', () => {
  /**
   * #37 had point 2 ("computed expected utility will be lower than actual"), #43 had point 1 in his
   * own words ("the agent must take an action… an action must have an effect, so all must total 1").
   * Taken together that is every point: Well done, not a fifth Partly there.
   */
  it('gives Well done when the answers together state every point, whatever the words said', () => {
    const covered = coveredUnion([2], [1]);
    expect(covered).toEqual([1, 2]);
    expect(verdictFromPoints({ pointCount: 2, covered, stated: 'partial' })).toBe('complete');
    expect(allCovered(2, covered)).toBe(true);
  });

  it('gives Partly there on some points, never Well done and never Not yet', () => {
    expect(verdictFromPoints({ pointCount: 2, covered: [1], stated: 'complete' })).toBe('partial');
    expect(verdictFromPoints({ pointCount: 2, covered: [1], stated: 'not_yet' })).toBe('partial');
  });

  it('keeps the words on no points, but never Well done', () => {
    expect(verdictFromPoints({ pointCount: 2, covered: [], stated: 'not_yet' })).toBe('not_yet');
    expect(verdictFromPoints({ pointCount: 2, covered: [], stated: 'complete' })).toBe('partial');
    expect(verdictFromPoints({ pointCount: 2, covered: [], stated: null })).toBe('partial');
  });

  it('leaves the words alone when there is nothing to mark against', () => {
    expect(verdictFromPoints({ pointCount: 0, covered: [1], stated: 'complete' })).toBe('complete');
    expect(verdictFromPoints({ pointCount: 2, covered: null, stated: 'not_yet' })).toBe('not_yet');
    expect(verdictFromPoints({ pointCount: 2, covered: null, stated: null })).toBeNull();
  });
});

describe('allCovered and coveredUnion', () => {
  it('is false with no points, or one missing', () => {
    expect(allCovered(0, [])).toBe(false);
    expect(allCovered(2, [2])).toBe(false);
    expect(allCovered(2, null)).toBe(false);
  });

  it('unions earlier and later coverage, sorted', () => {
    expect(coveredUnion(null, [3, 1])).toEqual([1, 3]);
    expect(coveredUnion([2], undefined)).toEqual([2]);
  });
});

describe('creditedPoints (item 17)', () => {
  it('credits exactly the points stated, and nothing else', () => {
    expect(creditedPoints(MODEL, [2])).toEqual([MODEL.points[1]]);
    expect(creditedPoints(MODEL, [])).toEqual([]);
    expect(creditedPoints(null, [1])).toEqual([]);
  });
});
