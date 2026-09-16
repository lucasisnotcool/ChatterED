<script lang="ts">
  /**
   * The flow (`flow-build-plan.md` §3.2 / §4.1, issue #25).
   *
   * **ChatterED opens a lecture deck as a flow.** Every page arrives as one whole-page crop of
   * the pdf.js-rendered page — the lecturer's own pixels — and the page's own geometry proposes
   * cuts as faint ticks in each card's gutter. Nothing is cut until the learner clicks one, and
   * clicking one splits the crop **in place**: no re-render, no refetch, one number changing.
   *
   * This component owns four things:
   *
   *   1. **Its own render path.** The flow rasterises each page once, at the scale the cards
   *      need, into a canvas it keeps in its own `PageLru`. It deliberately does not borrow
   *      `PdfViewer`'s canvases: that viewer releases a page the moment it is ±3 pages off
   *      screen, and a crop drawn off a released canvas is the blank card risk 3 in §5 is about.
   *      `PdfViewer` is untouched and stays the page viewer, one click away.
   *   2. **The scroll anchor.** A split adds a card's chrome above the fold, so the scroller has
   *      to follow it or the deck jumps under the learner's eye. `scrollAfterSplit` decides.
   *   3. **The undo stack.** Split, merge and reorder are all numbers, so undo is the inverse
   *      operation sent back through the same IPC channel — SQLite stays the source of truth and
   *      the service re-checks SEGMENTS.md §5's invariants on the way in.
   *   4. **Original pages**, which is the fidelity claim made operable: it flips every card to
   *      its full page box in page order and is visibly instant, because it re-renders nothing.
   */
  import { untrack } from 'svelte';
  import * as pdfjs from 'pdfjs-dist';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import type { DocumentView } from '../../shared/types.js';
  import {
    CONTENT_WIDTH,
    LABEL_STRIP,
    PAGE_CACHE,
    PLACEHOLDER,
    PageLru,
    SPLIT_ADDED_HEIGHT,
    colourFromPixel,
    flowCards,
    invert,
    mergeSeam,
    minWidthFraction,
    newSegmentIds,
    pageRenderScale,
    scrollAfterMerge,
    scrollAfterSplit,
    type FlowMode,
    type FlowOp,
    type PagePt,
  } from '../lib/flowview.js';
  import { claimsForAnchor, threadFor } from '../../shared/flowthread.js';
  import { store } from '../lib/store.svelte.js';
  import FlowThread from './FlowThread.svelte';
  import SegmentCard from './SegmentCard.svelte';
  import WhisperPopover from './WhisperPopover.svelte';

  let { doc, onclose }: { doc: DocumentView; onclose: () => void } = $props();

  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

  let pdf = $state<PDFDocumentProxy | null>(null);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let mode = $state<FlowMode>('segments');
  let undoStack = $state<FlowOp[]>([]);
  let busy = $state(false);

  /** Bumped per page when its canvas has been painted, so the cards redraw. */
  let rev = $state<Record<number, number>>({});
  /** Each page's own background colour, sampled from its rendered corner. */
  let bg = $state<Record<number, string>>({});

  const flow = $derived(store.flow);
  const cards = $derived(flowCards(flow?.segments ?? [], mode));

  /**
   * The conversation, read straight off the live room snapshot.
   *
   * There is no second copy and no second subscription: `store.room` is the ordinary
   * `RoomSnapshot` the main process already pushes `message.appended`, `agent.thinking`,
   * `ledger.updated` and `timer.updated` into, and the grouping is `shared/flowthread.ts` — the
   * same functions the main process built `FlowRoomView.threads` with. One implementation, so
   * the flow and the transcript can never disagree about where a turn landed.
   */
  const room = $derived(store.room);
  const messages = $derived(room?.messages ?? []);

  /**
   * The page canvases. Not reactive state on purpose (the same reasoning as `PdfViewer.drawn`):
   * it is a render cache, nothing reads it during render, and making it reactive would re-run
   * the render effect from inside itself. `rev` is the reactive signal instead.
   */
  const canvases = new PageLru<HTMLCanvasElement>(PAGE_CACHE, (_, canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const rendering = new Set<number>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const onScreen = new Set<number>();

  // `loadFlow` reads and writes `store.flow`; without `untrack` the effect would depend on the
  // state it just set and re-open the document forever.
  $effect(() => {
    const fileId = doc.fileId;
    untrack(() => void store.loadFlow(fileId));
  });

  $effect(() => {
    const bytes = doc.bytes;
    if (!bytes) return;
    let cancelled = false;
    error = null;
    // pdf.js takes ownership of the buffer it is given, and the same DocumentView is re-opened
    // by the viewer toggle — hand it a copy or the second open is a blank flow.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    void task.promise.then(
      (d) => {
        if (cancelled) {
          void d.cleanup();
          return;
        }
        pdf = d;
        pump();
      },
      (e: Error) => {
        if (!cancelled) error = e.message;
      },
    );
    return () => {
      cancelled = true;
      canvases.clear();
      rendering.clear();
      onScreen.clear();
      rev = {};
      bg = {};
      void task.destroy();
      pdf = null;
    };
  });

  /**
   * The page canvas a card should draw off.
   *
   * `revision` is passed in and deliberately unused: `canvases` is a plain Map by design (see
   * above), so this is how a card is told that its page has just been painted. Reading
   * `rev[page]` at the call site is the reactive dependency; the cache lookup itself is not.
   */
  function canvasFor(page: number, revision: number): HTMLCanvasElement | null {
    void revision;
    return canvases.get(page) ?? null;
  }

  /** A page's size in its own points — `pageSizes` is authoritative (SEGMENTS.md §2). */
  function sizeOf(page: number): PagePt {
    const hit = flow?.pageSizes.find((p) => p.page === page);
    return hit ? { width: hit.width, height: hit.height } : { width: 960, height: 540 };
  }

  /** How hard this page has to be rasterised: enough that its narrowest crop is 1:1 on screen. */
  function scaleFor(page: number): number {
    const onPage = (flow?.segments ?? []).filter((s) => s.page === page);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    return pageRenderScale(sizeOf(page), minWidthFraction(onPage), CONTENT_WIDTH, dpr);
  }

  async function render(page: number): Promise<void> {
    const d = pdf;
    if (!d || rendering.has(page) || canvases.has(page)) return;
    rendering.add(page);
    try {
      const proxy = await d.getPage(page);
      if (pdf !== d) return;
      const viewport = proxy.getViewport({ scale: scaleFor(page) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await proxy.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (pdf !== d) return;
      canvases.set(page, canvas);
      // The page's own background, for the placeholder every other card paints while it waits.
      try {
        bg = { ...bg, [page]: colourFromPixel(ctx.getImageData(1, 1, 1, 1).data) };
      } catch {
        // A tainted or zero-sized canvas is not worth failing a render over.
      }
      rev = { ...rev, [page]: (rev[page] ?? 0) + 1 };
    } catch {
      // A cancelled or failed page render leaves the placeholder, which is a correct card.
    } finally {
      rendering.delete(page);
    }
  }

  /**
   * Render what is on screen, and the page either side of it.
   *
   * The pin is the rule that makes risk 3 unreachable: a page a card is currently showing is
   * never evicted, however old it is.
   */
  function pump(): void {
    if (!pdf || !flow) return;
    canvases.pin(onScreen);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const wanted = new Set(onScreen);
    for (const page of onScreen) {
      if (page > 1) wanted.add(page - 1);
      if (page < flow.pageCount) wanted.add(page + 1);
    }
    for (const page of [...wanted].sort((a, b) => a - b)) void render(page);
  }

  /** Nothing has been measured yet: rasterise page 1 so the first card is never a placeholder. */
  $effect(() => {
    if (pdf && flow && flow.segments.length > 0 && canvases.size === 0) {
      onScreen.add(flow.segments[0]!.page);
      pump();
    }
  });

  function watch(node: HTMLElement, page: number) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(page);
          else onScreen.delete(page);
        }
        pump();
      },
      { root: scroller, threshold: 0, rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return {
      destroy: () => {
        observer.disconnect();
        onScreen.delete(page);
      },
    };
  }

  // ── Gestures ──────────────────────────────────────────────────────────────

  /** The refusal is shown on the card that caused it, and only for a moment. */
  let refusalTimer: ReturnType<typeof setTimeout> | null = null;
  function armRefusal(): void {
    if (refusalTimer) clearTimeout(refusalTimer);
    refusalTimer = setTimeout(() => {
      store.flowRefusal = null;
      refusalTimer = null;
    }, 2200);
  }

  /** Where the cut is, in scroller coordinates, so the anchor knows whether it is above the fold. */
  function cutTopOf(segmentId: string, cutOffset: number): number {
    const el = scroller?.querySelector<HTMLElement>(`[data-segment="${segmentId}"]`);
    if (!el || !scroller) return Number.POSITIVE_INFINITY;
    return el.offsetTop + LABEL_STRIP + cutOffset;
  }

  async function onsplit(
    segmentId: string,
    input: { at: number; axis: 'horizontal' | 'vertical'; free: boolean; cutOffset: number },
  ): Promise<void> {
    if (busy || !flow) return;
    busy = true;
    const before = flow.segments.map((s) => ({ id: s.id }));
    const el = scroller;
    const keptTop = el?.scrollTop ?? 0;
    const heightBefore = el?.scrollHeight ?? 0;
    const cutTop = cutTopOf(segmentId, input.cutOffset);
    const ok = await store.splitSegment({ segmentId, at: input.at, axis: input.axis, free: input.free });
    busy = false;
    if (!ok) {
      armRefusal();
      return;
    }
    const minted = newSegmentIds(before, store.flow?.segments ?? [])[0];
    if (minted) {
      undoStack = [...undoStack, { kind: 'split', upperId: segmentId, lowerId: minted, at: input.at, axis: input.axis }];
    }
    // The card above the cut keeps its pixels and its position; everything below slides down by
    // one card's chrome. Follow it only if the cut was above the fold.
    //
    // The added height is **measured**, not assumed: `SPLIT_ADDED_HEIGHT` is the analytic value
    // and the fallback, but a split also brings a merge affordance into the gap between the two
    // halves, and an anchor that is 18 px out is an anchor that visibly slips.
    if (el) {
      requestAnimationFrame(() => {
        const added = el.scrollHeight - heightBefore;
        el.scrollTop = scrollAfterSplit(keptTop, cutTop, added > 0 ? added : SPLIT_ADDED_HEIGHT);
      });
    }
  }

  async function onmerge(a: { segmentId: string }, b: { segmentId: string }, seam: { at: number; axis: 'horizontal' | 'vertical' }): Promise<void> {
    if (busy) return;
    busy = true;
    const el = scroller;
    const keptTop = el?.scrollTop ?? 0;
    const heightBefore = el?.scrollHeight ?? 0;
    const seamTop = el?.querySelector<HTMLElement>(`[data-segment="${b.segmentId}"]`)?.offsetTop ?? Number.POSITIVE_INFINITY;
    const ok = await store.mergeSegments([a.segmentId, b.segmentId]);
    busy = false;
    if (!ok) {
      armRefusal();
      return;
    }
    undoStack = [...undoStack, { kind: 'merge', ids: [a.segmentId, b.segmentId], at: seam.at, axis: seam.axis }];
    if (el) {
      requestAnimationFrame(() => {
        const removed = heightBefore - el.scrollHeight;
        el.scrollTop = scrollAfterMerge(keptTop, seamTop, removed > 0 ? removed : SPLIT_ADDED_HEIGHT);
      });
    }
  }

  async function onrename(segmentId: string, label: string): Promise<void> {
    const from = flow?.segments.find((s) => s.id === segmentId)?.label ?? '';
    const ok = await store.renameSegment(segmentId, label);
    if (ok) undoStack = [...undoStack, { kind: 'rename', segmentId, from, to: label }];
    else armRefusal();
  }

  /**
   * Undo, ⌘Z.
   *
   * Every entry is undone by sending its inverse back through the same channel — never by
   * patching the view here. A split's inverse is a merge of the two halves it made; a merge's
   * inverse is a **free** split at the seam, because snapping it to a nearby tick would put the
   * boundary back somewhere other than where it was.
   */
  async function undo(): Promise<void> {
    const op = undoStack[undoStack.length - 1];
    if (!op || busy) return;
    busy = true;
    undoStack = undoStack.slice(0, -1);
    const inverse = invert(op);
    let ok = false;
    switch (inverse.kind) {
      case 'merge':
        ok = await store.mergeSegments(inverse.ids);
        break;
      case 'split':
        ok = await store.splitSegment({ segmentId: inverse.upperId, at: inverse.at, axis: inverse.axis, free: true });
        break;
      case 'reorder':
        ok = await store.reorderSegment(inverse.segmentId, inverse.to);
        break;
      case 'rename':
        ok = await store.renameSegment(inverse.segmentId, inverse.to);
        break;
    }
    busy = false;
    if (!ok) armRefusal();
  }

  function onkeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void undo();
      return;
    }
    /**
     * ⌘K — **Ask privately**, on the card that has focus (`flow-build-plan.md` §3.5).
     *
     * `App.svelte` binds ⌘K to the vault finder and already stands that binding down inside a
     * room (product-design.md §C10 L1004). A flow is the same claim one level down: while a
     * segment card has focus, ⌘K belongs to that card. `store.flowFocus` is what the two
     * handlers agree on, so the scopes still cannot overlap.
     */
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      const target = store.flowWhisper?.anchorId ?? store.flowFocus;
      if (!target) return;
      e.preventDefault();
      if (store.flowWhisper) store.closeFlowWhisper();
      else void store.openFlowWhisper(target);
      return;
    }
    if (e.key === 'Escape' && store.flowWhisper) {
      e.preventDefault();
      store.closeFlowWhisper();
    }
  }

  /**
   * Click-away. A popover that survives a click on the document behind it is a panel, and the
   * point of this one is that it is not a panel — it is a thing you lean over and say something
   * into (`pivot-spec.md` §B5). The affordance itself is excluded, or the toggle would fight it.
   */
  function onpointerdown(e: PointerEvent): void {
    if (!store.flowWhisper) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest('[data-private-note]') || el?.closest('.ask-private')) return;
    store.closeFlowWhisper();
  }

  /** The card the popover is on, for the breadcrumb chip. */
  const privateCard = $derived(cards.find((c) => c.segmentId === store.flowWhisper?.anchorId) ?? null);
  /** Is that card in the viewport? `pivot-spec.md` §B9 device 3 needs to know. */
  let privateOnScreen = $state(true);

  function watchPrivate(node: HTMLElement) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        privateOnScreen = entry?.isIntersecting ?? true;
      },
      { root: scroller, threshold: 0 },
    );
    observer.observe(node);
    return {
      destroy: () => {
        observer.disconnect();
        privateOnScreen = true;
      },
    };
  }

  function scrollToPrivate(): void {
    const id = store.flowWhisper?.anchorId;
    if (!id) return;
    scroller?.querySelector<HTMLElement>(`[data-segment="${id}"]`)?.scrollIntoView({ block: 'center' });
  }

  // ── Drag reorder ──────────────────────────────────────────────────────────
  let dragId = $state<string | null>(null);
  let dropAt = $state<{ key: string; before: boolean } | null>(null);

  async function dropNow(): Promise<void> {
    const id = dragId;
    const target = dropAt;
    dragId = null;
    dropAt = null;
    if (!id || !target || !flow) return;
    const from = cards.findIndex((c) => c.segmentId === id);
    const over = cards.findIndex((c) => c.key === target.key);
    if (from < 0 || over < 0) return;
    let to = target.before ? over : over + 1;
    if (from < to) to -= 1;
    if (to === from) return;
    const ok = await store.reorderSegment(id, to);
    if (ok) undoStack = [...undoStack, { kind: 'reorder', segmentId: id, from, to }];
    else armRefusal();
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

<section class="flow" aria-label="The flow">
  <header class="head">
    <span class="name" title={doc.relPath}>{doc.name}</span>
    <span class="meta">
      {#if flow}
        {flow.segments.length} segment{flow.segments.length === 1 ? '' : 's'} · {flow.pageCount} pages
      {/if}
    </span>
    <span class="gap"></span>

    <button type="button" class="mini" onclick={() => void undo()} disabled={undoStack.length === 0}>
      Undo <kbd>⌘Z</kbd>
    </button>

    <!-- One click away, and visibly instant — because the toggle only changes which rectangle
         each card draws (§C3). -->
    <span class="toggle" role="group" aria-label="How the document is shown">
      <button type="button" class="seg" class:on={mode === 'segments'} onclick={() => (mode = 'segments')}>Segments</button>
      <button type="button" class="seg" class:on={mode === 'pages'} onclick={() => (mode = 'pages')}>Original pages</button>
    </span>

    <button type="button" class="mini" onclick={() => (store.docView = 'viewer')}>Page viewer</button>
    <button type="button" class="mini" onclick={() => void store.revealFile(doc.fileId)}>Reveal in Finder</button>
    <button type="button" class="mini" onclick={onclose} aria-label="Close">Close</button>
  </header>

  <div class="scroll" bind:this={scroller}>
    {#if error}
      <p class="note error">This PDF wouldn't open: {error}</p>
    {:else if store.flowBusy && !flow}
      <p class="note">Reading the page geometry…</p>
    {:else if flow}
      <!-- The genre router's own sentence, above the first card (issue #31, video beat 15).
           Being honest about what cannot be segmented is the point of it. -->
      {#if flow.notice}
        <p class="band">{flow.notice}</p>
      {/if}

      {#each cards as card, i (card.key)}
        {@const next = cards[i + 1]}
        {@const seam = mode === 'segments' && next
          ? mergeSeam({ ...card.rect, page: card.page }, { ...next.rect, page: next.page })
          : null}
        <div class="slot" use:watch={card.page}>
          <div class="cardwrap">
          <SegmentCard
            {card}
            page={sizeOf(card.page)}
            canvas={canvasFor(card.page, rev[card.page] ?? 0)}
            rev={rev[card.page] ?? 0}
            background={bg[card.page] ?? PLACEHOLDER}
            index={i}
            total={cards.length}
            refusal={store.flowRefusal?.segmentId === card.segmentId ? store.flowRefusal.message : null}
            dragging={dragId === card.segmentId}
            dropHere={dropAt?.key === card.key && dropAt.before}
            onsplit={(input) => void onsplit(card.segmentId, input)}
            onrename={(label) => void onrename(card.segmentId, label)}
            claims={claimsForAnchor(card.segmentId, messages, room?.ledger ?? null)}
            askOpen={store.askingAt === card.segmentId}
            askBusy={store.askBusy === card.segmentId}
            onaskopen={() => store.openAsk(card.segmentId)}
            onaskcancel={() => store.cancelAsk()}
            onask={(question) => void store.askHere(card.segmentId, question)}
            privateOpen={store.flowWhisper?.anchorId === card.segmentId}
            onactivate={() => (store.flowFocus = card.segmentId)}
            onaskprivately={() =>
              store.flowWhisper?.anchorId === card.segmentId
                ? store.closeFlowWhisper()
                : void store.openFlowWhisper(card.segmentId)}
            ondragbegin={() => (dragId = card.segmentId)}
            ondragover={(before) => (dragId ? (dropAt = { key: card.key, before }) : undefined)}
            ondropon={() => void dropNow()}
            ondragfinish={() => {
              dragId = null;
              dropAt = null;
            }}
          />

          <!--
            The popover, anchored to this card and mounted **outside the crop's bounds** — the
            never-rule of §4.1 holds for a popover exactly as it does for an AI card. It hangs
            under the card rather than over it, which is also why the caret points up.
          -->
          {#if store.flowWhisper?.anchorId === card.segmentId && room}
            <div class="popanchor" use:watchPrivate>
              <WhisperPopover
                whisper={store.flowWhisper}
                otherName={room.agents.find((a) => a.role === 'challenger')?.displayName ?? 'the tester'}
                thinking={store.flowWhisperThinking}
                inserting={store.flowWhisperInserting}
                page={card.page}
                onsend={(text) => store.sendFlowWhisper(text)}
                oninsert={(input) => void store.insertFlowWhisper(input)}
                onclose={() => store.closeFlowWhisper()}
              />
            </div>
          {/if}
          </div>
          <!--
            The thread, under the crop it is about. `AiSegment` keeps every AI card outside the
            crop's bounds and in the app's font; this only decides that the conversation belongs
            *here* rather than in a column beside the document (`pivot-spec.md` §C0).
          -->
          {#if room}
            {@const here = threadFor(messages, card.segmentId)}
            {#if here.length > 0 || store.composerAt === card.segmentId}
              <FlowThread
                anchorId={card.segmentId}
                messages={here}
                {room}
                lockedByAnswerId={store.flowLocks[card.segmentId] ?? null}
                composerOpen={store.composerAt === card.segmentId}
              />
            {/if}
          {/if}
        </div>
        {#if seam && next}
          <div class="seam">
            <button
              type="button"
              class="merge"
              title="Put these two back together"
              onclick={() => void onmerge(card, next, seam)}
            >
              ⌥ merge
            </button>
          </div>
        {/if}
      {/each}

      <!--
        §B9 device 3 — the off-screen breadcrumb. A private reply that lands nine seconds later
        on a card that has scrolled away is indistinguishable from lag or from nothing. One chip
        maximum, and clicking it brings the card back.
      -->
      {#if store.flowWhisperThinking && !privateOnScreen && privateCard}
        <button type="button" class="crumb" onclick={scrollToPrivate}>
          ↑ your private note · p.{privateCard.page}
        </button>
      {/if}

      {#if cards.length === 0 && !store.flowBusy}
        <p class="note">Nothing to show for this file yet.</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .flow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--hairline);
  }
  .name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 11px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .gap { flex: 1; }
  .mini { font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .mini:hover:not(:disabled) { color: var(--indigo); }
  .mini:disabled { color: var(--muted); cursor: default; }
  .mini kbd { font: inherit; font-size: 10px; opacity: 0.7; }

  .toggle { display: inline-flex; border: 1px solid var(--hairline); border-radius: var(--radius); overflow: hidden; }
  .seg { font-size: 11px; padding: 3px 9px; color: var(--text-2); }
  .seg.on { background: var(--indigo-tint); color: var(--text); }

  .scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 18px 0 64px;
    background: var(--ground);
    scrollbar-gutter: stable;
  }

  .band {
    max-width: 760px;
    margin: 0 auto 16px;
    padding: 7px 11px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-2);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--muted);
    border-radius: 4px;
  }
  .slot { display: block; }
  /* The popover's positioning context. The card decides where the popover is, which is what
     "anchored to the card" means: it moves and scrolls with it, and nothing else does. */
  .cardwrap { position: relative; }
  .popanchor {
    position: absolute;
    z-index: 40;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, 92%);
    display: flex;
    justify-content: center;
  }

  .crumb {
    position: sticky;
    bottom: 12px;
    left: 0;
    margin: 0 auto;
    display: block;
    font-size: 11px;
    color: var(--text-2);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--indigo);
    border-radius: 999px;
    padding: 4px 12px;
    box-shadow: 0 4px 14px rgb(0 0 0 / 12%);
    z-index: 30;
  }
  .crumb:hover { color: var(--indigo); border-color: var(--indigo); }

  .seam { display: flex; justify-content: center; margin: -8px 0 8px; }
  .merge {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 999px;
    padding: 1px 9px;
    opacity: 0.45;
  }
  .merge:hover { opacity: 1; color: var(--indigo); border-color: var(--indigo); }

  .note { text-align: center; color: var(--text-2); font-size: 12px; padding: 28px; }
  .note.error { color: #8a2708; }
</style>
