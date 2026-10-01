<script lang="ts">
  /**
   * **The sources panel** — the notebook's left column (`docs/research/notebooks.md` §1, §2, §8).
   *
   * It replaces the vault sidebar. Top to bottom, as the approved mockup has it:
   *
   *  - **Add sources**, the native picker into this notebook;
   *  - **the drop box**, which lights up while files are dragged anywhere over the notebook (the
   *    whole window is the drop zone, `ThreeColumn`; this box is where the learner is told so);
   *  - **Use in this notebook · All**, and one row per source: a type badge, the name, a line
   *    under it (*59 pages · ready*, *Reading…*, the error sentence when it failed), the checkbox
   *    that puts it in or out of context, and a hover × to remove it (main asks first);
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
  import { allState, badgeTone, inUseLine, sourceMeta, typeBadge } from '../lib/notebookview.js';
  import { store } from '../lib/store.svelte.js';
  import PaneSplitter from './PaneSplitter.svelte';

  let {
    over = false,
    oncollapse,
    below,
  }: {
    /** Files are being dragged over the notebook window: the drop box says where they go. */
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

  function toggleAll(e: Event): void {
    const box = e.currentTarget as HTMLInputElement;
    box.checked = all.checked;
    box.indeterminate = all.indeterminate;
    const ids = sources.filter((s) => s.status !== 'failed').map((s) => s.fileId);
    void nb.setEnabled(ids, all.next);
  }
</script>

<aside class="sources" id="files-panel" aria-label="Sources" style:width={`${layout.filesWidth}px`}>
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
        <li class="src" class:off={!source.enabled} class:failed={source.status === 'failed'}>
          <span class="badge {badgeTone(source.name)}" aria-hidden="true">{typeBadge(source.name)}</span>
          <div class="body">
            <div class="name" title={source.name}>{source.name}</div>
            <div class="meta">{sourceMeta(source)}</div>
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
          <input
            type="checkbox"
            checked={source.enabled}
            disabled={source.status === 'failed'}
            aria-label={`Use ${source.name}`}
            onchange={(e) => toggle(source, e)}
          />
        </li>
      {/each}
    </ul>

    <p class="ctxnote">Ellie, Max and the overview see only the ticked sources.</p>
  {:else if nb.view}
    <p class="ctxnote">No sources yet. Add files, or drop them anywhere on this window.</p>
  {/if}

  {#if below}
    <div class="divider"></div>
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
    overflow-y: auto;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
  }

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

  .divider { height: 1px; background: var(--hairline); margin: 14px 14px 0; flex: none; }
  .below { display: flex; flex-direction: column; min-height: 0; }
</style>
