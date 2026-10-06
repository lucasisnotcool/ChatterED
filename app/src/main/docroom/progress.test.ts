import { beforeEach, describe, expect, it } from 'vitest';
import { card, docOf, heading, para } from '../../shared/doc/fixture.test-support.js';
import { notesSchema } from '../../shared/doc/schema.js';
import type { QuizOutcome } from '../../shared/doc/types.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { activityRepo } from '../db/repos/activity.js';
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
    attemptIndex: 1,
    ownWords: null,
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

  /**
   * The bar and the notes ingest share one CLI lane at the same background priority, and the
   * shell reads the bar the instant a file opens. Asking for the tree here put a whole
   * objectives pass in front of the first notes window — `llm.queued_ms: 48837` on a seven-page
   * deck, live, 20 Sep. `notes/ingest.ts` asks for the tree itself once window 1 has landed.
   */
  it('does not ask for the tree while the notes ingest is still running', async () => {
    for (const status of ['pending', 'streaming'] as const) {
      const fx = fakeHost({ doc: deck() });
      fx.db.prepare('UPDATE notes_docs SET ingest_status = @s').run({ s: status });
      await buildProgress(fx.host, 'f_deck');
      expect(fx.ensureCalls).toEqual([]);
    }
  });

  it('asks for it again as soon as the ingest is no longer in flight', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.db.prepare("UPDATE notes_docs SET ingest_status = 'ready'").run();
    await buildProgress(fx.host, 'f_deck');
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

  /** 2026-10-06 (D2): Explain/Example since the objective's last question closed, for readiness. */
  it('carries each objective’s Explain and Example presses since its last question closed', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }], order: 1 }), objective('o2', { refs: [{ page: 2 }], order: 2 })]);
    const presses = activityRepo(fx.db);
    const press = (id: string, objectiveId: string, kind: 'explain' | 'example', createdAt: string) =>
      presses.insert({ id, contentSha: 'sha-deck', roomId: 'room_test', objectiveId, kind, blockId: null, createdAt });
    press('a1', 'o1', 'explain', '2026-09-19T09:00:00.000Z');
    press('a2', 'o1', 'example', '2026-09-19T11:00:00.000Z');
    press('a3', 'o2', 'explain', '2026-09-19T11:00:00.000Z');
    // o1's question closed at T0 (10:00): only the press after it counts.
    record(fx, outcome({ id: 'qo_1', objectiveId: 'o1', kind: 'released', verdict: null, releasedBy: 'give_up' }));

    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives.map((o) => o.activity)).toEqual([
      { explains: 0, examples: 1, questions: 0, since: T0 },
      { explains: 1, examples: 0, questions: 0, since: null },
    ]);
  });

  // Decision 8 (6 Oct afternoon, #67).
  it('carries the questions to Ellie on an objective since its last question closed', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }], order: 1 })]);
    const presses = activityRepo(fx.db);
    for (const id of ['q1', 'q2', 'q3'])
      presses.insert({ id, contentSha: 'sha-deck', roomId: 'room_test', objectiveId: 'o1', kind: 'question', blockId: 'b_1', createdAt: `2026-09-19T11:0${id.slice(1)}:00.000Z` });
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.activity).toEqual({ explains: 0, examples: 0, questions: 3, since: null });
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
    // 2026-10-06 (D2): Ellie walks the learner through the section, so she is given it and its pages.
    expect(fx.actor.last('startLesson')?.args[0]).toEqual({
      objectiveId: 'o2',
      anchorId: 'doc',
      blockId: 'b_2',
      section: 'The Hessian test decides it on the interior.\nAnd the second-order condition follows.',
      pages: [2],
    });
    const threads = fx.db
      .prepare('SELECT thread_id, kind FROM notes_threads WHERE room_id = @r')
      .all<{ thread_id: string; kind: string }>({ r: fx.roomId });
    expect([...threads]).toEqual([{ thread_id: 'doc', kind: 'doc' }]);
  });

  it('Start scrolls to the section heading and files the lesson under the block below it (3 Oct 2026)', async () => {
    const fx = fakeHost({
      doc: docOf(
        para('b_obj', 'Describe a planning problem in PDDL.', 'ingest', null, [1, 2, 3]),
        heading('h_pddl', 2, 'Classical planning in PDDL', [2]),
        para('b_take', 'A domain plus a problem is searched for a plan.', 'ingest', null, [2]),
      ),
    });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const table = handlerTable();
    registerProgressIpc(fx.host, table.handle);

    const out = await table.call<{ blockId: string | null }>('progress:start', { fileId: 'f_deck', objectiveId: 'o2' });

    expect(out.blockId).toBe('h_pddl');
    expect(fx.actor.last('startLesson')?.args[0]).toMatchObject({ blockId: 'b_take' });
  });

  it('refuses a Start for an objective that is not in the tree', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1')]);
    const table = handlerTable();
    registerProgressIpc(fx.host, table.handle);
    await expect(table.call('progress:start', { fileId: 'f_deck', objectiveId: 'o9' })).rejects.toThrow(/No objective/);
  });
});

