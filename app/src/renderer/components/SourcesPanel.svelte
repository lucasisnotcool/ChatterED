<script lang="ts">
  /**
   * **The sources panel** — the notebook's left column (`docs/research/notebooks.md` §1, §2, §8).
   *
   * It replaces the vault sidebar. Top to bottom, as the approved mockup has it:
   *
   *  - **Add sources**, the native picker into this notebook;
   *  - **the drop box**, which lights up while files are dragged over this column, the one place a
   *    dropped file becomes a source (`ThreeColumn`, 2026-10-04; an image dropped on a sheet goes
   *    into that sheet instead);
   *  - **Use in this notebook · All**, and one row per source: a type badge, the name, a line
   *    under it (*59 pages · ready*, *Reading…*, the error sentence when it failed), the checkbox
   *    that puts it in or out of context, and a hover × to remove it (main asks first);
   *  - **a role** on each row (`docs/research/tutorials.md` §1): *Lecture*, *Tutorial* or
   *    *Solutions*, changed from the badge's "Use as…" menu. A tutorial row opens its sheet beside
   *    the notes (**Open**) and says how far it has got; a solutions row says it is hidden;
   *  - the sentence that says what the checkboxes mean, once;
   *  - then whatever the shell hands down: the overview's outline with its fills (`NotesMap`).
   *
   * **Nothing here is optimistic.** A checkbox is drawn from `source.enabled` as main last pushed
   * it, and the click asks main; the push brings it back. A box that ticked itself before main
   * agreed would say a source was in Ellie's context when it was not, which is the one thing the
   * checkbox exists to tell the truth about.
   */
  import type { Snippet } from 'svelte';
  import type { NotebookSourceView } from '../../shared/notebook.js';
  import { FILES } from '../lib/layout.js';
  import { layout } from '../lib/layoutstore.svelte.js';
  import { SOURCE_ROLES, type SourceRole } from '../../shared/tutorial.js';
  import {
    allState,
    badgeTone,
    inUseLine,
    roleHint,
    roleLabel,
    roleOf,
    sourceMeta,
    tutorialLine,
    typeBadge,
  } from '../lib/notebookview.js';
  import { store } from '../lib/store.svelte.js';
  import PaneSplitter from './PaneSplitter.svelte';

  let {
    over = false,
    oncollapse,
    below,
  }: {
    /** Files are being dragged over this column: the drop box says they go in here. */
    over?: boolean;
    /** Dragging the edge all the way in (or Enter on it) closes the panel. */
    oncollapse?: () => void;
    /** Under the sources: the overview's outline. */
    below?: Snippet;
  } = $props();

  const nb = store.notebook;
  const sources = $derived<NotebookSourceView[]>(nb.view?.sources ?? []);
  const all = $derived(allState(sources));
  const count = $derived(inUseLine(sources));

  /** The All box's indeterminate state is a DOM property, not an attribute. */
  let allBox = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (allBox) allBox.indeterminate = all.indeterminate;
  });

  function toggle(source: NotebookSourceView, e: Event): void {
    const box = e.currentTarget as HTMLInputElement;
    const wanted = box.checked;
    // Back to main's state until main answers; the push redraws it.
    box.checked = source.enabled;
    void nb.setEnabled([source.fileId], wanted);
  }

  // ── roles (`tutorials.md` §1) ──────────────────────────────────────────────────────────────
  const tut = store.tutorial;

  /** The row whose "Use as…" menu is open, and where: fixed, so the panel's scroll never clips it. */
  let menuFor = $state<string | null>(null);
  let menuAt = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  const MENU = { width: 236, height: 196 };

  function openMenu(fileId: string, e: MouseEvent): void {
    e.stopPropagation();
    if (menuFor === fileId) {
      menuFor = null;
      return;
    }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const below = box.bottom + 4 + MENU.height <= window.innerHeight - 8;
    menuAt = {
      left: Math.max(8, Math.min(box.left, window.innerWidth - MENU.width - 8)),
      top: below ? box.bottom + 4 : Math.max(8, box.top - 4 - MENU.height),
    };
    menuFor = fileId;
  }

  async function setRole(source: NotebookSourceView, role: SourceRole): Promise<void> {
    menuFor = null;
    if (roleOf(source) === role) return;
    const result = await tut.setRole(source.fileId, role);
    if (result.error) nb.say(result.error);
    if (result.view && nb.view?.id === result.view.id) nb.view = result.view;
    // A sheet just marked as a tutorial opens beside the notes: that is where it is answered.
    if (role === 'tutorial' && result.view) void tut.open(source.fileId);
  }

  /** What a row says under its name, by role. */
  function metaOf(source: NotebookSourceView): string {
    if (source.status !== 'ready') return sourceMeta(source);
    const role = roleOf(source);
    if (role === 'solutions') return 'Hidden: only used to check your answers';
    if (role === 'tutorial') return tutorialLine(tut.viewOf(source.fileId), tut.reading[source.fileId] ?? null);
    return sourceMeta(source);
  }

  $effect(() => {
    if (!menuFor) return;
    const close = (): void => {
      menuFor = null;
    };
    const onkey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onkey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onkey);
    };
  });

  function toggleAll(e: Event): void {
    const box = e.currentTarget as HTMLInputElement;
    box.checked = all.checked;
    box.indeterminate = all.indeterminate;
    const ids = sources.filter((s) => s.status !== 'failed').map((s) => s.fileId);
    void nb.setEnabled(ids, all.next);
  }
