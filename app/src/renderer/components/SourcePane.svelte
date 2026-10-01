<script lang="ts">
  /**
   * The slide being explained (product-design.md §B0, §B3). Collapses to a 32 px strip.
   *
   * It used to render `material.extractedText` in a `<p>` — *"...explored as educa- tional tools
   * with the development of AI [33, 36]."* §B0 says "Centre: the slide you are explaining", and
   * §C6's arbiter move ("Your slide (p. 31) says X", click to scroll the source pane) is not
   * implementable against a paragraph of joined-up hyphenated text (ui-review-ux.md M11).
   *
   * So the page itself, rendered by the same `PdfViewer` the Library uses, read-only and locked
   * to the referenced range. **The text stays** — it is exactly what the agents were given, and
   * when extraction went wrong that is the thing a learner needs to see — as a disclosure under
   * the page rather than as the view.
   */
  import type { MaterialView } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import PdfViewer from './PdfViewer.svelte';

  let { material }: { material: MaterialView } = $props();

  const pages = $derived(
    material.pageFrom !== null && material.pageTo !== null
      ? material.pageFrom === material.pageTo
        ? `p. ${material.pageFrom}`
        : `pp. ${material.pageFrom}–${material.pageTo}`
      : 'pasted text',
  );

  const doc = $derived(store.roomSource);
  const showPage = $derived(
    doc !== null && doc.kind === 'pdf' && doc.bytes !== null && !doc.error && material.pageFrom !== null,
  );
  let textOpen = $state(false);
</script>

{#if store.sourceCollapsed}
  <button class="strip" type="button" onclick={() => (store.sourceCollapsed = false)} aria-label="Show the slide">
    <span class="vert">slide</span>
  </button>
{:else}
  <section class="pane" aria-label="Source">
    <header>
      <span class="name">{material.fileName ?? material.title} · {pages}</span>
    </header>
    {#if showPage && doc?.bytes && material.pageFrom !== null}
      <div class="sheet slide">
        <PdfViewer
          bytes={doc.bytes}
          locked
          currentPage={material.pageFrom}
          pageWindow={{ from: material.pageFrom, to: material.pageTo ?? material.pageFrom }}
        />
      </div>
      <details class="text" bind:open={textOpen}>
        <summary>{textOpen ? '⌄' : '›'} text I read from this page</summary>
        <p>{material.extractedText}</p>
      </details>
    {:else}
      <div class="sheet">
        <h3>{material.title}</h3>
        <p>{material.extractedText}</p>
      </div>
    {/if}
    <button class="collapse" type="button" onclick={() => (store.sourceCollapsed = true)}>
      ⌄ collapse slide
    </button>
  </section>
{/if}

<style>
  .pane {
    width: clamp(320px, 24vw, 420px);
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
    padding: 12px;
    min-height: 0;
  }
  header { padding: 0 2px 10px; display: flex; align-items: baseline; gap: 8px; }
  .name { font-size: 11px; color: var(--text-2); }
  .sheet {
    flex: 1;
    overflow-y: auto;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 16px 18px;
  }
  h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
  .sheet p { margin: 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; color: var(--text); }
  .sheet.slide { padding: 0; overflow: hidden; }

  .text { margin-top: 8px; flex: none; max-height: 30%; overflow-y: auto; }
  .text summary {
    font-size: 11px;
    color: var(--muted);
    cursor: default;
    list-style: none;
  }
  .text summary::-webkit-details-marker { display: none; }
  .text summary:hover { color: var(--text-2); }
  .text p {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.65;
    color: var(--text-2);
    white-space: pre-wrap;
  }
  .collapse { margin-top: 10px; font-size: 11px; color: var(--muted); align-self: flex-start; }
  .collapse:hover { color: var(--text-2); }

  .strip {
    width: 32px;
    flex: none;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .vert {
    writing-mode: vertical-rl;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.08em;
  }
  .strip:hover .vert { color: var(--text-2); }
</style>
