/**
 * The notes-doc repository (#48, migration 020).
 *
 * Five tables, one document at a time: the ProseMirror JSON and its ingest state, the agent
 * edits and what became of them, the suggestions a guard rejection turned into, and the cached
 * objective→block mapping. Everything here is synchronous and does **no policy** — what a window
 * is, when a doc may be re-ingested and what an edit means all live in `src/main/notes/`; this
 * file decides only where a row goes.
 *
 * **Keyed on the bytes.** `content_sha` is the unique key and `file_id` is provenance, because a
 * rescan re-mints `files.id` (#39) and a learner who moved their deck must not lose their notes.
 * `file_id` is still *written* on every save, so the newest id is the one a `notes:get` by file
 * will find.
 *
 * **Saving is optimistic.** The renderer is the live authority on an open document and main
 * persists what it sends; two writers (a learner typing, an ingest window landing) means the
 * version has to be checked rather than assumed. `save()` with a stale `baseVersion` returns the
 * stored document instead of overwriting it, and the renderer rebases onto that.
 *
 * This repo is deliberately **not** on `LocalStore`: `src/main/db/store.ts` is frozen for the
 * parallel build, so the notes modules construct it straight from `host.db`. It is a file-scoped
 * repository like `objectives`, not part of the room's `Store` port, so nothing in `src/room`
 * loses anything by its absence.
 */
import type { SqlDatabase } from '../driver.js';
import { bind, plain, plainAll } from '../sql.js';
import type {
  AgentAuthor,
  AgentDocOp,
  DocEditCause,
  DocEditRecord,
  DocEditStatus,
  NotesIngestStatus,
  Suggestion,
} from '../../../shared/doc/types.js';

/** The ingest statuses a row may actually hold. `none` is the *absence* of a row, not a value. */
export type StoredIngestStatus = Exclude<NotesIngestStatus, 'none'>;

/**
 * What survives a killed window or an app quit (`ingest_state`, migration 020).
 *
 * The plan is stored, not recomputed, so a resume produces the same windows as the run that was
 * interrupted even if the window arithmetic is tuned between the two.
 */
export interface NotesIngestState {
  /** The page windows, 1-based inclusive, in order. */
  windows: { from: number; to: number }[];
  /** How many of them have landed. The next call is `windows[done]`. */
  done: number;
  /** The last block of the last landed window: where the next one appends. */
  lastBlockId: string | null;
  /** The running outline the model is given so window 5 knows what window 1 called things. */
  outlineSoFar: string;
}

