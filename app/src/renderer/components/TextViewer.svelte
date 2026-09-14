<script lang="ts">
  /**
   * Plain text and source code (issue #22 decision 3). Code gets highlight.js; text does not,
   * because auto-detecting a language in a set of lecture notes produces confident nonsense.
   */
  import { highlightSource } from '../lib/markdown.js';

  let { text, ext, code }: { text: string; ext: string; code: boolean } = $props();

  const html = $derived(code ? highlightSource(text, ext) : '');
  const lines = $derived(text.split('\n').length);
</script>

<div class="wrap">
  <div class="bar"><span class="meta">{lines} {lines === 1 ? 'line' : 'lines'}{code ? ` · ${ext}` : ''}</span></div>
  <div class="scroll">
    {#if code}
      <!-- highlight.js output only: every tag was produced by hljs, and the file's own text is
           escaped by hljs before it is wrapped. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <pre class="src"><code class="hljs">{@html html}</code></pre>
    {:else}
      <pre class="src plain">{text}</pre>
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { flex: none; padding: 6px 14px; border-bottom: 1px solid var(--hairline); }
  .meta { font-size: 11px; color: var(--muted); }
  .scroll { flex: 1; overflow: auto; min-height: 0; padding: 16px 20px 40px; }
  .src {
    margin: 0;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
  }
  .src.plain { font-family: var(--font); font-size: 13px; line-height: 1.7; max-width: 78ch; }
</style>
