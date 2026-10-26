<script lang="ts">
  import { untrack } from 'svelte';
  import { bridge } from '../../lib/bridge.js';
  import * as pdfjs from 'pdfjs-dist';
  import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
  import PdfViewer from '../PdfViewer.svelte';

  let { fileId, name, onquestions }: { fileId: string; name: string; onquestions?: (questions: number[]) => void } = $props();
  let bytes = $state<Uint8Array | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let revision = $state(0);

  $effect(() => {
    const id = fileId;
    void revision;
    let cancelled = false;
    bytes = null;
    untrack(() => onquestions?.([]));
    error = null;
    loading = true;
    void bridge().openDocument({ fileId: id }).then((view) => {
      if (cancelled) return;
      if (!view.bytes || view.ext.toLowerCase().replace(/^\./, '') !== 'pdf') throw new Error('This tutorial has no PDF to display.');
      bytes = view.bytes;
      loading = false;
      void findQuestions(view.bytes).then((questions) => { if (!cancelled) onquestions?.(questions); });
    }).catch((cause: unknown) => {
      if (cancelled) return;
      error = cause instanceof Error ? cause.message : 'Could not open the original PDF.';
      loading = false;
    });
    return () => { cancelled = true; };
  });

  async function findQuestions(source: Uint8Array): Promise<number[]> {
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({ data: new Uint8Array(source) });
      const pdf = await task.promise;
      // Local to one asynchronous extraction; it is not renderer state.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const found = new Set<number>();
      try {
        for (let page = 1; page <= Math.min(pdf.numPages, 30); page += 1) {
          const text = await (await pdf.getPage(page)).getTextContent();
          const words = text.items.map((item) => 'str' in item ? item.str : '').join(' ');
          for (const match of words.matchAll(/\b(?:question|problem|q)\s*\.?\s*(\d{1,2})\b/gi)) {
            const number = Number(match[1]);
            if (number > 0 && number <= 99) found.add(number);
          }
        }
      } finally {
        await task.destroy();
      }
      return [...found].sort((a, b) => a - b);
    } catch {
      return [];
    }
  }
</script>

<section class="original-pdf" aria-label="Original tutorial PDF">
  <header><span>Original tutorial PDF</span><small title={name}>{name}</small></header>
  {#if loading}
    <p class="state" role="status">Opening PDF…</p>
  {:else if error}
    <div class="state" role="alert"><p>{error}</p><button type="button" onclick={() => revision += 1}>Try again</button></div>
  {:else if bytes}
    <PdfViewer {bytes} initialFit="width" />
  {/if}
</section>

<style>
  .original-pdf { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #e8eef0; }
  header { height: 43px; padding: 8px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--hairline); background: var(--ground); }
  header span { font-family: var(--font-display, Georgia, serif); font-size: 17px; white-space: nowrap; }
  header small { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
  .state { margin: auto; padding: 20px; text-align: center; color: var(--text-2); }
  .state button { color: var(--indigo); font-weight: 600; }
</style>
