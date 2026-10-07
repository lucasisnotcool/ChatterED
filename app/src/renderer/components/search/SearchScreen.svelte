<script lang="ts">
  /**
   * **The search page** (`docs/research/search.md` §5; mockup revision 2, agreed 3 Oct): slides |
   * notes | results, left to right, toggled with ⌘J ⌘K ⌘L.
   *
   * - **Slides** (`DeckColumn`): the hit's whole deck, scrolled to its slide.
   * - **Notes**: the hit notebook's live notes, editable in place (↵ on a hit puts the caret
   *   there; Esc goes back to the box). It is the notebook's own `NotesPane` on the one `DocStore`:
   *   the notebook view and this page are never on screen together, so the store moves between
   *   them. Ellie and Max do not run here (no room is opened); their edits made elsewhere still
   *   arrive. Switching to a hit in another notebook flushes the doc first.
   * - **Results** (`HitList`): one list, best match first.
   * - **A tutorial hit** (§10) puts its sheet in the notes column instead (`TutorialColumn`, on the
   *   tutorial store's own `DocStore`), highlighted at the hit; *Open in notebook* opens the
   *   notebook with the tutorial column at that block.
   *
   * The arithmetic of the columns is `lib/searchlayout.ts`: the results keep their width whatever
   * happens to the other two, and a column squeezed below usable hides.
   */
  import { onDestroy, untrack } from 'svelte';
  import PaneSplitter from '../PaneSplitter.svelte';
  import NotesPane from '../notes/NotesPane.svelte';
  import HitList from './HitList.svelte';
  import DeckColumn from './DeckColumn.svelte';
  import ExplainNote from './ExplainNote.svelte';
  import TutorialColumn from './TutorialColumn.svelte';
  import { tutorialHitLabel } from '../../lib/searchhits.js';
  import type { DocStore } from '../../lib/docstore.svelte.js';
  import { store } from '../../lib/store.svelte.js';
  import { bridge } from '../../lib/bridge.js';
  import { searchWidths } from '../../lib/searchlayout.js';
  import { runViewerCommand } from '../../lib/viewer.js';
  import type { SearchHit } from '../../../shared/search/types.js';

  const search = store.search;
  let width = $state(0);
  const w = $derived(searchWidths(width, search.columns));
  const shown = $derived(search.shown);
  let inputEl = $state<HTMLInputElement | null>(null);

  // ⇧⌘F and the rail ask for the box: the results column is shown and the cursor put in it.
  $effect(() => {
    void store.searchFocus;
    untrack(() => {
      if (!search.columns.hits) search.setColumns({ hits: true });
      setTimeout(() => inputEl?.focus(), 0);
    });
  });

  // ── The notes column: whose notebook is mounted, and the hit in it ──────────────────────
  let noteNb = $state<string | null>(null);
  /** The tutorial sheet the column shows instead of the notes (a tutorial hit), or null. */
  let noteTut = $state<string | null>(null);
  let token = 0;
  /** A hit whose block should get the caret once it is on screen (↵, double click). */
  let caretFor: string | null = null;
  const tutDoc = store.tutorial.doc;

  $effect(() => {
    const hit = shown.note;
    untrack(() => void showNote(hit));
  });

  async function showNote(hit: SearchHit | null): Promise<void> {
    const mine = (token += 1);
    store.doc.markSearchHit(null);
    tutDoc.markSearchHit(null);
    if (!hit || !hit.blockId) return;
    if (noteNb !== hit.notebookId) {
      // Whatever was typed in the notebook on screen is written before another replaces it.
      await Promise.all([store.doc.flush(), tutDoc.flush()]);
      const view = await bridge().notebookGet({ notebookId: hit.notebookId });
      if (mine !== token || !view) return;
      store.notebook.view = view;
      noteNb = hit.notebookId;
    }
    noteTut = hit.tutorial?.fileId ?? null;
    markWhenReady(hit, mine);
  }

  /** The doc on screen for a hit: the notebook's notes, or its tutorial sheet's. */
  function docFor(hit: SearchHit): DocStore | null {
    if (!hit.tutorial) return store.doc.fileId === hit.notebookId && !store.doc.tutorialOf() ? store.doc : null;
    const t = tutDoc.tutorialOf();
    return t && t.notebookId === hit.notebookId && t.fileId === hit.tutorial.fileId ? tutDoc : null;
  }

  /** The doc may still be loading: try for a few seconds, then give up quietly. */
  function markWhenReady(hit: SearchHit, mine: number): void {
    let tries = 0;
    const attempt = (): void => {
      if (mine !== token) return;
      const doc = docFor(hit);
      if (doc && hit.blockId && doc.markSearchHit(hit.blockId)) {
        doc.scrollToBlock(hit.blockId, { flash: false });
        // A sheet that has just mounted settles after the first scroll (its part chrome folds the
        // course admin and draws the cards): once more when it has, or the hit ends up off screen.
        const blockId = hit.blockId;
        if (hit.tutorial) setTimeout(() => mine === token && doc.scrollToBlock(blockId, { flash: false }), 400);
        if (caretFor === hit.key) {
          caretFor = null;
          doc.placeCaret(hit.blockId);
        }
        return;
      }
      if ((tries += 1) < 80) setTimeout(attempt, 100);
    };
    attempt();
  }

  /** ↵ or a double click: stay here and edit the notes at the hit (Lucas, 3 Oct). */
  function edit(hit: SearchHit): void {
    if (!hit.blockId) return;
    caretFor = hit.key;
    if (!search.columns.notes) search.setColumns({ notes: true });
    if (search.picked !== hit.key) search.pick(hit.key);
    else void showNote(hit);
  }

  /**
   * Esc in the notes goes back to the search box. Caught on the way down (capture), because
   * ProseMirror's base keymap binds Esc to "select the parent node" and would otherwise keep it.
   * Esc inside the editor's own fields (a title being renamed, the formula editor) is theirs.
   */
  function onnoteskey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.ProseMirror') || target.closest('input, textarea, math-field, [data-own-escape]')) return;
    e.preventDefault();
    e.stopPropagation();
    inputEl?.focus();
    inputEl?.select();
  }

  /**
   * "Open notebook": the full notebook, with Ellie and Max, at the block on screen. For a tutorial
   * hit, the notebook with the tutorial column on that sheet, at the hit's block; `then` runs there
   * (a part's Check or help, pressed on this page).
   */
  async function openNotebook(at?: { notesBlock?: string; then?: () => void }): Promise<void> {
    const hit = shown.note;
    const id = noteNb;
    if (!id) return;
    const sheet = at?.notesBlock ? null : noteTut;
    const blockId = at?.notesBlock ?? hit?.blockId ?? null;
    await Promise.all([store.doc.flush(), tutDoc.flush()]);
    tutDoc.markSearchHit(null);
    await store.openNotebook(id);
    if (sheet) {
      void openSheetWhenReady(id, sheet, blockId, at?.then);
      return;
    }
    if (!blockId) return;
    let tries = 0;
    const attempt = (): void => {
      if (store.screen !== 'notebook') return;
      if (store.doc.fileId === id && store.doc.markSearchHit(null)) {
        store.doc.scrollToBlock(blockId, { flash: true });
        return;
      }
      if ((tries += 1) < 60) setTimeout(attempt, 100);
    };
    attempt();
  }

  /** The notebook's shell hands the tutorial store its notebook as it mounts: then open the sheet. */
  async function openSheetWhenReady(id: string, sheet: string, blockId: string | null, then?: () => void): Promise<void> {
    for (let tries = 0; tries < 60; tries++) {
      if (store.screen !== 'notebook' || store.notebook.id !== id) return;
      if (store.tutorial.notebookId === id) {
        if (blockId) await store.tutorial.openAt(sheet, blockId);
        else await store.tutorial.open(sheet);
        then?.();
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** A part's Check or help on this page: in the notebook, at the part, where Max answers. */
  function partAction(partId: string, kind: 'check' | 'hint' | 'refresher' | 'reveal'): void {
    void openNotebook({
      then: () => {
        if (kind === 'check') void store.tutorial.check(partId);
        else void store.tutorial.help(partId, kind);
      },
    });
  }

  // ── Ctrl or ⌘ with + − 0 over the notes: their text size, not the app's ─────────────────
  // ⌘ arrives through the View menu and NotesPane's viewer registration; Ctrl is caught here.
  let overNotes = false;
  function onwindowkey(e: KeyboardEvent): void {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    const inNotes = overNotes || (document.activeElement?.closest('.sp-notes') ?? null) !== null;
    if (!inNotes) return;
    const command = e.key === '=' || e.key === '+' ? 'zoom.in' : e.key === '-' ? 'zoom.out' : e.key === '0' ? 'zoom.reset' : null;
    if (!command) return;
    e.preventDefault();
    runViewerCommand(command);
  }

  onDestroy(() => {
    store.doc.markSearchHit(null);
    tutDoc.markSearchHit(null);
  });

  // The slides column's page and what to outline on it.
  const slideLabel = $derived(search.picked ? (shown.slide?.kind === 'page' ? 'This hit' : 'Where this note came from') : 'Best match');
  const regionText = $derived(shown.slide ? (shown.slide.kind === 'note' ? shown.slide.snippet : search.query) : '');
</script>

<svelte:window onkeydown={onwindowkey} />

<div class="sp" bind:clientWidth={width}>
  {#if search.columns.slides && !w.slidesSqueezed}
    <section class="sp-col sp-slides" style:width={`${w.slides}px`} aria-label="Slides">
      <header class="sp-head">
        <button type="button" class="sp-hide" title="Hide the slides (⌘J)" aria-label="Hide the slides" onclick={() => search.setColumns({ slides: false })}>⟨</button>
        <span class="sp-title">Slides</span>
        {#if shown.slide && shown.slide.page !== null}
          <span class="sp-sub">{shown.slide.notebookName} · p.{shown.slide.page}</span>
        {/if}
      </header>
      <div class="sp-body">
        {#if shown.slide && shown.slide.page !== null}
          <DeckColumn notebookId={shown.slide.notebookId} page={shown.slide.page} {regionText} label={slideLabel} />
        {:else}
          <p class="sp-empty">The deck of the best hit shows here, scrolled to its slide.</p>
        {/if}
      </div>
    </section>
    {#if search.columns.notes}
      <PaneSplitter
        wide
        size={w.slides}
        bounds={w.slidesBounds}
        sign={1}
        label="Resize the slides and notes"
        onsize={(n) => search.setColumns({ slidesWidth: n })}
        oncollapse={() => search.setColumns({ slides: false })}
        oncollapseOther={() => search.setColumns({ notes: false })}
      />
    {/if}
  {:else}
    <button type="button" class="sp-strip" style:width={`${w.slides}px`} title={w.slidesSqueezed ? 'Too narrow for the slides beside the notes' : 'Show the slides (⌘J)'} onclick={() => search.setColumns({ slides: true, notes: w.slidesSqueezed ? false : search.columns.notes })}>
      <span>Slides</span>
    </button>
  {/if}

  {#if search.columns.notes}
    <!-- Esc from inside the editor and the pointer for Ctrl +/− are caught on the column. -->
    <section
      class="sp-col sp-notes"
      style:width={`${w.notes}px`}
      aria-label="Notes"
      onkeydowncapture={onnoteskey}
      onpointerenter={() => (overNotes = true)}
      onpointerleave={() => (overNotes = false)}
    >
      <header class="sp-head">
        <button type="button" class="sp-hide" title="Hide the notes (⌘K)" aria-label="Hide the notes" onclick={() => search.setColumns({ notes: false })}>⟨</button>
        <span class="sp-title">{noteTut ? 'Tutorial' : 'Notes'}</span>
        {#if shown.note}
          <span class="sp-sub">{shown.note.notebookName}{shown.note.tutorial ? ` · ${tutorialHitLabel(shown.note.tutorial)}` : ''}</span>
        {/if}
        {#if noteNb}
          <button
            type="button"
            class="sp-open"
            title={noteTut ? 'Open this notebook with the tutorial at this part, with Ellie and Max' : 'Open this notebook, with Ellie and Max'}
            onclick={() => void openNotebook()}
          >{noteTut ? 'Open in notebook' : 'Open notebook'}</button>
        {/if}
      </header>
      {#if shown.note?.explain}
        <!-- The hit block's stored explain (migration 033): open when it is what matched. -->
        {#key shown.note.key}
          <div class="sp-explain">
            <ExplainNote body={shown.note.explain} via={shown.note.via === 'explain'} open={shown.note.via === 'explain'} variant="panel" />
          </div>
        {/key}
      {/if}
      <div class="sp-body sp-notesbody">
        {#if noteNb && shown.note && noteTut}
          <TutorialColumn
            notebookId={noteNb}
            fileId={noteTut}
            onaction={partAction}
            onnotes={(blockId) => void openNotebook({ notesBlock: blockId })}
          />
        {:else if noteNb && shown.note}
          {#key noteNb}
            <NotesPane fileId={noteNb} />
          {/key}
        {:else}
          <p class="sp-empty">Your notes for the best hit show here, scrolled to it, ready to edit.</p>
        {/if}
      </div>
    </section>
  {:else}
    <button type="button" class="sp-strip" style:width={`${w.notes}px`} title="Show the notes (⌘K)" onclick={() => search.setColumns({ notes: true })}>
      <span>Notes</span>
    </button>
  {/if}

  {#if !search.columns.slides && !search.columns.notes}
    <div class="sp-filler">
      <p>Slides and notes are hidden. <kbd>⌘J</kbd> shows the slides, <kbd>⌘K</kbd> the notes.</p>
    </div>
  {/if}

  {#if search.columns.hits}
    <PaneSplitter
      wide
      size={w.hits}
      bounds={w.hitsBounds}
      sign={-1}
      label="Resize the results"
      onsize={(n) => search.setColumns({ hitsWidth: n })}
      oncollapseOther={() => search.setColumns(search.columns.notes ? { notes: false } : { slides: false })}
    />
    <section class="sp-col sp-hits" style:width={`${w.hits}px`} aria-label="Search">
      <HitList {search} folders={store.notebook.folders} onedit={edit} bind:inputEl />
    </section>
  {:else}
    <button type="button" class="sp-strip" style:width={`${w.hits}px`} title="Show the results (⌘L)" onclick={() => search.setColumns({ hits: true })}>
      <span>Results</span>
    </button>
  {/if}
</div>

<style>
  .sp { flex: 1; min-width: 0; min-height: 0; display: flex; background: var(--ground); }
  .sp-col { flex: none; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .sp-notes { background: var(--pane); }
  .sp-hits { border-left: 1px solid var(--hairline); }
  .sp-slides { border-right: 1px solid var(--hairline); }
  .sp-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--hairline); min-height: 42px; font-size: 12.5px; background: var(--pane); }
  .sp-title { font-weight: 600; font-size: 13px; }
  .sp-sub { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .sp-hide { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--hairline); color: var(--text-2); display: grid; place-items: center; font-size: 12px; flex: none; }
  .sp-hide:hover { color: var(--indigo); border-color: var(--indigo); }
  .sp-open { margin-left: auto; border: 1px solid var(--hairline); border-radius: 6px; padding: 3px 9px; font-size: 12px; color: var(--text-2); flex: none; }
  .sp-open:hover { color: var(--indigo); border-color: var(--indigo); }
  .sp-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .sp-notesbody > :global(*) { flex: 1; min-height: 0; }
  .sp-explain { padding: 8px 12px; border-bottom: 1px solid var(--hairline); background: var(--pane); flex: none; }
  .sp-empty { margin: 24px 18px; font-size: 13px; color: var(--text-2); }
  .sp-strip { flex: none; height: 100%; border: 0; border-right: 1px solid var(--hairline); background: var(--ground); color: var(--text-2); display: grid; place-items: start center; padding-top: 14px; }
  .sp-strip:hover { background: var(--pane); color: var(--indigo); }
  .sp-strip span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 12px; font-weight: 600; }
  .sp-filler { flex: 1; min-width: 0; display: grid; place-items: center; color: var(--text-2); font-size: 13px; padding: 20px; text-align: center; }
  /* The picked hit's block in the notes (`pm/searchhit.ts`). */
  .sp-notes :global(.nd-search-hit) {
    background: var(--indigo-tint);
    box-shadow: inset 3px 0 0 var(--indigo);
    border-radius: 6px;
  }
  kbd { font-family: inherit; font-size: 11px; border: 1px solid var(--hairline); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; background: var(--pane); }
</style>
