<script lang="ts">
  /**
   * **Cache hit share.**
   *
   * On the CLI path this is substantially the whole bill — `main/cost/rates.ts` note 2 measured
   * 86 plain input tokens against 288,291 cache reads over 43 calls — so a panel that showed only
   * "input tokens" would be describing a rounding error. One bar, two segments, the same
   * denominator the percentage beside it is computed from.
   *
   * **Cache writes are not in the bar.** `hitShare` is `cacheRead / (cacheRead + freshInput)` on
   * the wire; a write is a separately priced third thing, so it is a number underneath rather
   * than a third segment that would quietly change what the percentage means.
   */
  import { tokensLabel } from '../../lib/cost.js';
  import { BAR_RADIUS, BAR_THICK, barPath, cacheSplit, pct } from '../../lib/usageview.js';
  import type { CostCacheStats } from '../../../shared/cost.js';

  let { cache }: { cache: CostCacheStats } = $props();

  let width = $state(0);
  const split = $derived(cacheSplit(cache, width));
</script>

<p class="head"><strong>{pct(cache.hitShare)}</strong> of input tokens came from the cache</p>

<div class="plot" bind:clientWidth={width}>
  {#if width > 0}
    <svg width={width} height={BAR_THICK} viewBox="0 0 {width} {BAR_THICK}" role="img">
      <title>{split.summary}</title>
      {#each split.segments as seg (seg.key)}
        <path
          class={seg.key === 'cacheRead' ? 's1' : 's2'}
          d={barPath(seg.x, 0, seg.w, BAR_THICK, seg.round ? BAR_RADIUS : 0)}
        />
      {/each}
    </svg>
  {/if}
</div>

<dl class="keys">
  <div><dt><span class="swatch s1"></span>Cache reads</dt><dd>{tokensLabel(cache.cacheRead)}</dd></div>
  <div><dt><span class="swatch s2"></span>Fresh input</dt><dd>{tokensLabel(cache.freshInput)}</dd></div>
  <div><dt><span class="swatch none"></span>Cache writes</dt><dd>{tokensLabel(cache.cacheWrite)}</dd></div>
</dl>
<p class="note">Cache writes are priced separately and are not part of the ratio above.</p>

<style>
  .head { margin: 0 0 10px; font-size: 12.5px; color: var(--text-2); }
  .head strong { font-size: 20px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .plot { min-width: 0; }
  svg { display: block; }
  path.s1 { fill: var(--series-1); }
  path.s2 { fill: var(--series-2); }

  .keys { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 12px 0 0; }
  .keys div { display: flex; align-items: baseline; gap: 7px; }
  dt { font-size: 11.5px; color: var(--text-2); display: inline-flex; align-items: center; gap: 6px; }
  dd { margin: 0; font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .swatch.s1 { background: var(--series-1); }
  .swatch.s2 { background: var(--series-2); }
  /* Not in the bar, so not a swatch — a hairline ring says "counted, not stacked". */
  .swatch.none { background: transparent; border: 1px solid var(--muted); }
  .note { margin: 10px 0 0; font-size: 11px; color: var(--text-2); }
</style>
