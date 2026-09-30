<script lang="ts">
  /**
   * **The shell** (#48, `docs/research/collab-doc.md` §0): *file panel · doc · chats*.
   *
   * It is what a PDF opens into. The three columns are the brief's, and
   * the proportions say what the app is about: the document is the widest thing on screen and
   * the conversation sits beside it, calm and narrower, because this is a document the agents
   * are writing with you rather than a chat with a file attached.
   *
   * What lives here and nowhere else:
   *
   *  - **the doc header**, which carries the progress bar (§6: "shown as a progress bar in the
   *    doc header") and the lesson-card popover it opens;
   *  - **the two seams with the editor** — `store.doc.scrollToBlock` for a lesson's Start and a
   *    span thread's jump, and the editor pane itself;
   *  - **the map of the notes**, handed to the file panel: it needs the document column to read
   *    the headings from and `jump` to go to one, and both are this component's;
   *  - **the column sizes**, which are `layoutstore.svelte.ts`'s: both edges drag (the file
   *    panel's is in `VaultSidebar`, so it is the same width beside the page viewer), and the
   *    file panel closes from its edge, its toggle, or View ▸ Show/Hide Files (⌃⌘S).
   */
  import { untrack } from 'svelte';
  import type { DocumentView } from '../../../shared/types.js';
  import { store } from '../../lib/store.svelte.js';
  import { taughtObjectives } from '../../lib/progressview.js';
  import { CHAT } from '../../lib/layout.js';
  import { layout } from '../../lib/layoutstore.svelte.js';
  import ChatColumn from './ChatColumn.svelte';
  import CostCounter from '../cost/CostCounter.svelte';
  import LessonPath from './LessonPath.svelte';
  import NotesMap from '../notes/NotesMap.svelte';
  import NotesPane from '../notes/NotesPane.svelte';
  import PacingStrip from '../PacingStrip.svelte';
  import PaneSplitter from '../PaneSplitter.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import VaultSidebar from '../VaultSidebar.svelte';

  let { doc, onclose }: { doc: DocumentView; onclose: () => void } = $props();

  /**
   * The file's surfaces, all opened by the same gesture.
   *
   * `untrack` is not optional here. Both stores *read* their own `fileId` on the way in (that is
   * how they ignore a second open of the same file), so without it this effect would take a
   * dependency on the very state it is about to write, and re-run itself into a loop that closed
   * the file it had just opened — which is exactly what the first browser run did.
   */
  $effect(() => {
    const fileId = doc.fileId;
    untrack(() => {
      void store.chat.open(fileId);
      void store.progress.load(fileId);
    });
    return () =>
      untrack(() => {
        store.chat.close();
        store.progress.close();
      });
  });

  /** The deck's pages, so a `p. N` in an agent's grounds is a button rather than a claim. */
  const pages = $derived(
    [...new Set(taughtObjectives(store.progress.view).flatMap((o) => o.pages))].sort((a, b) => a - b),
  );

  /**
   * Where the document goes. The editor owns the scroll; the query below is the fallback for a
   * block the editor's own map has not caught up with — a lesson's **Start** that silently
   * scrolls nowhere is the one thing it must not be.
   */
  function jump(blockId: string): void {
    store.doc.scrollToBlock(blockId);
    const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** A `p. N` in a turn. The document is what the learner is reading, so it lands there. */
  function goToPage(page: number): void {
    const objective = taughtObjectives(store.progress.view).find((o) => o.pages.includes(page));
    const blockId = objective?.blockIds[0];
    if (blockId) jump(blockId);
  }

  async function start(objectiveId: string): Promise<void> {
    const result = await store.progress.start(objectiveId);
    if (!result) return;
    // §6's three effects, in order: Ellie's intro is already posted by the call, the chat column
    // comes to the front, and the document scrolls to the segment that carries the objective.
    store.chat.focusDocChat();
    if (result.blockId) jump(result.blockId);
  }

  const filesOpen = $derived(layout.filesOpen);

  /** The document column, which the map of the notes reads the headings from. */
  let docbody = $state<HTMLElement | null>(null);
</script>

<div class="shell">
  {#if filesOpen}
    <!-- The file panel is the shipped vault sidebar, re-hosted and not rebuilt: the tree, the
         topics, the re-scan and the search all already work and the learner already knows them. -->
    <div class="files">
      <VaultSidebar onopen={(file) => void store.openFile(file.id)} oncollapse={() => layout.setFilesOpen(false)}>
        {#snippet below()}
          <!-- The map of the open file's notes, under the tree. Its clicks are the same `jump` a
               lesson card's Start and a span thread use. -->
          <NotesMap root={docbody} onjump={jump} />
        {/snippet}
      </VaultSidebar>
    </div>
  {/if}

  <main class="doc">
    <header class="dochead">
      <button
        type="button"
        class="mini"
        aria-pressed={filesOpen}
        aria-controls="files-panel"
        title={filesOpen ? 'Hide your files (⌃⌘S)' : 'Show your files (⌃⌘S)'}
        onclick={() => layout.toggleFiles()}
      >{filesOpen ? '⟨' : '⟩'}</button>

      <span class="name" title={doc.relPath}>{doc.name}</span>

      <!-- The bar, in the doc header, where §6 puts it. The popover hangs off this wrapper. -->
      <div class="progress">
        <ProgressBar />
        {#if store.progress.open}
          <LessonPath onstart={(id) => void start(id)} />
        {/if}
      </div>

      <!-- What this document has cost (#42 item C), beside the bar. It is `flex: none` and about
           six characters wide, and it renders nothing at all when there is no ledger or no call
           on this file — so the header's own rule holds: nothing here may push the buttons over
           the chat column's tabs at 1100px. -->
      <CostCounter />

      <button type="button" class="mini" onclick={() => (store.docView = 'viewer')}>Page viewer</button>
      <button type="button" class="mini wide-only" onclick={() => void store.revealFile(doc.fileId)}>
        Reveal in Finder
      </button>
      <button type="button" class="mini" onclick={onclose}>Close</button>
    </header>

    <div class="docbody" bind:this={docbody}>
      <!--
        **The pacing disclosure, once per install, above the document.**

        It was `FlowCanvas`'s, and it went unreachable with it — which took the whole disclosure
        out of the app, because nothing else says that the latency is deliberate or that the
        backend is scripted. That is a rubric and ethics requirement, not a nicety: a wait the
        learner has not been told about is a manipulation, and Settings still carries the
        "show the pacing note again" button that puts it back. It decides for itself whether to
        render; this column only gives it somewhere to be.
      -->
      <PacingStrip />
      <!-- The editor: self-sufficient, and it loads, ingests, renders and saves on its own. -->
      <NotesPane fileId={doc.fileId} />
    </div>
  </main>

  <PaneSplitter
    size={layout.chatWidth}
    bounds={CHAT}
    sign={-1}
    label="Resize the conversation"
    controls="chat-column"
    onsize={(width) => layout.setChatWidth(width)}
  />

  <div class="chats" id="chat-column" style:width={`${layout.chatWidth}px`}>
    <ChatColumn {pages} onjump={jump} onpage={goToPage} />
  </div>
</div>

<style>
  .shell { flex: 1; display: flex; min-width: 0; min-height: 0; }

  .files { flex: none; display: flex; min-height: 0; }

  /* The document keeps a floor of its own. It is the widest thing on screen by design, and a
     column narrow enough to break a sentence over three lines is not a document. */
  .doc {
    /* A zero basis: the document takes what the two panels leave, so a panel is the width its
       splitter says. With `auto`, the sheet's own 984 px max-width made the document a
       candidate for shrinking alongside the chat, which drew at 329 px while its splitter
       said 396. The chat still gives ground once the document is at its floor. */
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    min-width: 380px;
    min-height: 0;
    background: var(--pane);
  }

  .dochead {
    flex: none;
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--hairline);
    background: var(--ground);
  }
  /*
    Every item in this header must be able to give ground, or the row overflows its own column
    and the buttons end up drawn over the chat's tabs — which is what 1100 px looked like in the
    browser. The name ellipses, the bar has a floor of zero and a ceiling, and the one button
    that is not a destination hides below 1280 px.
  */
  .name {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 26ch;
    flex: 0 1 auto;
    min-width: 4ch;
  }
  /* The bar is given room to be a bar: it is the one piece of chrome in this header that is
     about the learner rather than about the file, and it is the header's only flexible item —
     a spacer beside it would halve its width and squeeze the status line out of existence,
     which is what the first browser run showed. */
  .progress { position: relative; flex: 1 1 auto; min-width: 0; max-width: 560px; margin-right: auto; }
  .mini { font-size: 11px; color: var(--text-2); flex: none; white-space: nowrap; }
  .mini:hover { color: var(--indigo); }

  .docbody { flex: 1; overflow-y: auto; min-height: 0; }

  /* Its width is the learner's, but it yields before the document does: `flex-shrink: 1` with a
     floor, so a narrow window takes it back to 300 px instead of squeezing the doc to nothing. */
  .chats { flex: 0 1 auto; min-width: 300px; min-height: 0; }

  @media (max-width: 1280px) {
    /* A narrow window gives the document the room first; the conversation keeps its floor. */
    .progress { max-width: 300px; }
    .wide-only { display: none; }
    .name { max-width: 16ch; }
  }
</style>
