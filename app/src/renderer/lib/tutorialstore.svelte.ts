/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE TUTORIALS OF THE OPEN NOTEBOOK, FOR THE RENDERER (`docs/research/tutorials.md` §1–§3, §7)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * What the tutorial column, the sources panel, the main notes' practice chips and the chat read
 * about tutorials, and the one place that talks to main about them (`TUTORIAL-CONTRACT.md` S2):
 *
 *  - **the list** (`tutorial:list`, kept current by `tutorial:changed`): one `TutorialView` per
 *    tutorial source, read or not, with its parts' records;
 *  - **which one is open**, docked beside the notes or floating over the app, the window's place
 *    and size (kept per install, as the panel widths are), and the tab the column shows;
 *  - **a second `DocStore`** on the open tutorial's document: the same editor, saving and agent
 *    edits as the notes, by its own `docId`;
 *  - **the read**: a tutorial with no document gets its pages rasterised and sent through the page
 *    image channel the overview uses (S2), then `tutorial:ingest`. Main reports progress on
 *    `tutorial:changed`; the renderer's own first step (the images) is `reading` here;
 *  - **Check and help** on a part: the document is saved first (main reads the stored one), and a
 *    refusal comes back as one line for the column's toast.
 *
 * Like the notebook store, it holds nothing authoritative: every status is main's, pushed. It does
 * not import `store.svelte.ts` (that module hosts this one); the chat and the main notes are wired
 * in by the components through `focusThread` and the callers' own calls.
 */

import { untrack } from 'svelte';
import type { NotebookView } from '../../shared/notebook.js';
import { pagesOfSource } from '../../shared/notebook.js';
import { paginateText } from '../../shared/paginate.js';
import type {
  SetSourceRoleInput,
  SourceRole,
  TutorialChange,
  TutorialCheckInput,
  TutorialCheckResult,
  TutorialHelpInput,
  TutorialHelpResult,
  TutorialIngestInput,
  TutorialListInput,
  TutorialPartView,
  TutorialView,
} from '../../shared/tutorial.js';
import type { PageImage } from '../../shared/doc/types.js';
import { bridge } from './bridge.js';
import { DocStore, openSource } from './docstore.svelte.js';
import { floatFrame, readFloatFrame, type FloatFrame } from './layout.js';
import { checkRefusal, helpRefusal, roleOf, type TutorialReading } from './notebookview.js';
import { SlideSource, rasterPages } from './rasterise.js';

/**
 * The tutorial calls (`TUTORIAL-CONTRACT.md` S2), read off the bridge defensively: a preload from
 * before tutorials has none of them, and the column then says tutorials are not available rather
 * than throwing on a click.
 */
interface TutorialApi {
  tutorialList?: (input: TutorialListInput) => Promise<TutorialView[]>;
  tutorialIngest?: (input: TutorialIngestInput) => Promise<TutorialView>;
  tutorialCheck?: (input: TutorialCheckInput) => Promise<TutorialCheckResult>;
  tutorialHelp?: (input: TutorialHelpInput) => Promise<TutorialHelpResult>;
  notebookSetRole?: (input: SetSourceRoleInput) => Promise<NotebookView>;
  onTutorialChanged?: (listener: (change: TutorialChange) => void) => () => void;
  notesPageImages?: (input: { fileId: string; images: PageImage[]; done: boolean }) => Promise<{ stored: number }>;
}

function api(): TutorialApi {
  return bridge() as unknown as TutorialApi;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const KEYS = {
  floating: 'chattered.tutorial.floating',
  frame: 'chattered.tutorial.frame',
} as const;

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Not kept: the window opens where it would have anyway.
  }
}

/** How long a refusal stays in the column's toast. */
const TOAST_MS = 5_000;
/** How long a part waits for its editor to mount before the scroll to it gives up. */
const FOCUS_WAIT_MS = 4_000;

export type HelpKind = 'hint' | 'refresher' | 'reveal';

