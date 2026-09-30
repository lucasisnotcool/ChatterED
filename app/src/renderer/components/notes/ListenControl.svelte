<script lang="ts">
  /**
   * **Listen** (2026-10-01): read the section the cursor is in aloud, with the system's voices.
   *
   * The header's control and the glue around `lib/readaloud.ts`: it asks the store for the live
   * document and the cursor, hands the section to the controller, and moves the highlight
   * (`lib/pm/readaloud.ts`) as each block is reached. Nothing here edits the document.
   *
   * Hidden, not disabled, where there is no speech or no voice: a control that can never work is
   * not worth a place in the header.
   *
   * **Following.** The block being read is brought into view unless the learner is typing, or has
   * scrolled the reading off screen, which is them saying they are looking at something else.
   * Scrolling back to it picks the following up again; nothing is remembered between blocks.
   */
  import { onDestroy, untrack } from 'svelte';
  import type { DocStore } from '../../lib/docstore.svelte.js';
  import { READING_CLASS } from '../../lib/pm/readaloud.js';
  import { DEFAULT_RATE, ReadAloud, readQueue, type ReadAloudState, type SpeechSynth } from '../../lib/readaloud.js';

  let { doc, scroller }: { doc: DocStore; scroller: HTMLElement | null } = $props();

  let phase = $state<ReadAloudState>('idle');
  let rate = $state(DEFAULT_RATE);
  let available = $state(false);

  const hasSpeech =
    typeof globalThis.speechSynthesis === 'object' &&
    globalThis.speechSynthesis !== null &&
    typeof globalThis.SpeechSynthesisUtterance === 'function';

  /** The notes are English unless the page says otherwise; the region is the learner's own. */
  function notesLang(): string {
    const page = document.documentElement.lang || 'en';
    const own = globalThis.navigator?.language ?? '';
    return own.toLowerCase().startsWith(page.toLowerCase()) ? own : page;
  }

  function storage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  const reader = new ReadAloud(hasSpeech ? (globalThis.speechSynthesis as SpeechSynth) : null, {
    utterance: (text) => new SpeechSynthesisUtterance(text),
    lang: notesLang(),
    storage: storage(),
    onChange: sync,
    onBlock: follow,
  });
  sync();

  function sync(): void {
    phase = reader.state;
    rate = reader.rate;
    available = reader.available;
  }

  function reading(): HTMLElement | null {
    return scroller?.querySelector<HTMLElement>(`.${READING_CLASS}`) ?? null;
  }

  /** Move the highlight to `blockId` and, if the learner is still with the reading, the page. */
  function follow(blockId: string | null): void {
    const box = scroller?.getBoundingClientRect();
    const before = reading()?.getBoundingClientRect();
    // The block just finished is off screen: they scrolled away from it.
    const away = Boolean(box && before && (before.bottom < box.top || before.top > box.bottom));
    doc.markReading(blockId);
    if (!blockId || !box || away || doc.learnerTyping()) return;
    const element = reading();
    if (!element) return;
    const at = element.getBoundingClientRect();
    // Already comfortably on screen, with room below it to read on: leave the page alone.
    if (at.top >= box.top + box.height * 0.08 && at.bottom <= box.bottom - box.height * 0.25) return;
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    element.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }

  const status = $derived(doc.ingest.status);
  /** The editor is on screen: the same condition the pane mounts it under. */
  const open = $derived(Boolean(doc.docId) && (status === 'streaming' || status === 'ready'));

  /**
   * Silence on a different file, a replaced document (`epoch`: a reopen or a Regenerate) and an
   * editor that has left the screen. It also runs once on mount, which stops whatever a reload
   * of the window left the synthesiser saying.
   */
  $effect(() => {
    void doc.fileId;
    void doc.docId;
    void doc.epoch;
    void open;
    untrack(() => reader.stop());
  });

  function listen(): void {
    const source = doc.readingSource();
    if (source) reader.start(readQueue(source.doc, source.pos));
  }

  const stop = (): void => reader.stop();
  // Chromium keeps speaking across a reload of the page that asked it to.
  globalThis.addEventListener?.('pagehide', stop);
  onDestroy(() => {
    globalThis.removeEventListener?.('pagehide', stop);
    reader.dispose();
  });

  /** A click on the control must not take the cursor out of the notes. */
  const keepCursor = (e: MouseEvent): void => e.preventDefault();
</script>

{#if available && open}
  <span class="nl" role="group" aria-label="Read the notes aloud">
    {#if phase === 'idle'}
      <button
        type="button"
        title="Read this section aloud, from its heading. Uses this Mac's own voice."
        onmousedown={keepCursor}
        onclick={listen}
      >Listen</button>
    {:else}
      {#if phase === 'speaking'}
        <button type="button" title="Pause the reading" onmousedown={keepCursor} onclick={() => reader.pause()}>
          Pause
        </button>
      {:else}
        <button type="button" title="Carry on reading" onmousedown={keepCursor} onclick={() => reader.resume()}>
          Resume
        </button>
      {/if}
      <button type="button" title="Stop reading" onmousedown={keepCursor} onclick={stop}>Stop</button>
      <button
        type="button"
        class="nl-rate"
        aria-label={`Reading speed ${rate}×. Change speed`}
        title="Reading speed: 0.8×, 1×, 1.25×, 1.5×"
        onmousedown={keepCursor}
        onclick={() => reader.cycleRate()}
      >{rate}×</button>
    {/if}
  </span>
{/if}

<style>
  /* The same pill as the zoom control beside it (`notes.css` `.nd-zoom`). */
  .nl {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--pane);
    flex: none;
  }
  .nl button {
    font-size: 11px;
    color: var(--text-2);
    padding: 4px 10px;
    line-height: 1.2;
    white-space: nowrap;
  }
  .nl button + button { border-left: 1px solid var(--hairline); }
  .nl button:hover { color: var(--indigo); }
  .nl-rate {
    min-width: 5ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* The block being read: a decoration's class on ProseMirror's own DOM, so it is global. */
  :global(.nd-editor .nd-reading) {
    background: var(--indigo-tint);
    box-shadow: -4px 0 0 var(--indigo-tint), -7px 0 0 var(--indigo);
    border-radius: 2px;
  }
</style>
