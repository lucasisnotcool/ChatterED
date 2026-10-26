<script lang="ts" module>
  /**
   * The tutorial is the pane in focus: the learner last pressed or typed in it rather than in the
   * notes. Module-level, so it survives the pane moving between docked and popped out (a remount).
   */
  let tutorialActive = false;
</script>

<script lang="ts">
  /**
   * **The tutorial column** (`docs/research/tutorials.md` §2–§4, §7; `TUTORIAL-CONTRACT.md` S7).
   *
   * The sheet, copied faithfully with an answer slot under every part, in the same editor as the
   * notes (`NotesEditor` on the tutorial store's own `DocStore`), with D2's part chrome
   * (`pm/tutorial.ts`): Hint, Refresher, Check and Show answer go to main through the tutorial
   * store, which saves the document first; the answer lands in the notebook's one chat, which
   * brings the part's thread up.
   *
   * The same component is drawn docked beside the notes (`ThreeColumn`) and inside the floating
   * window (`TutorialWindow`); `onbardown` is the window's, so its header is the title bar.
   *
   * Header: a tab per tutorial (a notebook can have several), *Parts 4 / 9* with a bar, Read again,
   * Split, Pop out / Dock and close. **Split** (Word's Window ▸ Split) shows the sheet twice, one
   * view above the other with a divider between, each scrolling on its own: the figure parked in
   * the top one while the learner answers in the bottom one. The bottom view is the store's
   * editor; the top one is a second view kept in lockstep with it (`pm/splitview.ts`). Body: the reading state (the page images, then Max reading the sheet),
   * the failed state with Retry, or the sheet; then *Not covered by this sheet*, the objectives the
   * lecture teaches that no part exercises, with their slides. A refusal is a small toast.
   *
   * **Zoom** (2026-10-04): the sheet has its own, `layout.tutorialZoom`, set by the − 100 % + in
   * the header, a pinch over the sheet, and ⌘ or Ctrl with + − 0 while the tutorial is the pane in
   * focus (the last of the two the learner pressed or typed in). Otherwise those keys zoom the
   * notes, as before (`lib/viewer.ts`). **An image dropped on the sheet** goes into it where it was
   * dropped, as on the notes (`lib/sheetdrop.ts`).
   */
  import { flushSync, untrack } from 'svelte';
  import type { NotebookSourceView } from '../../../shared/notebook.js';
  import { partsDone, tutorialContentKey } from '../../../shared/tutorial.js';
  import {
    NOTES_ZOOM,
    TUTORIAL_HEAD_COMPACT_BELOW,
    TUTORIAL_SPLIT,
    blockAnchorDelta,
    headCompact,
    percent,
    splitKeyRatio,
    splitRatioAt,
    tutorialSheetFit,
    zoomIn,
    zoomOut,
  } from '../../lib/layout.js';
  import { pinchScale } from '../../lib/pdfview.js';
  import { sheetImageDrop } from '../../lib/sheetdrop.js';
  import { registerViewer, type ViewerCommand } from '../../lib/viewer.js';
  import { layout } from '../../lib/layoutstore.svelte.js';
  import { partsLabel, tutorialLine, tutorialTabLabel } from '../../lib/notebookview.js';
  import type { SpanThreadView } from '../../lib/pm/chrome.js';
  import { bumpTutorialChrome, type TutorialChromeContext } from '../../lib/pm/tutorial.js';
  import { store } from '../../lib/store.svelte.js';
  import NotesEditor from './NotesEditor.svelte';
  import './notes.css';
  import './table.css';

  let {
    floating = false,
    main = false,
    working = false,
    printedQuestions = [],
    onbardown,
  }: {
    floating?: boolean;
    working?: boolean;
    printedQuestions?: number[];
    /**
     * **The swap** (2026-10-04, `tutorials.md` §2): the sheet is the middle column and the notes are
     * hidden. The header's Pop out / Dock and × give way to **Notes**, which opens the notes in a
     * window; *From the notes* opens them there too. The doc header's *Main view* switches back.
     */
    main?: boolean;
    /** The floating window's: a press on the header (not on a control) starts a move. */
    onbardown?: (event: PointerEvent) => void;
  } = $props();

  const tut = store.tutorial;
  const doc = tut.doc;

  // ── the chat, wired as `NotesPane` wires it for the notes ──────────────────────────────────
  interface ChatSurface {
    openSpanThread?: (input: { blockId: string; quote: string; docKey?: string }) => void;
    focusThread?: (threadId: string) => void;
    sendDraft?: (question: string) => Promise<string | null>;
    spanThreads?: readonly SpanThreadView[];
  }
  const chat = (): ChatSurface => store.chat as unknown as ChatSurface;
  doc.askAboutSpan = (input) => { layout.setChatOpen(true); chat().openSpanThread?.(input); };
  doc.focusThread = (threadId) => { layout.setChatOpen(true); chat().focusThread?.(threadId); };
  doc.spanThreads = () => chat().spanThreads ?? [];

  $effect(() => {
    const signature = (chat().spanThreads ?? []).map((t) => `${t.threadId}:${t.blockId}`).join('|');
    void signature;
    untrack(() => doc.refreshChrome());
  });

  /** A part's record moved (a Check, a hint): the chrome redraws; the document is untouched. */
  $effect(() => {
    void tut.revision;
    untrack(() => doc.redraw(bumpTutorialChrome));
  });

  function askAboutFigure(input: { blockId: string; quote: string; question: string }): void {
    const surface = chat();
    if (!surface.openSpanThread) return;
    layout.setChatOpen(true);
    const which = doc.tutorialOf();
    surface.openSpanThread({
      blockId: input.blockId,
      quote: input.quote,
      ...(which ? { docKey: tutorialContentKey(which.notebookId, which.fileId) } : {}),
    });
    void surface.sendDraft?.(input.question);
  }

  // ── what is shown ──────────────────────────────────────────────────────────────────────────
  const views = $derived(tut.views);
  const view = $derived(tut.openView);
  const fileId = $derived(tut.openFileId);
  const sources = $derived<NotebookSourceView[]>(store.notebook.view?.sources ?? []);
  const sourceName = (id: string): string | null => sources.find((s) => s.fileId === id)?.name ?? null;
  const reading = $derived(fileId ? (tut.reading[fileId] ?? null) : null);
  const failure = $derived(fileId ? (tut.localError[fileId] ?? (view?.status === 'failed' ? (view.error ?? '') : null)) : null);
  const done = $derived(view ? partsDone(view) : { done: 0, total: 0 });
  const parts = $derived(partsLabel(view));
  /** Printed questions omitted by sheet generation have no backend part ID. Give them local
   * working space, but never offer a Check action the fixed backend cannot target. */
  let localDrafts = $state<Record<number, string>>({});
  let manualQuestions = $state<number[]>([]);
  const generatedNumbers = $derived((view?.parts ?? []).map((part) => {
    const match = /(?:question|problem|part|^q)\s*(\d+)/i.exec(part.label);
    return match ? Number(match[1]) : null;
  }).filter((number): number is number => number !== null && number > 0 && number <= 30));
  const missingQuestions = $derived.by(() => {
    const last = Math.max(0, ...generatedNumbers);
    return Array.from({ length: last }, (_, index) => index + 1).filter((number) => !generatedNumbers.includes(number));
  });
  const localQuestions = $derived([...new Set([...missingQuestions, ...printedQuestions.filter((number) => !generatedNumbers.includes(number)), ...manualQuestions])].sort((a, b) => a - b));
  $effect(() => {
    if (!fileId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`chattered.working.drafts.${fileId}`) ?? '{}') as { drafts?: Record<number, string>; manual?: number[] };
      localDrafts = saved.drafts ?? {};
      manualQuestions = saved.manual ?? [];
    } catch {
      localDrafts = {};
      manualQuestions = [];
    }
  });
  function saveLocal(): void {
    if (!fileId) return;
    try {
      localStorage.setItem(`chattered.working.drafts.${fileId}`, JSON.stringify({ drafts: localDrafts, manual: manualQuestions }));
    } catch { /* The editor remains usable if browser storage is unavailable. */ }
  }
  function addLocalQuestion(): void {
    const next = Math.max(0, ...generatedNumbers, ...localQuestions) + 1;
    manualQuestions = [...manualQuestions, next];
    saveLocal();
  }
  /** The sheet is on screen: main has a document and this store has loaded that same one. */
  const ready = $derived(
    Boolean(view && view.status === 'ready' && view.docId && doc.docId === view.docId && !reading),
  );
  const phase = $derived.by((): 'unavailable' | 'failed' | 'reading' | 'opening' | 'ready' => {
    if (tut.unavailable) return 'unavailable';
    if (failure !== null) return 'failed';
    if (ready) return 'ready';
    if (reading || !view || view.status === 'pending' || !view.docId) return 'reading';
    return 'opening';
  });

  // ── D2's part chrome, wired to the store, the notes and the slides ─────────────────────────
  /** *From the notes:* — the notes scroll to the block and flash it, as a lesson's Start does. */
  function openNotesBlock(blockId: string): void {
    // The swap on: the notes are hidden behind the sheet, so their window opens on the block.
    if (main && tut.openNotes) {
      tut.openNotes(blockId);
      return;
    }
    store.doc.scrollToBlock(blockId);
  }

  function citation(pages: readonly number[]): string {
    if (pages.length === 0) return '';
    return store.doc.slides()?.citation(pages) ?? doc.slides()?.citation(pages) ?? `p. ${pages.join(', ')}`;
  }

  const chrome = (): TutorialChromeContext => ({
    part: (partId) => {
      const found = tut.part(partId);
      return found ? ($state.snapshot(found) as typeof found) : null;
    },
    onHelp: (partId, kind) => void tut.help(partId, kind),
    onCheck: (partId) => void tut.check(partId),
    onOpenNotesBlock: openNotesBlock,
    // A lecture page opens in a slide window, as a chip in the notes does.
    onOpenSlide: (page, _rect, anchor) => store.doc.openSlide(page, null, anchor),
    citation,
    notesHeading: (blockId) => store.doc.headingFor(blockId),
  });

  // ── header actions ─────────────────────────────────────────────────────────────────────────
  /** Read again asks once, inline: the second press within a few seconds is the yes. */
  let confirmReread = $state(false);
  let rereadTimer: ReturnType<typeof setTimeout> | null = null;
  function reread(): void {
    if (!fileId) return;
    if (!confirmReread) {
      confirmReread = true;
      if (rereadTimer) clearTimeout(rereadTimer);
      rereadTimer = setTimeout(() => (confirmReread = false), 4_000);
      return;
    }
    confirmReread = false;
    if (rereadTimer) clearTimeout(rereadTimer);
    void tut.reread(fileId);
  }

  function ontabkey(e: KeyboardEvent): void {
    const ids = views.map((v) => v.fileId);
    const at = fileId ? ids.indexOf(fileId) : -1;
    let next: string | undefined;
    if (e.key === 'ArrowRight') next = ids[Math.min(ids.length - 1, at + 1)];
    else if (e.key === 'ArrowLeft') next = ids[Math.max(0, at - 1)];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    void tut.open(next);
    const target = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${CSS.escape(next)}"]`);
    target?.focus();
  }

  /** A press on the header itself (not a tab or a button) moves the floating window. */
  function headdown(e: PointerEvent): void {
    if (!onbardown || (e.target as Element).closest('button, [role="tab"]')) return;
    onbardown(e);
  }

  // ── the sheet's width ─────────────────────────────────────────────────────────────────────
  let scroller = $state<HTMLElement | null>(null);
  let paneWidth = $state(0);
  /**
   * The gutters give way earlier than the notes' do: the column is narrow by nature, and a part's
   * chrome is inside the card rather than in the margin. Under `COMPACT_BELOW` (docked beside the
   * notes, or a small window) the sheet goes compact, as the notes' does (`tutorialSheetFit`).
   */
  const fit = $derived(tutorialSheetFit(paneWidth, layout.tutorialZoom));
  const zoomStyle = $derived(layout.tutorialZoom === 1 ? null : String(layout.tutorialZoom));
  /** A narrow header: the bar goes and Pop out / Dock are icons, so the title keeps its room. */
  const narrowHead = $derived(headCompact(paneWidth, TUTORIAL_HEAD_COMPACT_BELOW));

  const gapsTitle = $derived((view?.gaps ?? []).map((g) => g.title).join(' · '));

  // ── Zoom (2026-10-04) ─────────────────────────────────────────────────────────────────────
  let root = $state<HTMLElement | null>(null);

  /** A press or a focus in the tutorial gives it the zoom keys; one in the notes takes them back. */
  $effect(() => {
    const mark = (e: Event): void => {
      const target = e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null;
      if (!target) return;
      if (root?.contains(target)) tutorialActive = true;
      else if (target.closest('.nd')) tutorialActive = false;
    };
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('focusin', mark, true);
    return () => {
      window.removeEventListener('pointerdown', mark, true);
      window.removeEventListener('focusin', mark, true);
      // Closed, not just docked or popped out: the next tutorial starts without the keys.
      if (!tut.openFileId) tutorialActive = false;
    };
  });

  /** The block under a viewport point in this sheet, or the first below it. */
  function blockAt(el: HTMLElement, x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.ProseMirror > *');
    if (hit && el.contains(hit)) return hit;
    for (const block of el.querySelectorAll<HTMLElement>('.ProseMirror > *')) if (block.getBoundingClientRect().bottom >= y) return block;
    return null;
  }

  /** Set the zoom and keep the block at `(x, y)` where it was, as the notes' zoom does. */
  function setZoom(next: number, at?: { x: number; y: number }, el: HTMLElement | null = scroller): void {
    if (!el) {
      layout.setTutorialZoom(next);
      return;
    }
    const box = el.getBoundingClientRect();
    const point = at ?? { x: box.left + box.width / 2, y: box.top + Math.min(80, box.height / 3) };
    const block = blockAt(el, point.x, point.y);
    const before = block?.getBoundingClientRect();
    flushSync(() => layout.setTutorialZoom(next));
    if (block && before) el.scrollTop += blockAnchorDelta(before, block.getBoundingClientRect(), point.y);
  }

  function command(c: ViewerCommand): void {
    if (c === 'zoom.in') setZoom(zoomIn(layout.tutorialZoom, NOTES_ZOOM));
    else if (c === 'zoom.out') setZoom(zoomOut(layout.tutorialZoom, NOTES_ZOOM));
    else if (c === 'zoom.reset' || c === 'fit.width' || c === 'fit.page') setZoom(1);
  }
  // Above the notes' registration: it answers while the tutorial is in focus, and passes otherwise.
  $effect(() => registerViewer(command, () => tutorialActive));

  /** A pinch over either view of the sheet zooms it, folded to one change a frame. */
  let pending: { zoom: number; x: number; y: number; el: HTMLElement } | null = null;
  function onwheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const from = pending?.zoom ?? layout.tutorialZoom;
    const zoom = Math.min(NOTES_ZOOM.max, Math.max(NOTES_ZOOM.min, pinchScale(from, e.deltaY)));
    const first = pending === null;
    pending = { zoom, x: e.clientX, y: e.clientY, el: e.currentTarget as HTMLElement };
    if (!first) return;
    requestAnimationFrame(() => {
      const p = pending;
      pending = null;
      if (p) setZoom(p.zoom, p, p.el);
    });
  }

  // ── an image dropped on the sheet ─────────────────────────────────────────────────────────
  let imageOver = $state<'image' | 'refused' | null>(null);
  const imageDrop = sheetImageDrop({
    doc,
    notebook: store.notebook,
    accept: () => phase === 'ready',
    onover: (o) => (imageOver = o),
  });

  // ── Split: a second view of the sheet above the first ─────────────────────────────────────
  const splitOn = $derived(tut.split && phase === 'ready');
  let body = $state<HTMLElement | null>(null);
  let bodyHeight = $state(0);
  /** The top view's scroller, and the element its editor mounts into (`NotesEditor`'s `mirror`). */
  let topScroller = $state<HTMLElement | null>(null);
  let mirrorHost = $state<HTMLElement | null>(null);
  let dividing = $state(false);

  /** A new split opens on the place the sheet was showing, as Word's does. */
  $effect(() => {
    const top = topScroller;
    if (!top) return;
    const frame = requestAnimationFrame(() => {
      if (scroller) top.scrollTop = scroller.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  });

  function dividerdown(e: PointerEvent): void {
    if (e.button !== 0 || !body) return;
    e.preventDefault();
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    bar.focus({ preventScroll: true });
    dividing = true;
    document.documentElement.classList.add('resizing');
    const move = (ev: PointerEvent): void => {
      const box = body?.getBoundingClientRect();
      if (box) layout.setTutorialSplit(splitRatioAt(ev.clientY - box.top, box.height), box.height);
    };
    const end = (): void => {
      dividing = false;
      document.documentElement.classList.remove('resizing');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', end);
      bar.removeEventListener('pointercancel', end);
      bar.removeEventListener('lostpointercapture', end);
      if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('lostpointercapture', end);
  }

  function dividerkey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      tut.toggleSplit();
      return;
    }
    const next = splitKeyRatio(layout.tutorialSplit, e.key, e.shiftKey, bodyHeight);
    if (next === null) return;
    e.preventDefault();
    layout.setTutorialSplit(next, bodyHeight);
  }
</script>

<div class="nd tp-nd" class:floating class:main class:working class:nd-compact={fit.compact} aria-label={working ? 'My working' : 'Tutorial'} bind:this={root}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="tp-head" class:grab={Boolean(onbardown)} class:narrow={narrowHead} onpointerdown={headdown}>
    {#if working}<span class="tp-working-title">My working</span>{/if}
    {#if views.length > 1}
      <div class="tp-tabs" role="tablist" aria-label="Tutorials" tabindex="-1" onkeydown={ontabkey}>
        {#each views as v (v.fileId)}
          <button
            type="button"
            role="tab"
            class="tp-tab"
            class:on={v.fileId === fileId}
            aria-selected={v.fileId === fileId}
            tabindex={v.fileId === fileId ? 0 : -1}
            data-tab={v.fileId}
            title={v.title || sourceName(v.fileId) || 'Tutorial'}
            onclick={() => void tut.open(v.fileId)}
          >
            {#if v.status === 'pending' || tut.reading[v.fileId]}<span class="tp-tab-dot" aria-hidden="true"></span>{/if}
            <span class="tp-tab-text">{tutorialTabLabel(v, sourceName(v.fileId))}</span>
          </button>
        {/each}
      </div>
    {:else}
      <span class="tp-kicker">Tutorial</span>
      <span class="tp-title" title={view?.title ?? ''}>{view ? tutorialTabLabel(view, sourceName(view.fileId), 60) : 'Tutorial'}</span>
    {/if}
    {#if views.length > 1}<span class="tp-spacer"></span>{/if}
    {#if parts}
      <span class="tp-parts" title={`${done.done} of ${done.total} parts correct`}>
        {#if narrowHead}<span aria-label={parts}>{done.done}/{done.total}</span>{:else}{parts}{/if}
        <span class="tp-bar" aria-hidden="true"><i style:width={`${done.total ? (done.done / done.total) * 100 : 0}%`}></i></span>
      </span>
    {/if}
    {#if phase === 'ready'}
      <span class="nd-zoom" class:tp-zoom-narrow={narrowHead} role="group" aria-label="Zoom the tutorial">
        <button
          type="button"
          class="nd-zoom-step"
          aria-label="Zoom out"
          title="Zoom out (⌘− while you are in the tutorial, or pinch)"
          disabled={layout.tutorialZoom <= NOTES_ZOOM.min}
          onclick={() => command('zoom.out')}
        >−</button>
        <button
          type="button"
          class="nd-zoom-level"
          aria-label={`Zoom ${percent(layout.tutorialZoom)}. Reset to 100%`}
          title="Actual size (⌘0 while you are in the tutorial)"
          onclick={() => command('zoom.reset')}
        >{percent(layout.tutorialZoom)}</button>
        <button
          type="button"
          class="nd-zoom-step"
          aria-label="Zoom in"
          title="Zoom in (⌘+ while you are in the tutorial, or pinch)"
          disabled={layout.tutorialZoom >= NOTES_ZOOM.max}
          onclick={() => command('zoom.in')}
        >+</button>
      </span>
    {/if}
    {#if phase === 'ready'}
      <button
        type="button"
        class="tp-btn"
        class:confirm={confirmReread}
        aria-label={confirmReread ? 'Read the sheet again? Press again to confirm' : 'Read the sheet again'}
        title="Read the sheet again from the file. Your answers are kept, part by part."
        onclick={reread}
      >{confirmReread ? 'Read again?' : '↻'}</button>
    {/if}
    {#if phase === 'ready'}
      <button
        type="button"
        class="tp-btn icon tp-split-btn"
        class:on={tut.split}
        aria-pressed={tut.split}
        aria-label="Split the sheet"
        title={tut.split
          ? 'Remove the split: one view of the sheet again'
          : 'Split: see two places of the sheet at once, one above the other (the figure above, your answer below)'}
        onclick={() => tut.toggleSplit()}
      >
        <!-- A page with a line across it: the window split in two, one view above the other. -->
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="1.75" width="12" height="12.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M2 8h12" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M5 4.5h6M5 11h6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.55" stroke-linecap="round" />
        </svg>
      </button>
    {/if}
    {#if main}
      <!-- The swap: the notes are one click away, in a window over the app. -->
      <button
        type="button"
        class="tp-btn tp-notes-btn"
        class:on={layout.notesWindowOpen}
        aria-pressed={layout.notesWindowOpen}
        aria-label={layout.notesWindowOpen ? 'Close the lecture notes' : 'Open the lecture notes'}
        title={layout.notesWindowOpen ? 'Close the lecture notes window (Esc)' : 'Open the lecture notes in a window over the sheet'}
        onclick={() => (layout.notesWindowOpen ? layout.setNotesWindowOpen(false) : tut.openNotes?.(null))}
      >Notes</button>
    {:else if floating}
      <button
        type="button"
        class="tp-btn"
        class:icon={narrowHead}
        aria-label="Dock"
        title="Put the tutorial back beside the notes"
        onclick={() => tut.dock()}
      >
        {#if narrowHead}
          <!-- A window with its right side filled: the column it goes back to. -->
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
            <rect x="9" y="3.4" width="4.6" height="9.2" fill="currentColor" opacity="0.55" />
          </svg>
        {:else}Dock{/if}
      </button>
    {:else}
      <button
        type="button"
        class="tp-btn"
        class:icon={narrowHead}
        aria-label="Pop out"
        title="Float the tutorial in a window over the app"
        onclick={() => tut.popOut()}
      >
        {#if narrowHead}
          <!-- A box with an arrow leaving it by its corner. -->
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            <path d="M9.5 2h4.5v4.5M14 2 8 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {:else}Pop out{/if}
      </button>
    {/if}
    {#if !main}
      <button type="button" class="tp-btn tp-close" aria-label="Close the tutorial" title="Close the tutorial" onclick={() => tut.close()}>×</button>
    {/if}
  </header>

  <div
    class="tp-body"
    class:nd-dropping={imageOver === 'image'}
    bind:this={body}
    bind:clientHeight={bodyHeight}
    data-dropzone
    role="region"
    aria-label="Tutorial sheet"
    ondragenter={imageDrop.dragenter}
    ondragover={imageDrop.dragover}
    ondragleave={imageDrop.dragleave}
    ondrop={imageDrop.drop}
  >
  {#if splitOn}
    <div
      class="nd-scroll tp-split-top"
      bind:this={topScroller}
      style:flex={`0 0 ${(layout.tutorialSplit * 100).toFixed(1)}%`}
      {onwheel}
    >
      <div class="nd-sheet tp-sheet" style:zoom={zoomStyle} style:--nd-gutter={`${fit.gutter}px`}>
        <div class="nd-editor" bind:this={mirrorHost}></div>
      </div>
    </div>
    <!-- A focusable `separator` is the WAI-ARIA window-splitter widget, which svelte's lint does
         not know is interactive. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="tp-split-bar"
      class:dragging={dividing}
      role="separator"
      tabindex="0"
      aria-orientation="horizontal"
      aria-label="Resize the two views of the sheet"
      aria-valuenow={Math.round(layout.tutorialSplit * 100)}
      aria-valuemin={Math.round(TUTORIAL_SPLIT.min * 100)}
      aria-valuemax={Math.round(TUTORIAL_SPLIT.max * 100)}
      title="Drag to resize · double-click to reset · Esc removes the split"
      onpointerdown={dividerdown}
      onkeydown={dividerkey}
      ondblclick={() => layout.setTutorialSplit(TUTORIAL_SPLIT.initial, bodyHeight)}
    ></div>
  {/if}
  <div class="nd-scroll" bind:this={scroller} bind:clientWidth={paneWidth} {onwheel}>
    <div class="nd-sheet tp-sheet" style:zoom={zoomStyle} style:--nd-gutter={`${fit.gutter}px`}>
      {#if working}
        <div class="local-working">
          {#each localQuestions as number (number)}
            <section class="local-question" aria-label={`Question ${number} local working`}>
              <h3>Question {number}</h3>
              <textarea aria-label={`Working for Question ${number}`} placeholder="Write your working here…" value={localDrafts[number] ?? ''} oninput={(event) => {
                localDrafts = { ...localDrafts, [number]: event.currentTarget.value };
                saveLocal();
              }}></textarea>
              <p>Local draft · This question has no generated part to check yet.</p>
            </section>
          {/each}
          <button type="button" class="local-add" onclick={addLocalQuestion}>+ Add missing question</button>
        </div>
      {/if}
      {#if phase === 'unavailable'}
        <div class="nd-state">
          <div class="nd-state-title">Tutorials are not available yet</div>
          <p class="nd-state-line">This build of ChatterED cannot read a tutorial sheet. Update the app and try again.</p>
        </div>
      {:else if phase === 'failed'}
        <div class="nd-state">
          <div class="nd-state-title">The sheet could not be read</div>
          <p class="nd-state-line">{failure || 'Max could not finish reading the sheet.'}</p>
          <div class="nd-state-actions">
            <button class="btn" type="button" onclick={() => fileId && void tut.retry(fileId)}>Retry</button>
          </div>
        </div>
      {:else if phase === 'reading'}
        <div class="nd-state">
          <div class="nd-state-title">{view?.docId ? 'Reading the sheet again…' : 'Reading the sheet…'}</div>
          <p class="nd-state-line">
            {#if reading && reading.total}
              page images sent · {reading.done} of {reading.total}
            {:else}
              Each part gets an answer slot. It opens here as soon as it is written.
            {/if}
          </p>
          <div class="nd-state-bar">
            {#if reading && reading.total}
              <div class="nd-state-fill" style:width={`${(reading.done / reading.total) * 100}%`}></div>
            {:else}
              <div class="nd-state-sweep"></div>
            {/if}
          </div>
        </div>
      {:else if phase === 'opening'}
        <div class="nd-state">
          <div class="nd-state-title">Opening the sheet…</div>
          {#if doc.error}
            <p class="nd-state-line">{doc.error}</p>
            <div class="nd-state-actions">
              <button class="btn" type="button" onclick={() => void doc.reloadTutorial()}>Try again</button>
            </div>
          {/if}
        </div>
      {:else}
        <NotesEditor
          {doc}
          tutorial={chrome}
          label="Tutorial sheet"
          onAskAboutFigure={askAboutFigure}
          mirror={splitOn ? mirrorHost : null}
        />

        {#if view && view.gaps.length > 0}
          <details class="tp-gaps">
            <summary>
              <span class="tp-gaps-name">Not covered by this sheet</span>
              <span class="tp-gaps-list">{gapsTitle}</span>
            </summary>
            <p class="tp-gaps-why">The lecture teaches these, and no part of this sheet practises them.</p>
            <ul>
              {#each view.gaps as gap (gap.objectiveId)}
                <li>
                  <span class="tp-gap-title">{gap.title}</span>
                  {#each gap.pages as page (page)}
                    <button
                      type="button"
                      class="tp-chip"
                      title="Open this slide"
                      onclick={(e) => store.doc.openSlide(page, null, e.currentTarget as HTMLElement)}
                    >{citation([page])}</button>
                  {/each}
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      {/if}
    </div>
  </div>
  </div>

  {#if imageOver === 'refused'}
    <!-- A file that is not an image, over the sheet: the cursor says no, and this says where. -->
    <div class="nd-drop-hint" role="status">Only images can be dropped here. Drop other files on Sources.</div>
  {/if}
  {#if tut.toast}
    {#key tut.toast.token}
      <div class="tp-toast" role="status">
        <span>{tut.toast.text}</span>
        <button type="button" aria-label="Dismiss" onclick={() => tut.dismissToast()}>×</button>
      </div>
    {/key}
  {/if}
  {#if phase !== 'ready' && fileId && view}
    <span class="sr-only" role="status">{tutorialLine(view, reading)}</span>
  {/if}
</div>

<style>
  .local-working { display: grid; gap: 0; }
  .local-question { border-bottom: 1px solid var(--hairline); padding: 16px 14px; }
  .local-question h3 { font-family: var(--font-display, Georgia, serif); font-size: 18px; font-weight: 400; margin: 0 0 10px; }
  .local-question textarea { width: 100%; min-height: 150px; resize: vertical; border: 1px solid var(--hairline); border-radius: 8px; padding: 12px; background: var(--pane); font-size: 14px; }
  .local-question textarea:focus { outline: 2px solid var(--indigo); }
  .local-question p { margin: 5px 0 0; color: var(--text-2); font-size: 11px; }
  .local-add { margin: 12px 14px; padding: 7px 11px; width: fit-content; border: 1px solid var(--hairline); border-radius: 7px; color: var(--text-2); }
  .local-add:hover { color: var(--indigo); border-color: var(--indigo); }
  .tp-working-title { font-family: var(--font-display, Georgia, serif); font-size: 17px; white-space: nowrap; }
  .working .tp-tabs, .working .tp-kicker, .working .tp-title { display: none; }
  .tp-nd { position: relative; height: 100%; border-left: 1px solid var(--hairline); }
  .tp-nd.floating,
  .tp-nd.main { border-left: 0; }
  .tp-notes-btn.on { border-color: var(--indigo); background: var(--indigo-tint); color: var(--indigo); }

  .tp-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 5px 8px 5px 14px;
    border-bottom: 1px solid var(--hairline);
    background: var(--pane);
    user-select: none;
  }
  .tp-head.grab { cursor: grab; background: var(--ground); }
  /* Docked beside the notes the header is narrow: the zoom keeps its three buttons, tighter. */
  .tp-zoom-narrow :global(button) { padding: 3px 5px; }
  .tp-kicker {
    flex: none;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--indigo);
  }
  /* The title takes the row's slack and ellipsises; it never shrinks to nothing (it did, at 360
     px, behind the parts bar and the buttons: 3 Oct 2026). */
  .tp-title {
    flex: 1 1 auto;
    min-width: 4em;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-spacer { flex: 1 1 auto; }

  /* Every tab stays in sight: they share the room and each ellipsises, down to a stub. */
  .tp-tabs { flex: 0 1 auto; display: flex; gap: 2px; min-width: 0; overflow: hidden; }
  .tp-tab {
    flex: 0 1 auto;
    min-width: 56px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 200px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-tab-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tp-tab:hover { background: var(--ground); color: var(--text); }
  .tp-tab.on { background: var(--indigo-tint); color: var(--indigo); font-weight: 600; }
  .tp-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--indigo); animation: tp-pulse 1.2s ease-in-out infinite; }
  @keyframes tp-pulse { 50% { opacity: 0.3; } }

  .tp-parts {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tp-head.narrow { gap: 6px; padding-left: 12px; }
  .tp-head.narrow .tp-bar { display: none; }
  .tp-btn.icon { display: inline-flex; align-items: center; justify-content: center; padding: 3px 7px; }
  .tp-btn.icon svg { display: block; }
  .tp-bar { width: 48px; height: 4px; border-radius: 2px; background: var(--hairline); overflow: hidden; }
  .tp-bar > i { display: block; height: 100%; background: var(--indigo); border-radius: 2px; transition: width 0.3s ease; }

  .tp-btn {
    flex: none;
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .tp-btn:hover { border-color: var(--indigo); color: var(--indigo); }
  .tp-btn.confirm { border-color: var(--indigo); background: var(--indigo-tint); color: var(--indigo); }
  .tp-close { border-color: transparent; background: transparent; font-size: 16px; line-height: 1; padding: 2px 7px; }
  .tp-close:hover { border-color: transparent; background: var(--ground); color: var(--text); }

  .tp-sheet { padding-top: 22px; }

  /* ── Split: the two views and the divider between them ── */
  .tp-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .tp-split-top { min-height: 0; }
  /* The top view is for looking: its sheet ends with the document, not with room to scroll past. */
  .tp-split-top .tp-sheet { padding-bottom: 32px; }
  .tp-split-btn.on { border-color: var(--indigo); background: var(--indigo-tint); color: var(--indigo); }
  .tp-split-bar {
    flex: none;
    position: relative;
    height: 9px;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
    background: var(--pane);
    cursor: row-resize;
    touch-action: none;
    outline: none;
    z-index: 2;
  }
  /* A grip in the middle, so the divider reads as something to drag. */
  .tp-split-bar::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 2px;
    width: 36px;
    height: 3px;
    transform: translateX(-50%);
    border-radius: 2px;
    background: var(--muted);
    opacity: 0.45;
    transition: background 0.12s ease;
  }
  .tp-split-bar:hover::after,
  .tp-split-bar.dragging::after { background: var(--indigo); opacity: 1; }
  .tp-split-bar:focus-visible { background: var(--indigo-tint); }
  .tp-split-bar:focus-visible::after { background: var(--indigo); opacity: 1; }

  .tp-gaps {
    max-width: var(--nd-column);
    margin: 28px auto 0;
    padding: 9px 12px;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius);
    font-size: 12px;
    color: var(--text-2);
  }
  .tp-gaps summary { cursor: pointer; display: flex; gap: 6px; align-items: baseline; list-style: none; }
  .tp-gaps summary::-webkit-details-marker { display: none; }
  .tp-gaps summary::before { content: '▸'; font-size: 10px; color: var(--muted); }
  .tp-gaps[open] summary::before { content: '▾'; }
  .tp-gaps-name { flex: none; font-weight: 600; color: var(--text); }
  .tp-gaps-list { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tp-gaps[open] .tp-gaps-list { display: none; }
  .tp-gaps-why { margin: 6px 0 6px 16px; font-size: 11.5px; color: var(--text-2); }
  .tp-gaps ul { list-style: none; margin: 0; padding: 0 0 0 16px; display: grid; gap: 4px; }
  .tp-gaps li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .tp-gap-title { color: var(--text); }
  .tp-chip {
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 999px;
    padding: 0 8px;
    font-size: 10.5px;
    color: var(--text-2);
  }
  .tp-chip:hover { border-color: var(--indigo); color: var(--indigo); }

  .tp-toast {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(440px, calc(100% - 32px));
    padding: 8px 8px 8px 14px;
    border-radius: 10px;
    background: var(--text);
    color: var(--pane);
    font-size: 12px;
    line-height: 1.45;
    box-shadow: 0 8px 24px rgb(20 20 40 / 22%);
    animation: tp-in 160ms ease-out;
  }
  .tp-toast button { flex: none; color: inherit; opacity: 0.7; font-size: 15px; line-height: 1; padding: 0 4px; }
  .tp-toast button:hover { opacity: 1; }
  @keyframes tp-in { from { opacity: 0; transform: translate(-50%, 6px); } }
  @media (prefers-reduced-motion: reduce) {
    .tp-toast, .tp-tab-dot { animation: none; }
  }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
