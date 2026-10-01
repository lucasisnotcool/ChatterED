<script lang="ts">
  /**
   * **The Notebooks home** (`docs/research/notebooks.md` §1): the app's first screen after first
   * run and consent, replacing the Library and its folder vault.
   *
   * A grid of notebooks — title, the overview's own title under it, how many sources and when it
   * was last edited, and the own-words fill as a bar — then a card that says what a drop does.
   * **New notebook** opens the picker; dropping files **anywhere** on this screen starts a
   * notebook named after the first file and opens it (the screen is one drop zone, marked
   * `data-dropzone`, so the app-wide guard stands aside here). Nothing is opened from a folder on
   * disk: each notebook keeps its own copy of its sources (answer C).
   *
   * Rename and Delete live on a card's context menu (right-click, or the ⋯ that appears on hover
   * and on focus, so neither is mouse-only). Delete is main's to confirm, with a native sheet.
   *
   * **The legacy paste-text sessions** (`'setup'`, `'room'`) are reachable from a quiet footer, as
   * they were from the Library's, and are not extended (#58).
   */
  import { bridge } from '../lib/bridge.js';
  import { createFileDrop, filesToPaths, noPathNotice } from '../lib/dropguard.js';
  import { cardLine, fillWidth } from '../lib/notebookview.js';
  import { clock, store } from '../lib/store.svelte.js';
  import type { NotebookSummary } from '../../shared/notebook.js';

  const nb = store.notebook;
  const recents = $derived((store.boot?.recentSessions ?? []).slice(0, 3));

  let over = $state(false);
  const drop = createFileDrop<File>({
    onover: (o) => (over = o),
    ondrop: (files) => {
      const { paths, refused } = filesToPaths(files, (f) => bridge().pathForFile(f));
      nb.say(noPathNotice(refused));
      if (paths.length > 0) void store.createNotebook(paths);
    },
  });

  /** The card whose menu is open, and where. One at a time. */
  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  /** The card being renamed in place. */
  let renaming = $state<string | null>(null);
  let draft = $state('');

  function openMenu(n: NotebookSummary, x: number, y: number): void {
    menu = { id: n.id, x, y };
  }

  function oncontext(e: MouseEvent, n: NotebookSummary): void {
    e.preventDefault();
    openMenu(n, e.clientX, e.clientY);
  }

  function onmore(e: MouseEvent, n: NotebookSummary): void {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(n, r.right - 4, r.bottom + 4);
  }

  function startRename(n: NotebookSummary): void {
    menu = null;
    renaming = n.id;
    draft = n.name;
  }

  async function commitRename(): Promise<void> {
    const id = renaming;
    renaming = null;
    if (id && draft.trim()) await nb.rename(id, draft);
  }

  async function remove(id: string): Promise<void> {
    menu = null;
    await nb.deleteNotebook(id);
  }

  function focusSelect(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }

  function onwindowkey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && menu) menu = null;
  }
</script>

<svelte:window onkeydown={onwindowkey} onclick={() => (menu = null)} />

<div
  class="home"
  class:over
  data-dropzone
  role="region"
  aria-label="Notebooks"
  ondragenter={drop.dragenter}
  ondragover={drop.dragover}
  ondragleave={drop.dragleave}
  ondrop={drop.drop}
