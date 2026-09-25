<script lang="ts">
  /**
   * ChatterED renderer root. Four destinations, one window, no URLs
   * (architecture-mac.md: the renderer is a plain Svelte 5 SPA).
   */
  import DebugDrawer from './components/DebugDrawer.svelte';
  import FirstRun from './components/FirstRun.svelte';
  import Library from './components/Library.svelte';
  import NavRail from './components/NavRail.svelte';
  import NoticeBanner from './components/NoticeBanner.svelte';
  import Room from './components/Room.svelte';
  import SessionSetup from './components/SessionSetup.svelte';
  import Settings from './components/Settings.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import TopicSheet from './components/TopicSheet.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Usage from './components/Usage.svelte';
  import { store } from './lib/store.svelte.js';
  // The experimental trial (src/shared/trial.ts): consent comes before everything, first run too.
  import ResearchTrialConsent from './components/ResearchTrialConsent.svelte';
  import ResearchTrialLayer from './components/ResearchTrialLayer.svelte';
  import { trial } from './lib/trialstore.svelte.js';

  void trial.whenOpen().then(() => store.init());

  /**
   * ⌘K. Inside a room it is the whisper and Room.svelte owns it (product-design.md §C10 L1004);
   * everywhere else it is the vault finder, which is what §B1's own header already advertises
   * at L186. The two scopes cannot overlap, so the binding is made here and simply stands down
   * while a room is open.
   */
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
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
    if (store.screen === 'room' || store.screen === 'firstRun') return;
    if (!store.vault?.rootPath) return;
    e.preventDefault();
    if (store.finderOpen) store.finderOpen = false;
    else store.openFinder();
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
      {:else if store.screen === 'library'}
        <Library />
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

<!-- The topic sheet is reachable from the Library sidebar, from Settings ▸ Your files, and from
     first run (opening a vault with no topics opens it), so it is mounted above the screen
     router rather than inside one screen. -->
{#if store.topicSheetOpen}
  <TopicSheet />
{/if}

{#if store.debugOpen}
  <DebugDrawer />
{/if}

<NoticeBanner />
<ResearchTrialLayer />
{/if}

<style>
  .app { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .cols { flex: 1; display: flex; min-height: 0; min-width: 0; }
  .loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--muted); }
</style>
