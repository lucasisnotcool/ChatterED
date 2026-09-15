<script lang="ts">
  /** One claim row (product-design.md §D2, §D3). Neutral by policy — never an agent hue. */
  import type { LedgerRowView } from '../../shared/types.js';
  import { LEDGER_GLYPH, LEDGER_WORD } from '../lib/labels.js';

  let {
    row,
    animating = false,
    expanded = false,
    ontoggle,
  }: {
    row: LedgerRowView;
    animating?: boolean;
    expanded?: boolean;
    ontoggle: () => void;
  } = $props();
</script>

<div class="row" class:lift={animating} class:empty={row.state === 'not_yet'}>
  <button type="button" class="top" onclick={ontoggle} aria-expanded={expanded}>
    <span class="cid">{row.elementId}</span>
    <span class="label" title={row.label}>{row.learnerLabel}</span>
    <span class="state">
      <span class="glyph" class:cross={animating} aria-hidden="true">{LEDGER_GLYPH[row.state]}</span>
      <span class="word">{LEDGER_WORD[row.state]}</span>
    </span>
  </button>

  {#if row.revisit}
    <span class="revisit">› revisit</span>
  {/if}

  {#if expanded}
    <div class="detail">
      {#if row.evidenceText}
        <div class="quote">
          <span class="you">you said:</span>
          <p>“{row.evidenceText}”</p>
          {#if row.evidenceTurn !== null}<span class="turn">turn {row.evidenceTurn}</span>{/if}
        </div>
      {:else}
        <p class="none">Nothing in your own words on this one yet.</p>
      {/if}
      {#if row.defendedAgainst}
        <p class="defended">{row.defendedAgainst}</p>
      {/if}
      {#if row.openMisconceptions.length > 0}
        <ul class="open">
          {#each row.openMisconceptions as m, i (i)}<li>{m}</li>{/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .row { padding: 7px 0; position: relative; border-radius: 5px; }
  .row.lift { animation: lift 600ms ease-out; }
  @keyframes lift {
    0% { background: rgb(79 70 229 / 4%); }
    100% { background: transparent; }
  }

  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
  }
  .top .label { flex: 1; min-width: 0; }
  /* Two lines, hard. New sessions get short labels from the ingest schema; a session recorded
     before that fix still has a paragraph in `learner_label`, and the rail has to stay
     scannable for it too (product-design.md §D1, ui-review-ux.md B5). The full claim is the
     row's `title`, and the expanded view carries the learner's own words. */
  .label {
    font-size: 12px;
    color: var(--text);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* §B5's own wireframe prints the row id; the round card lists `·C1 ·C2 …` and until now
     nothing in the rail said which row was which (ui-review-ux.md m4). */
  .cid { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
  .empty .label { opacity: 0.6; }

  .state { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
  .glyph { color: var(--glyph); font-size: 13px; }
  .empty .glyph { color: var(--muted); }
  .glyph.cross { animation: fade 400ms ease-out; }
  @keyframes fade {
    0% { opacity: 0.15; }
    100% { opacity: 1; }
  }
  .word { font-size: 11px; color: var(--text-2); }
  .empty .word { color: var(--muted); }

  .revisit { font-size: 10px; color: var(--text-2); }

  .detail { margin-top: 8px; }
  .quote {
    background: var(--ground);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 8px 10px;
  }
  .you { font-size: 10px; color: var(--muted); }
  .quote p { margin: 3px 0 0; font-size: 12px; line-height: 1.5; }
  .turn { display: block; margin-top: 5px; font-size: 10px; color: var(--muted); text-align: right; }
  .defended { margin: 7px 0 0; font-size: 11px; color: var(--text-2); line-height: 1.45; }
  .none { margin: 0; font-size: 11px; color: var(--muted); }
  .open { margin: 6px 0 0; padding-left: 14px; font-size: 11px; color: var(--text-2); }
</style>
