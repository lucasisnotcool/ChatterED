/**
 * The interval count behind App Nap (release review P2-4): the blocker is held exactly while a
 * room's ticks are armed, and a double clear does not unbalance it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { armedIntervals, onIntervalActivity, systemClock } from './clock.js';

afterEach(() => onIntervalActivity(null));

describe('systemClock interval activity', () => {
  it('reports active on the first interval and idle when the last is cleared', () => {
    const seen: boolean[] = [];
    onIntervalActivity((active) => seen.push(active));
    expect(seen).toEqual([false]);

    const stopA = systemClock.setInterval(() => undefined, 1000);
    const stopB = systemClock.setInterval(() => undefined, 1000);
    expect(armedIntervals()).toBe(2);
    stopA();
    stopA(); // idempotent: a second clear must not count twice
    expect(armedIntervals()).toBe(1);
    stopB();
    expect(armedIntervals()).toBe(0);
    expect(seen).toEqual([false, true, false]);
  });

  it('timeouts do not count', () => {
    const stop = systemClock.setTimeout(() => undefined, 1000);
    expect(armedIntervals()).toBe(0);
    stop();
  });
});
