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
import type { NotebookSourceView, SourceKind } from '../shared/notebook.js';
import type { SourceRole } from '../shared/tutorial.js';

/** The wrapper `register()` builds: logs `ipc.error` with the channel, then re-throws. */
export type IpcHandle = <T>(channel: string, fn: (payload: T) => unknown) => void;

export interface DocHost {
  readonly db: SqlDatabase;
  readonly store: LocalStore;
  readonly vault: VaultService;
  readonly segments: SegmentService;
  /**
   * **Notebooks as subjects** (`docs/research/notebooks.md`; added 2026-10-01 by the lead, frozen,
   * implemented by track N1 in `src/main/notebooks/`). Every doc-path module that used to resolve
   * a file id through `vault` resolves a notebook id here; see `app/docs/NOTEBOOK-CONTRACT.md`.
   */
  readonly notebooks: NotebookHost;
  /** `app.getPath('userData')`. Page images for the refine pass live under it. */
  readonly userDataDir: string;

  /** The one main→renderer stream. */
  emit(event: RoomEvent): void;
  /**
   * **A typed message into a thread on a tutorial part** (2026-10-04, `tutorial/reply.ts`): Max's
   * reply turn, with the part and the learner's answer slot. Resolves false when the thread is not
   * on a part, and `chat:send` sends the message as it always has. Optional for test hosts.
   */
  tutorialReply?(
    input: { roomId: string; threadId: string; docId: string | null; blockId: string | null; text: string },
    actor: unknown,
  ): Promise<boolean>;
  /**
   * **The tutorial as the main view** (2026-10-04, `tutorial/focus.ts`): the block the turns in a
   * thread read about the sheet the learner has as the main view, its parts and the lecture notes
   * and pages behind them; null when `fileId` is not a tutorial of the notebook. Optional for test
   * hosts.
   */
  tutorialFocus?(input: { notebookId: string; fileId: string; blockId?: string | null }): string | null;

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

  /**
   * **A native confirm sheet for a destructive learner action** (2026-09-23: Regenerate Notes,
   * New Conversation). Asked by the handler itself, so every surface — the pane buttons and the
   * menu — goes through the same question and none can skip it. Cancel is the default button.
   */
  confirm(input: ConfirmRequest): Promise<boolean>;

  /**
   * **Retire a room: the learner reset the conversation.** The actor is retired (a reply in flight
   * is dropped, nothing new starts), the room is closed and its session ended with `reason`. The
   * rows stay — the event log is the record — but `roomForFile` no longer finds it, so the next
   * learner message opens a fresh room.
   */
  retireFlowRoom(roomId: string, reason: string): void;
}

/**
 * **What the doc path may ask about a notebook.** Every page here is a notebook page
 * (`shared/notebook.ts`): the sources laid end to end at their fixed bases.
 */
export interface NotebookHost {
  /** The notebook, or null when the id is not a notebook's (or it was deleted). */
  subject(notebookId: string): NotebookSubject | null;
  /**
   * The ticked, ready sources' text laid end to end, each under a `=== SOURCE: <name> ===` line
   * and each page under a `[p. N]` line where N is the **notebook** page, so a model's citation is
   * already a notebook page. Capped at the vault's `DECK_TEXT_CAP`; `truncated` says it was.
   */
  deckText(notebookId: string, opts?: SourceRoleFilter): { text: string; truncated: boolean };
  /**
   * The text of a run of notebook pages, from any source whether ticked or not. '' for a gap.
   * **'' for the pages of a `solutions` source** (`tutorials.md` §1) unless `includeSolutions`,
   * which only `main/tutorial/` passes, to rewrite a tutorial's hidden key from them.
   */
  textFor(input: { notebookId: string; pageFrom: number; pageTo: number; includeSolutions?: boolean }): string;
  /**
   * Where a notebook page lives: the source's file id (what `vault`, `segments` and the page
   * cache take), its own page number, the copy's absolute path, its kind, and its content sha
   * once read. Null for a gap or out of range.
   */
  locate(notebookId: string, page: number): LocatedPage | null;
}

/**
 * **Which roles of source a read covers** (`tutorials.md` §1, migration 028). The default is the
 * room's context, lecture and tutorial sources; the overview asks for `['lecture']`. `solutions`
 * are never in a deck text, whatever is asked.
 */
export interface SourceRoleFilter {
  roles?: readonly SourceRole[];
}

export interface NotebookSubject {
  readonly id: string;
  readonly name: string;
  /** `notebookContentKey(id)`: what `notes_docs` and `quiz_outcomes` are keyed on. */
  readonly contentKey: string;
  /** Every source, in the order added, whatever its state. */
  readonly sources: readonly NotebookSourceView[];
  /** `virtualPageCount(sources)`. */
  readonly pageCount: number;
  /** `contextFingerprint(sources)`: the ticked, ready **lecture** sources (the overview's). */
  readonly fingerprint: string;
}

export interface LocatedPage {
  fileId: string;
  localPage: number;
  path: string;
  kind: SourceKind;
  contentSha: string | null;
}

export interface ConfirmRequest {
  /** The question, in the sheet's bold line. */
  message: string;
  /** What will be lost and what will be kept, in plain sentences. */
  detail: string;
  /** The destructive button's label, e.g. "Regenerate Notes". */
  confirmLabel: string;
}
