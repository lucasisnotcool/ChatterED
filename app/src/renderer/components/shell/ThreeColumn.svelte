<script lang="ts">
  /**
   * **The shell** (#48, `docs/research/collab-doc.md` §0): *file panel · doc · chats*.
   *
   * It replaces `FlowCanvas` as what a PDF opens into. The three columns are the brief's, and
   * the proportions say what the app is about: the document is the widest thing on screen and
   * the conversation sits beside it, calm and narrower, because this is a document the agents
   * are writing with you rather than a chat with a file attached.
   *
   * What lives here and nowhere else:
   *
   *  - **the doc header**, which carries the progress bar (§6: "shown as a progress bar in the
   *    doc header") and the lesson-card popover it opens;
   *  - **the two seams with T4** — `store.doc.scrollToBlock` for a lesson's Start and a span
   *    thread's jump, and the editor pane itself, mounted the moment their file exists;
   *  - **the column sizes**, kept per install in `localStorage` the way the flow's zoom and the
   *    objectives panel's width already are.
   */
  import { untrack } from 'svelte';
  import type { DocumentView } from '../../../shared/types.js';
  import { store } from '../../lib/store.svelte.js';
  import { taughtObjectives } from '../../lib/progressview.js';
  import { loadNotesPane, type PaneComponent } from './panes.js';
  import ChatColumn from './ChatColumn.svelte';
  import LessonPath from './LessonPath.svelte';
  import NotesPlaceholder from './NotesPlaceholder.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import VaultSidebar from '../VaultSidebar.svelte';

  let { doc, onclose }: { doc: DocumentView; onclose: () => void } = $props();

  const CHAT_WIDTH_KEY = 'chattered.chat.width';
  const FILES_OPEN_KEY = 'chattered.files.open';
  const MIN_CHAT = 340;
  const MAX_CHAT = 620;
  const DEFAULT_CHAT = 396;

  function readNumber(key: string, fallback: number, lo: number, hi: number): number {
    try {
      const raw = Number(window.localStorage.getItem(key));
      if (!Number.isFinite(raw) || raw <= 0) return fallback;
      return Math.round(Math.min(hi, Math.max(lo, raw)));
    } catch {
      return fallback;
    }
  }

  function readBool(key: string, fallback: boolean): boolean {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw === 'true';
    } catch {
      return fallback;
    }
  }

  function write(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // A denied or full store is not worth failing a drag over.
    }
  }

  let chatWidth = $state(readNumber(CHAT_WIDTH_KEY, DEFAULT_CHAT, MIN_CHAT, MAX_CHAT));
  let filesOpen = $state(readBool(FILES_OPEN_KEY, true));
  let dragging = $state(false);
  let Pane = $state<PaneComponent | null>(null);

  /** T4's editor, the moment their file exists. Until then, the read-only stand-in. */
  $effect(() => {
    void loadNotesPane().then((found) => {
      untrack(() => {
        Pane = found;
      });
    });
  });

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
   * Where the document goes. T4 owns the scroll; the fallback under it is the stand-in's, and it
   * goes away with the stand-in — `scrollToBlock` is a no-op until their store lands, and a
   * lesson's **Start** that silently scrolls nowhere is the one thing it must not be.
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

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    dragging = true;
    const move = (ev: PointerEvent): void => {
      const next = Math.min(MAX_CHAT, Math.max(MIN_CHAT, window.innerWidth - ev.clientX));
      chatWidth = Math.round(next);
    };
    const up = (): void => {
      dragging = false;
      write(CHAT_WIDTH_KEY, String(chatWidth));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The keyboard's half of the drag: a splitter that only a mouse can move is not a control. */
  function onSplitterKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') chatWidth = Math.min(MAX_CHAT, chatWidth + step);
    else if (e.key === 'ArrowRight') chatWidth = Math.max(MIN_CHAT, chatWidth - step);
    else return;
    e.preventDefault();
    write(CHAT_WIDTH_KEY, String(chatWidth));
  }

  function toggleFiles(): void {
    filesOpen = !filesOpen;
    write(FILES_OPEN_KEY, String(filesOpen));
  }
