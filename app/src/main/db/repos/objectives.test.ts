import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../../test-support/db.js';
import type { LearningObjective } from '../../../shared/objectives.js';
import type { LearningTreeRecord } from './objectives.js';

const T0 = '2026-09-16T10:00:00.000Z';
const T1 = '2026-09-16T10:05:00.000Z';

function objective(id: string, over: Partial<LearningObjective> = {}): LearningObjective {
  return {
    id,
    fileId: 'file_1',
    title: `Objective ${id}`,
    kind: 'objective',
    statement: 'Something the learner must be able to say.',
    criteria: ['names the mechanism', 'says why it follows'],
    quizSeeds: [`Explain ${id} in your own words.`],
    refs: [{ page: 3 }],
    parentId: null,
    requires: [],
    assumedByDeck: false,
    order: 1,
    ...over,
  };
}

function record(over: Partial<LearningTreeRecord> = {}): LearningTreeRecord {
  return {
    fileId: 'file_1',
    contentSha: 'sha-a',
    promptVersion: 1,
    model: 'sonnet',
    status: 'ready',
    generatedAt: T0,
    error: null,
    objectives: [objective('a'), objective('b')],
    ...over,
  };
}

describe('the tree', () => {
  it('is null for a file no ingest has ever been asked for', () => {
    const { store } = openTestDb();
    expect(store.objectives.tree('never-opened')).toBeNull();
  });

  it('round-trips the objectives and the cache key', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(record(), T0);
    const tree = store.objectives.tree('file_1')!;
    expect(tree.status).toBe('ready');
    expect(tree.contentSha).toBe('sha-a');
    expect(tree.version).toBe(1);
    expect(tree.objectives.map((o) => o.id)).toEqual(['a', 'b']);
    expect(tree.objectives[0]!.quizSeeds).toEqual(['Explain a in your own words.']);
    expect(tree.error).toBeUndefined();
  });

  /** §3's `pending` is visible at once, and a pending tree still has to date itself. */
  it('dates a pending tree from when the ingest started', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(
      record({ status: 'pending', generatedAt: null, objectives: [] }),
      T0,
    );
    const tree = store.objectives.tree('file_1')!;
    expect(tree.status).toBe('pending');
    expect(tree.generatedAt).toBe(T0);
    expect(tree.objectives).toEqual([]);
  });

  it('keeps a failure’s reason so the panel can offer a retry', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(
      record({ status: 'failed', generatedAt: null, error: 'the CLI exited 1', objectives: [] }),
      T0,
    );
    expect(store.objectives.tree('file_1')!.error).toBe('the CLI exited 1');
  });

  it('replaces in place, so a regenerate does not make a second row', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(record(), T0);
    store.objectives.upsertTree(record({ contentSha: 'sha-b', objectives: [objective('c')] }), T1);
    const tree = store.objectives.tree('file_1')!;
    expect(tree.contentSha).toBe('sha-b');
    expect(tree.objectives.map((o) => o.id)).toEqual(['c']);
  });
});

describe('the states', () => {
  it('start empty — a missing row is level 0 and is not invented', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(record(), T0);
    expect(store.objectives.states('file_1')).toEqual([]);
    expect(store.objectives.state('file_1', 'a')).toBeNull();
  });

  it('record a level with the learner’s own message ids', () => {
    const { store } = openTestDb();
    const state = store.objectives.setLevel({
      fileId: 'file_1',
      objectiveId: 'a',
      level: 2,
      evidenceMessageIds: ['m_4'],
      movedAt: T0,
    });
    expect(state).toEqual({
      objectiveId: 'a',
      fileId: 'file_1',
      level: 2,
      evidenceMessageIds: ['m_4'],
      lastMovedAt: T0,
      taughtAt: null,
    });
  });

  /**
   * A level 3 that threw away the sentence which earned level 2 would make the hover card lie
   * about what the learner said.
   */
  it('append evidence rather than replacing it, and de-duplicate', () => {
    const { store } = openTestDb();
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'a', level: 2, evidenceMessageIds: ['m_4'], movedAt: T0 });
    const state = store.objectives.setLevel({
      fileId: 'file_1',
      objectiveId: 'a',
      level: 3,
      evidenceMessageIds: ['m_4', 'm_9'],
      movedAt: T1,
    });
    expect(state.evidenceMessageIds).toEqual(['m_4', 'm_9']);
    expect(state.level).toBe(3);
    expect(state.lastMovedAt).toBe(T1);
  });

  it('carry taughtAt without touching the level the learner earned', () => {
    const { store } = openTestDb();
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'a', level: 2, movedAt: T0 });
    const taught = store.objectives.markTaught({ fileId: 'file_1', objectiveId: 'a', at: T1 });
    expect(taught.taughtAt).toBe(T1);
    expect(taught.level).toBe(2);
  });

  it('can be taught before they are ever demonstrated', () => {
    const { store } = openTestDb();
    const taught = store.objectives.markTaught({ fileId: 'file_1', objectiveId: 'b', at: T0 });
    expect(taught).toEqual({
      objectiveId: 'b',
      fileId: 'file_1',
      level: 0,
      evidenceMessageIds: [],
      lastMovedAt: null,
      taughtAt: T0,
    });
  });

  it('are per file — two decks do not share a node id’s progress', () => {
    const { store } = openTestDb();
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'a', level: 2, movedAt: T0 });
    store.objectives.setLevel({ fileId: 'file_2', objectiveId: 'a', level: 0, movedAt: T0 });
    expect(store.objectives.state('file_1', 'a')!.level).toBe(2);
    expect(store.objectives.state('file_2', 'a')!.level).toBe(0);
  });
});

describe('reset and prune', () => {
  it('reset clears every state for the file and leaves the tree', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(record(), T0);
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'a', level: 3, evidenceMessageIds: ['m_1'], movedAt: T0 });
    store.objectives.markTaught({ fileId: 'file_1', objectiveId: 'b', at: T0 });
    store.objectives.setLevel({ fileId: 'file_2', objectiveId: 'a', level: 2, movedAt: T0 });

    expect(store.objectives.reset('file_1')).toBe(2);
    expect(store.objectives.states('file_1')).toEqual([]);
    expect(store.objectives.tree('file_1')!.objectives).toHaveLength(2);
    // Another deck's progress is not collateral.
    expect(store.objectives.state('file_2', 'a')!.level).toBe(2);
  });

  /** §3: Regenerate "keeps the old states where ids still match". */
  it('prune keeps the states whose ids survived the regenerate', () => {
    const { store } = openTestDb();
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'a', level: 2, movedAt: T0 });
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'gone', level: 3, movedAt: T0 });
    expect(store.objectives.pruneStates('file_1', ['a', 'b'])).toBe(1);
    expect(store.objectives.states('file_1').map((s) => s.objectiveId)).toEqual(['a']);
    expect(store.objectives.state('file_1', 'a')!.level).toBe(2);
  });
});

describe('migration 016', () => {
  it('gives messages an objective_id that is null by default', () => {
    const { db, store } = openTestDb();
    void store;
    const cols = db.prepare('PRAGMA table_info(messages)').all<{ name: string; notnull: number }>();
    const col = cols.find((c) => c.name === 'objective_id');
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
  });
});
