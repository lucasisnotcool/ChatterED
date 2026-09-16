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
    DEFAULT_ZOOM,
    LABEL_STRIP,
    PAGE_CACHE,
    PLACEHOLDER,
    PageLru,
    SPLIT_ADDED_HEIGHT,
    backingRatio,
    colourFromPixel,
    fitWidthZoom,
    flowCards,
    invert,
    mergeSeam,
    minWidthFraction,
    newSegmentIds,
    nextZoom,
    pageRenderScale,
    pinchZoom,
    prevZoom,
    readZoom,
    scrollAfterMerge,
    scrollAfterSplit,
    toggleZoom,
    zoomAnchorScroll,
    zoomChipLabel,
    type FlowMode,
    type FlowOp,
    type PagePt,
  } from '../lib/flowview.js';
  import { registerViewer, type ViewerCommand } from '../lib/viewer.js';
  import { claimsForAnchor, threadFor } from '../../shared/flowthread.js';
  import { pillLabel, scrollDecision, thinkingAnchor } from '../lib/flowchat.js';
  import { store } from '../lib/store.svelte.js';
  import DebugDrawer from './DebugDrawer.svelte';
  import FlowThread from './FlowThread.svelte';
  import PacingStrip from './PacingStrip.svelte';
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

  // ── Zoom ──────────────────────────────────────────────────────────────────
  /**
   * **The flow could not be zoomed at all** (Lucas, 2026-09-16: "cannot zoom in on main UI").
   *
   * The flow never registered with `lib/viewer.ts`, so View ▸ Zoom In sent `zoom.in` into a
   * registry with nothing in it and a pinch reached nothing either — `main/index.ts` turns the
   * chrome's own zoom off precisely so a pinch can reach the document, and on the app's main
   * surface it then reached nothing at all. The page viewer had the whole gesture set; the
   * surface the learner actually spends the session on had none of it.
   *
   * Two levels, not one, and the difference is the point:
   *
   *   - `zoom` is live. It is a CSS `zoom` on one wrapper around the whole flow, so the cards,
   *     the crops, the threads *and the AI text in them* all scale together and the layout
   *     reflows — which is what "zoom in on the main UI" has to mean if the conversation is to
   *     become readable. It moves on every pinch frame; a CSS zoom is a relayout, not a
   *     re-rasterisation, so that is affordable.
   *   - `renderZoom` is committed, 150 ms after the fingers stop (the same idle window
   *     `PdfViewer` settles on). It is the only thing that decides how hard a page is
   *     rasterised and how big a crop's backing store is. Moving it per frame would mean
   *     re-rendering a 20 MB page canvas at 60 fps.
   *
   * So a pinch is instant and very slightly soft, and lands sharp a sixth of a second later. A
   * keystroke commits both at once, because there is nothing to wait for.
   */
  const ZOOM_KEY = 'chattered.flow.zoom';
  const ZOOM_IDLE_MS = 150;

  /**
   * Per install, and deliberately `localStorage` rather than a `settings` row: `SettingsView`
   * and `SettingsPatch` live in `src/shared/types.ts` with the main process's schema behind
   * them, and this is a pure view preference that nothing outside this component reads. In an
   * Electron renderer `localStorage` is a file in the same `userData` directory the settings
   * database is in, so "per install, survives a relaunch" is the same promise either way.
   */
  function loadZoom(): number {
    try {
      return readZoom(window.localStorage.getItem(ZOOM_KEY));
    } catch {
      return DEFAULT_ZOOM;
    }
  }

  function saveZoom(value: number): void {
    try {
      window.localStorage.setItem(ZOOM_KEY, String(value));
    } catch {
      // A denied or full store is not worth failing a zoom over.
    }
  }

  let zoom = $state(loadZoom());
  let renderZoom = $state(loadZoom());
  let zoomSettle: ReturnType<typeof setTimeout> | null = null;

  /** The transient "120 %" chip, the way Preview announces a zoom and then gets out of the way. */
  let chip = $state<string | null>(null);
  let chipTimer: ReturnType<typeof setTimeout> | null = null;

  function showChip(value: number): void {
    chip = zoomChipLabel(value);
    if (chipTimer) clearTimeout(chipTimer);
    chipTimer = setTimeout(() => (chip = null), 900);
  }

  /**
   * Commit the zoom: persist it, and let the crops re-render at the new scale.
   *
   * Nothing is thrown away here. `render()` re-rasterises a page only when the new zoom asks
   * for *more* pixels than the cached canvas has, and it swaps the canvas in only once the new
   * one has painted — so a zoom never blanks a card (risk 3), and zooming back out is free.
   */
  function commitZoom(): void {
    if (zoomSettle) clearTimeout(zoomSettle);
    zoomSettle = null;
    if (renderZoom === zoom) return;
    renderZoom = zoom;
    saveZoom(zoom);
    pump();
  }

  function scheduleCommit(): void {
    if (zoomSettle) clearTimeout(zoomSettle);
    zoomSettle = setTimeout(commitZoom, ZOOM_IDLE_MS);
  }

  /**
   * Move the zoom, keeping the point under `pointerY` where it is.
   *
   * The whole flow scales, so the scroller's coordinates scale with it — one multiplication,
   * the same `anchorScroll` arithmetic the page viewer uses, applied after the browser has laid
   * the new size out.
   */
  function applyZoom(next: number, pointer: { x: number; y: number } | null, commit: boolean): void {
    const el = scroller;
    const from = zoom;
    if (next === from) {
      showChip(next);
      return;
    }
    const box = el?.getBoundingClientRect();
    const px = pointer && box ? pointer.x - box.left : (el?.clientWidth ?? 0) / 2;
    const py = pointer && box ? pointer.y - box.top : (el?.clientHeight ?? 0) / 2;
    const left = el?.scrollLeft ?? 0;
    const top = el?.scrollTop ?? 0;
    zoom = next;
    showChip(next);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollLeft = zoomAnchorScroll(left, px, from, next);
        el.scrollTop = zoomAnchorScroll(top, py, from, next);
      });
    }
    if (commit) commitZoom();
    else scheduleCommit();
  }

  /** What "fit width" means for a column: the card filling the pane, tick track included. */
  function fitZoom(): number {
    return fitWidthZoom(scroller?.clientWidth ?? 0);
  }

  /**
   * A macOS pinch is a `wheel` event with `ctrlKey` set — the same shape `PdfViewer.onwheel`
   * documents (Electron 44.3.0 / Chromium 152, ~31 events per gesture, continuous `deltaY`).
   * The chrome's own zoom is off (`main/index.ts`), so without this the gesture did nothing.
   */
  function onwheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    applyZoom(pinchZoom(zoom, e.deltaY), { x: e.clientX, y: e.clientY }, false);
  }

  /** Double-click on a crop is macOS smart zoom: 100 % ↔ fit-width, about the point clicked. */
  function ondblclick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('[data-crop]')) return;
    e.preventDefault();
    applyZoom(toggleZoom(zoom, fitZoom()), { x: e.clientX, y: e.clientY }, true);
  }

  /** The application menu's View items, once the flow has claimed the registry. */
  function command(c: ViewerCommand): void {
    switch (c) {
      case 'zoom.in':
        applyZoom(nextZoom(zoom), null, true);
        break;
      case 'zoom.out':
        applyZoom(prevZoom(zoom), null, true);
        break;
      case 'zoom.reset':
        applyZoom(DEFAULT_ZOOM, null, true);
        break;
      // A flow is one column with a width; it has no page to fit, so both fits are the width.
      case 'fit.width':
      case 'fit.page':
        applyZoom(fitZoom(), null, true);
        break;
      case 'page.next':
        stepCard(1);
        break;
      case 'page.prev':
        stepCard(-1);
        break;
    }
  }

  /**
   * ⌘↓ / ⌘↑ and the three-finger swipe. In a flow the unit is the **card**, not the PDF page —
   * the menu item says "Next Page" because the page viewer is the other thing it drives, and a
   * flow whose cards are page-sized (an untouched deck, or Original pages) answers it with
   * exactly the page turn the name promises.
   */
  function stepCard(delta: number): void {
    const el = scroller;
    if (!el) return;
    const tops = cards
      .map((c) => el.querySelector<HTMLElement>(`[data-segment="${c.segmentId}"]`))
      .filter((n): n is HTMLElement => n !== null)
      .map((n) => topInScroller(n) - 12);
    if (tops.length === 0) return;
    const at = el.scrollTop;
    const to =
      delta > 0
        ? (tops.find((t) => t > at + 4) ?? tops[tops.length - 1]!)
        : ([...tops].reverse().find((t) => t < at - 4) ?? 0);
    el.scrollTo({ top: Math.max(0, to) });
  }

  // The flow is the whole document pane while it is open, so it is the viewer the menu means.
  $effect(() => registerViewer(command));

  $effect(() => () => {
    if (zoomSettle) clearTimeout(zoomSettle);
    if (chipTimer) clearTimeout(chipTimer);
  });

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
   * Where a held public turn is (`pivot-spec.md` §B9). One at a time, guaranteed by R2, and the
   * same answer the thread uses — `thinkingAnchor()` is the single implementation, so the ring
   * on the crop and the indicator under it can never point at different cards.
   */
  const heldAnchor = $derived(thinkingAnchor(room?.thinking ?? null, store.lastSendAnchor, store.composerAt));
  const heldCard = $derived(cards.find((c) => c.segmentId === heldAnchor) ?? null);
  const heldName = $derived(room?.thinking?.displayName ?? 'Someone');
  /** Is that card in the viewport? §B9 device 3 needs to know, for public turns as well now. */
  let heldOnScreen = $state(true);

  /**
   * **The backend-down strip (audit §3).** The CLI can be logged out and the only symptom is
   * turns that never arrive; the scripted client can be answering and the only symptom is that
   * the answers are suspiciously fast. Neither should require opening Settings to discover.
   */
  const backendWarning = $derived.by(() => {
    const boot = store.boot;
    if (!boot) return null;
    if (boot.backend === 'scripted') {
      return 'Scripted demo — these replies are a fixed transcript, not a model.';
    }
    if (boot.backend === 'claude_cli' && boot.cli.found && !boot.cli.loggedIn) {
      return 'Claude Code on this Mac is not signed in — replies will not arrive.';
    }
    return null;
  });

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
      renderedAt.clear();
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

  /**
   * How hard this page has to be rasterised: enough that its narrowest crop is 1:1 on screen —
   * at the **committed** zoom. `backingRatio` folds the zoom into the device pixel ratio, which
   * is the whole of what the zoom changes about the render path: the flow is still laid out
   * from `CONTENT_WIDTH`, and the CSS zoom on the wrapper does the scaling.
   */
  function scaleFor(page: number): number {
    const onPage = (flow?.segments ?? []).filter((s) => s.page === page);
    const ratio = backingRatio(window.devicePixelRatio || 1, renderZoom);
    return pageRenderScale(sizeOf(page), minWidthFraction(onPage), CONTENT_WIDTH, ratio);
  }

  /**
   * The scale each cached page canvas was actually rasterised at, so a zoom can tell which
   * pages no longer have enough pixels. Not reactive, for the same reason `canvases` is not.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const renderedAt = new Map<number, number>();

  async function render(page: number): Promise<void> {
    const d = pdf;
    if (!d || rendering.has(page)) return;
    const want = scaleFor(page);
    // Re-rasterise only when the zoom asks for **more** pixels than the cached canvas has.
    // Zooming back out keeps the bigger canvas: downscaling a bitmap is sharp, and re-rendering
    // to make it smaller would be a blank-card risk taken for nothing.
    if (canvases.has(page) && (renderedAt.get(page) ?? 0) >= want - 0.001) return;
    rendering.add(page);
    try {
      const proxy = await d.getPage(page);
      if (pdf !== d) return;
      const viewport = proxy.getViewport({ scale: want });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await proxy.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (pdf !== d) return;
      // The old canvas is only swapped out once the new one has painted, so a card is never
      // drawing off a released bitmap and a zoom never flashes a placeholder.
      canvases.set(page, canvas);
      renderedAt.set(page, want);
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

  /**
   * A card's top in **scroller** coordinates.
   *
   * Not `offsetTop`: the whisper popover (§3.5) gave `.cardwrap` `position: relative` so the
   * popover could be anchored to its card, and that quietly made the cardwrap the offset parent
   * of `[data-segment]`. `offsetTop` then reads ~0 for every card in the document, every cut
   * looks as if it is above the fold, and the anchor shifts the flow by one card's chrome under
   * the eye on a cut that is plainly on screen — which is the one thing beat 6 must not do.
   * A rect difference has no offset parent to be wrong about.
   */
  function topInScroller(el: HTMLElement): number {
    if (!scroller) return Number.POSITIVE_INFINITY;
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  }

  /**
   * Where the cut is, in scroller coordinates, so the anchor knows whether it is above the fold.
   *
   * `topInScroller` is a rect difference and therefore in the scroller's own **visual** pixels;
   * `LABEL_STRIP` and the card's `cutOffset` are the card's own layout pixels, inside the
   * zoomed wrapper. One multiplication reconciles them, and forgetting it would put every cut
   * in a zoomed flow on the wrong side of the fold.
   */
  function cutTopOf(segmentId: string, cutOffset: number): number {
    const el = scroller?.querySelector<HTMLElement>(`[data-segment="${segmentId}"]`);
    if (!el || !scroller) return Number.POSITIVE_INFINITY;
    return topInScroller(el) + (LABEL_STRIP + cutOffset) * zoom;
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
        el.scrollTop = scrollAfterSplit(keptTop, cutTop, added > 0 ? added : SPLIT_ADDED_HEIGHT * zoom);
      });
    }
  }

  async function onmerge(a: { segmentId: string }, b: { segmentId: string }, seam: { at: number; axis: 'horizontal' | 'vertical' }): Promise<void> {
    if (busy) return;
    busy = true;
    const el = scroller;
    const keptTop = el?.scrollTop ?? 0;
    const heightBefore = el?.scrollHeight ?? 0;
    const seamEl = el?.querySelector<HTMLElement>(`[data-segment="${b.segmentId}"]`) ?? null;
    const seamTop = seamEl ? topInScroller(seamEl) : Number.POSITIVE_INFINITY;
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
        el.scrollTop = scrollAfterMerge(keptTop, seamTop, removed > 0 ? removed : SPLIT_ADDED_HEIGHT * zoom);
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
      const open = store.flowWhisper?.anchorId ?? null;
      const target = store.flowFocus ?? open;
      if (!target) return;
      e.preventDefault();
      // ⌘K on the card the popover is already on closes it; ⌘K on a *different* focused card
      // moves it there. Toggling shut instead would make the second press feel like a miss.
      if (open === target) store.closeFlowWhisper();
      else void store.openFlowWhisper(target);
      return;
    }
    if (e.key === 'Escape' && store.flowWhisper) {
      e.preventDefault();
      store.closeFlowWhisper();
      return;
    }
    /**
     * ⌥⌘D — the debug drawer (audit §10). `latency_target_ms`, `ttft_actual_ms`, usage and cost
     * are all persisted and none of it is visible while running, so diagnosing "hung or
     * thinking?" has meant opening SQLite. Deliberately a hidden gesture: it is for the
     * researcher, not the learner.
     */
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      store.debugOpen = !store.debugOpen;
      if (store.debugOpen) void store.loadTurnTraces();
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

  // ── New messages: follow the tail, or dock a pill (audit §5) ──────────────
  /**
   * `FlowCanvas`'s scroller managed scroll only for splits and merges: **an arriving message
   * scrolled nothing**, so a reply to a question asked eight slides ago was never seen.
   * `Thread.svelte` has had the right rule since the room shipped; this is that rule plus the
   * case the room does not have — a reply can land anywhere in a 58-page document, so when it
   * lands out of reach the app says where instead of silently moving the deck.
   */
  let seenCount = 0;
  let pill = $state<{ anchorId: string; label: string } | null>(null);

  function routeArrival(anchorId: string | null, name: string): void {
    const root = scroller;
    if (!root) return;
    const el = anchorId ? root.querySelector<HTMLElement>(`[data-thread="${anchorId}"]`) : null;
    const offset = el ? el.getBoundingClientRect().top - root.getBoundingClientRect().top : null;
    const decision = scrollDecision({
      anchorOffset: offset,
      viewportHeight: root.clientHeight,
      atAnchor: anchorId !== null && store.composerAt === anchorId,
    });
    if (decision === 'into-view') {
      el?.scrollIntoView({ block: 'nearest' });
      pill = null;
      return;
    }
    if (!anchorId) return;
    const card = cards.find((c) => c.segmentId === anchorId) ?? null;
    pill = {
      anchorId,
      label: pillLabel({ name, page: card?.page ?? null, below: (offset ?? 1) > 0 }),
    };
  }

  $effect(() => {
    const list = messages;
    if (list.length === seenCount) return;
    const added = list.slice(seenCount);
    seenCount = list.length;
    untrack(() => {
      // The last *arriving* turn wins: two landing together is one scroll, not a fight.
      const latest = added.filter((m) => m.speaker.kind !== 'student').at(-1);
      if (!latest) return;
      const name =
        latest.speaker.kind === 'agent' ? latest.speaker.displayName : 'The reference';
      queueMicrotask(() => routeArrival(latest.anchorId, name));
    });
  });

  function goToPill(): void {
    const id = pill?.anchorId;
    pill = null;
    if (!id) return;
    scroller?.querySelector<HTMLElement>(`[data-thread="${id}"]`)?.scrollIntoView({ block: 'center' });
  }

  /** The pill is answered by scrolling to it, however the learner got there. */
  function onscroll(): void {
    const id = pill?.anchorId;
    const root = scroller;
    if (!id || !root) return;
    const el = root.querySelector<HTMLElement>(`[data-thread="${id}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
    if (top > -40 && top < root.clientHeight) pill = null;
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

  /**
   * §B9 device 3, generalised to **public** turns — which is the case §B9 was actually written
   * about. It shipped for the private popover only, so a held Ellie or Max turn on a card that
   * had scrolled away was indistinguishable from lag or from nothing at all.
   */
  function watchHeld(node: HTMLElement) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        heldOnScreen = entry?.isIntersecting ?? true;
      },
      { root: scroller, threshold: 0 },
    );
    observer.observe(node);
    return {
      destroy: () => {
        observer.disconnect();
        heldOnScreen = true;
      },
    };
  }

  function scrollToHeld(): void {
    if (!heldAnchor) return;
    scroller?.querySelector<HTMLElement>(`[data-segment="${heldAnchor}"]`)?.scrollIntoView({ block: 'center' });
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

    <!--
      The zoom, with a handle. A gesture with no visible control is a gesture only its author
      knows about, and "cannot zoom in on main UI" is what happens when the only paths are a
      menu item that reached nothing and a pinch nothing answered. Same three controls the page
      viewer's toolbar has, in the same order.
    -->
    <span class="zoomer" role="group" aria-label="Zoom">
      <button type="button" class="step" aria-label="Zoom out" onclick={() => applyZoom(prevZoom(zoom), null, true)}>⊟</button>
      <button type="button" class="pct" title="Actual size" onclick={() => applyZoom(DEFAULT_ZOOM, null, true)}>{zoomChipLabel(zoom)}</button>
      <button type="button" class="step" aria-label="Zoom in" onclick={() => applyZoom(nextZoom(zoom), null, true)}>⊞</button>
    </span>

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

  <!--
    Persistent, not dismissible, and above the deck: the learner should never have to open
    Settings to learn that nothing is going to reply (audit §3).
  -->
  {#if backendWarning}
    <p class="backend" role="status">{backendWarning}</p>
  {/if}

  <!--
    **One live region per flow (WCAG 4.1.3, audit §8).** The product's main surface announced
    nothing at all. One sentence per event, never the body — a screen reader reading a 200-word
    turn over the learner's own typing is worse than no announcement.
  -->
  <p class="sr-only" aria-live="polite" aria-atomic="true">{store.liveMessage}</p>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroll" bind:this={scroller} {onscroll} {onwheel} {ondblclick}>
    {#if error}
      <p class="note error">This PDF wouldn't open: {error}</p>
    {:else if store.flowBusy && !flow}
      <p class="note">Reading the page geometry…</p>
    {:else if flow}
      <!--
        **The zoom** (Lucas: "cannot zoom in on main UI"). One CSS `zoom` on one wrapper, rather
        than a width threaded through every child: it scales the cards, the crops, the threads
        and the AI text in them together, and — unlike a `transform` — it reflows, so the
        scroller's own height and every rect the flow measures stay true. The crops stay sharp
        because `scaleFor` and `SegmentCard` fold the same zoom into the backing store.
      -->
      <div class="zoomwrap" style={`zoom: ${zoom}`}>
      <!-- The pacing disclosure, once per install, above everything (§3.5). It shows itself or
           not; the flow does not decide. -->
      <PacingStrip />

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
          {#if heldAnchor === card.segmentId}
            <!-- One zero-height probe on the held card, mounted only while the turn is held, so
                 the observer's whole lifetime is the turn's. §B9 device 3 reads it. -->
            <span class="probe" use:watchHeld aria-hidden="true"></span>
          {/if}
          <div class="cardwrap">
          <SegmentCard
            {card}
            page={sizeOf(card.page)}
            canvas={canvasFor(card.page, rev[card.page] ?? 0)}
            rev={rev[card.page] ?? 0}
            zoom={renderZoom}
            background={bg[card.page] ?? PLACEHOLDER}
            index={i}
            total={cards.length}
            refusal={store.flowRefusal?.segmentId === card.segmentId ? store.flowRefusal.message : null}
            dragging={dragId === card.segmentId}
            dropHere={dropAt?.key === card.key && dropAt.before}
            onsplit={(input) => void onsplit(card.segmentId, input)}
            onrename={(label) => void onrename(card.segmentId, label)}
            claims={claimsForAnchor(card.segmentId, messages, room?.ledger ?? null)}
            pending={heldAnchor === card.segmentId}
            unread={threadFor(messages, card.segmentId).some(
              (m) => m.speaker.kind !== 'student' && m.seq > (store.threadSeen[card.segmentId] ?? 0),
            )}
            askOpen={store.askingAt === card.segmentId}
            askBusy={store.askBusy === card.segmentId}
            onaskopen={() => store.openAsk(card.segmentId)}
            onaskcancel={() => store.cancelAsk()}
            onask={(question) => void store.askHere(card.segmentId, question)}
            privateOpen={store.flowWhisper?.anchorId === card.segmentId}
            onactivate={() => store.noteFlowSelection(card.segmentId)}
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

      {#if cards.length === 0 && !store.flowBusy}
        <p class="note">Nothing to show for this file yet.</p>
      {/if}
      </div>
    {/if}
  </div>

  <!--
    The level, announced and then out of the way — what Preview does, and the only thing that
    tells a learner whether ⌘+ did anything when the deck is already wider than the pane.
  -->
  {#if chip}
    <span class="zoomchip" role="status">{chip}</span>
  {/if}

  <!--
    §B9 device 3 — the off-screen breadcrumb. A private reply that lands a few seconds later on a
    card that has scrolled away is indistinguishable from lag or from nothing. It lives outside
    the scroller on purpose, so it is docked to the pane rather than carried by the content. One
    chip maximum, guaranteed by R2, and clicking it brings the card back.
  -->
  {#if store.flowWhisperThinking && !privateOnScreen && privateCard}
    <button type="button" class="crumb" onclick={scrollToPrivate}>
      ↑ your private note · p.{privateCard.page}
    </button>
  {:else if heldCard && !heldOnScreen}
    <!-- §B9 device 3 for a held **public** turn: the case the spec was written about. -->
    <button type="button" class="crumb" onclick={scrollToHeld}>
      {heldName} is replying · p.{heldCard.page}
    </button>
  {:else if pill}
    <!-- The jump-to-latest pill. Only when the reply landed out of reach — a reply the learner
         can already see is scrolled to, not advertised. -->
    <button type="button" class="crumb new" onclick={goToPill}>{pill.label}</button>
  {/if}

  {#if store.debugOpen}
    <DebugDrawer />
  {/if}
</section>

<style>
  .flow {
    position: relative;
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

  .zoomer { display: inline-flex; align-items: center; gap: 2px; }
  .zoomer .step { font-size: 12px; color: var(--text-2); padding: 0 3px; line-height: 1; }
  .zoomer .step:hover { color: var(--indigo); }
  .zoomer .pct {
    font-size: 11px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    min-width: 46px;
    text-align: center;
  }
  .zoomer .pct:hover { color: var(--indigo); }

  .toggle { display: inline-flex; border: 1px solid var(--hairline); border-radius: var(--radius); overflow: hidden; }
  .seg { font-size: 11px; padding: 3px 9px; color: var(--text-2); }
  .seg.on { background: var(--indigo-tint); color: var(--text); }

  .scroll {
    flex: 1;
    overflow-y: auto;
    /* A zoomed flow can be wider than the pane; panning it is how you read the right-hand half
       of a slide at 200 %, the same way the page viewer pans a zoomed page. */
    overflow-x: auto;
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
  /* The zoom's only footprint in CSS. `zoom` rather than `transform: scale()` on purpose: a
     transform paints at the new size but lays out at the old one, so the scroller would keep
     the unzoomed height and every rect the flow measures would lie. */
  .zoomwrap { display: block; }

  .zoomchip {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 45;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 4px 13px;
    box-shadow: 0 4px 14px rgb(0 0 0 / 14%);
    pointer-events: none;
    animation: chipin 120ms ease-out;
  }
  @keyframes chipin {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .zoomchip { animation: none; }
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
    /* Fixed, not sticky: a sticky chip is only visible once the scroller has reached the end of
       its content, which is precisely the moment the learner does *not* need to be told where
       the held reply is. Docked to the viewport is what §B9 device 3 describes. */
    position: absolute;
    bottom: 22px;
    left: 50%;
    transform: translateX(-50%);
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
  .crumb.new { border-left-color: var(--indigo); font-weight: 500; color: var(--text); }

  .backend {
    flex: none;
    margin: 0;
    padding: 6px 14px;
    font-size: 11.5px;
    color: #7a4a06;
    background: #fdf6e7;
    border-bottom: 1px solid #f0e2c2;
  }

  .probe { display: block; height: 1px; }

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
