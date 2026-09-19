<script lang="ts">
  /**
   * **`byDay`, oldest left.**
   *
   * One series, one hue, columns — the form for change over time when the bars are days and the
   * reader's question is "when did this happen". No line: the days are discrete buckets, and a
   * line between them would draw a slope through hours nothing was sent.
   *
   * **The axis is labelled UTC, because the buckets are UTC.** `main/cost/analytics.ts` groups on
   * `substr(created_at, 1, 10)` so a row can never drift into a neighbouring day depending on
   * where the laptop was opened; saying "your Tuesday" over that would be the lie the SQL
   * carefully avoided.
   *
   * Only every *n*th date is printed, anchored on the newest bar — the right-hand end is the one
   * a reader dates first, and an axis whose last column is unlabelled is an axis that stops short.
   */
  import { tokensLabel } from '../../lib/cost.js';
  import { callsWord, columnLayout, columnPath } from '../../lib/usageview.js';
  import { totalTokens, type CostDayRow } from '../../../shared/cost.js';

  let { rows }: { rows: CostDayRow[] } = $props();

  let width = $state(0);
  const chart = $derived(columnLayout(rows, width));
</script>

<div class="plot" bind:clientWidth={width}>
  {#if width > 0}
    <svg width={chart.width} height={chart.height} viewBox="0 0 {chart.width} {chart.height}" role="img">
      <title>Tokens per UTC day, oldest on the left. Highest day {tokensLabel(chart.max)} tokens.</title>

      {#each chart.ticks as tick (tick.value)}
        <line class="grid" x1={chart.plot.x} x2={chart.plot.x + chart.plot.w} y1={tick.y} y2={tick.y} />
        <text class="tick" x={chart.plot.x - 8} y={tick.y} text-anchor="end" dominant-baseline="middle">
          {tick.label}
        </text>
      {/each}

      {#each chart.bars as bar (bar.key)}
        <g>
          <title>{bar.summary}</title>
          <!-- A hit target the width of the whole band, so a 6px column is still hoverable. -->
          <rect
            class="hit"
            x={bar.x - 3}
            y={chart.plot.y}
            width={bar.w + 6}
            height={chart.plot.h}
          />
          <path d={columnPath(bar.x, bar.y, bar.w, bar.h)} />
        </g>
      {/each}

      {#each chart.dayLabels as label (label.x)}
        <text class="day" x={label.x} y={chart.plot.y + chart.plot.h + 13} text-anchor="middle">{label.text}</text>
      {/each}
    </svg>
  {/if}
</div>

<table class="sr-only">
  <caption>Tokens per UTC day</caption>
  <thead><tr><th>Day (UTC)</th><th>Tokens</th><th>Calls</th></tr></thead>
  <tbody>
    {#each rows as row (row.day)}
      <tr><td>{row.day}</td><td>{tokensLabel(totalTokens(row.tokens))}</td><td>{callsWord(row.calls)}</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .plot { min-width: 0; }
  svg { display: block; max-width: 100%; }
  /* Solid hairline, one step off the surface. Never dashed: dashing reads as a threshold. */
  .grid { stroke: var(--hairline); stroke-width: 1; shape-rendering: crispEdges; }
  /* `--glyph`, not `--muted`: the axis has to be recessive, but `--muted` on white is under
     2:1 and an axis nobody can read is an axis that is not there. */
  .tick, .day { font-size: 10px; fill: var(--glyph); }
  path { fill: var(--series-1); }
  .hit { fill: transparent; }
  /* The hovered mark lifts rather than changing hue — a hover state that introduced a second
     colour would read as a second series. */
  g:hover path { filter: brightness(1.15); }
</style>
