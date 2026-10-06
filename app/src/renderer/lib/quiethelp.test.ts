import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_TICK_MS,
  QUIET_HELP_MS,
  drafting,
  forgetQuiet,
  noteDraft,
  quietFor,
  resetQuietHelp,
  startQuiet,
  tickQuiet,
} from './quiethelp.js';

/** Tick a clock every `step` ms for `ms`, drafting or not. */
function run(clock = startQuiet(0), ms: number, drafting = false, step = 1_000) {
  let c = clock;
  const from = c.lastTickAt ?? 0;
  for (let t = from + step; t <= from + ms; t += step) c = tickQuiet(c, t, { drafting });
  return c;
}

describe('the quiet clock (decision 7)', () => {
  beforeEach(() => resetQuietHelp());

  it('offers help after about three minutes of quiet, not before', () => {
    expect(QUIET_HELP_MS).toBe(180_000);
    expect(run(undefined, QUIET_HELP_MS - 1_000).offered).toBe(false);
    expect(run(undefined, QUIET_HELP_MS).offered).toBe(true);
  });

  it('does not count time the composer has text', () => {
    const typed = run(undefined, 10 * 60_000, true);
    expect(typed.quietMs).toBe(0);
    expect(typed.offered).toBe(false);
    // Two minutes typing, then two quiet: 2 minutes counted, not 4.
    const mixed = run(run(undefined, 120_000, true), 120_000, false);
    expect(mixed.quietMs).toBe(120_000);
    expect(mixed.offered).toBe(false);
  });

  it('counts a long gap between ticks (a sleeping laptop) as one short tick', () => {
    const c = tickQuiet(startQuiet(0), 60 * 60_000, { drafting: false });
    expect(c.quietMs).toBe(MAX_TICK_MS);
    expect(c.offered).toBe(false);
  });

  it('keeps the offer once made, even when the learner starts typing', () => {
    const offered = run(undefined, QUIET_HELP_MS);
    expect(tickQuiet(offered, (offered.lastTickAt ?? 0) + 1_000, { drafting: true }).offered).toBe(true);
  });

  it('keeps one clock per question across redraws, and forgets it when the question closes', () => {
    quietFor('q_1', 0, false);
    for (let t = 1_000; t <= 60_000; t += 1_000) quietFor('q_1', t, false);
    expect(quietFor('q_1', 61_000, false).quietMs).toBe(61_000);
    // Another question has its own clock.
    expect(quietFor('q_2', 61_000, false).quietMs).toBe(0);
    forgetQuiet('q_1');
    expect(quietFor('q_1', 62_000, false).quietMs).toBe(0);
  });

  it('knows when any composer has text', () => {
    expect(drafting()).toBe(false);
    noteDraft('chat', true);
    noteDraft('private:ellie', true);
    expect(drafting()).toBe(true);
    noteDraft('chat', false);
    expect(drafting()).toBe(true);
    noteDraft('private:ellie', false);
    expect(drafting()).toBe(false);
  });
});
