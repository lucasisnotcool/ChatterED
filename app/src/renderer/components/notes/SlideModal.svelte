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
   */
  import { onMount } from 'svelte';
  import type { SlideSource } from '../../lib/rasterise.js';
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

  /** The zoom ladder, in units of "fraction of the stage width". */
  const STEPS = [0.6, 0.8, 1, 1.35, 1.8, 2.4] as const;

  let at = $state(page);
  let zoomIndex = $state(2);
  let stage = $state<HTMLElement | null>(null);
  let holder = $state<HTMLElement | null>(null);
  let outline = $state<Rect | null>(rect);
  let stageWidth = $state(900);

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onclose();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        go(-1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomIndex = Math.min(STEPS.length - 1, zoomIndex + 1);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomIndex = Math.max(0, zoomIndex - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function go(delta: number): void {
    const next = at + delta;
    if (next < 1 || next > pageCount) return;
    at = next;
    // The outline belongs to the page the learner came in on, not to every page they page to.
    outline = next === page ? rect : null;
  }

  $effect(() => {
    const element = holder;
    const from = source;
    const which = at;
    const width = Math.round(stageWidth * STEPS[zoomIndex]!);
    if (!element || !from || width <= 0) return;
    let live = true;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void from
      .canvas(which, Math.min(4096, Math.round(width * dpr)))
      .then((canvas) => {
        if (!live || !canvas) return;
        // The source canvas is owned by the cache and may be shared with a thumbnail, so it is
        // copied into the modal's own element rather than adopted out from under them.
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.style.width = `${width}px`;
        copy.style.height = 'auto';
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
  aria-label={`Slide ${at}`}
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div class="nd-modal-bar">
    <button type="button" onclick={() => go(-1)} disabled={at <= 1}>‹ Previous</button>
    <span>Slide {at} of {pageCount}</span>
    <button type="button" onclick={() => go(1)} disabled={at >= pageCount}>Next ›</button>
    <span class="nd-modal-spacer"></span>
    <button type="button" onclick={() => (zoomIndex = Math.max(0, zoomIndex - 1))} disabled={zoomIndex === 0}>
      −
    </button>
    <span>{Math.round(STEPS[zoomIndex]! * 100)}%</span>
    <button
      type="button"
      onclick={() => (zoomIndex = Math.min(STEPS.length - 1, zoomIndex + 1))}
      disabled={zoomIndex === STEPS.length - 1}
    >
      +
    </button>
    <button type="button" onclick={onclose}>Close · Esc</button>
  </div>

  <div class="nd-modal-stage" bind:this={stage}>
    <div class="nd-modal-page">
      <div bind:this={holder}></div>
      {#if outline}
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
