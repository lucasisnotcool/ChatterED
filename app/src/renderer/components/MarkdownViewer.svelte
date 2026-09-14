<script lang="ts">
  /**
   * Markdown with maths (issue #22 decision 3). NUSSync renders LaTeX and a module like MA3236
   * is unreadable without it, so `$…$` and `$$…$$` go through KaTeX.
   *
   * The HTML is produced by `lib/markdown.ts`, which drops raw HTML from the source rather than
   * rendering it and turns links and images into inert text. That is what makes `{@html}` safe
   * here: every tag in the string was written by us, none of it came out of the file.
   */
  import { headings, renderMarkdown } from '../lib/markdown.js';

  let { source }: { source: string } = $props();

  const html = $derived(renderMarkdown(source));
  const outline = $derived(headings(source).filter((h) => h.depth <= 3));

  let body = $state<HTMLDivElement | null>(null);

  function jump(id: string): void {
    body?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
</script>

<div class="wrap">
  {#if outline.length > 2}
    <nav class="outline" aria-label="Outline">
      {#each outline as h (h.id + h.text)}
        <button type="button" class="jump" style="padding-left: {(h.depth - 1) * 10 + 10}px" onclick={() => jump(h.id)}>
          {h.text}
        </button>
      {/each}
    </nav>
  {/if}
  <div class="scroll" bind:this={body}>
    <!-- lib/markdown.ts drops raw HTML from the source rather than rendering it, escapes code
         and link targets, and renders maths through KaTeX. Every tag in this string was written
         by us; none of it came out of the file. -->
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <article class="md">{@html html}</article>
  </div>
</div>

<style>
  .wrap { display: flex; min-height: 0; height: 100%; }

  .outline {
    flex: none;
    width: 176px;
    border-right: 1px solid var(--hairline);
    overflow-y: auto;
    padding: 12px 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .jump {
    text-align: left;
    font-size: 11px;
    color: var(--text-2);
    padding: 3px 8px;
    border-radius: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .jump:hover { background: var(--ground); color: var(--text); }

  .scroll { flex: 1; overflow: auto; min-height: 0; padding: 20px 28px 60px; }
  .md { max-width: 72ch; font-size: 14px; line-height: 1.7; }

  .md :global(h1) { font-size: 20px; margin: 0 0 14px; }
  .md :global(h2) { font-size: 16px; margin: 28px 0 10px; }
  .md :global(h3) { font-size: 14px; margin: 22px 0 8px; }
  .md :global(p) { margin: 0 0 14px; }
  .md :global(ul), .md :global(ol) { margin: 0 0 14px; padding-left: 22px; }
  .md :global(li) { margin: 0 0 6px; }
  .md :global(blockquote) {
    margin: 0 0 14px;
    padding-left: 14px;
    border-left: 3px solid var(--hairline);
    color: var(--text-2);
  }
  .md :global(hr) { border: 0; border-top: 1px solid var(--hairline); margin: 24px 0; }
  .md :global(code) {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.88em;
    background: var(--ground);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .md :global(pre.code) {
    background: var(--ground);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 12px 14px;
    overflow-x: auto;
    margin: 0 0 14px;
  }
  .md :global(pre.code code) { background: none; padding: 0; font-size: 12px; line-height: 1.6; }
  .md :global(table) { border-collapse: collapse; margin: 0 0 14px; font-size: 13px; }
  .md :global(th), .md :global(td) { border: 1px solid var(--hairline); padding: 5px 9px; text-align: left; }
  .md :global(.dead-link) { color: var(--text); border-bottom: 1px dotted var(--muted); cursor: help; }
  .md :global(.dead-image) { color: var(--muted); font-size: 12px; }
  .md :global(.math-display) { overflow-x: auto; margin: 0 0 16px; }
  .md :global(.math-error) { color: var(--text-2); }
</style>
