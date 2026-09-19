<script lang="ts">
  /**
   * One card on the Usage page: a title, an optional line saying what it is measuring, and the
   * thing itself. Hairline, white, generous padding — the register Settings already set.
   *
   * The empty state is the panel's own job rather than every caller's, because a panel that
   * renders nothing at all when its slice is empty leaves a hole in the grid that reads as a
   * loading failure.
   */
  import type { Snippet } from 'svelte';

  let {
    title,
    note = '',
    empty = null,
    wide = false,
    children,
  }: {
    title: string;
    note?: string;
    /** When set, this is shown instead of the content — the panel has no rows to draw. */
    empty?: string | null;
    wide?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="panel" class:wide>
  <h2>{title}</h2>
  {#if note}<p class="note">{note}</p>{/if}
  {#if empty}
    <p class="empty">{empty}</p>
  {:else}
    {@render children()}
  {/if}
</section>

<style>
  .panel {
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 16px 18px 18px;
    min-width: 0;
  }
  .wide { grid-column: 1 / -1; }
  h2 {
    margin: 0 0 4px;
    font-size: 11px;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.08em;
    font-weight: 600;
    color: var(--text-2);
  }
  .note { margin: 0 0 12px; font-size: 11.5px; line-height: 1.55; color: var(--text-2); max-width: 62ch; }
  /* A full-width panel gets a longer measure: three short ragged lines under a 1,300 px card
     reads as a column that lost its layout. */
  .wide .note { max-width: 96ch; }
  .empty { margin: 8px 0 2px; font-size: 12px; color: var(--text-2); }
</style>
