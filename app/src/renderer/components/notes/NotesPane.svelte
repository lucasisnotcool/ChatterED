<script lang="ts">
  /**
   * **The document column** — the middle of `file panel · doc · chats` (§0).
   *
   * Self-sufficient by contract: given a `fileId` it loads the notes, rasterises and hands over
   * the page images, starts the ingest if there are none, renders the document, saves it, and
   * hosts the carousel and the slide modal. T5 mounts this and passes nothing else.
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
   */
  import { flushSync } from 'svelte';
  import { NOTES_ZOOM, blockAnchorDelta, percent, sheetGutter, zoomIn, zoomOut } from '../../lib/layout.js';
  import { layout } from '../../lib/layoutstore.svelte.js';
  import { pinchScale } from '../../lib/pdfview.js';
  import { store } from '../../lib/store.svelte.js';
  import { registerViewer, type ViewerCommand } from '../../lib/viewer.js';
  import InsertControl from './InsertControl.svelte';
  import ListenControl from './ListenControl.svelte';
  import NotesEditor from './NotesEditor.svelte';
  import SlideCarousel from './SlideCarousel.svelte';
  import SlideModal from './SlideModal.svelte';
  import type { SpanThreadView } from '../../lib/pm/chrome.js';
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
  /** The gutters give way to the text when zoomed in a narrow pane (`sheetGutter`). */
  const gutter = $derived(sheetGutter(paneWidth, layout.notesZoom));

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
    // page.next / page.prev: the notes are not paged. The slide modal answers them when it is up.
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

  const savedLabel = $derived.by(() => {
    if (doc.saving) return 'Saving…';
    if (doc.savedAt > 0) return 'Saved';
    return '';
  });
</script>

<div class="nd">
  <header class="nd-head">
    <span class="nd-title">{doc.title || 'Lecture notes'}</span>
    {#if doc.pageCount > 0}
      <span class="nd-head-meta">{doc.pageCount} slides</span>
    {/if}
    <span class="nd-head-spacer"></span>
    {#if savedLabel}<span class="nd-head-meta">{savedLabel}</span>{/if}
    <ListenControl {doc} {scroller} />
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
    <InsertControl {doc} />
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
  </header>

  <div class="nd-scroll" bind:this={scroller} bind:clientWidth={paneWidth} {onwheel}>
    <div
      class="nd-sheet"
      style:zoom={layout.notesZoom === 1 ? null : String(layout.notesZoom)}
      style:--nd-gutter={`${gutter}px`}
    >
      {#if doc.error && !ready}
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
          <div class="nd-state-title">Ellie is reading the slides…</div>
          <p class="nd-state-line">
            {#if doc.rasterising}
              page images sent · {doc.rasterising.done} of {doc.rasterising.total}
            {:else if doc.ingest.windowsTotal > 0}
              window {doc.ingest.windowsDone} of {doc.ingest.windowsTotal}
            {:else}
              She opens the notes as soon as the first pages are written.
            {/if}
          </p>
          <div class="nd-state-bar">
            {#if doc.rasterising && doc.rasterising.total > 0}
              <div class="nd-state-fill" style:width={`${(doc.rasterising.done / doc.rasterising.total) * 100}%`}></div>
            {:else if doc.ingest.windowsTotal > 0}
              <div class="nd-state-fill" style:width={`${(doc.ingest.windowsDone / doc.ingest.windowsTotal) * 100}%`}></div>
            {:else}
              <div class="nd-state-sweep"></div>
            {/if}
          </div>
        </div>
      {:else}
        {#if doc.frozen}
          <p class="nd-frozen-note">
            Frozen — Ellie and Max are not editing these notes. They still answer in the chat.
          </p>
        {/if}

        <NotesEditor {doc} onAskAboutFigure={askAboutFigure} />

        {#if status === 'streaming'}
          <p class="nd-writing">
            <span class="nd-writing-dot"></span>
            Ellie is still writing — window {doc.ingest.windowsDone} of {doc.ingest.windowsTotal}
          </p>
        {/if}

        <SlideCarousel
          source={doc.slides()}
          sections={() => doc.sections()}
          pageCount={doc.pageCount}
          onopen={(page) => doc.openSlide(page, null)}
        />
      {/if}
    </div>
  </div>
</div>

{#if doc.modal}
  <SlideModal
    source={doc.slides()}
    page={doc.modal.page}
    rect={doc.modal.rect}
    pageCount={doc.pageCount}
    onclose={() => doc.closeSlide()}
  />
{/if}
