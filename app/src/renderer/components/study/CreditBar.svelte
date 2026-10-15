<script lang="ts">
  /** The study credit as a bar: what is left, filled from the left, amber when low, red when out. */
  import { LOW_CREDIT_FRACTION } from '../../../shared/study.js';

  let { fraction, exhausted, compact = false }: { fraction: number; exhausted: boolean; compact?: boolean } = $props();

  const left = $derived(Math.max(0, Math.min(1, 1 - fraction)));
  const tone = $derived(exhausted ? 'out' : fraction >= LOW_CREDIT_FRACTION ? 'low' : 'ok');
</script>

<span class="bar" class:compact data-tone={tone} role="presentation">
  <span class="fill" style:width="{left * 100}%"></span>
</span>

<style>
  .bar {
    display: block;
    width: 100%;
    height: 8px;
    border-radius: 999px;
    background: var(--hairline);
    overflow: hidden;
  }
  .bar.compact { width: 44px; height: 4px; }
  .fill { display: block; height: 100%; border-radius: inherit; background: var(--indigo); transition: width 0.3s ease; }
  .bar[data-tone='low'] .fill { background: #b45309; }
  .bar[data-tone='out'] { background: #f3d4d4; }
</style>
