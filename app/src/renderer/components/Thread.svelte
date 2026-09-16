<script lang="ts">
  /** The scrolling group thread (product-design.md §B3, §C1, §C6). */
  import type { RoomSnapshot } from '../../shared/types.js';
  import Message from './Message.svelte';
  import RoundCard from './RoundCard.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';
  import TurnFailureCard from './TurnFailureCard.svelte';

  let { room }: { room: RoomSnapshot } = $props();

  let scroller = $state<HTMLDivElement | null>(null);

  function sameSpeaker(i: number): boolean {
    const prev = room.messages[i - 1];
    const cur = room.messages[i];
    if (!prev || !cur) return false;
    const a = prev.speaker.kind === 'agent' ? prev.speaker.key : 'student';
    const b = cur.speaker.kind === 'agent' ? cur.speaker.key : 'student';
    return a === b;
  }

  /** §C6: measure the connector so it reaches the message being contested. */
  $effect(() => {
    void room.messages.length;
    const root = scroller;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>('[data-connector]')) {
      const targetId = el.dataset.targetId;
      const host = el.parentElement;
      if (!host) continue;
      const target = targetId ? root.querySelector<HTMLElement>(`[data-msg-id="${targetId}"]`) : null;
      const height = target ? Math.max(20, host.offsetTop - target.offsetTop - 4) : 28;
      el.style.setProperty('--connector-h', `${height}px`);
    }
  });

  /** Follow the tail unless the learner has scrolled up to read. */
  $effect(() => {
    void room.messages.length;
    void room.thinking;
    const root = scroller;
    if (!root) return;
    const nearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 220;
    if (nearBottom) queueMicrotask(() => root.scrollTo({ top: root.scrollHeight }));
  });
</script>

<div class="thread" bind:this={scroller} aria-live="polite" aria-label="Group conversation">
  <div class="inner">
    <RoundCard title={room.roundCard.title} body={room.roundCard.body} ledger={room.ledger} />
    {#each room.messages as m, i (m.id)}
      <Message message={m} agents={room.agents} sameSpeaker={sameSpeaker(i)} />
    {/each}
    <!-- Nothing at all during the floor-yield window: no thinking view, no chrome (§C3). -->
    {#if room.thinking}
      <ThinkingIndicator thinking={room.thinking} />
    {/if}
    <!-- The room-level stream's half of the failed-turn card. Same rule: a turn always ends in
         something the learner can see. -->
    {#each room.failures as failure (failure.id)}
      <TurnFailureCard {failure} />
    {/each}
  </div>
</div>

<style>
  .thread {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px 8px;
  }
  .inner { max-width: 76ch; }
</style>
