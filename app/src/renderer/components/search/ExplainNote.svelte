<script lang="ts">
  /**
   * **A hit's stored explain** (migration 033) on the search page: the badge, and the text it
   * expands to. What Ellie would answer to Explain on that line, written ahead of time, so it reads
   * with no network (the search page is the main way in during an open-book exam).
   *
   * The body is the chat's closed markup subset, typeset by `aitext.ts` (KaTeX for `$…$`); it
   * escapes everything else, so the `@html` below can only ever hold that subset.
   */
  import { paragraphs } from '../../lib/aitext.js';

  let {
    body,
    via = false,
    open = $bindable(false),
    variant = 'row',
  }: {
    body: string;
    /** The hit was matched through this explain: say so on the badge. */
    via?: boolean;
    open?: boolean;
    /** `row`: inside a hit (the click must not pick or open the hit). `panel`: the notes column. */
    variant?: 'row' | 'panel';
  } = $props();

  const html = $derived(open ? paragraphs(body) : '');

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    open = !open;
  }
</script>

<div class="xn" class:panel={variant === 'panel'}>
  <button
    type="button"
    class="xn-badge"
    class:on={open}
    aria-expanded={open}
    title={open ? 'Hide Ellie’s explanation' : 'Show Ellie’s explanation (saved, works offline)'}
    onclick={toggle}
    ondblclick={(e) => e.stopPropagation()}
  >
    <span class="xn-dot" aria-hidden="true"></span>
    <span>{via ? 'Matched Ellie’s explanation' : 'Ellie explains'}</span>
    <span class="xn-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
  </button>
  {#if open}
    <!-- Selecting text here must not pick the hit. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="xn-body" onclick={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html html}
    </div>
  {/if}
</div>

<style>
  .xn { display: grid; gap: 4px; min-width: 0; }
  .xn-badge {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 1px 8px;
    background: var(--pane);
    color: var(--text-2);
    font-size: 11px;
    line-height: 1.5;
    cursor: pointer;
  }
  .xn-badge:hover,
  .xn-badge.on { color: var(--text); border-color: var(--nd-ellie, #0f7b6c); }
  .xn-badge:focus-visible { outline: 2px solid var(--indigo); outline-offset: 1px; }
  .xn-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--nd-ellie, #0f7b6c); flex: none; }
  .xn-caret { font-size: 9px; }
  .xn-body {
    border-left: 2px solid var(--nd-ellie, #0f7b6c);
    padding: 2px 0 2px 9px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text);
    cursor: text;
    user-select: text;
    overflow-x: auto;
  }
  .panel .xn-body { font-size: 13px; max-height: 40vh; overflow-y: auto; }
  .xn-body :global(:is(p, ul, ol)) { margin: 0 0 5px; }
  .xn-body :global(:is(ul, ol)) { padding-left: 18px; }
  .xn-body :global(> :last-child) { margin-bottom: 0; }
</style>
