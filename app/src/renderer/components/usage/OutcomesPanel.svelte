<script lang="ts">
  /**
   * **How calls ended** (`shared/cost.ts` `CostOutcome`, migration 021).
   *
   * Four rows, always, including the zeroes: "0 failed" is a fact worth showing and a panel whose
   * rows come and go is a panel a reader cannot learn the shape of.
   *
   * **A stop is not a failure.** `'aborted'` is the learner pressing Stop and `'preempted'` is
   * work that was re-queued and completed on the next row; only `'error'` is called failed here.
   * Identity is a glyph and a word, never a colour — a red dot beside "Stopped by you" would
   * contradict the label next to it.
   */
  import { COST_OUTCOME_LABEL, totalTokens, type CostOutcomeRow } from '../../../shared/cost.js';
  import { tokensLabel } from '../../lib/cost.js';
  import { OUTCOME_GLYPH, OUTCOME_NOTE, callsWord, outcomeHeadline } from '../../lib/usageview.js';

  let { rows }: { rows: CostOutcomeRow[] } = $props();
</script>

<p class="headline">{outcomeHeadline(rows)}</p>

<ul class="rows">
  {#each rows as row (row.outcome)}
    <li class:zero={row.calls === 0}>
      <span class="glyph" aria-hidden="true">{OUTCOME_GLYPH[row.outcome]}</span>
      <span class="body">
        <span class="top">
          <span class="name">{COST_OUTCOME_LABEL[row.outcome]}</span>
          <!-- "· 0" alone reads as a second call count; the unit is what makes it a token figure,
               and a zero-token failed row is the whole point of the outcome column. -->
          <span class="count">{callsWord(row.calls)} · {tokensLabel(totalTokens(row.tokens))} tok</span>
        </span>
        <span class="why">{OUTCOME_NOTE[row.outcome]}</span>
      </span>
    </li>
  {/each}
</ul>

<style>
  .headline { margin: 0 0 12px; font-size: 12.5px; }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li {
    display: flex;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--hairline);
  }
  li:first-child { border-top: 0; padding-top: 0; }
  .zero { opacity: 0.5; }
  .glyph { flex: none; width: 14px; text-align: center; color: var(--text-2); font-size: 12px; line-height: 1.5; }
  .body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .top { display: flex; align-items: baseline; gap: 10px; }
  .name { flex: 1 1 auto; font-size: 12px; }
  .count { flex: none; font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .why { font-size: 11px; line-height: 1.5; color: var(--text-2); }
</style>
