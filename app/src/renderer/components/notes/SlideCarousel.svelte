<script lang="ts">
  /**
   * **The slide carousel** (§3): "all slides, collapsed and labelled, grouped by the section of
   * the notes they feed. A click expands one into an interactive in-doc modal."
   *
   * Collapsed by default and **lazy**: a 66-page deck is 66 pdf.js renders, and doing them for a
   * strip nobody opened would cost more than the notes themselves. Nothing is rendered until the
   * learner expands it, and each section is rendered only once it has been opened.
   *
   * The grouping comes from `DocStore.sections()`, walked from the live document — so a page that
   * no block claims shows up under *Not in the notes*, which is the carousel quietly answering
   * the question R3 and R4 could not: **what did the ingest leave out?**
   *
   * In a notebook the pages are notebook pages (C1) and the groups are the doc's sections across
   * every source: a section that draws on the lecture and on the learner's notes shows both,
   * each thumbnail labelled with its source (`Lecture p. 17`, `Notes §2`).
   */
  import SlideFigure from './SlideFigure.svelte';
  import type { SlideSource } from '../../lib/rasterise.js';

  let {
    source,
    sections,
    pageCount,
    onopen,
  }: {
    source: SlideSource | null;
    sections: () => { title: string; pages: number[] }[];
    pageCount: number;
    onopen: (page: number) => void;
  } = $props();

  let open = $state(false);
  let groups = $state<{ title: string; pages: number[] }[]>([]);

  function toggle(): void {
    open = !open;
    if (open) groups = sections();
  }
</script>

<section class="nd-carousel">
  <button class="nd-carousel-toggle" type="button" onclick={toggle} aria-expanded={open}>
    <span class="nd-carousel-caret">{open ? '▾' : '▸'}</span>
    <span>The slides</span>
    <span class="nd-carousel-count">{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
  </button>

  {#if open}
    {#if groups.length === 0}
      <p class="nd-state-line" style="margin-top:12px">No slides are grouped yet.</p>
    {/if}
    {#each groups as group (group.title)}
      <div class="nd-carousel-section">
        <div class="nd-carousel-head">{group.title}</div>
        <div class="nd-thumbs">
          {#each group.pages as page (page)}
            <SlideFigure
              {source}
              {page}
              label={source?.citation([page]) ?? `p. ${page}`}
              title={source ? `Open ${source.title(page)}` : null}
              {onopen}
            />
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</section>
