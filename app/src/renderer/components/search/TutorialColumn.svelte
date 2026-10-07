<script lang="ts">
  /**
   * **A tutorial sheet in the search page's notes column** (`docs/research/search.md` §10): the
   * sheet a tutorial hit is in, in the same editor and part chrome as the notebook's tutorial
   * column (`TutorialPane`), on the tutorial store's own `DocStore`, highlighted at the hit by the
   * search page as the notes are. Editable in place, and saved like the notebook's.
   *
   * What is left out, because agents do not run on the search page (§5): Check, Hint, Refresher
   * and Show answer go to the notebook (`onaction`, which opens it at the part and asks there),
   * and *From the notes* opens the notebook at that notes block (`onnotes`). The parts' records
   * (the status words and hint dots) are read from main once, without the tutorial store's list,
   * which would start reading any sheet not read yet.
   */
  import { untrack } from 'svelte';
  import type { NotebookView } from '../../../shared/notebook.js';
  import type { TutorialListInput, TutorialPartView, TutorialView } from '../../../shared/tutorial.js';
  import { bridge } from '../../lib/bridge.js';
  import { tutorialSheetFit } from '../../lib/layout.js';
  import { layout } from '../../lib/layoutstore.svelte.js';
  import type { TutorialChromeContext } from '../../lib/pm/tutorial.js';
  import { store } from '../../lib/store.svelte.js';
  import NotesEditor from '../notes/NotesEditor.svelte';
  import '../notes/notes.css';
  import '../notes/table.css';

  let {
    notebookId,
    fileId,
    onaction,
    onnotes,
  }: {
    notebookId: string;
    fileId: string;
    /** A part's Check or help button: done in the notebook, where Ellie and Max are. */
    onaction: (partId: string, kind: 'check' | 'hint' | 'refresher' | 'reveal') => void;
    /** *From the notes:* on a part: the notebook, at that notes block. */
    onnotes: (blockId: string) => void;
  } = $props();

  const doc = store.tutorial.doc;
  let parts = $state<TutorialPartView[]>([]);
  let failed = $state<string | null>(null);

  $effect(() => {
    const nb = notebookId;
    const file = fileId;
    untrack(() => void load(nb, file));
  });

  async function load(nb: string, file: string): Promise<void> {
    failed = null;
    const view = store.notebook.view;
    // The sheet's figures and the lecture pages its chips cite are the notebook's sources.
    doc.setNotebook(view && view.id === nb ? ($state.snapshot(view) as NotebookView) : null);
    try {
      await doc.openTutorial(nb, file);
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    }
    const list = (bridge() as unknown as { tutorialList?: (i: TutorialListInput) => Promise<TutorialView[]> }).tutorialList;
    if (!list) return;
    try {
      const views = await list({ notebookId: nb });
      if (nb !== notebookId || file !== fileId) return;
      parts = views.find((v) => v.fileId === file)?.parts ?? [];
    } catch {
      parts = [];
    }
  }

  const chrome = (): TutorialChromeContext => ({
    part: (partId) => {
      const found = parts.find((p) => p.partId === partId);
      return found ? ($state.snapshot(found) as TutorialPartView) : null;
    },
    onHelp: (partId, kind) => onaction(partId, kind),
    onCheck: (partId) => onaction(partId, 'check'),
    onOpenNotesBlock: (blockId) => onnotes(blockId),
    onOpenSlide: (page, _rect, anchor) => doc.openSlide(page, null, anchor),
    citation: (pages) => (pages.length === 0 ? '' : (doc.slides()?.citation(pages) ?? `p. ${pages.join(', ')}`)),
    notesHeading: () => null,
  });

  let paneWidth = $state(0);
  const fit = $derived(tutorialSheetFit(paneWidth, layout.tutorialZoom));
  const zoomStyle = $derived(layout.tutorialZoom === 1 ? null : String(layout.tutorialZoom));
  const ready = $derived(doc.docId !== null && doc.tutorialOf()?.fileId === fileId && !doc.loading);
</script>

<div class="nd tc-nd" class:nd-compact={fit.compact} aria-label="Tutorial sheet">
  <div class="nd-scroll" bind:clientWidth={paneWidth}>
    <div class="nd-sheet tc-sheet" style:zoom={zoomStyle} style:--nd-gutter={`${fit.gutter}px`}>
      {#if failed || doc.error}
        <div class="nd-state">
          <div class="nd-state-title">The sheet could not be opened</div>
          <p class="nd-state-line">{failed ?? doc.error}</p>
        </div>
      {:else if ready}
        <NotesEditor {doc} tutorial={chrome} label="Tutorial sheet" />
      {:else}
        <div class="nd-state"><div class="nd-state-title">Opening the sheet…</div></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .tc-nd { position: relative; height: 100%; }
  .tc-sheet { padding-top: 18px; }
</style>
