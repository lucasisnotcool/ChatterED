/**
 * The notes doc's renderer state (#48). **Track T4 owns this file** — the lead placed only the
 * stub and the hook in `store.svelte.ts` (`store.doc`, and every `RoomEvent` forwarded to `apply`).
 * Agreed surface for other tracks: `scrollToBlock(blockId)`, `caretBlockId()`.
 */

import type { RoomEvent } from '../../shared/types.js';

export class DocStore {
  apply(_e: RoomEvent): void {}
  scrollToBlock(_blockId: string): void {}
  caretBlockId(): string | null {
    return null;
  }
}
