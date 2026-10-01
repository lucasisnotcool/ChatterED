/**
 * The chat thread registry (#48, migration 020 `notes_threads`).
 *
 * **A thread id IS a `messages.anchor_id`** — the architecture study's §A.4 rule, and the reason
 * this table is a *registry* and not a thread store: the turns themselves stay in `messages`,
 * keyed by anchor exactly as the flow has always keyed them, and this row only carries what an
 * anchor id cannot say on its own — which block a span thread hangs off, the learner's verbatim
 * quote, which agent a private thread belongs to, and which objective the span turned out to be
 * about. Two copies of a conversation would be two things that can disagree.
 *
 * Keyed `(room_id, thread_id)` because a room is a file's room: the same `'doc'` anchor exists in
 * every room, and the pair is what makes it one thread per file rather than one globally.
 *
 * Everything here is synchronous and does no policy. Whether a block *should* get a span thread,
 * and which objective it maps to, is decided in `src/main/docroom/`; this file decides only where
 * the row is written.
 */
import type { SqlDatabase } from '../driver.js';
import { plain, plainAll } from '../sql.js';
import type { AgentAuthor, ThreadKind } from '../../../shared/doc/types.js';

/** One registry row, in the shapes the rest of main uses (camel case, nulls kept as nulls). */
export interface ThreadRecord {
  threadId: string;
  roomId: string;
  docId: string | null;
  kind: ThreadKind;
  /** `span` only: the block the question is anchored to. */
  blockId: string | null;
  /** `span` only: the learner's selection, verbatim, as it read when they pressed Ctrl+E. */
  quote: string | null;
  /** `private` only. */
  agentKey: AgentAuthor | null;
  /** Resolved when the block's pages intersect exactly one objective's refs; else null. */
  objectiveId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface ThreadRow {
  thread_id: string;
  room_id: string;
  doc_id: string | null;
  kind: ThreadKind;
  block_id: string | null;
  span_quote: string | null;
  agent_key: string | null;
  objective_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface EnsureDocThreadInput {
  roomId: string;
  docId: string | null;
  threadId: string;
  now: string;
}

export interface CreateSpanThreadInput {
  roomId: string;
  docId: string | null;
  threadId: string;
  blockId: string;
  quote: string;
  objectiveId?: string | null;
  now: string;
}

export interface RegisterPrivateThreadInput {
  roomId: string;
  docId: string | null;
  threadId: string;
  agentKey: AgentAuthor;
  now: string;
}

export interface ThreadsRepo {
  /**
   * The doc chat for a room, created on first use. Idempotent: `chat:send` calls it on every
   * message rather than remembering whether it has already run, which is one fewer piece of state
   * that can be wrong after a restart.
   */
  ensureDocThread(input: EnsureDocThreadInput): ThreadRecord;
  /** A Ctrl+E thread. The caller mints `span_<12 hex>` and owns the objective decision. */
  createSpanThread(input: CreateSpanThreadInput): ThreadRecord;
  /**
   * Record which agent a private thread belongs to. The turns live in `whispers`; this row exists
   * so `chat:threads` can list the private threads without opening the whisper store.
   */
  registerPrivateThread(input: RegisterPrivateThreadInput): ThreadRecord;
  get(roomId: string, threadId: string): ThreadRecord | null;
  /** Every thread of a room, oldest first — the order the chat column lists them in. */
  forRoom(roomId: string): ThreadRecord[];
  /**
   * The span thread already anchored to a block, if there is one. The doc-text assessment reuses
   * it rather than minting a second thread every time the learner pauses on the same paragraph.
   */
  forBlock(roomId: string, blockId: string): ThreadRecord | null;
  /** Late-bind the objective: the tree can land after the thread was opened. */
  setObjective(roomId: string, threadId: string, objectiveId: string | null): void;
  resolve(roomId: string, threadId: string, at: string): void;
  /**
   * Delete a registry row. Only for a span thread that was minted for a learner action the actor
   * then refused (`notes:blockAction`'s `busy` / `question_open`), so nothing was ever said in it;
   * an empty thread left behind would sit in the chat column with nothing in it.
   */
  remove(roomId: string, threadId: string): void;
}

function toRecord(row: ThreadRow): ThreadRecord {
  return {
    threadId: row.thread_id,
    roomId: row.room_id,
    docId: row.doc_id,
    kind: row.kind,
    blockId: row.block_id,
    quote: row.span_quote,
    // The column is a free TEXT; anything that is not one of the two agents is read as "no agent"
    // rather than trusted into a typed field.
    agentKey: row.agent_key === 'ellie' || row.agent_key === 'max' ? row.agent_key : null,
    objectiveId: row.objective_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function threadsRepo(db: SqlDatabase): ThreadsRepo {
  const read = (roomId: string, threadId: string): ThreadRow | undefined =>
    plain(
      db
        .prepare('SELECT * FROM notes_threads WHERE room_id = @r AND thread_id = @t')
        .get<ThreadRow>({ r: roomId, t: threadId }),
    );

  /**
   * One insert for all three kinds. `ON CONFLICT DO UPDATE` refreshes only the columns a later
   * call can legitimately know better — the doc id (the ingest may have finished since) and the
   * objective (the tree may have landed since) — and never `created_at`, `block_id` or the quote,
   * because those are what the thread *is*.
   */
  const upsert = (row: {
    threadId: string;
    roomId: string;
    docId: string | null;
    kind: ThreadKind;
    blockId: string | null;
    quote: string | null;
    agentKey: string | null;
    objectiveId: string | null;
    now: string;
  }): ThreadRecord => {
    db.prepare(
      `INSERT INTO notes_threads
         (thread_id, room_id, doc_id, kind, block_id, span_quote, agent_key, objective_id, created_at)
       VALUES (@t, @r, @doc, @kind, @block, @quote, @agent, @objective, @now)
       ON CONFLICT (room_id, thread_id) DO UPDATE SET
         doc_id = COALESCE(@doc, doc_id),
         objective_id = COALESCE(@objective, objective_id)`,
    ).run({
      t: row.threadId,
      r: row.roomId,
      doc: row.docId,
      kind: row.kind,
      block: row.blockId,
      quote: row.quote,
      agent: row.agentKey,
      objective: row.objectiveId,
      now: row.now,
    });
    return toRecord(read(row.roomId, row.threadId)!);
  };

  return {
    ensureDocThread(input) {
      return upsert({
        threadId: input.threadId,
        roomId: input.roomId,
        docId: input.docId,
        kind: 'doc',
        blockId: null,
        quote: null,
        agentKey: null,
        objectiveId: null,
        now: input.now,
      });
    },

    createSpanThread(input) {
      return upsert({
        threadId: input.threadId,
        roomId: input.roomId,
        docId: input.docId,
        kind: 'span',
        blockId: input.blockId,
        quote: input.quote,
        agentKey: null,
        objectiveId: input.objectiveId ?? null,
        now: input.now,
      });
    },

    registerPrivateThread(input) {
      return upsert({
        threadId: input.threadId,
        roomId: input.roomId,
        docId: input.docId,
        kind: 'private',
        blockId: null,
        quote: null,
        agentKey: input.agentKey,
        objectiveId: null,
        now: input.now,
      });
    },

    get(roomId, threadId) {
      const row = read(roomId, threadId);
      return row ? toRecord(row) : null;
    },

    forRoom(roomId) {
      return plainAll(
        db
          .prepare('SELECT * FROM notes_threads WHERE room_id = @r ORDER BY created_at, thread_id')
          .all<ThreadRow>({ r: roomId }),
      ).map(toRecord);
    },

    forBlock(roomId, blockId) {
      // Oldest wins: if a block somehow carries two span threads, the learner's first question
      // about it is the one their highlight still points at.
      const row = plain(
        db
          .prepare(
            `SELECT * FROM notes_threads
              WHERE room_id = @r AND block_id = @b AND kind = 'span'
              ORDER BY created_at, thread_id LIMIT 1`,
          )
          .get<ThreadRow>({ r: roomId, b: blockId }),
      );
      return row ? toRecord(row) : null;
    },

    setObjective(roomId, threadId, objectiveId) {
      db.prepare(
        'UPDATE notes_threads SET objective_id = @o WHERE room_id = @r AND thread_id = @t',
      ).run({ o: objectiveId, r: roomId, t: threadId });
    },

    resolve(roomId, threadId, at) {
      db.prepare(
        'UPDATE notes_threads SET resolved_at = @at WHERE room_id = @r AND thread_id = @t',
      ).run({ at, r: roomId, t: threadId });
    },

    remove(roomId, threadId) {
      db.prepare('DELETE FROM notes_threads WHERE room_id = @r AND thread_id = @t').run({ r: roomId, t: threadId });
    },
  };
}
