<script lang="ts">
  /** The hero screen (product-design.md §B3). Three live columns plus the rail. */
  import type { RoomSnapshot } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import Composer from './Composer.svelte';
  import Finder from './Finder.svelte';
  import LedgerRail from './LedgerRail.svelte';
  import RecapCard from './RecapCard.svelte';
  import SourcePane from './SourcePane.svelte';
  import Thread from './Thread.svelte';
  import VaultBrowser from './VaultBrowser.svelte';
  import WhisperPane from './WhisperPane.svelte';

  let { room }: { room: RoomSnapshot } = $props();

  let composer = $state<ReturnType<typeof Composer> | null>(null);

  const railWidth = $derived(
    store.whisperOpen
      ? 'calc(40px + clamp(280px, 22vw, 340px))'
      : store.ledgerHidden
        ? '40px'
        : 'clamp(260px, 20vw, 320px)',
  );

  function openWhisper(): void {
    store.whisperOpen = true;
  }

  function onkeydown(e: KeyboardEvent): void {
    const meta = e.metaKey || e.ctrlKey;
    /**
     * ⌘⇧S — "Show the room" (issue #22 decision 4). With the browser open on a document it
     * posts; otherwise it opens the browser, because "show them this" and "go and find the
     * thing to show them" are the same intention half a second apart.
     */
    if (meta && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (store.browserOpen && store.openDoc) store.showTheRoom();
      else store.browserOpen = true;
      return;
    }
    if (store.browserOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        store.browserOpen = false;
      }
      // ⌘K belongs to the finder while the browser is over the room; App.svelte stands down in
      // a room, so this is the one place that has to hand it over.
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (store.finderOpen) store.finderOpen = false;
        else store.openFinder();
      }
      return;
    }
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openWhisper();
      return;
    }
    if (meta && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      store.ledgerHidden = !store.ledgerHidden;
      return;
    }
    if (meta && e.key === '\\') {
      e.preventDefault();
      store.sourceCollapsed = !store.sourceCollapsed;
      return;
    }
    if (meta && e.key === '.') {
      e.preventDefault();
      store.hold();
      return;
    }
    if (e.key === 'Escape' && store.whisperOpen) {
      e.preventDefault();
      store.closeWhisper();
      composer?.focus();
      return;
    }
    // One keystroke picks the counterpart while the picker is showing (§B4).
    if (store.whisperOpen && !store.whisper && !meta && e.key.length === 1) {
      const target = room.agents.find(
        (a) =>
          (a.role === 'peer' || a.role === 'challenger') &&
          a.displayName.charAt(0).toLowerCase() === e.key.toLowerCase(),
      );
      if (target && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        void store.openWhisper(target.key);
      }
    }
  }
</script>

<svelte:window {onkeydown} />

{#if store.browserOpen}
  <!-- The learner has gone to fetch something. The room keeps its state and its timers; this is
       a trip to the shelf, not a different screen (issue #22 decision 4). -->
  <div class="browser">
    <VaultBrowser inRoom />
  </div>
  {#if store.finderOpen}
    <Finder onopen={(fileId) => void store.openFile(fileId)} />
  {/if}
{:else}
<div class="room" style="--rail: {railWidth}">
  <SourcePane material={room.material} />

  <div class="centre">
    <Thread {room} />
    <div class="dock">
      <Composer bind:this={composer} {room} onwhisper={openWhisper} />
    </div>
    {#if store.recap}
      <RecapCard recap={store.recap} onclose={() => (store.recap = null)} />
    {/if}
  </div>

  <div class="right">
    <LedgerRail ledger={room.ledger} compact={store.whisperOpen} />
    {#if store.whisperOpen}
      <WhisperPane {room} />
    {/if}
  </div>
</div>
{/if}

<style>
  .room { flex: 1; display: flex; min-width: 0; min-height: 0; }
  .browser { flex: 1; display: flex; min-width: 0; min-height: 0; }
  .centre {
    position: relative;
    flex: 1;
    min-width: 460px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ground);
  }
  .dock { padding: 0 24px; border-top: 1px solid var(--hairline); background: var(--ground); }
  .right { width: var(--rail); flex: none; display: flex; min-height: 0; }
  .right > :global(*) { min-height: 0; }
  .right > :global(.pane) { flex: 1; }
</style>
