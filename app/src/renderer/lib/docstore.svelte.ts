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

import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { RoomEvent } from '../../shared/types.js';
import type {
  ChatterEdApi,
  GenerateBlockRefusal,
  NotesAnswerQuestionResult,
  NotesGenerateBlockResult,
} from '../../shared/ipc.js';
import { Node as PmNode } from 'prosemirror-model';
import {
  applyBatch,
  appendNodes,
  appendWindow,
  keepEdit,
  removeEdit,
} from '../../shared/doc/ops.js';
import { acceptSuggestion, rejectSuggestion } from '../../shared/doc/suggest.js';
import { blockAttrs, blockPos, docFromJson, notesSchema } from '../../shared/doc/schema.js';
import type {
  AgentAuthor,
  AgentDocOpBatch,
  DocBlockDraft,
  DocEditRecord,
  DocEditStatus,
  NotesDocView,
  NotesIngestView,
  Rect,
  Suggestion,
} from '../../shared/doc/types.js';
import { bridge } from './bridge.js';
import { SlideSource, pageImages } from './rasterise.js';
import { learnerIsTyping, typingSchedule } from './typing.js';
import { AGENT_TR, type Range, insertedRanges } from './pm/authorship.js';
import { bumpChrome, type AgentCursorView, type ChromeContext, type SpanThreadView } from './pm/chrome.js';
import { reveal, revealText } from './pm/reveal.js';
import { DocTextWatch, learnerTextByBlock } from './pm/doctext.js';
import { insertOwnQuestion, type QuestionAnswer } from './pm/qblock.js';
import { setReading } from './pm/readaloud.js';
import { insertTargetId } from './pm/insertat.js';

/** ≈800 ms after the last change (the brief), and immediately after an agent edit. */
const SAVE_DEBOUNCE_MS = 800;

/** How often the doc-text pause detector is polled while there is something pending. */
const DOC_TEXT_TICK_MS = 1_000;

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

export interface SlideModalTarget {
  page: number;
  rect: Rect | null;
}

/**
 * What `generateBlock` says: main's result, or the renderer's own refusal `no_place` — the caret
 * has not been put anywhere yet, so there is no block to insert after.
 */