>
  <div class="inner">
    <header class="top">
      <h1>Notebooks</h1>
      <button type="button" class="new" disabled={nb.busy} onclick={() => void store.newNotebook()}>
        <span aria-hidden="true">＋</span> {nb.busy ? 'Adding…' : 'New notebook'}
      </button>
    </header>
    <p class="hint">
      Drop files anywhere on this screen to start a notebook from them. Each notebook keeps its own
      copy of its sources, so moving or deleting the originals changes nothing here.
    </p>

    <div class="grid">
      {#each nb.list as n (n.id)}
        <div class="cardwrap">
          {#if renaming === n.id}
            <div class="card editing">
              <input
                class="rename"
                aria-label="Notebook name"
                bind:value={draft}
                use:focusSelect
                onkeydown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                  if (e.key === 'Escape') renaming = null;
                }}
                onblur={() => void commitRename()}
              />
              <span class="s">{cardLine(n, clock.ms)}</span>
            </div>
          {:else}
            <button
              type="button"
              class="card"
              onclick={() => void store.openNotebook(n.id)}
              oncontextmenu={(e) => oncontext(e, n)}
            >
              <span class="t">{n.name}</span>
              <span class="s">{cardLine(n, clock.ms)}</span>
              {#if n.subtitle}<span class="s sub">{n.subtitle}</span>{/if}
              <span class="fill" title={n.fill === null ? 'No objectives yet' : `${fillWidth(n.fill)} in your own words`}>
                <i style:width={fillWidth(n.fill)}></i>
              </span>
            </button>
            <button
              type="button"
              class="more"
              aria-label={`More for ${n.name}`}
              aria-haspopup="menu"
              onclick={(e) => onmore(e, n)}
            >⋯</button>
          {/if}
        </div>
      {/each}

      <button type="button" class="card new-card" onclick={() => void store.newNotebook()}>
        <span class="plus" aria-hidden="true">＋</span>
        <span>Drop files to start a notebook</span>
        <span class="s">or click to choose them</span>
      </button>
    </div>

    {#if nb.listed && nb.list.length === 0}
      <p class="empty">No notebooks yet. Start one with your lecture slides and notes for a week.</p>
    {/if}

    <footer class="legacy">
      {#if recents.length > 0}
        <span class="label">Earlier practice sessions:</span>
        {#each recents as s (s.roomId)}
          <button type="button" class="btn-link" onclick={() => void store.openRoom(s.roomId)}>{s.conceptTitle}</button>
        {/each}
        <span class="sep" aria-hidden="true">·</span>
      {/if}
      <button type="button" class="btn-link" onclick={() => store.goSetup()}>Paste text instead →</button>
    </footer>
  </div>

  {#if menu}
    {@const target = nb.list.find((x) => x.id === menu!.id)}
    {#if target}
      <div class="menu" role="menu" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
        <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); startRename(target); }}>Rename…</button>
        <button type="button" role="menuitem" class="danger" onclick={(e) => { e.stopPropagation(); void remove(target.id); }}>Delete…</button>
      </div>
    {/if}
  {/if}

  {#if over}
    <div class="overlay" aria-hidden="true">Drop to start a new notebook</div>
  {/if}
</div>

<style>
  .home { position: relative; flex: 1; overflow-y: auto; min-width: 0; min-height: 0; background: var(--ground); }
  .inner { padding: 26px 28px 40px; display: grid; gap: 16px; align-content: start; max-width: 1160px; }

  .top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .new {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 600;
  }
  .new:hover:not(:disabled) { border-color: var(--indigo); color: var(--indigo); }
  .new:disabled { opacity: 0.6; cursor: default; }
  .hint { margin: 0; font-size: 12.5px; color: var(--text-2); max-width: 70ch; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .cardwrap { position: relative; min-width: 0; }
  .card {
    width: 100%;
    height: 100%;
    /* One column that may be narrower than its content: a file name with no spaces
       ("CSXX46_AY2627_1_Week4_Tutorial2_Rational_Decision_Making_Students", from the legacy import
       of 1 Oct 2026) otherwise sized the column to itself and ran out of the card. */
    grid-template-columns: minmax(0, 1fr);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    padding: 14px;
    display: grid;
    gap: 6px;
    text-align: left;
    min-height: 150px;
    align-content: start;
  }
  .card:hover { border-color: var(--indigo); }
  .card.editing { border-color: var(--indigo); }
  .t { font-weight: 600; font-size: 14px; line-height: 1.3; padding-right: 22px; overflow-wrap: anywhere; }
  .s { font-size: 12px; color: var(--text-2); }
  .sub { color: var(--text); overflow-wrap: anywhere; }
  .fill { margin-top: auto; height: 4px; border-radius: 2px; background: var(--hairline); overflow: hidden; align-self: end; }
  .fill > i { display: block; height: 100%; background: var(--indigo); transition: width 0.5s; }
  .rename {
    font-weight: 600;
    font-size: 14px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 3px 6px;
    outline: none;
  }
  .rename:focus { border-color: var(--indigo); }

  .more {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 22px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1;
    opacity: 0;
  }
  .cardwrap:hover .more,
  .more:focus-visible { opacity: 1; }
  .more:hover { background: var(--ground); color: var(--text); }

  .new-card {
    border-style: dashed;
    background: none;
    place-items: center;
    align-content: center;
    text-align: center;
    color: var(--text-2);
    font-size: 13px;
  }
  .new-card .plus { font-size: 18px; }

  .empty { margin: 0; font-size: 13px; color: var(--text-2); }

  .legacy { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-top: 10px; font-size: 12px; }
  .legacy .label, .legacy .sep { color: var(--muted); }

  .menu {
    position: fixed;
    z-index: 40;
    transform: translateX(-100%);
    min-width: 140px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 1px 2px rgba(20, 20, 40, 0.06), 0 12px 40px rgba(20, 20, 40, 0.1);
    display: grid;
  }
  .menu button { text-align: left; padding: 6px 10px; border-radius: 6px; font-size: 12.5px; }
  .menu button:hover { background: var(--ground); }
  .menu .danger { color: #8a2708; }

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
</style>
