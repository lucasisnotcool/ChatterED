/**
 * The chats' IPC bodies (#48). **Track T6 owns this file** — the lead placed only the hook.
 * Channels: `notes:docText`, `notes:answerQuestion`, `chat:threads`, `chat:send`, `chat:openSpan`, `chat:privateOpen`,
 * `chat:privateSend`, `chat:insertIntoDoc`, `quiz:pass`, `chat:closeFile`. See `app/docs/COLLAB-CONTRACT.md`.
 *
 * **Three things these handlers decide, and the renderer does not.**
 *
 * 1. **When the room exists.** A read never creates one: `chat:threads` on a file nobody has
 *    spoken to returns `{ roomId: null, threads: [] }`, exactly as `notes:get` returns null for a
 *    deck nobody has ingested. A *learner action* creates one — the first chat message, the first
 *    Ctrl+E, the first assessed doc text, a lesson card's Start — which is the flow's own rule
 *    (`flowAskHere` has created the room since `flow-build-plan.md` §3.3) carried over intact.
 * 2. **What the model is shown.** The renderer says *which thread*; main resolves the passage.
 *    For the doc chat that is the whole deck (§4.1: the doc chat is the file's shared thread); for
 *    a span thread it is the pages its block came from, which is the collab doc's replacement for
 *    the segment a flow thread hung off. The renderer has no authority over what the agents read,
 *    and this is where that is enforced.
 * 3. **Whether a pause in the document is an attempt.** `doctext.ts`, in code, before any model
 *    call.
 *
 * Private threads never reach the document except through `chat:insertIntoDoc` (§4.1). Nothing in
 * this file writes to the doc; the actor does, through T1's `DocPort`.
 */

import { DOC_ANCHOR_ID, SPAN_THREAD_PREFIX } from '../../shared/doc/types.js';
import type { AgentAuthor, ChatResetResult, ChatView, ThreadView } from '../../shared/doc/types.js';
import type { NotesAnswerQuestionInput, NotesAnswerQuestionResult } from '../../shared/ipc.js';
import { referenceContext, saveFlowState } from '../flowroom.js';
import type { ReferenceContext } from '../../room/reference.js';
import type { RoomActor } from '../../room/actor.js';
import { segmentContext } from '../../room/reference.js';
import { newId } from '../sessions.js';
import type { DocHost, IpcHandle } from '../dochost.js';
import { threadsRepo, type ThreadRecord } from '../db/repos/threads.js';
import { actorHas, docActor, requireActorMethod, type DocActor } from './actorport.js';
import { notesDocRow, objectiveForBlock, openNotesDoc, pagesForBlock } from './doc.js';
import { docTextGate, docTextHash } from './doctext.js';
import { emitProgress } from './progress.js';

/** How much of a highlighted span is kept as the thread's label and chip. */
const QUOTE_CAP = 240;

/** How much of a quote the *where* line names, so `p. 12 — "…"` stays one line. */
const LABEL_CAP = 90;

function cap(text: string, at: number): string {
  const body = text.trim().replace(/\s+/g, ' ');
  return body.length <= at ? body : `${body.slice(0, at - 1)}…`;
}

/**
 * The state two pauses apart have to share (brief §6's "once they pause").
 *
 * Module level, keyed `docId:blockId`, and a **cache**, not the record: the record is the block's
 * last `doc_text` message (`storedDocTextHash`). It used to be the only memory, so a relaunch
 * forgot it; the renderer's watch reads every learner block as freshly changed on load, and every
 * paragraph the learner had ever written was marked again — a second verdict, a second outcome
 * row with a higher `attemptIndex` (read as a revision by `revisionStats`), a second Max turn.
 * Bounded by the number of blocks in one document.
 */
const lastAssessed = new Map<string, string>();
const assessing = new Set<string>();

/**
 * The hash of the text this block was last marked on, from the database, so it survives a
 * relaunch. The carrier is the synthetic learner message `assessDocText` writes into the block's
 * span thread (`kind: 'doc_text'`, body = the verbatim text the gate hashed). Null when the file
 * has no live room — a New Conversation retires the room, and a fresh read after that is right.
 */
