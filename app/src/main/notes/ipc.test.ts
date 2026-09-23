/**
 * **Regenerate Notes** (2026-09-23): the confirm is main's, and a yes clears what points into the
 * old document — nothing is touched on a Cancel.
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { docOf, para } from '../../shared/doc/fixture.test-support.js';
import type { NotesRegenerateResult } from '../../shared/doc/types.js';
import { IPC } from '../../shared/ipc.js';
import { DOC_ID, SHA, fakeHost, handlerTable, type FakeHost } from '../docroom/fakehost.test-support.js';
import { registerNotesIpc, learnerWordsIn } from './ipc.js';
import { pageImageDir } from './pageimages.js';

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
