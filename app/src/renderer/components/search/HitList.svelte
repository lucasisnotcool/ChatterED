<script lang="ts">
  /**
   * **The search column** (`docs/research/search.md` §5, mockup revision 2): the box, the scope,
   * the filters, then one list of hits, best match first, notes and slides together.
   *
   * No ownership labels (Lucas, 3 Oct): a row says only whether it is a slide or a note, where it
   * is, and two lines of it. ↑/↓ move through the hits without leaving the box; ↵ (or a double
   * click) hands the caret to the notes column at the hit; Esc clears the query.
   */
  import type { SearchHit } from '../../../shared/search/types.js';
  import type { FolderView } from '../../../shared/folders.js';
  import { folderPath } from '../../../shared/folders.js';
  import type { HitFilter, SearchStore } from '../../lib/searchstore.svelte.js';
  import { folderTree } from '../../lib/notebookview.js';
  import ExplainNote from './ExplainNote.svelte';

  let {
    search,
    folders,
    onedit,
    inputEl = $bindable(null),
  }: {
    search: SearchStore;
    folders: FolderView[];
    /** ↵ or a double click: put the caret in the notes column at the hit. */
    onedit: (hit: SearchHit) => void;
    inputEl?: HTMLInputElement | null;
  } = $props();

  const scopeName = $derived(search.folderId ? (folderPath(folders, search.folderId).map((f) => f.name).join(' › ') || 'All notebooks') : 'All notebooks');
  const shown = $derived(search.shown);
  let scopeOpen = $state(false);
  const scopes = $derived([
    { folderId: null as string | null, label: 'All notebooks', depth: 0 },
    ...folderTree(folders).map((t) => ({ ...t, depth: t.depth + 1 })),
  ]);

  const FILTERS: { id: HitFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'note', label: 'Notes' },
    { id: 'page', label: 'Slides' },
  ];

  function where(h: SearchHit): string {
    if (h.kind === 'page') return `${h.notebookName} · slide ${h.page}`;
    return [h.notebookName, ...h.section].filter(Boolean).join(' › ');
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      search.step(e.key === 'ArrowDown' ? 1 : -1);
      queueMicrotask(() => document.querySelector('.hl-row.sel')?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = (search.picked && search.hits.find((h) => h.key === search.picked)) || shown.note;
      if (hit) onedit(hit);
    } else if (e.key === 'Escape') {
      if (search.query) {
        e.preventDefault();
        search.setQuery('');
      }
    }
  }
</script>

