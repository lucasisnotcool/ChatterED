/**
 * The actor's view of the document (#48, `room/docport.ts`).
 *
 * What matters here is the contract the other tracks hold: a room with no document behaves as
 * `NO_DOC` and is frozen, an edit is logged as `pending` *before* it is emitted, and an outcome
 * reaches `subscribeOutcomes` with its `roomId` after the row is written — T6 maps that room to
 * a file and pushes `progress.updated`, so the shape of that call is load-bearing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { notesRepo, newDocId } from '../db/repos/notes.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { draftsToDocJson } from '../../shared/doc/validate.js';
import type { DocBlockDraft, QuizOutcome } from '../../shared/doc/types.js';
import type { SqlDatabase } from '../db/driver.js';
import type { DocHost } from '../dochost.js';
import { createDocPort, subscribeOutcomes } from './docport.js';
import { activityRepo } from '../db/repos/activity.js';
import { card, docOf, heading, para } from '../../shared/doc/fixture.test-support.js';
import { notesSchema } from '../../shared/doc/schema.js';
import type { LearningObjective, LearningTree } from '../../shared/objectives.js';

const T0 = '2026-09-20T10:00:00.000Z';
const unsubscribes: (() => void)[] = [];

afterEach(() => {
  while (unsubscribes.length > 0) unsubscribes.pop()!();
});

const BLOCKS: DocBlockDraft[] = [
  { kind: 'heading', level: 2, text: 'Search', prov: { pages: [3], reason: null } },
  { kind: 'paragraph', text: 'A* expands the cheapest estimated path.', prov: { pages: [3], reason: null } },
  { kind: 'heading', level: 2, text: 'Heuristics', prov: { pages: [7], reason: null } },
  { kind: 'paragraph', text: 'An admissible heuristic never overestimates.', prov: { pages: [7], reason: null } },
];

function setup(opts: { withDoc?: boolean; frozen?: boolean } = {}) {
  const { db } = openTestDb();
  const repo = notesRepo(db);
  let docId: string | null = null;
  if (opts.withDoc !== false) {
    docId = newDocId();
    repo.create(
      {
        id: docId, contentSha: 'sha-deck', fileId: 'f_deck', title: 'Lecture 4', pageCount: 20,
        doc: draftsToDocJson('Lecture 4', BLOCKS), ingestStatus: 'ready', ingestVersion: 1,
        windowsTotal: 2, withImages: false, model: 'sonnet',
      },
      T0,
    );
    if (opts.frozen) repo.setFrozen(docId, true, T0);
  }
  const host = { db } as unknown as DocHost;
  const port = createDocPort(host, { fileId: 'f_deck', contentSha: 'sha-deck', roomId: 'room_1' });
  return { db: db as SqlDatabase, repo, port, docId };
}

describe('a room with no document', () => {
  it('is frozen and empty, so the agents simply never edit', () => {
    const { port } = setup({ withDoc: false });
    expect(port.docId()).toBeNull();
    expect(port.frozen()).toBe(true);
    expect(port.outlineNear({ blockId: null })).toEqual([]);
    expect(port.blocksForPages([1, 2])).toEqual([]);
    expect(port.hasQuestion('q_1')).toBe(false);
    // And the writes are dropped rather than throwing into a turn.
    expect(() => port.recordEdit({
      batch: { editId: 'e_1', author: 'ellie', cause: 'answer_missing', ops: [], focusBlockId: null, why: 'x' },
      roomId: 'room_1', turnId: null, messageId: null, objectiveId: null,
    })).not.toThrow();
  });

  it('is `NO_DOC` when the file has no content hash at all', () => {
    const { db } = openTestDb();
    const port = createDocPort({ db } as unknown as DocHost, { fileId: null, contentSha: null, roomId: 'room_1' });
    expect(port.docId()).toBeNull();
    expect(port.frozen()).toBe(true);
  });
});

describe('what the actor is shown of the document', () => {
  it('finds the document by the bytes, and reports the freeze', () => {
    const { port, docId } = setup();
    expect(port.docId()).toBe(docId);
    expect(port.frozen()).toBe(false);
    expect(setup({ frozen: true }).port.frozen()).toBe(true);
  });

  it('centres the outline on the blocks that carry a page when there is no block id', () => {
    const { port } = setup();
    const near = port.outlineNear({ blockId: null, pages: [7] });
    expect(near.length).toBeGreaterThan(0);
    expect(near.some((e) => e.text.includes('admissible'))).toBe(true);
  });

  it('answers blocksForPages in document order', () => {
    const { port } = setup();
    const onPage3 = port.blocksForPages([3]);
    expect(onPage3).toHaveLength(2);
    expect(port.blocksForPages([3, 7])).toHaveLength(4);
    expect(port.blocksForPages([99])).toEqual([]);
  });

  it('reads the last saved document, not a stale parse', () => {
    const { port, repo, docId } = setup();
    expect(port.blocksForPages([12])).toEqual([]);
    repo.save(
      { docId: docId!, baseVersion: 1, doc: draftsToDocJson('Lecture 4', [
        { kind: 'paragraph', text: 'Added later.', prov: { pages: [12], reason: null } },
      ]) },
      T0,
    );
    expect(port.blocksForPages([12])).toHaveLength(1);
  });
});

describe('recording', () => {
  it('logs an edit as pending before it is emitted, so an unreported edit is still in the log', () => {
    const { port, repo, docId } = setup();
    port.recordEdit({
      batch: {
        editId: 'e_1', author: 'max', cause: 'q_block',
        ops: [{ op: 'insert_q', anchorBlockId: 'b_1', questionId: 'q_1', objectiveId: null, text: 'Why?', prov: { pages: [3], reason: null } }],
        focusBlockId: null, why: 'the doc does not answer it',
      },
      roomId: 'room_1', turnId: 't_1', messageId: 'm_1', objectiveId: 'o_1',
    });
    const pending = repo.edits(docId!, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ editId: 'e_1', author: 'max', roomId: 'room_1', objectiveId: 'o_1' });
    // The blocks it touched are the renderer's to report: the guard runs where the editor is.
    expect(pending[0]!.blockIds).toEqual([]);
  });

  it('stores an outcome and announces it with its roomId, for T6 to push the bar from', () => {
    const { port, db } = setup();
    const seen: QuizOutcome[] = [];
    unsubscribes.push(subscribeOutcomes((o) => seen.push(o)));

    port.recordOutcome({
      roomId: 'room_1', objectiveId: 'o_1', questionId: 'q_1', kind: 'verdict',
      verdict: 'complete', releasedBy: null, messageId: 'm_9', source: 'chat',
      attemptIndex: 1, ownWords: { block: 0.2, cue: null, question: 0.1 },
    });

    const stored = outcomesRepo(db).forContent('sha-deck');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ questionId: 'q_1', verdict: 'complete', roomId: 'room_1' });
    // Announced after the write, with the row as stored — id, contentSha and createdAt included.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(stored[0]);
  });

  it('keeps announcing after a subscriber throws, because the row is already written', () => {
    const { port, db } = setup();
    const seen: QuizOutcome[] = [];
    unsubscribes.push(subscribeOutcomes(() => { throw new Error('T6 blew up'); }));
    unsubscribes.push(subscribeOutcomes((o) => seen.push(o)));
    expect(() =>
      port.recordOutcome({
        roomId: 'room_1', objectiveId: null, questionId: 'q_2', kind: 'released',
        verdict: null, releasedBy: 'give_up', messageId: null, source: 'chat',
        attemptIndex: null, ownWords: null,
      }),
    ).not.toThrow();
    expect(outcomesRepo(db).forContent('sha-deck')).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });
});

// ── 6 Oct afternoon (#67): decisions 8 and 9 ─────────────────────────────────────────────────

describe('a question to Ellie, and the card of a verdict', () => {
  const objective = (id: string, page: number): LearningObjective => ({
    id, fileId: 'f_deck', title: id, kind: 'objective', statement: '', criteria: [], quizSeeds: [],
    refs: [{ page }], parentId: null, requires: [], assumedByDeck: false, order: page,
  });
  const tree: LearningTree = {
    fileId: 'f_deck', contentSha: 'sha-deck', generatedAt: T0, model: 'sonnet', version: 1, status: 'ready',
    objectives: [objective('o_iter', 12), objective('o_rl', 18)],
  };

  function withCards() {
    const { db } = openTestDb();
    const doc = docOf(
      heading('b_h', 2, 'Value iteration', [12]),
      card('b_card', 'Value iteration', para('b_core', '**Value iteration**: repeat Bellman updates.', 'ingest', null, [12]), [], [12]),
      notesSchema.nodes.q_block!.create(
        { blockId: 'b_q', questionId: 'q_vi', status: 'open', cardId: 'b_card', pages: [12] },
        [para('b_q_p', 'What does one update compute?', 'max', null, [12])],
      ),
      para('b_rl', 'RL learns from experience.', 'ingest', null, [18]),
      para('b_both', 'Both.', 'ingest', null, [12, 18]),
    );
    notesRepo(db).create(
      {
        id: newDocId(), contentSha: 'sha-deck', fileId: 'f_deck', title: 'Lecture', pageCount: 20,
        doc: doc.toJSON() as never, ingestStatus: 'ready', ingestVersion: 1, windowsTotal: 1, withImages: false, model: 'sonnet',
      },
      T0,
    );
    const host = { db, objectivesTree: () => tree } as unknown as DocHost;
    return { db, port: createDocPort(host, { fileId: 'f_deck', contentSha: 'sha-deck', roomId: 'room_1' }) };
  }

  it('files a question under its block’s objective, and nothing when the block has none or two', () => {
    const { db, port } = withCards();
    port.recordActivity!({ roomId: 'room_1', objectiveId: null, kind: 'question', blockId: 'b_rl' });
    port.recordActivity!({ roomId: 'room_1', objectiveId: null, kind: 'question', blockId: 'b_both' });
    port.recordActivity!({ roomId: 'room_1', objectiveId: null, kind: 'question', blockId: null });
    const rows = activityRepo(db).forContent('sha-deck');
    expect(rows.map((r) => [r.objectiveId, r.kind, r.blockId])).toEqual([['o_rl', 'question', 'b_rl']]);
  });

  it('copies the question’s card onto the outcome row, so removing the chip keeps the credit', () => {
    const { db, port } = withCards();
    port.recordOutcome({
      roomId: 'room_1', objectiveId: 'o_iter', questionId: 'q_vi', kind: 'verdict', verdict: 'complete',
      releasedBy: null, messageId: 'm_1', source: 'chat', attemptIndex: 1, ownWords: null,
    });
    port.recordOutcome({
      roomId: 'room_1', objectiveId: 'o_iter', questionId: 'tut:f_deck:p1', kind: 'verdict', verdict: 'complete',
      releasedBy: null, messageId: null, source: 'chat', attemptIndex: 1, ownWords: null,
    });
    const rows = outcomesRepo(db).forContent('sha-deck').sort((x, y) => x.questionId.localeCompare(y.questionId));
    expect(rows.map((o) => [o.questionId, o.cardId])).toEqual([
      ['q_vi', 'b_card'],
      ['tut:f_deck:p1', null],
    ]);
  });
});
