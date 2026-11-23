<script lang="ts">
  /**
   * **The search page's slides column** (`docs/research/search.md` §5): the hit's whole deck,
   * every source of its notebook end to end, scrolled to the hit's slide. The hit slide has a
   * border and a tag, and the lines that match are outlined where the page's line geometry can
   * find them (`bestRegion`, the same matcher as the notes' slide chips).
   *
   * Pages render only as they come near the view (an IntersectionObserver over the column), each
   * once, at the column's width times the display's pixel ratio; the dividers then scale them.
   * No enlarge control: the learner sizes slides with the dividers (Lucas, 3 Oct).
   */
  import { tick } from 'svelte';
  import { SlideSource } from '../../lib/rasterise.js';
  import { openSource } from '../../lib/docstore.svelte.js';
  import { bridge } from '../../lib/bridge.js';
  import { pageLinesFor } from '../../lib/pagelines.js';
  import { rectPercent } from '../../lib/pm/slidegeom.js';
  import { toRect } from '../../lib/pm/sourcepop.js';
  import { bestRegion } from '../../../shared/doc/cite.js';
  import { paginateText } from '../../../shared/paginate.js';

  let {
    notebookId,
    page,
    regionText,
    label,
  }: {
    notebookId: string;
    /** The notebook page to scroll to and mark. */
    page: number;
    /** The text whose lines to outline on that page: the hit's block, or the query. */
    regionText: string;
    /** The tag on the marked slide: "Best match", "This hit", "Where this note came from". */
    label: string;
  } = $props();

  let source = $state<SlideSource | null>(null);
  let pages = $state<number[]>([]);
  let aspects = $state<Record<number, number>>({});
  let region = $state<{ left: string; top: string; width: string; height: string } | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let width = $state(0);

  // One SlideSource per notebook shown; destroyed when the column moves to another notebook.
  $effect(() => {
    const id = notebookId;
    let alive = true;
    let built: SlideSource | null = null;
    void (async () => {
      const view = await bridge().notebookGet({ notebookId: id });
      if (!alive || !view) return;
      built = new SlideSource(view.sources, { open: openSource, paginate: paginateText });
      source = built;
      pages = built.pages();
    })();
    return () => {
      alive = false;
      built?.destroy();
      source = null;
      pages = [];
      aspects = {};
    };
  });

  /**
   * Render a page's canvas while it is near the view, and give it back once it is far away. The
   * source's cache owns the canvases it returns and blanks the oldest past `SLIDE_CACHE`, so the
   * column shows a copy, never the cached canvas: adopting it left every page but the last ten
   * rendered white once the learner scrolled (5 Oct).
   */
  function lazyPage(el: HTMLElement, p: number): { destroy(): void } {
    let shown = false;
    let job = 0;
    const io = new IntersectionObserver(
      (entries) => {
        const near = entries[entries.length - 1]?.isIntersecting ?? false;
        if (near === shown) return;
        shown = near;
        const mine = ++job;
        if (near) void render(el, p, () => mine === job);
        else release(el);
      },
      { root: el.closest('.dc'), rootMargin: '1200px 0px' },
    );
    io.observe(el);
    return {
      destroy: () => {
        job++;
        io.disconnect();
        release(el);
      },
    };
  }

  async function render(el: HTMLElement, p: number, current: () => boolean): Promise<void> {
    const src = source;
    if (!src) return;
    try {
      const size = await src.measure(p);
      if (size.width > 0) aspects = { ...aspects, [p]: size.height / size.width };
      const target = Math.max(640, Math.ceil(Math.max(width, 320) * (window.devicePixelRatio || 1)));
      // Pages render side by side, so a fresh render can be evicted (and blanked) before this
      // resumes; ask once more, which renders it again.
      let rendered = await src.canvas(p, target);
      if (rendered?.width === 0) rendered = await src.canvas(p, target);
      if (!rendered || src !== source || !current() || rendered.width === 0) return;
      const copy = document.createElement('canvas');
      copy.width = rendered.width;
      copy.height = rendered.height;
      copy.getContext('2d')?.drawImage(rendered, 0, 0);
      copy.style.width = '100%';
      copy.style.height = 'auto';
      copy.setAttribute('aria-hidden', 'true');
      el.querySelector('.dc-canvas')?.replaceChildren(copy);
    } catch {
      // A page that will not render stays a blank card with its number; the rest still do.
    }
  }

  /** Free a far-off page's bitmap; it renders again when it comes back near the view. */
  function release(el: HTMLElement): void {
    const host = el.querySelector('.dc-canvas');
    const canvas = host?.querySelector('canvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    host?.replaceChildren();
  }

  // Scroll to the marked slide whenever it, or the deck under it, changes.
  $effect(() => {
    const p = page;
    if (pages.length === 0 || !scroller) return;
    void tick().then(() => {
      const el = scroller?.querySelector<HTMLElement>(`[data-p="${String(p)}"]`);
      if (!el || !scroller) return;
      const top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      const far = Math.abs(scroller.scrollTop - top) > scroller.clientHeight * 2;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({ top, behavior: far || reduce ? 'auto' : 'smooth' });
    });
  });

  // The lines on the marked slide that match.
  $effect(() => {
    const id = notebookId;
    const p = page;
    const text = regionText;
    region = null;
    let alive = true;
    void pageLinesFor(id, p).then((view) => {
      if (!alive || !view) return;
      const hit = bestRegion(text, view.lines);
      region = hit ? rectPercent(toRect(hit.rect)) : null;
    });
    return () => {
      alive = false;
    };
  });
</script>

<div class="dc" bind:this={scroller} bind:clientWidth={width}>
  {#if pages.length === 0}
    <p class="dc-empty">Opening the slides…</p>
  {/if}
  {#each pages as p (p)}
    <figure class="dc-page" class:hit={p === page} data-p={p} use:lazyPage={p}>
      <div class="dc-sheet" style:aspect-ratio={aspects[p] ? `1 / ${aspects[p]}` : '16 / 9'}>
        <div class="dc-canvas"></div>
        {#if p === page}
          <span class="dc-tag">{label}</span>
          {#if region}
            <span class="dc-region" style:left={region.left} style:top={region.top} style:width={region.width} style:height={region.height}></span>
          {/if}
        {/if}
      </div>
      <figcaption>{source?.title(p) ?? ''} · {p}</figcaption>
    </figure>
  {/each}
</div>

<style>
  .dc { height: 100%; overflow-y: auto; padding: 12px 14px 40px; display: grid; gap: 14px; align-content: start; background: var(--ground); }
  .dc-empty { margin: 16px 4px; font-size: 13px; color: var(--text-2); }
  .dc-page { margin: 0; display: grid; gap: 4px; scroll-margin-top: 12px; }
  .dc-sheet { position: relative; width: 100%; background: #fff; border: 1px solid var(--hairline); border-radius: 4px; overflow: hidden; box-shadow: 0 1px 3px rgba(20, 20, 40, 0.06); }
  .dc-canvas { position: absolute; inset: 0; }
  .dc-canvas :global(canvas) { display: block; }
  .dc-page.hit .dc-sheet { outline: 3px solid var(--indigo); outline-offset: 3px; }
  .dc-tag { position: absolute; top: 0; right: 0; background: var(--indigo); color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 0 0 0 6px; }
  .dc-region { position: absolute; outline: 2px dashed var(--indigo); outline-offset: 2px; border-radius: 3px; background: color-mix(in srgb, var(--indigo) 9%, transparent); pointer-events: none; }
  figcaption { font-size: 11.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
