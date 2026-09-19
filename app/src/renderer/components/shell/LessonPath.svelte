<script lang="ts">
  /**
   * The lesson cards behind the bar (#48, §6) — **a path, not a list**.
   *
   * `docs/research/interviews/findings.md` §6: an interviewee asked for "a progression journey",
   * easier things first, a study plan he is guided along. So the objectives are drawn in the
   * order the main process returns them (deck and prerequisite order), the first one that is not
   * complete is marked **Next up** and carries the only primary button, and the ones behind it
   * are visibly done rather than merely unhighlighted.
   *
   * What the deck **assumes** you know is shown apart, at the end, under its own heading: those
   * are not steps on the path — they are what the path takes for granted — and counting them
   * would make the denominator a promise the lecture never made (§6).
   */
  import { assumedObjectives, countLabel, statusLine, taughtObjectives } from '../../lib/progressview.js';
  import { store } from '../../lib/store.svelte.js';
  import LessonCard from './LessonCard.svelte';

  let { onstart }: { onstart: (objectiveId: string) => void } = $props();

  const progress = store.progress;
  const view = $derived(progress.view);
  const taught = $derived(taughtObjectives(view));
  const assumed = $derived(assumedObjectives(view));
  /** The path's current step: the first objective that is not finished. */
  const nextUp = $derived(taught.find((o) => o.fill < 1)?.objectiveId ?? null);

  let panel = $state<HTMLElement | null>(null);

  /** Esc closes, and a click outside closes — the two gestures a popover owes. */
  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      progress.open = false;
    }
  }

  $effect(() => {
    if (!progress.open) return;
    const away = (e: MouseEvent): void => {
      if (panel && !panel.contains(e.target as Node)) progress.open = false;
    };
    // Deferred, so the click that opened the popover does not immediately close it.
    const handle = setTimeout(() => window.addEventListener('mousedown', away), 0);
    return () => {
      clearTimeout(handle);
      window.removeEventListener('mousedown', away);
    };
  });

  $effect(() => {
    if (progress.open) panel?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="panel"
  bind:this={panel}
  tabindex="-1"
  aria-label="What this lecture asks of you"
  onkeydown={onkeydown}
>
  <header class="top">
    <h2>What this lecture asks of you</h2>
    <span class="count">{countLabel(view)}</span>
    <button type="button" class="close" aria-label="Close" onclick={() => (progress.open = false)}>✕</button>
  </header>
  <p class="status">{statusLine(view)}</p>

  <div class="scroll">
    {#if taught.length === 0}
      <p class="none">
        Nothing to show yet — the objectives are read from the slides the first time you open the
        deck.
      </p>
    {/if}

    <ol class="path">
      {#each taught as objective, i (objective.objectiveId)}
        <li>
          <LessonCard
            {objective}
            index={i + 1}
            place={objective.fill === 1 ? 'done' : objective.objectiveId === nextUp ? 'next' : 'later'}
            busy={progress.starting === objective.objectiveId}
            {onstart}
          />
        </li>
      {/each}
    </ol>

    {#if assumed.length > 0}
      <h3 class="assumed">The deck assumes you know</h3>
      <ul class="assumedlist">
        {#each assumed as objective (objective.objectiveId)}
          <li>
            <span class="t">{objective.title}</span>
            <span class="s">{objective.statement}</span>
            <button type="button" class="ask" onclick={() => onstart(objective.objectiveId)}>Go over it</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 8px;
    z-index: 20;
    width: min(560px, calc(100vw - 80px));
    max-height: min(70vh, 640px);
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 12px 34px rgb(27 27 34 / 14%);
    outline: none;
  }

  .top { display: flex; align-items: baseline; gap: 10px; padding: 12px 14px 0; }
  h2 { margin: 0; font-size: 12px; font-weight: 600; }
  .count {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .close { font-size: 12px; color: var(--muted); }
  .close:hover { color: var(--text); }
  .status { margin: 3px 14px 10px; font-size: 11.5px; color: var(--muted); }

  .scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 0 14px 14px; }
  .none { margin: 8px 0; font-size: 12.5px; color: var(--muted); line-height: 1.6; }

  /* The path itself: a rule running down the left of the steps, so they read as a sequence
     rather than as nine independent offers. */
  .path {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0 0 0 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .path::before {
    content: '';
    position: absolute;
    left: 0;
    top: 14px;
    bottom: 14px;
    width: 1px;
    background: var(--hairline);
  }

  .assumed {
    margin: 16px 0 7px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .assumedlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .assumedlist li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 9px;
    border: 1px dashed var(--hairline);
    border-radius: 6px;
  }
  .assumedlist .t { font-size: 12px; font-weight: 600; flex: none; }
  .assumedlist .s { font-size: 11.5px; color: var(--muted); flex: 1; line-height: 1.5; }
  .ask { font-size: 11px; color: var(--muted); flex: none; }
  .ask:hover { color: var(--indigo); }
</style>