async function storedDocTextHash(host: DocHost, fileId: string, blockId: string): Promise<string | null> {
  const room = await host.roomForFile(fileId).catch(() => null);
  if (!room) return null;
  const thread = threadsRepo(host.db).forBlock(room.roomId, blockId);
  if (!thread) return null;
  const row = host.db
    .prepare(
      `SELECT body FROM messages
        WHERE room_id = @room AND anchor_id = @anchor AND kind = 'doc_text'
        ORDER BY seq DESC LIMIT 1`,
    )
    .get<{ body: string }>({ room: room.roomId, anchor: thread.threadId });
  return row ? docTextHash(row.body.trim()) : null;
}

/** Test seam: forget what has been assessed. */
export function resetDocTextState(): void {
  lastAssessed.clear();
  assessing.clear();
}

/** The material a room was opened on: where the deck's outline and its file id are kept. */
function materialFor(host: DocHost, roomId: string): { fileId: string | null; outline: string } {
  const room = host.store.rooms.get(roomId);
  const material = room ? host.store.materials.get(room.material_id) : null;
  return { fileId: material?.file_id ?? null, outline: material?.outline ?? '' };
}

/**
 * What one turn in one thread is answered from.
 *
 * The doc chat is deck-scoped: §4.1 calls it "the shared thread for the open file", and a question
 * typed into it is about the notes, which are the whole deck. A span thread is page-scoped, and
 * its pages come from the **block** the span sits in (`notes_threads.block_id` → the doc's block →
 * its `pages`), which is the collab doc's answer to the segment a flow thread used to hang off.
 *
 * Failures are swallowed, as `AppService.#askContextFor` swallows them: a turn that cannot resolve
 * its page is still a turn, and losing the *where* line is better than losing the answer.
 */
async function contextFor(
  host: DocHost,
  input: { roomId: string; fileId: string; thread: ThreadRecord | null; question: string },
): Promise<ReferenceContext | null> {
  try {
    const { outline } = materialFor(host, input.roomId);
    const thread = input.thread;

    if (thread && thread.kind === 'span' && thread.blockId) {
      const contentSha = await host.fileBytesKey(input.fileId).then(
        (k) => k.contentSha,
        () => null,
      );
      const opened = openNotesDoc(host.db, { contentSha, fileId: input.fileId });
      const pages = pagesForBlock(opened?.doc ?? null, thread.blockId);
      if (pages.length > 0) {
        const from = Math.min(...pages);
        const to = Math.max(...pages);
        const text = await host.vault.textFor({ fileId: input.fileId, pageFrom: from, pageTo: to });
        return segmentContext({
          text,
          page: from,
          outline,
          // The learner's own highlight is the honest label for where they are — the notes have
          // no segment labels, and `whereBlock` renders this as `p. 12 — "…"`.
          label: thread.quote ? cap(thread.quote, LABEL_CAP) : null,
        });
      }
      // A block with no pages (bridging material the ingest wrote itself) falls through to the
      // deck rather than being answered from page 1 by accident.
    }

    return await referenceContext(
      { segments: host.segments, vault: host.vault },
      { fileId: input.fileId, segmentId: null, question: input.question, scope: 'deck', outline },
    );
  } catch {
    return null;
  }
}

/** The registry row and the actor's view of one thread, merged into the renderer's `ThreadView`. */
function mergeThread(host: DocHost, roomId: string, record: ThreadRecord, fromActor: ThreadView | undefined): ThreadView {
  // The registry owns what a thread *is*; the actor owns what has been said in it. Where both
  // have a field, the owner wins — two copies of one fact is two things that can disagree.
  const messageIds =
    fromActor?.messageIds ??
    (record.kind === 'private'
      ? []
      : host.store.messages.forAnchor(roomId, record.threadId).map((m) => m.id));
  return {
    threadId: record.threadId,
    kind: record.kind,
    blockId: record.blockId,
    quote: record.quote,
    agentKey: record.agentKey,
    messageIds,
    lastSeenSeq: fromActor?.lastSeenSeq ?? 0,
    quiz: fromActor?.quiz ?? null,
    createdAt: record.createdAt,
  };
}

