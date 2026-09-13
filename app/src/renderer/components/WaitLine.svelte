<script lang="ts">
  /**
   * The silence hairline under the composer (product-design.md §C4).
   * It owns nothing: it animates against timer.deadlineTs, corrected for drift
   * by timer.now, and re-reads on every timer.updated event.
   */
  import type { AgentProfile, TimerView } from '../../shared/types.js';
  import { clock, store } from '../lib/store.svelte.js';
  import { readTimer } from '../lib/time.js';

  let {
    timer,
    firingAgent,
    onhold,
    onwait,
  }: {
    timer: TimerView;
    firingAgent: AgentProfile | null;
    onhold: () => void;
    onwait: () => void;
  } = $props();

  const reading = $derived(readTimer(timer, clock.ms, store.timerReceivedAt));

  /** Retract locally the instant a key lands, then stay retracted once main confirms. */
  const justTyped = $derived(clock.ms - store.lastTypedAt < 1400);
  const retracted = $derived(
    justTyped || (timer.paused && timer.pausedReason === 'typing') || !reading.active,
  );
  const captionVisible = $derived(retracted && clock.ms - store.lastTypedAt < 2000);

  /** The affordance appears in the last 10 s of the window — 35 s of the researched 45 s. */
  const nearFiring = $derived(!retracted && reading.active && reading.remainingMs <= 10000);
  const hue = $derived(nearFiring && firingAgent ? firingAgent.colour : 'var(--waitline)');
  const seconds = $derived(Math.ceil(reading.remainingMs / 1000));
</script>

<div class="wait">
  <div
    class="track"
    title={reading.active ? `${seconds}s before ${firingAgent?.displayName ?? 'someone'} may chime in` : ''}
  >
    <span class="fill" style="width: {retracted ? 0 : reading.progress * 100}%; background: {hue}"></span>
    {#if reading.active && !retracted}
      <span class="digits">{seconds}s</span>
    {/if}
  </div>

  <div class="under">
    {#if captionVisible}
      <span class="caption">paused while you type</span>
    {:else if timer.paused && timer.pausedReason === 'user'}
      <span class="caption">nudges paused</span>
      <button type="button" class="ctrl" onclick={onwait}>Undo</button>
    {:else if timer.nudgesDone}
      <span class="caption">nudges done for this round</span>
    {:else if nearFiring}
      <span class="caption">{firingAgent?.displayName ?? 'Someone'} may chime in</span>
      <button type="button" class="ctrl" onclick={onhold}>Hold</button>
      <button type="button" class="ctrl" onclick={onwait}>Wait for me</button>
    {/if}
  </div>

  <span class="sr-only" aria-live="polite">
    {retracted ? 'Quiet timer paused.' : reading.active ? `Quiet timer running, ${seconds} seconds left.` : ''}
  </span>
</div>

<style>
  .wait { padding: 0 2px; }
  .track {
    position: relative;
    height: 1px;
    background: transparent;
    margin-top: 6px;
  }
  .fill {
    display: block;
    height: 1px;
    /* 200 ms linear matches the store tick, so the fill reads as continuous;
       the same duration is the §C4 retraction. */
    transition: width 200ms linear, background 400ms ease-out;
  }
  /* No digits unless asked for (§C4). */
  .digits {
    position: absolute;
    right: 0;
    top: -14px;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .track:hover .digits { opacity: 1; }

  .under {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 18px;
    margin-top: 5px;
  }
  .caption { font-size: 11px; color: var(--muted); }
  .ctrl {
    font-size: 11px;
    color: var(--text-2);
    border: 1px solid var(--hairline);
    border-radius: 5px;
    padding: 2px 8px;
  }
  .ctrl:hover { border-color: #d4d4e2; color: var(--text); }
</style>
