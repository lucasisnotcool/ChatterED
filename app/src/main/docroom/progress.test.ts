import { beforeEach, describe, expect, it } from 'vitest';
import { docOf, para } from '../../shared/doc/fixture.test-support.js';
import type { QuizOutcome } from '../../shared/doc/types.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { fakeHost, handlerTable, objective, type FakeHost } from './fakehost.test-support.js';
import { resetDocCache } from './doc.js';
import { buildProgress, registerProgressIpc } from './progress.js';

const T0 = '2026-09-19T10:00:00.000Z';

function deck() {
  return docOf(
    para('b_1', 'Convexity is about the shape of the set.', 'ingest', null, [1]),
    para('b_2', 'The Hessian test decides it on the interior.', 'ingest', null, [2]),
    para('b_2b', 'And the second-order condition follows.', 'ingest', null, [2]),
  );
}

function outcome(over: Partial<QuizOutcome> = {}): QuizOutcome {
  return {
    id: 'qo_1',
    contentSha: 'sha-deck',
    roomId: 'room_test',
    objectiveId: 'o1',
    questionId: 'q_1',
    kind: 'verdict',
    verdict: 'complete',
    releasedBy: null,
    messageId: null,
    source: 'chat',
    createdAt: T0,
    ...over,
  };
}

function record(fx: FakeHost, ...outcomes: QuizOutcome[]): void {
  const repo = outcomesRepo(fx.db);
  for (const o of outcomes) repo.insert(o);
}

beforeEach(() => {
  resetDocCache();
});

describe('buildProgress', () => {
  it('reports `none` and asks for the tree when the file has no objectives yet', async () => {
    const fx = fakeHost({ doc: deck() });
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view).toMatchObject({ status: 'none', total: 0, completed: 0, fraction: 0, objectives: [] });
    expect(fx.ensureCalls).toEqual(['f_deck']);
  });

  it('fills 1 on a Well done, 0.5 on a Partly there, and nothing on Not yet', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([
      objective('o1', { refs: [{ page: 1 }], order: 1 }),
      objective('o2', { refs: [{ page: 2 }], order: 2 }),
      objective('o3', { refs: [{ page: 3 }], order: 3 }),
    ]);
    record(
      fx,
      outcome({ id: 'qo_1', objectiveId: 'o1', verdict: 'complete' }),
      outcome({ id: 'qo_2', objectiveId: 'o2', verdict: 'partial' }),
      outcome({ id: 'qo_3', objectiveId: 'o3', verdict: 'not_yet' }),
    );

    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives.map((o) => o.fill)).toEqual([1, 0.5, 0]);
    expect(view).toMatchObject({ status: 'ready', completed: 1, total: 3 });
    expect(view.fraction).toBeCloseTo(0.5);
  });

  it('fills nothing for a released answer, whichever way it was released', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    record(
      fx,
      outcome({ id: 'qo_1', kind: 'released', verdict: null, releasedBy: 'give_up' }),
      outcome({ id: 'qo_2', kind: 'released', verdict: null, releasedBy: 'pass' }),
      outcome({ id: 'qo_3', kind: 'released', verdict: null, releasedBy: 'closure' }),
    );
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.fill).toBe(0);
    expect(view).toMatchObject({ completed: 0, total: 1, fraction: 0 });
  });

  it('takes the best verdict, so an earlier Not yet does not un-learn a later Well done', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    record(
      fx,
      outcome({ id: 'qo_1', verdict: 'not_yet', createdAt: T0 }),
      outcome({ id: 'qo_2', verdict: 'partial', createdAt: '2026-09-19T10:02:00.000Z' }),
      outcome({ id: 'qo_3', verdict: 'complete', createdAt: '2026-09-19T10:05:00.000Z' }),
      outcome({ id: 'qo_4', verdict: 'not_yet', createdAt: '2026-09-19T10:09:00.000Z' }),
    );
    expect((await buildProgress(fx.host, 'f_deck')).objectives[0]!.fill).toBe(1);
  });

  it('keeps an assumedByDeck prerequisite in the list and out of the total', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([
      objective('o1', { refs: [{ page: 1 }], order: 1 }),
      objective('p1', { kind: 'prerequisite', assumedByDeck: true, refs: [], order: 0 }),
    ]);
    record(fx, outcome({ objectiveId: 'o1', verdict: 'complete' }));

    const view = await buildProgress(fx.host, 'f_deck');
    // The deck never teaches a prerequisite it assumes; counting it would make a fully
    // understood deck read as half done.
    expect(view.objectives.map((o) => o.objectiveId)).toEqual(['p1', 'o1']);
    expect(view).toMatchObject({ completed: 1, total: 1, fraction: 1 });
  });

  it('quotes the learner’s own sentence behind the fill, read back from the message', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    fx.store.messages.insert({
      id: 'm_learner',
      room_id: fx.roomId,
      participant_id: 'p_student',
      seq: 99,
      body: 'Convex means the segment between any two points stays inside the set.',
      turn_decision_id: null,
      model: null,
      backend: null,
      usage: null,
      latency_target_ms: null,
      ttft_actual_ms: null,
      released_at: null,
      promoted_from_whisper: null,
      divider_cause: null,
      disagreement: null,
      anchor_id: 'doc',
      created_at: T0,
    });
    record(fx, outcome({ messageId: 'm_learner', verdict: 'complete' }));

    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.evidence).toBe(
      'Convex means the segment between any two points stays inside the set.',
    );
    expect(view.objectives[0]!.lastMovedAt).toBe(T0);
  });

  it('carries the ledger level beside the fill without deriving one from the other', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    fx.setStates([
      { objectiveId: 'o1', fileId: 'f_deck', level: 2, evidenceMessageIds: ['m_1'], lastMovedAt: T0, taughtAt: null },
    ]);
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]).toMatchObject({ level: 2, fill: 0, lastMovedAt: T0 });
  });

  it('gives each objective the blocks that carry it, first one first for Start', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.blockIds).toEqual(['b_2', 'b_2b']);
    expect(view.docId).toBe('doc_deck');
  });

  it('still draws a bar for a file with no notes document', async () => {
    const fx = fakeHost();
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view).toMatchObject({ docId: null, total: 1, completed: 0 });
    expect(view.objectives[0]!.blockIds).toEqual([]);
  });
});