/** One `notes_docs` row, parsed. `doc` is the ProseMirror JSON, read and written whole. */
export interface NotesDocRecord {
  id: string;
  contentSha: string;
  fileId: string | null;
  title: string;
  pageCount: number;
  version: number;
  doc: unknown;
  ingestStatus: StoredIngestStatus;
  ingestVersion: number;
  windowsDone: number;
  windowsTotal: number;
  withImages: boolean;
  ingestState: NotesIngestState | null;
  model: string;
  error: string | null;
  frozen: boolean;
  learnerTouched: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocInput {
  id: string;
  contentSha: string;
  fileId: string | null;
  title: string;
  pageCount: number;
  doc: unknown;
  ingestStatus: StoredIngestStatus;
  ingestVersion: number;
  windowsTotal: number;
  withImages: boolean;
  model: string;
}

/** Everything the ingest moves between windows. Every field optional: a patch, not a row. */
export interface IngestPatch {
  status?: StoredIngestStatus;
  windowsDone?: number;
  windowsTotal?: number;
  withImages?: boolean;
  ingestState?: NotesIngestState | null;
  model?: string;
  error?: string | null;
}

export interface InsertEditInput {
  editId: string;
  docId: string;
  roomId: string | null;
  author: AgentAuthor;
  cause: DocEditCause;
  ops: AgentDocOp[];
  why: string;
  blockIds: string[];
  turnId: string | null;
  messageId: string | null;
  objectiveId: string | null;
  docVersion: number;
  createdAt: string;
}

/** `pending` is a sixth status the shared type does not carry: an edit main emitted and has
 *  not heard back about. `NotesDocView.edits` never shows one — it is a log entry, not a chrome. */
export type StoredEditStatus = DocEditStatus | 'pending';

export interface StoredDocEdit extends Omit<DocEditRecord, 'status'> {
  roomId: string | null;
  status: StoredEditStatus;
}

export interface ObjectiveBlockRow {
  objectiveId: string;
  blockId: string;
  ord: number;
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; version: number; doc: unknown };

export interface NotesRepo {
  /** The doc for these bytes, or null. The only lookup the ingest and `notes:get` use. */
  byContentSha(contentSha: string): NotesDocRecord | null;
  byId(docId: string): NotesDocRecord | null;
  create(input: CreateDocInput, now: string): NotesDocRecord;
  /**
   * Optimistic save. A `baseVersion` that is not the stored one comes back as a conflict with
   * the stored document, and nothing is written.
   */
  save(
    input: { docId: string; baseVersion: number; doc: unknown; learnerTouched?: boolean },
    now: string,
  ): SaveResult;
  /**
   * An ingest window's append. Unconditional and version-bumping: a window only ever appends
   * after the previous window's last block (brief §2, architect E9), so it cannot collide with a
   * learner who is editing higher up, and it must not be refused for being a version behind.
   */
  appendWindow(
    input: { docId: string; doc: unknown; ingest: IngestPatch },
    now: string,
  ): NotesDocRecord;
  setIngest(docId: string, patch: IngestPatch, now: string): NotesDocRecord | null;
  setFrozen(docId: string, frozen: boolean, now: string): boolean;
  /** 009's `segments_touched` rule: once set, an ingest never runs over this doc without force. */
  markLearnerTouched(docId: string, now: string): void;
  /** Regenerate: the row is kept (its id is referenced by edits and outcomes), its doc replaced. */
  resetForIngest(
    input: { docId: string; doc: unknown; title: string; pageCount: number; fileId: string | null;
             ingestVersion: number; windowsTotal: number; withImages: boolean; model: string },
    now: string,
  ): NotesDocRecord;

  insertEdit(input: InsertEditInput): void;
  resolveEdit(
    input: { docId: string; editId: string; status: DocEditStatus; blockIds: string[]; docVersion: number },
    now: string,
  ): void;
  /** Every edit on the doc, newest last. `status` narrows it — `applied` is what wears a colour. */
  edits(docId: string, status?: StoredEditStatus): StoredDocEdit[];

  upsertSuggestion(suggestion: Suggestion): void;
  resolveSuggestion(
    input: { docId: string; suggestionId: string; status: 'accepted' | 'rejected' },
    now: string,
  ): void;
  suggestions(docId: string, status?: Suggestion['status']): Suggestion[];

  /** Replace the whole mapping for a doc. It is a cache of a pure function; a diff would lie. */
  replaceObjectiveBlocks(docId: string, rows: readonly ObjectiveBlockRow[]): void;
  objectiveBlocks(docId: string): ObjectiveBlockRow[];