<div class="hl">
  <label class="hl-box">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="7" cy="7" r="4.8" /><path d="M10.6 10.6 14 14" stroke-linecap="round" /></svg>
    <input
      bind:this={inputEl}
      type="search"
      placeholder={`Search slides and notes in ${scopeName}`}
      aria-label="Search slides and notes"
      autocomplete="off"
      spellcheck="false"
      value={search.query}
      oninput={(e) => search.setQuery((e.currentTarget as HTMLInputElement).value)}
      {onkeydown}
    />
    {#if search.searching}<span class="hl-spin" aria-label="Searching"></span>{/if}
  </label>

  <div class="hl-scope">
    <button type="button" class="chip on" aria-haspopup="menu" aria-expanded={scopeOpen} onclick={(e) => { e.stopPropagation(); scopeOpen = !scopeOpen; }}>
      In: {scopeName} ▾
    </button>
    {#if search.status}
      <span class="hl-hint">{search.status.notebooks} notebook{search.status.notebooks === 1 ? '' : 's'}{search.status.pending > 0 ? ` · indexing ${search.status.chunks - search.status.pending} of ${search.status.chunks}` : ''}</span>
    {/if}
    {#if scopeOpen}
      <div class="hl-menu" role="menu">
        {#each scopes as s (s.folderId ?? 'all')}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={search.folderId === s.folderId}
            style:padding-left={`${10 + s.depth * 14}px`}
            onclick={() => { scopeOpen = false; search.setScope(s.folderId); }}
          >{s.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="hl-filters" role="group" aria-label="Show">
    {#each FILTERS as f (f.id)}
      <button type="button" class="chip" class:on={search.filter === f.id} aria-pressed={search.filter === f.id} onclick={() => search.setFilter(f.id)}>{f.label}</button>
    {/each}
  </div>

  {#if search.result && search.result.mode === 'keyword'}
    <p class="hl-note">Matching words only: the search model is not available on this Mac.</p>
  {:else if search.result && search.result.pending > 0}
    <p class="hl-note">Still indexing {search.result.pending} passages; those match by words until they are done.</p>
  {/if}
  {#if search.error}<p class="hl-note err">{search.error}</p>{/if}

  <div class="hl-scroll">
    {#if !search.query.trim()}
      <div class="hl-empty">
        <p>Type what you remember. A word, a phrase, a question, even misspelt.</p>
        <p class="hl-hint">Searches the slides and notes of every notebook in scope, offline. Chats are not searched.</p>
      </div>
    {:else if search.result && search.hits.length === 0 && !search.searching}
      <div class="hl-empty"><p>Nothing in {scopeName} matches “{search.result.query}”.</p></div>
    {:else}
      <ul class="hl-list" role="listbox" aria-label="Results">
        {#each search.hits as h (h.key)}
          <li
            class="hl-row"
            class:sel={search.picked === h.key}
            role="option"
            aria-selected={search.picked === h.key}
            onclick={() => search.pick(h.key)}
            ondblclick={() => onedit(h)}
            onkeydown={(e) => { if (e.key === 'Enter') onedit(h); }}
            tabindex="-1"
          >
            <div class="hl-top">
              {#if h.kind === 'page'}
                <svg class="hl-kind" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-label="Slide"><rect x="1.5" y="3" width="13" height="9" rx="1.2" /><path d="M5 14.5h6" /></svg>
              {:else}
                <svg class="hl-kind" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-label="Note"><path d="M4 1.8h5.5L12.5 5v9.2H4z" /><path d="M6 8h4.5M6 10.5h4.5" /></svg>
              {/if}
              <span class="hl-where">{where(h)}</span>
              {#if !search.picked && shown.slide?.key === h.key}<span class="hl-shown">in slides</span>{/if}
              {#if !search.picked && shown.note?.key === h.key}<span class="hl-shown">in notes</span>{/if}
            </div>
            {#if h.kind === 'page' && h.heading}<div class="hl-head">{h.heading}</div>{/if}
            <div class="hl-snip">{h.snippet}</div>
            {#if h.explain}
              <ExplainNote body={h.explain} via={h.via === 'explain'} />
            {/if}
            {#if h.alsoIn.length > 0}
              <div class="hl-also">Also in {h.alsoIn.map((a) => `${a.notebookName} (slide ${a.page})`).join(', ')}</div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="hl-keys">
    <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
    <span><kbd>↵</kbd> edit at the hit</span>
    <span><kbd>esc</kbd> clear</span>
    <span><kbd>⌘J</kbd><kbd>⌘K</kbd><kbd>⌘L</kbd> columns</span>
  </div>
</div>

<svelte:window onclick={() => (scopeOpen = false)} />

<style>
  .hl { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .hl-box { margin: 12px 12px 0; display: flex; align-items: center; gap: 8px; border: 1.5px solid var(--indigo); border-radius: 10px; background: var(--pane); padding: 7px 10px; }
  .hl-box svg { width: 15px; height: 15px; color: var(--text-2); flex: none; }
  .hl-box input { border: 0; outline: 0; background: none; font: inherit; font-size: 14px; color: var(--text); flex: 1; min-width: 0; }
  .hl-spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--hairline); border-top-color: var(--indigo); animation: hlspin 0.8s linear infinite; flex: none; }
  @keyframes hlspin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .hl-spin { animation: none; } }
  .hl-scope { margin: 8px 12px 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; position: relative; }
  .chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--hairline); border-radius: 999px; padding: 2px 10px; background: var(--pane); font-size: 12px; color: var(--text-2); }
  .chip:hover { border-color: var(--indigo); color: var(--indigo); }
  .chip.on { background: var(--indigo-tint); border-color: transparent; color: var(--indigo); font-weight: 600; }
  .hl-hint { font-size: 12px; color: var(--text-2); }
  .hl-menu { position: absolute; top: 28px; left: 0; z-index: 10; background: var(--pane); border: 1px solid var(--hairline); border-radius: 10px; box-shadow: 0 1px 2px rgba(20, 20, 40, 0.06), 0 12px 40px rgba(20, 20, 40, 0.1); padding: 4px; display: grid; min-width: 220px; max-height: 320px; overflow-y: auto; }
  .hl-menu button { text-align: left; padding: 6px 10px; border-radius: 6px; font-size: 12.5px; }
  .hl-menu button:hover { background: var(--ground); }
  .hl-menu button[aria-checked='true'] { color: var(--indigo); font-weight: 600; }
  .hl-filters { margin: 8px 12px 6px; display: flex; gap: 4px; flex-wrap: wrap; }
  .hl-note { margin: 0 14px 6px; font-size: 11.5px; color: var(--text-2); }
  .hl-note.err { color: #8a2708; }
  .hl-scroll { flex: 1; min-height: 0; overflow-y: auto; }
  .hl-empty { padding: 18px 16px; font-size: 13px; color: var(--text-2); display: grid; gap: 6px; }
  .hl-empty p { margin: 0; }
  .hl-list { list-style: none; margin: 0; padding: 0 8px 12px; display: grid; gap: 3px; }
  .hl-row { border: 1px solid transparent; border-radius: 9px; padding: 8px 10px; display: grid; gap: 3px; cursor: pointer; outline: none; }
  .hl-row:hover { background: var(--pane); border-color: var(--hairline); }
  .hl-row.sel { background: var(--pane); border-color: var(--indigo); box-shadow: inset 3px 0 0 var(--indigo); }
  .hl-top { display: flex; gap: 6px; align-items: center; font-size: 11.5px; color: var(--text-2); min-width: 0; }
  .hl-kind { width: 14px; height: 14px; flex: none; color: var(--muted); }
  .hl-where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .hl-shown { font-size: 10px; border-radius: 4px; padding: 0 5px; background: var(--indigo); color: var(--pane); font-weight: 600; white-space: nowrap; }
  .hl-head { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hl-snip { font-size: 13px; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .hl-also { font-size: 11.5px; color: var(--text-2); }
  .hl-keys { border-top: 1px solid var(--hairline); padding: 8px 12px; font-size: 11.5px; color: var(--text-2); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  kbd { font-family: inherit; font-size: 10.5px; border: 1px solid var(--hairline); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; background: var(--pane); color: var(--text-2); }
</style>
