/**
 * The notes repository against the real migrations (#48, migration 020).
 *
 * What is worth testing here is not "does an INSERT insert" but the three rules the rest of the
 * build leans on: a save is optimistic and a stale one is refused rather than applied, an ingest
 * window appends regardless of version because it cannot collide, and `learner_touched` is a
 * one-way latch that only `resetForIngest` clears.
 */
import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../../test-support/db.js';
import { newDocId, notesRepo, type NotesRepo } from './notes.js';

const T0 = '2026-09-20T10:00:00.000Z';
const T1 = '2026-09-20T10:05:00.000Z';

function repoWithDoc(): { repo: NotesRepo; docId: string } {
  const { db } = openTestDb();
  const repo = notesRepo(db);
  const docId = newDocId();
  repo.create(
    {
      id: docId,
      contentSha: 'sha-abc',
      fileId: 'f_one',
      title: 'Lecture 4',
      pageCount: 66,
      doc: { type: 'doc', content: [] },
      ingestStatus: 'pending',
      ingestVersion: 1,
      windowsTotal: 7,
      withImages: false,
      model: 'sonnet',
    },
    T0,
  );
  return { repo, docId };
}

describe('the notes document row', () => {
  it('is keyed on the bytes, so a rescan that re-mints the file id still finds it (#39)', () => {
    const { repo, docId } = repoWithDoc();
    const found = repo.byContentSha('sha-abc');
    expect(found?.id).toBe(docId);
    expect(found?.fileId).toBe('f_one');
    expect(repo.byContentSha('sha-other')).toBeNull();
  });

  it('starts at version 1 with an empty ingest state and no error', () => {
    const { repo, docId } = repoWithDoc();
    const doc = repo.byId(docId)!;
    expect(doc.version).toBe(1);
    expect(doc.ingestStatus).toBe('pending');
    expect(doc.ingestState).toBeNull();
    expect(doc.windowsDone).toBe(0);
    expect(doc.windowsTotal).toBe(7);
    expect(doc.frozen).toBe(false);
    expect(doc.learnerTouched).toBe(false);
  });

  it('parses a doc whose JSON is corrupt as null rather than throwing on the way to the editor', () => {
    const { db } = openTestDb();
    const repo = notesRepo(db);
    const docId = newDocId();
    repo.create(
      {
        id: docId, contentSha: 's', fileId: null, title: 't', pageCount: 1,
        doc: { type: 'doc' }, ingestStatus: 'ready', ingestVersion: 1, windowsTotal: 1,
        withImages: false, model: 'm',
      },
      T0,
    );
    db.prepare('UPDATE notes_docs SET doc_json = @j WHERE id = @id').run({ j: '{not json', id: docId });
    expect(repo.byId(docId)!.doc).toBeNull();
  });
});

describe('saving is optimistic', () => {
  it('accepts a save on the stored version and bumps it', () => {
    const { repo, docId } = repoWithDoc();
    const result = repo.save({ docId, baseVersion: 1, doc: { type: 'doc', content: ['a'] } }, T1);
    expect(result).toEqual({ ok: true, version: 2 });
    expect(repo.byId(docId)!.doc).toEqual({ type: 'doc', content: ['a'] });
  });

  it('refuses a stale save and hands back the stored doc, so the renderer rebases', () => {
    const { repo, docId } = repoWithDoc();
    repo.save({ docId, baseVersion: 1, doc: { type: 'doc', content: ['first'] } }, T1);
    const result = repo.save({ docId, baseVersion: 1, doc: { type: 'doc', content: ['stale'] } }, T1);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ conflict: true, version: 2, doc: { type: 'doc', content: ['first'] } });
    // Nothing was written: the loser of the race does not clobber the winner.
    expect(repo.byId(docId)!.doc).toEqual({ type: 'doc', content: ['first'] });
  });

  it('latches learner_touched on and never off', () => {
    const { repo, docId } = repoWithDoc();
    repo.save({ docId, baseVersion: 1, doc: {}, learnerTouched: true }, T1);
    expect(repo.byId(docId)!.learnerTouched).toBe(true);
    repo.save({ docId, baseVersion: 2, doc: {}, learnerTouched: false }, T1);
    expect(repo.byId(docId)!.learnerTouched).toBe(true);
  });
});

