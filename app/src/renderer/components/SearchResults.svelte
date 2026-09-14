<script lang="ts">
  /**
   * Full-text results (issue #22 decision 2): a snippet per hit, and a page number for a PDF.
   *
   * The snippet arrives from SQLite with the matched terms wrapped in two Private Use Area code
   * points (`src/main/vault/repo.ts`). It is split here and rendered as **text** — a search
   * result is untrusted file content, and letting the main process send HTML for the renderer
   * to inject would be an injection point in an app pointed at whatever is on the disk.
   */
  import type { SearchHitView } from '../../shared/types.js';
  import { splitSnippet } from '../../shared/snippet.js';
  import { KIND_GLYPH } from '../lib/labels.js';
  import { store } from '../lib/store.svelte.js';

  let { onopen }: { onopen: (hit: SearchHitView) => void } = $props();

</script>

<section class="results" aria-label="Search results">
  <header class="head">
    <h2 class="label-caps">
      {store.searching ? 'Searching…' : `${store.searchHits.length} ${store.searchHits.length === 1 ? 'result' : 'results'}`}
      for “{store.searchQuery}”
    </h2>
    <button type="button" class="btn-link" onclick={() => store.clearSearch()}>Clear</button>
  </header>

  {#if !store.searching && store.searchHits.length === 0}
    <p class="none">
      Nothing yet.
      {#if store.vault && store.vault.index.done < store.vault.index.total}
        Still reading {store.vault.index.total - store.vault.index.done} files.
      {/if}
    </p>
  {:else}
    <ul class="list">
      {#each store.searchHits as hit, i (hit.fileId + ':' + hit.page + ':' + i)}
        <li>
          <button type="button" class="hit" onclick={() => onopen(hit)}>
            <span class="line">
              <span class="glyph" aria-hidden="true">{KIND_GLYPH[hit.kind]}</span>
              <span class="name">{hit.name}</span>
              {#if hit.page !== null}<span class="page">p. {hit.page}</span>{/if}
              {#if hit.topicName}<span class="topic">{hit.topicName}</span>{/if}
            </span>
            <span class="snippet">
              {#each splitSnippet(hit.snippet) as run, j (j)}<span class:m={run.match}>{run.text}</span>{/each}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .results { margin-top: 8px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h2 { margin: 0 0 10px; color: var(--muted); font-size: 10px; }
  .none { margin: 6px 0 0; font-size: 13px; color: var(--text-2); }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .hit {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 10px 14px;
  }
  .hit:hover { border-color: var(--indigo); }

  .line { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .glyph { color: var(--muted); font-size: 11px; }
  .name { font-size: 13px; color: var(--text); }
  .page { font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .topic { margin-left: auto; font-size: 11px; color: var(--muted); }

  .snippet {
    display: block;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 3.2em;
    overflow: hidden;
  }
  .m { font-weight: 700; color: var(--text); }
</style>