export class TutorialStore {
  // ── what the column, the sources panel and the chips draw ────────────────────────────────
  notebookId = $state<string | null>(null);
  /** Every tutorial of the open notebook, in the order main lists them. */
  views = $state<TutorialView[]>([]);
  /** The tutorial the column shows, or null when the column is closed. */
  openFileId = $state<string | null>(null);
  /** Floating over the app (Pop out) rather than docked beside the notes. */
  floating = $state(read(KEYS.floating) === 'true');
  /**
   * **Split**: the sheet in two views, one above the other, each scrolling on its own (Word's
   * Window ▸ Split): the figure in the top one while the learner answers in the bottom one. Kept
   * across Pop out and Dock and tutorial tabs; not across a restart. The ratio is `layout`'s.
   */
  split = $state(false);
  /** The floating window's place and size, as the learner last left it. Null: never moved. */
  frame = $state<FloatFrame | null>(readFloatFrame(read(KEYS.frame)));
  /** The renderer's own first step of a read, per tutorial: the page images being sent. */
  reading = $state<Record<string, TutorialReading>>({});
  /** A read that failed before main had it (no images channel, the call threw), per tutorial. */
  localError = $state<Record<string, string>>({});
  /** A line for the column: a refusal of Check or help. `token` restarts its timer on a repeat. */
  toast = $state<{ text: string; token: number } | null>(null);
  /** Parts with a Check or help call in flight: a second press waits for the first. */
  busy = $state<Record<string, HelpKind | 'check'>>({});
  /** Bumped on every change to the views: the chrome and the practice chips redraw on it. */
  revision = $state(0);
  /** Main has no tutorial calls (an old preload): the column says so. */
  unavailable = $state(false);

  /** The open tutorial's document. A second instance beside `store.doc` (S7). */
  readonly doc = new DocStore();

  // ── wiring set by the shell, so this store imports neither the chat nor the main notes ──
  /** Bring a thread into view in the chat column (`store.chat.focusThread`). */
  focusThread: ((threadId: string) => void) | null = null;
  /**
   * **The notes, from the sheet, while the tutorial is the main view** (2026-10-04): open the notes'
   * window over the app, and with a block scroll to it. Set by the shell; null when the notes are
   * on screen anyway.
   */
  openNotes: ((blockId: string | null) => void) | null = null;

  // ── plain fields ─────────────────────────────────────────────────────────────────────────
  #notebook: NotebookView | null = null;
  /** The tutorial sources' `fileId:role:status`, so a role change re-lists. */
  #signature = '';
  /** Reads this renderer has asked for this session, so a pending one is not started twice. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing renders
  #requested = new Set<string>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing renders
  #solutionsRequested = new Set<string>();
  /** Read again was pressed: the next `ready` replaces the document on screen. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing renders
  #rereading = new Set<string>();
  #unsubscribe: (() => void) | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #focusTimer: ReturnType<typeof setInterval> | null = null;
  #listToken = 0;

  // ── reading what is there ────────────────────────────────────────────────────────────────

  get openView(): TutorialView | null {
    return this.views.find((v) => v.fileId === this.openFileId) ?? null;
  }

  viewOf(fileId: string): TutorialView | null {
    return this.views.find((v) => v.fileId === fileId) ?? null;
  }

  /** The record of a part of the open tutorial: what D2's chrome draws its pill and dots from. */
  part(partId: string): TutorialPartView | null {
    return this.openView?.parts.find((p) => p.partId === partId) ?? null;
  }

  /** Every tutorial's document id: the chat routes a span thread's jump on these. */
  docIds(): string[] {
    const ids = this.views.map((v) => v.docId).filter((id): id is string => typeof id === 'string');
    const shown = this.doc.tutorialOf() ? this.doc.docId : null;
    return shown && !ids.includes(shown) ? [...ids, shown] : ids;
  }

  /** The tutorial a block belongs to: a part's block, or any block of the document on screen. */
  tutorialOfBlock(blockId: string): string | null {
    for (const v of this.views) if (v.parts.some((p) => p.blockId === blockId)) return v.fileId;
    const open = this.doc.tutorialOf();
    if (open && this.doc.hasBlock(blockId)) return open.fileId;
    return null;
  }

  /** A plain copy for a plugin to read: no proxy may reach ProseMirror. */
  snapshot(): TutorialView[] {
    return $state.snapshot(this.views) as TutorialView[];
  }

  // ── the notebook ──────────────────────────────────────────────────────────────────────────

