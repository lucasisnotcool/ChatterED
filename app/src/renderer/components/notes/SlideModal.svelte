<script lang="ts">
  /**
   * **The in-doc slide modal** (§3): "A click expands one into an interactive in-doc modal (zoom,
   * previous/next)."
   *
   * This is where a provenance chip lands, so it is the place where §1's fidelity claim is
   * actually cashed: the learner clicks `p. 12` and sees slide 12, as pixels, with the region the
   * figure cropped outlined on it. Everything the ingest re-typeset is checkable here in one
   * gesture — which the brief's own §7 names as the limitation of an AI-written document, and
   * this is the mitigation it names back.
   *
   * **Zoom and turn, every way a Mac user reaches for them:** the − / + buttons, the bare `+`
   * `-` `0` keys, ⌘+ / ⌘− / ⌘0 from the View menu (the modal sits on top of the notes in
   * `lib/viewer.ts`, and hands the keys back when it closes), a trackpad pinch, a double-click
   * for smart zoom, the arrow keys, and a two-finger sideways swipe to turn the slide.
   *
   * The zoom is continuous so a pinch can drive it. The page box takes its new size at once
   * (the bitmap already on screen is stretched to fill it), and pdf.js is asked for a sharp one
   * only once the size has stopped changing — a render per wheel event would be sixty renders a
   * second of a 2000 px canvas.
   *
   * **Across a notebook's sources** (`notebooks.md` C1): `page` is a notebook page, and the
   * source finds the file and its own page. Previous and Next walk the notebook in order, across
   * a source boundary and over a removed source's gap; the bar names the source when there is
   * more than one. A text source's page is shown as its words, readable and selectable, rather
   * than as a picture of them.
   */
  import { onMount, untrack } from 'svelte';
  import { SLIDE_ZOOM, clamp, isSideways, percent, zoomIn, zoomOut } from '../../lib/layout.js';
  import { IDLE_MS, anchorScroll, emptyLatch, pinchScale, pushHorizontal, type LatchState } from '../../lib/pdfview.js';
  import type { SlideSource } from '../../lib/rasterise.js';
  import { registerViewer, type ViewerCommand } from '../../lib/viewer.js';
  import type { Rect } from '../../../shared/doc/types.js';

  let {
    source,
    page,
    rect = null,
    pageCount,
    onclose,
  }: {
    source: SlideSource | null;
    page: number;
    rect?: Rect | null;
    pageCount: number;
    onclose: () => void;
  } = $props();

  /** Smart zoom's other end: close enough to read a slide's footnote without panning far. */
  const SMART_ZOOM = 1.8;

  let at = $state(page);
  /** In units of "the whole slide, visible" (`SLIDE_ZOOM`). */
  let zoom = $state(1);
  let stage = $state<HTMLElement | null>(null);
  let holder = $state<HTMLElement | null>(null);
  let outline = $state<Rect | null>(rect);
  let stageWidth = $state(900);
  let stageHeight = $state(700);

  const aspect = $derived.by(() => {
    const size = source?.size(at) ?? null;
    return size && size.height > 0 ? size.width / size.height : 4 / 3;
  });

  /**
   * 100 % means **the whole slide, visible** — not "as wide as the stage".
   *
   * A 16:9 slide rendered to the full width of a tall window is taller than the window, so the
   * learner who clicked `p. 12` to check one line lands halfway down it and has to scroll to see
   * the slide they asked for. The base width is therefore whichever of width and height binds.
   */
  const fitWidth = $derived(Math.max(240, Math.min(stageWidth, (stageHeight - 32) * aspect)));
  const displayWidth = $derived(Math.round(fitWidth * zoom));

  /** The width pdf.js renders at: `displayWidth`, once it has held still for a moment. */
  let renderWidth = $state(0);
  $effect(() => {
    const width = displayWidth;
    if (untrack(() => renderWidth) === 0) {
      renderWidth = width;
      return;
    }
    const timer = setTimeout(() => (renderWidth = width), 140);
    return () => clearTimeout(timer);
  });

  function setZoom(next: number, point?: { x: number; y: number }): void {
    const to = clamp(next, SLIDE_ZOOM.min, SLIDE_ZOOM.max);
    const el = stage;
    if (el && point && zoom > 0) {
      // Keep the point under the fingers (or the double-click) under them.
      const box = el.getBoundingClientRect();
      const left = anchorScroll(el.scrollLeft, point.x - box.left, zoom, to);
      const top = anchorScroll(el.scrollTop, point.y - box.top, zoom, to);
      zoom = to;
      requestAnimationFrame(() => {
        el.scrollLeft = left;
        el.scrollTop = top;
      });
      return;
    }
    zoom = to;
  }

  function command(c: ViewerCommand): void {
    if (c === 'zoom.in') setZoom(zoomIn(zoom, SLIDE_ZOOM));
    else if (c === 'zoom.out') setZoom(zoomOut(zoom, SLIDE_ZOOM));
    else if (c === 'zoom.reset' || c === 'fit.page' || c === 'fit.width') setZoom(1);
    else if (c === 'page.next') go(1);
    else if (c === 'page.prev') go(-1);
  }
  $effect(() => registerViewer(command));

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      // ⌘-chords are the menu's, and arrive through `command` above.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onclose();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        go(-1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        command('zoom.in');
      } else if (event.key === '-') {
        event.preventDefault();
        command('zoom.out');
      } else if (event.key === '0') {
        event.preventDefault();
        command('zoom.reset');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** The page `delta` away, or null at an end: over the notebook's pages, gaps skipped. */
  function neighbour(from: number, delta: number): number | null {
    if (source) return source.step(from, delta);
    const next = from + delta;
    return next < 1 || next > pageCount ? null : next;
  }

  const title = $derived.by(() => {
    if (!source) return `Slide ${at} of ${pageCount}`;
    const name = source.title(at);
    return source.parts.length <= 1 && source.kindOf(at) === 'pdf' ? `${name} of ${pageCount}` : name;
  });
  const hasPrev = $derived(neighbour(at, -1) !== null);
  const hasNext = $derived(neighbour(at, 1) !== null);

  /** A text source's page, as text (null while it loads, and for every other kind of page). */
  let pageText = $state<string | null>(null);
  const isText = $derived(source?.kindOf(at) === 'text');
  $effect(() => {
    const from = source;
    const which = at;
    pageText = null;
    if (!from || from.kindOf(which) !== 'text') return;
    let live = true;
    void from.text(which).then((text) => {
      if (live) pageText = text ?? 'This part of the source could not be read.';
    });
    return () => {
      live = false;
    };
  });

  function go(delta: number): void {
    const next = neighbour(at, delta);
    if (next === null) return;
    at = next;
    // The outline belongs to the page the learner came in on, not to every page they page to.
    outline = next === page ? rect : null;
  }

  // ── Trackpad ──────────────────────────────────────────────────────────────
  let latch: LatchState = emptyLatch();

  function onwheel(e: WheelEvent): void {
    const el = stage;
    if (!el) return;
    if (e.ctrlKey) {
      // A pinch (PdfViewer.svelte has the measurements).
      e.preventDefault();
      setZoom(pinchScale(zoom, e.deltaY), { x: e.clientX, y: e.clientY });
      return;
    }
    // A sideways swipe turns the slide — unless the slide is zoomed wider than the stage, when
    // sideways is a pan and the learner is looking for the other half of it.
    if (!isSideways(e.deltaX, e.deltaY) || el.scrollWidth > el.clientWidth + 1) return;
    e.preventDefault();
    const out = pushHorizontal(latch, e.deltaX, e.timeStamp, { idleMs: IDLE_MS });
    latch = out.state;
    if (out.turn !== 0) go(out.turn);
  }

  /** Double-click is the Mac's smart zoom: in to read, and back out to the whole slide. */
  function ondblclick(e: MouseEvent): void {
    setZoom(zoom > 1.01 ? 1 : SMART_ZOOM, { x: e.clientX, y: e.clientY });
  }

  $effect(() => {
    const element = holder;
    const from = source;
    const which = at;
    const width = renderWidth;
    if (!element || !from || width <= 0 || from.kindOf(which) === 'text') return;
    let live = true;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void from
      .canvas(which, Math.min(4096, Math.round(width * dpr)))
      .then((canvas) => {
        if (!live || !canvas) return;
        // The source canvas is owned by the cache and may be shared with a thumbnail, so it is
        // copied into the modal's own element rather than adopted out from under them. Its CSS
        // size is the page box's (notes.css), so a zoom that has not re-rendered yet stretches it.
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext('2d')?.drawImage(canvas, 0, 0);
        element.replaceChildren(copy);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });

  $effect(() => {
    const element = stage;
    if (!element) return;
    const measure = (): void => {
      stageWidth = Math.max(320, element.clientWidth - 48);
      stageHeight = Math.max(240, element.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="nd-modal-veil"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div class="nd-modal-bar">
    <button type="button" onclick={() => go(-1)} disabled={!hasPrev} title="Previous slide (←, or swipe right)">‹ Previous</button>
    <span aria-live="polite">{title}</span>
    <button type="button" onclick={() => go(1)} disabled={!hasNext} title="Next slide (→, or swipe left)">Next ›</button>
    <span class="nd-modal-spacer"></span>
    <button
      type="button"
      aria-label="Zoom out"
      title="Zoom out (−, ⌘−, or pinch)"
      onclick={() => command('zoom.out')}
      disabled={zoom <= SLIDE_ZOOM.min + 0.001}
    >
      −
    </button>
    <button type="button" class="nd-modal-level" title="Whole slide (0, ⌘0, or double-click)" onclick={() => command('zoom.reset')}>
      {percent(zoom)}
    </button>
    <button
      type="button"
      aria-label="Zoom in"
      title="Zoom in (+, ⌘+, or pinch)"
      onclick={() => command('zoom.in')}
      disabled={zoom >= SLIDE_ZOOM.max - 0.001}
    >
      +
    </button>
    <button type="button" onclick={onclose}>Close · Esc</button>
  </div>

  <div class="nd-modal-stage" bind:this={stage} {onwheel}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="nd-modal-page"
      style:width={`${displayWidth}px`}
      style:aspect-ratio={String(aspect)}
      {ondblclick}
    >
      {#if isText}
        <div class="nd-modal-text">{pageText ?? ''}</div>
      {/if}
      <div bind:this={holder} hidden={isText}></div>
      {#if outline && !isText}
        <div
          class="nd-modal-rect"
          style:left={`${outline.x0 * 100}%`}
          style:top={`${outline.y0 * 100}%`}
          style:width={`${(outline.x1 - outline.x0) * 100}%`}
          style:height={`${(outline.y1 - outline.y0) * 100}%`}
        ></div>
      {/if}
    </div>
  </div>
</div>
