/**
 * **The `notebook:*` channels** (`shared/ipc.ts`, `docs/research/notebooks.md`). Registered from
 * `AppService.register()` through its wrapped `handle`, so every one is behind the trusted-sender
 * check and the trial gate, and logs `ipc.error` on a throw, like every other channel.
 *
 * The bodies are thin: the service owns the rules. The one thing decided here is what a renderer
 * may hand over as a path — a list of strings, each absolute, which is what the preload's
 * `pathForFile` (a drop) and the native picker (`notebook:pickFiles`) both give. Anything else is
 * dropped before the service sees it, and the service then refuses by kind, size and duplicate.
 */
import { isAbsolute } from 'node:path';
import { IPC } from '../../shared/ipc.js';
import { SOURCE_EXTENSIONS, type DuplicateResult } from '../../shared/notebook.js';
import { isFolderId } from '../../shared/folders.js';
import type { SetSourceRoleInput } from '../../shared/tutorial.js';
import type { IpcHandle } from '../dochost.js';
import type { NotebookService } from './service.js';

/** The picker's filter: what a notebook accepts, so the dialog greys out the rest. */
export const PICKER_FILTERS = [
  { name: 'Sources', extensions: Object.keys(SOURCE_EXTENSIONS) },
];

/** Strings only, absolute only, no duplicates, at most 200 per call. */
export function cleanPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 4096 || p.includes('\u0000')) continue;
    if (!isAbsolute(p) || out.includes(p)) continue;
    out.push(p);
    if (out.length >= 200) break;
  }
  return out;
}

function requireId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('nb_')) throw new Error('Not a notebook id.');
  return raw;
}

function requireFolderId(raw: unknown): string {
  if (!isFolderId(raw)) throw new Error('Not a folder id.');
  return raw;
}

/** A folder id, or null for the top level. Anything else is refused rather than read as "top". */
function folderOrTop(raw: unknown): string | null {
  return raw === null || raw === undefined ? null : requireFolderId(raw);
}

export interface NotebookIpcDeps {
  service: NotebookService;
  handle: IpcHandle;
  /** The native open dialog, multi-select, over `PICKER_FILTERS`. Null when it was cancelled. */
  pickFiles(): Promise<string[] | null>;
}

export function registerNotebookIpc({ service, handle, pickFiles }: NotebookIpcDeps): void {
  handle(IPC.notebookList, () => service.list());
  handle<{ notebookId: string }>(IPC.notebookGet, (input) => service.get(requireId(input?.notebookId)));
  handle<{ name?: string | null; paths?: string[]; folderId?: string | null }>(IPC.notebookCreate, (input) =>
    service.create({
      name: typeof input?.name === 'string' ? input.name : null,
      paths: cleanPaths(input?.paths),
      folderId: isFolderId(input?.folderId) ? input.folderId : null,
    }),
  );
  handle<{ notebookId: string; name: string }>(IPC.notebookRename, (input) =>
    service.rename(requireId(input?.notebookId), typeof input?.name === 'string' ? input.name : ''),
  );
  handle<{ notebookId: string }>(IPC.notebookDelete, (input) => service.delete(requireId(input?.notebookId)));
  handle<{ notebookId: string }>(IPC.notebookOpen, (input) => service.open(requireId(input?.notebookId)));
  handle(IPC.notebookPickFiles, async () => ({ paths: cleanPaths((await pickFiles()) ?? []) }));
  handle<{ notebookId: string; paths: string[] }>(IPC.notebookAddSources, (input) =>
    service.addSources(requireId(input?.notebookId), cleanPaths(input?.paths)),
  );
  handle<{ notebookId: string; fileIds: string[]; enabled: boolean }>(IPC.notebookSetEnabled, (input) =>
    service.setEnabled(
      requireId(input?.notebookId),
      Array.isArray(input?.fileIds) ? input.fileIds.filter((f): f is string => typeof f === 'string') : [],
      input?.enabled === true,
    ),
  );
  // Tutorials (`docs/research/tutorials.md` §1): what a source is. The service validates the role
  // and the tutorial a set of solutions answers.
  handle<SetSourceRoleInput>(IPC.notebookSetRole, (input) =>
    service.setRole({
      notebookId: requireId(input?.notebookId),
      fileId: typeof input?.fileId === 'string' ? input.fileId : '',
      role: input?.role,
      keyFor: typeof input?.keyFor === 'string' ? input.keyFor : null,
    }),
  );
  handle<{ notebookId: string; folderId: string | null }>(IPC.notebookMove, (input) =>
    service.moveNotebook(requireId(input?.notebookId), folderOrTop(input?.folderId)),
  );
  handle(IPC.folderList, () => service.folders());
  handle<{ name?: string | null; parentId?: string | null }>(IPC.folderCreate, (input) =>
    service.createFolder({
      name: typeof input?.name === 'string' ? input.name : null,
      parentId: folderOrTop(input?.parentId),
    }),
  );
  handle<{ folderId: string; name: string }>(IPC.folderRename, (input) =>
    service.renameFolder(requireFolderId(input?.folderId), typeof input?.name === 'string' ? input.name : ''),
  );
  handle<{ folderId: string; parentId: string | null }>(IPC.folderMove, (input) =>
    service.moveFolder(requireFolderId(input?.folderId), folderOrTop(input?.parentId)),
  );
  handle<{ folderId: string }>(IPC.folderDelete, (input) => service.deleteFolder(requireFolderId(input?.folderId)));
  handle<{ notebookId: string; exclude: boolean }>(IPC.notebookSetResearchExclude, (input) =>
    service.setNotebookResearchExclude(requireId(input?.notebookId), input?.exclude === true),
  );
  handle<{ folderId: string; exclude: boolean }>(IPC.folderSetResearchExclude, (input) =>
    service.setFolderResearchExclude(requireFolderId(input?.folderId), input?.exclude === true),
  );
  // A copy is excluded from research data unless the renderer says `researchExclude: false`.
  handle<{ notebookId: string; name?: string | null; researchExclude?: boolean }>(IPC.notebookDuplicate, (input): DuplicateResult => {
    const out = service.duplicateNotebook({
      notebookId: requireId(input?.notebookId),
      name: typeof input?.name === 'string' ? input.name : null,
      researchExclude: input?.researchExclude !== false,
    });
    return { kind: 'notebook', id: out.to, name: out.name, notebooks: 1, missingSources: out.missing.length, researchExclude: out.researchExclude };
  });
  handle<{ folderId: string; name?: string | null; researchExclude?: boolean }>(IPC.folderDuplicate, (input): DuplicateResult => {
    const out = service.duplicateFolder({
      folderId: requireFolderId(input?.folderId),
      name: typeof input?.name === 'string' ? input.name : null,
      researchExclude: input?.researchExclude !== false,
    });
    return {
      kind: 'folder',
      id: out.to,
      name: out.name,
      notebooks: out.notebooks.length,
      missingSources: out.notebooks.reduce((n, nb) => n + nb.missing.length, 0),
      researchExclude: out.researchExclude,
    };
  });
  handle<{ notebookId: string; fileId: string }>(IPC.notebookRemoveSource, (input) =>
    service.removeSource(requireId(input?.notebookId), typeof input?.fileId === 'string' ? input.fileId : ''),
  );
}