</script>

<div class="shell" class:dragging>
  {#if filesOpen}
    <!-- The file panel is the shipped vault sidebar, re-hosted and not rebuilt: the tree, the
         topics, the re-scan and the search all already work and the learner already knows them. -->
    <div class="files">
      <VaultSidebar onopen={(file) => void store.openFile(file.id)} />
    </div>
  {/if}

  <main class="doc">
    <header class="dochead">
      <button
        type="button"
        class="mini"
        aria-pressed={filesOpen}
        title={filesOpen ? 'Hide your files' : 'Show your files'}
        onclick={toggleFiles}
      >{filesOpen ? '⟨' : '⟩'}</button>

      <span class="name" title={doc.relPath}>{doc.name}</span>

      <!-- The bar, in the doc header, where §6 puts it. The popover hangs off this wrapper. -->
      <div class="progress">
        <ProgressBar />
        {#if store.progress.open}
          <LessonPath onstart={(id) => void start(id)} />
        {/if}
      </div>

      <button type="button" class="mini" onclick={() => (store.docView = 'viewer')}>Page viewer</button>
      <button type="button" class="mini" onclick={() => void store.revealFile(doc.fileId)}>Reveal in Finder</button>
      <button type="button" class="mini" onclick={onclose}>Close</button>
    </header>

    <div class="docbody">
      {#if Pane}
        <!-- T4's editor: self-sufficient, and it loads, ingests, renders and saves on its own. -->
        {@const Editor = Pane as import('svelte').Component<{ fileId: string }>}
        <Editor fileId={doc.fileId} />
      {:else}
        <NotesPlaceholder fileId={doc.fileId} />
      {/if}
    </div>
  </main>

  <div
    class="splitter"
    role="separator"
    tabindex="0"
    aria-label="Resize the conversation"
    aria-orientation="vertical"
    aria-valuenow={chatWidth}
    aria-valuemin={MIN_CHAT}
    aria-valuemax={MAX_CHAT}
    onpointerdown={onPointerDown}
    onkeydown={onSplitterKey}
  ></div>

  <div class="chats" style="width: {chatWidth}px">
    <ChatColumn {pages} onjump={jump} onpage={goToPage} />
  </div>
</div>

<style>
  .shell { flex: 1; display: flex; min-width: 0; min-height: 0; }
  /* While the splitter is being dragged, nothing else may take the pointer or the selection. */
  .shell.dragging { user-select: none; cursor: col-resize; }

  .files { flex: none; display: flex; min-height: 0; }

  .doc {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
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
  .name {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 26ch;
    flex: none;
  }
  /* The bar is given room to be a bar: it is the one piece of chrome in this header that is
     about the learner rather than about the file, and it is the header's only flexible item —
     a spacer beside it would halve its width and squeeze the status line out of existence,
     which is what the first browser run showed. */
  .progress { position: relative; flex: 1 1 auto; min-width: 240px; max-width: 560px; margin-right: auto; }
  .mini { font-size: 11px; color: var(--text-2); flex: none; }
  .mini:hover { color: var(--indigo); }

  .docbody { flex: 1; overflow-y: auto; min-height: 0; }

  .splitter {
    flex: none;
    width: 5px;
    margin: 0 -2px;
    z-index: 2;
    cursor: col-resize;
    background: transparent;
  }
  .splitter:hover, .splitter:focus-visible { background: var(--indigo-tint); }

  .chats { flex: none; min-height: 0; }

  @media (max-width: 1100px) {
    /* A narrow window gives the document the room first; the conversation keeps its floor. */
    .progress { max-width: 300px; }
    .name { max-width: 16ch; }
  }
</style>
