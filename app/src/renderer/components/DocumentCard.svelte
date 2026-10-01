<script lang="ts">
  /**
   * The compact document card a "Show the room" message carries (issue #22 decision 4).
   *
   * The precedent is product-design.md §C6 L872 — the one existing source reference in the
   * transcript, "Your slide (p. 31) says X — going with that", whose click target scrolls the
   * source pane. So: neutral, system-styled, carries a page reference. Since #58 the vault it
   * opened into is gone, so the card names the file and the pages and opens nothing: a card from
   * an old room still reads, and nothing on it promises a place it cannot go. It is deliberately *not* a bubble variant and not a tinted nudge card
   * (§C5 L796 forbids inventing a second such pattern), and it grows no action chips, because
   * §B3 L359 rules out anything in the transcript that produces an agent turn.
   *
   * It does not show the page text. The agents were given it; the learner has the file. Printing
   * a slide back at them would make this a paste, and the whole point is that it is not one.
   */
  import type { MessageReferenceView } from '../../shared/types.js';
  import { KIND_GLYPH } from '../lib/labels.js';

  let { reference }: { reference: MessageReferenceView } = $props();

  const where = $derived(
    reference.pageFrom !== null && reference.pageTo !== null
      ? reference.pageFrom === reference.pageTo
        ? `p. ${reference.pageFrom}`
        : `pp. ${reference.pageFrom}–${reference.pageTo}`
      : null,
  );

  let expanded = $state(false);
  const LONG = 160;
  const selection = $derived(reference.selection?.trim() ?? '');
  const clipped = $derived(selection.length > LONG && !expanded ? `${selection.slice(0, LONG)}…` : selection);

</script>

<div class="doccard">
  <div class="head" title={reference.relPath}>
    <span class="glyph" aria-hidden="true">{KIND_GLYPH[reference.kind]}</span>
    <span class="name">{reference.fileName}</span>
    {#if where}<span class="page">{where}</span>{/if}
  </div>

  {#if selection.length > 0}
    <p class="quote">{clipped}</p>
    {#if selection.length > LONG}
      <button type="button" class="more" onclick={() => (expanded = !expanded)}>
        {expanded ? 'Show less' : 'Show all'}
      </button>
    {/if}
  {/if}
</div>

<style>
  /* Neutral by construction: §C2 rule 2 keeps agent hues off backgrounds, rule 3 keeps indigo
     for the learner's own utterances and for primary actions. A reference card is neither. */
  .doccard {
    margin-top: 8px;
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--glyph);
    border-radius: 6px;
    background: var(--pane);
    padding: 8px 12px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
  }
  .glyph { color: var(--muted); font-size: 11px; }
  .name { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .page { font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }

  .quote {
    margin: 7px 0 0;
    padding-left: 9px;
    border-left: 2px solid var(--hairline);
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .more { margin-top: 5px; font-size: 11px; color: var(--text-2); }
  .more:hover { color: var(--indigo); }
</style>
