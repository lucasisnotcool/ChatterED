import { describe, expect, it } from 'vitest';
import {
  ATOM_COST,
  MAX_MS,
  MAX_STEPS,
  MIN_MS,
  learnerIsTyping,
  typingSchedule,
  wordBoundaries,
} from './typing.js';

describe('wordBoundaries', () => {
  it('puts the boundary after the whitespace that follows a word', () => {
    expect(wordBoundaries('one two')).toEqual([4, 7]);
  });

  it('never emits a step that reveals only whitespace', () => {
    const bounds = wordBoundaries('a   b');
    expect(bounds).toEqual([4, 5]);
  });

  it('is empty for an empty string and whole for a single word', () => {
    expect(wordBoundaries('')).toEqual([]);
    expect(wordBoundaries('supercalifragilistic')).toEqual([20]);
  });
});

describe('typingSchedule', () => {
  it('animates nothing for an empty edit', () => {
    expect(typingSchedule('')).toEqual([]);
  });

  it('reveals the whole edit in its last step', () => {
    const text = 'Value iteration sweeps the whole state space on every pass.';
    const steps = typingSchedule(text);
    expect(steps.at(-1)?.revealed).toBe(text.length);
  });

  it('is strictly increasing in time and in characters', () => {
    const steps = typingSchedule('The Bellman update is a fixed point of the optimal value function.');
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.revealed).toBeGreaterThan(steps[i - 1]!.revealed);
      expect(steps[i]!.at).toBeGreaterThanOrEqual(steps[i - 1]!.at);
    }
  });

  it('lands a mid-length edit inside the 6-8 s ceiling the brief asks for', () => {
    const text = 'word '.repeat(120);
    const steps = typingSchedule(text);
    expect(steps.at(-1)?.at).toBeLessThanOrEqual(MAX_MS);
  });

  it('clamps a very short edit up to the floor, so three words still read as typing', () => {
    const steps = typingSchedule('Not quite.');
    expect(steps.at(-1)?.at).toBe(MIN_MS);
  });

  it('clamps a very long edit down to the ceiling rather than crawling', () => {
    const steps = typingSchedule('a'.repeat(20_000));
    expect(steps.at(-1)?.at).toBe(MAX_MS);
  });

  it('never dispatches more than MAX_STEPS reveals', () => {
    const steps = typingSchedule('word '.repeat(4_000));
    expect(steps.length).toBeLessThanOrEqual(MAX_STEPS + 1);
  });

  it('spends time in proportion to characters, not to words', () => {
    // Two steps: a long word then a short one. The first must take the larger share.
    const steps = typingSchedule('extraordinarily on', { minMs: 0, maxMs: 100_000 });
    expect(steps.length).toBe(2);
    const first = steps[0]!.at;
    const second = steps[1]!.at - steps[0]!.at;
    expect(first).toBeGreaterThan(second);
  });

  it('honours an explicit rate', () => {
    // 20 characters at 10 cps is 2 s, comfortably inside the default clamps.
    const steps = typingSchedule('12345678901234567890', { charsPerSecond: 10, maxMs: 100_000 });
    expect(steps.at(-1)?.at).toBe(2_000);
  });

  it('prices an atom at ATOM_COST so a figure does not flash past between two words', () => {
    // The reveal counter treats an atom as ATOM_COST placeholder characters; the schedule only
    // has to give those characters time, which this pins.
    const withAtom = typingSchedule(`two words ${' '.repeat(ATOM_COST)}`, { maxMs: 100_000 });
    const withoutAtom = typingSchedule('two words ', { maxMs: 100_000 });
    expect(withAtom.at(-1)!.at).toBeGreaterThan(withoutAtom.at(-1)!.at);
  });
});

describe('learnerIsTyping', () => {
  it('is false before the learner has ever typed', () => {
    expect(learnerIsTyping(0, 10_000)).toBe(false);
  });

  it('is true inside the quiet window and false after it', () => {
    expect(learnerIsTyping(10_000, 11_000)).toBe(true);
    expect(learnerIsTyping(10_000, 12_500)).toBe(false);
  });

  it('takes the window as a parameter', () => {
    expect(learnerIsTyping(10_000, 10_500, 200)).toBe(false);
  });
});