// ── decision 9 (6 Oct afternoon, #67): a topic is done only when every card it covers is ───────

describe('buildProgress: concept cards', () => {
  /**
   * The Lecture-sdm shape: one topic (pp. 10–15) covers value iteration and policy iteration.
   * Value iteration got a *Well done*; policy iteration's question ended in a give-up.
   */
  function iteration(opts: { qAttrs?: boolean } = {}) {
    const q = (questionId: string, cardId: string) =>
      notesSchema.nodes.q_block!.create(
        { blockId: `b_${questionId}`, questionId, status: 'resolved', cardId: opts.qAttrs === false ? null : cardId, pages: [12] },
        [para(`b_${questionId}_p`, 'Why?', 'max', null, [12])],
      );
    return docOf(
      heading('b_h', 2, 'Value and policy iteration', [10]),
      card('c_value', 'Value iteration', para('c_value_core', '**Value iteration**: repeat updates.', 'ingest', null, [12]), [], [12]),
      q('q_value', 'c_value'),
      card('c_policy', 'Policy iteration', para('c_policy_core', '**Policy iteration**: evaluate, improve.', 'ingest', null, [15]), [], [15]),
      q('q_policy', 'c_policy'),
      card('c_rl', 'RL set-up', para('c_rl_core', '**RL**: learn from experience.', 'ingest', null, [18]), [], [18]),
    );
  }

  const tree = () => [
    objective('o_iter', { refs: [{ page: 12 }, { page: 15 }], order: 1 }),
    objective('o_rl', { refs: [{ page: 18 }], order: 2 }),
  ];

  it('leaves the topic partly done after a Well done on one of its two cards', async () => {
    const fx = fakeHost({ doc: iteration() });
    fx.setTree(tree());
    record(
      fx,
      outcome({ id: 'qo_1', objectiveId: 'o_iter', questionId: 'q_value', cardId: 'c_value' }),
      outcome({ id: 'qo_2', objectiveId: 'o_iter', questionId: 'q_policy', cardId: 'c_policy', verdict: 'not_yet', createdAt: '2026-09-19T10:05:00.000Z' }),
      outcome({ id: 'qo_3', objectiveId: 'o_iter', questionId: 'q_policy', cardId: 'c_policy', kind: 'released', verdict: null, releasedBy: 'give_up', createdAt: '2026-09-19T10:06:00.000Z' }),
    );
    const view = await buildProgress(fx.host, 'f_deck');
    const iter = view.objectives[0]!;
    expect(iter.fill).toBe(0.5);
    expect(iter.cards).toEqual([
      { cardId: 'c_value', term: 'Value iteration', done: true },
      { cardId: 'c_policy', term: 'Policy iteration', done: false },
    ]);
    expect(view.objectives[1]!.cards).toEqual([{ cardId: 'c_rl', term: 'RL set-up', done: false }]);
    expect(view).toMatchObject({ completed: 0, total: 2 });
  });

  it('completes the topic once the other card has its Well done too', async () => {
    const fx = fakeHost({ doc: iteration() });
    fx.setTree(tree());
    record(
      fx,
      outcome({ id: 'qo_1', objectiveId: 'o_iter', questionId: 'q_value', cardId: 'c_value' }),
      outcome({ id: 'qo_2', objectiveId: 'o_iter', questionId: 'q_policy', cardId: 'c_policy', createdAt: '2026-09-19T10:05:00.000Z' }),
    );
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.fill).toBe(1);
    expect(view).toMatchObject({ completed: 1, total: 2 });
  });

  it('reads the card of a row written before migration 031 from its Q block', async () => {
    const fx = fakeHost({ doc: iteration({ qAttrs: false }) });
    fx.setTree(tree());
    record(
      fx,
      outcome({ id: 'qo_1', objectiveId: 'o_iter', questionId: 'q_value' }),
      outcome({ id: 'qo_2', objectiveId: 'o_iter', questionId: 'q_policy', createdAt: '2026-09-19T10:05:00.000Z' }),
    );
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.fill).toBe(1);
  });

  it('keeps a tutorial part’s Well done filling the topic as before', async () => {
    const fx = fakeHost({ doc: iteration() });
    fx.setTree(tree());
    record(fx, outcome({ id: 'qo_t', objectiveId: 'o_iter', questionId: 'tut:f_deck:p_1' }));
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]!.fill).toBe(1);
  });

  it('fills an objective with no cards exactly as before', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    record(fx, outcome());
    const view = await buildProgress(fx.host, 'f_deck');
    expect(view.objectives[0]).toMatchObject({ fill: 1, cards: [] });
  });
});
