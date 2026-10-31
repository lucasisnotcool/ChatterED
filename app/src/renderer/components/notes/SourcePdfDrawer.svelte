<script lang="ts">
  import { tick } from 'svelte';
  import TutorialOriginalPdf from './TutorialOriginalPdf.svelte';

  let { fileId, open, onclose }: { fileId: string; open: boolean; onclose: () => void } = $props();
  let closeButton: HTMLButtonElement;

  $effect(() => {
    if (open) void tick().then(() => closeButton?.focus({ preventScroll: true }));
  });
</script>

<aside
  id="tutorial-source-pdf"
  class="source-pdf-drawer"
  class:open
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
  <TutorialOriginalPdf {fileId} />
</aside>

<style>
  .source-pdf-drawer {
    position: absolute;
    z-index: 12;
    inset: 0 0 0 auto;
    width: min(480px, calc(100% - 24px));
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--hairline);
    background: var(--pane);
    box-shadow: -16px 0 36px rgb(20 20 40 / 16%);
    visibility: hidden;
    transform: translateX(100%);
    transition: transform 180ms ease, visibility 180ms;
  }
  .source-pdf-drawer.open { visibility: visible; transform: translateX(0); }
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
  @media (prefers-reduced-motion: reduce) {
    .source-pdf-drawer { transition: none; }
  }
</style>
