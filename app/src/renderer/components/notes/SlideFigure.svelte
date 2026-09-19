<script lang="ts">
  /**
   * One crop of a rendered slide — **pixels, not a redraw** (§3).
   *
   * The canvas comes out of `SlideSource`, which is the renderer's own pdf.js document; the crop
   * itself is one `drawImage` with a clamped source rect. Used by the carousel's thumbnails and
   * by the modal's outline preview. The inline `slide_figure` node draws through the same API
   * from `pm/nodeviews.ts`, because a node view cannot be a Svelte component without handing
   * ProseMirror's DOM to Svelte's lifecycle.
   *
   * The canvas is adopted into the DOM rather than drawn into a bound one: `SlideSource` owns the
   * bitmap, and copying it again to satisfy a binding would double the memory of every thumbnail.
   */
  import type { SlideSource } from '../../lib/rasterise.js';
  import type { Rect } from '../../../shared/doc/types.js';

  let {
    source,
    page,
    rect = null,
    width = 132,
    label = null,
    title = null,
    onopen = null,
  }: {
    source: SlideSource | null;
    page: number;
    rect?: Rect | null;
    width?: number;
    label?: string | null;
    title?: string | null;
    onopen?: ((page: number) => void) | null;
  } = $props();

  let holder = $state<HTMLElement | null>(null);

  $effect(() => {
    const element = holder;
    const from = source;
    const which = page;
    const box = rect;
    const across = width;
    if (!element || !from) return;
    let live = true;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void from
      .crop(which, box, across, dpr)
      .then((canvas) => {
        if (!live || !canvas) return;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        element.replaceChildren(canvas);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });
</script>

<button
  class="nd-thumb"
  type="button"
  style:width={`${width}px`}
  title={title ?? `Open slide ${page}`}
  onclick={() => onopen?.(page)}
>
  <span class="nd-thumb-holder" bind:this={holder}>
    <span class="nd-thumb-blank"></span>
  </span>
  {#if label}<span class="nd-thumb-label">{label}</span>{/if}
</button>

<style>
  .nd-thumb-holder {
    display: block;
    line-height: 0;
  }
  .nd-thumb-blank {
    display: block;
    height: 76px;
  }
</style>
