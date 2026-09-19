<script lang="ts">
  /**
   * A stat tile. The dataviz contract: label (sentence case, no trailing colon), value, and an
   * optional line under it.
   *
   * **No `tabular-nums` on the value.** Equal-width digits are for columns that have to line up
   * vertically; on a standalone figure they make `121` look loose. The tables on this page use
   * them, these do not.
   */
  let {
    label,
    value,
    sub = '',
    hero = false,
    title = '',
  }: { label: string; value: string; sub?: string; hero?: boolean; title?: string } = $props();
</script>

<div class="stat" class:hero {title}>
  <span class="label">{label}</span>
  <span class="value">{value}</span>
  {#if sub}<span class="sub">{sub}</span>{/if}
</div>

<style>
  .stat { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .label { font-size: 11px; color: var(--text-2); }
  .value { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; }
  .hero .value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
  .sub { font-size: 11.5px; color: var(--text-2); }
</style>
