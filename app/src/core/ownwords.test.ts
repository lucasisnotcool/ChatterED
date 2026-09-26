/**
 * M3 (`docs/research/measurement.md` §4): how much of an answer is the learner's own.
 *
 * The assertions that matter are the nulls and the echo case. The measure exists because the
 * pivot put an AI-written answer on screen directly above the question, so an answer that is a
 * paraphrase of the block above it must be *visible*, and an answer with nothing in it must not
 * read as "entirely the learner's own".
 */

import { describe, expect, it } from 'vitest';
import { contentWords, overlapShare, ownWordsOf } from './ownwords.js';

describe('contentWords', () => {
  it('drops stopwords and single characters, and lowercases', () => {
    expect(contentWords('The value of X is in the Table')).toEqual(['value', 'table']);
  });

  it('stems a suffix so one word is not counted as two', () => {
    expect(contentWords('marginalising')).toEqual(contentWords('marginalise'));
    expect(contentWords('colliders')).toEqual(contentWords('collider'));
  });

  it('keeps the connectives that carry an explanation', () => {
    // "because" and "so" are how a causal explanation differs from a restatement, so they are
    // deliberately not stopwords.
    expect(contentWords('because so therefore')).toEqual(['because', 'so', 'therefore']);
  });

  it('is empty for a turn with no content at all', () => {
    expect(contentWords('ok, it is')).toEqual([]);
  });
});

describe('overlapShare', () => {
  it('is 1 when the answer is the source, restated', () => {
    expect(overlapShare('the copies sum to 2n', 'The copies sum to 2n.')).toBe(1);
  });

  it('is 0 when nothing is shared', () => {
    expect(overlapShare('doubling makes it geometric', 'confidence intervals are frequentist')).toBe(0);
  });

  it('measures the share of the answer, not of the source', () => {
    // Two of four content words are in the source, and the source being long does not matter.
    const share = overlapShare('doubling amortises the entire lengthy copy', 'doubling copy');
    expect(share).toBe(0.4);
  });

  it('is null when the answer has no content words, because zero would read as "all their own"', () => {
    expect(overlapShare('ok', 'the copies sum to 2n')).toBeNull();
  });

  it('is null when there is no source to have read back from', () => {
    expect(overlapShare('the copies sum to 2n', null)).toBeNull();
    expect(overlapShare('the copies sum to 2n', undefined)).toBeNull();
    expect(overlapShare('the copies sum to 2n', 'it is')).toBeNull();
  });
});

describe('ownWordsOf', () => {
  it('reports the three sources separately, because they mean different things', () => {
    const shares = ownWordsOf({
      answer: 'the doubling makes the series geometric',
      block: 'A geometric series: each doubling adds half again.',
      cue: 'I think it is something about the series?',
      question: 'Why is appending amortised constant?',
    });
    expect(shares).not.toBeNull();
    expect(shares?.block).toBeGreaterThan(0);
    expect(shares?.question).toBe(0);
  });

  it('catches the echo: an answer that is the cue restated', () => {
    const shares = ownWordsOf({
      answer: 'the copies sum to about 2n',
      cue: 'I think the copies sum to about 2n, but I am not sure',
    });
    expect(shares?.cue).toBe(1);
  });

  it('leaves a share null where that source did not exist on this question', () => {
    const shares = ownWordsOf({ answer: 'the copies sum to 2n', cue: null });
    expect(shares?.cue).toBeNull();
    expect(shares?.block).toBeNull();
  });

  it('is null for an answer with nothing in it', () => {
    expect(ownWordsOf({ answer: 'ok', block: 'anything' })).toBeNull();
    expect(ownWordsOf({ answer: null })).toBeNull();
  });
});
