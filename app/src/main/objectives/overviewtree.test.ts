/**
 * `carryStates`: the learner's progress survives an Update overview that rewords an objective
 * (`notebooks.md` §2, §7; #58).
 */
import { describe, expect, it } from 'vitest';
import type { LearningObjective, LearningObjectiveState } from '../../shared/objectives.js';
import { carryStates } from './overviewtree.js';

const objective = (id: string, pages: number[]): LearningObjective => ({
  id,
  fileId: 'nb_1',
  title: id,
  kind: 'objective',
  statement: '',
  criteria: [],
  quizSeeds: [],
  refs: pages.map((page) => ({ page })),
  parentId: null,
  requires: [],
  assumedByDeck: false,
  order: 0,
});

const state = (objectiveId: string, level: 0 | 1 | 2 | 3, taughtAt: string | null = null): LearningObjectiveState => ({
  objectiveId,
  fileId: 'nb_1',
  level,
  evidenceMessageIds: [],
  lastMovedAt: null,
  taughtAt,
});

describe('carryStates', () => {
  const before = [objective('old_a', [3, 4]), objective('old_b', [20]), objective('kept', [9])];

  it('carries a gone objective to the one with the most page overlap', () => {
    const after = [objective('new_x', [4, 5, 6, 7]), objective('new_y', [3, 4]), objective('kept', [9])];
    expect(carryStates(before, after, [state('old_a', 2)])).toEqual([{ from: state('old_a', 2), toId: 'new_y' }]);
  });

  it('carries nothing for a state that never moved, an id that survives, or no shared page', () => {
    const after = [objective('new_x', [30]), objective('kept', [9])];
    expect(carryStates(before, after, [state('old_a', 0), state('kept', 2), state('old_b', 1)])).toEqual([]);
  });

  it('carries a taught-only state, and takes the earlier objective on a tie', () => {
    const after = [objective('first', [3]), objective('second', [4])];
    expect(carryStates(before, after, [state('old_a', 0, 't')])).toEqual([{ from: state('old_a', 0, 't'), toId: 'first' }]);
  });
});