  /**
   * **Regenerate Notes** (2026-09-23): the chrome that points into the old document goes with it.
   * Agent edits still wearing their colour (or never applied) and open suggestions address block
   * ids the new ingest will not have, so they are deleted; edits and suggestions the learner
   * already decided are history and stay. The objective→block map is a cache and is emptied.
   * Returns what was cleared, for the log.
   */
  clearForRegenerate(docId: string): { edits: number; suggestions: number };
}

interface DocRow {
  id: string;
  content_sha: string;
  file_id: string | null;
  title: string;
  page_count: number;
  version: number;
  doc_json: string;
  ingest_status: StoredIngestStatus;
  ingest_version: number;
  windows_done: number;
  windows_total: number;
  with_images: number;
  ingest_state: string | null;
  model: string;
  error: string | null;
  frozen: number;
  learner_touched: number;
  created_at: string;
  updated_at: string;
}

interface EditRow {
  edit_id: string;
  doc_id: string;
  room_id: string | null;
  author: AgentAuthor;
  cause: DocEditCause;
  ops_json: string;
  why: string;
  status: StoredEditStatus;
  block_ids: string;
  turn_id: string | null;
  message_id: string | null;
  objective_id: string | null;
  doc_version: number;
  created_at: string;
  resolved_at: string | null;
}

interface SuggestionRow {
  suggestion_id: string;
  doc_id: string;
  edit_id: string;
  author: AgentAuthor;
  block_id: string;
  status: Suggestion['status'];
  note: string | null;
  thread_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * A document whose JSON will not parse is a document that has to be ingested again, not a crash
 * on the way to drawing the editor. The same judgement `objectives.parseObjectives` makes.
 */
function parseJson<T>(json: string | null, fallback: T): T {
  if (json === null) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: DocRow): NotesDocRecord {
  return {
    id: row.id,
    contentSha: row.content_sha,
    fileId: row.file_id,
    title: row.title,
    pageCount: row.page_count,
    version: row.version,
    doc: parseJson<unknown>(row.doc_json, null),
    ingestStatus: row.ingest_status,
    ingestVersion: row.ingest_version,
    windowsDone: row.windows_done,
    windowsTotal: row.windows_total,
    withImages: row.with_images === 1,
    ingestState: parseJson<NotesIngestState | null>(row.ingest_state, null),
    model: row.model,
    error: row.error,
    frozen: row.frozen === 1,
    learnerTouched: row.learner_touched === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEdit(row: EditRow): StoredDocEdit {
  return {
    editId: row.edit_id,
    docId: row.doc_id,
    roomId: row.room_id,
    author: row.author,
    cause: row.cause,
    ops: parseJson<AgentDocOp[]>(row.ops_json, []),
    status: row.status,
    blockIds: parseJson<string[]>(row.block_ids, []),
    why: row.why,
    turnId: row.turn_id,
    messageId: row.message_id,
    objectiveId: row.objective_id,
    docVersion: row.doc_version,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function toSuggestion(row: SuggestionRow): Suggestion {
  return {
    suggestionId: row.suggestion_id,
    docId: row.doc_id,
    editId: row.edit_id,
    author: row.author,
    blockId: row.block_id,
    status: row.status,
    note: row.note,
    threadId: row.thread_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function notesRepo(db: SqlDatabase): NotesRepo {
  const read = (docId: string): DocRow | undefined =>
    plain(db.prepare('SELECT * FROM notes_docs WHERE id = @id').get<DocRow>({ id: docId }));

  /** The patch columns an `IngestPatch` touches, as SQL parameters. Absent fields stay put. */
  const ingestColumns = (patch: IngestPatch): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (patch.status !== undefined) out.ingest_status = patch.status;
    if (patch.windowsDone !== undefined) out.windows_done = patch.windowsDone;
    if (patch.windowsTotal !== undefined) out.windows_total = patch.windowsTotal;
    if (patch.withImages !== undefined) out.with_images = patch.withImages ? 1 : 0;
    if (patch.ingestState !== undefined) {
      out.ingest_state = patch.ingestState === null ? null : JSON.stringify(patch.ingestState);
    }
    if (patch.model !== undefined) out.model = patch.model;
    if (patch.error !== undefined) out.error = patch.error;
    return out;
  };

  const patchDoc = (docId: string, columns: Record<string, unknown>, now: string): NotesDocRecord | null => {
    const params = bind({ ...columns, updated_at: now });
    const cols = Object.keys(params);
    db.prepare(
      `UPDATE notes_docs SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id`,
    ).run({ ...params, __id: docId });
    const row = read(docId);
    return row ? toRecord(row) : null;
  };

  return {
    byContentSha(contentSha) {
      const row = plain(
        db.prepare('SELECT * FROM notes_docs WHERE content_sha = @sha').get<DocRow>({ sha: contentSha }),
      );
      return row ? toRecord(row) : null;
    },

    byId(docId) {
      const row = read(docId);
      return row ? toRecord(row) : null;
    },

    create(input, now) {
      db.prepare(
        `INSERT INTO notes_docs
           (id, content_sha, file_id, title, page_count, version, doc_json, ingest_status,
            ingest_version, windows_done, windows_total, with_images, ingest_state, model, error,
            frozen, learner_touched, created_at, updated_at)
         VALUES (@id, @sha, @file, @title, @pages, 1, @doc, @status, @iv, 0, @total, @images,
                 NULL, @model, NULL, 0, 0, @now, @now)`,
      ).run(
        bind({
          id: input.id,
          sha: input.contentSha,
          file: input.fileId,
          title: input.title,
          pages: input.pageCount,
          doc: JSON.stringify(input.doc),
          status: input.ingestStatus,
          iv: input.ingestVersion,
          total: input.windowsTotal,
          images: input.withImages ? 1 : 0,
          model: input.model,
          now,
        }),
      );
      return toRecord(read(input.id)!);
    },

    save(input, now) {
      const row = read(input.docId);
      if (!row) throw new Error('That notes document does not exist.');
      if (row.version !== input.baseVersion) {
        // The renderer is a version behind — an ingest window landed, or another window is
        // still arriving. Hand back what is stored; the renderer rebases and saves again.
        return { ok: false, conflict: true, version: row.version, doc: parseJson<unknown>(row.doc_json, null) };
      }
      const version = row.version + 1;
      db.prepare(
        `UPDATE notes_docs
            SET doc_json = @doc, version = @version, updated_at = @now,
                learner_touched = CASE WHEN @touched = 1 THEN 1 ELSE learner_touched END
          WHERE id = @id`,
      ).run(
        bind({
          doc: JSON.stringify(input.doc),
          version,
          now,
          touched: input.learnerTouched === true ? 1 : 0,
          id: input.docId,
        }),
      );
      return { ok: true, version };
    },

    appendWindow(input, now) {
      const row = read(input.docId);
      if (!row) throw new Error('That notes document does not exist.');
      db.prepare(
        'UPDATE notes_docs SET doc_json = @doc, version = version + 1, updated_at = @now WHERE id = @id',
      ).run(bind({ doc: JSON.stringify(input.doc), now, id: input.docId }));
      const columns = ingestColumns(input.ingest);
      const updated = Object.keys(columns).length > 0 ? patchDoc(input.docId, columns, now) : null;
      return updated ?? toRecord(read(input.docId)!);
    },

    setIngest(docId, patch, now) {
      const columns = ingestColumns(patch);
      if (Object.keys(columns).length === 0) {
        const row = read(docId);
        return row ? toRecord(row) : null;
      }
      return patchDoc(docId, columns, now);
    },

    setFrozen(docId, frozen, now) {
      db.prepare('UPDATE notes_docs SET frozen = @f, updated_at = @now WHERE id = @id').run(
        bind({ f: frozen ? 1 : 0, now, id: docId }),
      );
      const row = read(docId);
      return row ? row.frozen === 1 : frozen;
    },

    markLearnerTouched(docId, now) {
      db.prepare('UPDATE notes_docs SET learner_touched = 1, updated_at = @now WHERE id = @id').run(
        bind({ now, id: docId }),
      );
    },

    resetForIngest(input, now) {
      db.prepare(
        `UPDATE notes_docs
            SET doc_json = @doc, title = @title, page_count = @pages, file_id = @file,
                version = version + 1, ingest_status = 'pending', ingest_version = @iv,
                windows_done = 0, windows_total = @total, with_images = @images,
                ingest_state = NULL, model = @model, error = NULL, learner_touched = 0,
                updated_at = @now
          WHERE id = @id`,
      ).run(
        bind({
          doc: JSON.stringify(input.doc),
          title: input.title,
          pages: input.pageCount,
          file: input.fileId,
          iv: input.ingestVersion,
          total: input.windowsTotal,
          images: input.withImages ? 1 : 0,
          model: input.model,
          now,
          id: input.docId,
        }),
      );
      return toRecord(read(input.docId)!);
    },

    insertEdit(input) {
      db.prepare(
        `INSERT INTO notes_doc_edits
           (edit_id, doc_id, room_id, author, cause, ops_json, why, status, block_ids, turn_id,
            message_id, objective_id, doc_version, created_at, resolved_at)
         VALUES (@edit, @doc, @room, @author, @cause, @ops, @why, 'pending', @blocks, @turn,
                 @message, @objective, @version, @now, NULL)`,
      ).run(
        bind({
          edit: input.editId,
          doc: input.docId,
          room: input.roomId,
          author: input.author,
          cause: input.cause,
          ops: JSON.stringify(input.ops),
          why: input.why,
          blocks: JSON.stringify(input.blockIds),
          turn: input.turnId,
          message: input.messageId,
          objective: input.objectiveId,
          version: input.docVersion,
          now: input.createdAt,
        }),
      );
    },

    resolveEdit(input, now) {
      db.prepare(
        `UPDATE notes_doc_edits
            SET status = @status, block_ids = @blocks, doc_version = @version, resolved_at = @now
          WHERE doc_id = @doc AND edit_id = @edit`,
      ).run(
        bind({
          status: input.status,
          blocks: JSON.stringify(input.blockIds),
          version: input.docVersion,
          now,
          doc: input.docId,
          edit: input.editId,
        }),
      );
    },

    edits(docId, status) {
      const rows = status
        ? db
            .prepare('SELECT * FROM notes_doc_edits WHERE doc_id = @doc AND status = @s ORDER BY created_at, rowid')
            .all<EditRow>({ doc: docId, s: status })
        : db
            .prepare('SELECT * FROM notes_doc_edits WHERE doc_id = @doc ORDER BY created_at, rowid')
            .all<EditRow>({ doc: docId });
      return plainAll(rows).map(toEdit);
    },

    upsertSuggestion(suggestion) {
      db.prepare(
        `INSERT INTO notes_suggestions
           (suggestion_id, doc_id, edit_id, author, block_id, status, note, thread_id, created_at, resolved_at)
         VALUES (@id, @doc, @edit, @author, @block, @status, @note, @thread, @created, @resolved)
         ON CONFLICT (suggestion_id) DO UPDATE SET
           block_id = @block, status = @status, note = @note, thread_id = @thread, resolved_at = @resolved`,
      ).run(
        bind({
          id: suggestion.suggestionId,
          doc: suggestion.docId,
          edit: suggestion.editId,
          author: suggestion.author,
          block: suggestion.blockId,
          status: suggestion.status,
          note: suggestion.note,
          thread: suggestion.threadId,
          created: suggestion.createdAt,
          resolved: suggestion.resolvedAt,
        }),
      );
    },

    resolveSuggestion(input, now) {
      db.prepare(
        `UPDATE notes_suggestions SET status = @status, resolved_at = @now
          WHERE doc_id = @doc AND suggestion_id = @id`,
      ).run(bind({ status: input.status, now, doc: input.docId, id: input.suggestionId }));
    },

    suggestions(docId, status) {
      const rows = status
        ? db
            .prepare('SELECT * FROM notes_suggestions WHERE doc_id = @doc AND status = @s ORDER BY created_at, rowid')
            .all<SuggestionRow>({ doc: docId, s: status })
        : db
            .prepare('SELECT * FROM notes_suggestions WHERE doc_id = @doc ORDER BY created_at, rowid')
            .all<SuggestionRow>({ doc: docId });
      return plainAll(rows).map(toSuggestion);
    },

    replaceObjectiveBlocks(docId, rows) {
      db.prepare('DELETE FROM notes_objective_blocks WHERE doc_id = @doc').run({ doc: docId });
      const stmt = db.prepare(
        `INSERT INTO notes_objective_blocks (doc_id, objective_id, block_id, ord)
         VALUES (@doc, @objective, @block, @ord)
         ON CONFLICT (doc_id, objective_id, block_id) DO UPDATE SET ord = @ord`,
      );
      for (const row of rows) {
        stmt.run(bind({ doc: docId, objective: row.objectiveId, block: row.blockId, ord: row.ord }));
      }
    },

    clearForRegenerate(docId) {
      db.exec('BEGIN');
      try {
        const edits = db
          .prepare(`DELETE FROM notes_doc_edits WHERE doc_id = @doc AND status IN ('pending', 'applied')`)
          .run({ doc: docId });
        const suggestions = db
          .prepare(`DELETE FROM notes_suggestions WHERE doc_id = @doc AND status = 'open'`)
          .run({ doc: docId });
        db.prepare('DELETE FROM notes_objective_blocks WHERE doc_id = @doc').run({ doc: docId });
        db.exec('COMMIT');
        return { edits: edits.changes, suggestions: suggestions.changes };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    objectiveBlocks(docId) {
      return plainAll(
        db
          .prepare(
            'SELECT objective_id, block_id, ord FROM notes_objective_blocks WHERE doc_id = @doc ORDER BY objective_id, ord',
          )
          .all<{ objective_id: string; block_id: string; ord: number }>({ doc: docId }),
      ).map((r) => ({ objectiveId: r.objective_id, blockId: r.block_id, ord: r.ord }));
    },
  };
}

/** `doc_<12 hex>`, the id shape migration 020's comment specifies. */
export function newDocId(): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return `doc_${out}`;
}
