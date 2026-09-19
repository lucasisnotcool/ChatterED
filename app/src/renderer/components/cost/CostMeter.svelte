<script lang="ts">
  /**
   * **What this one reply cost** (#42 item C, the level that did not exist before).
   *
   * The three counters that shipped with #41 are sums over a *filter* — a thread, a document,
   * everything. This one is a sum over a **causal set**: the orchestrator decision that chose the
   * speaker, the ledger coding of the message it answered, the generation itself, and the doc-edit
   * planner that ran beside it. Five calls, one card on screen, one number under it.
   *
   * ──────────────────────────────────────────────────────────────────────────────────────────
   * ALWAYS ON, NOT ON HOVER — the one design decision in this file
   * ──────────────────────────────────────────────────────────────────────────────────────────
   *
   * The `.meta` line this sits under fades in on hover, and copying that was the obvious move.
   * It is the wrong one. The ask in #42 is that cost be **visible**, and a number that only
   * exists while the pointer happens to be over a card is a number nobody finds — least of all
   * the learner who has just been told the app is expensive and wants to check. Hover is right
   * for *latency*, which is a debugging fact about a turn that has already been read; it is wrong
   * for *what you are spending*, which is the thing the learner is supposed to be able to watch.
   *
   * So it is on, always, and the quiet comes from everywhere else: 10px, one line, no rule above
   * it, no badge, no colour, tabular figures so a column of them does not jitter. It is louder
   * than nothing and quieter than the timestamp, which is exactly where it belongs.
   *
   * A message with **no row in the map renders nothing at all** — not a zero. Every learner
   * block, every rule-written hand-off line and every message recorded before migration 021 is
   * in that case, and `0 tok` under a model-written turn is a lie while under a rule-written one
   * it is a distraction (`CostMessageCost`'s docstring).
   */
  import { store } from '../../lib/store.svelte.js';
  import { failedClause, meterLine, meterTitle, msLabel, reportedLine, scopeRows } from '../../lib/cost.js';

  let {
    /** `messages.id`, or the whisper turn id inside a private thread. */
    messageId,
  }: { messageId: string } = $props();

  const cost = $derived(store.costMessages[messageId] ?? null);
  /** Off with the ledger, off with the Settings toggle, and off for a message with no row. */
  const on = $derived(store.costOn && store.showMessageCost && cost !== null);

  let open = $state(false);

  const rows = $derived(cost ? scopeRows(cost.byScope, cost.mode) : []);
  const latency = $derived(cost ? msLabel(cost.ms) : null);
  const reported = $derived(cost ? reportedLine(cost.reportedUsd) : null);
  const failed = $derived(cost ? failedClause(cost.failedCalls) : null);
  const callWord = $derived(cost ? `${cost.calls} call${cost.calls === 1 ? '' : 's'}` : '');
</script>

{#if on && cost}
  <div class="meter">
    <button
      type="button"
      class="line"
      aria-expanded={open}
      title={meterTitle(cost)}
      onclick={() => (open = !open)}
    >
      <span class="fig">{meterLine(cost)}</span>
      <span class="twist" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
    </button>

    {#if open}
      <!-- The breakdown. `byScope` arrives biggest-first from the join, and the wording is
           `COST_SCOPE_LABEL`'s so this panel and the Usage page cannot name the same row
           differently. -->
      <dl class="rows">
        {#each rows as row (row.key)}
          <div class="row">
            <dt>{row.label}</dt>
            <dd>{row.detail}</dd>
          </div>
        {/each}
      </dl>

      <p class="aside">
        {[cost.models.join(', '), latency, callWord].filter(Boolean).join(' · ')}
      </p>

      {#if reported}
        <!-- Side by side, never summed: the two figures disagreed by ~1.7× on the one measurement
             in `segmentation-cost.md` §UNVERIFIED 6, and adding them would invent a third. -->
        <p class="aside">{reported} — its own figure, not added to the one above.</p>
      {/if}

      {#if failed}
        <p class="aside">{failed}</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .meter { margin-top: 5px; }

  .line {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 0;
    font-size: 10px;
    line-height: 1.4;
    color: var(--text-2);
    /* Quiet at rest and legible at rest — 0.75 of --text-2 on --pane is ~3.9:1, which is small
       grey text you can read rather than small grey text you can see. It goes to full on hover,
       the way the timestamp beside it does. */
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  .line:hover { opacity: 1; }
  .twist { font-size: 8px; color: var(--muted); }

  .rows { margin: 5px 0 0; padding: 0; }
  /* The detail wraps to its own line rather than eating the label: in a 340px column a scope
     with a long figure beside it would otherwise ellipsis the one word that says what it was. */
  .row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 10px;
    padding: 1px 0;
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-2);
  }
  .row dt { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row dd { flex: 0 1 auto; margin: 0 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; }

  .aside {
    margin: 4px 0 0;
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-2);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
</style>
