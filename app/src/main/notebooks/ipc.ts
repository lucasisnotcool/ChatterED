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
import { SOURCE_EXTENSIONS } from '../../shared/notebook.js';
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

export interface NotebookIpcDeps {
  service: NotebookService;
  handle: IpcHandle;
  /** The native open dialog, multi-select, over `PICKER_FILTERS`. Null when it was cancelled. */
  pickFiles(): Promise<string[] | null>;
}

export function registerNotebookIpc({ service, handle, pickFiles }: NotebookIpcDeps): void {
  handle(IPC.notebookList, () => service.list());
  handle<{ notebookId: string }>(IPC.notebookGet, (input) => service.get(requireId(input?.notebookId)));
  handle<{ name?: string | null; paths?: string[] }>(IPC.notebookCreate, (input) =>
    service.create({
      name: typeof input?.name === 'string' ? input.name : null,
      paths: cleanPaths(input?.paths),
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
  handle<{ notebookId: string; fileId: string }>(IPC.notebookRemoveSource, (input) =>
    service.removeSource(requireId(input?.notebookId), typeof input?.fileId === 'string' ? input.fileId : ''),
  );
}
