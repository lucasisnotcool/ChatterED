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
  import ThreeColumn from './shell/ThreeColumn.svelte';
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

<!--
  **A PDF opens as the collaborative notes doc** (#48, `docs/research/collab-doc.md` §0).

  The whole window becomes the three-column shell — file panel · doc · chats — rather than the
  sidebar plus a pane, because the file panel is one of the three columns and the shell owns
  whether it is open. `store.docView === 'viewer'` is the one way out of it, and it falls through
  to `DocumentPane` below — the Page viewer, unchanged.
-->
{#if store.openDoc && store.openDoc.kind === 'pdf' && store.docView === 'flow' && !inRoom}
  <ThreeColumn doc={store.openDoc} onclose={() => store.closeDoc()} />
{:else}
<div class="browser">
  <VaultSidebar onopen={open} />

  <div class="right">
    <!-- One search entry, not two. A 240 px `Search everything…` box sitting beside a
         `Find a file ⌘K` link, with nothing saying how they differ, is the classic "we built two
         features" tell (ui-review-ux.md M4). The box searches *inside* the files; ⌘K is the
         filename finder; the placeholder says which is which and the hint is inside the box. -->
    <header class="top">
      <span class="searchwrap">
        <input
          class="search"
          type="search"
          placeholder="Search inside your files…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search inside your files. Press Command K to search filenames instead."
          value={store.searchQuery}
          oninput={(e) => void store.runSearch(e.currentTarget.value)}
        />
        <button
          type="button"
          class="hint"
          title="Jump to a file by name"
          onclick={() => store.openFinder()}
        >
          ⌘K names
        </button>
      </span>
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
{/if}

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
  .searchwrap { position: relative; display: inline-flex; align-items: center; }
  .search {
    width: 320px;
    max-width: 46vw;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 5px 78px 5px 10px;
    font-size: 12px;
    outline: none;
  }
  .search:focus { border-color: var(--indigo); }
  .hint {
    position: absolute;
    right: 5px;
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 1px 5px;
    background: var(--ground);
  }
  .hint:hover { color: var(--text-2); border-color: var(--muted); }
  .gap { flex: 1; }

  .scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 16px 20px 40px; }
  .hint { margin: 0; font-size: 13px; color: var(--muted); }
</style>
