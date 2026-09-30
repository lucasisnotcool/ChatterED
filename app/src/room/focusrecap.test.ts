/**
 * **Where to look next** (`collab-doc.md` §4.8). The recap is a reading of the outcome rows, so
 * these pin what it reads: only this sitting decides whether it speaks, the fills decide what it
 * lists, and a release is only "answer shown" while it is the last thing that happened there.
 */
import { describe, expect, it } from 'vitest';
import { focusRecap, focusRecapText, pagesLabel, RECAP_LIST_CAP } from './focusrecap.js';

const SINCE = '2026-10-01T10:00:00.000Z';
const BEFORE = '2026-09-30T09:00:00.000Z';
const DURING = '2026-10-01T10:05:00.000Z';
const LATER = '2026-10-01T10:09:00.000Z';

const objective = (id: string, fill: 0 | 0.5 | 1, pages: number[] = [1], assumedByDeck = false) => ({
  objectiveId: id,
  title: `Objective ${id}`,
  pages,
  fill,
  assumedByDeck,
});

const outcome = (objectiveId: string | null, kind: 'verdict' | 'released', createdAt = DURING) => ({
  objectiveId,
  kind,
  createdAt,
});

describe('focusRecap', () => {
  it('says nothing when no question was resolved this sitting', () => {
    const recap = focusRecap({
      objectives: [objective('a', 0), objective('b', 1)],
      outcomes: [outcome('b', 'verdict', BEFORE)],
      since: SINCE,
    });
    expect(recap).toBeNull();
  });

  it('says nothing when the file has no objectives to count', () => {
    expect(focusRecap({ objectives: [], outcomes: [outcome('a', 'verdict')], since: SINCE })).toBeNull();
    expect(
      focusRecap({ objectives: [objective('a', 0, [1], true)], outcomes: [outcome('a', 'verdict')], since: SINCE }),
    ).toBeNull();
  });

  it('sorts what is left into released, partly there and not started, in deck order', () => {
    const recap = focusRecap({
      objectives: [objective('a', 1), objective('b', 0), objective('c', 0.5), objective('d', 0), objective('e', 0)],
      outcomes: [outcome('a', 'verdict'), outcome('b', 'released'), outcome('c', 'verdict')],
      since: SINCE,
    })!;
    expect(recap.completed).toBe(1);
    expect(recap.total).toBe(5);
    expect(recap.released.map((i) => i.objectiveId)).toEqual(['b']);
    expect(recap.partial.map((i) => i.objectiveId)).toEqual(['c']);
    expect(recap.notStarted.map((i) => i.objectiveId)).toEqual(['d', 'e']);
  });

  it('does not count what the deck assumes', () => {
    const recap = focusRecap({
      objectives: [objective('a', 0), objective('pre', 0, [1], true)],
      outcomes: [outcome('a', 'verdict')],
      since: SINCE,
    })!;
    expect(recap.total).toBe(1);
    expect(recap.notStarted.map((i) => i.objectiveId)).toEqual(['a']);
  });

  /** A release is "answer shown" only while it is the last thing that happened on the objective. */
  it('stops calling an objective released once a later question on it was marked', () => {
    const recap = focusRecap({
      objectives: [objective('a', 0.5)],
      outcomes: [outcome('a', 'released', DURING), outcome('a', 'verdict', LATER)],
      since: SINCE,
    })!;
    expect(recap.released).toEqual([]);
    expect(recap.partial.map((i) => i.objectiveId)).toEqual(['a']);
  });

  it('does not list a release from an earlier sitting as this one’s', () => {
    const recap = focusRecap({
      objectives: [objective('a', 0), objective('b', 0.5)],
      outcomes: [outcome('a', 'released', BEFORE), outcome('b', 'verdict', DURING)],
      since: SINCE,
    })!;
    expect(recap.released).toEqual([]);
    expect(recap.notStarted.map((i) => i.objectiveId)).toEqual(['a']);
  });

  it('never lists a complete objective, even if its last question was released', () => {
    const recap = focusRecap({
      objectives: [objective('a', 1)],
      outcomes: [outcome('a', 'verdict'), outcome('a', 'released', LATER)],
      since: SINCE,
    })!;
    expect(recap.released).toEqual([]);
    expect(recap.completed).toBe(1);
  });
});

describe('pagesLabel', () => {
  it('writes the forms the chat links', () => {
    expect(pagesLabel([12])).toBe('p. 12');
    expect(pagesLabel([14, 12, 13])).toBe('p. 12–14');
    expect(pagesLabel([3, 7])).toBe('p. 3');
    expect(pagesLabel([])).toBe('');
  });
});

describe('focusRecapText', () => {
  it('names each item with its page, most urgent first', () => {
    const text = focusRecapText({
      completed: 1,
      total: 4,
      released: [{ objectiveId: 'b', title: 'Heuristics', pages: [11] }],
      partial: [{ objectiveId: 'c', title: 'PDDL', pages: [3, 4, 5] }],
      notStarted: [{ objectiveId: 'd', title: 'Graphplan', pages: [] }],
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Where this file stands: 1 of 4 objectives complete.');
    expect(lines[1]).toBe('- Answer shown, worth another try: **Heuristics** (p. 11)');
    expect(lines[2]).toBe('- Partly there: **PDDL** (p. 3–5)');
    expect(lines[3]).toBe('- Not started: **Graphplan**');
    expect(lines[4]).toContain('Pick one');
  });

  it('caps a long list and says how many more', () => {
    const items = Array.from({ length: RECAP_LIST_CAP + 2 }, (_, i) => ({
      objectiveId: `o${String(i)}`,
      title: `T${String(i)}`,
      pages: [i + 1],
    }));
    const text = focusRecapText({ completed: 0, total: 5, released: [], partial: [], notStarted: items });
    expect(text).toContain('**T2** (p. 3); and 2 more');
    expect(text).not.toContain('T3');
  });

  it('says so, briefly, when everything is complete', () => {
    const text = focusRecapText({ completed: 3, total: 3, released: [], partial: [], notStarted: [] });
    expect(text).toBe('Where this file stands: 3 of 3 objectives complete. Nothing is left open on it.');
  });
});
