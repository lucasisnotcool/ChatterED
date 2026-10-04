<script lang="ts">
  /**
   * **The document column** — the middle of `file panel · doc · chats` (§0).
   *
   * Self-sufficient by contract: given a `fileId` it loads the notes, rasterises and hands over
   * the page images, starts the ingest if there are none, renders the document, saves it, and
   * hosts the list a dragged slide is dropped on (2026-10-03: the carousel and the slide modal it
   * hosted are gone; each section has its own strip, `pm/slidestrip.ts`, and a slide opens in a
   * window beside what was clicked, `pm/slidewindow.ts`). T5 mounts this and passes nothing else.
   *
   * It also wires the two cross-track calls, here rather than in the store, so that neither
   * `docstore.svelte.ts` nor `chatstore.svelte.ts` imports the other:
   *   - **T4 → T5**: Ctrl+E hands a span to `store.chat.openSpanThread({ blockId, quote })`, and
   *     a highlight click calls `store.chat.focusThread(threadId)`.
   *   - **T5 → T4**: the highlights themselves are drawn from `store.chat.spanThreads`.
   * `store.chat` is T5's and is read defensively until its surface lands.
   *
   * **Zoom.** ⌘+ / ⌘− / ⌘0 (View ▸ Zoom, routed through `lib/viewer.ts`), a trackpad pinch over
   * the notes, and the − 100 % + in the header all set one number, `layout.notesZoom`, which is
   * CSS `zoom` on the sheet — so the text, the figures and the gutter chips scale together and
   * the text reflows, and nothing outside the document moves. The paragraph being read stays
   * where it was on screen: the zoom is anchored to the block under the pointer (a pinch) or at
   * the top of the pane (the keys), not to a scroll offset that reflow would invalidate.
   *
   * **A notebook's learning overview** (`docs/research/notebooks.md`, 2026-10-01). `fileId` is the
   * notebook id (contract C2). This pane hands the doc store the open notebook (its sources are
   * the slides and the chips' labels, C1) and the progress view (the objectives' fills, C5); says
   * "Add a source to start" or "Reading your sources…" before there is an overview; and puts the
   * out-of-date banner over the doc (§2: never rewritten silently). The header is lighter for an
   * overview: Regenerate is only for a file outside a notebook, because Update overview replaces it.
   */
  import { flushSync, tick, untrack } from 'svelte';
  import { isNotebookId, type NotebookView } from '../../../shared/notebook.js';
  import { notebookEmpty, overviewBanner, overviewMeta } from '../../lib/pm/overview.js';
  import {
    NOTES_HEAD_COMPACT_BELOW,
    NOTES_ZOOM,
    blockAnchorDelta,
    headCompact,
    percent,
    sheetFit,
    zoomIn,
    zoomOut,
  } from '../../lib/layout.js';
  import { layout } from '../../lib/layoutstore.svelte.js';
  import { pinchScale } from '../../lib/pdfview.js';
  import { store } from '../../lib/store.svelte.js';
  import { registerViewer, type ViewerCommand } from '../../lib/viewer.js';
  import { sheetImageDrop } from '../../lib/sheetdrop.js';
  import InsertControl from './InsertControl.svelte';
  import ListenControl from './ListenControl.svelte';
  import NotesEditor from './NotesEditor.svelte';
  import SlideRegroup from './SlideRegroup.svelte';
  import type { SpanThreadView } from '../../lib/pm/chrome.js';
  import { bumpTutorialChrome, type PracticeChipsContext } from '../../lib/pm/tutorial.js';
  import './notes.css';
  import './table.css';

  let { fileId }: { fileId: string } = $props();

  const doc = store.doc;

  /** T5's chat store, as much of it as has landed. Never assumed. */
  interface ChatSurface {
    openSpanThread?: (input: { blockId: string; quote: string }) => void;
    focusThread?: (threadId: string) => void;
    sendDraft?: (question: string) => Promise<string | null>;
    spanThreads?: readonly SpanThreadView[];
  }
  const chat = (): ChatSurface => store.chat as unknown as ChatSurface;

  doc.askAboutSpan = (input) => chat().openSpanThread?.(input);
  doc.focusThread = (threadId) => chat().focusThread?.(threadId);
  doc.spanThreads = () => chat().spanThreads ?? [];
  doc.progressView = () => store.progress.view;

  /**
   * The open notebook, to the doc store. Snapshotted here so the read is **deep**: a source going
   * from reading to ready changes a field inside the view, and that is exactly the change that
   * starts a first overview. The store is told inside `untrack`, so nothing it reads re-runs this.
   */
  $effect(() => {
    const view = store.notebook.view;
    const snapshot = view ? ($state.snapshot(view) as NotebookView) : null;
    untrack(() => doc.setNotebook(snapshot));
  });

  /** The objectives' fills are the progress view's: a fill moving changes nothing in the doc. */
  $effect(() => {
    const signature = (store.progress.view?.objectives ?? []).map((o) => `${o.objectiveId}:${o.fill}`).join('|');
    void signature;
    untrack(() => doc.refreshChrome());
  });

  /**
   * "Ask Ellie about this" on a figure's label: Ctrl+E's own path, with the question already
   * written. The draft is opened on the figure's block and sent at once, so the thread is created
   * by `chat:openSpan`, focused and read back exactly as a typed one is. If the send fails, the
   * draft stays in the chat column with the label quoted, for the learner to ask in their words.
   */
  function askAboutFigure(input: { blockId: string; quote: string; question: string }): void {
    const surface = chat();
    if (!surface.openSpanThread) return;
    surface.openSpanThread({ blockId: input.blockId, quote: input.quote });
    void surface.sendDraft?.(input.question);
  }

  $effect(() => {
    const id = fileId;
    if (id) void doc.open(id);
  });

  /**
   * **Practise** under each section (`tutorials.md` §7): the tutorial parts linked to it, from the
   * tutorial store. A plain snapshot, read by the plugin on every rebuild; a part's record moving
   * (a Check) changes nothing in the notes, so the store's revision redraws them.
   */
  const practice = (): PracticeChipsContext => ({
    tutorials: () => store.tutorial.snapshot(),
    onOpenPart: (tutorialFileId, partId) => void store.tutorial.openPart(tutorialFileId, partId),
  });
  $effect(() => {
    void store.tutorial.revision;
    untrack(() => doc.redraw(bumpTutorialChrome));
  });

  /**
   * The span highlights are drawn from T5's list, and a thread appearing there changes nothing in
   * the document — so nothing would tell ProseMirror's decoration set to rebuild. Watching the
   * signature here is what closes that gap.
   */
  $effect(() => {
    const signature = (chat().spanThreads ?? []).map((t) => `${t.threadId}:${t.blockId}`).join('|');
    void signature;
    doc.refreshChrome();
  });

  const status = $derived(doc.ingest.status);
  const ready = $derived(status === 'streaming' || status === 'ready');

  const isNotebook = $derived(isNotebookId(fileId));
  const notebook = $derived(store.notebook.view && store.notebook.view.id === fileId ? store.notebook.view : null);
  /** Before there is an overview: no source, sources still being read, or none ticked. */
  const empty = $derived(
    isNotebook && !doc.docId && !doc.loading && status === 'none' ? notebookEmpty(notebook) : null,
  );
  const banner = $derived(
    overviewBanner({
      ready: status === 'ready' && !doc.updatingOverview,
      hasDoc: Boolean(doc.docId),
      overview: doc.overview,
      notebook,
      dismissed: doc.bannerDismissed,
    }),
  );
  const kicker = $derived(overviewMeta(doc.overview));
  /** The ingest error the learner dismissed: the line stays gone until a different one arrives. */
  let errorDismissed = $state<string | null>(null);

  async function updateOverview(): Promise<void> {
    const line = await doc.updateOverview();
    if (line) store.notice = { level: 'info', text: line };
  }
  /**
   * **Regenerate** (2026-09-23). Offered once the notes are finished (or have failed): regenerating
   * over a deck that is still being written would be two runs appending to one document, and main
   * refuses it anyway. The confirm is main's, so this button only asks.
   */
  const canRegenerate = $derived(Boolean(doc.docId) && (status === 'ready' || status === 'failed'));
  async function regenerate(): Promise<void> {
    const line = await doc.regenerate();
    if (line) store.notice = { level: 'info', text: line };
  }

  /**
   * **Add a question** (2026-10-01): a Q block of the learner's own, after the block their cursor
   * is in. Offered only while the editor is on screen, which is what `ready` means here.
   */
  const canAsk = $derived(Boolean(doc.docId) && ready);

  // ── Zoom ────────────────────────────────────────────────────────────────
  let scroller = $state<HTMLElement | null>(null);
  let paneWidth = $state(0);
  /**
   * The gutters give way to the text when zoomed in a narrow pane (`sheetGutter`), and below
   * `COMPACT_BELOW` units the sheet goes compact: the gutters' chrome moves into the column
   * (`sheetFit`, notes.css `.nd-compact`). The header folds on its own, narrower rule.
   */
  const fit = $derived(sheetFit(paneWidth, layout.notesZoom));
  const narrowHead = $derived(headCompact(paneWidth, NOTES_HEAD_COMPACT_BELOW));
  const title = $derived(doc.title || notebook?.name || 'Lecture notes');

  // ── the narrow header's ⋯ menu ──────────────────────────────────────────
  let moreOpen = $state(false);
  let moreRoot = $state<HTMLElement | null>(null);
  let moreButton = $state<HTMLButtonElement | null>(null);
  let morePop = $state<HTMLElement | null>(null);

  function closeMore(focusButton = false): void {
    moreOpen = false;
    if (focusButton) moreButton?.focus();
  }

  /** From the keyboard (`detail` 0), the first item takes the focus, as a menu's should. */
  function toggleMore(fromKeyboard: boolean): void {
    moreOpen = !moreOpen;
    if (moreOpen && fromKeyboard) void tick().then(() => menuItems()[0]?.focus());
  }

  function menuItems(): HTMLButtonElement[] {
    return [...(morePop?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  }

  function moreKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMore(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = menuItems();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  /** A press anywhere else closes it; so does the header widening past the fold. */
  $effect(() => {
    if (!moreOpen) return;
    const away = (e: PointerEvent): void => {
      if (moreRoot && !moreRoot.contains(e.target as Node)) moreOpen = false;
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
  $effect(() => {
    if (!narrowHead) untrack(() => (moreOpen = false));
  });

  /** The block under a viewport point, or the first block below it (a gap between two). */
  function blockAt(x: number, y: number): HTMLElement | null {
    const hit = document.elementFromPoint(x, y);
    const block = hit?.closest<HTMLElement>('.ProseMirror > *');
    if (block) return block;
    const all = scroller?.querySelectorAll<HTMLElement>('.ProseMirror > *') ?? [];
    for (const el of all) if (el.getBoundingClientRect().bottom >= y) return el;
    return null;
  }

  /**
   * Set the zoom and keep the block at `(x, y)` where it was. `flushSync` puts the new zoom in
   * the DOM now, so the second measurement is of the new layout rather than the old one.
   */
  function setZoom(next: number, at?: { x: number; y: number }): void {
    const el = scroller;
    if (!el) {
      layout.setNotesZoom(next);
      return;
    }
    const box = el.getBoundingClientRect();
    const point = at ?? { x: box.left + box.width / 2, y: box.top + Math.min(80, box.height / 3) };
    const block = blockAt(point.x, point.y);
    const before = block?.getBoundingClientRect();
    flushSync(() => layout.setNotesZoom(next));
    if (block && before) {
      el.scrollTop += blockAnchorDelta(before, block.getBoundingClientRect(), point.y);
    }
  }

  function command(c: ViewerCommand): void {
    if (c === 'zoom.in') setZoom(zoomIn(layout.notesZoom, NOTES_ZOOM));
    else if (c === 'zoom.out') setZoom(zoomOut(layout.notesZoom, NOTES_ZOOM));
    else if (c === 'zoom.reset' || c === 'fit.width' || c === 'fit.page') setZoom(1);
    // page.next / page.prev: the notes are not paged.
  }
  $effect(() => registerViewer(command));

  /**
   * A macOS pinch is a `wheel` with `ctrlKey` (measured in PdfViewer.svelte). The events come at
   * the display's rate and a zoom reflows the whole document, so they are folded into one
   * change per frame.
   */
  let pending: { zoom: number; x: number; y: number } | null = null;
  function onwheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const from = pending?.zoom ?? layout.notesZoom;
    const zoom = Math.min(NOTES_ZOOM.max, Math.max(NOTES_ZOOM.min, pinchScale(from, e.deltaY)));
    const first = pending === null;
    pending = { zoom, x: e.clientX, y: e.clientY };
    if (!first) return;
    requestAnimationFrame(() => {
      const p = pending;
      pending = null;
      if (p) setZoom(p.zoom, p);
    });
  }

  /**
   * **An image dropped on the notes** (2026-10-04) goes into them where it was dropped, as a page
   * of the notebook (`lib/sheetdrop.ts`). Other files go in only on the sources column.
   */
  let imageOver = $state<'image' | 'refused' | null>(null);
  const imageDrop = sheetImageDrop({ doc, notebook: store.notebook, accept: () => ready, onover: (o) => (imageOver = o) });

  const savedLabel = $derived.by(() => {
    if (doc.saving) return 'Saving…';
    if (doc.savedAt > 0) return 'Saved';
    return '';
  });
</script>

{#snippet zoomGroup()}
  <span class="nd-zoom" role="group" aria-label="Zoom the notes">
    <button
      type="button"
      class="nd-zoom-step"
      aria-label="Zoom out"
      title="Zoom out (⌘−, or pinch)"
      disabled={layout.notesZoom <= NOTES_ZOOM.min}
      onclick={() => command('zoom.out')}
    >−</button>
    <button
      type="button"
      class="nd-zoom-level"
      aria-label={`Zoom ${percent(layout.notesZoom)}. Reset to 100%`}
      title="Actual size (⌘0)"
      onclick={() => command('zoom.reset')}
    >{percent(layout.notesZoom)}</button>
    <button
      type="button"
      class="nd-zoom-step"
      aria-label="Zoom in"
      title="Zoom in (⌘+, or pinch)"
      disabled={layout.notesZoom >= NOTES_ZOOM.max}
      onclick={() => command('zoom.in')}
    >+</button>
  </span>
{/snippet}

<div class="nd" class:nd-compact={fit.compact}>
  <header class="nd-head" class:nd-head-compact={narrowHead}>
    <span class="nd-title" title={narrowHead ? title : null}>{title}</span>
    {#if !isNotebook && doc.pageCount > 0}
      <span class="nd-head-meta">{doc.pageCount} slides</span>
    {/if}
    <span class="nd-head-spacer"></span>
    {#if savedLabel}<span class="nd-head-meta">{savedLabel}</span>{/if}
    <!-- Listen and Insert stay on the row at any width: each owns a state that must stay in
         sight while it runs (the reading's Pause · Stop, the half-minute Insert), and they are
         never unmounted, so neither is cut off by the header folding. -->
    <ListenControl {doc} {scroller} />
    {#if !narrowHead}
      {@render zoomGroup()}
    {/if}
    <InsertControl {doc} />
    {#if !narrowHead}
    <button
      class="nd-toggle"
      type="button"
      disabled={!canAsk}
      title={canAsk
        ? 'Write a question of your own into the notes, answer it there, and Max marks it.'
        : 'The notes are not open yet.'}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => doc.addOwnQuestion()}
    >
      Add a question
    </button>
    {#if !isNotebook}
    <button
      class="nd-toggle"
      type="button"
      disabled={!canRegenerate}
      title={canRegenerate
        ? 'Rewrite these notes from the slides. Asks first: everything in them is replaced.'
        : 'Ellie is still writing these notes.'}
      onclick={() => void regenerate()}
    >
      Regenerate…
    </button>
    {/if}
    <button
      class="nd-toggle"
      type="button"
      aria-pressed={doc.frozen}
      title={doc.frozen
        ? 'Ellie and Max are not editing. Unfreeze to let them back in.'
        : 'Stop Ellie and Max editing. They still talk.'}
      onclick={() => void doc.setFrozen(!doc.frozen)}
    >
      <span class="nd-toggle-dot"></span>
      {doc.frozen ? 'Frozen' : 'Freeze'}
    </button>
    {:else}
      <!-- A narrow pane: the state that matters stays in sight (Frozen), the rest is one menu. -->
      {#if doc.frozen}
        <button
          class="nd-toggle"
          type="button"
          aria-pressed="true"
          title="Ellie and Max are not editing. Unfreeze to let them back in."
          onclick={() => void doc.setFrozen(false)}
        >
          <span class="nd-toggle-dot"></span>
          Frozen
        </button>
      {/if}
      <span class="nd-more" bind:this={moreRoot}>
        <button
          bind:this={moreButton}
          class="nd-toggle nd-more-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More: zoom, Add a question, Freeze"
          title="Zoom, Add a question, Freeze"
          onmousedown={(e) => e.preventDefault()}
          onclick={(e) => toggleMore(e.detail === 0)}
        >⋯</button>
        {#if moreOpen}
          <div class="nd-more-pop" role="menu" aria-label="More" tabindex="-1" bind:this={morePop} onkeydown={moreKey}>
            <div class="nd-more-row" role="group" aria-label="Zoom">
              <span class="nd-more-label">Zoom</span>
              {@render zoomGroup()}
            </div>
            <button
              type="button"
              role="menuitem"
              class="nd-more-item"
              disabled={!canAsk}
              title={canAsk
                ? 'Write a question of your own into the notes, answer it there, and Max marks it.'
                : 'The notes are not open yet.'}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => {
                closeMore();
                doc.addOwnQuestion();
              }}
            >Add a question</button>
            {#if !isNotebook}
              <button
                type="button"
                role="menuitem"
                class="nd-more-item"
                disabled={!canRegenerate}
                onclick={() => {
                  closeMore();
                  void regenerate();
                }}
              >Regenerate…</button>
            {/if}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={doc.frozen}
              class="nd-more-item"
              title={doc.frozen
                ? 'Ellie and Max are not editing. Unfreeze to let them back in.'
                : 'Stop Ellie and Max editing. They still talk.'}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => {
                closeMore();
                void doc.setFrozen(!doc.frozen);
              }}
            >
              <span class="nd-toggle-dot" class:on={doc.frozen}></span>
              {doc.frozen ? 'Unfreeze Ellie and Max' : 'Freeze Ellie and Max'}
            </button>
          </div>
        {/if}
      </span>
    {/if}
  </header>

  <div
    class="nd-scroll"
    class:nd-dropping={imageOver === 'image'}
    bind:this={scroller}
    bind:clientWidth={paneWidth}
    {onwheel}
    data-dropzone
    role="region"
    aria-label="Lecture notes"
    ondragenter={imageDrop.dragenter}
    ondragover={imageDrop.dragover}
    ondragleave={imageDrop.dragleave}
    ondrop={imageDrop.drop}
  >
    <div
      class="nd-sheet"
      role="presentation"
      onmousedown={(e) => {
        // Only a press on the sheet itself, beside the notes: not one inside them or on a strip.
        if (e.target === e.currentTarget && e.button === 0 && doc.placeCaretBeside(e.clientX, e.clientY)) e.preventDefault();
      }}
      style:zoom={layout.notesZoom === 1 ? null : String(layout.notesZoom)}
      style:--nd-gutter={`${fit.gutter}px`}
    >
      {#if empty}
        <div class="nd-state nd-empty">
          <div class="nd-state-title">{empty.title}</div>
          <p class="nd-state-line">{empty.line}</p>
          {#if empty.kind === 'reading'}
            <div class="nd-state-bar"><div class="nd-state-sweep"></div></div>
          {/if}
        </div>
      {:else if doc.error && !ready}
        <div class="nd-state">
          <div class="nd-state-title">These notes could not be opened</div>
          <p class="nd-state-line">{doc.error}</p>
          <div class="nd-state-actions">
            <button class="btn" type="button" onclick={() => void doc.retryIngest()}>Try again</button>
          </div>
        </div>
      {:else if status === 'failed'}
        <div class="nd-state">
          <div class="nd-state-title">The ingest stopped</div>
          <p class="nd-state-line">{doc.ingest.error ?? 'Ellie could not finish reading the slides.'}</p>
          <div class="nd-state-actions">
            <button class="btn" type="button" onclick={() => void doc.retryIngest()}>Retry</button>
          </div>
        </div>
      {:else if !ready}
        <div class="nd-state">
          <div class="nd-state-title">
            {doc.updatingOverview
              ? 'Ellie is updating the overview…'
              : isNotebook
                ? 'Ellie is reading your sources…'
                : 'Ellie is reading the slides…'}
          </div>
          <p class="nd-state-line">
            {#if doc.rasterising}
              page images sent · {doc.rasterising.done} of {doc.rasterising.total}
            {:else if isNotebook}
              <!-- The overview lands in one write; a notebook too big for one call is condensed
                   source by source first, and only then is there a count worth showing (N2). -->
              {#if doc.ingest.windowsTotal > 1}
                Condensing source {Math.min(doc.ingest.windowsDone + 1, doc.ingest.windowsTotal)} of {doc.ingest.windowsTotal}…
              {:else}
                She opens the overview as soon as it is written.
              {/if}
            {:else if doc.ingest.windowsTotal > 0}
              window {doc.ingest.windowsDone} of {doc.ingest.windowsTotal}
            {:else}
              She opens the notes as soon as the first pages are written.
            {/if}
          </p>
          <div class="nd-state-bar">
            {#if doc.rasterising && doc.rasterising.total > 0}
              <div class="nd-state-fill" style:width={`${(doc.rasterising.done / doc.rasterising.total) * 100}%`}></div>
            {:else if doc.ingest.windowsTotal > (isNotebook ? 1 : 0)}
              <div class="nd-state-fill" style:width={`${(doc.ingest.windowsDone / doc.ingest.windowsTotal) * 100}%`}></div>
            {:else}
              <div class="nd-state-sweep"></div>
            {/if}
          </div>
        </div>
      {:else}
        {#if banner}
          <div class="nd-banner" role="status">
            <span class="nd-banner-text">{banner.text}</span>
            <span class="nd-banner-acts">
              <button class="nd-banner-go" type="button" onclick={() => void updateOverview()}>
                {banner.kind === 'legacy' ? 'Make overview' : 'Update overview'}
              </button>
              <button class="nd-banner-later" type="button" onclick={() => doc.dismissBanner(banner.fingerprint)}>
                Not now
              </button>
            </span>
          </div>
        {/if}
        {#if status === 'ready' && doc.ingest.error && doc.ingest.error !== errorDismissed}
          <!-- A failed Update leaves the overview as it was, with main's reason (N2). -->
          <div class="nd-banner nd-banner-error" role="alert">
            <span class="nd-banner-text">The overview was not updated: {doc.ingest.error}</span>
            <span class="nd-banner-acts">
              <button class="nd-banner-later" type="button" onclick={() => (errorDismissed = doc.ingest.error)}>
                Dismiss
              </button>
            </span>
          </div>
        {/if}
        {#if kicker}
          <p class="nd-kicker"><span class="nd-kicker-name">Learning overview</span> · {kicker}</p>
        {/if}
        {#if doc.frozen}
          <p class="nd-frozen-note">
            Frozen — Ellie and Max are not editing these notes. They still answer in the chat.
          </p>
        {/if}

        <NotesEditor {doc} onAskAboutFigure={askAboutFigure} {practice} />

        {#if status === 'streaming'}
          <p class="nd-writing">
            <span class="nd-writing-dot"></span>
            Ellie is still writing — window {doc.ingest.windowsDone} of {doc.ingest.windowsTotal}
          </p>
        {/if}
      {/if}
    </div>
  </div>

  {#if doc.slideDrag}
    <SlideRegroup
      groups={doc.slideGroupList()}
      page={doc.slideDrag.page}
      from={doc.slideDrag.from}
      source={doc.slides()}
      top={scroller?.offsetTop ?? 0}
      ondrop={(key, title) => void doc.moveSlide(doc.slideDrag?.page ?? 0, key, title)}
      oncancel={() => (doc.slideDrag = null)}
    />
  {/if}
  {#if imageOver === 'refused'}
    <!-- A file that is not an image, over the sheet: the cursor says no, and this says where. -->
    <div class="nd-drop-hint" role="status">Only images can be dropped here. Drop other files on Sources.</div>
  {/if}
</div>
