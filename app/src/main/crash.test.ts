import { describe, expect, it } from 'vitest';
import { CrashBudget, isCrash } from './crash.js';

describe('CrashBudget', () => {
  it('reloads up to the limit inside the window, then stops', () => {
    const budget = new CrashBudget(3, 60_000);
    expect([0, 1_000, 2_000, 3_000].map((t) => budget.record(t))).toEqual([true, true, true, false]);
  });

  it('forgets crashes older than the window', () => {
    const budget = new CrashBudget(2, 10_000);
    expect(budget.record(0)).toBe(true);
    expect(budget.record(1_000)).toBe(true);
    expect(budget.record(2_000)).toBe(false);
    expect(budget.record(30_000)).toBe(true);
  });
});

describe('isCrash', () => {
  it('treats only a clean exit as not a crash', () => {
    expect(isCrash('clean-exit')).toBe(false);
    for (const r of ['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure']) {
      expect(isCrash(r)).toBe(true);
    }
  });
});
