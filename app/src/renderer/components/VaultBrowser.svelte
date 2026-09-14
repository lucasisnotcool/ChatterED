<script lang="ts">
  /**
   * The vault sidebar plus the document pane, as one thing (issue #22).
   *
   * Used twice: inline on the Library screen, and as an overlay over a live room when the
   * learner goes to fetch something to show the group. Same component both times, so the file
   * they were last reading, the page they were on and the range they marked are all still there
   * when they open it again.
   */
  import type { Snippet } from 'svelte';
  import type { SearchHitView, VaultFileView } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import DocumentPane from './DocumentPane.svelte';
  import SearchResults from './SearchResults.svelte';
  import VaultSidebar from './VaultSidebar.svelte';

  let {
    inRoom = false,
    empty,
  }: {
    inRoom?: boolean;
    /** What to show when nothing is open and nothing is searched — the Library's launcher. */
    empty?: Snippet;
  } = $props();

  function open(file: VaultFileView): void {
    void store.openFile(file.id);
  }

  function openHit(hit: SearchHitView): void {
    void store.openFile(hit.fileId, hit.page);
  }
</script>

<div class="browser">
  <VaultSidebar onopen={open} />

  <div class="right">
    <header class="top">
      <input
        class="search"
        type="search"
        placeholder="Search everything…"
        autocomplete="off"
        spellcheck="false"
        aria-label="Search the vault"
        value={store.searchQuery}
        oninput={(e) => void store.runSearch(e.currentTarget.value)}
      />
      <button type="button" class="btn-link kbd" onclick={() => store.openFinder()}>Find a file ⌘K</button>
      {#if inRoom}
        <span class="gap"></span>
        <button type="button" class="btn-link" onclick={() => (store.browserOpen = false)}>Back to the room</button>
      {/if}
    </header>

    <!-- An open document wins over a live search: clicking a hit is a request to *read* it.
         The query stays in the box, so closing the document lands back on the results. -->
    {#if store.openDoc}
      <DocumentPane doc={store.openDoc} onclose={() => store.closeDoc()} {inRoom} />
    {:else if store.searchQuery.trim().length >= 2}
      <div class="scroll"><SearchResults onopen={openHit} /></div>
    {:else if empty}
      {@render empty()}
    {:else}
      <div class="scroll">
        <p class="hint">Pick a file on the left, search it, or press ⌘K.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .browser { flex: 1; display: flex; min-width: 0; min-height: 0; }
  .right { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }

  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--hairline);
  }
  .search {
    flex: none;
    width: 240px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 5px 10px;
    font-size: 12px;
    outline: none;
  }
  .search:focus { border-color: var(--indigo); }
  .kbd { font-size: 11px; }
  .gap { flex: 1; }

  .scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 16px 20px 40px; }
  .hint { margin: 0; font-size: 13px; color: var(--muted); }
</style>
