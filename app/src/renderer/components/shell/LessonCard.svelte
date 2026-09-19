<script lang="ts">
  /**
   * One lesson on the path (#48, §6, and the interview finding in
   * `docs/research/interviews/findings.md` §6).
   *
   * §6 asks for "hover cards, one per objective, **like lessons**: title, what it asks of you,
   * its fill, the slide pages", each with one big **Start**. The interview adds the shape they
   * go in: one interviewee asked for *a progression journey* — easier things first, a plan he is
   * guided along. So a card knows where it sits on that path: **done**, **next up**, or **later**,
   * and only the next-up card wears the primary button. A page of nine equally loud Start buttons
   * is a list of options; one of them being obviously next is a plan.
   *
   * Calm and adult, deliberately: a numbered step and a rule down the side, not a game map.
   */
  import type { ProgressObjectiveView } from '../../../shared/doc/types.js';
  import { fillWord, pageChips, startLabel } from '../../lib/progressview.js';

  let {
    objective,
    index,
    /** Where this card sits on the path. Exactly one card in a deck is `next`. */
    place = 'later',
    busy = false,
    onstart,
  }: {
    objective: ProgressObjectiveView;
    index: number;
    place?: 'done' | 'next' | 'later';
    busy?: boolean;
    onstart: (objectiveId: string) => void;
  } = $props();

  const chips = $derived(pageChips(objective.pages));
</script>

<article class="card" class:done={place === 'done'} class:next={place === 'next'} data-objective={objective.objectiveId}>
  <header class="head">
    <span class="step" aria-hidden="true">{place === 'done' ? '✓' : index}</span>
    <h3>{objective.title}</h3>
    {#if place === 'next'}
      <span class="badge">Next up</span>
    {/if}
    <span class="fill" class:half={objective.fill === 0.5} class:full={objective.fill === 1}>
      {fillWord(objective.fill)}
    </span>
  </header>

  <p class="statement">{objective.statement}</p>

  {#if objective.criteria.length > 0}
    <!-- What it asks of you, as the short checklist the ledger actually scores against. -->
    <ul class="criteria">
      {#each objective.criteria as criterion, i (i)}
        <li>{criterion}</li>
      {/each}
    </ul>
  {/if}

  {#if objective.evidence}
    <!-- The learner's own sentence, verbatim. The ledger's hard rule is that only their words
         are evidence, and this is that rule made visible rather than asserted. -->
    <p class="evidence">You wrote: “{objective.evidence}”</p>
  {/if}

  <footer class="foot">
    {#if chips.length > 0}
      <span class="pages">
        {#each chips as chip, i (i)}<span class="chip">{chip}</span>{/each}
      </span>
    {/if}
    <span class="gap"></span>
    <button
      type="button"
      class="start"
      class:primary={place === 'next'}
      disabled={busy}
      onclick={() => onstart(objective.objectiveId)}
    >{busy ? 'Starting…' : startLabel(objective.fill)}</button>
  </footer>
</article>

<style>
  .card {
    position: relative;
    padding: 11px 13px 10px 15px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hairline);
    border-radius: var(--radius);
  }
  /* The path: a done step is quiet, the next one is the one with the weight. */
  .card.done { border-left-color: var(--peer); background: var(--ground); }
  .card.next { border-left-color: var(--indigo); box-shadow: 0 1px 3px rgb(27 27 34 / 7%); }

  .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .step {
    flex: none;
    width: 17px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .card.done .step { color: var(--peer); }
  .card.next .step { color: var(--indigo); }
  h3 { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.4; }

  .badge {
    flex: none;
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--indigo);
    background: var(--indigo-tint);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .fill {
    margin-left: auto;
    flex: none;
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }
  .fill.half { color: var(--text-2); }
  .fill.full { color: var(--peer); }

  .statement { margin: 0 0 7px 25px; font-size: 12.5px; line-height: 1.55; color: var(--text-2); }

  .criteria { margin: 0 0 7px 25px; padding-left: 15px; }
  .criteria li { font-size: 11.5px; line-height: 1.5; color: var(--muted); }
  .criteria li::marker { content: '□  '; }
  .card.done .criteria li::marker { content: '☑  '; }

  .evidence {
    margin: 0 0 8px 25px;
    padding: 5px 8px;
    background: var(--indigo-tint);
    border-radius: 5px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-2);
  }

  .foot { display: flex; align-items: center; gap: 8px; margin-left: 25px; }
  .gap { flex: 1; }
  .pages { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .chip {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    padding: 0 5px;
    font-variant-numeric: tabular-nums;
  }

  .start {
    flex: none;
    font-size: 12px;
    padding: 5px 14px;
    border-radius: 6px;
    border: 1px solid var(--hairline);
    background: var(--pane);
    color: var(--text-2);
  }
  .start:hover:not(:disabled) { border-color: var(--indigo); color: var(--indigo); }
  /* One big button, and only on the step that is actually next. */
  .start.primary {
    background: var(--indigo);
    border-color: var(--indigo);
    color: #fff;
    font-weight: 600;
    padding: 7px 22px;
  }
  .start.primary:hover:not(:disabled) { background: #443cd0; color: #fff; }
  .start:disabled { opacity: 0.55; cursor: default; }
</style>