describe('progress:get / progress:start', () => {
  it('reads the bar without creating a room', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    const table = handlerTable();
    registerProgressIpc(fx.host, table.handle);

    await table.call('progress:get', { fileId: 'f_deck' });
    expect(fx.opened).toEqual([]);
  });

  it('Start opens the room, ensures the doc thread and hands back the block to scroll to', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const table = handlerTable();
    registerProgressIpc(fx.host, table.handle);

    const out = await table.call<{ roomId: string; threadId: string; blockId: string | null }>('progress:start', {
      fileId: 'f_deck',
      objectiveId: 'o2',
    });

    expect(out).toEqual({ roomId: fx.roomId, threadId: 'doc', blockId: 'b_2' });
    expect(fx.opened).toEqual(['f_deck']);
    expect(fx.actor.last('startLesson')?.args[0]).toEqual({
      objectiveId: 'o2',
      anchorId: 'doc',
      blockId: 'b_2',
    });
    const threads = fx.db
      .prepare('SELECT thread_id, kind FROM notes_threads WHERE room_id = @r')
      .all<{ thread_id: string; kind: string }>({ r: fx.roomId });
    expect([...threads]).toEqual([{ thread_id: 'doc', kind: 'doc' }]);
  });

  it('refuses a Start for an objective that is not in the tree', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1')]);
    const table = handlerTable();
    registerProgressIpc(fx.host, table.handle);
    await expect(table.call('progress:start', { fileId: 'f_deck', objectiveId: 'o9' })).rejects.toThrow(/No objective/);
  });
});
