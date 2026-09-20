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
  import { agentNames } from '../lib/labels.js';
  import { validateRange } from '../lib/pdfview.js';
  import ImageViewer from './ImageViewer.svelte';
  import MarkdownViewer from './MarkdownViewer.svelte';
  import PdfViewer from './PdfViewer.svelte';
  import TextViewer from './TextViewer.svelte';

  let { doc, onclose, inRoom = false }: { doc: DocumentView; onclose: () => void; inRoom?: boolean } = $props();

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
    store.docPageCount = 0;
    return () => void id;
  });

  $effect(() => {
    const page = store.pendingPage;
    if (page !== null && doc.kind === 'pdf' && pdf) {
      store.pendingPage = null;
      pdf.goTo(page);
    }
  });

  /**
   * The marked range, as everything downstream must read it. An inverted range used to reach
   * `sessionSeed` and come back as an empty paste box with no explanation (ui-review-code.md
   * §5.4); now the viewer says so inline and the primary action is disabled until it is fixed.
   */
  const range = $derived(validateRange(store.docFrom, store.docTo, store.docPageCount));

  /** Where in the file "Show the room" would point: the marked range, else the page on screen. */
  const where = $derived.by(() => {
    if (doc.kind !== 'pdf') return null;
    const from = range.from ?? store.docPage;
    const to = range.to ?? store.docPage;
    return from === to ? `p. ${from}` : `pp. ${from}\u2013${to}`;
  });

  let menu = $state<{ x: number; y: number } | null>(null);

  /** Right-click on a selection is the third way in (issue #22 decision 4). */
  function oncontextmenu(e: MouseEvent): void {
    if (!inRoom) return;
    const selected = (window.getSelection()?.toString() ?? '').trim();
    if (selected.length === 0) return;
    e.preventDefault();
    store.docSelection = selected;
    menu = { x: e.clientX, y: e.clientY };
  }

  function show(): void {
    menu = null;
    store.showTheRoom();
  }

  /**
   * The primary action, and it says what it does. It used to be `Explain p. 1 →` in the same
   * 11 px grey as **Reveal in Finder** and **Close** — the single most important control in the
   * app styled identically to the window-close affordance next to it (ui-review-ux.md B2).
   *
   * The names come off the live roster, so the learner knows who is on the other side of the
   * button before they press it — and §B1's rule that no agent *appears* in the Library holds:
   * this is the app saying what will happen, not Ellie standing there waiting.
   */
  const mates = $derived(agentNames(store.boot?.agents));

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
    {#if inRoom}
      <!-- The whole point of the pane while a room is open (issue #22 decision 4). -->
      <button type="button" class="show" onclick={show} disabled={!range.valid}>
        Show the room{where ? ` · ${where}` : ''}
        <kbd>⌘⇧S</kbd>
      </button>
    {:else}
      <button
        type="button"
        class="show"
        disabled={!range.valid}
        aria-describedby="page-range"
        onclick={() => void store.setupFromFile(doc.fileId, range.from, range.to)}
      >
        Explain {where ?? 'this'} with {mates}
      </button>
    {/if}
    {#if doc.kind === 'pdf' && !inRoom}
      <!-- The way back to the notes doc. The pane is not the default any more, but it is not
           gone: nothing that shipped on 15 Sep regresses. -->
      <button type="button" class="mini" onclick={() => (store.docView = 'notes')}>The notes</button>
    {/if}
    <button type="button" class="mini" onclick={() => void store.revealFile(doc.fileId)}>Reveal in Finder</button>
    <button type="button" class="mini" onclick={onclose} aria-label="Close">Close</button>
  </header>

  <div class="body" {oncontextmenu} role="presentation">
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
        bind:pageCount={store.docPageCount}
        initialScroll={store.docScroll[doc.fileId] ?? 0}
        onscrolled={(top) => (store.docScroll[doc.fileId] = top)}
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

{#if menu}
  <div class="menu-scrim" role="presentation" onclick={() => (menu = null)} oncontextmenu={() => (menu = null)}></div>
  <div class="menu" style="left: {menu.x}px; top: {menu.y}px" role="menu">
    <button type="button" class="item" role="menuitem" onclick={show}>
      Show the room{where ? ` · ${where}` : ''}
    </button>
  </div>
{/if}

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
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--hairline);
  }
  .name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .gap { flex: 1; }
  .mini { font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .mini:hover:not(:disabled) { color: var(--indigo); }
  .mini:disabled { color: var(--muted); cursor: default; }
  .show:disabled { background: var(--hairline); border-color: var(--hairline); color: var(--muted); cursor: default; }

  /* Indigo, because bringing a document to the group is the learner acting (§C2 rule 3). */
  .show {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    border: 1px solid var(--indigo);
    background: var(--indigo);
    color: #fff;
    border-radius: var(--radius);
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 500;
  }
  .show:hover { background: #443cd0; }
  .show kbd {
    font: inherit;
    font-size: 10px;
    opacity: 0.72;
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: 3px;
    padding: 0 3px;
  }

  .menu-scrim { position: fixed; inset: 0; z-index: 60; }
  .menu {
    position: fixed;
    z-index: 61;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(27, 27, 34, 0.18);
    padding: 4px;
  }
  .menu .item {
    display: block;
    width: 100%;
    text-align: left;
    white-space: nowrap;
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text);
  }
  .menu .item:hover { background: var(--indigo-tint); }

  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .card { margin: 28px auto; max-width: 46ch; padding: 20px 22px; border: 1px solid var(--hairline); border-radius: var(--radius); }
  .line { margin: 0 0 10px; font-size: 13px; }
  .why { margin: 0 0 14px; font-size: 12px; line-height: 1.6; color: var(--text-2); }
  .path { margin: 0 0 14px; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
</style>
