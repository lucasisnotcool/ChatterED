/**
 * **The collab doc's push events** (`docs/research/collab-doc.md`, #48).
 *
 * They ride the one `RoomEvent` stream (`IPC.event`), the precedent `objectives.tree` set: a new
 * domain gets new variants, not a new channel. `roomId` is null where a file has no room yet
 * (the notes ingest runs before the first question is asked).
 *
 * Frozen after day 0 — see `app/docs/COLLAB-CONTRACT.md`.
 */

import type {
  AgentAuthor,
  AgentDocOpBatch,
  DocBlockDraft,
  NotesIngestView,
  PrivateTurnView,
  ProgressView,
  Suggestion,
  ThreadView,
} from './doc/types.js';

export type DocRoomEvent =
  /** The ingest moved: a window landed, it finished, or it failed. */
  | { type: 'notes.status'; roomId: string | null; fileId: string; docId: string; ingest: NotesIngestView }
  /**
   * One ingest window landed; the doc fills in behind the "Ellie is still writing" marker. A
   * window only ever **appends** after `afterBlockId` (the previous window's last block) — it
   * never touches an existing block, so it cannot collide with a learner who is already editing.
   */
  | {
      type: 'notes.window';
      roomId: string | null;
      fileId: string;
      docId: string;
      afterBlockId: string | null;
      blocks: DocBlockDraft[];
      /**
       * The ProseMirror nodes main inserted for `blocks`, **with their block ids** (2026-09-23).
       * The renderer inserts these rather than re-deriving nodes from `blocks`, which minted
       * different ids and made every window land twice. Absent from the scripted fixture's event
       * and from older emitters; the renderer then falls back to `blocks`.
       */
      nodes?: unknown[];
    }
  /** An agent edit, ready to be typed in behind its cursor. The renderer applies it and saves. */
  | { type: 'doc.edit'; roomId: string; docId: string; batch: AgentDocOpBatch }
  /** Where an agent's cursor is while it thinks about, or makes, an edit. */
  | {
      type: 'doc.cursor';
      roomId: string;
      docId: string;
      author: AgentAuthor;
      blockId: string | null;
      state: 'idle' | 'thinking' | 'typing';
    }
  | { type: 'doc.suggestion'; roomId: string; docId: string; suggestion: Suggestion }
  | { type: 'progress.updated'; roomId: string | null; fileId: string; progress: ProgressView }
  /** A thread was opened or its quiz state changed. Replaces the old `refreshFlowQuiz` poll. */
  | { type: 'chat.thread'; roomId: string; thread: ThreadView }
  | { type: 'chat.private'; roomId: string; threadId: string; turn: PrivateTurnView };
