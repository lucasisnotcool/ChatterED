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
   *
   * And one of content (`docs/research/notebooks.md` §8): **the breadcrumb**, *Notebooks ›
   * {notebook}*. *Notebooks* goes home; a double-click on the notebook's name renames it in place
   * (Enter keeps, Escape cancels). Both are `no-drag`, and nothing else in the bar is clickable, so
   * the rest of it still moves the window. Off the notebook screens the bar shows the app's name.
   */
  import { bridge } from '../lib/bridge.js';
  import { titleBarInset } from '../lib/chrome.js';
  import { store } from '../lib/store.svelte.js';
  import CostIndicator from './cost/CostIndicator.svelte';
  import TrialBadge from './TrialBadge.svelte';
  import StudyCreditChip from './study/StudyCreditChip.svelte';

  let fullScreen = $state(false);
  $effect(() => bridge().onWindowState((s) => (fullScreen = s.fullScreen)));

  const inset = $derived(titleBarInset(fullScreen));

  const onHome = $derived(store.screen === 'notebooks');
  const open = $derived(store.screen === 'notebook' ? store.notebook.view : null);
  const onSearch = $derived(store.screen === 'search');
  const crumbs = $derived(onHome || onSearch || open !== null);

  let renaming = $state(false);
  let draft = $state('');

  function startRename(): void {
    if (!open) return;
    draft = open.name;
    renaming = true;
  }

  function commit(): void {
    if (!renaming) return;
    renaming = false;
    if (open && draft.trim() && draft.trim() !== open.name) void store.notebook.rename(open.id, draft);
  }

  function focusSelect(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }
</script>

<header class="titlebar" style="--tl-inset: {inset}px">
  <div class="lights" aria-hidden="true"></div>
  {#if crumbs}
    <nav class="crumb" aria-label="Breadcrumb">
      {#if open}
        <button type="button" class="home no-drag" onclick={() => store.goHome()}>Notebooks</button>
        <span class="sep" aria-hidden="true">›</span>
        {#if renaming}
          <input
            class="rename no-drag"
            aria-label="Notebook name"
            bind:value={draft}
            use:focusSelect
            onkeydown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') renaming = false;
            }}
            onblur={commit}
          />
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <b class="name no-drag" title="Double-click to rename" ondblclick={startRename} aria-current="page">{open.name}</b>
        {/if}
      {:else if onSearch}
        <b class="name" aria-current="page">Search</b>
      {:else}
        <b class="name" aria-current="page">Notebooks</b>
      {/if}
    </nav>
  {:else}
    <span class="brand">◆ ChatterED</span>
  {/if}
  <span class="gap"></span>
  <!-- The app-level cost indicator (#42 item C). Here rather than in `StatusBar` because this is
       the only chrome present on every screen; the status bar renders inside the old room only.
       `.no-drag` is not optional — without it the button is part of the window's drag handle and
       never receives the click. -->
  <StudyCreditChip />
  <TrialBadge />
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

  .crumb { display: flex; align-items: center; gap: 6px; min-width: 0; padding-left: 4px; font-size: 12px; color: var(--text-2); }
  .crumb .home { color: var(--text-2); font-size: 12px; white-space: nowrap; }
  .crumb .home:hover { color: var(--indigo); }
  .crumb .sep { color: var(--muted); }
  .crumb .name {
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 48ch;
    cursor: default;
  }
  .rename {
    font-size: 12px;
    font-weight: 600;
    border: 1px solid var(--indigo);
    border-radius: 5px;
    padding: 1px 6px;
    min-width: 24ch;
    outline: none;
  }

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
