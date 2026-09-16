import { describe, expect, it } from 'vitest';
import { MAX_OBJECTIVES } from '../../shared/objectives.js';
import { normaliseTitle, objectiveIdFor, repairTree, type RawObjective } from './repair.js';

const SHA = 'sha-of-the-deck';

function node(over: Partial<RawObjective> & { key: string; title: string }): RawObjective {
  return {
    kind: 'objective',
    statement: 'A statement.',
    criteria: ['one', 'two'],
    quiz_seeds: ['Say it.'],
    refs: [{ page: 1 }],
    ...over,
  };
}

const repair = (raw: RawObjective[]) => repairTree({ fileId: 'f1', contentSha: SHA, raw });

describe('the id', () => {
  it('is stable across a re-read of the same deck', () => {
    expect(objectiveIdFor(SHA, 'State the Bellman optimality equation')).toBe(
      objectiveIdFor(SHA, '  state the   Bellman Optimality Equation.  '),
    );
  });

  it('differs per deck, so two decks never share a node’s progress', () => {
    expect(objectiveIdFor(SHA, 'A title')).not.toBe(objectiveIdFor('another-sha', 'A title'));
  });

  it('normalises whitespace, case and trailing punctuation and nothing else', () => {
    expect(normaliseTitle('  What   an MDP IS?  ')).toBe('what an mdp is');
  });
});

describe('repairing what the model returned', () => {
  it('keeps a clean tree as it is, and numbers it in deck order', () => {
    const { objectives, notes } = repair([
      node({ key: 'b', title: 'Second thing', refs: [{ page: 7 }] }),
      node({ key: 'a', title: 'First thing', refs: [{ page: 2 }] }),
    ]);
    expect(objectives.map((o) => o.title)).toEqual(['First thing', 'Second thing']);
    expect(objectives.map((o) => o.order)).toEqual([1, 2]);
    expect(notes.kept).toBe(2);
  });

  it('drops an untitled node rather than minting an id for the empty string', () => {
    const { objectives, notes } = repair([node({ key: 'a', title: '' }), node({ key: 'b', title: 'Real' })]);
    expect(objectives).toHaveLength(1);
    expect(notes.droppedUntitled).toBe(1);
  });

  it('drops a duplicate title, which would otherwise collide on the id', () => {
    const { objectives, notes } = repair([
      node({ key: 'a', title: 'The same thing' }),
      node({ key: 'b', title: 'the same thing.' }),
    ]);
    expect(objectives).toHaveLength(1);
    expect(notes.droppedDuplicate).toBe(1);
  });

  it('caps at twenty and keeps the earliest pages', () => {
    const raw = Array.from({ length: 25 }, (_, i) => node({ key: `k${i}`, title: `Thing ${i}`, refs: [{ page: i + 1 }] }));
    const { objectives, notes } = repair(raw);
    expect(objectives).toHaveLength(MAX_OBJECTIVES);
    expect(notes.droppedOverCap).toBe(5);
    expect(objectives.at(-1)!.refs[0]!.page).toBe(20);
  });

  it('caps a title at twelve words and criteria at four', () => {
    const { objectives } = repair([
      node({
        key: 'a',
        title: 'one two three four five six seven eight nine ten eleven twelve thirteen',
        criteria: ['a', 'b', 'c', 'd', 'e'],
      }),
    ]);
    expect(objectives[0]!.title.split(' ')).toHaveLength(12);
    expect(objectives[0]!.criteria).toHaveLength(4);
  });
});

