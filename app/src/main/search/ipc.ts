/**
 * **The `search:*` channels** (`docs/research/search.md` §4-§5). Registered from
 * `AppService.register()` through its wrapped `handle`, like every other channel. The bodies are
 * thin: a query is a string of at most 500 characters and a folder id or null; the index owns
 * the rest.
 */
import { IPC } from '../../shared/ipc.js';
import { isFolderId } from '../../shared/folders.js';
import type { IpcHandle } from '../dochost.js';
import type { SearchIndex } from './index.js';

export const MAX_QUERY_CHARS = 500;

function folderOrAll(raw: unknown): string | null {
  return isFolderId(raw) ? raw : null;
}

export function registerSearchIpc({ index, handle }: { index: SearchIndex; handle: IpcHandle }): void {
  handle<{ query: string; folderId?: string | null; limit?: number }>(IPC.searchQuery, (input) =>
    index.query(typeof input?.query === 'string' ? input.query.slice(0, MAX_QUERY_CHARS) : '', {
      folderId: folderOrAll(input?.folderId),
      limit: typeof input?.limit === 'number' && input.limit > 0 ? Math.min(100, Math.floor(input.limit)) : 40,
    }),
  );
  handle<{ folderId?: string | null }>(IPC.searchStatus, (input) => index.status(folderOrAll(input?.folderId)));
}