  /**
   * Listen to `tutorial:changed` once, for the life of the window. A change to a tutorial of the
   * open notebook replaces its view; the open tutorial's document is reloaded when main has
   * written a new one (a first read finished, or Read again).
   */
  subscribe(): void {
    this.#unsubscribe?.();
    const on = api().onTutorialChanged;
    if (!on) return;
    this.#unsubscribe = on((change) => this.#onChange(change));
  }

  /**
   * **The open notebook changed** (opened, closed, a source read, a role changed). A different
   * notebook starts over; the same one re-lists when its tutorial sources changed, and starts a
   * read for any tutorial with no document whose source is ready (§2: drop the sheet, and it is
   * read, as a deck becomes an overview).
   */
  setNotebook(view: NotebookView | null): void {
    const plain = view ? ($state.snapshot(view) as NotebookView) : null;
    const id = plain?.id ?? null;
    if (id !== this.notebookId) {
      this.#leave();
      this.notebookId = id;
    }
    this.#notebook = plain;
    this.doc.setNotebook(plain);
    if (!plain) return;
    const signature = plain.sources
      .filter((s) => roleOf(s) !== 'lecture')
      .map((s) => `${s.fileId}:${roleOf(s)}:${s.status}:${s.keyFor ?? ''}`)
      .join('|');
    if (signature !== this.#signature) {
      this.#signature = signature;
      void this.load();
    }
  }

  async load(): Promise<void> {
    const notebookId = this.notebookId;
    const list = api().tutorialList;
    if (!notebookId) return;
    if (!list) {
      this.unavailable = true;
      return;
    }
    const token = ++this.#listToken;
    try {
      const views = await list({ notebookId });
      if (token !== this.#listToken || notebookId !== this.notebookId) return;
      this.views = views;
      this.revision++;
      // A tutorial whose role was taken away goes with its column.
      if (this.openFileId && !views.some((v) => v.fileId === this.openFileId)) this.close();
      for (const v of views) this.#maybeRead(v);
      for (const v of views) this.#maybeVerifySolutions(v);
    } catch (err) {
      console.warn('tutorials: the list did not load —', message(err));
    }
  }

  #leave(): void {
    if (this.#focusTimer) clearInterval(this.#focusTimer);
    this.#focusTimer = null;
    this.views = [];
    this.openFileId = null;
    this.reading = {};
    this.localError = {};
    this.busy = {};
    this.toast = null;
    this.#signature = '';
    this.#requested.clear();
    this.#solutionsRequested.clear();
    this.#rereading.clear();
    this.#listToken++;
    this.revision++;
    // Its document saves on the way out (the editor's teardown); nothing else is kept.
    void this.doc.flush();
  }

  #onChange(change: TutorialChange): void {
    if (change.notebookId !== this.notebookId) return;
    const before = this.viewOf(change.fileId);
    if (change.view === null) {
      this.views = this.views.filter((v) => v.fileId !== change.fileId);
      if (this.openFileId === change.fileId) this.close();
    } else {
      const next = change.view;
      this.views = before ? this.views.map((v) => (v.fileId === change.fileId ? next : v)) : [...this.views, next];
      if (next.status !== 'failed' && this.localError[change.fileId]) {
        const { [change.fileId]: _gone, ...rest } = this.localError;
        this.localError = rest;
      }
      untrack(() => this.#settleDoc(before, next));
    }
    this.revision++;
  }

  /**
   * A new document for the tutorial on screen: its first read finished (the document id appeared),
   * or a Read again finished. A change to a part's record alone (a Check) leaves it alone.
   */
  #settleDoc(before: TutorialView | null, next: TutorialView): void {
    const shown = this.doc.tutorialOf();
    if (!shown || shown.fileId !== next.fileId || next.status !== 'ready' || !next.docId) return;
    // Main makes the document (empty, `pending`) when a read starts, so a first read finishing is
    // the status turning `ready`, not the id appearing.
    const finished = !before || before.status !== 'ready' || this.#rereading.has(next.fileId);
    const appeared = this.doc.docId !== next.docId;
    if (finished || appeared) {
      this.#rereading.delete(next.fileId);
      void this.doc.reloadTutorial();
    }
  }

