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
import type { ChatterEdApi } from '../../shared/ipc.js';
import {
  applyBatch,
  appendWindow,
  keepEdit,
  removeEdit,
} from '../../shared/doc/ops.js';
import { acceptSuggestion, rejectSuggestion } from '../../shared/doc/suggest.js';
import { blockAttrs, blockPos, docFromJson } from '../../shared/doc/schema.js';
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

/** ≈800 ms after the last change (the brief), and immediately after an agent edit. */
const SAVE_DEBOUNCE_MS = 800;

/** How often the doc-text pause detector is polled while there is something pending. */
const DOC_TEXT_TICK_MS = 1_000;

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
  #docText = new DocTextWatch();
  #docTextTimer: ReturnType<typeof setInterval> | null = null;
  // A plain Map on purpose: these are timer handles, nothing renders them, and making them
  // reactive would re-run effects on every frame of the typing animation.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #animations = new Map<string, ReturnType<typeof setTimeout>>();
  #lastKeyAt = 0;
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
      void this.#openSlides(fileId, token);

      const existing = has('notesGet') ? await bridge().notesGet({ fileId }) : null;
      if (token !== this.#openToken) return;
      if (existing) {
        this.#adopt(existing);
        this.loading = false;
        return;
      }

      // Nothing yet: send the slides, then start the two-pass ingest.
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
    this.#slides?.destroy();
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
      const source = await SlideSource.open(document_.bytes);
      if (token !== this.#openToken) {
        source.destroy();
        return;
      }
      this.#slides = source;
      if (this.pageCount === 0) this.pageCount = source.pageCount;
      this.slidesReady = true;
      this.#bump();
    } catch {
      // No slides is a degraded document, not a broken one: the notes still read.
    }
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
      await pageImages(source as unknown as Parameters<typeof pageImages>[0], {
        onProgress: (done, total) => {
          if (token === this.#openToken) this.rasterising = { done, total };
        },
        onBatch: async (images, done) => {
          if (token !== this.#openToken) return false;
          await bridge().notesPageImages({ fileId, images, done });
          return true;
        },
      });
    } catch {
      // Noted above: optional input.
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
    this.#docText.observe(learnerTextByBlock(view.state.doc), Date.now());
    this.#armDocTextTimer();
  }

  detach(): void {
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
        this.appendIngestWindow(e.afterBlockId, e.blocks);
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
  appendIngestWindow(afterBlockId: string | null, blocks: readonly DocBlockDraft[]): void {
    const applied = this.#dispatchAgent((state) => appendWindow(state, afterBlockId, blocks));
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
    const $from = view.state.selection.$from;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      const { blockId } = blockAttrs(node);
      if (blockId) return blockId;
    }
    return null;
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

  async #save(): Promise<void> {
    const view = this.#view;
    if (!view || !this.docId || !has('notesSave')) return;
    if (this.saving) {
      // One save in flight at a time; the tail is coalesced into a single follow-up.
      this.#savePending = true;
      return;
    }
    this.saving = true;
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
      if (this.#savePending) {
        this.#savePending = false;
        this.#scheduleSave();
      }
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
