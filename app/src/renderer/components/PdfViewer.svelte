<script lang="ts">
  /**
   * The PDF viewer (issue #22 decision 3): page navigation, zoom, current-page state and a
   * page-range selector, on pdf.js.
   *
   * Both source documents disagree about how a range is chosen — product-design.md §B2 L230
   * specifies a typed `Pages [30]–[31]` stepper, architecture-mac.md L970 says "the range is
   * chosen by scrolling — 'start here' / 'end here' — **not** by typing numbers". Both are
   * built, because they are not really alternatives: **Start here / End here** mark the page you
   * are looking at, and the two number fields show and correct what they marked. That is
   * recorded as the resolution in app/docs/STATUS.md rather than one document being ignored.
   *
   * Pages render lazily into canvases as they scroll into view, and — since the UI review
   * measured 901 MB of bitmaps after one read-through of a 60-page deck — are released again as
   * they scroll away. Every number this component depends on lives in lib/pdfview.ts with its
   * own tests; what is left here is layout and pdf.js.
   */
  import { untrack } from 'svelte';
  import * as pdfjs from 'pdfjs-dist';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import {
    IDLE_MS,
    KEEP_RADIUS,
    anchorScroll,
    emptyLatch,
    evictable,
    fitScale,
    governingSize,
    markEnd,
    markStart,
    nextZoom,
    pageAtViewportTop,
    pinchScale,
    prevZoom,
    pushHorizontal,
    toggleFit,
    validateRange,
    visiblePages,
    type LatchState,
    type PageBox,
    type PageSize,
  } from '../lib/pdfview.js';
  import { registerViewer, type ViewerCommand } from '../lib/viewer.js';

  let {
    bytes,
    pageFrom = $bindable(null),
    pageTo = $bindable(null),
    currentPage = $bindable(1),
    pageCount = $bindable(0),
    /** Read-only mode: no toolbar, no range marking, page-locked (the room's source pane). */
    locked = false,
    /**
     * Render only these pages. The room's source pane shows the slide being explained, not the
     * whole deck: §B0 calls it "the slide you are explaining", and a learner who can page away
     * from it mid-round is looking at something the agents were not given.
     */
    pageWindow = null,
    /** Where this file was last scrolled to, and a way to record where it is now. */
    initialScroll = 0,
    onscrolled,
  }: {
    bytes: Uint8Array;
    pageFrom?: number | null;
    pageTo?: number | null;
    currentPage?: number;
    pageCount?: number;
    locked?: boolean;
    pageWindow?: { from: number; to: number } | null;
    initialScroll?: number;
    onscrolled?: (scrollTop: number) => void;
  } = $props();

  // Bundled by Vite as a same-origin asset. A module worker from file:// works in Electron —
  // verified against the packaged renderer before this was written.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

  /** Must match `.scroll`'s top padding and `.page`'s bottom margin below. */
  const PAD_TOP = 14;
  const GAP = 14;

  let doc = $state<PDFDocumentProxy | null>(null);
  let zoom = $state(1);
  /**
   * Which fit is active, or null for a hand-set zoom. Fit-width is the default because it is
   * what the old single `Fit` button did; fit-page is one click away, and for a slide deck it
   * is the one a learner wants (ui-review-code.md §1 — a fitted-to-width slide is still taller
   * than the pane, and a slide you have to scroll is not a glance).
   */
  let fitMode = $state<FitMode>(lastFitMode);
  /**
   * A page-locked pane always fits the whole page: it is glanced at, not read, and nothing in it
   * can change the zoom anyway (no toolbar, no gestures, no menu registration).
   */
  const mode = $derived<FitMode>(locked ? 'page' : fitMode);
  /** The fit a double-click (and "Actual size") comes back to. */
  let rememberedFit = $state<Exclude<FitMode, null>>(lastFitMode ?? 'width');
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  let height = $state(0);

  /**
   * Every page's own size in points, filled in in the background after the document opens.
   * Page 1's size used to stand in for all of them, which laid a mixed-geometry PDF — a
   * portrait cover in front of landscape slides — out at the wrong heights (§5.8).
   */
  let sizes = $state<Record<number, PageSize>>({});

  // Page number → the render task in flight, so a second intersection for the same page
  // cancels the first instead of hitting pdf.js's "same canvas during multiple render()".
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const inFlight = new Map<number, { cancel(): void }>();

  // Rendered page number → the canvas it was drawn into, so a zoom change can invalidate them
  // and a scroll can release them. Deliberately a plain Map and not a SvelteMap: it is a render
  // cache that nothing reads during render, and making it reactive would re-run the render
  // effect from inside itself.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const drawn = new Map<number, { canvas: HTMLCanvasElement; scale: number }>();

  /** The pages the observer currently has on screen. Lazy rendering reads only this. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const visible = new Set<number>();

  $effect(() => {
    const data = bytes;
    let cancelled = false;
    error = null;
    // pdf.js takes ownership of the buffer it is given, so hand it a copy: the same
    // DocumentView may be re-opened, and a detached buffer the second time is a blank pane.
    const task = pdfjs.getDocument({ data: data.slice() });
    void task.promise.then(
      (d) => {
        if (cancelled) {
          void d.cleanup();
          return;
        }
        doc = d;
        pageCount = d.numPages;
        drawn.clear();
        visible.clear();
        sizes = {};
        currentPage = Math.min(Math.max(1, currentPage), d.numPages);
        // Read outside the effect's tracking pass (this is a `.then`), so remembering where the
        // learner was does not itself re-open the document.
        restore = initialScroll > 0 ? initialScroll : null;
        void measurePages(d, () => cancelled);
      },
      (e: Error) => {
        if (!cancelled) error = e.message;
      },
    );
    return () => {
      cancelled = true;
      for (const render of inFlight.values()) render.cancel();
      inFlight.clear();
      for (const page of [...drawn.keys()]) release(page);
      void task.destroy();
      doc = null;
      sizes = {};
    };
  });

  /**
   * Read every page's viewport once, in chunks, yielding to the event loop between them. It
   * needs no rasterisation, so it is cheap; doing it in chunks keeps a 600-page PDF from
   * blocking the first paint, and page 1 lands first so the layout is right immediately.
   */
  async function measurePages(d: PDFDocumentProxy, cancelled: () => boolean): Promise<void> {
    const CHUNK = 16;
    for (let start = 1; start <= d.numPages; start += CHUNK) {
      const batch: number[] = [];
      for (let n = start; n < start + CHUNK && n <= d.numPages; n += 1) batch.push(n);
      const measured = await Promise.all(
        batch.map(async (n) => {
          const page = await d.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          return [n, { w: vp.width, h: vp.height }] as const;
        }),
      );
      if (cancelled() || doc !== d) return;
      const next = { ...sizes };
      for (const [n, size] of measured) next[n] = size;
      sizes = next;
    }
  }

  /**
   * The size the fit is computed against — the widest and tallest page in the document, so
   * "fit" means every page fits. Null until at least page 1 has been measured, which is the
   * signal not to paint yet.
   */
  const governing = $derived(governingSize(Object.values(sizes)));

  const scale = $derived(
    // A page-locked pane is 320–420 px wide (Room.svelte), where a 24 px gutter either side is
    // a sixth of the pane; the slide gets the room instead.
    fitScale({ mode, zoom, paneW: width, paneH: height, page: governing, ...(locked ? { gutter: 4 } : {}) }),
  );

  /** Page n's own box, falling back to the governing size until it has been measured. */
  function sizeOf(n: number): PageSize | null {
    return sizes[n] ?? governing;
  }

  /** The page numbers this pane renders: the whole document, or just the referenced slide. */
  const shown = $derived(visiblePages(pageCount, pageWindow));

  /** Every page's laid-out position, computed rather than read back out of the DOM. */
  const boxes = $derived.by((): PageBox[] => {
    if (scale <= 0 || pageCount === 0) return [];
    const out: PageBox[] = [];
    let top = PAD_TOP;
    for (const n of shown) {
      const size = sizeOf(n);
      const h = size ? Math.round(size.h * scale) : 0;
      out.push({ page: n, top, height: h });
      top += h + GAP;
    }
    return out;
  });

  async function draw(canvas: HTMLCanvasElement, pageNumber: number): Promise<void> {
    const d = doc;
    if (!d || scale <= 0) return;
    const already = drawn.get(pageNumber);
    if (already?.canvas === canvas && already.scale === scale) return;

    // A page can intersect twice before the first render resolves — scrolling back and forth,
    // or a zoom change mid-render. pdf.js refuses two renders into one canvas, so cancel.
    inFlight.get(pageNumber)?.cancel();

    const at = scale;
    const page = await d.getPage(pageNumber);
    if (doc !== d || at !== scale) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: at * dpr });
    // One integer decides both the backing store and the CSS box, so the canvas can never
    // overhang its own white page by a pixel on the right edge.
    const cssW = Math.round(viewport.width / dpr);
    const cssH = Math.round(viewport.height / dpr);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    const task = page.render({ canvasContext: context, viewport, canvas });
    inFlight.set(pageNumber, task);
    try {
      await task.promise;
      drawn.set(pageNumber, { canvas, scale: at });
    } catch {
      // A cancelled render is the normal outcome of scrolling past a page; not an error.
    } finally {
      if (inFlight.get(pageNumber) === task) inFlight.delete(pageNumber);
    }
  }

  /**
   * Give a canvas's backing store back. Setting width and height to 0 is the reliable release
   * in Chromium; removing the element is not, because Svelte owns it. The `.page` box keeps its
   * computed size, so what is left behind is a correctly sized blank sheet, not a jump.
   */
  function release(pageNumber: number): void {
    const hit = drawn.get(pageNumber);
    if (!hit) return;
    inFlight.get(pageNumber)?.cancel();
    inFlight.delete(pageNumber);
    hit.canvas.width = 0;
    hit.canvas.height = 0;
    hit.canvas.style.width = '';
    hit.canvas.style.height = '';
    drawn.delete(pageNumber);
  }

  function canvasFor(pageNumber: number): HTMLCanvasElement | null {
    return scroller?.querySelector<HTMLCanvasElement>(`[data-page="${pageNumber}"] canvas`) ?? null;
  }

  /** Draw whatever is on screen, and release whatever has drifted more than ±3 pages away. */
  function pump(): void {
    if (scale <= 0) return;
    for (const n of visible) {
      const canvas = canvasFor(n);
      if (canvas) void draw(canvas, n);
    }
    for (const gone of evictable(drawn.keys(), currentPage, KEEP_RADIUS)) {
      if (!visible.has(gone)) release(gone);
    }
  }

  /**
   * A scale change invalidates every bitmap, including the ones that never leave the screen.
   * The old code only ever redrew on a *new* intersection, so an already-visible page kept a
   * canvas rasterised at the old scale indefinitely (ui-review-code.md §1).
   */
  $effect(() => {
    void scale;
    // Only `scale` may re-run this. `pump()` reads `currentPage`, and a page change must not
    // throw away every bitmap in the document.
    untrack(() => {
      for (const t of inFlight.values()) t.cancel();
      inFlight.clear();
      for (const page of [...drawn.keys()]) release(page);
      pump();
    });
  });

  /** Lazy rendering only. Which page the counter reads is scroll arithmetic, not a ratio. */
  function pageBox(node: HTMLDivElement, pageNumber: number) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(pageNumber);
          else visible.delete(pageNumber);
        }
        pump();
      },
      { root: scroller, threshold: 0, rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return {
      destroy: () => {
        observer.disconnect();
        visible.delete(pageNumber);
        release(pageNumber);
      },
    };
  }

  let ticking = false;
  function onscroll(): void {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const el = scroller;
      if (!el) return;
      if (!locked) {
        currentPage = pageAtViewportTop(boxes, el.scrollTop);
        onscrolled?.(el.scrollTop);
      }
      pump();
    });
  }

  /**
   * Jump to a page. The target is *remembered* rather than applied immediately, because the
   * common caller is a search hit — "open this file at page 11" — and at that moment the
   * document has not loaded, `pageCount` is 0, and clamping against it would silently land the
   * learner on page 1 with no sign that anything went wrong.
   */
  let wanted = $state<number | null>(null);
  /** The scroll offset to restore once the document has been laid out, or null when done. */
  let restore = $state<number | null>(null);

  export function goTo(page: number): void {
    wanted = Math.max(1, Math.round(page));
    restore = null;
  }

  $effect(() => {
    const target = wanted;
    if (target === null || pageCount === 0 || scale <= 0) return;
    const clamped = Math.min(target, pageCount);
    wanted = null;
    currentPage = clamped;
    // The page box exists as soon as pageCount is known, but not in this tick.
    requestAnimationFrame(() => {
      scroller?.querySelector(`[data-page="${clamped}"]`)?.scrollIntoView({ block: 'start' });
    });
  });

  /**
   * Put the learner back where they were reading. VaultBrowser's own docstring already promised
   * this — "the page they were on … still there when they open it again" — and it was only ever
   * true while the pane stayed mounted (ui-review-code.md §5.5).
   */
  $effect(() => {
    const target = restore;
    if (target === null || pageCount === 0 || scale <= 0 || !scroller) return;
    restore = null;
    const el = scroller;
    requestAnimationFrame(() => {
      el.scrollTop = target;
      currentPage = pageAtViewportTop(boxes, el.scrollTop);
      pump();
    });
  });

  /** The PDF has to be reachable without a mouse click inside it (product-design.md §C10). */
  $effect(() => {
    if (locked || !doc || !scroller) return;
    if (document.activeElement === document.body) scroller.focus({ preventScroll: true });
  });

  function onkeydown(e: KeyboardEvent): void {
    const el = scroller;
    if (!el) return;
    const page = el.clientHeight * 0.9;
    switch (e.key) {
      case 'PageDown':
        el.scrollBy({ top: page });
        break;
      case 'PageUp':
        el.scrollBy({ top: -page });
        break;
      case ' ':
        el.scrollBy({ top: e.shiftKey ? -page : page });
        break;
      case 'Home':
        el.scrollTo({ top: 0 });
        break;
      case 'End':
        el.scrollTo({ top: el.scrollHeight });
        break;
      case 'ArrowDown':
        el.scrollBy({ top: 60 });
        break;
      case 'ArrowUp':
        el.scrollBy({ top: -60 });
        break;
      case 'ArrowRight':
        goTo(currentPage + 1);
        break;
      case 'ArrowLeft':
        goTo(currentPage - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    onscroll();
  }

  function setZoom(next: number): void {
    fitMode = null;
    lastFitMode = null;
    zoom = next;
  }

  function setFit(mode: Exclude<FitMode, null>): void {
    fitMode = mode;
    rememberedFit = mode;
    lastFitMode = mode;
  }

  // ── Trackpad ──────────────────────────────────────────────────────────────
  /**
   * Nothing in the app touched `wheel`, `swipe` or any zoom API before this: a Mac PDF surface
   * that answers none of the gestures every other Mac PDF surface answers (ui-review-ux.md M8).
   *
   * A macOS pinch arrives here as a `wheel` event with `ctrlKey` set — measured on Electron
   * 44.3.0 / Chromium 152: 31 events per gesture, `deltaMode: 0`, continuous sub-pixel `deltaY`,
   * `cancelable: true`, with the gesture centroid on `clientX/clientY`.
   *
   * Re-rasterising at 60 fps is not possible (one page of a landscape deck is a 2360 × 1670
   * backing store), so the gesture CSS-transforms the bitmaps that are already on screen and
   * pdf.js is asked for new ones once the fingers stop. One transform, on one wrapper: 60
   * per-page transforms would be 60 composited layers.
   */
  let pinchLive = $state<number | null>(null);
  let settle: ReturnType<typeof setTimeout> | null = null;
  const gestureScale = $derived(pinchLive !== null && scale > 0 ? pinchLive / scale : 1);

  let latch: LatchState = emptyLatch();
  let latchIdle: ReturnType<typeof setTimeout> | null = null;

  function commitPinch(): void {
    settle = null;
    const next = pinchLive;
    const el = scroller;
    if (next === null || !el) return;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    pinchLive = null;
    setZoom(next);
    // The committed layout lands at exactly the size the transform was showing, so the scroll
    // offsets carry across unchanged — the page does not jump when the bitmaps come back.
    requestAnimationFrame(() => {
      el.scrollLeft = left;
      el.scrollTop = top;
    });
  }

  function onwheel(e: WheelEvent): void {
    const el = scroller;
    if (locked || !el || scale <= 0) return;

    if (e.ctrlKey) {
      e.preventDefault();
      const from = pinchLive ?? scale;
      const to = pinchScale(from, e.deltaY);
      const box = el.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      const left = anchorScroll(el.scrollLeft, px, from, to);
      const top = anchorScroll(el.scrollTop, py, from, to);
      pinchLive = to;
      el.scrollLeft = left;
      el.scrollTop = top;
      if (settle) clearTimeout(settle);
      settle = setTimeout(commitPinch, 150);
      return;
    }

    // A two-finger horizontal flick turns the page — but only when there is nothing to pan to.
    // While a page is wider than the pane, horizontal scrolling pans it, which is what the
    // learner expects and what marking a range at 300 % needs.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if (el.scrollWidth > el.clientWidth + 1) return;
    e.preventDefault();
    const out = pushHorizontal(latch, e.deltaX, e.timeStamp);
    latch = out.state;
    if (out.turn !== 0) goTo(currentPage + out.turn);
    // macOS keeps sending momentum for tens of frames after the fingers lift; the latch only
    // disarms once they have stopped arriving.
    if (latchIdle) clearTimeout(latchIdle);
    latchIdle = setTimeout(() => {
      latch = emptyLatch();
    }, IDLE_MS);
  }

  /** Double-click is macOS's smart zoom: Fit ↔ 100 %, about the point that was clicked. */
  function ondblclick(e: MouseEvent): void {
    const el = scroller;
    if (locked || !el || scale <= 0) return;
    e.preventDefault();
    const from = scale;
    const box = el.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    const next = toggleFit(fitMode, rememberedFit);
    fitMode = next.mode;
    zoom = next.zoom;
    lastFitMode = next.mode;
    requestAnimationFrame(() => {
      el.scrollLeft = anchorScroll(left, px, from, scale);
      el.scrollTop = anchorScroll(top, py, from, scale);
    });
  }

  /** The application menu's View items land here (main/menu.ts). */
  function command(c: ViewerCommand): void {
    switch (c) {
      case 'zoom.in':
        setZoom(nextZoom(scale));
        break;
      case 'zoom.out':
        setZoom(prevZoom(scale));
        break;
      case 'zoom.reset':
        setZoom(1);
        break;
      case 'fit.width':
        setFit('width');
        break;
      case 'fit.page':
        setFit('page');
        break;
      case 'page.next':
        goTo(currentPage + 1);
        break;
      case 'page.prev':
        goTo(currentPage - 1);
        break;
    }
  }

  // The room's source pane is page-locked and read-only, so it never claims the menu.
  $effect(() => (locked ? undefined : registerViewer(command)));

  /** The range as the rest of the app must read it: clamped, and refused when it is inverted. */
  const range = $derived(validateRange(pageFrom, pageTo, pageCount));

  function commitFrom(value: string): void {
    const n = value.trim() === '' ? null : Number(value);
    pageFrom = n === null || Number.isNaN(n) ? null : Math.round(Math.min(Math.max(n, 1), Math.max(1, pageCount)));
  }

  function commitTo(value: string): void {
    const n = value.trim() === '' ? null : Number(value);
    pageTo = n === null || Number.isNaN(n) ? null : Math.round(Math.min(Math.max(n, 1), Math.max(1, pageCount)));
  }
</script>

<div class="pdf">
  {#if !locked}
    <div class="bar no-drag">
      <button type="button" class="step" onclick={() => goTo(currentPage - 1)} disabled={currentPage <= 1}>‹</button>
      <span class="counter">
        <input
          class="num"
          type="number"
          min="1"
          max={pageCount}
          value={currentPage}
          aria-label="Page"
          onchange={(e) => goTo(Number(e.currentTarget.value))}
        />
        <span class="of">/ {pageCount || '–'}</span>
      </span>
      <button type="button" class="step" onclick={() => goTo(currentPage + 1)} disabled={currentPage >= pageCount}>›</button>

      <span class="gap"></span>

      <button type="button" class="step" onclick={() => setZoom(prevZoom(scale))} aria-label="Zoom out">⊟</button>
      <span class="pct">{scale > 0 ? Math.round(scale * 100) : '–'}%</span>
      <button type="button" class="step" onclick={() => setZoom(nextZoom(scale))} aria-label="Zoom in">⊞</button>
      <!-- Two fits, not one: a paper wants its width, a slide wants the whole page (§1). -->
      <span class="fits">
        <button type="button" class="step wide" class:on={fitMode === 'width'} onclick={() => setFit('width')}>
          Fit width
        </button>
        <button type="button" class="step wide" class:on={fitMode === 'page'} onclick={() => setFit('page')}>
          Fit page
        </button>
      </span>

      <span class="gap"></span>

      <!-- The range: marked by where you are (architecture-mac.md L970), shown and correctable
           as numbers (product-design.md §B2 L230). -->
      <button
        type="button"
        class="step wide"
        onclick={() => {
          const next = markStart(currentPage, pageTo);
          pageFrom = next.from;
          pageTo = next.to;
        }}
      >
        Start here
      </button>
      <!-- `id` so the primary action can point at these two fields: the button says
           "Explain pp. 3–9 with Ellie and Max" and `aria-describedby` ties the words to the
           control that set them (ui-review-ux.md m7). -->
      <span class="range" class:bad={!range.valid} class:set={range.from !== null || range.to !== null} id="page-range">
        <span class="lbl">Pages</span>
        <input
          class="num"
          type="number"
          min="1"
          max={pageCount}
          placeholder={String(currentPage)}
          value={range.from ?? ''}
          aria-label="First page"
          aria-invalid={!range.valid}
          onchange={(e) => commitFrom(e.currentTarget.value)}
        />
        <span class="dash">–</span>
        <input
          class="num"
          type="number"
          min="1"
          max={pageCount}
          placeholder={String(currentPage)}
          value={range.to ?? ''}
          aria-label="Last page"
          aria-invalid={!range.valid}
          onchange={(e) => commitTo(e.currentTarget.value)}
        />
        <span class="of">of {pageCount || '–'}</span>
      </span>
      <button
        type="button"
        class="step wide"
        onclick={() => {
          const next = markEnd(currentPage, pageFrom);
          pageFrom = next.from;
          pageTo = next.to;
        }}
      >
        End here
      </button>
    </div>
    {#if range.error}
      <p class="rangeerr" role="alert">{range.error}</p>
    {/if}
  {/if}

  <!-- A scroll container the keyboard can reach is the point (product-design.md §C10): before
       this it was `tabindex: -1` and Space, PageDown and the arrows did nothing until the
       learner clicked inside the PDF (ui-review-code.md §5.6). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="scroll"
    class:locked
    bind:this={scroller}
    bind:clientWidth={width}
    bind:clientHeight={height}
    {onscroll}
    onkeydown={locked ? undefined : onkeydown}
    onwheel={locked ? undefined : onwheel}
    ondblclick={locked ? undefined : ondblclick}
    tabindex={locked ? -1 : 0}
    role="document"
    aria-label={locked ? 'The page you are explaining' : `Document, ${pageCount || 0} pages`}
  >
    {#if error}
      <p class="error">This PDF wouldn't open: {error}</p>
    {:else if doc && scale > 0}
      <!-- One wrapper carries the pinch, so the gesture is a single composited layer and pdf.js
           is not asked for a bitmap until the fingers stop. `will-change` is set only while it
           is moving: leaving it on promotes the layer forever. -->
      <div
        class="pages"
        style={gestureScale === 1
          ? ''
          : `transform: scale(${gestureScale}); transform-origin: 0 0; will-change: transform`}
      >
        {#each shown as n (n)}
          {@const size = sizeOf(n)}
          <div
            class="page"
            class:inrange={!locked && range.valid && range.from !== null && range.to !== null && n >= range.from && n <= range.to}
            data-page={n}
            style={size
              ? `width: ${Math.round(size.w * scale)}px; height: ${Math.round(size.h * scale)}px`
              : ''}
            use:pageBox={n}
          >
            <canvas></canvas>
            {#if !locked}<span class="stamp">{n}</span>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="loading">Opening…</p>
    {/if}
  </div>
</div>

<script module lang="ts">
  import type { FitMode } from '../lib/pdfview.js';

  /**
   * The fit the learner last chose, remembered for the rest of the app session so switching
   * between two documents does not switch the zoom back underneath them. Deliberately module
   * state rather than a store field: it is a viewer preference, not app state, and nothing
   * outside this component has an opinion about it.
   */
  let lastFitMode: FitMode = 'width';
</script>

<style>
  .pdf { display: flex; flex-direction: column; min-height: 0; height: 100%; }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--hairline);
    background: var(--pane);
    flex-wrap: wrap;
  }
  .gap { flex: 1; min-width: 8px; }
  .step {
    padding: 3px 7px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--text-2);
    line-height: 1.4;
  }
  .step.wide { font-size: 11px; }
  .step:hover:not(:disabled) { background: var(--ground); color: var(--text); }
  .step:disabled { color: var(--muted); cursor: default; }
  .step.on { background: var(--indigo-tint); color: var(--text); }
  .fits { display: inline-flex; gap: 2px; }

  .counter, .range { display: inline-flex; align-items: baseline; gap: 3px; }
  .num {
    width: 44px;
    background: var(--ground);
    border: 1px solid var(--hairline);
    border-radius: 5px;
    padding: 2px 4px;
    font-size: 11px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .range.bad .num { border-color: #b4310c; }
  /* Marked, and the page outline in the scroller is the same indigo rule (§C2 rule 2). */
  .range.set .num { border-color: var(--indigo); }
  .of, .pct, .dash, .lbl { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .lbl { margin-right: 2px; }
  .rangeerr {
    flex: none;
    margin: 0;
    padding: 5px 12px;
    font-size: 11px;
    color: #8a2708;
    background: #fdf3ef;
    border-bottom: 1px solid var(--hairline);
  }

  .scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
    background: #ecedf2;
    padding: 14px 0 28px;
    /* The gutter is reserved whether or not a scrollbar is showing, so `clientWidth` does not
       change under the fit calculation between the first paint and the second. */
    scrollbar-gutter: stable;
    outline-offset: -2px;
  }
  .scroll.locked { padding: 0; background: transparent; }
  .scroll:focus-visible { outline: 2px solid var(--indigo); }
  .pages { min-height: 100%; }
  /* A pdf.js canvas has no text layer, so there is nothing to select; suppressing selection
     stops a double-click from highlighting the page stamp instead of zooming. */
  .page {
    position: relative;
    user-select: none;
    margin: 0 auto 14px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(27, 27, 34, 0.16);
    overflow: hidden;
  }
  .scroll.locked .page { margin-bottom: 0; box-shadow: none; }
  /* The selected range is marked by a rule, not a tint: §C2 rule 2 keeps backgrounds untinted. */
  .page.inrange { outline: 2px solid var(--indigo); outline-offset: 0; }
  .page canvas { display: block; }
  .stamp {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font-size: 10px;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.82);
    padding: 0 4px;
    border-radius: 3px;
    font-variant-numeric: tabular-nums;
  }

  .loading, .error { text-align: center; color: var(--text-2); font-size: 12px; padding: 28px; }
</style>
