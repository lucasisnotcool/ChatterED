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
  import { layout } from '../lib/layoutstore.svelte.js';
  import { mainTutorialFor } from '../lib/layout.js';
  import TrialBadge from './TrialBadge.svelte';
  import StudyCreditChip from './study/StudyCreditChip.svelte';

  let fullScreen = $state(false);
  $effect(() => bridge().onWindowState((s) => (fullScreen = s.fullScreen)));

  const inset = $derived(titleBarInset(fullScreen));

  const open = $derived(store.screen === 'notebook' ? store.notebook.view : null);
  const tutorialMain = $derived(open ? mainTutorialFor(layout.tutorialMain, open.id, store.tutorial.views) !== null : false);

  let renaming = $state(false);
  let draft = $state('');
  $effect(() => {
    if (!renaming) draft = open?.name ?? '';
  });

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

  function setMain(on: boolean): void {
    if (!open) return;
    const fileId = store.tutorial.openFileId ?? store.tutorial.views[0]?.fileId ?? null;
    layout.setTutorialMain(open.id, on ? fileId : null);
  }
</script>

<header class="titlebar" style="--tl-inset: {inset}px">
  <div class="lights" aria-hidden="true"></div>
  <span class="brand">Chatter<span>ED</span></span>
  {#if open}
    <nav class="crumb" aria-label="Breadcrumb">
      {#if open}
        <input
          class="rename no-drag"
          aria-label="Workspace name"
          title="Click to rename workspace"
          bind:value={draft}
          onfocus={startRename}
          onkeydown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              draft = open.name;
              renaming = false;
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          onblur={commit}
        />
      {/if}
    </nav>
  {/if}
  {#if open}
    <nav class="workspace-modes no-drag" aria-label="Workspace mode">
      <button type="button" class:active={tutorialMain} aria-current={tutorialMain ? 'page' : undefined} disabled={store.tutorial.views.length === 0} onclick={() => setMain(true)}>Tutorial</button>
      <button type="button" class:active={!tutorialMain} aria-current={!tutorialMain ? 'page' : undefined} onclick={() => setMain(false)}>Summary notes</button>
    </nav>
  {/if}
  <span class="gap"></span>
  <StudyCreditChip />
  <TrialBadge />
</header>

<style>
  .titlebar {
    position: relative;
    flex: none;
    height: 52px;
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

  .crumb { display: flex; align-items: center; gap: 6px; min-width: 0; padding-left: 14px; font-size: 13px; color: var(--text-2); }
  .rename {
    width: min(28vw, 280px);
    font-size: 15px;
    font-weight: 500;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    padding: 4px 7px;
    outline: none;
  }
  .rename:hover { border-color: var(--hairline); }
  .rename:focus { border-color: var(--indigo); background: var(--pane); }

  .brand {
    font-family: var(--font-display, Georgia, serif);
    font-size: 22px;
    font-weight: 400;
    color: var(--text);
    white-space: nowrap;
    padding-left: 8px;
  }
  .brand span { color: var(--indigo); }
  .workspace-modes { position: absolute; inset: 0 auto 0 50%; transform: translateX(-50%); display: flex; align-items: stretch; gap: 8px; }
  .workspace-modes button { padding: 0 16px; border-bottom: 3px solid transparent; color: var(--text-2); font-size: 14px; font-weight: 600; white-space: nowrap; }
  .workspace-modes button.active { color: var(--indigo); border-bottom-color: var(--indigo); }
  .workspace-modes button:disabled { opacity: .45; cursor: default; }

  :global(.titlebar .no-drag) {
    -webkit-app-region: no-drag;
  }
</style>
