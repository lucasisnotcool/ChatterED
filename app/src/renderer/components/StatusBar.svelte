<script lang="ts">
  /** Bottom status bar (product-design.md §B0). */
  import type { RoomSnapshot } from '../../shared/types.js';
  import { clock, store } from '../lib/store.svelte.js';
  import { elapsed } from '../lib/time.js';
  import { roleWord } from '../lib/labels.js';

  let { room, onwhisper }: { room: RoomSnapshot; onwhisper: () => void } = $props();

  const spoken = $derived(
    new Set(room.messages.filter((m) => m.speaker.kind === 'agent').map((m) => (m.speaker.kind === 'agent' ? m.speaker.key : ''))),
  );
  const pacing = $derived(
    room.timer.nudgesDone
      ? 'nudges done for this round'
      : room.nudgesPaused || room.timer.pausedReason === 'user'
        ? 'nudges paused'
        : 'pacing on',
  );
</script>

<footer class="bar">
  <span class="slot">Round {room.round} · Explain · {elapsed(room.startedAt, clock.ms)}</span>

  <span class="presence">
    {#each room.agents as a (a.key)}
      {@const here = spoken.has(a.key)}
      {@const busy = room.thinking?.agentKey === a.key}
      <span class="who" class:away={!here} title={roleWord(a.role)}>
        <span class="dot" style="background: {here ? a.colour : 'transparent'}; border-color: {a.colour}"></span>
        {a.displayName}{#if busy}<em> {room.thinking?.verb}</em>{:else if !here}<em> —</em>{/if}
      </span>
    {/each}
  </span>

  <span class="spacer"></span>

  {#if store.whisperOpen && store.whisper}
    <span class="chip">🔒 private with {store.whisper.agent.displayName}</span>
  {/if}
  <span class="pacing">⏸ {pacing}</span>
  <button type="button" class="whisper" onclick={onwhisper}>⌘K whisper</button>
</footer>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 18px;
    height: 30px;
    padding: 0 14px;
    background: var(--ground);
    border-top: 1px solid var(--hairline);
    font-size: 11px;
    color: var(--text-2);
    flex: none;
  }
  .slot { white-space: nowrap; }
  .presence { display: flex; align-items: center; gap: 12px; }
  .who { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .who.away { color: var(--muted); }
  .who em { font-style: normal; color: var(--muted); }
  .dot { width: 7px; height: 7px; border-radius: 50%; border: 1px solid; display: inline-block; }
  .spacer { flex: 1; }
  .chip {
    border: 1px solid var(--hairline);
    border-radius: 10px;
    padding: 1px 8px;
    background: var(--pane);
  }
  .pacing { white-space: nowrap; }
  .whisper { font-size: 11px; color: var(--text-2); border-bottom: 1px solid var(--hairline); }
  .whisper:hover { color: var(--indigo); border-bottom-color: var(--indigo); }
</style>
