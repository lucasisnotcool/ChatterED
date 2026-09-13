<script lang="ts">
  /** The slide being explained (product-design.md §B0, §B3). Collapses to a 32px strip. */
  import type { MaterialView } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';

  let { material }: { material: MaterialView } = $props();

  const pages = $derived(
    material.pageFrom !== null && material.pageTo !== null
      ? `p${material.pageFrom}–${material.pageTo}`
      : 'pasted text',
  );
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
    <div class="sheet">
      <h3>{material.title}</h3>
      <p>{material.extractedText}</p>
    </div>
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
  header { padding: 0 2px 10px; }
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
