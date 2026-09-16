<script lang="ts">
  /** Named indicator in the agent's own slot (product-design.md §C3). */
  import type { ThinkingView } from '../../shared/types.js';
  import { elapsedMs, etaTitle, indicatorMode } from '../lib/flowchat.js';
  import { monogram, roleWord } from '../lib/labels.js';
  import { clock } from '../lib/store.svelte.js';

  let { thinking }: { thinking: ThinkingView } = $props();

  const seconds = $derived(Math.floor(elapsedMs(thinking, clock.ms) / 1000));
  /**
   * Lucas's decision of 2026-09-16 (#34): **plain animated dots for Ellie, the elapsed counter
   * for Max, and the ETA only on hover**. A visible countdown is the strongest
   * anti-broken-system device there is, but it advertises the delay as *scheduled*, which is
   * closer to the performative-deliberation line Tan et al. §5.5 warns about than a plain
   * indicator. The pacing is already disclosed once, properly, by `PacingStrip`.
   */
  const showCount = $derived(indicatorMode(thinking, clock.ms) === 'counter');
  /** `etaMs` has been computed and shipped over IPC since the first build and never read. */
  const eta = $derived(etaTitle(thinking, clock.ms));
</script>

<!--
  `role="status"` with `aria-live="off"`: this container used to be `aria-live="polite"` around
  text that changes **every second** for the Tester, so a screen reader announced the wait once a
  second for twelve seconds (audit §8). The flow's single live region does the announcing now.
-->
<div class="ind" style="--hue: {thinking.colour}" role="status" aria-live="off" title={eta}>
  <div class="head">
    <span class="avatar" class:ringed={thinking.role === 'challenger'} aria-hidden="true"
      >{monogram(thinking.displayName)}</span
    >
    <span class="label-caps label">{thinking.displayName} · {roleWord(thinking.role)}</span>
  </div>
  <div class="block" class:fast={thinking.role === 'tutee'}>
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="verb">{thinking.displayName} is {thinking.verb}…</span>
    {#if showCount}<span class="count" aria-hidden="true">{seconds}s</span>{/if}
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
  /* `styles/app.css`'s reduced-motion block covers transitions, not keyframes; the three dots
     were the one animation that ran regardless (audit §8). */
  @media (prefers-reduced-motion: reduce) {
    .dots i { animation: none; opacity: 0.6; }
  }
</style>
