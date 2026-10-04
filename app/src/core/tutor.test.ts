/**
 * The help ladder's rules (`tutorials.md` §4, §6): three rungs and no fourth, a status that is
 * the last check's verdict, a release that stays a release, and full credit whatever help was used.
 */
import { describe, expect, it } from 'vitest';
import { fillFor, hintRungName, nextHintLevel, statusAfterCheck, statusAfterEdit, TOP_HINT_LEVEL, type PartStatus } from './tutor.js';

describe('nextHintLevel', () => {
  it('climbs one rung per press and stops at the third', () => {
    expect(nextHintLevel(0)).toEqual({ level: 1 });
    expect(nextHintLevel(1)).toEqual({ level: 2 });
    expect(nextHintLevel(2)).toEqual({ level: 3 });
    expect(nextHintLevel(3)).toEqual({ top: true });
    expect(TOP_HINT_LEVEL).toBe(3);
  });
});

describe('hintRungName', () => {
  it('names the three rungs', () => {
    expect([1, 2, 3].map((l) => hintRungName(l as 1 | 2 | 3))).toEqual(['Point', 'Break it down', 'A worked step']);
  });
});

describe('statusAfterCheck', () => {
  it('maps the three verdicts', () => {
    expect(statusAfterCheck('complete')).toBe('correct');
    expect(statusAfterCheck('partial')).toBe('partial');
    expect(statusAfterCheck('not_yet')).toBe('incorrect');
  });

  it('keeps a revealed part revealed: a copied answer is not a fill', () => {
    expect(statusAfterCheck('complete', 'revealed')).toBe('revealed');
    expect(statusAfterCheck('complete', 'incorrect')).toBe('correct');
  });
});

describe('statusAfterEdit', () => {
  it('starts work on an untried part', () => {
    expect(statusAfterEdit('untried', false)).toBe('working');
    expect(statusAfterEdit('working', false)).toBe('working');
  });

  it('keeps the last check verdict until the next check', () => {
    for (const s of ['correct', 'partial', 'incorrect'] as PartStatus[]) expect(statusAfterEdit(s, false)).toBe(s);
  });

  it('goes back to untried when emptied, except after a reveal', () => {
    for (const s of ['working', 'correct', 'partial', 'incorrect'] as PartStatus[]) expect(statusAfterEdit(s, true)).toBe('untried');
    expect(statusAfterEdit('revealed', true)).toBe('revealed');
    expect(statusAfterEdit('revealed', false)).toBe('revealed');
  });
});

describe('fillFor', () => {
  it('fills 1 for correct, a half for partial, nothing otherwise (a reveal included)', () => {
    expect(fillFor('correct')).toBe(1);
    expect(fillFor('partial')).toBe(0.5);
    for (const s of ['untried', 'working', 'incorrect', 'revealed'] as PartStatus[]) expect(fillFor(s)).toBe(0);
  });
});
