/**
 * D2 (2026-10-06): readiness is decided in code from what the learner did, and only offered.
 *
 * The cases that matter are the two the runs showed: a cold section (nothing done, or only time
 * passed) is never ready, and an earned objective is never offered again.
 */

import { describe, expect, it } from 'vitest';
import {
  READY_DEPTH_OPENED,
  READY_DWELL_MS,
  READY_OWN_WORDS,
  offerCheck,
  readiness,
  type ReadinessSignals,
} from './readiness.js';

const cold: ReadinessSignals = {
  done: false,
  questionOpen: false,
  explains: 0,
  examples: 0,
  ownWords: 0,
  depthOpened: 0,
  dwellMs: 0,
};

describe('readiness', () => {
  it('is never ready on a cold section', () => {
    expect(readiness(cold)).toEqual({ state: 'not_yet', needs: ['time', 'engagement'] });
  });

  it('is not ready on time alone: a section left on screen is the cold opener again', () => {
    expect(readiness({ ...cold, dwellMs: 10 * READY_DWELL_MS })).toEqual({ state: 'not_yet', needs: ['engagement'] });
  });

  it('is not ready on one act pressed at once, before the learner has read it', () => {
    expect(readiness({ ...cold, explains: 1, dwellMs: 15_000 })).toEqual({ state: 'not_yet', needs: ['time'] });
  });

  it('is ready after help and a minute on the section', () => {
    expect(readiness({ ...cold, explains: 1, dwellMs: READY_DWELL_MS })).toEqual({ state: 'ready', because: ['help'] });
    expect(readiness({ ...cold, examples: 1, dwellMs: READY_DWELL_MS })).toEqual({ state: 'ready', because: ['help'] });
  });

  // Decision 8 (6 Oct afternoon, #67): the Lecture-sdm session's five questions to Ellie about
  // "RL set-up" counted nothing toward the offer.
  it('counts a question to Ellie about the section as help, like Explain and Example', () => {
    expect(readiness({ ...cold, questions: 1, dwellMs: READY_DWELL_MS })).toEqual({ state: 'ready', because: ['help'] });
    expect(readiness({ ...cold, questions: 1 })).toEqual({ state: 'not_yet', needs: ['time'] });
    expect(readiness({ ...cold, questions: -2, dwellMs: READY_DWELL_MS })).toEqual({ state: 'not_yet', needs: ['engagement'] });
  });

  it('counts one sentence of the learner’s own words, not a heading', () => {
    expect(readiness({ ...cold, ownWords: READY_OWN_WORDS - 1, dwellMs: READY_DWELL_MS }).state).toBe('not_yet');
    expect(readiness({ ...cold, ownWords: READY_OWN_WORDS, dwellMs: READY_DWELL_MS })).toEqual({
      state: 'ready',
      because: ['own_words'],
    });
  });

  it('needs two folds opened, not one', () => {
    expect(readiness({ ...cold, depthOpened: READY_DEPTH_OPENED - 1, dwellMs: READY_DWELL_MS }).state).toBe('not_yet');
    expect(readiness({ ...cold, depthOpened: READY_DEPTH_OPENED, dwellMs: READY_DWELL_MS })).toEqual({
      state: 'ready',
      because: ['depth'],
    });
  });

  it('names every reason that counted, in a fixed order', () => {
    const all = { ...cold, explains: 2, ownWords: 40, depthOpened: 3, dwellMs: 5 * READY_DWELL_MS };
    expect(readiness(all)).toEqual({ state: 'ready', because: ['help', 'own_words', 'depth'] });
  });

  it('never offers an objective already earned, whatever was done since', () => {
    const busy = { ...cold, done: true, explains: 3, ownWords: 80, dwellMs: 10 * READY_DWELL_MS };
    expect(readiness(busy)).toEqual({ state: 'done' });
  });

  it('says a question is open rather than offering a second one', () => {
    expect(readiness({ ...cold, questionOpen: true, explains: 1, dwellMs: READY_DWELL_MS })).toEqual({ state: 'asking' });
  });

  it('reads a negative or non-finite count as none', () => {
    expect(readiness({ ...cold, explains: -3, ownWords: Number.NaN, dwellMs: Number.POSITIVE_INFINITY }).state).toBe('not_yet');
  });
});

describe('offerCheck', () => {
  it('is true only when ready', () => {
    expect(offerCheck({ ...cold, explains: 1, dwellMs: READY_DWELL_MS })).toBe(true);
    expect(offerCheck(cold)).toBe(false);
    expect(offerCheck({ ...cold, done: true, explains: 1, dwellMs: READY_DWELL_MS })).toBe(false);
  });
});
