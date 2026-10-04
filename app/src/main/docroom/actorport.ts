/**
 * **The one place the chats reach the actor** (#48). **Track T6.**
 *
 * `app/docs/COLLAB-CONTRACT.md` §"Agreed signatures across tracks" lists nine methods T3 is
 * adding to `RoomActor` for the collab doc. While T3 builds them in the same working tree, this
 * file declares them as a narrow structural type over `RoomActor` and does the cast **once**, so
 * every handler is written against the agreed signature and typechecks today. When
 * `src/room/actor.ts` carries them, `DocActor` becomes an alias of `RoomActor` and `docActor()`
 * becomes the identity — one edit, in one file.
 *
 * The runtime guard is the other half: a method that has not landed fails with the name of the
 * method and the track that owes it, rather than as `actor.pass is not a function` six frames
 * deep in an IPC wrapper.
 */

import type { GeneratedBlockKind } from '../../shared/doc/types.js';
import type { BlockActionStart, RoomActor } from '../../room/actor.js';
import type { AgentAuthor, PrivateTurnView, ThreadView } from '../../shared/doc/types.js';
import type { ReferenceContext } from '../../room/reference.js';

/** What T3 adds. Names, arguments and returns are the contract's, verbatim. */
export interface DocActorMethods {
  sendMessage(
    text: string,
    anchorId?: string | null,
    context?: ReferenceContext,
    origin?: 'composer' | 'ask',
  ): Promise<void>;
  /** The **Pass** control on Max's open question (brief §4.4). */
  pass(anchorId: string): Promise<{ released: boolean; refused: string | null }>;
  /**
   * **A span thread's block, told to the actor before its first turn** (`notebooks.md` §4.2,
   * 2026-10-02). Main creates highlight and Ask… threads; without this the actor saw them as
   * block-less and filed Ellie's doc edit wherever the planner guessed.
   */
  noteSpanThread(input: { threadId: string; blockId: string; quote: string | null; contentKey?: string | null }): void;
  /**
   * **The tutorial as the main view** (2026-10-04, `tutorials.md` §2): what the turns in a thread
   * read about the sheet and the lecture behind it, or null when the mode is off.
   */
  noteTutorialFocus(input: { threadId: string; block: string | null }): void;
  /** A lesson card's Start: Ellie announces the objective and prompts for a question (§6). */
  startLesson(input: { objectiveId: string; anchorId: string; blockId: string | null }): Promise<void>;
  /**
   * The learner's own doc text, as an attempt. T3 inserts the synthetic `doc_text` learner
   * message inside the mailbox — see the note in `ipc.ts` on why main does not insert it.
   */
  assessDocText(input: {
    anchorId: string;
    objectiveId: string;
    blockId: string;
    text: string;
  }): Promise<void>;
  /** An answer typed inside Max's Q block and submitted (brief §5.5). Marked in his thread. */
  answerInPlace(input: {
    questionId: string;
    blockId: string;
    text: string;
  }): Promise<{ accepted: boolean; threadId: string | null; reason: 'not_open' | 'empty' | 'in_flight' | null }>;
  /** The learner's own question, answered in its Q block (brief §5.6). Fills no progress. */
  markOwnQuestion(input: {
    anchorId: string;
    questionId: string;
    blockId: string;
    question: string;
    answer: string;
    context?: ReferenceContext | null;
  }): Promise<{ accepted: boolean; reason: 'empty' | 'no_question' | 'in_flight' | null }>;
  /** A table or diagram the learner asked for at a block (brief §5.7). An ordinary agent edit. */
  generateBlock(input: {
    blockId: string;
    kind: GeneratedBlockKind;
    instruction: string | null;
    passage?: string | null;
    pageCount?: number;
  }): Promise<{ inserted: boolean; editId: string | null; reason: 'no_doc' | 'frozen' | 'declined' | 'failed' | 'in_flight' | null }>;
  /**
   * **Explain, Example or Quiz me on a block** (`notebooks.md` §4, contract C7). Resolves once the
   * action is accepted or refused; `turn` settles when the answer has landed.
   */
  blockAction(input: {
    kind: 'explain' | 'example' | 'quiz';
    blockId: string;
    anchorId: string;
    quote: string;
    context?: ReferenceContext | null;
    objectiveId: string | null;
    passage?: string | null;
    /** A tutorial sheet's line: its content key (the doc line goes there; Quiz me is refused). */
    contentKey?: string | null;
  }): Promise<BlockActionStart>;
  openPrivate(agent: AgentAuthor): { threadId: string; turns: PrivateTurnView[] };
  sendPrivate(threadId: string, text: string): Promise<void>;
  /** The one path from a private thread to the shared document (brief §4.1). */
  insertPrivateIntoDoc(input: {
    threadId: string;
    turnId: string;
    anchorBlockId: string | null;
  }): Promise<{ editId: string | null }>;
  /** The threads the actor knows about, with their quiz state. Merged with T6's registry. */
  docThreads(): ThreadView[];
  closeOpenQuestion(reason: 'closure'): Promise<void>;
}

export type DocActor = Omit<RoomActor, 'sendMessage'> & DocActorMethods;

/**
 * The single cast. Every handler obtains its actor through this and through nothing else, so
 * removing the cast is a one-line change once T3 has landed.
 */
export function docActor(actor: RoomActor): DocActor {
  return actor as unknown as DocActor;
}

/** True when T3's method is on the actor this build is running against. */
export function actorHas<K extends keyof DocActorMethods>(actor: DocActor, method: K): boolean {
  return typeof (actor as unknown as Record<string, unknown>)[method as string] === 'function';
}

/**
 * Call a method that must exist, with a failure that names what is missing.
 *
 * Reads degrade (`chat:threads` falls back to the registry alone); a learner action does not —
 * silently doing nothing when the learner pressed Pass is worse than an error card that says
 * which half of the build is not there yet.
 */
export function requireActorMethod<K extends keyof DocActorMethods>(actor: DocActor, method: K): DocActorMethods[K] {
  if (!actorHas(actor, method)) {
    throw new Error(`RoomActor.${String(method)} is not available yet (track T3, #48)`);
  }
  return (actor as unknown as Record<string, DocActorMethods[K]>)[method as string]!;
}

/**
 * **T3's nine methods have landed** (lead, integration pass, #48). This line is the proof, checked
 * by the compiler on every build: if `RoomActor` ever stops satisfying `DocActorMethods` — a
 * renamed method, a changed parameter — this file stops compiling, which is where the mismatch
 * should be found, rather than at the runtime guard above on a learner's first message. The guard
 * stays: it costs nothing, and the handler tests drive a fake actor through it.
 */
const ROOM_ACTOR_SATISFIES_DOC_ACTOR: RoomActor extends DocActorMethods ? true : never = true;
void ROOM_ACTOR_SATISFIES_DOC_ACTOR;