describe('prerequisites', () => {
  it('are assumed by the deck exactly when they have no ref', () => {
    const { objectives, notes } = repair([
      node({ key: 'p', title: 'What an MDP is', kind: 'prerequisite', refs: [] }),
      node({ key: 'q', title: 'A taught prerequisite', kind: 'prerequisite', refs: [{ page: 3 }] }),
    ]);
    const assumed = objectives.find((o) => o.title === 'What an MDP is')!;
    const taught = objectives.find((o) => o.title === 'A taught prerequisite')!;
    expect(assumed.assumedByDeck).toBe(true);
    expect(taught.assumedByDeck).toBe(false);
    expect(notes.prerequisites).toBe(2);
    expect(notes.assumed).toBe(1);
  });

  /** §2: "prerequisites before their dependants" — you meet the assumption where it first bites. */
  it('sort in front of the objective that requires them, not at the end of the deck', () => {
    const { objectives } = repair([
      node({ key: 'early', title: 'Early objective', refs: [{ page: 1 }] }),
      node({ key: 'late', title: 'Late objective', refs: [{ page: 9 }], requires_keys: ['p'] }),
      node({ key: 'p', title: 'The assumption', kind: 'prerequisite', refs: [] }),
    ]);
    expect(objectives.map((o) => o.title)).toEqual(['Early objective', 'The assumption', 'Late objective']);
  });

  it('resolve `requires` keys into ids and drop the ones that name nothing', () => {
    const { objectives, notes } = repair([
      node({ key: 'a', title: 'Needs one', requires_keys: ['p', 'ghost'] }),
      node({ key: 'p', title: 'The assumption', kind: 'prerequisite', refs: [] }),
    ]);
    const needs = objectives.find((o) => o.title === 'Needs one')!;
    expect(needs.requires).toEqual([objectiveIdFor(SHA, 'The assumption')]);
    expect(notes.danglingRequires).toBe(1);
  });
});

describe('the graphs', () => {
  it('cut a `requires` cycle rather than rejecting the tree', () => {
    const { objectives, notes } = repair([
      node({ key: 'a', title: 'A', requires_keys: ['b'] }),
      node({ key: 'b', title: 'B', requires_keys: ['a'] }),
    ]);
    expect(notes.cyclesCut).toBe(1);
    expect(objectives).toHaveLength(2);
    const edges = objectives.flatMap((o) => o.requires.map((r) => [o.id, r]));
    expect(edges).toHaveLength(1);
  });

  it('cut a longer `requires` cycle too', () => {
    const { notes } = repair([
      node({ key: 'a', title: 'A', requires_keys: ['b'] }),
      node({ key: 'b', title: 'B', requires_keys: ['c'] }),
      node({ key: 'c', title: 'C', requires_keys: ['a'] }),
    ]);
    expect(notes.cyclesCut).toBeGreaterThanOrEqual(1);
  });

  it('cut a parent cycle, so every node stays reachable from a root', () => {
    const { objectives, notes } = repair([
      node({ key: 'a', title: 'A', parent_key: 'b' }),
      node({ key: 'b', title: 'B', parent_key: 'a' }),
    ]);
    expect(notes.cyclesCut).toBeGreaterThanOrEqual(1);
    expect(objectives.filter((o) => o.parentId === null).length).toBeGreaterThanOrEqual(1);
  });

  it('drop a parent that names nothing rather than leaving it dangling', () => {
    const { objectives, notes } = repair([node({ key: 'a', title: 'A', parent_key: 'ghost' })]);
    expect(objectives[0]!.parentId).toBeNull();
    expect(notes.danglingParents).toBe(1);
  });

  /** §3: "≤ 3 levels deep", re-attached at the deepest allowed ancestor rather than dropped. */
  it('clamp a four-deep chain to three levels', () => {
    const { objectives, notes } = repair([
      node({ key: 'a', title: 'A' }),
      node({ key: 'b', title: 'B', parent_key: 'a' }),
      node({ key: 'c', title: 'C', parent_key: 'b' }),
      node({ key: 'd', title: 'D', parent_key: 'c' }),
    ]);
    expect(notes.depthClamped).toBe(1);
    const byTitle = new Map(objectives.map((o) => [o.title, o]));
    // D now hangs off B, which leaves it at depth 3 and keeps what it was a part of.
    expect(byTitle.get('D')!.parentId).toBe(byTitle.get('B')!.id);
  });
});

describe('the quiz seeds', () => {
  it('are seeded from the title when the model returned none, so the Tester always has a stem', () => {
    const { objectives, notes } = repair([node({ key: 'a', title: 'State the Bellman equation', quiz_seeds: [] })]);
    expect(objectives[0]!.quizSeeds).toEqual(['In your own words: the Bellman equation.']);
    expect(notes.seededQuiz).toBe(1);
  });

  it('are capped at three', () => {
    const { objectives } = repair([node({ key: 'a', title: 'A', quiz_seeds: ['1', '2', '3', '4'] })]);
    expect(objectives[0]!.quizSeeds).toEqual(['1', '2', '3']);
  });
});
