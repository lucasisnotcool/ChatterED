/**
 * **Regenerate Notes** (2026-09-23): the confirm is main's, and a yes clears what points into the
 * old document — nothing is touched on a Cancel. And the notes channels on a notebook id
 * (`notebooks.md`, #58): the overview, `status: none`, recommendations and Update overview.
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { docOf, para } from '../../shared/doc/fixture.test-support.js';
import { IPC } from '../../shared/ipc.js';
import { DOC_ID, SHA, fakeHost, handlerTable, type FakeHost } from '../docroom/fakehost.test-support.js';
import { registerNotesIpc, learnerWordsIn } from './ipc.js';
import { pageImageDir } from './pageimages.js';
import { openTestDb } from '../../test-support/db.js';
import type { DocHost } from '../dochost.js';
import type { RoomEvent } from '../../shared/types.js';
import type { NotesDocView, NotesRegenerateResult, OverviewMeta } from '../../shared/doc/types.js';
import type { NotesUpdateOverviewResult } from '../../shared/ipc.js';
import { API_PLAN } from '../../room/llm/models.js';
import { fakeNotebook, slides } from './fakenotebook.test-support.js';
import { overviewInFlight } from './overviewingest.js';
import { notebookContentKey } from '../../shared/notebook.js';

function deck() {
  return docOf(
    para('b_1', 'Convexity is about the shape of the set.', 'ingest', null, [1]),
    para('b_2', 'my own five words here', 'user', null, [2]),
  );
}

function wire(fx: FakeHost) {
  const table = handlerTable();
  registerNotesIpc(fx.host, table.handle);
  return table;
}

let userData: string;

function withDoc(): FakeHost {
  const fx = fakeHost({ doc: deck() });
  (fx.host as unknown as { userDataDir: string }).userDataDir = userData;
  fx.db
    .prepare(
      `INSERT INTO notes_doc_edits (edit_id, doc_id, room_id, author, cause, ops_json, why, status, block_ids, doc_version, created_at)
       VALUES ('e_applied', @doc, NULL, 'ellie', 'answer_missing', '[]', '', 'applied', '[]', 1, 'now'),
              ('e_kept', @doc, NULL, 'max', 'q_block', '[]', '', 'kept', '[]', 1, 'now')`,
    )
    .run({ doc: DOC_ID });
  fx.db
    .prepare(
      `INSERT INTO notes_suggestions (suggestion_id, doc_id, edit_id, author, block_id, status, created_at)
       VALUES ('s_open', @doc, 'e_applied', 'max', 'b_2', 'open', 'now')`,
    )
    .run({ doc: DOC_ID });
  const dir = pageImageDir(userData, SHA);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'p-1.png'), 'x');
  return fx;
}

const count = (fx: FakeHost, sql: string) => fx.db.prepare(sql).get<{ n: number }>({})!.n;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'chattered-notes-ipc-'));
});

describe('notes:get', () => {
  it('returns kept edit links alongside pending edit controls', async () => {
    const fx = withDoc();
    (fx.host.vault as unknown as { fileRow: (fileId: string) => { name: string } }).fileRow = () => ({ name: 'Lecture.pdf' });
    const view = await wire(fx).call<NotesDocView>(IPC.notesGet, { fileId: 'f_deck' });
    expect(view.edits.map((edit) => edit.editId)).toEqual(['e_applied']);
    expect(view.keptEdits?.map((edit) => edit.editId)).toEqual(['e_kept']);
  });
});

describe('notes:regenerate', () => {
  it('asks first, naming the learner’s own words and the agents’ additions', async () => {
    const fx = withDoc();
    fx.confirmAnswer = false;
    const out = await wire(fx).call<NotesRegenerateResult>(IPC.notesRegenerate, { fileId: 'f_deck' });
    expect(out.confirmed).toBe(false);
    expect(fx.confirms).toHaveLength(1);
    expect(fx.confirms[0]!.message).toContain('Regenerate the notes');
    expect(fx.confirms[0]!.detail).toContain('the 5 words you wrote in them');
    expect(fx.confirms[0]!.detail).toContain('1 addition from Ellie and Max');
    expect(fx.confirms[0]!.detail).toContain('Your conversation and your progress are kept');
  });

  it('changes nothing on a Cancel', async () => {
    const fx = withDoc();
    fx.confirmAnswer = false;
    await wire(fx).call<NotesRegenerateResult>(IPC.notesRegenerate, { fileId: 'f_deck' });
    expect(count(fx, 'SELECT COUNT(*) AS n FROM notes_doc_edits')).toBe(2);
    expect(count(fx, 'SELECT COUNT(*) AS n FROM notes_suggestions')).toBe(1);
    expect(readdirSync(pageImageDir(userData, SHA))).toEqual(['p-1.png']);
  });

  it('on a yes, clears the chrome that points into the old notes and keeps decided history', async () => {
    const fx = withDoc();
    const out = await wire(fx).call<NotesRegenerateResult>(IPC.notesRegenerate, { fileId: 'f_deck' });
    expect(out).toMatchObject({ confirmed: true, refused: null });
    expect(out.view?.edits).toEqual([]);
    expect(out.view?.suggestions).toEqual([]);
    expect(count(fx, 'SELECT COUNT(*) AS n FROM notes_doc_edits')).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notes_doc_edits WHERE status = 'kept'")).toBe(1);
    expect(count(fx, 'SELECT COUNT(*) AS n FROM notes_suggestions')).toBe(0);
    // Cleared *before* the renderer re-sends them, so the forced ingest reads fresh pixels.
    expect(existsSync(pageImageDir(userData, SHA)) ? readdirSync(pageImageDir(userData, SHA)) : []).toEqual([]);
  });
});

describe('learnerWordsIn', () => {
  it('counts only the learner’s runs, and survives a document it cannot read', () => {
    expect(learnerWordsIn(deck().toJSON())).toBe(5);
    expect(learnerWordsIn({ nonsense: true })).toBe(0);
    expect(learnerWordsIn(null)).toBe(0);
  });
});

// ── notebooks (`notebooks.md`, #58): the notes channels on a notebook id ─────────────────────

const NB = 'nb_feedfacecafe';

function notebookHost(opts: { ready?: boolean } = {}) {
  const { db, store } = openTestDb();
  const nb = fakeNotebook(NB, [
    { fileId: 'f_c1', name: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf', pageBase: 0, pages: slides(7, 'btw'), status: opts.ready === false ? 'reading' : 'ready' },
  ]);
  const events: RoomEvent[] = [];
  const host = {
    db,
    store,
    notebooks: nb.host,
    userDataDir: userData,
    emit: (e: RoomEvent) => events.push(e),
    backend: () => ({ kind: 'scripted', choice: 'scripted', models: API_PLAN, fellBackBecause: null, detection: null }),
    llm: () => {
      throw new Error('no model in this test');
    },
    roomForFile: async () => null,
    objectivesTree: (id: string) => store.objectives.tree(id),
    confirm: async () => true,
    fileBytesKey: async () => {
      throw new Error('a notebook id never reaches the segment cache');
    },
  } as unknown as DocHost;
  const table = handlerTable();
  registerNotesIpc(host, table.handle);
  return { table, nb, events, store };
}

describe('the notes channels on a notebook', () => {
  it('notes:get is null before, notes:ingest writes the overview, and both carry OverviewMeta', async () => {
    const { table, events } = notebookHost();
    expect(await table.call(IPC.notesGet, { fileId: NB })).toBeNull();
    const view = await table.call<NotesDocView>(IPC.notesIngest, { fileId: NB });
    expect(view.fileId).toBe(NB);
    expect(view.contentSha).toBe(notebookContentKey(NB));
    expect(view.ingest.status).toBe('ready');
    expect(view.overview!.starterQuestions).toHaveLength(3);
    const again = await table.call<NotesDocView>(IPC.notesGet, { fileId: NB });
    expect(again!.overview).toEqual(view.overview);
    expect(events.some((e) => e.type === 'objectives.tree')).toBe(true);
  });

  it('notes:ingest with nothing ready returns status none and creates nothing', async () => {
    const { table } = notebookHost({ ready: false });
    const view = await table.call<NotesDocView>(IPC.notesIngest, { fileId: NB });
    expect(view).toMatchObject({ docId: '', fileId: NB, doc: null, overview: null });
    expect(view.ingest.status).toBe('none');
    expect(await table.call(IPC.notesGet, { fileId: NB })).toBeNull();
  });

  it('notes:setRecommendation and notes:updateOverview', async () => {
    const { table } = notebookHost();
    expect(await table.call<NotesUpdateOverviewResult>(IPC.notesUpdateOverview, { fileId: NB })).toEqual({ started: false, reason: 'no_doc' });
    const view = await table.call<NotesDocView>(IPC.notesIngest, { fileId: NB });
    const rec = view.overview!.recommendations[0]!;
    const meta = await table.call<OverviewMeta>(IPC.notesSetRecommendation, { fileId: NB, docId: view.docId, recommendationId: rec.id, status: 'dismissed' });
    expect(meta.recommendations[0]!.status).toBe('dismissed');
    expect(await table.call<NotesUpdateOverviewResult>(IPC.notesUpdateOverview, { fileId: NB })).toEqual({ started: true, reason: null });
    await overviewInFlight(notebookContentKey(NB));
    const after = await table.call<NotesDocView>(IPC.notesGet, { fileId: NB });
    expect(after!.ingest.status).toBe('ready');
    // A rewritten overview offers its recommendations afresh.
    expect(after!.overview!.recommendations[0]!.status).toBe('offered');
  });

  it('notes:regenerate on a notebook asks about the overview, and the view keeps its metadata until the new one lands', async () => {
    const { table } = notebookHost();
    await table.call<NotesDocView>(IPC.notesIngest, { fileId: NB });
    const out = await table.call<NotesRegenerateResult>(IPC.notesRegenerate, { fileId: NB });
    expect(out.confirmed).toBe(true);
    expect(out.view!.overview).not.toBeNull();
  });
});

// ── the learner's slide moves (migration 025) ────────────────────────────────────────────────

describe('notes:slideGroups and notes:setSlideGroup', () => {
  it('stores a move, returns the whole list each time, and forgets it on a null key', async () => {
    const table = wire(fakeHost({ doc: deck() }));
    expect(await table.call(IPC.notesSlideGroups, { docId: DOC_ID })).toEqual([]);
    expect(await table.call(IPC.notesSetSlideGroup, { docId: DOC_ID, page: 9, key: 'b_1', title: 'Convexity' })).toEqual([
      { page: 9, key: 'b_1', title: 'Convexity' },
    ]);
    expect(await table.call(IPC.notesSetSlideGroup, { docId: DOC_ID, page: 2, key: 'other', title: '' })).toEqual([
      { page: 2, key: 'other', title: '' },
      { page: 9, key: 'b_1', title: 'Convexity' },
    ]);
    expect(await table.call(IPC.notesSetSlideGroup, { docId: DOC_ID, page: 9, key: null, title: '' })).toEqual([
      { page: 2, key: 'other', title: '' },
    ]);
    expect(await table.call(IPC.notesSlideGroups, { docId: DOC_ID })).toEqual([{ page: 2, key: 'other', title: '' }]);
  });

  it('refuses a document that does not exist, and an empty key', async () => {
    const table = wire(fakeHost({ doc: deck() }));
    await expect(async () => table.call(IPC.notesSetSlideGroup, { docId: 'doc_nope', page: 1, key: 'other', title: '' })).rejects.toThrow(
      /does not exist/,
    );
    await expect(async () => table.call(IPC.notesSetSlideGroup, { docId: DOC_ID, page: 1, key: '', title: '' })).rejects.toThrow(/needs a key/);
  });
});
