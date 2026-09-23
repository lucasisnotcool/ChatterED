<script lang="ts">
  /**
   * **The document column** — the middle of `file panel · doc · chats` (§0).
   *
   * Self-sufficient by contract: given a `fileId` it loads the notes, rasterises and hands over
   * the page images, starts the ingest if there are none, renders the document, saves it, and
   * hosts the carousel and the slide modal. T5 mounts this and passes nothing else.
   *
   * It also wires the two cross-track calls, here rather than in the store, so that neither
   * `docstore.svelte.ts` nor `chatstore.svelte.ts` imports the other:
   *   - **T4 → T5**: Ctrl+E hands a span to `store.chat.openSpanThread({ blockId, quote })`, and
   *     a highlight click calls `store.chat.focusThread(threadId)`.
   *   - **T5 → T4**: the highlights themselves are drawn from `store.chat.spanThreads`.
   * `store.chat` is T5's and is read defensively until its surface lands.
   */
  import { store } from '../../lib/store.svelte.js';
  import NotesEditor from './NotesEditor.svelte';
  import SlideCarousel from './SlideCarousel.svelte';
  import SlideModal from './SlideModal.svelte';
  import type { SpanThreadView } from '../../lib/pm/chrome.js';
  import './notes.css';

  let { fileId }: { fileId: string } = $props();

  const doc = store.doc;

  /** T5's chat store, as much of it as has landed. Never assumed. */
  interface ChatSurface {
    openSpanThread?: (input: { blockId: string; quote: string }) => void;
    focusThread?: (threadId: string) => void;
    spanThreads?: readonly SpanThreadView[];
  }
  const chat = (): ChatSurface => store.chat as unknown as ChatSurface;

  doc.askAboutSpan = (input) => chat().openSpanThread?.(input);
  doc.focusThread = (threadId) => chat().focusThread?.(threadId);
  doc.spanThreads = () => chat().spanThreads ?? [];

  $effect(() => {
    const id = fileId;
    if (id) void doc.open(id);
  });

  /**
   * The span highlights are drawn from T5's list, and a thread appearing there changes nothing in
   * the document — so nothing would tell ProseMirror's decoration set to rebuild. Watching the
   * signature here is what closes that gap.
   */
  $effect(() => {
    const signature = (chat().spanThreads ?? []).map((t) => `${t.threadId}:${t.blockId}`).join('|');
    void signature;
    doc.refreshChrome();
  });

  const status = $derived(doc.ingest.status);
  const ready = $derived(status === 'streaming' || status === 'ready');
  /**
   * **Regenerate** (2026-09-23). Offered once the notes are finished (or have failed): regenerating
   * over a deck that is still being written would be two runs appending to one document, and main
   * refuses it anyway. The confirm is main's, so this button only asks.
   */
  const canRegenerate = $derived(Boolean(doc.docId) && (status === 'ready' || status === 'failed'));
  async function regenerate(): Promise<void> {
    const line = await doc.regenerate();
    if (line) store.notice = { level: 'info', text: line };
  }

  const savedLabel = $derived.by(() => {
    if (doc.saving) return 'Saving…';
    if (doc.savedAt > 0) return 'Saved';
    return '';
  });
</script>

<div class="nd">
  <header class="nd-head">
    <span class="nd-title">{doc.title || 'Lecture notes'}</span>
    {#if doc.pageCount > 0}
      <span class="nd-head-meta">{doc.pageCount} slides</span>
    {/if}
    <span class="nd-head-spacer"></span>
    {#if savedLabel}<span class="nd-head-meta">{savedLabel}</span>{/if}
    <button
      class="nd-toggle"
      type="button"
      disabled={!canRegenerate}
      title={canRegenerate
        ? 'Rewrite these notes from the slides. Asks first: everything in them is replaced.'
        : 'Ellie is still writing these notes.'}
      onclick={() => void regenerate()}
    >
      Regenerate…
    </button>
    <button
      class="nd-toggle"
      type="button"
      aria-pressed={doc.frozen}
      title={doc.frozen
        ? 'Ellie and Max are not editing. Unfreeze to let them back in.'
        : 'Stop Ellie and Max editing. They still talk.'}
      onclick={() => void doc.setFrozen(!doc.frozen)}
    >
      <span class="nd-toggle-dot"></span>
      {doc.frozen ? 'Frozen' : 'Freeze'}
    </button>
  </header>

  <div class="nd-scroll">
    <div class="nd-sheet">
      {#if doc.error && !ready}
        <div class="nd-state">
          <div class="nd-state-title">These notes could not be opened</div>
          <p class="nd-state-line">{doc.error}</p>
          <div class="nd-state-actions">
            <button class="btn" type="button" onclick={() => void doc.retryIngest()}>Try again</button>
          </div>
        </div>
      {:else if status === 'failed'}
        <div class="nd-state">
          <div class="nd-state-title">The ingest stopped</div>
          <p class="nd-state-line">{doc.ingest.error ?? 'Ellie could not finish reading the slides.'}</p>
          <div class="nd-state-actions">
            <button class="btn" type="button" onclick={() => void doc.retryIngest()}>Retry</button>
          </div>
        </div>
      {:else if !ready}
        <div class="nd-state">
          <div class="nd-state-title">Ellie is reading the slides…</div>
          <p class="nd-state-line">
            {#if doc.rasterising}
              page images sent · {doc.rasterising.done} of {doc.rasterising.total}
            {:else if doc.ingest.windowsTotal > 0}
              window {doc.ingest.windowsDone} of {doc.ingest.windowsTotal}
            {:else}
              She opens the notes as soon as the first pages are written.
            {/if}
          </p>
          <div class="nd-state-bar">
            {#if doc.rasterising && doc.rasterising.total > 0}
              <div class="nd-state-fill" style:width={`${(doc.rasterising.done / doc.rasterising.total) * 100}%`}></div>
            {:else if doc.ingest.windowsTotal > 0}
              <div class="nd-state-fill" style:width={`${(doc.ingest.windowsDone / doc.ingest.windowsTotal) * 100}%`}></div>
            {:else}
              <div class="nd-state-sweep"></div>
            {/if}
          </div>
        </div>
      {:else}
        {#if doc.frozen}
          <p class="nd-frozen-note">
            Frozen — Ellie and Max are not editing these notes. They still answer in the chat.
          </p>
        {/if}

        <NotesEditor {doc} />

        {#if status === 'streaming'}
          <p class="nd-writing">
            <span class="nd-writing-dot"></span>
            Ellie is still writing — window {doc.ingest.windowsDone} of {doc.ingest.windowsTotal}
          </p>
        {/if}

        <SlideCarousel
          source={doc.slides()}
          sections={() => doc.sections()}
          pageCount={doc.pageCount}
          onopen={(page) => doc.openSlide(page, null)}
        />
      {/if}
    </div>
  </div>
</div>

{#if doc.modal}
  <SlideModal
    source={doc.slides()}
    page={doc.modal.page}
    rect={doc.modal.rect}
    pageCount={doc.pageCount}
    onclose={() => doc.closeSlide()}
  />
{/if}
