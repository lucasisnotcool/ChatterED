/**
 * **What the collab-doc modules may ask of the app** (#48).
 *
 * `AppService` (`ipc.ts`) is 1,500 lines and four tracks need things from it. Rather than four
 * tracks editing it, it hands out this one narrow object (`AppService.docHost()`), and the three
 * `register*Ipc` hooks in `register()` take it. Declared by the lead on day 0 and frozen — see
 * `app/docs/COLLAB-CONTRACT.md`.
 */

import type { RoomEvent } from '../shared/types.js';
import type { LearningObjectiveState, LearningTree } from '../shared/objectives.js';
import type { LLMClient } from '../room/llm/types.js';
import type { RoomActor } from '../room/actor.js';
import type { SqlDatabase } from './db/driver.js';
import type { LocalStore } from './db/store.js';
import type { ResolvedBackend } from './llm/backend.js';
import type { SegmentService } from './vault/segments.js';
import type { VaultService } from './vault/service.js';

/** The wrapper `register()` builds: logs `ipc.error` with the channel, then re-throws. */
export type IpcHandle = <T>(channel: string, fn: (payload: T) => unknown) => void;

export interface DocHost {
  readonly db: SqlDatabase;
  readonly store: LocalStore;
  readonly vault: VaultService;
  readonly segments: SegmentService;
  /** `app.getPath('userData')`. Page images for the refine pass live under it. */
  readonly userDataDir: string;

  /** The one main→renderer stream. */
  emit(event: RoomEvent): void;

  backend(): ResolvedBackend;
  /** The counted, logged client. Pass the material so the scripted backend picks the right script. */
  llm(resolved?: ResolvedBackend, material?: { fileName?: string | null; contentSha?: string | null }): LLMClient;

  /**
   * The room for a file, created on first use, with the actor brought onto it. One actor is open
   * at a time; opening another file's room stops the previous actor (as the flow always has).
   */
  openFlowRoom(fileId: string): Promise<{ roomId: string; actor: RoomActor; created: boolean }>;
  /** The room for a file if one exists, without creating it. */
  roomForFile(fileId: string): Promise<{ roomId: string; actor: RoomActor } | null>;
  /** Throws when that room is not the open one. */
  actorFor(roomId: string): RoomActor;
  currentActor(): RoomActor | null;
  fileForRoom(roomId: string): string | null;
  /** Write the sitting back to SQLite. Call after every learner-authored action. */
  persistFlow(): void;

  objectivesTree(fileId: string): LearningTree | null;
  objectivesStates(fileId: string): LearningObjectiveState[];
  /** Fire the objective ingest for a file if its tree is not current. Never awaited. */
  ensureObjectives(fileId: string): void;

  /** `{ contentSha, pageCount }` for a vault file, from the segment cache. */
  fileBytesKey(fileId: string): Promise<{ contentSha: string; pageCount: number }>;
}
