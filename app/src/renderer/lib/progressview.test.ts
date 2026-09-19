import { describe, expect, it } from 'vitest';
import {
  assumedObjectives,
  completedOf,
  countLabel,
  fillWord,
  fraction,
  isComplete,
  movedObjectives,
  pageChips,
  segments,
  startLabel,
  statusLine,
  taughtObjectives,
  totalOf,
} from './progressview.js';
import type { ProgressObjectiveView, ProgressView } from '../../shared/doc/types.js';

function objective(id: string, fill: 0 | 0.5 | 1, over: Partial<ProgressObjectiveView> = {}): ProgressObjectiveView {
  return {
    objectiveId: id,
    title: id,
    statement: '',
    criteria: [],
    pages: [],
    blockIds: [],
    fill,
    level: fill === 1 ? 3 : fill === 0.5 ? 2 : 0,
    assumedByDeck: false,
    evidence: null,
    lastMovedAt: null,
    ...over,
  };
}

function view(objectives: ProgressObjectiveView[], status: ProgressView['status'] = 'ready'): ProgressView {
  return { fileId: 'f', docId: 'd', status, completed: 0, total: 0, fraction: 0, objectives };
}

describe('the bar counts what the deck teaches', () => {
  const v = view([
    objective('a', 1),
    objective('b', 0.5),
    objective('c', 0),
    objective('pre', 0, { assumedByDeck: true }),
  ]);

  it('leaves assumed-by-deck objectives out of the bar and the denominator', () => {
    expect(segments(v).map((s) => s.objectiveId)).toEqual(['a', 'b', 'c']);
    expect(taughtObjectives(v)).toHaveLength(3);
    expect(assumedObjectives(v).map((o) => o.objectiveId)).toEqual(['pre']);
    expect(totalOf(v)).toBe(3);
  });

  it('counts only full fills as completed, and numbers the segments in deck order', () => {
    expect(completedOf(v)).toBe(1);
    expect(countLabel(v)).toBe('1 of 3');
    expect(segments(v).map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('draws halves in the fraction even though they are not counted', () => {
    expect(fraction(v)).toBeCloseTo(0.5, 5);
  });

  it('is complete only when every taught objective is full', () => {
    expect(isComplete(v)).toBe(false);
    expect(isComplete(view([objective('a', 1), objective('pre', 0, { assumedByDeck: true })]))).toBe(true);
    expect(isComplete(view([]))).toBe(false);
  });
});

describe('statusLine', () => {
  it('says what is being waited for rather than showing an empty bar', () => {
    expect(statusLine(view([], 'pending'))).toContain('reading the deck');
    // `none` is not "there are none": asking is what starts the ingest.
    expect(statusLine(view([], 'none'))).toContain('reading the deck');
    expect(statusLine(view([], 'failed'))).toContain('could not be read');
    expect(statusLine(null)).toContain('reading the deck');
  });

  it('names the state without congratulating', () => {
    expect(statusLine(view([objective('a', 0)]))).toBe('Nothing answered in your own words yet.');
    expect(statusLine(view([objective('a', 1), objective('b', 0.5)]))).toBe('1 complete · 1 half-answered');
    expect(statusLine(view([objective('a', 1), objective('b', 0)]))).toBe('1 answered in your own words');
    expect(statusLine(view([objective('a', 1)]))).toBe('Every objective on this deck is yours.');
  });
});

describe('the lesson card', () => {
  it('labels its one button by how far the objective has got', () => {
    expect(startLabel(0)).toBe('Start');
    expect(startLabel(0.5)).toBe('Continue');
    expect(startLabel(1)).toBe('Review');
  });

  it('words the fill for the places colour is not enough', () => {
    expect(fillWord(0)).toBe('not started');
    expect(fillWord(0.5)).toBe('half');
    expect(fillWord(1)).toBe('complete');
  });

  it('groups slide pages into runs so nine pages are not nine chips', () => {
    expect(pageChips([12, 13, 14, 20])).toEqual(['pp. 12–14', 'p. 20']);
    expect(pageChips([5])).toEqual(['p. 5']);
    expect(pageChips([9, 7, 8])).toEqual(['pp. 7–9']);
    expect(pageChips([])).toEqual([]);
  });
});

describe('movedObjectives', () => {
  it('names only the segments whose fill actually changed', () => {
    const before = view([objective('a', 0), objective('b', 0.5)]);
    const after = view([objective('a', 0), objective('b', 1)]);
    expect(movedObjectives(before, after)).toEqual(['b']);
  });

  it('does not animate an objective that has only just appeared', () => {
    expect(movedObjectives(view([]), view([objective('a', 1)]))).toEqual([]);
    expect(movedObjectives(null, view([objective('a', 1)]))).toEqual([]);
  });
});
