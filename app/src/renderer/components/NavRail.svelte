<script lang="ts">
  /**
   * The icon rail (product-design.md §B0's global navigation, narrowed).
   *
   * It used to be 168 px of labels holding three destinations — one of them a permanently greyed
   * `History` span that was not even focusable — plus a `COURSES` list derived from
   * `rooms.module_code`, which was hard-coded to `'MA3236'` in two places. That put **two
   * taxonomies of "a course" 76 px apart**, and the one on the left was a single fabricated
   * entry (ui-review-code.md §3, ui-review-ux.md M1/M2/M3).
   *
   * So: a compact icon rail. Since #58 the one
   * taxonomy is the notebook (`docs/research/notebooks.md` §1), and Home is the Notebooks grid.
   *
   * **History is absent, not greyed.** The data is there — `sessions`, `rooms`, `ledger` — and
   * the screen is half a day's work, but a permanently disabled control teaches the learner that
   * parts of the app are broken (§M3). It comes back as a real item with its own screen.
   */
  import { store } from '../lib/store.svelte.js';
</script>

<nav class="rail" aria-label="Main">
  <button
    type="button"
    class="item"
    class:active={store.screen === 'notebooks' || store.screen === 'notebook'}
    title="Notebooks"
    aria-label="Notebooks"
    onclick={() => store.goHome()}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></svg>
  </button>

  <!-- Search (`docs/research/search.md` §5): directly under Notebooks, a page of its own. -->
  <button
    type="button"
    class="item"
    class:active={store.screen === 'search'}
    title="Search all notebooks (⇧⌘F)"
    aria-label="Search"
    onclick={() => void store.openSearch()}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" />
    </svg>
  </button>

  <!-- Usage (#42 item D). A real item with its own screen, next to Settings rather than inside
       it: what a semester of this app costs is a question with a page, not a section. -->
  <button
    type="button"
    class="item"
    class:active={store.screen === 'usage'}
    title="Information and usage"
    aria-label="Information and usage"
    onclick={() => void store.openUsage()}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/></svg>
  </button>

  <button
    type="button"
    class="item"
    class:active={store.screen === 'settings'}
    title="Settings"
    aria-label="Settings"
    onclick={() => void store.openSettings()}
  >
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.8 10.3 2.2h3.4L15 4.8l2.7-1 2.5 2.5-1 2.7 2.6 1.3v3.4L19.2 15l1 2.7-2.5 2.5-2.7-1-1.3 2.6h-3.4L9 19.2l-2.7 1-2.5-2.5 1-2.7-2.6-1.3v-3.4L4.8 9l-1-2.7 2.5-2.5z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
</nav>

<style>
  .rail {
    width: 60px;
    flex: none;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
    padding: 10px 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--text-2);
  }
  .item:hover { background: color-mix(in srgb, var(--indigo-tint) 55%, var(--pane)); }
  .item.active { background: var(--indigo-tint); color: var(--indigo); }
  .icon { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
</style>
