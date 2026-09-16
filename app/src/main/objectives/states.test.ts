import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import type { LearningTree } from '../../shared/objectives.js';
import type { LedgerRow } from '../../room/records.js';
import { critique1Tree } from './critique1.js';
import { packFromTree } from './pack.js';
import { mirrorLedger, taughtFromStates } from './states.js';

const FILE = 'file_1';
const NOW = '2026-09-16T12:00:00.000Z';

function tree(fileId = FILE): LearningTree {
  return {
    fileId,
    contentSha: 'sha-a',
    generatedAt: NOW,
    model: 'sonnet',
    version: 1,
    objectives: critique1Tree(fileId),
    status: 'ready',
  };
}

function row(elementId: string, level: number, over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: `led_${elementId}`,
    session_id: 'sess',
    element_id: elementId,
    level: level as LedgerRow['level'],
    level_proposed: level as LedgerRow['level_proposed'],
    confidence: 0.8,
    evidence_text: 'what the learner said',
    evidence_msg_id: 'm_7',
    evidence_seq: 7,
    defended_against: null,
    revisit: 0,
    contested: 0,
    misconceptions_open: '[]',
    misconceptions_resolved: '[]',
    updated_at: NOW,
    ...over,
  };
}

describe('mirroring the ledger onto the file', () => {
  it('writes the level and the learner’s own message id', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree({ ...tree(), promptVersion: 1, error: null }, NOW);
    const id = critique1Tree(FILE)[1]!.id;

    const moved = mirrorLedger(store, { fileId: FILE, rows: [row(id, 2)], changed: [id] });
    expect(moved).toHaveLength(1);
    expect(moved[0]!.level).toBe(2);
    expect(moved[0]!.evidenceMessageIds).toEqual(['m_7']);
    expect(store.objectives.state(FILE, id)!.level).toBe(2);
  });

  /** The ledger scores 0–4; the panel shows 0–3 and `levelToState` already calls >= 3 defended. */
  it('clamps the ledger’s level 4 to the panel’s 3', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree({ ...tree(), promptVersion: 1, error: null }, NOW);
    const id = critique1Tree(FILE)[0]!.id;
    const moved = mirrorLedger(store, { fileId: FILE, rows: [row(id, 4)], changed: [id] });
    expect(moved[0]!.level).toBe(3);
  });

  /**
   * The scripted demo deck runs on a fixture *pack* whose element ids are not objective ids. A
   * state row minted for one would be a node the panel can never draw.
   */
  it('ignores an element id that is not in the tree', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree({ ...tree(), promptVersion: 1, error: null }, NOW);
    const moved = mirrorLedger(store, { fileId: FILE, rows: [row('C1', 2)], changed: ['C1'] });
    expect(moved).toEqual([]);
    expect(store.objectives.states(FILE)).toEqual([]);
  });

  it('writes nothing for a file whose tree is not ready', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree(
      { ...tree(), promptVersion: 1, error: null, status: 'pending', objectives: [] },
      NOW,
    );
    expect(mirrorLedger(store, { fileId: FILE, rows: [row('x', 2)], changed: ['x'] })).toEqual([]);
  });

  it('only writes what the ledger said changed', () => {
    const { store } = openTestDb();
    store.objectives.upsertTree({ ...tree(), promptVersion: 1, error: null }, NOW);
    const [a, b] = critique1Tree(FILE);
    const moved = mirrorLedger(store, {
      fileId: FILE,
      rows: [row(a!.id, 1), row(b!.id, 2)],
      changed: [b!.id],
    });
    expect(moved.map((m) => m.objectiveId)).toEqual([b!.id]);
    expect(store.objectives.state(FILE, a!.id)).toBeNull();
  });
});

describe('the taught set, restored from the file', () => {
  it('turns taughtAt into a taught item the Tester can quiz', () => {
    const { store } = openTestDb();
    const t = tree();
    store.objectives.upsertTree({ ...t, promptVersion: 1, error: null }, NOW);
    const pack = packFromTree(t, 'Critique 1');
    const objective = t.objectives[1]!;
    store.objectives.markTaught({ fileId: FILE, objectiveId: objective.id, at: NOW });

    const taught = taughtFromStates(store, { fileId: FILE, pack, existing: [] });
    expect(taught).toHaveLength(1);
    expect(taught[0]!.elementId).toBe(objective.id);
    expect(taught[0]!.taughtAt).toBe(Date.parse(NOW));
    expect(taught[0]!.by).toBe('teacher');
    // No session id: it was taught in a sitting that is over, so `insideHorizon` falls back to
    // the plain six-hour age bound rather than claiming it belongs to this one.
    expect(taught[0]!.sessionId).toBeUndefined();
    expect(taught[0]!.order).toBe(objective.order);
  });

  it('does not duplicate what the sitting already remembers', () => {
    const { store } = openTestDb();
    const t = tree();
    store.objectives.upsertTree({ ...t, promptVersion: 1, error: null }, NOW);
    const objective = t.objectives[0]!;
    store.objectives.markTaught({ fileId: FILE, objectiveId: objective.id, at: NOW });
    const existing = [{ elementId: objective.id, taughtAt: 1, by: 'teacher' as const }];
    expect(taughtFromStates(store, { fileId: FILE, pack: packFromTree(t, 'x'), existing })).toEqual([]);
  });

  it('skips a state that has never been taught', () => {
    const { store } = openTestDb();
    const t = tree();
    store.objectives.upsertTree({ ...t, promptVersion: 1, error: null }, NOW);
    store.objectives.setLevel({ fileId: FILE, objectiveId: t.objectives[0]!.id, level: 2, movedAt: NOW });
    expect(taughtFromStates(store, { fileId: FILE, pack: packFromTree(t, 'x'), existing: [] })).toEqual([]);
  });

  it('is empty when the file has no ready tree', () => {
    const { store } = openTestDb();
    expect(
      taughtFromStates(store, { fileId: FILE, pack: packFromTree(tree(), 'x'), existing: [] }),
    ).toEqual([]);
  });
});
