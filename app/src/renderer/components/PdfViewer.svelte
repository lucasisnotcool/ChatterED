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
   * Pages render lazily into canvases as they scroll into view. A 24-page paper at 150% is
   * ~40 MB of bitmaps if rendered eagerly, and the learner looks at two of them.
   */
  import * as pdfjs from 'pdfjs-dist';
  import type { PDFDocumentProxy } from 'pdfjs-dist';

  let {
    bytes,
    pageFrom = $bindable(null),
    pageTo = $bindable(null),
    currentPage = $bindable(1),
  }: {
    bytes: Uint8Array;
    pageFrom?: number | null;
    pageTo?: number | null;
    currentPage?: number;
  } = $props();

  // Bundled by Vite as a same-origin asset. A module worker from file:// works in Electron —
  // verified against the packaged renderer before this was written.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

  let doc = $state<PDFDocumentProxy | null>(null);
  let pageCount = $state(0);
  let zoom = $state(1);
  let fit = $state(true);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  /**
   * Page 1's size in points, used as the placeholder size for every page before it renders.
   * Without it every page box is zero-high, so they all sit inside the viewport at once, all
   * intersect, and the "lazy" render renders the whole document immediately — which is exactly
   * what the first build did to a 24-page paper.
   */
  let base = $state<{ w: number; h: number } | null>(null);

  // Page number → the render task in flight, so a second intersection for the same page
  // cancels the first instead of hitting pdf.js's "same canvas during multiple render()".
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const inFlight = new Map<number, { cancel(): void }>();

  // Rendered page number → the canvas it was drawn into, so a zoom change can invalidate them.
  // Deliberately a plain Map and not a SvelteMap: it is a render cache that nothing reads
  // during render, and making it reactive would re-run the render effect from inside itself.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const drawn = new Map<number, { canvas: HTMLCanvasElement; scale: number }>();

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
        currentPage = Math.min(Math.max(1, currentPage), d.numPages);
        void d.getPage(1).then((page) => {
          const vp = page.getViewport({ scale: 1 });
          if (!cancelled) base = { w: vp.width, h: vp.height };
        });
      },
      (e: Error) => {
        if (!cancelled) error = e.message;
      },
    );
    return () => {
      cancelled = true;
      for (const render of inFlight.values()) render.cancel();
      inFlight.clear();
      void task.destroy();
      doc = null;
      drawn.clear();
      base = null;
    };
  });

  /** Fit-width scale, recomputed whenever the pane resizes. */
  const scale = $derived.by(() => {
    if (!fit) return zoom;
    if (width <= 0) return 1;
    return Math.min(3, Math.max(0.4, (width - 48) / 612)); // 612pt = US Letter, close enough to A4
  });

  async function draw(canvas: HTMLCanvasElement, pageNumber: number): Promise<void> {
    const d = doc;
    if (!d) return;
    const already = drawn.get(pageNumber);
    if (already?.canvas === canvas && already.scale === scale) return;

    // A page can intersect twice before the first render resolves — scrolling back and forth,
    // or a zoom change mid-render. pdf.js refuses two renders into one canvas, so cancel.
    inFlight.get(pageNumber)?.cancel();

    const at = scale;
    const page = await d.getPage(pageNumber);
    if (doc !== d) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: at * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
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
   * Lazy render + current-page tracking in one observer. The page whose top edge is nearest the
   * top of the viewport is "current" — the same rule every PDF reader uses, and the one that
   * makes "Show the room" mean the page the learner is looking at.
   */
  function pageBox(node: HTMLDivElement, pageNumber: number) {
    const canvas = node.querySelector('canvas');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (canvas) void draw(canvas as HTMLCanvasElement, pageNumber);
          if (entry.intersectionRatio > 0.5) currentPage = pageNumber;
        }
      },
      { root: scroller, threshold: [0, 0.55], rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  export function goTo(page: number): void {
    const target = Math.min(Math.max(1, page), Math.max(1, pageCount));
    currentPage = target;
    scroller?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: 'start' });
  }

  function setZoom(next: number): void {
    fit = false;
    zoom = next;
    drawn.clear();
  }

</script>

<div class="pdf">
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
    <span class="pct">{Math.round(scale * 100)}%</span>
    <button type="button" class="step" onclick={() => setZoom(nextZoom(scale))} aria-label="Zoom in">⊞</button>
    <button type="button" class="step wide" class:on={fit} onclick={() => (fit = true)}>Fit</button>

    <span class="gap"></span>

    <!-- The range: marked by where you are (architecture-mac.md L970), shown and correctable
         as numbers (product-design.md §B2 L230). -->
    <button type="button" class="step wide" onclick={() => (pageFrom = currentPage)}>Start here</button>
    <span class="range">
      <input class="num" type="number" min="1" max={pageCount} bind:value={pageFrom} aria-label="First page" />
      <span class="dash">–</span>
      <input class="num" type="number" min="1" max={pageCount} bind:value={pageTo} aria-label="Last page" />
    </span>
    <button type="button" class="step wide" onclick={() => (pageTo = currentPage)}>End here</button>
  </div>

  <div class="scroll" bind:this={scroller} bind:clientWidth={width}>
    {#if error}
      <p class="error">This PDF wouldn't open: {error}</p>
    {:else if doc}
      {#each Array.from({ length: pageCount }) as _, i (i)}
        {@const n = i + 1}
        <div
          class="page"
          class:inrange={pageFrom !== null && pageTo !== null && n >= pageFrom && n <= pageTo}
          data-page={n}
          style={base ? `width: ${Math.round(base.w * scale)}px; min-height: ${Math.round(base.h * scale)}px` : ''}
          use:pageBox={n}
        >
          <canvas></canvas>
          <span class="stamp">{n}</span>
        </div>
      {/each}
    {:else}
      <p class="loading">Opening…</p>
    {/if}
  </div>
</div>

<script module lang="ts">
  const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  export function nextZoom(current: number): number {
    return STEPS.find((z) => z > current + 0.01) ?? STEPS[STEPS.length - 1]!;
  }
  export function prevZoom(current: number): number {
    return [...STEPS].reverse().find((z) => z < current - 0.01) ?? STEPS[0]!;
  }
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
  .of, .pct, .dash { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

  .scroll { flex: 1; overflow: auto; min-height: 0; background: #ecedf2; padding: 14px 0 28px; }
  .page {
    position: relative;
    margin: 0 auto 14px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(27, 27, 34, 0.16);
  }
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
