<script lang="ts">
  /**
   * The ten slowest, or the ten most expensive, recent calls.
   *
   * **No bodies, ever.** `CostCallView` has no column that carries words — `llm_usage` has no
   * body column at all, so that half is enforced by the schema rather than by this component
   * remembering. What is here is what a call *was*: what it was for, which model answered, how
   * many tokens, how long, and (on the priciest table) what the rate card makes of it.
   *
   * A table rather than a chart: ten rows of four unrelated dimensions is a table's job, and a
   * chart of "the ten slowest" plots an ordering the reader already has.
   *
   * The money column's **header carries the label** — `usdLabel(mode)`, so "API-equivalent" is
   * said once at the top rather than ten times down the column.
   */
  import {
    COST_SCOPE_LABEL,
    totalTokens,
    usdLabel,
    type CostCallView,
    type CostMode,
    type CostScope,
  } from '../../../shared/cost.js';
  import { tokensLabel, usdApprox } from '../../lib/cost.js';
  import { msLabel } from '../../lib/usageview.js';

  let {
    calls,
    mode,
    showUsd = false,
  }: { calls: CostCallView[]; mode: CostMode; showUsd?: boolean } = $props();

  const money = $derived(showUsd && mode !== 'none');
</script>

<table>
  <thead>
    <tr>
      <th scope="col">What for</th>
      <th scope="col">Model</th>
      <th scope="col" class="num">Tokens</th>
      {#if money}<th scope="col" class="num">{usdLabel(mode)}</th>{/if}
      <th scope="col" class="num">Time</th>
    </tr>
  </thead>
  <tbody>
    {#each calls as call (call.id)}
      <tr>
        <td>{COST_SCOPE_LABEL[call.scope as CostScope] ?? call.scope}</td>
        <td class="model" title={call.model}>{call.model}</td>
        <td class="num">{tokensLabel(totalTokens(call.tokens))}</td>
        {#if money}<td class="num">{usdApprox(call.estimatedUsd)}</td>{/if}
        <td class="num">{msLabel(call.durationMs)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--glyph);
    font-size: 10.5px;
    padding: 0 8px 5px 0;
    border-bottom: 1px solid var(--hairline);
    white-space: nowrap;
  }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid var(--hairline); color: var(--text-2); }
  tbody tr:last-child td { border-bottom: 0; }
  td:first-child { color: var(--text); }
  th:first-child, td:first-child { width: 26%; }
  .model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 26%; }
  /* The gutter is on the *left* of a right-aligned column: with it on the right, `Tokens` and
     `API-equivalent` butt together in the header at the app's narrow end. */
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    padding-right: 0;
    padding-left: 10px;
    white-space: nowrap;
    width: 16%;
  }
</style>
