<script lang="ts">
  /**
   * The custom title bar (issue #21).
   *
   * The window is `hiddenInset`, so macOS draws close/minimise/zoom over the renderer's
   * top-left corner and nothing in the DOM knows they are there. Before this existed, the
   * brand mark in the nav rail sat directly underneath them.
   *
   * Two jobs, both of them structural:
   *  1. reserve `titleBarInset()` px at the left as an empty spacer — collapsing in fullscreen,
   *     where macOS takes the buttons away;
   *  2. be the window's drag handle. `-webkit-app-region: drag` on the bar, `no-drag` on every
   *     interactive thing inside it, or the control stops receiving clicks.
   */
  import { bridge } from '../lib/bridge.js';
  import { titleBarInset } from '../lib/chrome.js';
  import CostIndicator from './cost/CostIndicator.svelte';

  let fullScreen = $state(false);
  $effect(() => bridge().onWindowState((s) => (fullScreen = s.fullScreen)));

  const inset = $derived(titleBarInset(fullScreen));
</script>

<header class="titlebar" style="--tl-inset: {inset}px">
  <div class="lights" aria-hidden="true"></div>
  <span class="brand">◆ ChatterED</span>
  <span class="gap"></span>
  <!-- The app-level cost indicator (#42 item C). Here rather than in `StatusBar` because this is
       the only chrome present on every screen; the status bar renders inside the old room only.
       `.no-drag` is not optional — without it the button is part of the window's drag handle and
       never receives the click. -->
  <CostIndicator />
</header>

<style>
  .titlebar {
    flex: none;
    height: 38px;
    display: flex;
    align-items: center;
    background: var(--ground);
    border-bottom: 1px solid var(--hairline);
    user-select: none;
    -webkit-user-select: none;
    /* The whole bar drags the window. Anything clickable added here needs .no-drag. */
    -webkit-app-region: drag;
  }

  /* The empty region macOS paints the traffic lights into. Zero-width in fullscreen. */
  .lights {
    flex: none;
    width: var(--tl-inset);
    transition: width 140ms ease-out;
  }

  .gap { flex: 1; min-width: 12px; }

  .brand {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    padding-left: 4px;
  }

  :global(.titlebar .no-drag) {
    -webkit-app-region: no-drag;
  }
</style>
