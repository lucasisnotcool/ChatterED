/**
 * `AppService.docHost()` with a notebook as the subject (contract C2, C4): the key, the virtual
 * page count, the host, and the room — built on the real AppService over a real database.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppService } from '../ipc.js';
import { openTestDb } from '../../test-support/db.js';
import { notebookContentKey } from '../../shared/notebook.js';
import { TWO_PAGE_PDF } from './fixtures.test-support.js';

let dir = '';
let app: AppService | null = null;

afterEach(() => {
  app?.dispose();
  app = null;
  rmSync(dir, { recursive: true, force: true });
});

function service(): { app: AppService; sent: { channel: string; payload: unknown }[]; db: ReturnType<typeof openTestDb>['db'] } {
  dir = mkdtempSync(join(tmpdir(), 'chattered-dochost-'));
  const sent: { channel: string; payload: unknown }[] = [];
  const t = openTestDb();
  app = new AppService({
    ...t,
    appVersion: '0.0.0-test',
    osVersion: 'darwin test',
    userDataDir: join(dir, 'ChatterED'),
    logDir: join(dir, 'logs'),
    getWindow: () =>
      ({ webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }) as never,
  });
  return { app, sent, db: t.db };
}

describe('DocHost for a notebook', () => {
  it('keys on nb:<id>, reads the virtual deck, and opens one room whose material is the sources', async () => {
    const { app, sent, db } = service();
    app.startNotebooks();
    expect(db.prepare("SELECT root_path FROM vaults WHERE id = 'vault_notebooks'").get()).toEqual({
      root_path: join(dir, 'ChatterED', 'notebooks'),
    });
    const pdf = join(dir, 'Lecture.pdf');
    writeFileSync(pdf, Buffer.from(TWO_PAGE_PDF, 'latin1'));
    const { notebook } = await app.notebooks.create({ paths: [pdf] });
    await app.notebooks.whenIdle();
    expect(sent.some((s) => s.channel === 'notebook:changed')).toBe(true);

    const host = app.docHost();
    expect(await host.fileBytesKey(notebook.id)).toEqual({ contentSha: notebookContentKey(notebook.id), pageCount: 2 });
    expect(host.notebooks.deckText(notebook.id).text).toContain('[p. 2]\nHessian');
    const located = host.notebooks.locate(notebook.id, 2)!;
    expect(located.localPage).toBe(2);
    // The source's bytes still open by its file id, through the vault.
    expect((await host.vault.document(located.fileId)).bytes?.length).toBeGreaterThan(100);

    // C5: never the whole-deck objective ingest for a notebook.
    host.ensureObjectives(notebook.id);
    expect(host.objectivesTree(notebook.id)).toBeNull();

    const opened = await host.openFlowRoom(notebook.id);
    expect(opened.created).toBe(true);
    expect(host.fileForRoom(opened.roomId)).toBe(notebook.id);
    const again = await host.roomForFile(notebook.id);
    expect(again?.roomId).toBe(opened.roomId);
    await expect(host.fileBytesKey('nb_000000000000')).rejects.toThrow(/no longer exists/);
  });
});
