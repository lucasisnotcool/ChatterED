<script lang="ts">
  import { tick } from 'svelte';
  import TutorialOriginalPdf from './TutorialOriginalPdf.svelte';

  let { fileId, open, activated, dragging, width, onclose }: {
    fileId: string;
    open: boolean;
    activated: boolean;
    dragging: boolean;
    width: number;
    onclose: () => void;
  } = $props();
  let closeButton: HTMLButtonElement;

  $effect(() => {
    if (open) void tick().then(() => closeButton?.focus({ preventScroll: true }));
  });
</script>

<aside
  id="tutorial-source-pdf"
  class="source-pdf-drawer"
  class:open
  class:dragging
  style:width={open ? `${width}%` : '0%'}
  aria-label="Source PDF"
  aria-hidden={!open}
  inert={!open}
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }}
>
  <header class="source-pdf-head">
    <strong>Source PDF</strong>
    <button bind:this={closeButton} type="button" aria-label="Close source PDF" title="Close source PDF (Esc)" onclick={onclose}>×</button>
  </header>
  {#if activated}<TutorialOriginalPdf {fileId} />{/if}
</aside>

<style>
  .source-pdf-drawer {
    flex: none;
    box-sizing: border-box;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 0 solid var(--hairline);
    background: var(--pane);
    transition: width 300ms ease;
  }
  .source-pdf-drawer.open { border-right-width: 1px; }
  .source-pdf-drawer.dragging { transition: none; }
  .source-pdf-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 40px;
    padding: 5px 10px 5px 16px;
    border-bottom: 1px solid var(--hairline);
  }
  .source-pdf-head strong { font-size: 13px; }
  .source-pdf-head button { border-radius: 6px; padding: 2px 8px; font-size: 20px; line-height: 1; }
  .source-pdf-head button:hover { background: var(--indigo-tint); color: var(--indigo); }
  .source-pdf-drawer > :global(.original-pdf) { flex: 1 1 auto; min-height: 0; }
  .source-pdf-drawer.dragging > :global(.original-pdf),
  .source-pdf-drawer.dragging :global(iframe) { pointer-events: none; }
  @media (prefers-reduced-motion: reduce) {
    .source-pdf-drawer { transition: none; }
  }
</style>
