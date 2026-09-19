/**
 * Progress renderer state (#48). **Track T5 owns this file** — the lead placed only the stub and
 * the hook in `store.svelte.ts` (`store.progress`, and every `RoomEvent` forwarded to `apply`).
 */

import type { RoomEvent } from '../../shared/types.js';

export class ProgressStore {
  apply(_e: RoomEvent): void {}
}
