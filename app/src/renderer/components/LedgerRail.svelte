<script lang="ts">
  /** The ledger rail (product-design.md §B5, §D1–D3). Layers 3 and 4 are recap-only. */
  import type { LedgerView } from '../../shared/types.js';
  import { untrack } from 'svelte';
  import { BLOOM_RUNGS, LEDGER_GLYPH, glyphAlt } from '../lib/labels.js';
  import { store } from '../lib/store.svelte.js';
  import LedgerRow from './LedgerRow.svelte';

  let { ledger, compact = false }: { ledger: LedgerView; compact?: boolean } = $props();

  /**
   * **A room can exist before its concept pack does** (issue #35, `main/pack.ts`).
   *
   * The first Ask creates the room straight away and the deck's concepts are drafted in the
   * background, so for the first few seconds there is genuinely nothing to list. The rail used
   * to render that as `0 of 0` over an empty box, which reads as "this deck has no concepts" —
   * a claim about the document — rather than "we have not read it yet". `pack.ready` carries
   * the rebuilt ledger and `store.apply` puts it straight on the room, so this state clears
   * itself the moment the pack lands; nothing here polls and nothing has to be told twice.
   */
  const pending = $derived(ledger.total === 0 && ledger.rows.length === 0);

  let expandedId = $state<string | null>(null);
  let animating = $state<string[]>([]);
  let lastToken = 0;

  /** §D3: 400 ms cross-fade, 4% lift settling by 600 ms, staggered 120 ms top-down.
   *  Nothing animates while the rail is hidden — the pulse is not even recorded. */
  $effect(() => {
    const pulse = store.ledgerPulse;
    if (pulse.token === 0 || pulse.token === lastToken) return;
    lastToken = pulse.token;
    if (compact || store.ledgerHidden) return;
    const order = untrack(() => ledger.rows.map((r) => r.elementId)).filter((id) =>
      pulse.ids.includes(id),
    );
    const timers: ReturnType<typeof setTimeout>[] = [];
    order.forEach((id, i) => {
      timers.push(
        setTimeout(() => {
          animating = [...animating, id];
          timers.push(
            setTimeout(() => {
              animating = animating.filter((x) => x !== id);
            }, 600),
          );
        }, i * 120),
      );
    });
    return () => timers.forEach(clearTimeout);
  });
</script>

{#if compact || store.ledgerHidden}
  <button
    class="strip"
    type="button"
    onclick={() => (store.ledgerHidden = false)}
    aria-label="Show the ledger"
  >
    {#each ledger.rows as row (row.elementId)}
      <span class="sglyph">{LEDGER_GLYPH[row.state]}</span>
      <span class="sr-only">{row.learnerLabel}: {glyphAlt(row.state)}</span>
    {/each}
  </button>
{:else}
  <aside class="rail" aria-label="Your explanation so far">
    <header>
      <h2>Your explanation so far</h2>
      {#if !pending}
        <span class="count">{ledger.covered} of {ledger.total}</span>
      {/if}
    </header>
    <hr class="hairline" />

    <div class="rows">
      {#if pending}
        <p class="empty" role="status">
          No concepts yet — still reading this document. They appear here as soon as it has been
          read, and only your own words ever move one.
        </p>
      {:else}
        {#each ledger.rows as row (row.elementId)}
          <LedgerRow
            {row}
            animating={animating.includes(row.elementId)}
            expanded={expandedId === row.elementId}
            ontoggle={() => (expandedId = expandedId === row.elementId ? null : row.elementId)}
          />
        {/each}
      {/if}
    </div>

    <hr class="hairline" />
    <p class="bloom">
      {#each BLOOM_RUNGS as rung, i (rung)}{#if i > 0}<span class="sep"> ▸ </span>{/if}<span
          class:now={rung === ledger.bloom}>{rung}</span
        >{/each}
    </p>

    <footer>
      <span class="honesty">ⓘ your words, not a score</span>
      <button type="button" onclick={() => (store.ledgerHidden = true)}>[hide]</button>
    </footer>
  </aside>
{/if}

<style>
  .rail {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
    padding: 16px 16px 12px;
    overflow-y: auto;
  }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h2 { margin: 0; font-size: 12px; font-weight: 600; color: var(--text); }
  .count { font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .hairline { margin: 10px 0; }
  .rows { flex: 1; }
  .empty { margin: 2px 0 0; font-size: 11.5px; line-height: 1.55; color: var(--muted); }

  .bloom { margin: 4px 0 0; font-size: 11px; color: var(--muted); line-height: 1.6; }
  .bloom .now { color: var(--text); font-weight: 600; }
  .sep { color: var(--muted); }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 14px;
  }
  .honesty { font-size: 10px; color: var(--muted); line-height: 1.4; }
  footer button { font-size: 10px; color: var(--muted); }
  footer button:hover { color: var(--text-2); }

  .strip {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 40px;
    height: 100%;
    padding-top: 18px;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
  }
  .sglyph { color: var(--glyph); font-size: 13px; }
</style>