describe('an ingest window', () => {
  it('appends without a version check, because it only ever adds after the last block', () => {
    const { repo, docId } = repoWithDoc();
    repo.save({ docId, baseVersion: 1, doc: { type: 'doc', content: ['learner typing'] } }, T1);
    const after = repo.appendWindow(
      { docId, doc: { type: 'doc', content: ['learner typing', 'window 1'] },
        ingest: { status: 'streaming', windowsDone: 1, ingestState: { windows: [{ from: 1, to: 8 }], done: 1, lastBlockId: 'b_1', outlineSoFar: '# One' } } },
      T1,
    );
    expect(after.version).toBe(3);
    expect(after.windowsDone).toBe(1);
    expect(after.ingestStatus).toBe('streaming');
    expect(after.ingestState).toEqual({ windows: [{ from: 1, to: 8 }], done: 1, lastBlockId: 'b_1', outlineSoFar: '# One' });
  });

  it('records a failure as a reason on the row, never as a thrown error', () => {
    const { repo, docId } = repoWithDoc();
    repo.setIngest(docId, { status: 'failed', error: 'the model returned no usable blocks' }, T1);
    const doc = repo.byId(docId)!;
    expect(doc.ingestStatus).toBe('failed');
    expect(doc.error).toBe('the model returned no usable blocks');
  });

  it('clears the learner latch and the state only on an explicit reset', () => {
    const { repo, docId } = repoWithDoc();
    repo.markLearnerTouched(docId, T1);
    repo.setIngest(docId, { ingestState: { windows: [], done: 3, lastBlockId: 'b_9', outlineSoFar: 'x' } }, T1);
    const reset = repo.resetForIngest(
      { docId, doc: { type: 'doc' }, title: 'Lecture 4', pageCount: 66, fileId: 'f_two',
        ingestVersion: 2, windowsTotal: 7, withImages: true, model: 'sonnet' },
      T1,
    );
    expect(reset.learnerTouched).toBe(false);
    expect(reset.ingestState).toBeNull();
    expect(reset.windowsDone).toBe(0);
    expect(reset.withImages).toBe(true);
    expect(reset.fileId).toBe('f_two');
  });
});

describe('edits and suggestions', () => {
  it('records an edit as pending before it is emitted, and the renderer moves it on', () => {
    const { repo, docId } = repoWithDoc();
    repo.insertEdit({
      editId: 'e_1', docId, roomId: 'room_1', author: 'ellie', cause: 'answer_missing',
      ops: [{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [] }], why: 'the doc did not say it',
      blockIds: [], turnId: 't_1', messageId: 'm_1', objectiveId: null, docVersion: 1, createdAt: T0,
    });
    expect(repo.edits(docId, 'pending')).toHaveLength(1);
    repo.resolveEdit({ docId, editId: 'e_1', status: 'applied', blockIds: ['b_9'], docVersion: 2 }, T1);
    const applied = repo.edits(docId, 'applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.blockIds).toEqual(['b_9']);
    expect(applied[0]!.resolvedAt).toBe(T1);
    expect(repo.edits(docId, 'pending')).toHaveLength(0);
  });

  it('keeps only open suggestions in the open list', () => {
    const { repo, docId } = repoWithDoc();
    repo.upsertSuggestion({
      suggestionId: 's_1', docId, editId: 'e_1', author: 'max', blockId: 'b_3', status: 'open',
      note: 'the definition is the other way round', threadId: 'span_abc', createdAt: T0, resolvedAt: null,
    });
    expect(repo.suggestions(docId, 'open')).toHaveLength(1);
    repo.resolveSuggestion({ docId, suggestionId: 's_1', status: 'rejected' }, T1);
    expect(repo.suggestions(docId, 'open')).toHaveLength(0);
    expect(repo.suggestions(docId)[0]!.status).toBe('rejected');
  });
});

describe('the objective→block cache', () => {
  it('is replaced whole, because it is a cache of a pure function and a diff would lie', () => {
    const { repo, docId } = repoWithDoc();
    repo.replaceObjectiveBlocks(docId, [
      { objectiveId: 'o_1', blockId: 'b_1', ord: 0 },
      { objectiveId: 'o_1', blockId: 'b_2', ord: 1 },
      { objectiveId: 'o_2', blockId: 'b_7', ord: 0 },
    ]);
    expect(repo.objectiveBlocks(docId)).toHaveLength(3);
    repo.replaceObjectiveBlocks(docId, [{ objectiveId: 'o_1', blockId: 'b_5', ord: 0 }]);
    expect(repo.objectiveBlocks(docId)).toEqual([{ objectiveId: 'o_1', blockId: 'b_5', ord: 0 }]);
  });
});

describe("the learner's slide moves (migration 025)", () => {
  it('upserts one move per page, lists them in page order, and deletes on a null key', () => {
    const { repo, docId } = repoWithDoc();
    repo.setSlideOverride({ docId, page: 19, key: 'b_heur', title: 'Heuristics' }, T0);
    repo.setSlideOverride({ docId, page: 4, key: 'opening', title: '' }, T0);
    repo.setSlideOverride({ docId, page: 19, key: 'b_abs', title: 'State abstraction' }, T1);
    expect(repo.slideOverrides(docId)).toEqual([
      { page: 4, key: 'opening', title: '' },
      { page: 19, key: 'b_abs', title: 'State abstraction' },
    ]);
    repo.setSlideOverride({ docId, page: 4, key: null, title: '' }, T1);
    expect(repo.slideOverrides(docId)).toEqual([{ page: 19, key: 'b_abs', title: 'State abstraction' }]);
    expect(repo.slideOverrides('doc_other')).toEqual([]);
  });

  it('refuses a page that is not one', () => {
    const { repo, docId } = repoWithDoc();
    expect(() => repo.setSlideOverride({ docId, page: 0, key: 'other', title: '' }, T0)).toThrow(/Not a page/);
  });

  it('survives a Regenerate, because a move is remapped by the heading text', () => {
    const { repo, docId } = repoWithDoc();
    repo.setSlideOverride({ docId, page: 7, key: 'b_x', title: 'Heuristics' }, T0);
    repo.clearForRegenerate(docId);
    expect(repo.slideOverrides(docId)).toEqual([{ page: 7, key: 'b_x', title: 'Heuristics' }]);
  });
});