export type GenerateBlockOutcome = Omit<NotesGenerateBlockResult, 'reason'> & {
  reason: GenerateBlockRefusal | 'no_place' | null;
};

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

  loading = $state(false);
  error = $state<string | null>(null);
  /** Non-null while the renderer is turning the deck into JPEGs for the refine pass. */
  rasterising = $state<{ done: number; total: number } | null>(null);
  saving = $state(false);
  savedAt = $state(0);
  /** True once the learner has typed anything at all into this document. */
  learnerTouched = $state(false);
  /** The in-doc slide modal (§3), or null. */
  modal = $state<SlideModalTarget | null>(null);
  /** Bumped whenever a *different* document has been loaded and the view must remount. */
  epoch = $state(0);
  slidesReady = $state(false);

  // ── plain fields: nothing here may ever become reactive ───────────────────────────────────
  #view: EditorView | null = null;
  #docJson: unknown = null;
  #slides: SlideSource | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #savePending = false;
  /** Settles when the save now in flight has finished. Null when none is. */
  #saveSettled: Promise<void> | null = null;
  #docText = new DocTextWatch();
  #docTextTimer: ReturnType<typeof setInterval> | null = null;
  // A plain Map on purpose: these are timer handles, nothing renders them, and making them
  // reactive would re-run effects on every frame of the typing animation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #animations = new Map<string, ReturnType<typeof setTimeout>>();
  #lastKeyAt = 0;
  /** The learner has put the caret somewhere in this view: Insert has a place to go (`insertTarget`). */
  #placed = false;
  #openToken = 0;

  // ── wiring set by `NotesPane` from `store.chat` (T5), so neither store imports the other ──
  askAboutSpan: ((input: { blockId: string; quote: string }) => void) | null = null;
  focusThread: ((threadId: string) => void) | null = null;
  spanThreads: (() => readonly SpanThreadView[]) | null = null;

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
    if (this.fileId === fileId && this.docId) return;
    const token = ++this.#openToken;
    this.#reset();
    this.fileId = fileId;
    this.loading = true;

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

  /** The Retry on a failed ingest (§ ingest states). */
  async retryIngest(): Promise<void> {
    const fileId = this.fileId;
    if (!fileId || !has('notesIngest')) return;
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
    if (!fileId || !has('notesRegenerate') || !has('notesIngest')) return null;
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
    this.#docText = new DocTextWatch();
    this.docId = null;
    this.title = '';
    this.pageCount = 0;
    this.version = 0;
    this.frozen = false;
    this.edits = [];
    this.suggestions = [];
    this.cursors = [];
    this.error = null;
    this.rasterising = null;
    this.learnerTouched = false;
    this.modal = null;
    this.ingest = { ...EMPTY_INGEST };
  }

  #adopt(view: NotesDocView): void {
    this.docId = view.docId;
    this.title = view.title;
    this.pageCount = view.pageCount;
    this.version = view.version;
    this.frozen = view.frozen;
    this.ingest = { ...view.ingest };
    this.edits = view.edits.map((edit) => ({ ...edit }));
    this.suggestions = view.suggestions.map((s) => ({ ...s }));
    this.#docJson = view.doc;
    this.epoch++;
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
  async #sendPageImages(fileId: string, token: number): Promise<void> {
    if (!has('notesPageImages')) return;
    const source = this.#slides ?? (await this.#waitForSlides(token));
    if (!source || token !== this.#openToken) return;
    this.rasterising = { done: 0, total: source.pageCount };
    try {
      await pageImages(source.pdfDoc, {
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
    this.#docText.observe(learnerTextByBlock(view.state.doc), Date.now());
    this.#armDocTextTimer();
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
    this.#view = null;
    if (this.#docTextTimer) clearInterval(this.#docTextTimer);
    this.#docTextTimer = null;
    this.#cancelAnimations();
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
      void this.#save();
    }
  }

  /** Called by the host after every transaction it dispatched. */
  onTransaction(docChanged: boolean): void {
    if (!docChanged) return;
    const view = this.#view;
    if (!view) return;
    this.#docText.observe(learnerTextByBlock(view.state.doc), Date.now());
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
      onOpenSlide: (page, rect) => this.openSlide(page, rect),
      onFocusThread: (threadId) => this.focusThread?.(threadId),
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
      case 'notes.status':
        if (this.docId && e.docId !== this.docId) return;
        if (!this.docId && this.fileId !== e.fileId) return;
        this.ingest = { ...e.ingest };
        return;
      case 'notes.window':
        if (e.docId !== this.docId) return;
        this.appendIngestWindow(e.afterBlockId, e.blocks, e.nodes);
        return;
      case 'doc.edit':
        if (e.docId !== this.docId) return;
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
    this.askAboutSpan?.({ blockId, quote });
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

  /**
   * The carousel's grouping (§3: "all slides, collapsed and labelled, **grouped by the section
   * of the notes they feed**").
   *
   * Walked from the live document rather than stored, because the learner can retitle a heading
   * or move a paragraph and the grouping has to follow. A page that no block claims lands in a
   * trailing "Not in the notes" group, which is the carousel quietly answering R3's and R4's
   * failure — *what did the ingest leave out?* — without anybody having to ask.
   */
  sections(): { title: string; pages: number[] }[] {
    const view = this.#view;
    const groups: { title: string; pages: number[] }[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local scratch set
    const claimed = new Set<number>();
    if (view) {
      let current: { title: string; pages: number[] } | null = null;
      view.state.doc.forEach((node) => {
        const level = node.type.name === 'heading' ? (node.attrs.level as number) : null;
        if (level !== null && level <= 2) {
          current = { title: node.textContent.trim() || 'Untitled section', pages: [] };
          groups.push(current);
        }
        const pages = node.type.name === 'slide_figure'
          ? [node.attrs.page as number]
          : blockAttrs(node).pages;
        for (const page of pages) {
          if (!Number.isInteger(page) || page < 1) continue;
          claimed.add(page);
          if (!current) {
            current = { title: 'Opening', pages: [] };
            groups.push(current);
          }
          if (!current.pages.includes(page)) current.pages.push(page);
        }
      });
    }
    const rest: number[] = [];
    for (let page = 1; page <= this.pageCount; page++) if (!claimed.has(page)) rest.push(page);
    const out = groups.filter((group) => group.pages.length > 0);
    out.forEach((group) => group.pages.sort((a, b) => a - b));
    if (rest.length > 0) out.push({ title: 'Not in the notes', pages: rest });
    return out;
  }

  // ── the slide modal (§3) ──────────────────────────────────────────────────────────────────

  openSlide(page: number, rect: Rect | null = null): void {
    this.modal = { page, rect };
  }

  closeSlide(): void {
    this.modal = null;
  }

  // ── §6: the learner's own doc text ────────────────────────────────────────────────────────

  #armDocTextTimer(): void {
    if (this.#docTextTimer) return;
    this.#docTextTimer = setInterval(() => void this.#reportDocText(), DOC_TEXT_TICK_MS);
  }

  async #reportDocText(): Promise<void> {
    if (!this.fileId || !this.docId || !has('notesDocText')) return;
    const due = this.#docText.due(Date.now());
    for (const block of due) {
      // Marked first: a call that fails must not be retried on a one-second timer forever.
      this.#docText.markReported(block.blockId, block.text);
      try {
        await bridge().notesDocText({
          fileId: this.fileId,
          docId: this.docId,
          blockId: block.blockId,
          text: block.text,
        });
      } catch {
        // Main decides whether it was an attempt at all; a failed report is not the learner's
        // problem and must never interrupt their writing.
      }
    }
  }

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
   * **Insert ▸ Table or Diagram**: ask main for Ellie's block after the one the caret is in, and
   * say what main said. On success the block itself arrives on its own, as Ellie's edit on the
   * ordinary `doc.edit` path, so nothing here touches the document.
   *
   * **Saved first**, as `answerQuestion` is: main reads the section from the *stored* document,
   * and the caret's block may be one the learner made within the save debounce.
   */
  async generateBlock(kind: 'table' | 'diagram', instruction: string | null): Promise<GenerateBlockOutcome> {
    const fileId = this.fileId;
    const docId = this.docId;
    if (!fileId || !docId || !this.#view || !has('notesGenerateBlock')) {
      return { inserted: false, editId: null, reason: 'no_doc' };
    }
    if (this.frozen) return { inserted: false, editId: null, reason: 'frozen' };
    const blockId = this.insertTarget();
    if (!blockId) return { inserted: false, editId: null, reason: 'no_place' };
    await this.#flushSave();
    const text = instruction?.trim() ?? '';
    return bridge().notesGenerateBlock({ fileId, docId, blockId, kind, instruction: text.length > 0 ? text : null });
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
    if (!view || !this.docId || !has('notesSave')) return;
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
        doc: view.state.doc.toJSON(),
        learnerTouched: this.learnerTouched,
      });
      if (result.ok) {
        this.version = result.version;
        this.savedAt = Date.now();
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
