<script lang="ts">
  /**
   * **The progress bar, in the doc header** (#48, §6).
   *
   * It replaces the objectives tree panel on Lucas's own verdict: *"not intuitive enough to feel
   * like a tangible goal and reward / completion level"*. What makes a bar feel like a goal is
   * that it is **countable and finite** — one segment per objective, in deck order, each one
   * empty, half or full — so a learner can see at a glance how much of this lecture is theirs
   * and how much is left. A percentage could not do that; nine little boxes can.
   *
   * Three decisions worth naming:
   *
   *  - **A half is drawn as a half**, not rounded away. *Partly there* is the most common
   *    verdict and a bar that showed it as nothing would be telling the learner their answer was
   *    worthless.
   *  - **The segment that moved animates; the others do not.** A bar that re-animated on every
   *    update is a bar nobody reads (the same argument `store.ledgerPulse` makes for the ledger).
   *  - **Completion is marked once, quietly.** A calm sweep and a sentence — this is a document,
   *    not a game, and the interviewee who asked for a progression journey asked for guidance,
   *    not for confetti.
   */
  import { countLabel, isComplete, segments, statusLine } from '../../lib/progressview.js';
  import { store } from '../../lib/store.svelte.js';

  const progress = store.progress;
  const view = $derived(progress.view);
  const list = $derived(segments(view));
  const moved = $derived(new Set(progress.moved.ids));
  const complete = $derived(isComplete(view));
</script>

<div class="wrap">
  <button
    type="button"
    class="bar"
    class:complete
    aria-expanded={progress.open}
    aria-label={`Progress: ${countLabel(view)} objectives complete. ${statusLine(view)}`}
    title="What this lecture asks of you"
    onclick={() => progress.toggle()}
  >
    <span class="segments" aria-hidden="true">
      {#if list.length === 0}
        <span class="seg empty wide"></span>
      {:else}
        {#each list as seg (seg.objectiveId)}
          <span
            class="seg"
            class:half={seg.fill === 0.5}
            class:full={seg.fill === 1}
            class:moved={moved.has(seg.objectiveId)}
            title={`${seg.index}. ${seg.title}`}
          ></span>
        {/each}
      {/if}
    </span>

    <span class="count" aria-hidden="true">{countLabel(view)}</span>
    <span class="status">{statusLine(view)}</span>
    <span class="twist" aria-hidden="true">{progress.open ? '⌃' : '⌄'}</span>
  </button>

  {#if complete && progress.celebrated}
    <!-- Once, and in words. `progress.celebrated` is per file, so reopening a finished deck does
         not replay it. -->
    <p class="done" role="status">Every objective on this deck is answered in your own words.</p>
  {/if}
</div>

<style>
  .wrap { min-width: 0; }

  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 7px;
    text-align: left;
    /* A backstop: nothing in this row may reach over the header and into the chat column, which
       is what a fixed-width segment strip did at 1100 px. */
    overflow: hidden;
  }
  .bar:hover { background: var(--ground); }

  /* The strip narrows before anything else does: nine segments of 22 px is 222 px, and a doc
     header in a 1100 px window does not have 222 px to give. They stay equal to each other,
     which is the only thing a countable bar actually promises. */
  .segments { display: flex; gap: 3px; flex: 0 1 auto; min-width: 0; }
  .seg {
    flex: 1 1 22px;
    min-width: 5px;
    max-width: 22px;
    height: 7px;
    border-radius: 2px;
    background: var(--hairline);
    /* The half is a fill, not a tint: it has to read as "half of this one" at a glance and at
       a distance, which a lighter colour does not. */
    background-image: linear-gradient(to right, var(--indigo) 0%, var(--indigo) 0%, transparent 0%);
    background-repeat: no-repeat;
    transition: background-image 480ms ease-out;
  }
  .seg.wide { max-width: 120px; flex-basis: 120px; }
  .seg.half {
    background-image: linear-gradient(to right, var(--indigo) 0%, var(--indigo) 50%, transparent 50%);
  }
  .seg.full {
    background-image: linear-gradient(to right, var(--indigo) 0%, var(--indigo) 100%, transparent 100%);
  }
  /* The one that just moved. A single soft pulse, and nothing else on the row reacts. */
  .seg.moved { animation: lit 900ms ease-out 1; }
  @keyframes lit {
    0% { box-shadow: 0 0 0 0 var(--indigo-tint); }
    35% { box-shadow: 0 0 0 4px var(--indigo-tint); }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  .count {
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    flex: none;
  }
  .status {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .twist { font-size: 9px; color: var(--muted); flex: none; }

  .bar.complete .count { color: var(--peer); }
  .done { margin: 2px 8px 0; font-size: 11px; color: var(--peer); }

  @media (prefers-reduced-motion: reduce) {
    .seg { transition: none; }
    .seg.moved { animation: none; }
  }
</style>