  // ── the column ────────────────────────────────────────────────────────────────────────────

  /** **Open** on a source row, a tab, a practice chip: the column shows this tutorial. */
  async open(fileId: string): Promise<void> {
    const notebookId = this.notebookId;
    if (!notebookId) return;
    this.openFileId = fileId;
    const view = this.viewOf(fileId);
    if (view) this.#maybeRead(view);
    await this.doc.openTutorial(notebookId, fileId);
  }

  /** The column's ×. The document stays loaded, so reopening is instant; it is saved now. */
  close(): void {
    this.openFileId = null;
    void this.doc.flush();
  }

  toggleSplit(): void {
    this.split = !this.split;
  }

  popOut(): void {
    this.floating = true;
    write(KEYS.floating, 'true');
  }

  dock(): void {
    this.floating = false;
    write(KEYS.floating, 'false');
  }

  /** The window's frame, now, for an app this size: the remembered one, kept on screen. */
  frameFor(view: { width: number; height: number }): FloatFrame {
    return floatFrame(this.frame, view);
  }

  setFrame(frame: FloatFrame): void {
    this.frame = { ...frame };
    write(KEYS.frame, JSON.stringify(frame));
  }

  /**
   * **A part, from outside the column** (a practice chip in the notes, a thread's jump): open its
   * tutorial (docked unless the learner floats it), scroll to the part and flash it once the
   * editor is there.
   */
  async openPart(fileId: string, partId: string): Promise<void> {
    const blockId = this.viewOf(fileId)?.parts.find((p) => p.partId === partId)?.blockId ?? null;
    await this.open(fileId);
    if (blockId) this.#focusWhenMounted(blockId);
  }

  /**
   * **A block of a known tutorial** (a search hit's *Open in notebook*, `search.md` §10): open it
   * and flash the block once the editor is there. Unlike `focusBlock`, the sheet is named, so it
   * works before the list has loaded.
   */
  async openAt(fileId: string, blockId: string): Promise<void> {
    await this.open(fileId);
    this.#focusWhenMounted(blockId);
  }

  /** A block of a tutorial (a span thread's jump): open that tutorial and flash the block. */
  async focusBlock(blockId: string): Promise<boolean> {
    const fileId = this.tutorialOfBlock(blockId);
    if (!fileId) return false;
    if (this.openFileId !== fileId) await this.open(fileId);
    this.#focusWhenMounted(blockId);
    return true;
  }

