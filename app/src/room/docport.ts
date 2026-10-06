/**
 * **The actor's view of the notes doc** (`docs/research/collab-doc.md` §5, §8; #48).
 *
 * `src/room` may not import `src/main`, a SQLite driver or ProseMirror's view, so the doc reaches
 * the actor as this port. The renderer is the live authority on the document while it is open;
 * main persists what the renderer saves; what this port reads is the **last saved** doc, which is
 * at most a debounce behind.
 *
 * The actor never sees ProseMirror JSON and never addresses an offset: it reads an outline of
 * blocks and writes `AgentDocOpBatch`es that name block ids.
 *
 * Declared by the lead on day 0 and frozen (`app/docs/COLLAB-CONTRACT.md`). T1 implements it in
 * `src/main/notes/docport.ts`; T3 calls it.
 */

import type { AgentDocOpBatch, ObjectiveActivity, OutlineEntry, QuizOutcome } from '../shared/doc/types.js';

export interface DocPort {
  /** The doc for this room's file, or null when it has not been ingested (then nothing is edited). */
  docId(): string | null;
  /** Brief §3: while frozen no agent edits the doc. The actor skips the doc-edit call entirely. */
  frozen(): boolean;
  /**
   * The outline near a block: what a doc-edit prompt is given, and all it is given. With a null
   * `blockId`, the blocks that carry `pages` (when given) or the top of the document.
   */
  outlineNear(anchor: { blockId: string | null; pages?: readonly number[] }, radius?: number): OutlineEntry[];
  /** The blocks that carry these pages, in document order. For placing a Q block or an answer. */
  blocksForPages(pages: readonly number[]): string[];
  /** Whether the doc already holds this question's Q block (so `resolve_q` has a target). */
  hasQuestion(questionId: string): boolean;
  /**
   * Record an edit as `pending` **before** it is emitted, so an edit the renderer never reports
   * on is still in the log. The renderer's `notes:editResolved` moves it on.
   */
  recordEdit(input: {
    batch: AgentDocOpBatch;
    roomId: string;
    turnId: string | null;
    messageId: string | null;
    objectiveId: string | null;
  }): void;
  /** One row per verdict or release. The progress bar is a pure function of these. */
  recordOutcome(outcome: Omit<QuizOutcome, 'id' | 'contentSha' | 'createdAt'>): void;
  /**
   * One Explain or Example press, against the objective of its line (2026-10-06, D2; migration 030),
   * or one question to Ellie she answered on a section (decision 8 of 6 Oct afternoon, #67;
   * migration 031). `objectiveId: null` asks the port to find the block's objective itself (the
   * actor knows the block a question was about, not which objective the block is taught under);
   * a block with none, or with two, is not filed. Optional, so a port written before it (a
   * tutorial sheet's, a test's) need not record one.
   */
  recordActivity?(activity: ActivityInput): void;
}

/** What the actor files through `recordActivity`: the row less what the port mints. */
export type ActivityInput = Omit<ObjectiveActivity, 'id' | 'contentSha' | 'createdAt' | 'objectiveId'> & {
  objectiveId: string | null;
};

/** A room with no notes doc: every read is empty and every write is dropped. */
export const NO_DOC: DocPort = {
  docId: () => null,
  frozen: () => true,
  outlineNear: () => [],
  blocksForPages: () => [],
  hasQuestion: () => false,
  recordEdit: () => {},
  recordOutcome: () => {},
};
