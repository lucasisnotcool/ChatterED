import { describe, expect, it } from 'vitest';
import { LEAK_SHARE, MIN_POINT_WORDS, answerLeaks, contentWords, sentencesOf, withoutLeaks } from './answerguard.js';

/**
 * The Lecture-sdm run of 6 Oct (#45–#48): Max asked why an MDP needs Σ T(s,a,·) = 1. The two
 * points below are the hidden key decision 3 has Max write; Ellie's #48, had it come while the
 * question was open, states the first in its opening and is what this guard is for.
 */
const KEY = [
  'For a fixed s and a, T(s,a,·) is a probability distribution over the next states s′.',
  'Taking an action must lead somewhere, so the outcome probabilities cover every possibility and total 1.',
];
const GIVES_IT_AWAY =
  'The point is that, for a fixed state $s$ and action $a$, the numbers $T(s,a,s\')$ form a probability ' +
  'distribution over the next states you can end up in, and a distribution always adds to 1. Think of a die.';
const EXPLAINS =
  'A probability distribution lists every way something can turn out, with a chance for each. A fair die ' +
  'is one: six faces, each 1/6. On p. 7 the grid world moves the intended way with 0.8.';

describe('contentWords and sentencesOf', () => {
  it('drops stopwords, keeps TeX command names, and stems lightly', () => {
    expect(contentWords('The states are summing to $\\max_a$ values')).toEqual(['state', 'summ', 'max', 'value']);
  });

  it('splits sentences, list items and paragraphs, and keeps display maths with its sentence', () => {
    expect(sentencesOf('One. Two!\n\n- three\n- four')).toEqual(['One.', 'Two!', '- three', '- four']);
    expect(sentencesOf('It is $$x = 1$$ here. Next.')).toEqual(['It is $x = 1$ here.', 'Next.']);
  });
});

describe('answerLeaks (decision 6)', () => {
  it('catches a reply that states a key point', () => {
    const leaks = answerLeaks(GIVES_IT_AWAY, KEY);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.point).toBe(KEY[0]);
    expect(leaks[0]!.share).toBeGreaterThanOrEqual(LEAK_SHARE);
    expect(leaks[0]!.where).toContain('probability distribution');
  });

  it('lets an explanation of the idea through, on the lecture’s own example', () => {
    expect(answerLeaks(EXPLAINS, KEY)).toEqual([]);
  });

  it('checks no point shorter than MIN_POINT_WORDS: the term is the vocabulary of any explanation', () => {
    expect(MIN_POINT_WORDS).toBe(3);
    expect(answerLeaks('A probability distribution is a list of chances.', ['probability distribution'])).toEqual([]);
  });

  it('finds a point stated across two adjacent sentences', () => {
    const split = 'For a fixed state and action, consider T. It is a probability distribution over next states.';
    expect(answerLeaks(split, [KEY[0]!])).toHaveLength(1);
  });

  it('is empty with no key', () => {
    expect(answerLeaks(GIVES_IT_AWAY, [])).toEqual([]);
  });
});

describe('withoutLeaks', () => {
  it('takes out the stating sentences and keeps the rest', () => {
    expect(withoutLeaks(GIVES_IT_AWAY, KEY)).toBe('Think of a die.');
    expect(withoutLeaks(EXPLAINS, KEY)).toBe(EXPLAINS);
  });
});
