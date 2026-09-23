/**
 * **The pick behind "+ Try this"** (issue #47, `attempt-first.md` §2.1, §2.4).
 *
 * The property worth protecting: *the next question is chosen by level, lowest first.* That is
 * R6's form response — "I could not track my learning progress, so I prompted it to ask questions
 * based on my weaknesses" — implemented as a button, and it is what makes **Try another** bring a
 * missed objective back round instead of asking the same landed one twice.
 */
import { describe, expect, it } from 'vitest';
import { pickObjectiveForCard, teachesCard } from './objectives-pick.js';
import type { LearningObjective, LearningObjectiveState, ObjectiveLevel } from './objectives.js';

function objective(
  id: string,
  order: number,
  refs: { page: number; segmentId?: string }[],
): LearningObjective {
  return {
    id,
    fileId: 'f1',
    title: id,
    kind: 'objective',
    statement: `what ${id} is`,
    criteria: ['c'],
    quizSeeds: ['q'],
    refs,
    parentId: null,
    requires: [],
    assumedByDeck: refs.length === 0,
    order,
  };
}

function state(objectiveId: string, level: ObjectiveLevel): LearningObjectiveState {
  return { objectiveId, fileId: 'f1', level, evidenceMessageIds: [], lastMovedAt: null, taughtAt: null };
}

const TREE = [
  objective('a', 1, [{ page: 1 }]),
  objective('b', 2, [{ page: 3, segmentId: 'seg_3a' }]),
  objective('c', 3, [{ page: 3 }]),
  objective('d', 4, [{ page: 6 }]),
];

describe('pickObjectiveForCard', () => {
  /**
   * **The notes doc has pages and no segments** (#49): Max's follow-up is filed by the page the
   * learner asked on. A ref's `segmentId` is not a reason to miss the page it sits on.
   */
  it('picks by page alone when the card has no segment', () => {
    expect(pickObjectiveForCard({ objectives: TREE, states: [], card: { segmentId: null, page: 6 } })!.objectiveId).toBe('d');
    expect(teachesCard(TREE[1]!, { segmentId: null, page: 3 })).toBe(true);
    // Between refs, the nearest earlier page's objective, not deck order's first.
    const pick = pickObjectiveForCard({ objectives: TREE, states: [], card: { segmentId: null, page: 5 } })!;
    expect(pick.objectiveId).toBe('b');
    expect(pick.reason).toBe('nearest_earlier');
  });

  it('prefers what the card teaches, by segment id when the tree has one', () => {
    const pick = pickObjectiveForCard({ objectives: TREE, states: [], card: { segmentId: 'seg_3a', page: 3 } })!;
    // Both b (by segment) and c (by page) teach this card; deck order breaks the level tie.
    expect(pick.objectiveId).toBe('b');
    expect(pick.reason).toBe('taught_here');
    expect(teachesCard(TREE[1]!, { segmentId: 'seg_3a', page: 3 })).toBe(true);
    // The segment-keyed ref does not match a different card on the same page…
    expect(teachesCard(TREE[1]!, { segmentId: 'seg_3b', page: 3 })).toBe(false);
    // …but the page-keyed one does, which is the fallback `resolveRefSegment` also relies on.
    expect(teachesCard(TREE[2]!, { segmentId: 'seg_3b', page: 3 })).toBe(true);
  });

  it('takes the lowest level first, so a missed objective comes round again', () => {
    const states = [state('b', 3), state('c', 0)];
    const pick = pickObjectiveForCard({ objectives: TREE, states, card: { segmentId: 'seg_3a', page: 3 } })!;
    expect(pick.objectiveId).toBe('c');
    expect(pick.level).toBe(0);
  });

  it('uses deck order only to break a tie', () => {
    const states = [state('b', 2), state('c', 2)];
    const pick = pickObjectiveForCard({ objectives: TREE, states, card: { segmentId: 'seg_3a', page: 3 } })!;
    expect(pick.objectiveId).toBe('b');
  });

  it('falls back to the nearest objective earlier in the deck', () => {
    // p. 5 teaches nothing; p. 3 is the nearest page behind it, and b and c are both on it.
    const pick = pickObjectiveForCard({ objectives: TREE, states: [state('b', 1)], card: { segmentId: 'seg_5', page: 5 } })!;
    expect(pick.objectiveId).toBe('c');
    expect(pick.reason).toBe('nearest_earlier');
  });

  it('looks forward only when there is nothing behind, so page 1 still works', () => {
    const later = [objective('x', 1, [{ page: 4 }]), objective('y', 2, [{ page: 9 }])];
    const pick = pickObjectiveForCard({ objectives: later, states: [], card: { segmentId: 'seg_1', page: 1 } })!;
    expect(pick.objectiveId).toBe('x');
    expect(pick.reason).toBe('nearest');
  });

  it('answers the deck-level line with the lowest level in the deck', () => {
    const pick = pickObjectiveForCard({ objectives: TREE, states: [state('a', 2), state('b', 1)], card: null })!;
    expect(pick.objectiveId).toBe('c');
    expect(pick.reason).toBe('lowest_in_deck');
  });

  it('treats a missing state as level 0, which is where an untouched objective belongs', () => {
    const pick = pickObjectiveForCard({ objectives: TREE, states: [state('b', 1)], card: { segmentId: 'seg_3a', page: 3 } })!;
    expect(pick.objectiveId).toBe('c');
    expect(pick.level).toBe(0);
  });

  it('is null only when the tree has nothing to ask about', () => {
    expect(pickObjectiveForCard({ objectives: [], states: [], card: { segmentId: 's', page: 1 } })).toBeNull();
    // A prerequisite the deck only assumes has no refs at all, so it can never be "taught here" —
    // but it is still askable once there is nothing nearer, which is what a fallback is for.
    const assumed = [objective('p', 1, [])];
    expect(pickObjectiveForCard({ objectives: assumed, states: [], card: { segmentId: 's', page: 1 } })!.objectiveId).toBe('p');
  });
});
