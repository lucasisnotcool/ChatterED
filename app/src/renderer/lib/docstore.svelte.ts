/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE NOTES DOC'S RENDERER STATE (`docs/research/collab-doc.md`, #48)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The renderer is the **live authority on the document while it is open** (architecture study
 * §D5), because ProseMirror transactions happen where the `EditorView` is and the guard can only
 * run there (§D3). Main persists, records outcomes and decides everything about progress; this
 * store holds the open document, applies what arrives on the event stream, and saves.
 *
 * ## Two rules this file exists to keep
 *
 * **1. A `$state` proxy never reaches ProseMirror or IPC.** This app has been bitten already —
 * "An object could not be cloned" — and a Svelte proxy inside a PM node would be worse than a
 * crash, because PM compares nodes by identity and a proxy is never the node it wraps. So: the
 * `EditorView`, the document JSON and the slide source are **plain private fields**; only
 * scalars and small view models are `$state`; and anything crossing IPC is `toJSON()` output or
 * `$state.snapshot`.
 *
 * **2. Freeze drops, never queues** (§3, and §D4). An edit that arrives while frozen is reported
 * `dropped_frozen` and forgotten on the spot. Main also skips the call; this is the second half
 * of the same rule, for the race.
 */

import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { RoomEvent } from '../../shared/types.js';
import type {
  ChatterEdApi,
  GenerateBlockRefusal,
  NotesAnswerQuestionResult,
  NotesBlockActionResult,
  NotesGenerateBlockResult,
  NotesUpdateOverviewResult,
} from '../../shared/ipc.js';
import { isNotebookId, type NotebookView } from '../../shared/notebook.js';
import { paginateText } from '../../shared/paginate.js';
import { Node as PmNode } from 'prosemirror-model';
import {
  applyBatch,
  appendNodes,
  appendWindow,
  keepEdit,
  removeEdit,
} from '../../shared/doc/ops.js';
import { acceptSuggestion, rejectSuggestion } from '../../shared/doc/suggest.js';
import { blockAttrs, blockPos, docFromJson, imageParagraph, newBlockId, notesSchema } from '../../shared/doc/schema.js';
import type {
  AgentAuthor,
  AgentDocOpBatch,
  BlockActionKind,
  GeneratedBlockKind,
  DocBlockDraft,
  DocEditRecord,
  DocEditStatus,
  NotesDocView,
  NotesIngestView,
  OverviewMeta,
  ProgressView,
  Rect,
  Suggestion,
} from '../../shared/doc/types.js';
import { bridge } from './bridge.js';
import { SlideSource, rasterPages, type SlidePart, type SourceContent } from './rasterise.js';
import { learnerIsTyping, typingSchedule } from './typing.js';
import { AGENT_TR, type Range, insertedRanges } from './pm/authorship.js';
import {
  bumpChrome,
  type AgentCursorView,
  type BlockActionView,
  type ChromeContext,
  type RecommendationView,
  type SpanThreadView,
} from './pm/chrome.js';
import { blockQuote, notebookEmpty, objectiveFills, sectionSpans, unseenSources } from './pm/overview.js';
import { reveal, revealText } from './pm/reveal.js';
import { insertOwnQuestion, type QuestionAnswer } from './pm/qblock.js';
import { setReading } from './pm/readaloud.js';
import { setSearchHit } from './pm/searchhit.js';
import { caretInsertPos, insertPosAfter, insertTargetId } from './pm/insertat.js';
import { revealInView } from './pm/concept.js';
import { editFormula } from './pm/math.js';
import { bumpStrips, type StripContext } from './pm/slidestrip.js';
import { closeAllSlideWindows, openSlideWindow } from './pm/slidewindow.js';
import type { SlideReader } from './pm/sourcepop.js';
import { pageLinesFor } from './pagelines.js';
import { slideGroups, type SlideGroup, type SlideOverride } from '../../shared/doc/slidegroups.js';
import { learnerTextByBlock } from './pm/doctext.js';
import { tutorialContentKey } from '../../shared/tutorial.js';

/** ≈800 ms after the last change (the brief), and immediately after an agent edit. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * How long a first ingest waits for the deck to open before it starts without the slides.
 *
 * Generous on purpose: it is not a pacing knob but a deadlock guard. A 66-page deck parses in
 * seconds even with main busy extracting the same file, so reaching this means something is
 * wrong, and §2 is explicit that an ingest with no images still has to produce notes.
 */
const SLIDES_WAIT_MS = 60_000;

const EMPTY_INGEST: NotesIngestView = {
  status: 'none',
  windowsDone: 0,
  windowsTotal: 0,
  withImages: false,
  error: null,
};

