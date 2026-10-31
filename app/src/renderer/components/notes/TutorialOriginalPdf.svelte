<script lang="ts">
  import { bridge } from '../../lib/bridge.js';
  import PdfViewer from '../PdfViewer.svelte';

  let { fileId }: { fileId: string } = $props();
  let bytes = $state<Uint8Array | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let revision = $state(0);

  $effect(() => {
    const id = fileId;
    void revision;
    let cancelled = false;
    bytes = null;
    error = null;
    loading = true;
    void bridge().openDocument({ fileId: id }).then((view) => {
      if (cancelled) return;
      if (!view.bytes || view.ext.toLowerCase().replace(/^\./, '') !== 'pdf') throw new Error('This tutorial has no PDF to display.');
      bytes = view.bytes;
      loading = false;
    }).catch((cause: unknown) => {
      if (cancelled) return;
      error = cause instanceof Error ? cause.message : 'Could not open the original PDF.';
      loading = false;
    });
    return () => { cancelled = true; };
  });

</script>

<section class="original-pdf" aria-label="Original tutorial PDF">
  {#if loading}
    <p class="state" role="status">Opening PDF…</p>
  {:else if error}
    <div class="state" role="alert"><p>{error}</p><button type="button" onclick={() => revision += 1}>Try again</button></div>
  {:else if bytes}
    <PdfViewer {bytes} initialFit="width" minimal />
  {/if}
</section>

<style>
  .original-pdf { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #e8eef0; }
  .state { margin: auto; padding: 20px; text-align: center; color: var(--text-2); }
  .state button { color: var(--indigo); font-weight: 600; }
</style>
