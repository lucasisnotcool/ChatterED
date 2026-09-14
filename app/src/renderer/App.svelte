<script lang="ts">
  /**
   * ChatterED renderer root. Four destinations, one window, no URLs
   * (architecture-mac.md: the renderer is a plain Svelte 5 SPA).
   */
  import FirstRun from './components/FirstRun.svelte';
  import Library from './components/Library.svelte';
  import NavRail from './components/NavRail.svelte';
  import NoticeBanner from './components/NoticeBanner.svelte';
  import Room from './components/Room.svelte';
  import SessionSetup from './components/SessionSetup.svelte';
  import Settings from './components/Settings.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import { store } from './lib/store.svelte.js';

  void store.init();
</script>

<div class="app">
  <TitleBar />
  {#if store.screen === 'firstRun'}
    <FirstRun />
  {:else}
    <div class="cols">
      <NavRail collapsed={store.navCollapsed} />
      {#if store.screen === 'loading'}
        <div class="loading"><span>Opening…</span></div>
      {:else if store.screen === 'library'}
        <Library />
      {:else if store.screen === 'setup'}
        <SessionSetup />
      {:else if store.screen === 'settings'}
        <Settings />
      {:else if store.room}
        <Room room={store.room} />
      {/if}
    </div>
    {#if store.screen === 'room' && store.room}
      <StatusBar room={store.room} onwhisper={() => (store.whisperOpen = true)} />
    {/if}
  {/if}
</div>

<NoticeBanner />

<style>
  .app { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .cols { flex: 1; display: flex; min-height: 0; min-width: 0; }
  .loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--muted); }
</style>
