<script lang="ts">
  /** The system card at the top of the thread (design-brief.md §G round card). */
  import type { LedgerView } from '../../shared/types.js';
  import { LEDGER_GLYPH, glyphAlt } from '../lib/labels.js';

  let { title, body, ledger }: { title: string; body: string; ledger: LedgerView } = $props();
</script>

<section class="card">
  <h2 class="label-caps">{title}</h2>
  <p>{body}</p>
  <p class="ledger">
    Ledger:
    {#each ledger.rows as row (row.elementId)}
      <span class="glyph">{LEDGER_GLYPH[row.state]}</span><span class="rid">{row.elementId}</span
      ><span class="sr-only">{glyphAlt(row.state)}</span>
    {/each}
  </p>
</section>

<style>
  .card {
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 16px 18px;
    margin: 0 0 32px;
    max-width: 72ch;
  }
  h2 { margin: 0 0 8px; color: var(--text-2); font-size: 11px; }
  p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text); }
  .ledger { margin-top: 10px; color: var(--text-2); font-size: 12px; }
  .glyph { margin-left: 12px; color: var(--glyph); }
  .rid { margin-left: 4px; }
</style>
