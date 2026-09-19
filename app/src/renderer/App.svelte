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
  import TopicSheet from './components/TopicSheet.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Usage from './components/Usage.svelte';
  import { store } from './lib/store.svelte.js';

  void store.init();

  /**
   * ⌘K. Inside a room it is the whisper and Room.svelte owns it (product-design.md §C10 L1004);
   * inside a flow it is **Ask privately** on the focused card and FlowCanvas owns it (§3.5);
   * everywhere else it is the vault finder, which is what §B1's own header already advertises
   * at L186. The two scopes cannot overlap, so the binding is made here and simply stands down
   * while a room is open.
   */
  function onkeydown(e: KeyboardEvent): void {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
    if (store.screen === 'room' || store.screen === 'firstRun') return;
    // …and inside a *flow*, ⌘K belongs to the focused segment card: it is **Ask privately**
    // there (`flow-build-plan.md` §3.5). `FlowCanvas` owns the keydown; this only stands down,
    // exactly as it does for a room, so the two scopes still cannot overlap.
    if (store.flowFocus !== null) return;
    if (!store.vault?.rootPath) return;
    e.preventDefault();
    if (store.finderOpen) store.finderOpen = false;
    else store.openFinder();
  }
</script>

<svelte:window onkeydown={onkeydown} />

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

<NoticeBanner />

<style>
  .app { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .cols { flex: 1; display: flex; min-height: 0; min-width: 0; }
  .loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--muted); }
</style>
