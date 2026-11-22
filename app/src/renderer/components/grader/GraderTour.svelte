<script lang="ts">
  /**
   * **The grader tour** (`shared/grader.ts`): a few cards for someone who has never seen the app,
   * with Back, Next and Skip tour. Drawn inside first run's card in a grader copy, before "Start
   * with a tutorial", and again from Help ▸ Show the Grader Tour (`GraderTourLayer`). Its own
   * styles copy first run's, so both places look the same. Plain text and lists only.
   */
  import { GRADER_TOUR, tourStep } from '../../../shared/grader.js';

  interface Props {
    /** Past the last card, or Skip tour. */
    ondone: () => void;
    /** The last card's button. */
    doneLabel?: string;
  }
  let { ondone, doneLabel = 'Next' }: Props = $props();

  let step = $state(0);
  const card = $derived(GRADER_TOUR[step] ?? GRADER_TOUR[0]!);
  const last = $derived(step >= GRADER_TOUR.length - 1);

  function move(m: 'next' | 'back'): void {
    const next = tourStep(step, m);
    if (next === 'done') ondone();
    else step = next;
  }
</script>

<div class="tour" aria-live="polite">
  <span class="steps" aria-label="Tour card {step + 1} of {GRADER_TOUR.length}">
    {#each GRADER_TOUR as _c, i (i)}<span class="pip" class:on={i === step}></span>{/each}
  </span>
  <h1>{card.title}</h1>
  {#each card.paragraphs as para, i (i)}
    <p>{para}</p>
  {/each}
  {#if card.bullets?.length}
    <ul>
      {#each card.bullets as bullet, i (i)}
        <li>{bullet}</li>
      {/each}
    </ul>
  {/if}
  {#if card.note}
    <p class="quiet">{card.note}</p>
  {/if}
  <div class="acts">
    {#if step > 0}
      <button type="button" class="btn" onclick={() => move('back')}>Back</button>
    {/if}
    <button type="button" class="btn-primary" onclick={() => move('next')}>{last ? doneLabel : 'Next'}</button>
    {#if !last}
      <button type="button" class="btn-link" onclick={() => ondone()}>Skip tour</button>
    {/if}
  </div>
</div>

<style>
  .steps { display: flex; gap: 6px; margin-bottom: 18px; }
  .pip { width: 16px; height: 3px; border-radius: 2px; background: var(--hairline); }
  .pip.on { background: var(--indigo); }
  h1 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
  p { margin: 0 0 12px; font-size: 13px; line-height: 1.7; max-width: 62ch; }
  ul { margin: 0 0 12px; padding-left: 20px; font-size: 13px; line-height: 1.7; max-width: 62ch; }
  li { margin: 2px 0; }
  .quiet { color: var(--text-2); }
  .acts { display: flex; align-items: center; gap: 16px; margin-top: 22px; }
</style>
