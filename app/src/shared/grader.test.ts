/**
 * The grader copy's tour and wording (`grader.ts`): the tour moves one card at a time and ends
 * past its last card, and the grader wording never casts the reader as a participant.
 */
import { describe, expect, it } from 'vitest';
import { GRADER_NOTICE_INTRO, GRADER_NOTICE_SECTIONS, GRADER_NOTICE_TITLE, GRADER_TOUR, tourStep } from './grader.js';
import { NOTICE_INTRO, NOTICE_TITLE } from './trial.js';

describe('tourStep', () => {
  it('walks forward one card at a time and is done past the last', () => {
    expect(tourStep(0, 'next', 4)).toBe(1);
    expect(tourStep(2, 'next', 4)).toBe(3);
    expect(tourStep(3, 'next', 4)).toBe('done');
  });

  it('goes back one card, and stays on the first', () => {
    expect(tourStep(2, 'back', 4)).toBe(1);
    expect(tourStep(0, 'back', 4)).toBe(0);
  });

  it('pulls an out-of-range step back in rather than skipping or looping', () => {
    expect(tourStep(9, 'back', 4)).toBe(2);
    expect(tourStep(9, 'next', 4)).toBe('done');
    expect(tourStep(-3, 'next', 4)).toBe(1);
    expect(tourStep(Number.NaN, 'next', 4)).toBe(1);
    expect(tourStep(0, 'next', 1)).toBe('done');
  });

  it('defaults to the shipped tour, which is three or four cards', () => {
    expect(GRADER_TOUR.length).toBeGreaterThanOrEqual(3);
    expect(GRADER_TOUR.length).toBeLessThanOrEqual(4);
    expect(tourStep(GRADER_TOUR.length - 1, 'next')).toBe('done');
  });
});

describe('the grader wording', () => {
  const all = [GRADER_NOTICE_TITLE, GRADER_NOTICE_INTRO, ...GRADER_NOTICE_SECTIONS.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join('\n');

  it('never calls the grader a participant or asks them to share data', () => {
    expect(all).not.toMatch(/particip/i);
    expect(all).not.toMatch(/agree to share/i);
  });

  it('says what goes to Anthropic and that nothing goes to the team', () => {
    expect(all).toMatch(/Anthropic/);
    expect(all).toMatch(/Nothing is sent to the team/);
  });

  it('is not the participant notice', () => {
    expect(GRADER_NOTICE_TITLE).not.toBe(NOTICE_TITLE);
    expect(GRADER_NOTICE_INTRO).not.toBe(NOTICE_INTRO);
  });
});
