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
   * So: 48 px, icons only, and the vault's own topic list next to it is the one taxonomy. The
   * 120 px this gives back goes to the document.
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
    class:active={store.screen === 'library'}
    title="Library"
    aria-label="Library"
    onclick={() => (store.screen === 'room' ? store.leaveRoom() : (store.screen = 'library'))}
  >
    <span class="icon" aria-hidden="true">⌂</span>
  </button>

  <span class="spacer"></span>

  <!-- Usage (#42 item D). A real item with its own screen, next to Settings rather than inside
       it: what a semester of this app costs is a question with a page, not a section. -->
  <button
    type="button"
    class="item"
    class:active={store.screen === 'usage'}
    title="Usage"
    aria-label="Usage"
    onclick={() => void store.openUsage()}
  >
    <span class="icon" aria-hidden="true">◴</span>
  </button>

  <button
    type="button"
    class="item"
    class:active={store.screen === 'settings'}
    title="Settings"
    aria-label="Settings"
    onclick={() => void store.openSettings()}
  >
    <span class="icon" aria-hidden="true">⚙</span>
  </button>
</nav>

<style>
  .rail {
    width: 48px;
    flex: none;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
    padding: 10px 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
  }
  .spacer { flex: 1; }

  .item {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 34px;
    border-radius: 7px;
    color: var(--text-2);
  }
  .item:hover { background: #eeeef5; }
  /* NUSSync's active row: an indigo tint with a 2 px marker, not a grey wash (§p1). */
  .item.active { background: var(--indigo-tint); color: var(--text); position: relative; }
  .item.active::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 7px;
    bottom: 7px;
    width: 2px;
    border-radius: 1px;
    background: var(--indigo);
  }
  .icon { font-size: 15px; line-height: 1; }
</style>
