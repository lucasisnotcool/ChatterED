<script lang="ts">
  /**
   * **Where the tokens go** — one ranked bar list, used three times (by scope, by model, by
   * backend) because they are the same question asked of three columns.
   *
   * **One hue for every bar.** These categories are nominal: a scope is not more or less than
   * another scope, it is a different one. Colouring them darker-where-bigger would spend the
   * identity channel re-encoding what the bar length already shows, and would put a value ramp on
   * categories that have no order (dataviz anti-patterns). One series, so no legend box either —
   * the panel title already says what is plotted.
   *
   * The label column is HTML rather than SVG `<text>` so a long model id ellipsizes properly
   * instead of running across its own bar.
   */
  import { tokensLabel } from '../../lib/cost.js';
  import { BAR_THICK, barColumn, barPath, callsWord, pct, sliceBars } from '../../lib/usageview.js';
  import type { CostSlice } from '../../../shared/cost.js';

  let {
    slices,
    word = (k: string) => k,
    caption,
  }: { slices: CostSlice[]; word?: (key: string) => string; caption: string } = $props();

  let width = $state(0);
  const plot = $derived(barColumn(width));
  const bars = $derived(sliceBars(slices, plot, word));
</script>

<div class="bars" bind:clientWidth={width}>
  {#each bars.rows as row (row.key)}
    <div class="row" title={row.summary}>
      <span class="label">{row.label}</span>
      <span class="plot">
        {#if plot > 0}
          <svg width={plot} height={BAR_THICK} viewBox="0 0 {plot} {BAR_THICK}" aria-hidden="true">
            <path d={barPath(0, 0, row.w, BAR_THICK)} />
          </svg>
        {/if}
      </span>
      <span class="value">{tokensLabel(row.tokens)} · {pct(row.share)}</span>
    </div>
  {/each}
</div>

{#if bars.folded}
  <p class="folded">
    and {bars.folded.count} more, {tokensLabel(bars.folded.tokens)} tokens between them.
  </p>
{/if}

<table class="sr-only">
  <caption>{caption}</caption>
  <thead><tr><th>Category</th><th>Tokens</th><th>Share</th><th>Calls</th></tr></thead>
  <tbody>
    {#each bars.rows as row (row.key)}
      <tr>
        <td>{row.label}</td>
        <td>{tokensLabel(row.tokens)}</td>
        <td>{pct(row.share)}</td>
        <td>{callsWord(row.calls)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .bars { display: flex; flex-direction: column; gap: 6px; }
  .row {
    display: grid;
    grid-template-columns: 112px 1fr 86px;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }
  .label {
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plot { display: block; min-width: 0; }
  svg { display: block; }
  path { fill: var(--series-1); }
  .value {
    font-size: 11px;
    color: var(--text-2);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .folded { margin: 10px 0 0; font-size: 11px; color: var(--text-2); }
</style>
