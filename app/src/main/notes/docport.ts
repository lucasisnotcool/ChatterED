/**
 * **The actor's `DocPort`, over the stored notes document** (#48, `room/docport.ts`).
 *
 * `src/room` may not import SQLite or ProseMirror's view, so the document reaches the actor as
 * this narrow port: an outline of blocks in, `AgentDocOpBatch`es naming block ids out. What it
 * reads is the **last saved** document — the renderer is the live authority while the file is
 * open and main persists what it sends, so this is at most a debounce behind. That is deliberate
 * and it is safe, because every op addresses a `blockId` and a block id outlives an edit.
 *
 * Two things it does beyond reading:
 *
 *  - **`recordEdit` writes the edit as `pending` before it is emitted**, so an edit the renderer
 *    never reports on is still in the log. `notes:editResolved` moves it to `applied`, `kept`,
 *    `removed`, `dropped_frozen` or `rejected_guard`.
 *  - **`recordOutcome` writes one `quiz_outcomes` row** and then tells its subscribers. It emits
 *    nothing itself: the progress bar is a pure function of these rows and T6 owns recomputing
 *    and pushing it. `subscribeOutcomes` is that seam — see below.
 *
 * The parsed document is cached per version: `outlineNear` is called on every agent turn, and
 * re-parsing a 66-page document through `docFromJson` for each one would put a measurable cost
 * on the path the learner is watching.
 */
import type { Node } from 'prosemirror-model';
import type { DocPort } from '../../room/docport.js';
import { NO_DOC } from '../../room/docport.js';
import type { OutlineEntry, QuizOutcome } from '../../shared/doc/types.js';
import { blocksForPages, docFromJson, docOutline, docOutlineNear, eachBlock } from '../../shared/doc/schema.js';
import type { DocHost } from '../dochost.js';
import { notesRepo, type NotesDocRecord, type NotesRepo } from '../db/repos/notes.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { activityRepo } from '../db/repos/activity.js';
import { log } from '../log.js';

/**
 * **The outcome seam** (#48).
 *
 * `recordOutcome` is called from inside an actor turn, which knows nothing about files or
 * progress views; the progress bar is T6's and is recomputed from `quiz_outcomes`. Rather than
 * either track editing the other's files, this port announces each stored outcome and T6
 * subscribes — it maps `roomId` to a file and emits `progress.updated`.
 *
 * Module level, not per port: one app, one database, and a room is opened and closed many times
 * in a sitting while the subscriber lives for the process.
 */
const outcomeSubscribers = new Set<(outcome: QuizOutcome) => void>();

/** Subscribe to every quiz outcome as it is stored. Returns the unsubscribe. */
export function subscribeOutcomes(fn: (outcome: QuizOutcome) => void): () => void {
  outcomeSubscribers.add(fn);
  return () => {
    outcomeSubscribers.delete(fn);
  };
}

