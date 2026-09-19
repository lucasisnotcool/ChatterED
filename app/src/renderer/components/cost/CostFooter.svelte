<script lang="ts">
  /**
   * **What this thread has cost**, under the thread (#42 item C).
   *
   * One line, in the same words as every other counter in the app, because `counterLine` and
   * `counterTitle` are where those words live. The doc chat, each span thread and each private
   * thread all mount this with their own anchor; the nesting rule the three levels promise
   * (`thread ≤ file ≤ app`) is something a learner can check by eye across the three surfaces,
   * and that only works while all three are saying it the same way.
   *
   * Nothing is drawn while the summary is missing or empty. A thread nobody has asked a question
   * in has not cost `$0.00` — it has no meter, which is a different statement and the true one.
   */
  import { store } from '../../lib/store.svelte.js';
  import { counterLine, counterTitle } from '../../lib/cost.js';

  let {
    /** `'doc'`, a `span_…` anchor, or a private thread id. Null while the thread is being made. */
    anchorId,
  }: { anchorId: string | null } = $props();

  /**
   * Pulled by the surface that shows it, once. A forty-slide deck has forty threads and eagerly
   * summarising all of them would put forty sqlite reads in front of the learner's first
   * question — `store.ensureThreadCost` is idempotent per thread and keeps itself current on
   * `cost.updated` after that.
   */
  $effect(() => {
    const id = anchorId;
    if (id !== null) store.ensureThreadCost(id);
  });

  const summary = $derived(anchorId === null ? null : (store.costThread[anchorId] ?? null));
  const on = $derived(store.costOn && summary !== null && summary.calls > 0);
</script>

{#if on && summary}
  <p class="foot" title={counterTitle(summary)}>{counterLine(summary)}</p>
{/if}

<style>
  .foot {
    margin: 6px 0 0;
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-2);
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
  }
  .foot:hover { opacity: 1; }
</style>
