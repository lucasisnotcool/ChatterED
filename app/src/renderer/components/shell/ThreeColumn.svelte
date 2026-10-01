<script lang="ts">
  /**
   * **The shell** (#48, `docs/research/collab-doc.md` §0): *sources · overview · chat* since the
   * notebooks redesign (#58, `docs/research/notebooks.md` §8).
   *
   * It is what a notebook opens into. The three columns are the brief's, and
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
   *  - **the map of the notes**, handed to the sources panel: it needs the document column to
   *    read the headings from and `jump` to go to one, and both are this component's;
   *  - **the column sizes**, which are `layoutstore.svelte.ts`'s: both edges drag (the sources
   *    panel's is in `SourcesPanel`), and the panel closes from its edge, its toggle, or View ▸
   *    Show/Hide Files (⌃⌘S);
   *  - **the drop zone** (`notebooks.md` §1): files dropped anywhere on the notebook window are
   *    added to it, with an overlay that names the notebook while the drag is over it. The window
   *    is marked `data-dropzone`, so the app-wide drop guard stands aside here and nowhere else.
   *
   * The doc header keeps the progress bar and the lesson path. The page viewer, Reveal in Finder
   * and Close went with the vault: a source is a copy in app storage (§1, answer C), its slides
   * are the citations' previews, and the breadcrumb in the title bar is the way home.
   */
  import { untrack } from 'svelte';
  import { bridge } from '../../lib/bridge.js';
  import { createFileDrop, filesToPaths, noPathNotice } from '../../lib/dropguard.js';
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
  import SourcesPanel from '../SourcesPanel.svelte';

  let { notebookId }: { notebookId: string } = $props();

  /**
   * The notebook's surfaces, all opened by the same gesture, all keyed on the notebook's id
   * (contract C2): the chats and the progress bar here, the doc in `NotesPane`.
   *
   * `untrack` is not optional here. Both stores *read* their own `fileId` on the way in (that is
   * how they ignore a second open of the same file), so without it this effect would take a
   * dependency on the very state it is about to write, and re-run itself into a loop that closed
   * the file it had just opened — which is exactly what the first browser run did.
   */
  $effect(() => {
    const fileId = notebookId;
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

  /** Files are being dragged over the window: the overlay and the sources panel's box say so. */
  let over = $state(false);
  const name = $derived(store.notebook.view?.name ?? 'this notebook');

  /**
   * A drop anywhere on the notebook adds the files to it (§1). Paths come from the preload
   * (`pathForFile`); a file with none (dragged out of another app's memory) is named in a notice
   * rather than lost, and the rest of the drop still goes in.
   */
  const drop = createFileDrop<File>({
    onover: (o) => (over = o),
    ondrop: (files) => {
      const { paths, refused } = filesToPaths(files, (f) => bridge().pathForFile(f));
      store.notebook.say(noPathNotice(refused));
      if (paths.length > 0) void store.notebook.addSources(paths);
    },
  });
</script>

<div
  class="shell"
  data-dropzone
  role="region"
  aria-label="Notebook"
  ondragenter={drop.dragenter}
  ondragover={drop.dragover}
  ondragleave={drop.dragleave}
  ondrop={drop.drop}
>
  {#if filesOpen}
    <div class="files">
      <SourcesPanel {over} oncollapse={() => layout.setFilesOpen(false)}>
        {#snippet below()}
          <!-- The overview's outline, with each section's fill (§7). Its clicks are the same
               `jump` a lesson card's Start and a span thread use. -->
          <NotesMap root={docbody} onjump={jump} />
        {/snippet}
      </SourcesPanel>
    </div>
  {/if}

  <main class="doc">
    <header class="dochead">
      <button
        type="button"
        class="mini"
        aria-pressed={filesOpen}
        aria-controls="files-panel"
        title={filesOpen ? 'Hide the sources (⌃⌘S)' : 'Show the sources (⌃⌘S)'}
        onclick={() => layout.toggleFiles()}
      >{filesOpen ? '⟨' : '⟩'}</button>

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
      <NotesPane fileId={notebookId} />
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

  {#if over}
    <!-- Pointer-transparent, so the drag keeps landing on the zone underneath it. -->
    <div class="overlay" aria-hidden="true">Drop to add to “{name}”</div>
  {/if}
</div>

<style>
  .shell { position: relative; flex: 1; display: flex; min-width: 0; min-height: 0; }

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--indigo-tint) 88%, transparent);
    border: 2px dashed var(--indigo);
    color: var(--indigo);
    font-size: 15px;
    font-weight: 600;
    pointer-events: none;
  }

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
  /* Every item in this header must be able to give ground, or the row overflows its own column
     and ends up drawn over the chat's tabs — which is what 1100 px looked like in the browser. */
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
  }
</style>
