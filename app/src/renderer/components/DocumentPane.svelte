<script lang="ts">
  /**
   * The document pane (issue #22 decision 3): one viewer per kind, and a "no viewer" card with
   * Reveal in Finder for everything else. No Quick Look — the decision was in-app viewers.
   *
   * The pane owns the state a reference needs: which file is open, which page the learner is
   * looking at, which range they marked, and what they last selected. "Show the room" (stage e)
   * reads exactly that, which is why it lives here and not in the room.
   */
  import type { DocumentView } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import ImageViewer from './ImageViewer.svelte';
  import MarkdownViewer from './MarkdownViewer.svelte';
  import PdfViewer from './PdfViewer.svelte';
  import TextViewer from './TextViewer.svelte';

  let { doc, onclose }: { doc: DocumentView; onclose: () => void } = $props();

  let pdf = $state<ReturnType<typeof PdfViewer> | null>(null);
  let paneEl = $state<HTMLElement | null>(null);

  /**
   * One selection listener for every viewer, on the document rather than on each pane.
   * `selectionchange` also fires for a keyboard selection, which a mouseup handler misses, and
   * it keeps the viewers free of an `onselection` prop they would otherwise all have to thread.
   */
  function onselectionchange(): void {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    if (!selection || !anchor || !paneEl?.contains(anchor)) return;
    const text = selection.toString();
    if (text.trim().length > 0) store.docSelection = text;
  }

  // Re-opening a different file must not carry the last one's page or selection across.
  $effect(() => {
    const id = doc.fileId;
    store.docPage = 1;
    store.docFrom = null;
    store.docTo = null;
    store.docSelection = '';
    return () => void id;
  });

  $effect(() => {
    const page = store.pendingPage;
    if (page !== null && doc.kind === 'pdf' && pdf) {
      store.pendingPage = null;
      pdf.goTo(page);
    }
  });

  const sizeLabel = $derived(
    doc.size < 1024
      ? `${doc.size} B`
      : doc.size < 1024 * 1024
        ? `${Math.round(doc.size / 1024)} KB`
        : `${(doc.size / 1048576).toFixed(1)} MB`,
  );
</script>

<svelte:document {onselectionchange} />

<section class="pane" aria-label="Document" bind:this={paneEl}>
  <header class="head">
    <span class="name" title={doc.relPath}>{doc.name}</span>
    <span class="meta">{sizeLabel}{doc.pageCount ? ` · ${doc.pageCount} pages` : ''}</span>
    <span class="gap"></span>
    <button type="button" class="mini" onclick={() => void store.revealFile(doc.fileId)}>Reveal in Finder</button>
    <button type="button" class="mini" onclick={onclose} aria-label="Close">Close</button>
  </header>

  <div class="body">
    {#if doc.error}
      <div class="card">
        <p class="line">This one wouldn't open.</p>
        <p class="why">{doc.error}</p>
        <p class="path">{doc.absPath}</p>
      </div>
    {:else if doc.kind === 'pdf' && doc.bytes}
      <PdfViewer
        bind:this={pdf}
        bytes={doc.bytes}
        bind:currentPage={store.docPage}
        bind:pageFrom={store.docFrom}
        bind:pageTo={store.docTo}
      />
    {:else if doc.kind === 'image' && doc.bytes}
      <ImageViewer bytes={doc.bytes} ext={doc.ext} name={doc.name} />
    {:else if doc.kind === 'markdown' && doc.text !== null}
      <MarkdownViewer source={doc.text} />
    {:else if (doc.kind === 'text' || doc.kind === 'code') && doc.text !== null}
      <TextViewer text={doc.text} ext={doc.ext} code={doc.kind === 'code'} />
    {:else}
      <!-- §B1 L213's shape: say what happened, keep the file, offer the one thing that helps. -->
      <div class="card">
        <p class="line">No viewer for .{doc.ext || 'this'} files yet.</p>
        <p class="why">ChatterED reads PDF, Markdown, text, code and images in the app. Everything else opens where it lives.</p>
        <button type="button" class="btn" onclick={() => void store.revealFile(doc.fileId)}>Reveal in Finder</button>
      </div>
    {/if}
  </div>
</section>

<style>
  .pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
  }

  .head {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--hairline);
  }
  .name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .gap { flex: 1; }
  .mini { font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .mini:hover { color: var(--indigo); }

  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .card { margin: 28px auto; max-width: 46ch; padding: 20px 22px; border: 1px solid var(--hairline); border-radius: var(--radius); }
  .line { margin: 0 0 10px; font-size: 13px; }
  .why { margin: 0 0 14px; font-size: 12px; line-height: 1.6; color: var(--text-2); }
  .path { margin: 0 0 14px; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
</style>
