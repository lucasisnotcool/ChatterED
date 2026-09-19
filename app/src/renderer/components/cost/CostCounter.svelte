<script lang="ts">
  /**
   * **What this document has cost**, in the doc header beside the progress bar (#42 item C).
   *
   * Compact by default — one number, tokens, because tokens are the fact — and expanding on click
   * into the breakdown. The header is the tightest row in the app and a recent commit is about
   * exactly that: every item in it must be able to give ground or the buttons end up drawn over
   * the chat column's tabs at 1100px. So the chip is `flex: none` and about six characters wide,
   * and everything it cannot fit is in the popover and the tooltip.
   *
   * **The ingest line is the point.** The two-pass notes ingest, the concept pack and the
   * objectives tree are paid once per deck, before a word is said, and on a forty-slide lecture
   * they are the largest single cost in the app. A learner who sees one total for a deck they
   * opened twice concludes the conversation is expensive, when what they are looking at is mostly
   * a one-off they will never pay again. `ingestSplit` does the sorting, off `isIngestScope` in
   * `shared/cost.ts` — the same constant the analytics SQL groups on, so the two cannot come to
   * disagree about which side `objectives` falls on.
   */
  import { store } from '../../lib/store.svelte.js';
  import {
    compactTokens,
    counterLine,
    counterTitle,
    ingestSplit,
    partHasCost,
    reportedLine,
    scopeRows,
    sliceLine,
  } from '../../lib/cost.js';

  $effect(() => {
    store.ensureFileCost();
  });

  const summary = $derived(store.costFile);
  const on = $derived(store.costOn && summary !== null && summary.calls > 0);

  let open = $state(false);
  let panel = $state<HTMLElement | null>(null);

  const split = $derived(summary ? ingestSplit(summary.byScope) : null);
  const rows = $derived(summary ? scopeRows(summary.byScope, summary.mode) : []);
  const reported = $derived(summary ? reportedLine(summary.reportedUsd) : null);

  /** Esc closes and a click outside closes — the two gestures a popover owes. */
  $effect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (panel && !panel.contains(e.target as Node)) open = false;
    };
    // Deferred, so the click that opened it does not immediately close it again.
    const handle = setTimeout(() => window.addEventListener('mousedown', away), 0);
    return () => {
      clearTimeout(handle);
      window.removeEventListener('mousedown', away);
    };
  });

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    open = false;
  }
</script>

{#if on && summary}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="wrap" bind:this={panel} onkeydown={onkeydown} role="group" aria-label="What this document has cost">
    <button
      type="button"
      class="chip"
      aria-expanded={open}
      title={`${counterLine(summary)}\n${counterTitle(summary)}`}
      onclick={() => (open = !open)}
    >{compactTokens(summary.tokens)}</button>

    {#if open}
      <section class="pop" aria-label="What this document has cost">
        <p class="head">{counterLine(summary)}</p>

        {#if split && partHasCost(split.ingest)}
          <!-- Its own line, above the conversation, because it is a different kind of number:
               paid once, before the learner said anything, and never paid again for this deck. -->
          <div class="split">
            <p class="key">Reading the deck</p>
            <p class="val">{sliceLine(split.ingest, summary.mode)}</p>
            <p class="why">Paid once, when the notes were made. Not paid again.</p>
          </div>
        {/if}

        {#if split && partHasCost(split.conversation)}
          <div class="split">
            <p class="key">Everything since</p>
            <p class="val">{sliceLine(split.conversation, summary.mode)}</p>
            <p class="why">Turns, questions, doc edits and the ledger.</p>
          </div>
        {/if}

        {#if rows.length > 0}
          <dl class="rows">
            {#each rows as row (row.key)}
              <div class="row">
                <dt>{row.label}</dt>
                <dd>{row.detail}</dd>
              </div>
            {/each}
          </dl>
        {/if}

        <p class="note">
          {summary.calls} call{summary.calls === 1 ? '' : 's'} · rate card {summary.rateCardDate}
        </p>
        {#if reported}
          <p class="note">{reported}, the CLI's own accounting — beside the estimate, not added to it.</p>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .wrap { position: relative; flex: none; }

  /* Six characters and a hairline. It never grows with the number, because `compactTokens` caps
     at `1.23M`, and it never takes room the buttons need. */
  .chip {
    font-size: 10px;
    line-height: 1.4;
    color: var(--text-2);
    opacity: 0.8;
    font-variant-numeric: tabular-nums;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 1px 6px;
    white-space: nowrap;
  }
  .chip:hover { opacity: 1; border-color: var(--muted); }

  .pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 6;
    width: 300px;
    max-width: calc(100vw - 32px);
    padding: 10px 12px 9px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgb(27 27 34 / 9%);
  }

  .head { margin: 0 0 8px; font-size: 11px; color: var(--text); font-variant-numeric: tabular-nums; }

  .split { margin: 0 0 8px; }
  .split .key { margin: 0; font-size: 10.5px; font-weight: 600; color: var(--text-2); }
  .split .val { margin: 1px 0 0; font-size: 11px; color: var(--text); font-variant-numeric: tabular-nums; }
  .split .why { margin: 1px 0 0; font-size: 10px; line-height: 1.45; color: var(--muted); }

  .rows { margin: 0; padding: 8px 0 0; border-top: 1px solid var(--hairline); }
  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 1px 0;
    font-size: 10.5px;
    color: var(--text-2);
  }
  .row dt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row dd { flex: none; margin: 0; font-variant-numeric: tabular-nums; }

  .note { margin: 7px 0 0; font-size: 10px; line-height: 1.45; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