  #focusWhenMounted(blockId: string): void {
    if (this.#focusTimer) clearInterval(this.#focusTimer);
    const started = Date.now();
    const attempt = (): boolean => {
      if (!this.doc.hasBlock(blockId)) return false;
      this.doc.scrollToBlock(blockId);
      return true;
    };
    if (attempt()) return;
    this.#focusTimer = setInterval(() => {
      if (attempt() || Date.now() - started > FOCUS_WAIT_MS) {
        if (this.#focusTimer) clearInterval(this.#focusTimer);
        this.#focusTimer = null;
      }
    }, 80);
  }

  // ── reading a sheet (S2) ──────────────────────────────────────────────────────────────────

  /**
   * A tutorial not read yet (no document) or whose read was cut short (`pending`: main runs it
   * again, or answers with the read in flight), asked for once per session, its source ready.
   * A failed read waits for Retry.
   */
  #maybeRead(view: TutorialView): void {
    if (view.status === 'failed' || this.#requested.has(view.fileId)) return;
    if (view.docId && view.status === 'ready') return;
    const source = this.#notebook?.sources.find((s) => s.fileId === view.fileId);
    if (!source || source.status !== 'ready') return;
    void this.read(view.fileId);
  }

  /** Refresh legacy or incomplete solution keys, with the answer PDF's page images available. */
  #maybeVerifySolutions(view: TutorialView): void {
    const nb = this.#notebook;
    const notebookId = this.notebookId;
    const linked = nb?.sources.filter((s) => s.role === 'solutions' && s.keyFor === view.fileId && s.status === 'ready') ?? [];
    if (!nb || !notebookId || view.status !== 'ready' || linked.length === 0 ||
        view.parts.length === 0 || view.parts.every((p) => p.verifiedSolution) || this.#solutionsRequested.has(view.fileId)) return;
    this.#solutionsRequested.add(view.fileId);
    void (async () => {
      for (const source of linked) await this.#sendPageImages(notebookId, nb, source.fileId);
      if (notebookId === this.notebookId) await api().tutorialIngest?.({ notebookId, fileId: view.fileId, forceSolutions: true });
    })().catch((err) => console.warn('tutorials: answer PDF verification failed —', message(err)));
  }

  /**
   * **Read the sheet**: its pages as images first, through the channel the overview uses (main
   * stores them by notebook page, additively), then `tutorial:ingest`, which answers at once with
   * `pending`; the rest arrives on `tutorial:changed`. Images are an optional input, as the
   * overview's are: a sheet whose pages will not rasterise is still read from its text.
   */
  async read(fileId: string, force = false): Promise<void> {
    const notebookId = this.notebookId;
    const nb = this.#notebook;
    const ingest = api().tutorialIngest;
    if (!notebookId || !nb || this.reading[fileId]) return;
    this.#requested.add(fileId);
    if (!ingest) {
      this.unavailable = true;
      this.localError = { ...this.localError, [fileId]: 'Tutorials are not available in this build yet.' };
      return;
    }
    const { [fileId]: _cleared, ...errors } = this.localError;
    this.localError = errors;
    this.reading = { ...this.reading, [fileId]: { done: 0, total: null } };
    try {
      await this.#sendPageImages(notebookId, nb, fileId);
      if (notebookId !== this.notebookId) return;
      const view = await ingest({ notebookId, fileId, ...(force ? { force: true } : {}) });
      if (notebookId !== this.notebookId) return;
      this.#upsert(view);
    } catch (err) {
      if (notebookId === this.notebookId) this.localError = { ...this.localError, [fileId]: message(err) };
      this.#rereading.delete(fileId);
    } finally {
      const { [fileId]: _done, ...rest } = this.reading;
      this.reading = rest;
      this.revision++;
    }
  }

  /** **Retry** on a failed read. */
  async retry(fileId: string): Promise<void> {
    this.#requested.delete(fileId);
    await this.read(fileId, true);
  }

  /**
   * **Read again**: main reads the sheet afresh and carries the learner's answers over by part
   * id. The document on screen is saved first and taken down, so the old copy is never saved
   * over the new one; it comes back when main says `ready`.
   */
  async reread(fileId: string): Promise<void> {
    if (this.doc.tutorialOf()?.fileId === fileId) await this.doc.holdForReread();
    this.#rereading.add(fileId);
    // Pending at once, so the column shows the reading state and not the old sheet.
    const view = this.viewOf(fileId);
    if (view) this.#upsert({ ...view, status: 'pending', error: null });
    await this.read(fileId, true);
  }

  async #sendPageImages(notebookId: string, nb: NotebookView, fileId: string): Promise<void> {
    const send = api().notesPageImages;
    const source = nb.sources.find((s) => s.fileId === fileId);
    // A text sheet's pages are read as text by main; there is nothing to draw.
    if (!send || !source || source.kind === 'text' || source.pageCount === 0) return;
    const shared = this.doc.tutorialOf() ? this.doc.slides() : null;
    const slides = shared ?? new SlideSource(nb.sources, { open: openSource, paginate: paginateText });
    // Every page of this one source, ticked or not: `ingestRaster` would skip an unticked one.
    const raster = { pages: pagesOfSource(source), render: slides.ingestRaster().render };
    try {
      await rasterPages(raster, {
        onProgress: (done, total) => {
          if (notebookId === this.notebookId) this.reading = { ...this.reading, [fileId]: { done, total } };
        },
        onBatch: async (images, done) => {
          if (notebookId !== this.notebookId) return false;
          await send({ fileId: notebookId, images, done });
          return true;
        },
      });
    } catch (err) {
      console.warn('tutorials: the sheet images were not sent —', message(err));
    } finally {
      if (!shared) slides.destroy();
    }
  }

  #upsert(view: TutorialView): void {
    const before = this.viewOf(view.fileId);
    this.views = before ? this.views.map((v) => (v.fileId === view.fileId ? view : v)) : [...this.views, view];
    this.#settleDoc(before, view);
    this.revision++;
  }

  // ── a source's role (S1) ──────────────────────────────────────────────────────────────────

  /** The sources panel's "Use as…". Returns main's view of the notebook, or a line on failure. */
  async setRole(fileId: string, role: SourceRole): Promise<{ view: NotebookView | null; error: string | null }> {
    const notebookId = this.notebookId;
    const call = api().notebookSetRole;
    if (!notebookId) return { view: null, error: null };
    if (!call) return { view: null, error: 'Source roles are not available in this build yet.' };
    try {
      const view = await call({ notebookId, fileId, role });
      if (role !== 'tutorial' && this.openFileId === fileId) this.close();
      return { view, error: null };
    } catch (err) {
      return { view: null, error: message(err) };
    }
  }

  // ── Check and help on a part (S4, S6) ─────────────────────────────────────────────────────

  /**
   * **Check**: the document is saved first, because main judges the part as the *stored* document
   * holds it, and the answer was typed within the save debounce more often than not. Accepted,
   * the chat brings the part's thread up, where Max's feedback lands.
   */
  async check(partId: string): Promise<void> {
    const notebookId = this.notebookId;
    const fileId = this.openFileId;
    const call = api().tutorialCheck;
    if (!notebookId || !fileId || this.busy[partId]) return;
    if (!call) {
      this.say('Checking is not available in this build yet.');
      return;
    }
    this.#setBusy(partId, 'check');
    try {
      await this.doc.flush();
      const result = await call({ notebookId, fileId, partId });
      if (notebookId !== this.notebookId) return;
      const line = result.accepted ? null : checkRefusal(result.reason);
      if (line) this.say(line);
      if (result.status) this.#patchPart(fileId, partId, { status: result.status });
      if (result.threadId && (result.accepted || result.reason === 'busy')) this.focusThread?.(result.threadId);
    } catch (err) {
      this.say(message(err));
      console.warn('tutorials: check failed —', message(err));
    } finally {
      this.#setBusy(partId, null);
    }
  }

  /** **Hint · Refresher · Show answer** (§4). Saved first, as Check is: help reads the answer too. */
  async help(partId: string, kind: HelpKind): Promise<void> {
    const notebookId = this.notebookId;
    const fileId = this.openFileId;
    const call = api().tutorialHelp;
    if (!notebookId || !fileId || this.busy[partId]) return;
    if (!call) {
      this.say('Help on tutorials is not available in this build yet.');
      return;
    }
    this.#setBusy(partId, kind);
    try {
      await this.doc.flush();
      const result = await call({ notebookId, fileId, partId, kind });
      if (notebookId !== this.notebookId) return;
      const line = result.accepted ? null : helpRefusal(result.reason, kind);
      if (line) this.say(line);
      if (result.accepted && result.level !== null && kind === 'hint') {
        const level = result.level;
        const current = this.viewOf(fileId)?.parts.find((p) => p.partId === partId)?.hintLevel ?? 0;
        if (level > current) this.#patchPart(fileId, partId, { hintLevel: level });
      }
      if (result.threadId) this.focusThread?.(result.threadId);
    } catch (err) {
      this.say(helpRefusal('failed', kind) ?? message(err));
      console.warn('tutorials: help failed —', message(err));
    } finally {
      this.#setBusy(partId, null);
    }
  }

  /** Main's push replaces this a moment later; until then the pill and dots say what happened. */
  #patchPart(fileId: string, partId: string, patch: Partial<TutorialPartView>): void {
    this.views = this.views.map((v) =>
      v.fileId !== fileId ? v : { ...v, parts: v.parts.map((p) => (p.partId === partId ? { ...p, ...patch } : p)) },
    );
    this.revision++;
  }

  #setBusy(partId: string, kind: HelpKind | 'check' | null): void {
    if (kind) {
      this.busy = { ...this.busy, [partId]: kind };
    } else {
      const { [partId]: _gone, ...rest } = this.busy;
      this.busy = rest;
    }
    this.revision++;
  }

  say(text: string): void {
    this.toast = { text, token: (this.toast?.token ?? 0) + 1 };
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => {
      this.toast = null;
    }, TOAST_MS);
  }

  dismissToast(): void {
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.toast = null;
  }
}
