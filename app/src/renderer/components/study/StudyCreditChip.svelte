<script lang="ts">
  /**
   * The study credit in the title bar: always visible on a study build once the code is in, so the
   * participant is never surprised by running out. Opens Settings, where the full numbers are.
   */
  import { store } from '../../lib/store.svelte.js';
  import { study } from '../../lib/studystore.svelte.js';
  import { usd } from '../../../shared/study.js';
  import CreditBar from './CreditBar.svelte';

  const s = $derived(study.status);
  const label = $derived(s.exhausted ? 'Credit used up' : `${usd(s.remainingUsd)} left`);
</script>

{#if study.showCredit}
  <button
    type="button"
    class="chip no-drag"
    class:out={s.exhausted}
    title="Study API credit: {usd(s.spentUsd)} of {usd(s.budgetUsd)} used (the app's estimate). Click for details."
    onclick={() => void store.openSettings()}
  >
    <CreditBar fraction={s.fraction} exhausted={s.exhausted} compact />
    <span>{label}</span>
  </button>
{/if}

<style>
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-right: 10px;
    padding: 2px 9px;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-2);
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .chip:hover { color: var(--indigo); border-color: var(--indigo); }
  .chip.out { color: #b91c1c; border-color: #f3d4d4; }
</style>
