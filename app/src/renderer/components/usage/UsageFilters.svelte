<script lang="ts">
  /**
   * **One filter row, above everything it scopes.**
   *
   * Never per-panel: every chart, stat and table below this row is drawn from the one
   * `CostAnalytics` these three controls asked for, so two panels on the page cannot come to
   * disagree about which slice they are describing.
   *
   * The export button sits here rather than in the footer because it exports *the ledger*, not
   * the filters — it is the same neighbourhood as the controls, and the confirmation line names
   * the file so nobody has to guess where it went.
   */
  import type { CostBackend } from '../../../shared/cost.js';
  import { BACKEND_LABEL, TIME_RANGES, type RangeValue } from '../../lib/usageview.js';

  let {
    range,
    fileId,
    backend,
    files,
    backends,
    busy = false,
    exporting = false,
    exported = '',
    onchange,
    onexport,
  }: {
    range: RangeValue;
    fileId: string;
    backend: string;
    files: { fileId: string; title: string }[];
    /** Only the backends that actually appear in the ledger — a menu of three where one has ever run is noise. */
    backends: CostBackend[];
    busy?: boolean;
    exporting?: boolean;
    exported?: string;
    onchange: (next: { range: RangeValue; fileId: string; backend: string }) => void;
    onexport: () => void;
  } = $props();
</script>

<div class="filters">
  <label>
    <span>Range</span>
    <select
      value={range}
      onchange={(e) => onchange({ range: e.currentTarget.value as RangeValue, fileId, backend })}
    >
      {#each TIME_RANGES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
    </select>
  </label>

  <label>
    <span>Document</span>
    <select
      value={fileId}
      disabled={files.length === 0}
      onchange={(e) => onchange({ range, fileId: e.currentTarget.value, backend })}
    >
      <option value="">Every document</option>
      {#each files as f (f.fileId)}<option value={f.fileId}>{f.title}</option>{/each}
    </select>
  </label>

  <label>
    <span>Backend</span>
    <select
      value={backend}
      disabled={backends.length < 2}
      onchange={(e) => onchange({ range, fileId, backend: e.currentTarget.value })}
    >
      <option value="">Every backend</option>
      {#each backends as b (b)}<option value={b}>{BACKEND_LABEL[b]}</option>{/each}
    </select>
  </label>

  <span class="spacer"></span>

  {#if busy}<span class="busy" role="status">Reading the ledger…</span>{/if}
  <button type="button" class="btn" disabled={exporting} onclick={onexport}>
    {exporting ? 'Exporting…' : 'Export CSV'}
  </button>
</div>
{#if exported}<p class="exported" role="status">{exported}</p>{/if}

<style>
  .filters {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .spacer { flex: 1 1 auto; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-2); min-width: 0; }
  select {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--pane);
    padding: 6px 8px;
    font: inherit;
    font-size: 12px;
    color: var(--text);
    max-width: 260px;
  }
  select:disabled { color: var(--muted); }
  .busy { font-size: 11.5px; color: var(--text-2); align-self: center; }
  .exported { margin: -8px 0 16px; font-size: 11.5px; color: var(--text-2); }
</style>