</script>

<aside class="sources" id="files-panel" aria-label="Sources" style:width={`${layout.filesWidth}px`}>
  <div class="top">
  <header class="head">
    <span class="title">Sources</span>
    {#if count}<span class="sub">{count}</span>{/if}
  </header>

  <button type="button" class="add" disabled={nb.busy} onclick={() => void nb.pickAndAdd()}>
    <span aria-hidden="true">＋</span> {nb.busy ? 'Adding…' : 'Add sources'}
  </button>

  <div class="drop" class:over aria-hidden="true">
    Drop files here
    <small>PDF, Word, Markdown, text, images</small>
  </div>

  {#if sources.length > 0}
    <div class="selall">
      <span>Use in this notebook</span>
      <label>
        <input type="checkbox" bind:this={allBox} checked={all.checked} onchange={toggleAll} aria-label="Use every source" />
        All
      </label>
    </div>

    <ul class="list">
      {#each sources as source (source.fileId)}
        {@const role = roleOf(source)}
        <li
          class="src"
          class:off={!source.enabled && role !== 'solutions'}
          class:failed={source.status === 'failed'}
          class:hidden-role={role === 'solutions'}
          class:open={tut.openFileId === source.fileId}
        >
          <span class="badge {badgeTone(source.name)}" aria-hidden="true">{typeBadge(source.name)}</span>
          <div class="body">
            <div class="name" title={source.name}>{source.name}</div>
            <div class="meta">
              <button
                type="button"
                class="role {role}"
                aria-haspopup="menu"
                aria-expanded={menuFor === source.fileId}
                title="What this source is in the notebook. Click to change it."
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => openMenu(source.fileId, e)}
              >{roleLabel(role)}<span class="caret" aria-hidden="true">▾</span></button>
              <span class="metatext" title={metaOf(source)}>{metaOf(source)}</span>
            </div>
            {#if role === 'tutorial' && source.status === 'ready'}
              <div class="tutrow">
                <button
                  type="button"
                  class="opentut"
                  aria-pressed={tut.openFileId === source.fileId}
                  onclick={() => (tut.openFileId === source.fileId ? tut.close() : void tut.open(source.fileId))}
                >{tut.openFileId === source.fileId ? 'Close' : 'Open'}</button>
                {#if tut.localError[source.fileId] || tut.viewOf(source.fileId)?.status === 'failed'}
                  <button type="button" class="retry" onclick={() => void tut.retry(source.fileId)}>Retry</button>
                {/if}
              </div>
            {/if}
            {#if menuFor === source.fileId}
              <div
                class="rolemenu"
                role="menu"
                aria-label={`Use ${source.name} as`}
                tabindex="-1"
                style:left={`${menuAt.left}px`}
                style:top={`${menuAt.top}px`}
                onpointerdown={(e) => e.stopPropagation()}
              >
                <div class="rolemenu-head">Use as…</div>
                {#each SOURCE_ROLES as option (option)}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={role === option}
                    class="rolemenu-item"
                    onclick={() => void setRole(source, option)}
                  >
                    <span class="tick" aria-hidden="true">{role === option ? '✓' : ''}</span>
                    <span class="rolemenu-text">
                      <span class="rolemenu-name">{roleLabel(option)}</span>
                      <span class="rolemenu-hint">{roleHint(option)}</span>
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if source.status === 'reading'}
              <div class="bar" role="progressbar" aria-label={`Reading ${source.name}`}><i></i></div>
            {:else if source.status === 'failed' && source.error}
              <div class="error">{source.error}</div>
            {/if}
          </div>
          <button
            type="button"
            class="remove"
            title={`Remove ${source.name} from this notebook`}
            aria-label={`Remove ${source.name}`}
            onclick={() => void nb.remove(source.fileId)}
          >×</button>
          {#if role === 'solutions'}
            <span aria-hidden="true"></span>
          {:else}
          <input
            type="checkbox"
            checked={source.enabled}
            disabled={source.status === 'failed'}
            aria-label={`Use ${source.name}`}
            onchange={(e) => toggle(source, e)}
          />
          {/if}
        </li>
      {/each}
    </ul>

    <p class="ctxnote">Ellie, Max and the overview see only the ticked sources.</p>
  {:else if nb.view}
    <p class="ctxnote">No sources yet. Add files, or drop them anywhere on this window.</p>
  {/if}
  </div>

  {#if below}
    <div class="below">{@render below()}</div>
  {/if}
</aside>

<!-- The panel's right edge. Its width is the learner's and survives a relaunch. -->
<PaneSplitter
  size={layout.filesWidth}
  bounds={FILES}
  sign={1}
  label="Resize the sources panel"
  controls="files-panel"
  onsize={(width) => layout.setFilesWidth(width)}
  {oncollapse}
/>

<style>
  .sources {
    width: 244px; /* overridden inline by the learner's width */
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
  }
  /* The sources take what they need and scroll past about half the column; the outline below
     takes the rest, so neither can push the other off the bottom of the window. */
  .top { flex: 0 1 auto; max-height: 58%; overflow-y: auto; min-height: 0; padding-bottom: 12px; }

  .head { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px 10px; }
  .title { font-size: 13px; font-weight: 600; }
  .sub { margin-left: auto; font-size: 11.5px; color: var(--text-2); }

  .add {
    margin: 0 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .add:hover:not(:disabled) { border-color: var(--indigo); color: var(--indigo); }
  .add:disabled { opacity: 0.6; cursor: default; }

  .drop {
    margin: 10px 14px 4px;
    border: 1.5px dashed var(--muted);
    border-radius: 10px;
    padding: 12px 10px;
    text-align: center;
    color: var(--text-2);
    font-size: 12px;
    display: grid;
    gap: 2px;
    transition: background 120ms ease-out, border-color 120ms ease-out;
  }
  .drop small { font-size: 11px; color: var(--muted); }
  .drop.over { border-color: var(--indigo); background: var(--indigo-tint); color: var(--indigo); }

  .selall {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 4px;
    font-size: 11.5px;
    color: var(--text-2);
  }
  .selall label { display: inline-flex; align-items: center; gap: 5px; }

  .list { list-style: none; margin: 0; padding: 0 8px; display: grid; gap: 1px; }
  .src {
    position: relative;
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) 16px 16px;
    gap: 7px;
    align-items: center;
    padding: 6px 6px;
    border-radius: 8px;
  }
  .src:hover { background: var(--pane); }
  .badge {
    width: 26px;
    height: 30px;
    border-radius: 4px;
    border: 1px solid var(--hairline);
    background: var(--pane);
    display: grid;
    place-items: end center;
    padding-bottom: 3px;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #b91c1c;
  }
  .badge.doc { color: var(--indigo); }
  .badge.plain { color: var(--text-2); }
  .body { min-width: 0; }
  .name { font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 10.5px; color: var(--text-2); }
  .error { margin-top: 2px; font-size: 10.5px; line-height: 1.4; color: #8a2708; }

  /* The role: a quiet pill for a lecture, the learner's colour for a tutorial, struck grey for
     solutions. Its click opens "Use as…". */
  .meta { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .metatext { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 5px;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 15px;
    color: var(--text-2);
    background: var(--pane);
  }
  .role:hover,
  .role[aria-expanded='true'] { border-color: var(--indigo); color: var(--indigo); }
  .role.tutorial { border-color: #c9c5f3; background: var(--indigo-tint); color: var(--indigo); }
  .role.solutions { border-style: dashed; color: var(--text-2); }
  .caret { margin-left: 2px; font-size: 8px; opacity: 0.75; }
  .src.hidden-role .name { color: var(--text-2); }
  .src.open { background: var(--indigo-tint); }

  .tutrow { display: flex; gap: 6px; margin-top: 4px; }
  .opentut,
  .retry {
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 999px;
    padding: 1px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--indigo);
  }
  .opentut:hover,
  .retry:hover { border-color: var(--indigo); }
  .opentut[aria-pressed='true'] { color: var(--text-2); font-weight: 500; }

  .rolemenu {
    position: fixed;
    z-index: 40;
    width: 236px;
    padding: 4px;
    border: 1px solid var(--hairline);
    border-radius: 10px;
    background: var(--pane);
    box-shadow: 0 10px 28px rgb(20 20 40 / 16%);
  }
  .rolemenu-head { padding: 4px 8px 2px; font-size: 10.5px; color: var(--muted); font-weight: 600; }
  .rolemenu-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    text-align: left;
  }
  .rolemenu-item:hover,
  .rolemenu-item:focus-visible { background: var(--ground); outline: none; }
  .tick { width: 12px; flex: none; color: var(--indigo); font-size: 11px; line-height: 1.5; }
  .rolemenu-text { display: grid; gap: 1px; }
  .rolemenu-name { font-size: 12px; color: var(--text); font-weight: 600; }
  .rolemenu-hint { font-size: 10.5px; line-height: 1.35; color: var(--text-2); }
  .src.off .name,
  .src.off .badge { opacity: 0.5; }
  .src input { width: 14px; height: 14px; accent-color: var(--indigo); margin: 0; }

  /* An indeterminate bar: main pushes reading → ready, with no percentage to draw. */
  .bar { height: 3px; border-radius: 2px; background: var(--hairline); overflow: hidden; margin-top: 4px; position: relative; }
  .bar > i {
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: var(--indigo);
    border-radius: 2px;
    animation: reading 1.1s ease-in-out infinite;
  }
  @keyframes reading {
    from { transform: translateX(-100%); }
    to { transform: translateX(250%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar > i { animation: none; width: 100%; opacity: 0.5; }
  }

  /* The × is there on hover and on keyboard focus, never in the way of the name otherwise. */
  .remove {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1;
    color: var(--text-2);
    opacity: 0;
  }
  .src:hover .remove,
  .remove:focus-visible { opacity: 1; }
  .remove:hover { color: #8a2708; background: var(--ground); }

  .ctxnote { margin: 8px 14px 0; font-size: 11px; line-height: 1.5; color: var(--text-2); }

  .below { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
  /* The outline's own cap (46%) was for sharing the column with a file tree; here it has the
     rest of the column to itself. */
  .below > :global(.map) { max-height: none; flex: 1 1 auto; }
</style>
