/**
 * The notes doc's IPC bodies (#48). **Track T1 owns this file** — the lead placed only the hook.
 * Channels: `notes:get`, `notes:ingest`, `notes:pageImages`, `notes:save`, `notes:freeze`,
 * `notes:editResolved`, `notes:suggestionResolved`. See `app/docs/COLLAB-CONTRACT.md`.
 */

import type { DocHost, IpcHandle } from '../dochost.js';

export function registerNotesIpc(_host: DocHost, _handle: IpcHandle): void {
  // T1 fills this in.
}
