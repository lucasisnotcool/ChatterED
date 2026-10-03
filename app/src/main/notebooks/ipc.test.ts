/**
 * The `notebook:*` bodies: every channel is registered, and what a renderer hands over as a path
 * is filtered before the service sees it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { IPC } from '../../shared/ipc.js';
import type { AddSourcesResult, NotebookSummary } from '../../shared/notebook.js';
import { ensureManagedVault } from '../vault/managed.js';
import { cleanPaths, PICKER_FILTERS, registerNotebookIpc } from './ipc.js';
import { NotebookService } from './service.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations', import.meta.url));

describe('cleanPaths', () => {
  it('keeps absolute strings only, once each', () => {
    expect(cleanPaths(['/a/b.pdf', 'relative.pdf', 3, null, '/a/b.pdf', '', '/x\u0000y', '/c.md'])).toEqual([
      '/a/b.pdf',
      '/c.md',
    ]);
    expect(cleanPaths('not an array')).toEqual([]);
    expect(cleanPaths(Array.from({ length: 300 }, (_, i) => `/f${i}.pdf`))).toHaveLength(200);
  });

  it('offers the picker exactly the extensions a notebook accepts', () => {
    expect(PICKER_FILTERS[0]!.extensions).toEqual(expect.arrayContaining(['pdf', 'docx', 'md', 'png']));
    expect(PICKER_FILTERS[0]!.extensions).not.toContain('pptx');
  });
});

describe('registerNotebookIpc', () => {
  let tmp = '';
  let service: NotebookService;
  const handlers = new Map<string, (payload: unknown) => unknown>();

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'chattered-nbipc-'));
    const db = openTestDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    ensureManagedVault(db, join(tmp, 'notebooks'), '2026-10-01T00:00:00.000Z');
    service = new NotebookService({ db, root: join(tmp, 'notebooks'), confirm: async () => true });
    handlers.clear();
    registerNotebookIpc({
      service,
      handle: ((channel: string, fn: (payload: unknown) => unknown) => void handlers.set(channel, fn)) as never,
      pickFiles: async () => [join(tmp, 'picked.md'), 'relative.md'],
    });
  });

  afterEach(() => {
    service.dispose();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('registers every notebook and folder channel', () => {
    const channels = Object.entries(IPC)
      .filter(([k]) => (k.startsWith('notebook') || k.startsWith('folder')) && k !== 'notebookChanged')
      .map(([, v]) => v);
    expect([...handlers.keys()].sort()).toEqual([...channels].sort());
  });

  it('creates, adds, lists and refuses a non-notebook id', async () => {
    writeFileSync(join(tmp, 'picked.md'), '# Notes\n\nSome text.');
    const picked = (await handlers.get(IPC.notebookPickFiles)!(undefined)) as { paths: string[] };
    expect(picked.paths).toEqual([join(tmp, 'picked.md')]);
    const created = (await handlers.get(IPC.notebookCreate)!({ paths: [...picked.paths, '../escape.md'] })) as AddSourcesResult;
    expect(created.notebook.name).toBe('picked');
    expect(created.added).toHaveLength(1);
    await service.whenIdle();
    const list = (await handlers.get(IPC.notebookList)!(undefined)) as NotebookSummary[];
    expect(list).toMatchObject([{ name: 'picked', sourceCount: 1, enabledCount: 1 }]);
    await expect(async () => handlers.get(IPC.notebookGet)!({ notebookId: 'f_123' })).rejects.toThrow(/Not a notebook/);
  });

  it('creates, moves and deletes folders, and refuses an id that is not a folder', async () => {
    const top = (await handlers.get(IPC.folderCreate)!({ name: 'CS4246' })) as { id: string };
    const sub = (await handlers.get(IPC.folderCreate)!({ parentId: top.id })) as { id: string; name: string };
    expect(sub.name).toBe('Untitled folder');
    const made = (await handlers.get(IPC.notebookCreate)!({ name: 'Week 3', folderId: sub.id })) as AddSourcesResult;
    const listed = (await handlers.get(IPC.notebookList)!(undefined)) as NotebookSummary[];
    expect(listed.find((n) => n.id === made.notebook.id)!.folderId).toBe(sub.id);
    await handlers.get(IPC.notebookMove)!({ notebookId: made.notebook.id, folderId: null });
    expect(() => handlers.get(IPC.folderMove)!({ folderId: top.id, parentId: sub.id })).toThrow(/inside itself/);
    expect(() => handlers.get(IPC.folderMove)!({ folderId: '../etc', parentId: null })).toThrow(/Not a folder id/);
    expect(() => handlers.get(IPC.notebookMove)!({ notebookId: made.notebook.id, folderId: 'top' })).toThrow(/Not a folder id/);
    // A made-up folder id on create is the top level, not an error: the folder may have just gone.
    const loose = (await handlers.get(IPC.notebookCreate)!({ name: 'x', folderId: 'nonsense' })) as AddSourcesResult;
    expect(loose.notebook.id).toMatch(/^nb_/);
    expect(await handlers.get(IPC.folderDelete)!({ folderId: top.id })).toEqual({ deleted: true, movedNotebooks: 0, movedFolders: 1 });
    expect(((await handlers.get(IPC.folderList)!(undefined)) as { parentId: string | null }[]).map((f) => f.parentId)).toEqual([null]);
  });
});
