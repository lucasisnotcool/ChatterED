/**
 * The chats' renderer state (#48). **Track T5 owns this file** — the lead placed only the stub
 * and the hook in `store.svelte.ts` (`store.chat`, and every `RoomEvent` forwarded to `apply`).
 * Agreed surface for other tracks: `openSpanThread({ blockId, quote })`, `focusThread(threadId)`.
 */

import type { RoomEvent } from '../../shared/types.js';

export class ChatStore {
  apply(_e: RoomEvent): void {}
  openSpanThread(_input: { blockId: string; quote: string }): void {}
  focusThread(_threadId: string): void {}
}
