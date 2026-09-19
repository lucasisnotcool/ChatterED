/**
 * The chats' IPC bodies (#48). **Track T6 owns this file** — the lead placed only the hook.
 * Channels: `notes:docText`, `chat:threads`, `chat:send`, `chat:openSpan`, `chat:privateOpen`,
 * `chat:privateSend`, `chat:insertIntoDoc`, `quiz:pass`. See `app/docs/COLLAB-CONTRACT.md`.
 */

import type { DocHost, IpcHandle } from '../dochost.js';

export function registerDocRoomIpc(_host: DocHost, _handle: IpcHandle): void {
  // T6 fills this in.
}