function announceOutcome(outcome: QuizOutcome): void {
  for (const fn of outcomeSubscribers) {
    try {
      fn(outcome);
    } catch (err) {
      // A subscriber that throws must not take down the turn that earned the outcome; the row
      // is already written and the bar can still be pulled.
      log().warn('notes.outcome.subscriber_failed', {
        question_id: outcome.questionId,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * **The activity seam** (2026-10-06, D2): an Explain or Example press moves what the progress view
 * reports for readiness, so its subscribers are told as an outcome's are.
 */
const activitySubscribers = new Set<(press: { roomId: string }) => void>();

/** Subscribe to every Explain/Example press as it is stored. Returns the unsubscribe. */
export function subscribeActivity(fn: (press: { roomId: string }) => void): () => void {
  activitySubscribers.add(fn);
  return () => {
    activitySubscribers.delete(fn);
  };
}

function announceActivity(press: { roomId: string }): void {
  for (const fn of activitySubscribers) {
    try {
      fn(press);
    } catch (err) {
      log().warn('notes.activity.subscriber_failed', { cause: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** `e_<12 hex>` / `qo_<12 hex>` — the id shapes the rest of the app uses. */
function mintId(prefix: string): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return `${prefix}_${out}`;
}

export interface DocPortFile {
  fileId: string | null;
  contentSha: string | null;
  roomId: string;
}

/**
 * The port for one room. With no `contentSha`, or no document for those bytes, every read is
 * empty and every write is dropped (`NO_DOC`) — a room on a deck nobody has ingested is a room
 * where the agents simply do not edit.
 */
export function createDocPort(host: DocHost, file: DocPortFile): DocPort {
  if (!file.contentSha) return NO_DOC;
  const repo: NotesRepo = notesRepo(host.db);
  const outcomes = outcomesRepo(host.db);
  const activity = activityRepo(host.db);
  const contentSha = file.contentSha;

  /** The parsed document, and the version it was parsed from. */
  let cached: { version: number; doc: Node } | null = null;

  const record = (): NotesDocRecord | null => repo.byContentSha(contentSha);

  const parsed = (row: NotesDocRecord | null): Node | null => {
    if (!row || row.doc === null) return null;
    if (cached && cached.version === row.version) return cached.doc;
    try {
      const doc = docFromJson(row.doc);
      cached = { version: row.version, doc };
      return doc;
    } catch (err) {
      // A stored document that will not parse is a document the actor cannot address; it is not
      // a reason to fail the turn. The agents fall silent on the doc and keep talking.
      log().error('notes.docport.unparseable', {
        doc_id: row.id,
        cause: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  return {
    docId() {
      return record()?.id ?? null;
    },

    frozen() {
      const row = record();
      // No document is the same as frozen for every caller of this: nothing is edited either way.
      return row === null ? true : row.frozen;
    },

    outlineNear(anchor, radius) {
      const doc = parsed(record());
      if (!doc) return [];
      if (anchor.blockId) return docOutlineNear(doc, anchor.blockId, radius);
      /**
       * No block id, but pages: the blocks that carry those pages are where this is about, so
       * the outline is centred on the first of them. It is how a Q block finds the segment it
       * belongs to when all the actor knows is which slide the question came from.
       */
      const pages = anchor.pages ?? [];
      if (pages.length > 0) {
        const ids = blocksForPages(doc, pages);
        if (ids.length > 0) return docOutlineNear(doc, ids[0]!, radius);
      }
      // Neither: the top of the document, which is where a question with no anchor belongs.
      return docOutlineNear(doc, null, radius);
    },

    blocksForPages(pages) {
      const doc = parsed(record());
      return doc ? blocksForPages(doc, pages) : [];
    },

    hasQuestion(questionId) {
      const doc = parsed(record());
      if (!doc) return false;
      let found = false;
      eachBlock(doc, (node) => {
        if (node.type.name === 'q_block' && node.attrs.questionId === questionId) found = true;
      });
      return found;
    },

    recordEdit(input) {
      const row = record();
      if (!row) return;
      repo.insertEdit({
        editId: input.batch.editId,
        docId: row.id,
        roomId: input.roomId,
        author: input.batch.author,
        cause: input.batch.cause,
        ops: input.batch.ops,
        why: input.batch.why,
        // What the batch touched is decided in the renderer, where the guard runs; the row is
        // opened with none and `notes:editResolved` fills them in.
        blockIds: [],
        turnId: input.turnId,
        messageId: input.messageId,
        objectiveId: input.objectiveId,
        docVersion: row.version,
        createdAt: new Date().toISOString(),
      });
    },

    recordOutcome(outcome) {
      const stored: QuizOutcome = {
        ...outcome,
        // Said on every row from migration 023 on, so a reader never has to infer it (§4.5).
        form: outcome.form ?? 'open',
        id: mintId('qo'),
        contentSha,
        createdAt: new Date().toISOString(),
      };
      outcomes.insert(stored);
      // The progress bar is a pure function of these rows, and recomputing it is T6's. This
      // port's job ends at "the row exists, and whoever cares has been told".
      announceOutcome(stored);
    },

    recordActivity(press) {
      activity.insert({ ...press, id: mintId('oa'), contentSha, createdAt: new Date().toISOString() });
      // The same seam as an outcome: the progress view carries the count (D2), so it is pushed again.
      announceActivity({ roomId: press.roomId });
    },
  };
}

/**
 * The outline of the whole document, for the callers that want it (the lesson card's Start, a
 * debug drawer). Not on `DocPort`: the actor is deliberately only ever given a neighbourhood.
 */
export function docOutlineFor(host: DocHost, contentSha: string): OutlineEntry[] {
  const row = notesRepo(host.db).byContentSha(contentSha);
  if (!row || row.doc === null) return [];
  try {
    return docOutline(docFromJson(row.doc));
  } catch {
    return [];
  }
}
