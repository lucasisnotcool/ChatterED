<script lang="ts">
  /**
   * **The Notebooks home** (`docs/research/notebooks.md` §1): the app's first screen after first
   * run and consent, replacing the Library and its folder vault.
   *
   * A grid of notebooks and folders, with recent practice sessions in the Recent view.
   * **New Workspace** opens a naming and parent-folder dialog; dropping files
   * **anywhere** on this screen starts a notebook named after the first file (the screen is one drop zone, marked
   * `data-dropzone`, so the app-wide guard stands aside here). Nothing is opened from a folder on
   * disk: each notebook keeps its own copy of its sources (answer C).
   *
   * Rename and Delete live on a card's context menu (right-click, or the ⋯ that appears on hover
   * and on focus, so neither is mouse-only). Delete is main's to confirm, with a native sheet.
   *
   * **Exclude from research data** (migration 032) is a tick on the same menu, for a notebook and
   * for a folder (a folder's covers everything under it), and an excluded card or folder carries a
   * small "Not in research" marker. **Duplicate** makes a deep copy beside it, excluded from
   * research data; its chats and progress are not copied (`main/notebooks/duplicate.ts`).
   *
   * **Zoom and centring.** On a large display the grid sat as a small block in the top-left
   * corner. The column is centred, and ⌘+ / ⌘− / ⌘0 (View ▸ Zoom, routed through
   * `lib/viewer.ts`) and a trackpad pinch scale it, cards and text together, as CSS `zoom` on the
   * column. The level is kept per install (`layout.homeZoom`), like the notes zoom.
   *
   * **The legacy paste-text sessions** (`'setup'`, `'room'`) remain reachable from Recent and
   * the paste-text link; their backend behavior is unchanged (#58).
   */
  import { bridge } from '../lib/bridge.js';
  import { createFileDrop, filesToPaths, noPathNotice } from '../lib/dropguard.js';
  import { HOME_ZOOM, zoomIn, zoomOut } from '../lib/layout.js';
  import { layout } from '../lib/layoutstore.svelte.js';
  import { cardLine, fillWidth } from '../lib/notebookview.js';
  import { pinchScale } from '../lib/pdfview.js';
  import { registerViewer, type ViewerCommand } from '../lib/viewer.js';
  import { clock, store } from '../lib/store.svelte.js';
  import type { NotebookSummary } from '../../shared/notebook.js';
  import { childFolders, folderPath, researchExclusionOf, type FolderView } from '../../shared/folders.js';
  import { folderNotebookCount, moveTargets, notebooksIn, type MoveTarget } from '../lib/notebookview.js';

  const nb = store.notebook;
  const recents = $derived((store.boot?.recentSessions ?? []).slice(0, 3));
  let newWorkspaceName = $state('');
  let selectedParent = $state<string | null>(null);
  let creatingFolder = $state(false);
  let newFolderName = $state('');
  let creating = $state(false);
  let recentSort = $state(false);
  let createDialog: HTMLDialogElement;

  function openCreate(): void {
    newWorkspaceName = '';
    selectedParent = nb.folderId;
    creatingFolder = false;
    newFolderName = '';
    createDialog.showModal();
  }

  async function createNamedWorkspace(): Promise<void> {
    const name = newWorkspaceName.trim();
    if (!name || nb.busy || creating) return;
    creating = true;
    try {
      let parentId = selectedParent;
      if (creatingFolder) {
        const folderName = newFolderName.trim();
        if (!folderName) return;
        const folder = await nb.createFolder(folderName, parentId);
        if (!folder) return;
        parentId = folder.id;
        selectedParent = parentId;
        creatingFolder = false;
      }
      const view = await nb.create([], name, parentId);
      if (!view) return;
      createDialog.close();
      nb.setFolder(parentId);
      layout.setFilesOpen(true);
      await store.openNotebook(view.id);
    } finally {
      creating = false;
    }
  }

  let over = $state(false);
  const drop = createFileDrop<File>({
    onover: (o) => (over = o),
    ondrop: (files) => {
      const { paths, refused } = filesToPaths(files, (f) => bridge().pathForFile(f));
      nb.say(noPathNotice(refused));
      if (paths.length > 0) void store.createNotebook(paths);
    },
  });

  // ── Folders (`docs/research/search.md` §1) ──
  const path = $derived(folderPath(nb.folders, nb.folderId));
  const here = $derived(path.at(-1) ?? null);
  const subfolders = $derived(childFolders(nb.folders, nb.folderId));
  const shown = $derived(notebooksIn(nb.list, nb.folderId));
  const shownNotebooks = $derived(recentSort
    ? [...nb.list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    : shown);

  /** The card or folder whose menu is open, and where. One at a time. `moving`: the Move to… list. */
  let menu = $state<{ kind: 'notebook' | 'folder'; id: string; x: number; y: number; moving: boolean } | null>(null);
  /** The card being renamed in place. */
  let renaming = $state<string | null>(null);
  let draft = $state('');
  /** The folder being renamed in place (a new folder starts here, name selected). */
  let renamingFolder = $state<string | null>(null);
  let folderDraft = $state('');

  function openMenu(kind: 'notebook' | 'folder', id: string, x: number, y: number): void {
    menu = { kind, id, x, y, moving: false };
  }

  function oncontext(e: MouseEvent, n: NotebookSummary): void {
    e.preventDefault();
    openMenu('notebook', n.id, e.clientX, e.clientY);
  }

  function onmore(e: MouseEvent, n: NotebookSummary): void {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu('notebook', n.id, r.right - 4, r.bottom + 4);
  }

  function onfoldercontext(e: MouseEvent, f: FolderView): void {
    e.preventDefault();
    openMenu('folder', f.id, e.clientX, e.clientY);
  }

  function onfoldermore(e: MouseEvent, f: FolderView): void {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu('folder', f.id, r.right - 4, r.bottom + 4);
  }

  // Read through these, never through `menu.kind` in the template: when a click clears `menu`,
  // the template's constants are evaluated once more before the block goes.
  const menuNotebook = $derived(menu?.kind === 'notebook' ? nb.list.find((x) => x.id === menu?.id) : undefined);
  const menuFolder = $derived(menu?.kind === 'folder' ? nb.folders.find((x) => x.id === menu?.id) : undefined);
  const menuTargets = $derived(menu?.moving ? targetsFor(menu) : []);

  function targetsFor(m: NonNullable<typeof menu>): MoveTarget[] {
    if (m.kind === 'notebook') {
      return moveTargets(nb.folders, { currentParent: nb.list.find((n) => n.id === m.id)?.folderId ?? null });
    }
    return moveTargets(nb.folders, { folderId: m.id, currentParent: nb.folders.find((f) => f.id === m.id)?.parentId ?? null });
  }

  async function moveTo(m: NonNullable<typeof menu>, folderId: string | null): Promise<void> {
    menu = null;
    if (m.kind === 'notebook') await nb.moveNotebook(m.id, folderId);
    else await nb.moveFolder(m.id, folderId);
  }

  /** Why an item is out of the research data, as the marker's tooltip; null when it is in. */
  function exclusionTitle(item: { researchExclude: boolean; folderId: string | null }): string | null {
    const why = researchExclusionOf(nb.folders, item);
    if (!why) return null;
    return why.by === 'own'
      ? 'Excluded from research data: nothing in it is in a research export.'
      : `Excluded from research data with the folder “${why.name}”.`;
  }

  function countLabel(folderId: string): string {
    const n = folderNotebookCount(nb.folders, nb.list, folderId);
    return n === 1 ? '1 notebook' : `${n} notebooks`;
  }

  function startFolderRename(f: FolderView): void {
    menu = null;
    renamingFolder = f.id;
    folderDraft = f.name;
  }

  async function commitFolderRename(): Promise<void> {
    const id = renamingFolder;
    renamingFolder = null;
    if (id && folderDraft.trim()) await nb.renameFolder(id, folderDraft);
  }

  // ── Dragging a notebook or folder onto a folder or a breadcrumb step ──
  const NOTEBOOK_TYPE = 'application/x-chattered-notebook';
  const FOLDER_TYPE = 'application/x-chattered-folder';
  /** The folder (or 'top') under a drag that can land there. */
  let dropOn = $state<string | null>(null);

  function ondragstartItem(e: DragEvent, type: string, id: string): void {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(type, id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function dragged(e: DragEvent): { type: 'notebook' | 'folder'; id: string } | null {
    const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
    if (types.includes(NOTEBOOK_TYPE)) return { type: 'notebook', id: e.dataTransfer!.getData(NOTEBOOK_TYPE) };
    if (types.includes(FOLDER_TYPE)) return { type: 'folder', id: e.dataTransfer!.getData(FOLDER_TYPE) };
    return null;
  }

  function ondragoverTarget(e: DragEvent, folderId: string | null): void {
    // Only our own cards and tiles; files from Finder are the home's own drop.
    if (!dragged(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropOn = folderId ?? 'top';
  }

  async function ondropTarget(e: DragEvent, folderId: string | null): Promise<void> {
    const d = dragged(e);
    dropOn = null;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    if (d.type === 'notebook') await nb.moveNotebook(d.id, folderId);
    else if (d.id !== folderId) await nb.moveFolder(d.id, folderId);
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

  function zoom(c: ViewerCommand): void {
    if (c === 'zoom.in') layout.setHomeZoom(zoomIn(layout.homeZoom, HOME_ZOOM));
    else if (c === 'zoom.out') layout.setHomeZoom(zoomOut(layout.homeZoom, HOME_ZOOM));
    else if (c === 'zoom.reset' || c === 'fit.width' || c === 'fit.page') layout.setHomeZoom(1);
  }
  $effect(() => registerViewer(zoom));

  /** A macOS pinch is a `wheel` with `ctrlKey`, folded into one change per frame. */
  let pinch: number | null = null;
  function onwheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const first = pinch === null;
    pinch = pinchScale(pinch ?? layout.homeZoom, e.deltaY);
    if (!first) return;
    requestAnimationFrame(() => {
      if (pinch !== null) layout.setHomeZoom(pinch);
      pinch = null;
    });
  }

  function onwindowkey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && renamingFolder) renamingFolder = null;
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
  onwheel={onwheel}
>
  <div class="inner" style:zoom={layout.homeZoom}>
    <header class="top">
      {#if path.length > 0}
        <nav class="crumbs" aria-label="Folder">
          <button
            type="button"
            class="crumb"
            class:drop={dropOn === 'top'}
            onclick={() => nb.setFolder(null)}
            ondragover={(e) => ondragoverTarget(e, null)}
            ondragleave={() => (dropOn = null)}
            ondrop={(e) => void ondropTarget(e, null)}
          >Notebooks</button>
          {#each path.slice(0, -1) as step (step.id)}
            <span class="sep" aria-hidden="true">›</span>
            <button
              type="button"
              class="crumb"
              class:drop={dropOn === step.id}
              onclick={() => nb.setFolder(step.id)}
              ondragover={(e) => ondragoverTarget(e, step.id)}
              ondragleave={() => (dropOn = null)}
              ondrop={(e) => void ondropTarget(e, step.id)}
            >{step.name}</button>
          {/each}
          <span class="sep" aria-hidden="true">›</span>
        </nav>
      {/if}
      <h1>{here?.name ?? 'Notebooks'}</h1>
      <div class="actions">
        <button type="button" class="new" onclick={openCreate}>＋ New Workspace</button>
      </div>
    </header>
    <p class="hint">Drag and drop files to start a workspace.</p>

    <div class="sort" role="group" aria-label="Workspace sorting">
      <button type="button" class:on={!recentSort} aria-pressed={!recentSort} onclick={() => (recentSort = false)}>All</button>
      <button type="button" class:on={recentSort} aria-pressed={recentSort} onclick={() => (recentSort = true)}>Recent</button>
    </div>

    <div class="grid" aria-label={recentSort ? 'Recent workspaces and sessions' : 'Folders and workspaces'}>
    {#if !recentSort}
        {#each subfolders as f (f.id)}
          <div class="cardwrap">
            {#if renamingFolder === f.id}
              <div class="folder editing">
                <span class="ficon" aria-hidden="true"></span>
                <input
                  class="rename"
                  aria-label="Folder name"
                  bind:value={folderDraft}
                  use:focusSelect
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void commitFolderRename();
                    if (e.key === 'Escape') renamingFolder = null;
                  }}
                  onblur={() => void commitFolderRename()}
                />
              </div>
            {:else}
              <button
                type="button"
                class="folder"
                class:drop={dropOn === f.id}
                draggable="true"
                onclick={() => nb.setFolder(f.id)}
                oncontextmenu={(e) => onfoldercontext(e, f)}
                ondragstart={(e) => ondragstartItem(e, FOLDER_TYPE, f.id)}
                ondragover={(e) => ondragoverTarget(e, f.id)}
                ondragleave={() => (dropOn = null)}
                ondrop={(e) => void ondropTarget(e, f.id)}
              >
                <span class="ficon" aria-hidden="true"></span>
                <span class="fname">
                  <span class="t">{f.name}</span>
                  <span class="s">{countLabel(f.id)}</span>
                  {#if exclusionTitle({ researchExclude: f.researchExclude, folderId: f.parentId })}
                    <span class="rx" title={exclusionTitle({ researchExclude: f.researchExclude, folderId: f.parentId })}>Not in research</span>
                  {/if}
                </span>
              </button>
              <button
                type="button"
                class="more"
                aria-label={`More for ${f.name}`}
                aria-haspopup="menu"
                onclick={(e) => onfoldermore(e, f)}
              >⋯</button>
            {/if}
          </div>
        {/each}
    {/if}
      {#each shownNotebooks as n (n.id)}
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
              draggable="true"
              onclick={() => void store.openNotebook(n.id)}
              oncontextmenu={(e) => oncontext(e, n)}
              ondragstart={(e) => ondragstartItem(e, NOTEBOOK_TYPE, n.id)}
            >
              <span class="t">{n.name}</span>
              <span class="s">{cardLine(n, clock.ms)}</span>
              {#if n.subtitle}<span class="s sub">{n.subtitle}</span>{/if}
              {#if exclusionTitle(n)}<span class="rx" title={exclusionTitle(n)}>Not in research</span>{/if}
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
      {#if recentSort}
        {#each recents as s (s.roomId)}
          <button type="button" class="card session-card" onclick={() => void store.openRoom(s.roomId)}>
            <span class="t">{s.conceptTitle}</span>
            <span class="s">Earlier practice session</span>
          </button>
        {/each}
      {/if}
    </div>

    {#if nb.listed && nb.list.length === 0 && !recentSort}
      <p class="empty">No workspaces yet. Create one, then add your lecture notes and tutorials.</p>
    {:else if nb.listed && here && shown.length === 0 && subfolders.length === 0 && !recentSort}
      <p class="empty">This folder is empty. Create a workspace here or drop files to start one.</p>
    {/if}

    <footer class="legacy">
      <button type="button" class="btn-link" onclick={() => store.goSetup()}>Paste text instead →</button>
    </footer>
  </div>

  <dialog class="create-dialog" bind:this={createDialog} aria-labelledby="create-workspace-title">
    <form onsubmit={(event) => { event.preventDefault(); void createNamedWorkspace(); }}>
      <h2 id="create-workspace-title">New Workspace</h2>
      <p>Give this workspace a name, then add sources after it opens.</p>
      <label for="workspace-name">Workspace name</label>
      <input id="workspace-name" placeholder="e.g. CS4225 Tutorial 1" maxlength="120" bind:value={newWorkspaceName} required />
      <label for="workspace-parent">Parent folder</label>
      <select id="workspace-parent" value={selectedParent ?? ''} onchange={(event) => (selectedParent = event.currentTarget.value || null)}>
        <option value="">Notebooks (top level)</option>
        {#each nb.folders as folder (folder.id)}
          <option value={folder.id}>{folderPath(nb.folders, folder.id).map((part) => part.name).join(' / ')}</option>
        {/each}
      </select>
      <button type="button" class="folder-toggle" aria-expanded={creatingFolder} onclick={() => (creatingFolder = !creatingFolder)}>
        {creatingFolder ? 'Use selected folder' : '＋ Create a folder here'}
      </button>
      {#if creatingFolder}
        <label for="new-folder-name">New folder name</label>
        <input id="new-folder-name" placeholder="Folder name" maxlength="120" bind:value={newFolderName} required />
      {/if}
      <div class="dialog-actions">
        <button type="button" class="cancel" onclick={() => createDialog.close()}>Cancel</button>
        <button type="submit" class="new" disabled={creating || nb.busy || !newWorkspaceName.trim() || (creatingFolder && !newFolderName.trim())}>
          {creating ? 'Creating…' : 'Create Workspace'}
        </button>
      </div>
    </form>
  </dialog>

  {#if menu && (menuNotebook || menuFolder)}
    <div class="menu" role="menu" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
      {#if menu.moving}
        <span class="mhead">Move to</span>
        {#each menuTargets as t (t.folderId ?? 'top')}
          <button
            type="button"
            role="menuitem"
            style:padding-left={`${10 + t.depth * 14}px`}
            onclick={(e) => {
              e.stopPropagation();
              if (menu) void moveTo(menu, t.folderId);
            }}
          >{t.label}</button>
        {:else}
          <span class="mnone">No other folder yet.</span>
        {/each}
      {:else if menuNotebook}
        {@const target = menuNotebook}
        <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); startRename(target); }}>Rename…</button>
        <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); if (menu) menu = { ...menu, moving: true }; }}>Move to…</button>
        <button
          type="button"
          role="menuitem"
          title="A copy beside it: sources, notes, tutorials and objectives, without the chats or progress. Excluded from research data."
          disabled={nb.busy}
          onclick={(e) => { e.stopPropagation(); menu = null; void nb.duplicate('notebook', target.id); }}
        >Duplicate</button>
        {@const inherited = researchExclusionOf(nb.folders, { researchExclude: false, folderId: target.folderId })}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={target.researchExclude || inherited !== null}
          disabled={inherited !== null}
          title={inherited && inherited.by === 'folder' ? `Excluded with the folder “${inherited.name}”.` : 'Leave this notebook, its notes, chats and progress out of research exports.'}
          onclick={(e) => { e.stopPropagation(); menu = null; void nb.setNotebookResearchExclude(target.id, !target.researchExclude); }}
        ><span class="tick" aria-hidden="true">{target.researchExclude || inherited ? '✓' : ''}</span>Exclude from research data</button>
        <button type="button" role="menuitem" class="danger" onclick={(e) => { e.stopPropagation(); void remove(target.id); }}>Delete…</button>
      {:else if menuFolder}
        {@const folder = menuFolder}
        <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); startFolderRename(folder); }}>Rename…</button>
        <button type="button" role="menuitem" onclick={(e) => { e.stopPropagation(); if (menu) menu = { ...menu, moving: true }; }}>Move to…</button>
        <button
          type="button"
          role="menuitem"
          title="A copy beside it with everything inside, without the chats or progress. Excluded from research data."
          disabled={nb.busy}
          onclick={(e) => { e.stopPropagation(); menu = null; void nb.duplicate('folder', folder.id); }}
        >Duplicate folder</button>
        {@const above = researchExclusionOf(nb.folders, { researchExclude: false, folderId: folder.parentId })}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={folder.researchExclude || above !== null}
          disabled={above !== null}
          title={above && above.by === 'folder' ? `Excluded with the folder “${above.name}”.` : 'Leave every notebook in this folder, and in folders inside it, out of research exports.'}
          onclick={(e) => { e.stopPropagation(); menu = null; void nb.setFolderResearchExclude(folder.id, !folder.researchExclude); }}
        ><span class="tick" aria-hidden="true">{folder.researchExclude || above ? '✓' : ''}</span>Exclude from research data</button>
        <button
          type="button"
          role="menuitem"
          class="danger"
          title="Its notebooks and folders move up one level. No notebook is deleted."
          onclick={(e) => {
            e.stopPropagation();
            const id = folder.id;
            menu = null;
            void nb.deleteFolder(id);
          }}
        >Delete folder</button>
      {/if}
    </div>
  {/if}

  {#if over}
    <div class="overlay" aria-hidden="true">Drop to start a new workspace</div>
  {/if}
</div>

<style>
  .home { position: relative; flex: 1; overflow-y: auto; min-width: 0; min-height: 0; background: var(--ground); }
  .inner {
    padding: 26px 28px 40px;
    display: grid;
    gap: 16px;
    align-content: start;
    max-width: 1160px;
    margin: 0 auto;
  }

  .top { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 30px; font-family: var(--font-display); font-weight: 500; line-height: 1.2; }
  .crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; font-size: 14px; color: var(--text-2); }
  .crumb { padding: 2px 6px; border-radius: 6px; color: var(--text-2); }
  .crumb:hover { background: var(--pane); color: var(--indigo); }
  .crumb.drop { background: var(--indigo-tint); color: var(--indigo); outline: 1.5px dashed var(--indigo); }
  .crumbs .sep { color: var(--muted); }
  .actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
  .new {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--indigo);
    background: var(--indigo);
    color: white;
    border-radius: 8px;
    padding: 9px 15px;
    font-size: 14px;
    font-weight: 650;
  }
  .new:hover:not(:disabled) { filter: brightness(0.93); }
  .new:disabled { opacity: 0.6; cursor: default; }
  .hint { margin: 0; font-size: 13px; color: var(--text-2); }

  .sort { display: inline-flex; justify-self: start; padding: 3px; gap: 3px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--pane); }
  .sort button { padding: 5px 13px; border-radius: 6px; color: var(--text-2); }
  .sort button.on { background: var(--indigo-tint); color: var(--indigo); font-weight: 650; }
  .folder {
    width: 100%;
    height: 100%;
    min-height: 150px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-align: left;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    padding: 11px 14px;
    min-width: 0;
  }
  .folder:hover { border-color: var(--indigo); }
  .folder.drop { border-color: var(--indigo); background: var(--indigo-tint); }
  .folder.editing { border-color: var(--indigo); }
  .folder .rename { flex: 1; min-width: 0; }
  .ficon { position: relative; width: 28px; height: 22px; border-radius: 4px; background: var(--indigo-tint); flex: none; margin-top: 3px; }
  .ficon::before { content: ''; position: absolute; left: 0; top: -4px; width: 12px; height: 6px; border-radius: 3px 3px 0 0; background: var(--indigo-tint); }
  .fname { display: grid; min-width: 0; }
  .fname .t { padding-right: 18px; }
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

  .session-card { align-content: start; }

  .empty { margin: 0; font-size: 13px; color: var(--text-2); }

  .legacy { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-top: 10px; font-size: 12px; }
  .create-dialog { width: min(450px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow-y: auto; border: 1px solid var(--hairline); border-radius: 14px; background: var(--pane); color: var(--text); padding: 24px; box-shadow: 0 16px 70px rgb(20 20 40 / 18%); }
  .create-dialog::backdrop { background: rgb(15 24 32 / 46%); }
  .create-dialog form { display: grid; gap: 10px; }
  .create-dialog h2 { margin: 0; font: 500 25px/1.2 var(--font-display); }
  .create-dialog p { margin: 0 0 10px; color: var(--text-2); }
  .create-dialog label { font-weight: 650; }
  .create-dialog input, .create-dialog select { width: 100%; padding: 10px 11px; border: 1px solid var(--hairline); border-radius: 8px; background: var(--ground); color: var(--text); }
  .folder-toggle { justify-self: start; color: var(--indigo); font-weight: 600; padding: 4px 0; }
  .dialog-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 14px; }
  .cancel { padding: 9px 12px; border-radius: 8px; border: 1px solid var(--hairline); }

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
  .menu .mhead { padding: 4px 10px 2px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-2); }
  .menu .mnone { padding: 6px 10px; font-size: 12.5px; color: var(--text-2); }
  .menu .danger { color: #8a2708; }
  .menu button:disabled { color: var(--text-2); cursor: default; }
  .menu button:disabled:hover { background: none; }
  .menu .tick { display: inline-block; width: 14px; }
  /* Excluded from research data: a quiet marker, not a warning. */
  .rx {
    justify-self: start;
    font-size: 10.5px;
    letter-spacing: 0.02em;
    color: var(--text-2);
    border: 1px dashed var(--hairline);
    border-radius: 999px;
    padding: 0 7px;
    line-height: 16px;
  }

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