export function registerDocRoomIpc(host: DocHost, handle: IpcHandle): void {
  const threads = () => threadsRepo(host.db);
  const now = () => new Date().toISOString();

  const docIdFor = async (fileId: string): Promise<string | null> => {
    const contentSha = await host.fileBytesKey(fileId).then(
      (k) => k.contentSha,
      () => null,
    );
    return notesDocRow(host.db, { contentSha, fileId })?.docId ?? null;
  };

  /**
   * Every thread on the file's room.
   *
   * **A read, so it never creates a room.** Before the first message this returns
   * `{ roomId: null, threads: [] }`; T5's store must render the empty doc chat from that rather
   * than waiting for a thread row to exist.
   */
  handle<{ fileId: string }>('chat:threads', async (input): Promise<ChatView> => {
    const room = await host.roomForFile(input.fileId);
    if (!room) return { roomId: null, fileId: input.fileId, threads: [] };

    const target = docActor(room.actor);
    const fromActor = new Map<string, ThreadView>(
      (actorHas(target, 'docThreads') ? target.docThreads() : []).map((t) => [t.threadId, t]),
    );

    const registry = threads().forRoom(room.roomId);
    const merged = registry.map((record) => mergeThread(host, room.roomId, record, fromActor.get(record.threadId)));
    // A thread the actor knows about and the registry does not (a room from before this build,
    // or a private thread the actor opened directly) is still the learner's conversation.
    for (const [threadId, view] of fromActor) {
      if (!merged.some((t) => t.threadId === threadId)) merged.push(view);
    }

    const docIndex = merged.findIndex((t) => t.threadId === DOC_ANCHOR_ID);
    if (docIndex > 0) merged.unshift(...merged.splice(docIndex, 1));
    return { roomId: room.roomId, fileId: input.fileId, threads: merged };
  });

  /**
   * A learner turn. **This creates the room on the first message**, as `flowAskHere` always has:
   * there is no setup screen, and the document is the thing the conversation is about.
   */
  handle<{ fileId: string; threadId?: string; text: string }>('chat:send', async (input) => {
    const threadId = input.threadId?.trim() || DOC_ANCHOR_ID;
    const { roomId, actor } = await host.openFlowRoom(input.fileId);
    const repo = threads();
    const docId = await docIdFor(input.fileId);

    // The doc chat is ensured on every message rather than on room creation: a room can exist
    // from an older build, and an idempotent upsert is cheaper than a migration.
    const thread =
      threadId === DOC_ANCHOR_ID
        ? repo.ensureDocThread({ roomId, docId, threadId, now: now() })
        : repo.get(roomId, threadId);

    const context = await contextFor(host, { roomId, fileId: input.fileId, thread, question: input.text });
    const target = docActor(actor);
    try {
      await target.sendMessage(input.text, threadId, context ?? undefined);
    } finally {
      host.persistFlow();
    }
    return { roomId, threadId };
  });

  /**
   * Highlight + Ctrl+E (brief §3).
   *
   * A new thread per press, anchored to the block and carrying the learner's selection verbatim —
   * the highlight in the doc is what jumps to it, so the quote has to be what they actually
   * highlighted and not a normalisation of it.
   *
   * The objective is resolved **here**, once, from the block's pages: a span thread that turns out
   * to be about an objective is how a question the learner asked can end up filling the bar. When
   * the pages are taught by two objectives, or by none, it stays null rather than being guessed.
   */
  handle<{ fileId: string; blockId: string; quote: string; question: string }>(
    'chat:openSpan',
    async (input) => {
      // `blockId: ''` is T2's "not minted yet", not a name. A thread anchored to it would match
      // every un-minted block in the document, so it is refused before a room is created.
      if (!input.blockId) throw new Error('chat:openSpan needs a minted blockId');
      const { roomId, actor } = await host.openFlowRoom(input.fileId);
      const contentSha = await host.fileBytesKey(input.fileId).then(
        (k) => k.contentSha,
        () => null,
      );
      const opened = openNotesDoc(host.db, { contentSha, fileId: input.fileId });
      const objectiveId = objectiveForBlock(host.objectivesTree(input.fileId), opened?.doc ?? null, input.blockId);

      const threadId = newId(SPAN_THREAD_PREFIX.replace(/_$/, ''));
      const thread = threads().createSpanThread({
        roomId,
        docId: opened?.row.docId ?? null,
        threadId,
        blockId: input.blockId,
        quote: cap(input.quote, QUOTE_CAP),
        objectiveId,
        now: now(),
      });

      const context = await contextFor(host, {
        roomId,
        fileId: input.fileId,
        thread,
        question: input.question,
      });
      const target = docActor(actor);
      try {
        await target.sendMessage(input.question, threadId, context ?? undefined);
      } finally {
        host.persistFlow();
      }
      return { roomId, threadId };
    },
  );

  /** The private thread with one agent. Its turns live in `whispers`, never in `messages`. */
  handle<{ fileId: string; agent: AgentAuthor }>('chat:privateOpen', async (input) => {
    const { roomId, actor } = await host.openFlowRoom(input.fileId);
    const target = docActor(actor);
    const opened = requireActorMethod(target, 'openPrivate').call(target, input.agent);
    threads().registerPrivateThread({
      roomId,
      docId: await docIdFor(input.fileId),
      threadId: opened.threadId,
      agentKey: input.agent,
      now: now(),
    });
    host.persistFlow();
    return { roomId, ...opened };
  });

  handle<{ roomId: string; threadId: string; text: string }>('chat:privateSend', async (input) => {
    const target = docActor(host.actorFor(input.roomId));
    try {
      await requireActorMethod(target, 'sendPrivate').call(target, input.threadId, input.text);
    } finally {
      host.persistFlow();
    }
  });

  /**
   * **The one path from private to shared** (brief §4.1). Everything else a private thread says
   * stays in `whispers`: this handler is deliberately the only place in T6 that can put a private
   * turn's words into the document, and it does so by asking the actor, which runs the guard.
   */
  handle<{ roomId: string; threadId: string; turnId: string; anchorBlockId: string | null }>(
    'chat:insertIntoDoc',
    async (input) => {
      const target = docActor(host.actorFor(input.roomId));
      try {
        return await requireActorMethod(target, 'insertPrivateIntoDoc').call(target, {
          threadId: input.threadId,
          turnId: input.turnId,
          anchorBlockId: input.anchorBlockId,
        });
      } finally {
        host.persistFlow();
      }
    },
  );

  /** The **Pass** control on Max's open question (brief §4.4). A release fills no progress. */
  handle<{ roomId: string; threadId: string }>('quiz:pass', async (input) => {
    const target = docActor(host.actorFor(input.roomId));
    try {
      return await requireActorMethod(target, 'pass').call(target, input.threadId);
    } finally {
      host.persistFlow();
      const fileId = host.fileForRoom(input.roomId);
      // A release writes an outcome row. It fills nothing, but the bar's cards show what happened
      // on each objective, so the view is stale until it is recomputed.
      if (fileId) void emitProgress(host, fileId);
    }
  });

  /**
   * **The learner paused after writing in the document** (brief §6, architect §E4).
   *
   * The gate is `doctext.ts` and runs before anything else; only if it passes does this become a
   * learner *message*. The message is inserted by the **actor**, not here: `#insertMessage` is
   * private, it allocates the room's `seq`, bumps `turn_seq`, emits `message.appended` and has to
   * happen inside the mailbox with the turn that reads it. Main inserting a row beside the
   * mailbox is the one way to get two writers on a room. So the verbatim text goes to
   * `assessDocText` and T3 inserts it with `kind: 'doc_text'` — which keeps the ledger's evidence
   * a message id, as §E4 requires.
   */
  handle<{ fileId: string; docId: string; blockId: string; text: string }>(
    'notes:docText',
    async (input): Promise<{ assessed: boolean; threadId: string | null; reason: string | null }> => {
      const contentSha = await host.fileBytesKey(input.fileId).then(
        (k) => k.contentSha,
        () => null,
      );
      const opened = openNotesDoc(host.db, { contentSha, fileId: input.fileId });
      // A block with no id is one the editor has not minted an id for yet; there is nothing to
      // anchor a thread to and nothing to map to an objective, so it is not an attempt.
      if (!opened?.doc || !input.blockId) return { assessed: false, threadId: null, reason: 'no_doc' };

      const objectiveId = objectiveForBlock(host.objectivesTree(input.fileId), opened.doc, input.blockId);
      const key = `${input.docId}:${input.blockId}`;
      // Only a block that could be marked pays for the lookup, and only once per process.
      if (objectiveId && !lastAssessed.has(key)) {
        const stored = await storedDocTextHash(host, input.fileId, input.blockId);
        if (stored) lastAssessed.set(key, stored);
      }
      const gate = docTextGate({
        text: input.text,
        objectiveId,
        lastHash: lastAssessed.get(key) ?? null,
        inFlight: assessing.has(key),
      });
      if (!gate.assessed || !gate.objectiveId) return { assessed: false, threadId: null, reason: gate.reason };

      const { roomId, actor } = await host.openFlowRoom(input.fileId);
      const repo = threads();
      // One span thread per block: Max's feedback on what the learner wrote belongs beside any
      // question they already asked about the same paragraph, not in a thread of its own.
      const existing = repo.forBlock(roomId, input.blockId);
      const threadId = existing?.threadId ?? newId(SPAN_THREAD_PREFIX.replace(/_$/, ''));
      if (!existing) {
        repo.createSpanThread({
          roomId,
          docId: opened.row.docId,
          threadId,
          blockId: input.blockId,
          quote: cap(gate.verbatim, QUOTE_CAP),
          objectiveId: gate.objectiveId,
          now: now(),
        });
      } else if (!existing.objectiveId) {
        repo.setObjective(roomId, threadId, gate.objectiveId);
      }

      // Recorded before the call, so a turn that fails still counts as "this text was tried" and
      // the learner is not marked twice on the same paragraph by the next pause.
      lastAssessed.set(key, gate.hash);
      assessing.add(key);
      const target = docActor(actor);
      try {
        await requireActorMethod(target, 'assessDocText').call(target, {
          anchorId: threadId,
          objectiveId: gate.objectiveId,
          blockId: input.blockId,
          text: gate.verbatim,
        });
      } finally {
        assessing.delete(key);
        host.persistFlow();
        void emitProgress(host, input.fileId);
      }
      return { assessed: true, threadId, reason: null };
    },
  );

  /**
   * **An answer submitted from inside a Q block** (brief §5.5 and §5.6, 2026-10-01).
   *
   * Two questions come through here and they are kept apart by who asked. **Max's** is an attempt
   * on his open question: the actor marks it in the thread he asked it in, and refuses it when
   * that question is not the open one, because marking a closed question again is how a resolved
   * objective used to be filled twice (#49). **The learner's own** is marked in a span thread
   * anchored to its Q block, created here on the first answer and reused after; nothing about it
   * reaches the bar, which the actor guarantees by never treating it as a question of Max's.
   *
   * None of `notes:docText`'s gate applies. That gate guesses whether a pause was an attempt; a
   * Submit says so.
   */
  handle<NotesAnswerQuestionInput>('notes:answerQuestion', async (input): Promise<NotesAnswerQuestionResult> => {
    const refuse = (reason: NotesAnswerQuestionResult['reason'], threadId: string | null = null): NotesAnswerQuestionResult => ({
      accepted: false,
      threadId,
      reason,
    });
    if (!input.questionId || !input.qBlockId) return refuse('no_doc');
    if (input.answer.trim().length === 0) return refuse('empty');

    if (input.askedBy === 'max') {
      // Never opens a room: Max's question can only be open in one that exists.
      const room = await host.roomForFile(input.fileId).catch(() => null);
      if (!room) return refuse('not_open');
      const target = docActor(room.actor);
      try {
        const result = await requireActorMethod(target, 'answerInPlace').call(target, {
          questionId: input.questionId,
          blockId: input.answerBlockId || input.qBlockId,
          text: input.answer,
        });
        return { accepted: result.accepted, threadId: result.threadId, reason: result.reason };
      } finally {
        host.persistFlow();
        void emitProgress(host, input.fileId);
      }
    }

    if (input.question.trim().length === 0) return refuse('no_question');
    const contentSha = await host.fileBytesKey(input.fileId).then(
      (k) => k.contentSha,
      () => null,
    );
    const opened = openNotesDoc(host.db, { contentSha, fileId: input.fileId });
    if (!opened?.doc) return refuse('no_doc');

    const { roomId, actor } = await host.openFlowRoom(input.fileId);
    const repo = threads();
    // One thread per Q block: a revised answer is marked beside the first one.
    const existing = repo.forBlock(roomId, input.qBlockId);
    const threadId = existing?.threadId ?? newId(SPAN_THREAD_PREFIX.replace(/_$/, ''));
    const thread =
      existing ??
      repo.createSpanThread({
        roomId,
        docId: opened.row.docId,
        threadId,
        blockId: input.qBlockId,
        quote: cap(input.question, QUOTE_CAP),
        // Deliberately none: a self-set question is filed under no objective (§5.6).
        objectiveId: null,
        now: now(),
      });
    const context = await contextFor(host, { roomId, fileId: input.fileId, thread, question: input.question });
    const target = docActor(actor);
    try {
      const result = await requireActorMethod(target, 'markOwnQuestion').call(target, {
        anchorId: threadId,
        questionId: input.questionId,
        blockId: input.qBlockId,
        question: input.question,
        answer: input.answer,
        context,
      });
      return { accepted: result.accepted, threadId, reason: result.reason };
    } finally {
      host.persistFlow();
    }
  });

  /**
   * **The learner closed the file** (brief §4.7: closure fires when "the file is closed"; #49).
   *
   * Sent by the renderer when the three-column view unmounts: the doc header's Close, or opening
   * another file in its place. Only the room that is open, and only if it is this file's: a
   * close is never a reason to open a room, and `roomForFile` would. The release is dispatched,
   * not awaited (`closeFileQuestions`), so the close is never held up by a model turn. A quit
   * does not come through here: `before-quit` cannot wait for a turn either, so it saves the
   * sitting with the question open (`AppService.dispose`) and the idle rule releases it when the
   * file is next opened.
   */
  handle<{ fileId: string }>('chat:closeFile', (input): { closing: boolean } => {
    const current = host.currentActor();
    if (!current) return { closing: false };
    const roomId = current.snapshot().roomId;
    if (host.fileForRoom(roomId) !== input.fileId) return { closing: false };
    closeFileQuestions(host, roomId);
    return { closing: true };
  });

  /**
   * **New Conversation** (2026-09-23): start the file's conversational chain over.
   *
   * The confirm is asked here, in main, so the doc-chat button and the menu item cannot differ
   * and neither can skip it. What goes: the doc chat, the highlight threads, both private threads,
   * and any open question from Max — **not** released, because the learner is leaving the
   * conversation rather than going idle in it (`closeFileQuestions` is the idle path). What stays:
   * the notes, including the Q blocks already written into them, and the progress bar, which is
   * the learner's own record and has a reset of its own. The old rows stay in the database as the
   * event log; the room is retired so that nothing reopens it.
   */
  handle<{ fileId: string }>('chat:reset', async (input): Promise<ChatResetResult> => {
    const room = await host.roomForFile(input.fileId);
    if (!room) return { confirmed: false, reset: false };

    const target = docActor(room.actor);
    const openQuestion = (actorHas(target, 'docThreads') ? target.docThreads() : []).some((t) => t.quiz?.open === true);
    const messages = host.store.messages.forRoom(room.roomId).length;
    const detail = [
      `The doc chat, the threads on highlighted text and your private chats with Ellie and Max are cleared${
        messages > 0 ? ` (${messages} message${messages === 1 ? '' : 's'})` : ''
      }.` + (openQuestion ? ' Max’s open question is dropped without its answer.' : ''),
      'Your notes and your progress are kept, including the questions already written into the notes.',
      'You cannot go back to this conversation.',
    ].join('\n\n');

    const confirmed = await host.confirm({
      message: 'Start a new conversation?',
      detail,
      confirmLabel: 'New Conversation',
    });
    if (!confirmed) return { confirmed: false, reset: false };

    host.retireFlowRoom(room.roomId, 'learner_reset');
    return { confirmed: true, reset: true };
  });
}

