<script lang="ts">
  /**
   * ChatterED renderer root. One window, no URLs (architecture-mac.md: the renderer is a plain
   * Svelte 5 SPA). Since #58 (`docs/research/notebooks.md`) home is the Notebooks grid and a
   * notebook opens into the three-column shell; the folder vault, its finder and its topic sheet
   * are gone.
   */
  import DebugDrawer from './components/DebugDrawer.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import NavRail from './components/NavRail.svelte';
  import NotebookHome from './components/NotebookHome.svelte';
  import SearchScreen from './components/search/SearchScreen.svelte';
  import NoticeBanner from './components/NoticeBanner.svelte';
  import Room from './components/Room.svelte';
  import SessionSetup from './components/SessionSetup.svelte';
  import Settings from './components/Settings.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import ThreeColumn from './components/shell/ThreeColumn.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Usage from './components/Usage.svelte';
  import { store } from './lib/store.svelte.js';
  // The experimental trial (src/shared/trial.ts): consent comes before everything, first run too.
  import ResearchTrialConsent from './components/ResearchTrialConsent.svelte';
  import ResearchTrialLayer from './components/ResearchTrialLayer.svelte';
  import { trial } from './lib/trialstore.svelte.js';

  void trial.whenOpen().then(() => store.init());

  /**
   * A notebook deleted, or gone, while it is open (`notebook:changed` with a null view): the
   * shell has nothing to show, so the route goes home rather than drawing an empty notebook.
   */
  $effect(() => {
    if (store.screen === 'notebook' && store.notebook.view === null) store.goHome();
  });

  /**
   * **⌥⌘D — the researcher's turn log** (cui-standards-audit.md §10).
   *
   * It used to be `FlowCanvas`'s keydown, which meant it stopped existing the moment a PDF
   * opened into the three-column shell instead (#48) — a hidden gesture that answers "hung, or
   * thinking?" is worth nothing if it only works on a screen the app no longer has. It is
   * app-level here, which is what it always should have been: it is about the process, not
   * about one document.
   */
  function onkeydown(e: KeyboardEvent): void {
    if (trial.gate !== 'open') return;
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      store.debugOpen = !store.debugOpen;
      if (store.debugOpen) {
        void store.loadTurnTraces();
        void store.loadRecentCalls();
      }
      return;
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if trial.gate !== 'open'}
  <ResearchTrialConsent />
{:else}
<div class="app">
  <TitleBar />
  {#if store.screen === 'firstRun'}
    <FirstRun />
  {:else}
    <div class="cols">
      <NavRail />
      {#if store.screen === 'loading'}
        <div class="loading"><span>Opening…</span></div>
      {:else if store.screen === 'notebooks'}
        <NotebookHome />
      {:else if store.screen === 'notebook' && store.notebook.view}
        <!-- Keyed, so opening another notebook remounts the shell and its stores reopen. -->
        {#key store.notebook.view.id}
          <ThreeColumn notebookId={store.notebook.view.id} />
        {/key}
      {:else if store.screen === 'search'}
        <SearchScreen />
      {:else if store.screen === 'setup'}
        <SessionSetup />
      {:else if store.screen === 'settings'}
        <Settings />
      {:else if store.screen === 'usage'}
        <Usage />
      {:else if store.room}
        <Room room={store.room} />
      {/if}
    </div>
    {#if store.screen === 'room' && store.room}
      <StatusBar room={store.room} onwhisper={() => (store.whisperOpen = true)} />
    {/if}
  {/if}
</div>

{#if store.debugOpen}
  <DebugDrawer />
{/if}

<NoticeBanner />
{#if store.notebook.toast}
  <!-- A refused file, a failed add: said for a few seconds, then gone (`notebookstore`). -->
  {#key store.notebook.toast.token}
    <div class="toast" role="status">{store.notebook.toast.text}</div>
  {/key}
{/if}
<ResearchTrialLayer />
{/if}

<style>
  .app { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .cols { flex: 1; display: flex; min-height: 0; min-width: 0; }
  .loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    z-index: 60;
    max-width: min(560px, 90vw);
    padding: 8px 14px;
    border-radius: 8px;
    background: var(--text);
    color: var(--pane);
    font-size: 12.5px;
    line-height: 1.45;
    box-shadow: 0 8px 28px rgba(20, 20, 40, 0.18);
  }
</style>
