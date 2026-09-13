<script lang="ts">
  /** Named indicator in the agent's own slot (product-design.md §C3). */
  import type { ThinkingView } from '../../shared/types.js';
  import { monogram, roleWord } from '../lib/labels.js';
  import { clock } from '../lib/store.svelte.js';
  import { ts } from '../lib/time.js';

  let { thinking }: { thinking: ThinkingView } = $props();

  const seconds = $derived(Math.floor((clock.ms - ts(thinking.startedAt)) / 1000));
  /** The climbing counter is the anti-broken-system device — Challenger only, from 3 s. */
  const showCount = $derived(thinking.showCounter && seconds >= 3);
</script>

<div class="ind" style="--hue: {thinking.colour}" aria-live="polite">
  <div class="head">
    <span class="avatar" class:ringed={thinking.role === 'challenger'} aria-hidden="true"
      >{monogram(thinking.displayName)}</span
    >
    <span class="label-caps label">{thinking.displayName} · {roleWord(thinking.role)}</span>
  </div>
  <div class="block" class:fast={thinking.role === 'tutee'}>
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="verb">{thinking.displayName} is {thinking.verb}…</span>
    {#if showCount}<span class="count">{seconds}s</span>{/if}
  </div>
</div>

<style>
  .ind { margin-top: 16px; max-width: 72ch; }
  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .label { color: var(--hue); }
  .avatar {
    width: 18px; height: 18px; border-radius: 50%;
    background: var(--hue); color: #fff; font-size: 10px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .avatar.ringed { background: transparent; color: var(--hue); border: 1.5px solid var(--hue); }
  .block {
    display: flex; align-items: center; gap: 10px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hue);
    border-radius: var(--radius);
    padding: 10px 14px;
  }
  .verb { font-size: 13px; color: var(--text-2); }
  .count { margin-left: auto; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .dots { display: inline-flex; gap: 4px; }
  .dots i {
    width: 5px; height: 5px; border-radius: 50%; background: var(--hue);
    animation: pulse 1.2s infinite ease-in-out;
  }
  .fast .dots i { animation-duration: 0.7s; }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pulse {
    0%, 60%, 100% { opacity: 0.28; }
    30% { opacity: 1; }
  }
</style>
