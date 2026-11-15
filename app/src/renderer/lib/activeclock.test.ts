import { describe, expect, it } from 'vitest';
import { ActiveClock } from './activeclock.js';

const MIN = 60_000;

describe('ActiveClock', () => {
  it('counts each minute with input once, however much input there was', () => {
    const c = new ActiveClock();
    for (let i = 0; i < 50; i++) c.mark(10 * MIN + i * 1000);
    c.mark(11 * MIN + 5);
    c.mark(14 * MIN);
    expect(c.take()).toBe(3);
    expect(c.take()).toBe(0);
  });

  it('does not count idle minutes between bursts', () => {
    const c = new ActiveClock();
    c.mark(0);
    c.mark(30 * MIN);
    expect(c.take()).toBe(2);
  });

  it('does not count a minute twice when a report falls inside it', () => {
    const c = new ActiveClock();
    c.mark(5 * MIN + 10);
    expect(c.take()).toBe(1);
    c.mark(5 * MIN + 50_000);
    expect(c.take()).toBe(0);
    c.mark(6 * MIN);
    expect(c.take()).toBe(1);
  });
});
