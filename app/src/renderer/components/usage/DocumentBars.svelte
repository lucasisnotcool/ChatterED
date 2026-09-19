<script lang="ts">
  /**
   * **Which documents cost the most, and how much of that was the one-off.**
   *
   * A stacked horizontal bar per document, because the panel has two jobs at once: rank the decks
   * against each other (bar length, scaled to the largest row) and show the setup/conversation
   * split inside each one. Horizontal because the categories are filenames — long, and unreadable
   * rotated under a column.
   *
   * The split is the point (`shared/cost.ts` `INGEST_SCOPES`): the two-pass notes ingest, the
   * concept pack and the objectives tree are paid **once per deck, before a word is said**, and a
   * ranked list that did not separate them would be a list of which decks were opened.
   *
   * Identity never rests on colour: a legend names both series, and every row repeats the split
   * as text under its bar. The `<title>` and the visually-hidden table carry the same numbers for
   * a reader who gets none of the pixels.
   */
  import { tokensLabel } from '../../lib/cost.js';
  import {
    BAR_RADIUS,
    BAR_THICK,
    DOC_SEGMENT_LABEL,
    barPath,
    callsWord,
    docBars,
    pct,
    type DocBars,
  } from '../../lib/usageview.js';
  import type { CostDocumentRow } from '../../../shared/cost.js';

  let { rows }: { rows: CostDocumentRow[] } = $props();

  let width = $state(0);
  const bars = $derived<DocBars>(docBars(rows, width));
</script>

<div class="legend">
  <span class="key"><span class="swatch s1"></span>{DOC_SEGMENT_LABEL.ingest}</span>
  <span class="key"><span class="swatch s2"></span>{DOC_SEGMENT_LABEL.conversation}</span>
</div>

<div class="rows" bind:clientWidth={width}>
  {#each bars.rows as row (row.fileId)}
    <div class="row">
      <div class="head">
        <span class="title" title={row.title}>{row.title}</span>
        <span class="total">{tokensLabel(row.tokens)}</span>
      </div>
      {#if width > 0}
        <svg class="bar" width={width} height={BAR_THICK} viewBox="0 0 {width} {BAR_THICK}" role="img">
          <title>{row.summary}</title>
          {#each row.segments as seg (seg.key)}
            <path
              class={seg.key === 'ingest' ? 's1' : 's2'}
              d={barPath(seg.x, 0, seg.w, BAR_THICK, seg.round ? BAR_RADIUS : 0)}
            />
          {/each}
        </svg>
      {/if}
      <p class="split">
        {DOC_SEGMENT_LABEL.ingest} {pct(row.ingestShare)} · {tokensLabel(row.ingestTokens)} —
        {DOC_SEGMENT_LABEL.conversation} {tokensLabel(row.conversationTokens)} — {callsWord(row.calls)}
      </p>
    </div>
  {/each}
</div>

{#if bars.hidden}
  <p class="folded">
    {bars.hidden.count} more {bars.hidden.count === 1 ? 'document' : 'documents'}, {tokensLabel(bars.hidden.tokens)} tokens
    between them.
  </p>
{/if}

<table class="sr-only">
  <caption>Documents by tokens, with the setup and conversation split</caption>
  <thead>
    <tr><th>Document</th><th>Tokens</th><th>Setup</th><th>Conversation</th><th>Calls</th></tr>
  </thead>
  <tbody>
    {#each bars.rows as row (row.fileId)}
      <tr>
        <td>{row.title}</td>
        <td>{tokensLabel(row.tokens)}</td>
        <td>{tokensLabel(row.ingestTokens)} ({pct(row.ingestShare)})</td>
        <td>{tokensLabel(row.conversationTokens)}</td>
        <td>{row.calls}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .legend { display: flex; gap: 16px; margin: 0 0 12px; font-size: 11.5px; color: var(--text-2); }
  .key { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .swatch.s1 { background: var(--series-1); }
  .swatch.s2 { background: var(--series-2); }

  .rows { display: flex; flex-direction: column; gap: 14px; }
  .row { min-width: 0; }
  .head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 5px; }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .total { flex: none; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--text-2); }
  .bar { display: block; }
  path.s1 { fill: var(--series-1); }
  path.s2 { fill: var(--series-2); }
  .split { margin: 5px 0 0; font-size: 11px; color: var(--text-2); }
  .folded { margin: 14px 0 0; font-size: 11.5px; color: var(--text-2); }
</style>
