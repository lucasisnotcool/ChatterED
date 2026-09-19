<script lang="ts">
  /**
   * **The app-level indicator**, in the title bar (#42 item C).
   *
   * It lives here and not in `StatusBar` for one structural reason: the title bar is the only
   * chrome that is on screen on every screen, and the status bar renders only inside the old room.
   * A counter that exists everywhere except where the learner actually works is not an
   * always-available surface.
   *
   * Two halves, and both of them are tokens:
   *
   *  - **this session**, which is the number that is always "right now" — everything since this
   *    launch, which is the window a learner has any intuition about;
   *  - **the rolling 5-hour window**, which on the CLI path is the constraint that actually
   *    bites. Nobody is billed per token on a Claude Code subscription; what fails, and fails
   *    invisibly, is the usage window — on the evening the A1 video is recorded, say. It is
   *    **hidden entirely** when `cliWindow` is null, because an API-key or scripted install is
   *    not inside a window at all and a `0 h` there would report against a constraint that does
   *    not exist for that learner.
   *
   * No dollars up here. There is room for about fourteen characters, "API-equivalent" is eight
   * of them, and a dollar figure without it is the one thing this app may never print. The
   * tooltip has the whole of it, and the click opens the Usage page.
   */
  import { store } from '../../lib/store.svelte.js';
  import { indicatorTitle, sessionChip, windowChip } from '../../lib/cost.js';

  /** Asked once; `cost.updated` ticks both summaries after that without a round trip. */
  $effect(() => {
    store.ensureAppCost();
  });

  const app = $derived(store.costApp);
  const session = $derived(store.costSession);
  /** Before the session summary lands, all-time is the honest stand-in; neither is a zero. */
  const sess = $derived(sessionChip(session ?? app));
  const win = $derived(windowChip(app?.cliWindow ?? null));
  const on = $derived(store.costOn && (sess !== null || win !== null));
</script>

{#if on}
  <button
    type="button"
    class="ind no-drag"
    title={indicatorTitle(app, session)}
    onclick={() => void store.openUsage()}
  >
    {#if sess}<span class="half">{sess}</span>{/if}
    {#if sess && win}<span class="sep" aria-hidden="true">·</span>{/if}
    {#if win}<span class="half">{win}</span>{/if}
  </button>
{/if}

<style>
  .ind {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    margin-right: 12px;
    padding: 2px 7px;
    border-radius: 5px;
    font-size: 10px;
    line-height: 1.4;
    color: var(--text-2);
    opacity: 0.8;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ind:hover { opacity: 1; background: var(--pane); }
  .sep { color: var(--muted); }
</style>