/** Is this call actually on the bridge? The mock is T5's and lands on its own schedule. */
function has(name: keyof ChatterEdApi): boolean {
  return typeof (bridge() as unknown as Record<string, unknown>)[name] === 'function';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The three calls the slide groups need (2026-10-03), read off the bridge defensively: a preload
 * from before them (a dev build mid-reload) has none, and the strips then group by the document
 * alone and keep the learner's moves for this session only.
 */
interface SlideGroupsApi {
  notesPageTexts?: (input: { fileId: string }) => Promise<Record<number, string>>;
  notesSlideGroups?: (input: { docId: string }) => Promise<SlideOverride[]>;
  notesSetSlideGroup?: (input: { docId: string; page: number; key: string | null; title: string }) => Promise<SlideOverride[]>;
}

function slideApi(): SlideGroupsApi {
  return bridge() as unknown as SlideGroupsApi;
}

/**
 * `tutorial:doc` (`TUTORIAL-CONTRACT.md` S2), read off the bridge defensively for the same reason:
 * a preload from before tutorials has no such call, and the tutorial column then says so.
 */
interface TutorialDocApi {
  tutorialDoc?: (input: { notebookId: string; fileId: string }) => Promise<NotesDocView | null>;
}

function tutorialDocApi(): TutorialDocApi {
  return bridge() as unknown as TutorialDocApi;
}

/**
 * What `generateBlock` says: main's result, or the renderer's own refusal `no_place` — the caret
 * has not been put anywhere yet, so there is no block to insert after.
 */
export type GenerateBlockOutcome = Omit<NotesGenerateBlockResult, 'reason'> & {
  reason: GenerateBlockRefusal | 'no_place' | null;
};

/** How long a refusal stays under its block or card before it goes on its own. */
const REFUSAL_MS = 6_000;

/**
 * The longest a block shows "Ellie is writing…" after main accepted the action. It normally ends
 * on the agent's own edit or its cursor going idle; this is the backstop for an answer that only
 * reached the chat (the doc frozen, or the doc line refused by the guard).
 */
const BLOCK_ACTION_MS = 45_000;

/** A block action main refused, in a line for under the block (`NotesBlockActionResult.reason`). */
export function blockActionRefusal(reason: NotesBlockActionResult['reason'] | 'failed'): string {
  switch (reason) {
    case 'busy':
      return 'Ellie is still answering. Try again when she has finished.';
    case 'question_open':
      return "Max's question is still open. Answer it or pass first.";
    case 'no_doc':
      return 'These notes are not saved yet. Try again in a moment.';
    default:
      return 'That did not work. Try again.';
  }
}

/** Why a recommended block (or Insert) was not added, in a line for the card. */
export function generateRefusal(reason: GenerateBlockOutcome['reason']): string {
  switch (reason) {
    case 'frozen':
      return 'The notes are frozen. Unfreeze them to add this.';
    case 'declined':
      return 'Ellie found nothing in this section to make it from.';
    case 'in_flight':
      return 'Ellie is already making a block. Try again in a moment.';
    case 'no_doc':
    case 'no_place':
      return 'These notes are not saved yet. Try again in a moment.';
    default:
      return 'Ellie could not make it this time. Try again.';
  }
}

/** Why Update overview did not start, in a line for the notice bar. */
export function updateRefusal(reason: NotesUpdateOverviewResult['reason']): string | null {
  switch (reason) {
    case 'in_flight':
      return 'The overview is already being written.';
    case 'no_sources':
      return 'Tick a source first: the overview is written from the ticked sources.';
    case 'no_doc':
      return 'These notes are not open yet.';
    default:
      return null;
  }
}

/** A source's content for the slides, through the bridge. A source that will not open is a blank page. */
export async function openSource(fileId: string): Promise<SourceContent | null> {
  const view = await bridge().openDocument({ fileId });
  if (view.error) return null;
  return { bytes: view.bytes, text: view.text };
}

export class DocStore {
  // ── what the pane draws ───────────────────────────────────────────────────────────────────
  fileId = $state<string | null>(null);
  docId = $state<string | null>(null);
  title = $state('');
  pageCount = $state(0);
  version = $state(0);
  frozen = $state(false);
  ingest = $state<NotesIngestView>({ ...EMPTY_INGEST });
  /** Status `applied` only: the edits still wearing their colour. */
  edits = $state<DocEditRecord[]>([]);
  /** Status `open` only. */
  suggestions = $state<Suggestion[]>([]);
  cursors = $state<AgentCursorView[]>([]);
  /**
   * The learning overview's metadata (`notebooks.md` §3, §5.3, §6): the fingerprint it was written
   * from, the section recommendations, and Ellie's greeting with the three starter questions,
   * which the chat (N5) reads from here. Null on a doc written before the overview existed (a
   * legacy notebook's notes, `notebooks.md` §1), and while nothing is open.
   */
  overview = $state<OverviewMeta | null>(null);
  /** Per block: an action running on it, or main's refusal of one (`notebooks.md` §4.1). */
  blockActions = $state<Record<string, BlockActionView>>({});
  /** Per recommendation: being added, or why it was not (§5.3). */
  recommendationStates = $state<Record<string, RecommendationView>>({});
  /** From Update overview's click until main has written the new overview (§2). */
  updatingOverview = $state(false);
  /**
   * The banner the learner said **Not now** to (`overviewBanner`'s `fingerprint`), for the open
   * notebook. It stays hidden until the sources change again.
   */
  bannerDismissed = $state<string | null>(null);

  loading = $state(false);
  error = $state<string | null>(null);
  /** Non-null while the renderer is turning the deck into JPEGs for the refine pass. */
  rasterising = $state<{ done: number; total: number } | null>(null);
  saving = $state(false);
  savedAt = $state(0);
  /** True once the learner has typed anything at all into this document. */
  learnerTouched = $state(false);
  /**
   * **A slide being dragged to another section** (2026-10-03): the notes show only the sections'
   * titles to drop it on (`SlideRegroup.svelte`) until it is dropped or let go.
   */
  slideDrag = $state<{ page: number; from: string } | null>(null);
  /** Bumped whenever a *different* document has been loaded and the view must remount. */
  epoch = $state(0);
  slidesReady = $state(false);

  // ── plain fields: nothing here may ever become reactive ───────────────────────────────────
  #view: EditorView | null = null;
  #docJson: unknown = null;
  #slides: SlideSource | null = null;
  /** The learner's slide moves for this document, and the deck's page texts the grouping reads. */
  #slideOverrides: SlideOverride[] = [];
  #pageTexts: Map<number, string> | null = null;
  /** Bumped when either changes, so the memo below knows. */
  #slideInputs = 0;
  #groupsMemo: { doc: PmNode; inputs: number; groups: SlideGroup[] } | null = null;
  /** Which strips the learner has opened, by group key. Plain: only the strips' rebuild reads it. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #openStrips = new Set<string>();
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #savePending = false;
  /**
   * The document as it was when the view went away with a save still owed (`detach`). A save that
   * runs with no view writes this, and only to the doc it came from.
   */
  #detached: { docId: string; doc: unknown } | null = null;
  /** Settles when the save now in flight has finished. Null when none is. */
  #saveSettled: Promise<void> | null = null;
  // A plain Map on purpose: these are timer handles, nothing renders them, and making them
  // reactive would re-run effects on every frame of the typing animation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #animations = new Map<string, ReturnType<typeof setTimeout>>();
  #lastKeyAt = 0;
  /** The learner has put the caret somewhere in this view: Insert has a place to go (`insertTarget`). */
  #placed = false;
  #openToken = 0;
  /**
   * The open notebook (`store.notebook.view`, N5's), as a plain snapshot: the sources the slides
   * are drawn from and the chips are labelled by. Set by `NotesPane` through `setNotebook`.
   */
  #notebook: NotebookView | null = null;
  /** A first ingest is being started for a notebook that just got a ready source. */
  #ingestStarting = false;
  /**
   * **A tutorial's document, not the notebook's notes** (`docs/research/tutorials.md`, S7). The
   * second `DocStore` the tutorial column hosts: `fileId` is still the notebook (so a block action,
   * the page lines and the citations go through the notebook, as on the notes), the document is
   * the tutorial's own `notes_docs` row, loaded with `tutorial:doc` and saved with `notes:save` by
   * its `docId`. The overview's machinery (first ingest, Update, the banner) never runs on it.
   */
  #tutorial: { notebookId: string; fileId: string } | null = null;
  /** Update overview was accepted: the next `ready` replaces the doc with main's (`#settleAfterIngest`). */
  #awaitingRewrite = false;
  // Plain on purpose: what was dismissed per notebook for this session, and timer handles.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #dismissed = new Map<string, string>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #lineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── wiring set by `NotesPane` from `store.chat` (T5), so neither store imports the other ──
  askAboutSpan: ((input: { blockId: string; quote: string; docKey?: string }) => void) | null = null;
  focusThread: ((threadId: string) => void) | null = null;
  spanThreads: (() => readonly SpanThreadView[]) | null = null;
  /**
   * **The tutorial as the main view** (2026-10-04): the tutorial the middle column shows, or null.
   * Set by the shell; sent with a block action on a sheet's line, so main tells the turn about the
   * sheet and the lecture behind it.
   */
  mainTutorial: (() => string | null) | null = null;
  /** `store.progress.view` (N5's): the objectives list's fills (contract C5). */
  progressView: (() => ProgressView | null) | null = null;

  // ── opening ───────────────────────────────────────────────────────────────────────────────

  /**
   * Open the notes for a file: load them, or make them.
   *
   * The order matters. The **deck's bytes come first**, because the page images are the
   * renderer's one contribution to the ingest and they have to be in main's hands *before*
   * `notesIngest` starts (the channel's own docstring says so). The slide source opened here is
   * then the same one the carousel, the modal and every inline figure draw from.
   *
   * An ingest that already exists is never redone — `notesGet` first, and `notesIngest` only
   * when there is nothing. Retry is the learner's explicit `force`.
   */
  async open(fileId: string): Promise<void> {
    if (this.fileId === fileId && this.docId && !this.#tutorial) return;
    const token = ++this.#openToken;
    this.#tutorial = null;
    this.#reset();
    this.fileId = fileId;
    this.loading = true;
    this.bannerDismissed = this.#dismissed.get(fileId) ?? null;

    if (isNotebookId(fileId)) {
      await this.#openNotebook(fileId, token);
      return;
    }

    try {
      const slides = this.#openSlides(fileId, token);

      const existing = has('notesGet') ? await bridge().notesGet({ fileId }) : null;
      if (token !== this.#openToken) return;
      if (existing) {
        // Reopening: the notes are already written, so nothing waits on the deck's pixels and
        // the pane draws while the carousel is still parsing behind it.
        this.#adopt(existing);
        this.loading = false;
        return;
      }

      /**
       * Nothing yet: send the slides, then start the two-pass ingest.
       *
       * **This is the one place the deck's bytes are waited for.** The images are an input to
       * the refine pass, not decoration, so starting the ingest before they are in main's hands
       * silently downgrades it to text-only — which is what happened on every live ingest until
       * 20 Sep: `#openSlides` was left running, `#sendPageImages` polled for five seconds, and
       * main was busy extracting the very same deck, so the poll always lost.
       *
       * Bounded, because the alternative failure is worse: a deck whose pixels never arrive must
       * still become notes. `#openSlides` swallows its own errors and always settles, so the
       * timeout is only reached by something pathological (a pdf.js worker that never answers).
       */
      await Promise.race([slides, new Promise((resolve) => setTimeout(resolve, SLIDES_WAIT_MS))]);
      if (token !== this.#openToken) return;
      await this.#sendPageImages(fileId, token);
      if (token !== this.#openToken) return;
      if (!has('notesIngest')) {
        this.ingest = { ...EMPTY_INGEST, status: 'failed', error: 'The notes ingest is not available yet.' };
        this.loading = false;
        return;
      }
      const created = await bridge().notesIngest({ fileId });
      if (token !== this.#openToken) return;
      this.#adopt(created);
    } catch (err) {
      if (token !== this.#openToken) return;
      this.error = message(err);
      this.ingest = { ...this.ingest, status: 'failed', error: message(err) };
    } finally {
      if (token === this.#openToken) this.loading = false;
    }
  }

  /**
   * **Open a notebook's doc** (contract C2: the notebook id is the subject). The slides are the
   * notebook's sources as one deck (`SlideSource`, C1), opened lazily page by page, so nothing
   * here waits on bytes: an existing doc is drawn at once. With no doc yet, the overview is
   * started only once a ticked source is ready (`#maybeStartIngest`); until then the pane says
   * "Add a source to start" or "Reading your sources…" (`notebookEmpty`).
   */
  async #openNotebook(fileId: string, token: number): Promise<void> {
    this.#slides = new SlideSource(this.#notebookParts(fileId), { open: openSource, paginate: paginateText });
    this.slidesReady = true;
    if (this.#notebook?.id === fileId) this.pageCount = this.#notebook.pageCount;
    try {
      const existing = has('notesGet') ? await bridge().notesGet({ fileId }) : null;
      if (token !== this.#openToken) return;
      if (existing) {
        this.#adopt(existing);
        return;
      }
    } catch (err) {
      if (token !== this.#openToken) return;
      this.error = message(err);
      this.ingest = { ...this.ingest, status: 'failed', error: message(err) };
      return;
    } finally {
      if (token === this.#openToken) this.loading = false;
    }
    await this.#maybeStartIngest();
  }

  /**
   * **Open a tutorial's document** (`tutorials.md` §2, S2). The slides are the notebook's, as on
   * the notes, so a figure cropped from the sheet and a chip citing a lecture page both render.
   * Nothing is ingested from here: with no document yet the tutorial column shows the reading
   * state and `TutorialStore` sends the page images and starts the read.
   */
  async openTutorial(notebookId: string, fileId: string): Promise<void> {
    const same = this.#tutorial?.notebookId === notebookId && this.#tutorial.fileId === fileId;
    if (same && this.docId) return;
    // The document on screen is written before it is let go: a tab switch must never lose a word.
    if (this.#view || this.#saveTimer || this.#savePending) await this.#flushSave();
    // Let the old view go without a snapshot: its teardown must not write it over the next one.
    this.#view = null;
    const token = ++this.#openToken;
    this.#tutorial = { notebookId, fileId };
    this.#reset();
    this.fileId = notebookId;
    this.loading = true;
    this.#slides = new SlideSource(this.#notebookParts(notebookId), { open: openSource, paginate: paginateText });
    this.slidesReady = true;
    if (this.#notebook?.id === notebookId) this.pageCount = this.#notebook.pageCount;
    await this.#loadTutorial(token);
  }

  /**
   * **The tutorial's document was (re)written by main** (a first read finished, or Read again):
   * take main's copy over whatever is on screen. Read again took the editor down first
   * (`holdForReread`), so nothing of the old document is saved over the new one.
   */
  async reloadTutorial(): Promise<void> {
    if (!this.#tutorial) return;
    await this.#loadTutorial(this.#openToken);
  }

  async #loadTutorial(token: number): Promise<void> {
    const which = this.#tutorial;
    const api = tutorialDocApi();
    if (!which) return;
    try {
      if (!api.tutorialDoc) {
        this.error = 'Tutorials are not available in this build yet.';
        return;
      }
      const view = await api.tutorialDoc({ notebookId: which.notebookId, fileId: which.fileId });
      if (token !== this.#openToken) return;
      this.error = null;
      if (view) this.#adopt(view);
    } catch (err) {
      if (token === this.#openToken) this.error = message(err);
    } finally {
      if (token === this.#openToken) this.loading = false;
    }
  }

  /**
   * **Read again** is about to replace this document: save what is on screen (main carries the
   * learner's answers over by part id from the *stored* document), then take the editor down
   * without another save, as Regenerate does for the notes.
   */
  async holdForReread(): Promise<void> {
    await this.#flushSave();
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#savePending = false;
    this.#cancelAnimations();
    this.#view = null;
    this.learnerTouched = false;
  }

  /** `{ docKey }` for a call about a line of a tutorial sheet (S7), else nothing. */
  #docKey(): { docKey?: string } {
    const t = this.#tutorial;
    return t ? { docKey: tutorialContentKey(t.notebookId, t.fileId) } : {};
  }

  /** The tutorial this store holds, or null when it holds the notebook's notes. */
  tutorialOf(): { notebookId: string; fileId: string } | null {
    return this.#tutorial ? { ...this.#tutorial } : null;
  }

  #notebookParts(fileId: string | null): SlidePart[] {
    const nb = this.#notebook;
    return nb && nb.id === fileId ? nb.sources : [];
  }

  /**
   * **The open notebook changed** (N5 pushes `notebook:changed`; `NotesPane` hands it here). The
   * slides follow the sources, the chips are relabelled, and a notebook with no doc yet starts
   * its overview the moment a ticked source is ready (§1: drop a file, and the overview comes).
   * The overview itself is never rewritten from here: that is the banner's Update (§2).
   */
  setNotebook(view: NotebookView | null): void {
    const plain = view ? ($state.snapshot(view) as NotebookView) : null;
    this.#notebook = plain;
    if (!plain || plain.id !== this.fileId) return;
    this.#slides?.setSources(plain.sources);
    if (!this.docId) this.pageCount = plain.pageCount;
    this.#bump();
    void this.#maybeStartIngest();
  }

  async #maybeStartIngest(): Promise<void> {
    const fileId = this.fileId;
    const nb = this.#notebook;
    if (this.#tutorial || !fileId || !isNotebookId(fileId) || this.loading || this.docId || this.#ingestStarting) return;
    if (this.ingest.status !== 'none' || !nb || nb.id !== fileId || notebookEmpty(nb) !== null) return;
    if (!has('notesIngest')) return;
    this.#ingestStarting = true;
    const token = this.#openToken;
    this.ingest = { ...EMPTY_INGEST, status: 'pending' };
    try {
      await this.#sendPageImages(fileId, token);
      if (token !== this.#openToken) return;
      const created = await bridge().notesIngest({ fileId });
      if (token !== this.#openToken) return;
      // `none`: main found no ticked, ready source after all (a race with an untick) and wrote
      // nothing. Back to the empty state; the next notebook change tries again.
      if (created.ingest.status === 'none' || !created.docId) {
        this.ingest = { ...EMPTY_INGEST };
        return;
      }
      this.#adopt(created);
    } catch (err) {
      if (token !== this.#openToken) return;
      this.ingest = { ...this.ingest, status: 'failed', error: message(err) };
    } finally {
      this.#ingestStarting = false;
    }
  }

  /** The Retry on a failed ingest (§ ingest states). */
  async retryIngest(): Promise<void> {
    const fileId = this.fileId;
    if (this.#tutorial || !fileId || !has('notesIngest')) return;
    this.error = null;
    this.ingest = { ...this.ingest, status: 'pending', error: null };
    const token = this.#openToken;
    try {
      await this.#sendPageImages(fileId, token);
      const view = await bridge().notesIngest({ fileId, force: true });
      if (token !== this.#openToken) return;
      this.#adopt(view);
    } catch (err) {
      this.ingest = { ...this.ingest, status: 'failed', error: message(err) };
    }
  }

  /**
   * **Regenerate Notes** (2026-09-23): the notes-pane button and the File menu item.
   *
   * Main asks the learner to confirm (`notes:regenerate`) and says what is lost; nothing changes
   * here until they have said yes. Then the editor is taken down **without saving** — this store
   * is the live authority on a save conflict (`#rebase` re-saves what is on screen), so an editor
   * left mounted would write the old notes straight back over the new ones — and the ingest runs
   * the same way a Retry does: page images first, then `notesIngest` with `force`.
   *
   * Returns a line for the learner when it could not start, or null.
   */
  async regenerate(): Promise<string | null> {
    const fileId = this.fileId;
    if (this.#tutorial || !fileId || !has('notesRegenerate') || !has('notesIngest')) return null;
    if (this.ingest.status === 'pending' || this.ingest.status === 'streaming') {
      return 'Ellie is still writing these notes. Regenerate them once she has finished.';
    }
    let result;
    try {
      result = await bridge().notesRegenerate({ fileId });
    } catch (err) {
      return message(err);
    }
    if (fileId !== this.fileId) return null;
    if (!result.confirmed) {
      return result.refused === 'busy' ? 'Ellie is still writing these notes. Regenerate them once she has finished.' : null;
    }

    // Nothing of the old document may be saved from here on.
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#savePending = false;
    this.#cancelAnimations();
    this.learnerTouched = false;
    this.error = null;
    // `pending` unmounts the editor (NotesPane draws the progress state), so no one types into
    // the old notes while the new ones are being written.
    this.ingest = { ...this.ingest, status: 'pending', windowsDone: 0, error: null };
    const token = this.#openToken;
    try {
      await this.#sendPageImages(fileId, token);
      if (token !== this.#openToken) return null;
      const view = await bridge().notesIngest({ fileId, force: true });
      if (token !== this.#openToken) return null;
      this.#adopt(view);
    } catch (err) {
      this.ingest = { ...this.ingest, status: 'failed', error: message(err) };
    }
    return null;
  }

  /** The document JSON the editor host should mount. Plain, never a proxy. */
  docJson(): unknown {
    return this.#docJson;
  }

  slides(): SlideSource | null {
    return this.#slides;
  }

  #reset(): void {
    this.#cancelAnimations();
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#savePending = false;
    /**
     * **Letting the old deck go must never stop the new one opening.** `#reset()` is the first
     * thing `open()` does, so anything that throws in here takes the whole open with it —
     * silently, because `open()`'s own `catch` only sets `this.error` after `this.fileId` has
     * been cleared. That is exactly how a `TypeError` in pdf.js teardown made the second deck a
     * learner opened do nothing at all (20 Sep). Releasing a document is best-effort by
     * definition; it is not a reason to refuse to read the next one.
     */
    try {
      this.#slides?.destroy();
    } catch (err) {
      console.warn('notes: the previous deck did not close cleanly —', message(err));
    }
    this.#slides = null;
    this.slidesReady = false;
    this.#docJson = null;
    this.docId = null;
    this.title = '';
    this.pageCount = 0;
    this.version = 0;
    this.frozen = false;
    this.edits = [];
    this.suggestions = [];
    this.cursors = [];
    this.overview = null;
    this.blockActions = {};
    this.recommendationStates = {};
    this.updatingOverview = false;
    this.bannerDismissed = null;
    this.#awaitingRewrite = false;
    this.#ingestStarting = false;
    for (const timer of this.#lineTimers.values()) clearTimeout(timer);
    this.#lineTimers.clear();
    this.error = null;
    this.rasterising = null;
    this.learnerTouched = false;
    this.slideDrag = null;
    this.#slideOverrides = [];
    this.#pageTexts = null;
    this.#slideInputs++;
    this.#groupsMemo = null;
    this.#openStrips.clear();
    // The windows read this deck's pages: a different notebook takes them with it. A tutorial
    // switching tabs is the same notebook, and the windows the notes opened stay.
    if (!this.#tutorial) closeAllSlideWindows();
    this.ingest = { ...EMPTY_INGEST };
  }

  #adopt(view: NotesDocView): void {
    /**
     * A doc adopted over a mounted editor (the overview arriving after an Update, or a refetch
     * once the ingest is ready) **replaces** it. The old view is let go here, so its teardown in
     * `detach` cannot snapshot the old document back over the new JSON, and nothing of it is saved.
     */
    if (this.#view) {
      this.#view = null;
      if (this.#saveTimer) clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
      this.#savePending = false;
      this.#cancelAnimations();
    }
    this.docId = view.docId;
    this.title = view.title;
    this.pageCount = view.pageCount;
    this.version = view.version;
    this.frozen = view.frozen;
    this.ingest = { ...view.ingest };
    this.edits = view.edits.map((edit) => ({ ...edit }));
    this.suggestions = view.suggestions.map((s) => ({ ...s }));
    // A main process from before the overview (a dev build mid-reload) sends no field at all.
    this.overview = view.overview ? structuredClone(view.overview) : null;
    this.#docJson = view.doc;
    this.epoch++;
    void this.#loadSlideInputs(view.docId);
  }

  async #openSlides(fileId: string, token: number): Promise<void> {
    try {
      const document_ = await bridge().openDocument({ fileId });
      if (token !== this.#openToken) return;
      if (document_.kind !== 'pdf' || !document_.bytes) return;
      await this.attachSlides(document_.bytes, token);
    } catch {
      // No slides is a degraded document, not a broken one: the notes still read.
    }
  }

  /**
   * Open a deck's bytes as *the* slide source for this document.
   *
   * Separate from `#openSlides` so the dev harness can hand it a real deck when the mock bridge
   * has no bytes to give — the carousel, the modal and every inline crop then run against real
   * pixels, which is the only way to see whether "pixels, not a redraw" actually holds.
   */
  async attachSlides(bytes: Uint8Array, token = this.#openToken): Promise<void> {
    const source = await SlideSource.open(bytes);
    if (token !== this.#openToken) {
      source.destroy();
      return;
    }
    this.#slides?.destroy();
    this.#slides = source;
    if (this.pageCount === 0) this.pageCount = source.pageCount;
    this.slidesReady = true;
    this.#bump();
  }

  /**
   * Rasterise the deck and hand it over in batches.
   *
   * Every failure here is swallowed on purpose. §2's images are an *optional* input to the refine
   * pass — "an ingest with no images runs on structured text + geometry alone" — so a deck that
   * will not rasterise must still open. The alternative is a file the app refuses to read because
   * one page had a broken font.
   */
  async #sendPageImages(fileId: string, token: number, only?: (part: SlidePart) => boolean): Promise<void> {
    if (!has('notesPageImages')) return;
    // A notebook's slides exist from the start (they open lazily); a lone PDF's arrive later.
    const source = this.#slides ?? (isNotebookId(fileId) ? null : await this.#waitForSlides(token));
    if (!source || token !== this.#openToken) return;
    // Notebook pages (C1): every page of the ticked, lecture PDF and image sources, or those `only` keeps.
    const raster = source.ingestRaster(only);
    if (raster.pages.length === 0) return;
    this.rasterising = { done: 0, total: raster.pages.length };
    try {
      await rasterPages(raster, {
        onProgress: (done, total) => {
          if (token === this.#openToken) this.rasterising = { done, total };
        },
        onBatch: async (images, done) => {
          if (token !== this.#openToken) return false;
          await bridge().notesPageImages({ fileId, images, done });
          return true;
        },
      });
    } catch (err) {
      // Noted above: optional input, so the ingest still runs. But it is not *silent* any more:
      // the whole of this pass failing is the difference between §2's two-pass refine and a
      // text-only one, and the only other place that shows is `with_images` in one log line.
      console.warn('notes: the slide images were not sent —', message(err));
    } finally {
      if (token === this.#openToken) this.rasterising = null;
    }
  }

  async #waitForSlides(token: number): Promise<SlideSource | null> {
    for (let i = 0; i < 100 && token === this.#openToken; i++) {
      if (this.#slides) return this.#slides;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.#slides;
  }

  // ── the editor host attaches itself ───────────────────────────────────────────────────────

  attach(view: EditorView): void {
    this.#view = view;
    // A new view starts with its caret at the top of the notes, which is not a place anyone chose.
    this.#placed = view.hasFocus();
    view.dom.addEventListener(
      'focus',
      () => {
        if (this.#view === view) this.#placed = true;
      },
      { once: true },
    );
  }

  /**
   * **The view's document is the live one; `#docJson` is only where it was when we adopted it.**
   *
   * Every ingest window, every agent edit and every keystroke after `#adopt` lands in the
   * `EditorView` and nowhere else — `#docJson` still holds whatever `notes:get` / `notes:ingest`
   * returned, which for a deck ingested in *this* session is the empty document the ingest
   * started from. So the moment the host is torn down and rebuilt on the same file, the new
   * `EditorState` is created from that stale JSON and the learner's notes vanish off the screen.
   *
   * That is exactly what a round trip through the **Page viewer** does: `VaultBrowser` unmounts
   * the whole shell on `docView === 'viewer'` and mounts it again on the way back, and `open()`
   * short-circuits because the file and the doc id have not changed, so nothing re-fetches. 63
   * blocks became 2. Nothing was lost — SQLite still had all 39 KB and a close-and-reopen
   * brought it back — but the screen said otherwise, which on a deck someone has just spent two
   * minutes ingesting is the same thing to them.
   *
   * Snapshotting here fixes it at the source rather than by ordering: whatever was on screen is
   * what the next view is built from, however the host came and went. The `epoch` is left alone
   * — nothing has changed identity, and bumping it during teardown would re-run the very effect
   * that is being cleaned up.
   */
  detach(): void {
    if (this.#view) this.#docJson = this.#view.state.doc.toJSON();
    // A save still owed is started **before** the view goes: `#save` reads the document from the
    // view, and with no view it used to return at once, so an edit made in the last 800 ms before
    // an unmount (leaving a notebook, the search page switching notebooks) was never written. A
    // save already in flight leaves its tail to the snapshot.
    const owed = Boolean(this.#saveTimer) || this.#savePending;
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    if (owed && this.docId) {
      this.#detached = { docId: this.docId, doc: this.#docJson };
      this.#savePending = false;
      void this.#save();
    }
    this.#view = null;
    this.#cancelAnimations();
  }

  /** Called by the host after every transaction it dispatched. */
  onTransaction(docChanged: boolean): void {
    if (!docChanged) return;
    const view = this.#view;
    if (!view) return;
    this.#scheduleSave();
  }

  /** The authorship plugin's `onLearnerEdit`: the learner is typing, and has touched the doc. */
  onLearnerEdit(at: number): void {
    this.#lastKeyAt = at;
    if (!this.learnerTouched) this.learnerTouched = true;
  }

  /** The learner's own writing, per block (§6). Also what the dev harness aims a suggestion at. */
  learnerText(): { blockId: string; text: string }[] {
    const view = this.#view;
    return view ? learnerTextByBlock(view.state.doc) : [];
  }

  /** The chrome plugin reads this on every rebuild. Snapshotted: no proxy leaves the store. */
  chromeContext(): ChromeContext {
    return {
      frozen: this.frozen,
      cursors: $state.snapshot(this.cursors) as AgentCursorView[],
      edits: $state.snapshot(this.edits) as DocEditRecord[],
      suggestions: $state.snapshot(this.suggestions) as Suggestion[],
      spanThreads: this.spanThreads?.() ?? [],
      onRemoveEdit: (editId) => void this.removeAgentEdit(editId),
      onKeepEdit: (editId) => void this.keepAgentEdit(editId),
      onAcceptSuggestion: (id) => void this.resolveSuggestion(id, 'accepted'),
      onRejectSuggestion: (id) => void this.resolveSuggestion(id, 'rejected'),
      onOpenSlide: (page, rect, anchor, afterBlockId) => this.openSlide(page, rect, anchor, afterBlockId ?? null),
      onInsertSlide: (target, afterBlockId) => void this.insertSlide(target.page, target.rect, afterBlockId),
      onFocusThread: (threadId) => this.focusThread?.(threadId),
      // The overview (`notebooks.md` §3–§5): chips through the notebook, the toolbar, the
      // objectives' fills, and the recommended blocks.
      sources: this.#notebookParts(this.fileId),
      objectives: objectiveFills(this.progressView?.() ?? null),
      overview: this.overview ? ($state.snapshot(this.overview) as OverviewMeta) : null,
      blockActions: $state.snapshot(this.blockActions) as Record<string, BlockActionView>,
      recommendationStates: $state.snapshot(this.recommendationStates) as Record<string, RecommendationView>,
      onBlockAction: (blockId, kind) => void this.blockAction(blockId, kind),
      onRecommendation: (id, action) => void this.recommendation(id, action),
    };
  }

  /**
   * Redraw the chrome without touching the document.
   *
   * Public because one input to the chrome is **not** this store's: the span highlights come from
   * `store.chat.spanThreads` (T5), and a new thread there changes nothing in the document, so
   * nothing would otherwise tell the decoration set to rebuild. `NotesPane` watches that list and
   * calls this. Found by watching it: the thread existed, the highlight did not appear.
   */
  refreshChrome(): void {
    this.#bump();
  }

  /** Redraw the chrome without touching the document. */
  #bump(): void {
    const view = this.#view;
    if (!view) return;
    view.dispatch(bumpChrome(view.state.tr).setMeta('addToHistory', false));
  }

  /** Dispatch a transaction that is **not** the learner's: never stamped, never undoable. */
  #dispatchAgent(build: (state: EditorState) => ReturnType<EditorState['tr']['setMeta']> | null): boolean {
    const view = this.#view;
    if (!view) return false;
    const tr = build(view.state);
    if (!tr || tr.steps.length === 0) return false;
    view.dispatch(tr.setMeta(AGENT_TR, true).setMeta('addToHistory', false));
    return true;
  }

  // ── the event stream ──────────────────────────────────────────────────────────────────────

  apply(e: RoomEvent): void {
    switch (e.type) {
      case 'notes.status': {
        // A tutorial's read is reported on `tutorial:changed`, never here (`TutorialStore`).
        if (this.#tutorial) return;
        const mine = this.docId ? e.docId === this.docId : this.fileId === e.fileId;
        // During an Update the doc may come back under a new id: the notebook is what matters then.
        if (!mine && !(this.#awaitingRewrite && e.fileId === this.fileId)) return;
        const was = this.ingest.status;
        this.ingest = { ...e.ingest };
        if (e.ingest.status === 'ready' && was !== 'ready') void this.#settleAfterIngest();
        if (e.ingest.status === 'failed' && this.#awaitingRewrite) {
          this.#awaitingRewrite = false;
          this.updatingOverview = false;
        }
        return;
      }
      case 'notes.window':
        if (e.docId !== this.docId) return;
        this.appendIngestWindow(e.afterBlockId, e.blocks, e.nodes);
        return;
      case 'doc.edit':
        if (e.docId !== this.docId) return;
        this.#settleBlockActions(e.batch);
        void this.applyAgentEdit(e.batch);
        return;
      case 'doc.cursor': {
        if (e.docId !== this.docId) return;
        const rest = this.cursors.filter((c) => c.author !== e.author);
        this.cursors = e.state === 'idle' ? rest : [...rest, { author: e.author, blockId: e.blockId, state: e.state }];
        this.#bump();
        return;
      }
      case 'doc.suggestion': {
        if (e.docId !== this.docId) return;
        const open = this.suggestions.filter((s) => s.suggestionId !== e.suggestion.suggestionId);
        this.suggestions = e.suggestion.status === 'open' ? [...open, { ...e.suggestion }] : open;
        this.#bump();
        return;
      }
      default:
        return;
    }
  }

  /**
   * **The ingest (or an Update) finished.** Main wrote the overview's metadata with it, and the
   * doc this store adopted at the start did not have it, so it is read now. The whole doc is taken
   * too when this store has nothing better: after an Update (the old overview was taken down for
   * it), with no editor mounted, or when the stored doc has blocks the live one never received
   * and the learner has not typed — an overview may land in one write rather than in windows.
   */
  async #settleAfterIngest(): Promise<void> {
    const fileId = this.fileId;
    if (!fileId || !has('notesGet')) return;
    const token = this.#openToken;
    let view: NotesDocView | null;
    try {
      view = await bridge().notesGet({ fileId });
    } catch {
      return;
    }
    if (!view || token !== this.#openToken || fileId !== this.fileId) return;
    const live = this.#view;
    const stored = (view.doc as { content?: unknown[] } | null)?.content?.length ?? 0;
    if (this.#awaitingRewrite || !live || (!this.learnerTouched && stored > live.state.doc.childCount)) {
      this.#awaitingRewrite = false;
      this.updatingOverview = false;
      this.#adopt(view);
      return;
    }
    this.overview = view.overview ? structuredClone(view.overview) : null;
    this.#bump();
  }

  /**
   * An ingest window (§2). **Append only** — it never touches an existing block, which is why it
   * cannot collide with a learner who is already typing in the document.
   */
  appendIngestWindow(afterBlockId: string | null, blocks: readonly DocBlockDraft[], nodes?: readonly unknown[]): void {
    // Main's own nodes when it sent them — the same block ids as the stored document, so the
    // save that follows cannot rebase a second copy of this window in (`ops.ts` `appendNodes`).
    let exact: PmNode[] | null = null;
    if (nodes && nodes.length > 0) {
      try {
        exact = nodes.map((json) => PmNode.fromJSON(notesSchema, json));
      } catch {
        exact = null;
      }
    }
    const applied = this.#dispatchAgent((state) =>
      exact ? appendNodes(state, afterBlockId, exact) : appendWindow(state, afterBlockId, blocks),
    );
    if (applied) {
      this.#bump();
      void this.#save();
    }
  }

  // ── agent edits (§5) ──────────────────────────────────────────────────────────────────────

  /**
   * Apply one agent batch, animate it, report it, save it.
   *
   * The order is the whole of §5 in one method:
   *   1. **Frozen ⇒ dropped**, reported, nothing built. Not queued. Not remembered.
   *   2. `applyBatch` runs the guard and produces one transaction (or a suggestion instead).
   *   3. It is dispatched **whole**, so the text carries its author mark and `editId` from the
   *      first frame, and only its *visibility* is then animated.
   *   4. The doc scrolls to it **only if the learner is not typing**.
   *   5. Main is told what happened, and the document is saved.
   */
  async applyAgentEdit(batch: AgentDocOpBatch): Promise<void> {
    const view = this.#view;
    const docId = this.docId;
    if (!view || !docId) return;

    if (this.frozen) {
      // The cursor goes with the edit. Main sent `typing` a beat before this batch; leaving that
      // flag parked mid-paragraph would say an agent is writing in a document it is locked out of.
      this.cursors = this.cursors.filter((cursor) => cursor.author !== batch.author);
      await this.#reportEdit(batch.editId, 'dropped_frozen', []);
      return;
    }

    const result = applyBatch(view.state, batch, {
      frozen: false,
      docId,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-shot timestamp
      now: new Date().toISOString(),
    });

    if (!result.tr || result.status !== 'applied') {
      await this.#reportEdit(batch.editId, 'rejected_guard', result.blockIds, result.suggestion);
      return;
    }

    const ranges = insertedRanges([result.tr]);
    view.dispatch(result.tr.setMeta(AGENT_TR, true).setMeta('addToHistory', false));
    // An addition to a folded concept card opens it, so nothing an agent writes lands out of sight
    // (`notebooks.md` §11.2, amended 2026-10-06). View state: no steps, nothing saved or undoable.
    // The touched blocks alone, never with the focus: an addition's focus is often the card itself,
    // and a card named among the blocks reads as a whole new card, which stays folded.
    revealInView(view, result.blockIds);
    if (batch.focusBlockId) revealInView(view, [batch.focusBlockId]);

    const record: DocEditRecord = {
      editId: batch.editId,
      docId,
      author: batch.author,
      cause: batch.cause,
      ops: batch.ops,
      status: 'applied',
      blockIds: result.blockIds,
      why: batch.why,
      turnId: null,
      messageId: null,
      objectiveId: null,
      docVersion: this.version,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-shot timestamp
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.edits = [...this.edits.filter((e) => e.editId !== batch.editId), record];
    if (result.suggestion) {
      this.suggestions = [...this.suggestions, { ...result.suggestion }];
    }

    this.#animate(batch.editId, batch.author, ranges);
    if (batch.focusBlockId) this.#followAgent(batch.focusBlockId);
    this.#bump();

    await this.#reportEdit(batch.editId, 'applied', result.blockIds, result.suggestion);
    await this.#save();
  }

  /** **Remove** (§5): the edit comes out, and the learner's own words never come with it. */
  async removeAgentEdit(editId: string): Promise<void> {
    const edit = this.edits.find((e) => e.editId === editId);
    this.#stopAnimation(editId);
    const applied = this.#dispatchAgent((state) =>
      removeEdit(state, { editId, blockIds: edit ? [...edit.blockIds] : [] }),
    );
    this.edits = this.edits.filter((e) => e.editId !== editId);
    this.#bump();
    if (applied) await this.#save();
    await this.#reportEdit(editId, 'removed', edit ? [...edit.blockIds] : []);
  }

  /** **Keep** (§5): the colour goes, the text and its provenance stay. */
  async keepAgentEdit(editId: string): Promise<void> {
    const edit = this.edits.find((e) => e.editId === editId);
    this.#stopAnimation(editId);
    const applied = this.#dispatchAgent((state) =>
      keepEdit(state, { editId, blockIds: edit ? [...edit.blockIds] : [] }),
    );
    this.edits = this.edits.filter((e) => e.editId !== editId);
    this.#bump();
    if (applied) await this.#save();
    await this.#reportEdit(editId, 'kept', edit ? [...edit.blockIds] : []);
  }

  /** Accept · Reject on a suggestion (§5.4). Rejecting leaves the learner's text untouched. */
  async resolveSuggestion(suggestionId: string, status: 'accepted' | 'rejected'): Promise<void> {
    const applied = this.#dispatchAgent((state) =>
      status === 'accepted' ? acceptSuggestion(state, suggestionId) : rejectSuggestion(state, suggestionId),
    );
    this.suggestions = this.suggestions.filter((s) => s.suggestionId !== suggestionId);
    this.#bump();
    if (applied) await this.#save();
    if (this.docId && has('notesSuggestionResolved')) {
      try {
        await bridge().notesSuggestionResolved({ docId: this.docId, suggestionId, status });
      } catch {
        // The document is right; the record is main's to reconcile.
      }
    }
  }

  async #reportEdit(
    editId: string,
    status: DocEditStatus,
    blockIds: string[],
    suggestion?: Suggestion | null,
  ): Promise<void> {
    if (!this.docId || !has('notesEditResolved')) return;
    try {
      await bridge().notesEditResolved({
        docId: this.docId,
        editId,
        status,
        blockIds: [...blockIds],
        docVersion: this.version,
        ...(suggestion ? { suggestion: { ...suggestion } } : {}),
      });
    } catch {
      // Reporting is bookkeeping; the document itself is already right.
    }
  }

  // ── the typing animation (§5) ─────────────────────────────────────────────────────────────

  #animate(editId: string, author: AgentAuthor, ranges: Range[]): void {
    const view = this.#view;
    if (!view || ranges.length === 0) return;
    const text = revealText(view.state.doc, ranges);
    const steps = typingSchedule(text);
    if (steps.length === 0) return;

    view.dispatch(
      reveal
        .start(view.state.tr, { editId, author, ranges, revealed: 0, total: text.length })
        .setMeta(AGENT_TR, true)
        .setMeta('addToHistory', false),
    );

    let index = 0;
    const started = Date.now();
    const tick = (): void => {
      const live = this.#view;
      if (!live) return;
      const step = steps[index];
      if (!step) {
        this.#animations.delete(editId);
        live.dispatch(reveal.finish(live.state.tr, editId).setMeta(AGENT_TR, true).setMeta('addToHistory', false));
        // The agent has stopped typing, so its cursor goes with the animation. Main will send
        // its own `doc.cursor idle` a moment later; without this the flag would sit in the
        // middle of a paragraph until it did, which reads as a bug rather than as presence.
        if (!this.#animations.has(editId)) {
          this.cursors = this.cursors.filter((cursor) => cursor.author !== author);
        }
        this.#bump();
        return;
      }
      index++;
      live.dispatch(
        reveal
          .advance(live.state.tr, editId, step.revealed)
          .setMeta(AGENT_TR, true)
          .setMeta('addToHistory', false),
      );
      // The cursor moves with the frontier, so redraw the chrome with it.
      this.#bump();
      const next = steps[index];
      const delay = next ? Math.max(0, started + next.at - Date.now()) : 60;
      this.#animations.set(editId, setTimeout(tick, delay));
    };
    this.#animations.set(editId, setTimeout(tick, steps[0]!.at));
  }

  #stopAnimation(editId: string): void {
    const timer = this.#animations.get(editId);
    if (timer) clearTimeout(timer);
    this.#animations.delete(editId);
    const view = this.#view;
    if (view) {
      view.dispatch(reveal.finish(view.state.tr, editId).setMeta(AGENT_TR, true).setMeta('addToHistory', false));
    }
  }

  #cancelAnimations(): void {
    for (const timer of this.#animations.values()) clearTimeout(timer);
    this.#animations.clear();
  }

  /** §5: "the doc scrolls to it **only if the learner is not typing**". */
  #followAgent(blockId: string): void {
    if (learnerIsTyping(this.#lastKeyAt, Date.now())) return;
    this.scrollToBlock(blockId, { flash: false });
  }

  // ── the agreed cross-track surface ────────────────────────────────────────────────────────

  /** T5 → T4: a thread's "jump" and a lesson card's Start land here. */
  scrollToBlock(blockId: string, options: { flash?: boolean } = {}): void {
    const view = this.#view;
    if (!view) return;
    if (!blockPos(view.state.doc, blockId)) return;
    // A block folded inside a concept card is opened first, or there is nothing on screen to scroll
    // to (`pm/concept.ts`). A steps-free transaction: not a learner edit, not saved.
    revealInView(view, [blockId]);
    const target = blockPos(view.state.doc, blockId);
    if (!target) return;
    const dom = view.nodeDOM(target.pos) ?? view.domAtPos(target.pos + 1).node;
    const element = dom instanceof HTMLElement ? dom : (dom as globalThis.Node | null)?.parentElement;
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (options.flash === false) return;
    element.classList.add('nd-flash');
    setTimeout(() => element.classList.remove('nd-flash'), 1_400);
  }

  /** Is this block in the document on screen? (The chat asks, to route a thread's jump.) */
  hasBlock(blockId: string): boolean {
    const view = this.#view;
    return view ? blockPos(view.state.doc, blockId) !== null : false;
  }

  /**
   * The heading of the section a block is in: its own text when it is a heading, else the last
   * heading above it. A tutorial part's *From the notes:* chip names the notes' section this way.
   */
  headingFor(blockId: string): string | null {
    const view = this.#view;
    if (!view) return null;
    let last: string | null = null;
    let found: string | null | undefined;
    view.state.doc.forEach((node) => {
      if (found !== undefined) return;
      const isHeading = node.type.name === 'heading';
      if (isHeading) last = node.textContent.trim() || last;
      if (blockAttrs(node).blockId === blockId) {
        found = last;
        return;
      }
      let inside = false;
      node.descendants((child) => {
        if (inside) return false;
        if (blockAttrs(child).blockId === blockId) inside = true;
        return !inside;
      });
      if (inside) found = last;
    });
    return found ?? null;
  }

  /**
   * Redraw a plugin's decorations without touching the document: `mark` sets that plugin's meta
   * (the tutorial chrome's `bumpTutorialChrome`, the practice chips'). Not undoable, not saved.
   */
  redraw(mark: (tr: Transaction) => Transaction): void {
    const view = this.#view;
    if (!view) return;
    view.dispatch(mark(view.state.tr).setMeta('addToHistory', false));
  }

  /** Is an editor on screen for this store? */
  mounted(): boolean {
    return this.#view !== null;
  }

  /** Everything on screen written to main, waiting for it (the search page, before it switches notebooks). */
  async flush(): Promise<void> {
    await this.#flushSave();
  }

  /** The caret at the start of a block, the editor focused (the search page's ↵). False if not found. */
  placeCaret(blockId: string): boolean {
    const view = this.#view;
    if (!view) return false;
    const target = blockPos(view.state.doc, blockId);
    if (!target) return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target.pos + 1))).scrollIntoView());
    view.focus();
    return true;
  }

  /**
   * The search page's hit, highlighted until another is picked: a decoration set by a steps-free
   * transaction (`pm/searchhit.ts`), so nothing is saved or undoable. False when no editor or no
   * such block yet (the doc is still loading): the caller tries again.
   */
  markSearchHit(blockId: string | null): boolean {
    const view = this.#view;
    if (!view) return false;
    if (blockId && !blockPos(view.state.doc, blockId)) return false;
    view.dispatch(setSearchHit(view.state.tr, blockId));
    return true;
  }

  /** T5 → T4: "insert into the document" needs to know where the learner's caret is. */
  caretBlockId(): string | null {
    const view = this.#view;
    if (!view) return null;
    // Not `$from`: a `$`-prefixed identifier is reserved inside a `.svelte.ts` module.
    const at = view.state.selection.$from;
    for (let depth = at.depth; depth >= 0; depth--) {
      const node = at.node(depth);
      const { blockId } = blockAttrs(node);
      if (blockId) return blockId;
    }
    return null;
  }

  // ── read aloud (`readaloud.ts`, 2026-10-01): read-only, and never a change to the doc ─────

  /** The live document and where the cursor is, for Listen to find its section. Null unmounted. */
  readingSource(): { doc: PmNode; pos: number } | null {
    const view = this.#view;
    return view ? { doc: view.state.doc, pos: view.state.selection.from } : null;
  }

  /**
   * Highlight the block being read, or clear it with null. A decoration set by a transaction
   * with no steps: `onTransaction` sees `docChanged` false, so nothing is saved and nothing is
   * undoable (`pm/readaloud.ts`).
   */
  markReading(blockId: string | null): void {
    const view = this.#view;
    if (view) view.dispatch(setReading(view.state.tr, blockId));
  }

  /** The same test `#followAgent` uses: a reading does not move the page under a typing learner. */
  learnerTyping(): boolean {
    return learnerIsTyping(this.#lastKeyAt, Date.now());
  }

  /** Ctrl+E / ⌘E: hand the selected span to the chat column (T5 opens the draft thread). */
  askAboutSelection(): boolean {
    const view = this.#view;
    if (!view) return false;
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    const blockId = this.caretBlockId();
    if (!blockId) return false;
    const quote = view.state.doc.textBetween(from, to, ' ', ' ').trim();
    if (!quote) return false;
    this.askAboutSpan?.({ blockId, quote, ...this.#docKey() });
    return true;
  }

  // ── Freeze (§3) ───────────────────────────────────────────────────────────────────────────

  async setFrozen(frozen: boolean): Promise<void> {
    this.frozen = frozen;
    if (frozen) this.cursors = [];
    this.#bump();
    if (!this.docId || !has('notesFreeze')) return;
    try {
      const result = await bridge().notesFreeze({ docId: this.docId, frozen });
      this.frozen = result.frozen;
      this.#bump();
    } catch (err) {
      this.error = message(err);
    }
  }

  // ── each section's slides (2026-10-03) ──────────────────────────────────────────────────

  /** The learner's moves and the page texts, for the document just adopted. Best effort. */
  async #loadSlideInputs(docId: string): Promise<void> {
    const api = slideApi();
    const fileId = this.fileId;
    const [overrides, texts] = await Promise.all([
      api.notesSlideGroups ? api.notesSlideGroups({ docId }).catch(() => null) : Promise.resolve(null),
      api.notesPageTexts && fileId ? api.notesPageTexts({ fileId }).catch(() => null) : Promise.resolve(null),
    ]);
    if (this.docId !== docId) return;
    if (overrides) this.#slideOverrides = overrides;
    // A plain Map on purpose: only the grouping reads it, and nothing renders it.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    if (texts) this.#pageTexts = new Map(Object.entries(texts).map(([page, text]) => [Number(page), text]));
    this.#slideInputs++;
    this.#bumpStrips();
  }

  /**
   * **Which slides go under which section** (`shared/doc/slidegroups.ts`). Memoised per document
   * and per change to the inputs, because the strips ask on every rebuild and the answer only
   * changes when the blocks, the learner's moves or the page texts do.
   */
  slideGroupsFor(doc: PmNode): SlideGroup[] {
    const memo = this.#groupsMemo;
    if (memo && memo.doc === doc && memo.inputs === this.#slideInputs) return memo.groups;
    const all = this.#slides?.pages() ?? Array.from({ length: this.pageCount }, (_, i) => i + 1);
    const texts = this.#pageTexts;
    const groups = slideGroups({
      doc,
      pages: all,
      pageText: texts ? (page) => texts.get(page) ?? null : undefined,
      overrides: this.#slideOverrides,
    });
    this.#groupsMemo = { doc, inputs: this.#slideInputs, groups };
    return groups;
  }

  /** The groups of the document on screen, for the drop targets while a slide is dragged. */
  slideGroupList(): SlideGroup[] {
    const view = this.#view;
    return view ? this.slideGroupsFor(view.state.doc) : [];
  }

  /** What the strips plugin reads (`pm/slidestrip.ts`). */
  stripContext(): StripContext {
    return {
      groups: (doc) => this.slideGroupsFor(doc),
      slides: () => this.#slides,
      isOpen: (key) => this.#openStrips.has(key),
      onToggle: (key) => {
        if (this.#openStrips.has(key)) this.#openStrips.delete(key);
        else this.#openStrips.add(key);
        this.#bumpStrips();
      },
      onOpen: (group, page, anchor) => {
        openSlideWindow({
          anchor,
          pages: group.pages,
          index: Math.max(0, group.pages.indexOf(page)),
          reader: this.#slideReader(),
          // A slide inserted from a section's strip goes at the end of that section.
          onInsert: (target) => this.insertSlide(target.page, target.rect, group.lastBlockId),
        });
      },
      onDragStart: (group, page) => {
        this.slideDrag = { page, from: group.key };
      },
      onDragEnd: () => {
        this.slideDrag = null;
      },
    };
  }

  /**
   * **A slide dropped on a section** (§3b): the learner's call, kept for this document and over
   * every later regrouping (main remaps it by heading text when Update overview rewrites the
   * headings). Shown at once; the stored list main sends back replaces it.
   */
  async moveSlide(page: number, key: string, title: string): Promise<void> {
    this.slideDrag = null;
    const docId = this.docId;
    if (!docId) return;
    this.#slideOverrides = [...this.#slideOverrides.filter((o) => o.page !== page), { page, key, title }];
    this.#slideInputs++;
    this.#bumpStrips();
    const api = slideApi();
    if (!api.notesSetSlideGroup) return;
    try {
      const stored = await api.notesSetSlideGroup({ docId, page, key, title });
      if (this.docId !== docId) return;
      this.#slideOverrides = stored;
      this.#slideInputs++;
      this.#bumpStrips();
    } catch (err) {
      console.warn('notes: the slide move was not saved —', message(err));
    }
  }

  #bumpStrips(): void {
    const view = this.#view;
    if (!view) return;
    view.dispatch(bumpStrips(view.state.tr).setMeta('addToHistory', false));
  }

  #slideReader(): SlideReader {
    return { slides: () => this.#slides, pageLines: (page) => pageLinesFor(this.fileId, page) };
  }

  // ── a slide, beside what was clicked (2026-10-03) ─────────────────────────────────────────

  /**
   * Open a slide in a window beside `anchor` (a chip, a figure, a thumbnail), which stays, moves
   * and resizes until the learner closes it (`pm/slidewindow.ts`). The in-doc modal this replaced
   * covered the notes. A slide already open in a window comes to the front instead. With no anchor
   * (the dev harness's buttons) it opens by the notes column's right edge.
   */
  openSlide(page: number, rect: Rect | null = null, anchor?: HTMLElement, afterBlockId: string | null = null): void {
    openSlideWindow({
      anchor: anchor ?? this.#fallbackAnchor(),
      pages: [page],
      rect,
      reader: this.#slideReader(),
      onInsert: (target) => this.insertSlide(target.page, target.rect, afterBlockId),
    });
  }

  /**
   * **An image's click** (2026-10-03): its slide in a window, with the image's crop as an editable
   * box; a moved or resized box is written back to the image (`pm/image.ts`). Insert from that
   * window goes after the image's own block.
   */
  openImage(input: {
    page: number;
    rect: Rect | null;
    anchor: HTMLElement;
    blockId: string | null;
    onRecrop: (rect: Rect | null) => void;
  }): void {
    openSlideWindow({
      anchor: input.anchor,
      pages: [input.page],
      rect: input.rect,
      rectPage: input.page,
      reader: this.#slideReader(),
      crop: { onChange: input.onRecrop },
      onInsert: (target) => this.insertSlide(target.page, target.rect, input.blockId),
    });
  }

  /** Close every slide window. */
  closeSlide(): void {
    closeAllSlideWindows();
  }

  #fallback: HTMLElement | null = null;

  #fallbackAnchor(): HTMLElement {
    const column = this.#view?.dom.closest<HTMLElement>('.nd') ?? document.body;
    const box = column.getBoundingClientRect();
    this.#fallback ??= document.createElement('span');
    const anchor = this.#fallback;
    anchor.className = 'nd-slide-fallback';
    anchor.style.cssText = `position:fixed;width:1px;height:1px;left:${String(Math.round(box.right - 40))}px;top:${String(Math.round(box.top + 90))}px;`;
    if (!anchor.isConnected) document.body.append(anchor);
    return anchor;
  }

  /**
   * **Insert a slide, or a crop of one, into the notes** (2026-10-03): a `slide_figure` after the
   * block it was opened from, or the caret's block, or at the end. The learner's own edit, so it is
   * undoable and saved like typing; the figure's page counts towards the section it lands in.
   */
  insertSlide(page: number, rect: Rect | null, afterBlockId: string | null = null): boolean {
    return this.#insertImage(page, rect, afterBlockId) !== null;
  }

  /**
   * **An image dropped on the sheet** (2026-10-04): the whole page of the image source it became,
   * after the block it was dropped on (`dropguard.ts` `dropAnchor`). Returns the new block's id,
   * so the next of several dropped together goes after it and they keep the order they came in.
   */
  insertDroppedImage(page: number, afterBlockId: string | null): string | null {
    return this.#insertImage(page, null, afterBlockId);
  }

  #insertImage(page: number, rect: Rect | null, afterBlockId: string | null): string | null {
    const view = this.#view;
    if (!view) return null;
    const state = view.state;
    // After the block (a block inside a Q block: after the Q block). In a concept card's depth, in
    // the same item; from its core line, after the card (`pm/insertat.ts`, as the ops place it).
    let pos: number | null = afterBlockId ? insertPosAfter(state.doc, afterBlockId) : null;
    if (pos === null && this.#placed) pos = caretInsertPos(state);
    if (pos === null) pos = state.doc.content.size;
    // A paragraph holding the image, in line with text (2026-10-03), with its id now, not at the
    // authorship stamp's leisure: the strips and the chips key on it.
    const blockId = newBlockId();
    const tr = state.tr.insert(pos, imageParagraph(page, rect, blockId));
    // The image selected, its corner handles showing: the next thing a learner does is size it.
    tr.setSelection(NodeSelection.create(tr.doc, pos + 1)).scrollIntoView();
    view.dispatch(tr);
    view.focus();
    return blockId;
  }

  // ── §6: the learner's own doc text ────────────────────────────────────────────────────────
  //
  // **Typing in the doc is just writing** (Lucas, 1 Oct 2026, #58; `notebooks.md` §7). A pause in
  // the learner's own text is no longer reported to main as an attempt: no agent reads it, answers
  // it, or writes under it. The learner's words in the doc move the bar only when they say so —
  // Submit in a Q block (`answerQuestion` below), or an answer in the chat.

  // ── questions in the notes: answer in place, and the learner's own (2026-10-01) ───────────

  /**
   * **Add a question**: the header's button. An empty Q block of the learner's own after the
   * block their cursor is in, with the caret in it. Their gesture, so it is in the undo history.
   */
  addOwnQuestion(): boolean {
    const view = this.#view;
    if (!view) return false;
    const done = insertOwnQuestion(view.state, (tr) => view.dispatch(tr));
    if (done) view.focus();
    return done;
  }

  /**
   * **Submit answer** on a Q block (`pm/nodeviews.ts`): hand the learner's answer to main to be
   * marked, and say what main said.
   *
   * **Saved first.** Main marks against the *stored* document (it is where a suggestion on the
   * answer would land, and where it reads the question from), and the answer was typed within
   * the save debounce more often than not, so the pending save is flushed before the call.
   *
   * Unlike `#reportDocText` this is the learner's explicit gesture, so nothing is swallowed: a
   * refusal is returned for the block to say, and a failed call rejects for the block to say too.
   */
  async answerQuestion(parts: QuestionAnswer): Promise<NotesAnswerQuestionResult> {
    const fileId = this.fileId;
    const docId = this.docId;
    if (!fileId || !docId || !has('notesAnswerQuestion')) {
      return { accepted: false, threadId: null, reason: 'no_doc' };
    }
    await this.#flushSave();
    const result = await bridge().notesAnswerQuestion({ fileId, docId, ...parts });
    // The feedback lands in a thread, which for a question of the learner's own is a new one.
    if (result.accepted && result.threadId && this.fileId === fileId) this.focusThread?.(result.threadId);
    return result;
  }

  // ── Insert ▸ Table / Diagram (2026-10-01) ─────────────────────────────────────────────────

  /**
   * The block an Insert would go after: the top-level block holding the caret (`pm/insertat.ts`).
   * Null until the learner has put the caret somewhere, because a view's first caret is at the
   * top of the notes and Ellie's table would land under the title for no reason anyone gave.
   */
  insertTarget(): string | null {
    const view = this.#view;
    if (!view || !this.#placed) return null;
    return insertTargetId(view.state);
  }

  /**
   * **A press in the margin beside the notes** (2026-10-03): the caret goes to that end of the line
   * level with it, as in Word, rather than nowhere. Most useful beside a wide image, where the line
   * has no room of its own to click into. False when it was not beside a line.
   */
  placeCaretBeside(x: number, y: number): boolean {
    const view = this.#view;
    if (!view) return false;
    const box = view.dom.getBoundingClientRect();
    if (y < box.top || y > box.bottom) return false;
    const left = Math.min(Math.max(x, box.left + 1), box.right - 1);
    const hit = view.posAtCoords({ left, top: y });
    if (!hit) return false;
    const at = view.state.doc.resolve(hit.pos);
    if (!at.parent.isTextblock) return false;
    const pos = x >= box.right ? at.end() : x <= box.left ? at.start() : hit.pos;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    return true;
  }

  /**
   * **Insert ▸ Formula** (2026-10-03): the formula editor at the caret, as ⌘⇧E opens it
   * (`pm/math.ts`). The learner's own, not Ellie's: nothing is generated. False when there is no
   * caret in the notes yet, or it is somewhere a formula cannot go.
   */
  writeFormula(): boolean {
    const view = this.#view;
    if (!view || !this.#placed) return false;
    view.focus();
    return editFormula(view.state, view.dispatch, view);
  }

  /**
   * **Insert ▸ Table or Diagram**: ask main for Ellie's block after the one the caret is in, and
   * say what main said. On success the block itself arrives on its own, as Ellie's edit on the
   * ordinary `doc.edit` path, so nothing here touches the document.
   *
   * **Saved first**, as `answerQuestion` is: main reads the section from the *stored* document,
   * and the caret's block may be one the learner made within the save debounce.
   */
  async generateBlock(
    kind: GeneratedBlockKind,
    instruction: string | null,
    /** The block to insert after; the caret's block when not given (Insert). A recommendation's is its section's last. */
    at?: string,
  ): Promise<GenerateBlockOutcome> {
    const fileId = this.fileId;
    const docId = this.docId;
    if (!fileId || !docId || !this.#view || !has('notesGenerateBlock')) {
      return { inserted: false, editId: null, reason: 'no_doc' };
    }
    if (this.frozen) return { inserted: false, editId: null, reason: 'frozen' };
    const blockId = at ?? this.insertTarget();
    if (!blockId) return { inserted: false, editId: null, reason: 'no_place' };
    await this.#flushSave();
    const text = instruction?.trim() ?? '';
    return bridge().notesGenerateBlock({ fileId, docId, blockId, kind, instruction: text.length > 0 ? text : null });
  }

  // ── the overview's actions (`notebooks.md` §2, §4, §5.3) ──────────────────────────────────

  /**
   * **Explain · Example · Quiz me · Ask…** on one block (§4.1). Ask… opens the composer with the
   * block quoted and goes no further (C7). The other three go to main (`notes:blockAction`),
   * saved first because main reads the block from the stored doc. Accepted, the chat brings the
   * block's thread into view and the block says "Ellie is writing…" until her edit arrives (or
   * her cursor goes idle); refused, it says why in one line under the block.
   */
  async blockAction(blockId: string, kind: BlockActionKind): Promise<void> {
    const view = this.#view;
    const found = view ? blockPos(view.state.doc, blockId) : null;
    if (!found) return;
    const quote = blockQuote(found.node);
    if (kind === 'ask') {
      this.askAboutSpan?.({ blockId, quote, ...this.#docKey() });
      return;
    }
    const fileId = this.fileId;
    const docId = this.docId;
    if (this.blockActions[blockId]?.state === 'running') return;
    if (!fileId || !docId || !has('notesBlockAction')) {
      this.#refuseBlock(blockId, kind, blockActionRefusal('no_doc'));
      return;
    }
    const author: AgentAuthor = kind === 'quiz' ? 'max' : 'ellie';
    this.#setBlockLine(blockId, { kind, author, state: 'running', line: kind === 'quiz' ? 'Max is asking…' : 'Ellie is writing…' }, BLOCK_ACTION_MS);
    try {
      await this.#flushSave();
      const main = this.#tutorial ? (this.mainTutorial?.() ?? null) : null;
      const result = await bridge().notesBlockAction({
        fileId,
        docId,
        blockId,
        kind,
        quote,
        ...this.#docKey(),
        ...(main ? { mainTutorial: main } : {}),
      });
      if (fileId !== this.fileId) return;
      if (!result.accepted) {
        this.#refuseBlock(blockId, kind, blockActionRefusal(result.reason));
        // Max's open question is in its own thread (N3): bring it up beside the line saying so.
        if (result.reason === 'question_open' && result.threadId) this.focusThread?.(result.threadId);
        return;
      }
      if (result.threadId) this.focusThread?.(result.threadId);
      // Frozen: the answer is the chat's alone (§4.2), so there is no edit to wait for here.
      if (this.frozen) this.#clearBlockLine(blockId);
    } catch (err) {
      if (fileId === this.fileId) this.#refuseBlock(blockId, kind, blockActionRefusal('failed'));
      console.warn('notes: block action failed —', message(err));
    }
  }

  #refuseBlock(blockId: string, kind: BlockActionKind, line: string): void {
    this.#setBlockLine(blockId, { kind, author: kind === 'quiz' ? 'max' : 'ellie', state: 'refused', line }, REFUSAL_MS);
  }

  #setBlockLine(blockId: string, value: BlockActionView, ttl: number): void {
    this.blockActions = { ...this.blockActions, [blockId]: value };
    this.#bump();
    const key = `block:${blockId}`;
    const old = this.#lineTimers.get(key);
    if (old) clearTimeout(old);
    this.#lineTimers.set(key, setTimeout(() => this.#clearBlockLine(blockId), ttl));
  }

  #clearBlockLine(blockId: string): void {
    const key = `block:${blockId}`;
    const timer = this.#lineTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#lineTimers.delete(key);
    if (!(blockId in this.blockActions)) return;
    const { [blockId]: _gone, ...rest } = this.blockActions;
    this.blockActions = rest;
    this.#bump();
  }

  /**
   * The agent's edit for a block landed: what it was doing there is done. Matched on the block
   * the edit is anchored at (N3: the one line is `insert_after` the block, Max's question
   * `insert_q` under it), not on the IPC resolving, which happens before Ellie has written
   * anything. A frozen doc gets no edit; `blockAction` clears the line itself then.
   */
  #settleBlockActions(batch: AgentDocOpBatch): void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local scratch set
    const anchors = new Set<string>([batch.focusBlockId ?? '']);
    for (const op of batch.ops) {
      if ('anchorBlockId' in op && typeof op.anchorBlockId === 'string') anchors.add(op.anchorBlockId);
    }
    for (const [blockId, value] of Object.entries(this.blockActions)) {
      if (value.state === 'running' && value.author === batch.author && anchors.has(blockId)) this.#clearBlockLine(blockId);
    }
  }

  /**
   * A section's **recommended block** (§5.3): **Add** generates it at the end of its section by
   * the Insert path (`generateBlock`), then marks it added; **✕** marks it dismissed. The card
   * goes as soon as main says so, from the `OverviewMeta` main returns.
   */
  async recommendation(id: string, action: 'add' | 'dismiss'): Promise<void> {
    const fileId = this.fileId;
    const docId = this.docId;
    const rec = this.overview?.recommendations.find((r) => r.id === id);
    if (!fileId || !docId || !rec || !has('notesSetRecommendation')) return;
    if (this.recommendationStates[id]?.state === 'adding') return;
    if (action === 'add') {
      const view = this.#view;
      const section = view ? sectionSpans(view.state.doc).find((s) => s.headingBlockId === rec.headingBlockId) : null;
      if (!section) return;
      this.#setRecLine(id, { state: 'adding', line: 'Ellie is making it…' }, BLOCK_ACTION_MS);
      let outcome: GenerateBlockOutcome;
      try {
        outcome = await this.generateBlock(rec.kind, rec.description, section.lastBlockId);
      } catch (err) {
        outcome = { inserted: false, editId: null, reason: 'failed' };
        console.warn('notes: recommended block failed —', message(err));
      }
      if (fileId !== this.fileId) return;
      if (!outcome.inserted) {
        this.#setRecLine(id, { state: 'refused', line: generateRefusal(outcome.reason) }, REFUSAL_MS);
        return;
      }
    }
    const status = action === 'add' ? 'added' : 'dismissed';
    try {
      const next = await bridge().notesSetRecommendation({ fileId, docId, recommendationId: id, status });
      if (fileId !== this.fileId) return;
      this.overview = next
        ? structuredClone(next)
        : this.overview && {
            ...this.overview,
            recommendations: this.overview.recommendations.map((r) => (r.id === id ? { ...r, status } : r)),
          };
    } catch (err) {
      console.warn('notes: the recommendation was not marked —', message(err));
    }
    this.#clearRecLine(id);
  }

  #setRecLine(id: string, value: RecommendationView, ttl: number): void {
    this.recommendationStates = { ...this.recommendationStates, [id]: value };
    this.#bump();
    const key = `rec:${id}`;
    const old = this.#lineTimers.get(key);
    if (old) clearTimeout(old);
    this.#lineTimers.set(key, setTimeout(() => this.#clearRecLine(id), ttl));
  }

  #clearRecLine(id: string): void {
    const key = `rec:${id}`;
    const timer = this.#lineTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#lineTimers.delete(key);
    if (id in this.recommendationStates) {
      const { [id]: _gone, ...rest } = this.recommendationStates;
      this.recommendationStates = rest;
    }
    this.#bump();
  }

  /**
   * **Update overview** (§2), and **Make overview** on a legacy doc: main rewrites the overview's
   * own blocks from the sources ticked now and carries the learner's text over.
   *
   * Saved first, so the learner's latest words are in the stored doc main carries over from. The
   * page images of the sources the overview has not seen go next. Then the editor is taken down
   * (`pending`), as Regenerate does: nobody types into an overview that is about to be replaced,
   * and nothing of it is saved over the new one. The new doc is read when main says `ready`
   * (`#settleAfterIngest`). Returns a line for the learner when it could not start, or null.
   */
  async updateOverview(): Promise<string | null> {
    const fileId = this.fileId;
    if (this.#tutorial || !fileId || !this.docId || !has('notesUpdateOverview') || this.updatingOverview) return null;
    const token = this.#openToken;
    this.updatingOverview = true;
    const before = { ...this.ingest };
    try {
      await this.#flushSave();
      const unseen = unseenSources(this.overview?.fingerprint ?? null, this.#notebookParts(fileId));
      await this.#sendPageImages(fileId, token, (part) => unseen.has(part.fileId));
      if (token !== this.#openToken) return null;
      if (this.#saveTimer) clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
      this.#savePending = false;
      this.#cancelAnimations();
      this.#awaitingRewrite = true;
      this.ingest = { ...this.ingest, status: 'pending', windowsDone: 0, error: null };
      const result = await bridge().notesUpdateOverview({ fileId });
      if (token !== this.#openToken) return null;
      if (!result.started) {
        this.#awaitingRewrite = false;
        this.updatingOverview = false;
        this.ingest = before;
        return updateRefusal(result.reason);
      }
      return null;
    } catch (err) {
      if (token === this.#openToken) {
        this.#awaitingRewrite = false;
        this.updatingOverview = false;
        this.ingest = before;
      }
      return message(err);
    }
  }

  /** **Not now** on the banner: hidden until the sources change again (`overviewBanner`). */
  dismissBanner(fingerprint: string): void {
    this.bannerDismissed = fingerprint;
    if (this.fileId) this.#dismissed.set(this.fileId, fingerprint);
  }

  // ── saving (§D5: optimistic, `baseVersion`) ───────────────────────────────────────────────

  #scheduleSave(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#save();
    }, SAVE_DEBOUNCE_MS);
  }

  /** `⌘S` and the header's explicit save. */
  async saveNow(): Promise<void> {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    await this.#save();
  }

  /**
   * Put what is on screen into main's hands **now**, and wait until it is there.
   *
   * `saveNow()` is not this: `#save` returns at once when a save is already in flight and leaves
   * the tail to a follow-up on the debounce. A caller that is about to have main *read* the
   * stored document needs the tail written, so this waits out the save in flight and then writes
   * whatever was still pending. It saves nothing when nothing was pending.
   */
  async #flushSave(): Promise<void> {
    // A bound, not a pacing knob: a conflict re-saves (`#rebase`), and that must end.
    for (let round = 0; round < 4; round++) {
      const waiting = this.#saveSettled;
      if (waiting) await waiting;
      if (!this.#saveTimer && !this.#savePending) {
        if (this.#saveSettled) continue;
        return;
      }
      if (this.#saveTimer) clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
      this.#savePending = false;
      await this.#save();
    }
  }

  async #save(): Promise<void> {
    const view = this.#view;
    const detached = !view && this.#detached && this.#detached.docId === this.docId ? this.#detached : null;
    if ((!view && !detached) || !this.docId || !has('notesSave')) return;
    if (this.saving) {
      // One save in flight at a time; the tail is coalesced into a single follow-up.
      this.#savePending = true;
      return;
    }
    this.saving = true;
    let settle = (): void => undefined;
    this.#saveSettled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      const result = await bridge().notesSave({
        docId: this.docId,
        baseVersion: this.version,
        doc: view ? view.state.doc.toJSON() : detached!.doc,
        learnerTouched: this.learnerTouched,
      });
      if (result.ok) {
        this.version = result.version;
        this.savedAt = Date.now();
        if (!view && this.#detached === detached) this.#detached = null;
      } else if (!view) {
        // No view to rebase into: what was on screen is the authority (§D5), saved on top.
        this.version = result.version;
        this.#savePending = true;
      } else {
        this.#rebase(result.version, result.doc);
      }
    } catch (err) {
      this.error = message(err);
    } finally {
      this.saving = false;
      this.#saveSettled = null;
      if (this.#savePending) {
        this.#savePending = false;
        this.#scheduleSave();
      }
      settle();
    }
  }

  /**
   * A save conflict.
   *
   * **The renderer is the live authority while the document is open** (§D5), so the rule is: keep
   * what is on screen and re-save on top of the version that came back. The learner is looking at
   * their own document and a rebase that replaced it would throw away words they can see.
   *
   * The one thing the stored document can legitimately have that this one does not is **blocks**
   * — an ingest window that landed in main while this renderer was busy. Those are appended, in
   * their own order, and nothing else is taken. Anything more clever than this (a real merge)
   * would be inventing an edit nobody made.
   */
  #rebase(version: number, stored: unknown): void {
    this.version = version;
    const view = this.#view;
    if (!view) return;
    let storedDoc;
    try {
      storedDoc = docFromJson(stored);
    } catch {
      void this.#save();
      return;
    }
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local scratch set
    const mine = new Set<string>();
    view.state.doc.forEach((node) => {
      const { blockId } = blockAttrs(node);
      if (blockId) mine.add(blockId);
    });
    const missing: import('prosemirror-model').Node[] = [];
    storedDoc.forEach((node) => {
      const { blockId } = blockAttrs(node);
      if (blockId && !mine.has(blockId)) missing.push(node);
    });
    if (missing.length > 0) {
      this.#dispatchAgent((state) => state.tr.insert(state.doc.content.size, missing));
    }
    void this.#save();
  }
}
