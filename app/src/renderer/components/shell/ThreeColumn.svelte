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
   *  - **the drop zone** (`notebooks.md` §1): files dropped on the **sources column** are added
   *    to the notebook, and its drop box lights up while they are over it. Since 2026-10-04 that
   *    column is the only place a file becomes a source: an image dropped on the notes or the
   *    tutorial goes into that sheet where it was dropped (`lib/sheetdrop.ts`), and any other file
   *    dropped there or on the chat is refused. Each zone is marked `data-dropzone`, so the
   *    app-wide drop guard stands aside there and nowhere else;
   *  - **Ctrl with + − 0** (2026-10-04): the View menu's zoom keys are ⌘ on a Mac, and Ctrl is
   *    routed the same way here, to the notes or the tutorial, whichever the learner is in
   *    (`lib/viewer.ts`).
   *
   *  - **the tutorial column** (`docs/research/tutorials.md` §2): with a tutorial open and docked,
   *    the doc column splits *notes | splitter | tutorial*, its width the learner's; popped out,
   *    the tutorial floats over the app (`TutorialWindow`). A span thread on a tutorial's block
   *    jumps to it there rather than in the notes.
   *
   *  - **the swap** (2026-10-04, Lucas; `tutorials.md` §2): in a notebook with a tutorial, *Main
   *    view: Lecture notes · Tutorial* in the doc header makes the tutorial the middle column. The
   *    notes are then hidden, still mounted (so their slides, headings and citations keep working
   *    for the sheet), and open as a window over the app from the sheet's **Notes** button, a
   *    part's *From the notes*, the map or a lesson's Start; Escape or × closes it. The swap is per
   *    notebook and remembered (`layout.tutorialMain`), off by default; while it is on, the chat and
   *    the sheet's line actions tell main which sheet is in front (`chat.mainTutorial`).
   *
   * The doc header keeps the progress bar and the lesson path. The page viewer, Reveal in Finder
   * and Close went with the vault: a source is a copy in app storage (§1, answer C), its slides
   * are the citations' previews, and the breadcrumb in the title bar is the way home.
   */
  import { tick, untrack } from 'svelte';
  import { bridge } from '../../lib/bridge.js';
  import { createFileDrop, filesToPaths, noPathNotice } from '../../lib/dropguard.js';
  import { attachEdgeHandles, floatArea, resizeFrame } from '../../lib/floatframe.js';
  import { runViewerCommand } from '../../lib/viewer.js';
  import { store } from '../../lib/store.svelte.js';
  import { taughtObjectives } from '../../lib/progressview.js';
  import {
    CHAT,
    NOTES_SPLIT_MIN,
    TUTORIAL,
    TUTORIAL_WINDOW_MIN,
    filesCrowdTutorial,
    floatFrame,
    mainTutorialFor,
    notesFloatFrame,
    type FloatFrame,
    type FloatView,
  } from '../../lib/layout.js';
  import '../notes/floatframe.css';
  import type { NotebookView } from '../../../shared/notebook.js';
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
  import TutorialPane from '../notes/TutorialPane.svelte';
  import TutorialOriginalPdf from '../notes/TutorialOriginalPdf.svelte';
  import TutorialWindow from '../notes/TutorialWindow.svelte';

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

  /**
   * The notebook's tutorials follow the open notebook (a deep snapshot: a source's role or status
   * is a field inside the view). Help and Check bring their thread up in the chat.
   */
  const tutorial = store.tutorial;
  tutorial.focusThread = (threadId) => {
    layout.setChatOpen(true);
    store.chat.focusThread(threadId);
  };
  $effect(() => {
    const view = store.notebook.view;
    const snapshot = view && view.id === notebookId ? ($state.snapshot(view) as NotebookView) : null;
    untrack(() => tutorial.setNotebook(snapshot));
  });
  $effect(() => () => untrack(() => tutorial.setNotebook(null)));

  const tutorialOpen = $derived(tutorial.openFileId !== null);

  /**
   * **The swap** (2026-10-04): the tutorial the middle column shows instead of the notes, or null.
   * On only in a notebook that has a tutorial and has the swap on (`mainTutorialFor`).
   */
  const mainFileId = $derived(mainTutorialFor(layout.tutorialMain, notebookId, tutorial.views));
  const tutorialMain = $derived(mainFileId !== null);
  const activeTutorialName = $derived(store.notebook.view?.sources.find((s) => s.fileId === mainFileId)?.name ?? 'Tutorial');
  let pdfQuestionNumbers = $state<number[]>([]);
  /** With the swap on, the notes are a window over the app while open, and hidden while not. */
  const notesFloating = $derived(tutorialMain && layout.notesWindowOpen);
  const notesHidden = $derived(tutorialMain && !layout.notesWindowOpen);

  /**
   * The main tutorial is the one the pane shows: opened when the swap goes on (or the notebook
   * opens with it on), and a tab picked in the pane becomes the remembered one. Closing it from
   * its source row (*Close*) is going back to the notes: the middle column is never empty.
   */
  let lastOpen: string | null = null;
  $effect(() => {
    const want = mainFileId;
    const open = tutorial.openFileId;
    untrack(() => {
      const closed = open === null && lastOpen !== null && lastOpen === want;
      lastOpen = open;
      if (!want) return;
      if (closed) layout.setTutorialMain(notebookId, null);
      else if (open === null) void tutorial.open(want);
      else if (open !== want) layout.setTutorialMain(notebookId, open);
    });
  });

  /** The chat and the sheet's line actions say which sheet is in front (`main/tutorial/focus.ts`). */
  $effect(() => {
    const main = mainFileId;
    untrack(() => {
      store.chat.mainTutorial = main;
      tutorial.doc.mainTutorial = () => main;
    });
  });
  $effect(() => () =>
    untrack(() => {
      store.chat.mainTutorial = null;
      tutorial.doc.mainTutorial = null;
      layout.setNotesWindowOpen(false);
    }),
  );

  const docked = $derived(tutorialOpen && !tutorial.floating && !tutorialMain);

  /**
   * **Room for the docked tutorial.** Notes and tutorial side by side want two readable sheets;
   * when the sources panel and the chat leave the doc column less than that
   * (`filesCrowdTutorial`), the sources fold away while the tutorial is docked, and come back
   * when it closes, pops out or the window grows — unless the learner reopened or closed them in
   * the meantime (`LayoutStore.roomForTutorial`).
   */
  let shellWidth = $state(0);
  let docWidth = $state(0);
  const pdfWidth = $derived(Math.max(260, Math.min(layout.tutorialWidth, docWidth - 360)));
  $effect(() => {
    const crowded = docked || (tutorialMain && layout.tutorialView === 'pdf')
      ? filesCrowdTutorial(shellWidth, layout.filesWidth, layout.chatOpen ? layout.chatWidth : 0)
      : null;
    untrack(() => layout.roomForTutorial(crowded));
  });
  $effect(() => () => untrack(() => layout.roomForTutorial(null)));

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
    // A thread on a tutorial's block: the part is in the tutorial column, not the notes.
    if (!store.doc.hasBlock(blockId) && tutorial.tutorialOfBlock(blockId)) {
      void tutorial.focusBlock(blockId);
      return;
    }
    // The swap is on and the notes are hidden: their window opens first, then the block is found.
    if (notesHidden) {
      openNotes(blockId);
      return;
    }
    revealNotesBlock(blockId);
  }

  function revealNotesBlock(blockId: string): void {
    store.doc.scrollToBlock(blockId);
    const el = docbody?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /**
   * **The notes, one click away** while the tutorial is the main view: their window opens, and
   * with a block (a part's *From the notes*, the map, a lesson's Start) it scrolls there once the
   * notes are laid out again.
   */
  function openNotes(blockId: string | null = null): void {
    if (!layout.notesWindowOpen) notesFrame = notesFloatFrame(layout.notesFrame, viewport());
    layout.setNotesWindowOpen(true);
    void tick().then(() => {
      // The window takes the focus, so Escape closes it; a block is found once it is laid out.
      if (docbody && !docbody.contains(document.activeElement)) docbody.focus({ preventScroll: true });
      if (blockId) requestAnimationFrame(() => revealNotesBlock(blockId));
    });
  }
  tutorial.openNotes = (blockId) => openNotes(blockId);
  $effect(() => () => untrack(() => (tutorial.openNotes = null)));

  // ── the notes' window (the swap on) ────────────────────────────────────────────────────────
  /** The app's size, and the title bar's bottom, which the window never goes above (`floatArea`). */
  const viewport = (): FloatView => {
    const area = floatArea();
    return { width: area.right, height: area.bottom, top: area.top };
  };
  let notesFrame = $state<FloatFrame | null>(null);
  let notesMoving = $state(false);
  /** Each opening places the window where it was left, kept inside the app as it is now. */
  $effect(() => {
    if (!notesFloating) return;
    untrack(() => (notesFrame = notesFloatFrame(layout.notesFrame, viewport())));
  });

  function onresize(): void {
    if (notesFloating && notesFrame) notesFrame = floatFrame(notesFrame, viewport());
  }

  /** Move by the window's bar, as the tutorial window moves (`TutorialWindow`). */
  function notesBarDown(event: PointerEvent): void {
    if (event.button !== 0 || !notesFrame || (event.target as Element).closest('button')) return;
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);
    const start = { ...notesFrame };
    const x0 = event.clientX;
    const y0 = event.clientY;
    notesMoving = true;
    document.documentElement.classList.add('ff-resizing');
    document.documentElement.style.setProperty('--ff-cursor', 'grabbing');
    const move = (e: PointerEvent): void => {
      notesFrame = floatFrame({ ...start, left: start.left + e.clientX - x0, top: start.top + e.clientY - y0 }, viewport());
    };
    const up = (): void => {
      notesMoving = false;
      document.documentElement.classList.remove('ff-resizing');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (notesFrame) layout.setNotesFrame(notesFrame);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Resize from any edge or corner while floating (`attachEdgeHandles`, the slide windows' too).
  $effect(() => {
    const root = docbody;
    if (!root || !notesFloating) return;
    let start: FloatFrame | null = null;
    return attachEdgeHandles(root, {
      start: () => {
        start = notesFrame ? { ...notesFrame } : null;
        notesMoving = true;
      },
      move: (edge, dx, dy) => {
        if (start) notesFrame = resizeFrame(start, edge, dx, dy, floatArea(), TUTORIAL_WINDOW_MIN);
      },
      end: () => {
        notesMoving = false;
        if (notesFrame) layout.setNotesFrame(notesFrame);
      },
    });
  });

  /** Escape outside the text closes the notes' window, as it docks the tutorial's. */
  function notesKey(e: KeyboardEvent): void {
    if (!notesFloating || e.key !== 'Escape' || (e.target as Element).closest('.ProseMirror')) return;
    e.preventDefault();
    layout.setNotesWindowOpen(false);
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
    layout.setChatOpen(true);
    if (result.blockId) jump(result.blockId);
  }

  const filesOpen = $derived(layout.filesOpen);

  /** The document column, which the map of the notes reads the headings from. */
  let docbody = $state<HTMLElement | null>(null);

  /** Files are being dragged over the sources column: its drop box says so. */
  let over = $state(false);

  /**
   * A drop on the sources column adds the files to the notebook (§1). Paths come from the preload
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

  /** Ctrl+= / Ctrl+− / Ctrl+0 as the menu's ⌘ ones. */
  function onwindowkey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !e.ctrlKey || e.metaKey || e.altKey) return;
    const command = e.key === '=' || e.key === '+' ? 'zoom.in' : e.key === '-' ? 'zoom.out' : e.key === '0' ? 'zoom.reset' : null;
    if (!command) return;
    if (runViewerCommand(command)) e.preventDefault();
  }
</script>

<svelte:window onkeydown={onwindowkey} {onresize} />

<div class="shell" bind:clientWidth={shellWidth} role="region" aria-label="Notebook">
  {#if filesOpen}
    <div
      class="files"
      data-dropzone
      role="region"
      aria-label="Sources: drop files here to add them"
      ondragenter={drop.dragenter}
      ondragover={drop.dragover}
      ondragleave={drop.dragleave}
      ondrop={drop.drop}
    >
      <SourcesPanel {over} oncollapse={() => layout.setFilesOpen(false)}>
        {#snippet below()}
          <!-- The overview's outline, with each section's fill (§7). Its clicks are the same
               `jump` a lesson card's Start and a span thread use. -->
          <NotesMap root={docbody} onjump={jump} />
        {/snippet}
      </SourcesPanel>
    </div>
  {/if}

  <!-- Docked, the doc column holds two floors (the notes' and the tutorial's): the chat gives way
       first, as it does to the notes alone. -->
  <main class="doc" bind:clientWidth={docWidth} style:min-width={docked ? `${NOTES_SPLIT_MIN + TUTORIAL.min}px` : null}>
    <header class="dochead">
      <button
        type="button"
        class="mini"
        aria-pressed={filesOpen}
        aria-controls="files-panel"
        title={filesOpen ? 'Hide the sources (⌃⌘S)' : 'Show the sources (⌃⌘S)'}
        onclick={() => layout.toggleFiles()}
      >☰ Sources</button>

      {#if tutorialMain}
        <select class="tutorial-select" aria-label="Choose tutorial" value={mainFileId ?? ''} onchange={(e) => {
          const id = e.currentTarget.value;
          layout.setTutorialMain(notebookId, id);
          void tutorial.open(id);
        }}>
          {#each tutorial.views as v (v.fileId)}
            <option value={v.fileId}>{store.notebook.view?.sources.find((s) => s.fileId === v.fileId)?.name ?? v.title ?? 'Tutorial'}</option>
          {/each}
        </select>
      {/if}

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

      <!-- The swap (2026-10-04): only in a notebook with a tutorial. -->
      {#if tutorialMain}
        <div class="mainview" role="group" aria-label="Tutorial view">
          <button type="button" class="mv-opt" class:on={layout.tutorialView === 'pdf'} aria-pressed={layout.tutorialView === 'pdf'} onclick={() => layout.setTutorialView('pdf')}>PDF + working</button>
          <button type="button" class="mv-opt" class:on={layout.tutorialView === 'combined'} aria-pressed={layout.tutorialView === 'combined'} onclick={() => layout.setTutorialView('combined')}>Combined sheet</button>
        </div>
      {/if}
      <button type="button" class="chats-toggle" aria-expanded={layout.chatOpen} aria-controls="chat-column" onclick={() => layout.setChatOpen(!layout.chatOpen)}>💬 Chats</button>
    </header>

    <div class="docrow">
    <!-- Floating, it is a dialog (focusable, so Escape reaches it); docked, a plain column. -->
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
    <div
      class="docbody"
      class:notes-hidden={notesHidden}
      class:notes-window={notesFloating}
      class:ff-window={notesFloating}
      class:moving={notesMoving}
      bind:this={docbody}
      role={notesFloating ? 'dialog' : null}
      aria-label={notesFloating ? 'Lecture notes' : null}
      aria-hidden={notesHidden ? 'true' : null}
      tabindex={notesFloating ? -1 : null}
      onkeydown={notesKey}
      style:min-width={docked ? `${NOTES_SPLIT_MIN}px` : null}
      style:left={notesFloating && notesFrame ? `${notesFrame.left}px` : null}
      style:top={notesFloating && notesFrame ? `${notesFrame.top}px` : null}
      style:width={notesFloating && notesFrame ? `${notesFrame.width}px` : null}
      style:height={notesFloating && notesFrame ? `${notesFrame.height}px` : null}
    >
      {#if notesFloating}
        <!-- The window's title bar: drag to move; the × (or Escape) puts the notes away again. -->
        <div class="nw-bar" onpointerdown={notesBarDown}>
          <span class="nw-kicker">Lecture notes</span>
          <span class="nw-hint">behind the tutorial</span>
          <button type="button" class="nw-close" aria-label="Close the notes" title="Close the notes (Esc)" onclick={() => layout.setNotesWindowOpen(false)}>×</button>
        </div>
      {/if}
      <!--
        **The pacing disclosure, once per install, above the document.**

        It was `FlowCanvas`'s, and it went unreachable with it — which took the whole disclosure
        out of the app, because nothing else says that the latency is deliberate or that the
        backend is scripted. That is a rubric and ethics requirement, not a nicety: a wait the
        learner has not been told about is a manipulation, and Settings still carries the
        "show the pacing note again" button that puts it back. It decides for itself whether to
        render; this column only gives it somewhere to be.
      -->
      <!-- With the swap on, the disclosure goes above the sheet: the notes may never be opened. -->
      {#if !tutorialMain}
        <PacingStrip />
      {/if}
      <!-- The editor: self-sufficient, and it loads, ingests, renders and saves on its own. -->
      <NotesPane fileId={notebookId} />
    </div>
    {#if tutorialMain}
      <!-- The swap: the sheet is the middle column, the whole of it. -->
      <section class="tutmain" id="tutorial-column" aria-label="Tutorial">
        <div class="tutmain-pacing"><PacingStrip /></div>
        <div class="pdf-layout">
          {#if layout.tutorialView === 'pdf' && mainFileId}
            <div class="pdf-side" id="tutorial-pdf" style:width={`${pdfWidth}px`}>
              <TutorialOriginalPdf fileId={mainFileId} name={activeTutorialName} onquestions={(numbers) => pdfQuestionNumbers = numbers} />
            </div>
            <PaneSplitter size={pdfWidth} bounds={TUTORIAL} sign={1} label="Resize the original PDF" controls="tutorial-pdf" onsize={(width) => layout.setTutorialWidth(width)} />
          {/if}
          <div class="working-side"><TutorialPane main working={layout.tutorialView === 'pdf'} printedQuestions={pdfQuestionNumbers} /></div>
        </div>
      </section>
    {:else if docked}
      <PaneSplitter
        size={layout.tutorialWidth}
        bounds={TUTORIAL}
        sign={-1}
        label="Resize the tutorial"
        controls="tutorial-column"
        onsize={(width) => layout.setTutorialWidth(width)}
        oncollapse={() => tutorial.close()}
      />
      <section class="tutcol" id="tutorial-column" aria-label="Tutorial" style:width={`${layout.tutorialWidth}px`}>
        <TutorialPane />
      </section>
    {/if}
    </div>
  </main>

  {#if layout.chatOpen}<PaneSplitter
    size={layout.chatWidth}
    bounds={CHAT}
    sign={-1}
    label="Resize the conversation"
    controls="chat-column"
    onsize={(width) => layout.setChatWidth(width)}
  />{/if}

  <div class="chats" class:closed={!layout.chatOpen} id="chat-column" style:width={layout.chatOpen ? `${layout.chatWidth}px` : '0px'} aria-hidden={!layout.chatOpen}>
    <ChatColumn {pages} onjump={jump} onpage={goToPage} />
  </div>

  {#if tutorialOpen && tutorial.floating && !tutorialMain}
    <TutorialWindow />
  {/if}
</div>

<style>
  .shell { position: relative; flex: 1; display: flex; min-width: 0; min-height: 0; }

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
  .mini { font-size: 12px; color: var(--text-2); flex: none; white-space: nowrap; border: 1px solid var(--hairline); padding: 5px 9px; border-radius: 7px; }
  .mini:hover { color: var(--indigo); }
  .tutorial-select { max-width: 215px; min-width: 120px; border: 1px solid var(--hairline); border-radius: 7px; padding: 5px 24px 5px 8px; background: var(--pane); color: var(--text); overflow: hidden; text-overflow: ellipsis; }
  .chats-toggle { flex: none; border: 1px solid var(--hairline); border-radius: 7px; padding: 5px 9px; font-size: 12px; }
  .chats-toggle:hover { color: var(--indigo); border-color: var(--indigo); }

  .docrow { flex: 1; display: flex; min-height: 0; min-width: 0; }
  .docbody { flex: 1 1 0; overflow-y: auto; min-height: 0; min-width: 0; }
  /* The tutorial yields before the notes do: its width is the learner's, with a floor. */
  .tutcol { flex: 0 1 auto; min-width: 360px; min-height: 0; display: flex; flex-direction: column; }
  .tutcol > :global(.tp-nd) { flex: 1 1 auto; }

  /* ── The swap (2026-10-04): the sheet in the middle, the notes hidden or in a window ── */
  .tutmain { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .pdf-layout { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; }
  .pdf-side { flex: none; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .pdf-side > :global(.original-pdf) { flex: 1 1 auto; }
  .working-side { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; }
  .working-side > :global(.tp-nd) { flex: 1 1 auto; min-height: 0; }
  /* The disclosure, once per install, above the sheet; it scrolls rather than crowd it out. */
  .tutmain-pacing { flex: 0 1 auto; max-height: 50%; overflow-y: auto; }
  .tutmain-pacing:empty { display: none; }
  /* Hidden, not unmounted: the notes' editor still answers the sheet's headings, citations and
     slide windows, and comes back exactly where it was. */
  .docbody.notes-hidden { display: none; }
  .docbody.notes-window {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--pane);
    box-shadow: 0 18px 48px rgb(20 20 40 / 20%), 0 2px 8px rgb(20 20 40 / 8%);
    outline: none;
  }
  .docbody.notes-window:focus-within { box-shadow: 0 20px 52px rgb(20 20 40 / 24%), 0 0 0 3px var(--indigo-tint); }
  .docbody.notes-window.moving { box-shadow: 0 24px 60px rgb(20 20 40 / 28%); }
  .docbody.notes-window > :global(.nd) { flex: 1 1 auto; min-height: 0; }
  .nw-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 4px 6px 4px 14px;
    border-bottom: 1px solid var(--hairline);
    background: var(--ground);
    cursor: grab;
    user-select: none;
  }
  .nw-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--indigo); }
  .nw-hint { flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nw-close { flex: none; font-size: 16px; line-height: 1; padding: 2px 7px; border-radius: 6px; color: var(--text-2); cursor: pointer; }
  .nw-close:hover { background: var(--pane); color: var(--text); }

  .mainview {
    flex: none;
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--pane);
  }
  .mv-opt {
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .mv-opt:hover { color: var(--indigo); }
  .mv-opt.on { background: var(--indigo-tint); color: var(--indigo); font-weight: 600; }

  /* Its width is the learner's, but it yields before the document does: `flex-shrink: 1` with a
     floor, so a narrow window takes it back to 300 px instead of squeezing the doc to nothing. */
  .chats { flex: 0 1 auto; min-width: 300px; min-height: 0; }
  .chats.closed { flex: none; min-width: 0; overflow: hidden; visibility: hidden; }

  @media (max-width: 1280px) {
    /* A narrow window gives the document the room first; the conversation keeps its floor. */
    .progress { max-width: 300px; }
  }
</style>