/**
 * **Closure on close** (brief §4.7, architect §E3): no question Max asked is left without its
 * answer.
 *
 * Fire-and-forget by design. §E3's rule is that a close is never blocked on a model call — the
 * renderer is unmounting and the actor may be disposed before a 9–12 s Max turn can land — so this
 * dispatches the release and returns. Its caller is `chat:closeFile`, the file close. Not
 * `before-quit`: the process is gone before a dispatched turn could land, so a quit saves the
 * sitting with the question open and `RoomActor.start` releases it on the next visit, once the
 * gap has passed (#49). The inactivity-gap half of §4.7 is the actor's own clock.
 */
export function closeFileQuestions(host: DocHost, roomId: string): void {
  let actor: RoomActor;
  try {
    actor = host.actorFor(roomId);
  } catch {
    // Not the open room any more: its question stays in its stored sitting, and the idle rule
    // releases it when the file is next opened (`RoomActor.start`).
    return;
  }
  const target: DocActor = docActor(actor);
  if (!actorHas(target, 'closeOpenQuestion')) return;
  void Promise.resolve(target.closeOpenQuestion('closure'))
    .then(() => {
      /**
       * **This room's sitting, not the open one's** (#49). Closing a file and opening the next is
       * one gesture, so by the time the release lands `openRoom` has usually stopped this actor
       * and put another in its place — and `persistFlow` saves whichever is open. Saved there,
       * the question this turn closed would be restored as open on the next visit and released
       * twice.
       */
      if (host.currentActor() === actor) host.persistFlow();
      else saveFlowState(host.store, roomId, actor.flowSnapshot());
      const fileId = host.fileForRoom(roomId);
      if (fileId) void emitProgress(host, fileId);
    })
    .catch(() => {
      // A closure turn that cannot run is not a reason to fail a quit.
    });
}
