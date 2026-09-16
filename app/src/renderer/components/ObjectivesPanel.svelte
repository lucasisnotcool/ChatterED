<script lang="ts">
  /**
   * The learning-objectives panel (`docs/research/learning-objectives.md` §5).
   *
   * **What the learner has to be able to say about this deck, and which of it they have said.**
   * It opens with the file, on the right of the flow, and it is the one surface in the app that
   * answers "am I getting anywhere" without asking the learner to read a transcript back.
   *
   * Three things it deliberately is not:
   *
   *  - **not a checklist the app ticks off.** A node goes online when the learner has explained
   *    it in their own words — the ledger's evidence rules, unchanged (§2) — so nothing here can
   *    be advanced by reading, by agreeing, or by clicking.
   *  - **not a table of contents.** Clicking a node scrolls the deck *and* opens the question,
   *    because the point of knowing what you cannot yet say is being one gesture from saying it.
   *  - **not a place work happens.** Every action here is either navigation or one of §5's three
   *    controls; the conversation stays in the document.
   *
   * The panel owns the keyboard (`objectives.ts`'s `moveFocus`, the APG's model for a `tree`)
   * and the roving tabindex; `ObjectiveNode` owns what a row looks like. Scrolling the flow and
   * opening the Ask are the flow's, raised as events — this component has no idea where the
   * cards are, which is why the scroll cannot drift from the one the split anchor uses.
   */
  import { SvelteSet } from 'svelte/reactivity';
  import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, store } from '../lib/store.svelte.js';
  import {
    backendNote,
    buildTree,
    firstRef,
    moveFocus,
    onlineCount,
    onlineLabel,
    panelStatus,
    visibleRows,
    type TreeKey,
  } from '../lib/objectives.js';
  import ObjectiveNode from './ObjectiveNode.svelte';

  let {
    fileName,
    /** The node the flow is currently scrolled to, so the pair reads as one gesture. */
    selectedId = null,
    onactivate,
    onteach,
    onescape,
    onclose,
  }: {
    fileName: string;
    selectedId?: string | null;
    /** Enter scrolls; a click and ⌘Enter also open the question (§5). */
    onactivate?: (objectiveId: string, ask: boolean) => void;
    onteach?: (objectiveId: string) => void;
    /** Esc returns focus to the flow — the panel never becomes a place you are stuck in. */
    onescape?: () => void;
    onclose?: () => void;
  } = $props();

  const tree = $derived(store.objectivesTree);
  const objectives = $derived(tree?.objectives ?? []);
  const nodes = $derived(buildTree(objectives, store.objectivesStates));
  const count = $derived(onlineCount(objectives, store.objectivesStates));
  const status = $derived(panelStatus(tree));
  const note = $derived(
    backendNote({
      backend: store.boot?.backend ?? null,
      hasFixture: tree !== null,
      live: store.objectivesLive,
    }),
  );

  /** Collapsed branches. Local and per sitting: a tree of ten nodes is not worth persisting. */
  const collapsed = new SvelteSet<string>();
  const rows = $derived(visibleRows(nodes, collapsed));

  /** The roving tabindex. One row in a tree is tabbable; the arrows move which one (APG). */
  let focusId = $state<string | null>(null);
  const focused = $derived(focusId ?? rows[0]?.id ?? null);

  let listEl = $state<HTMLDivElement | null>(null);

  function focusRow(id: string | null): void {
    focusId = id;
    if (!id) return;
    queueMicrotask(() => listEl?.querySelector<HTMLElement>(`[data-objective="${id}"]`)?.focus());
  }

  function toggle(id: string): void {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
  }

  const TREE_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onescape?.();
      return;
    }
    if (!TREE_KEYS.includes(e.key)) return;
    e.preventDefault();
    // A tree's arrows are the tree's. Left/right in particular would otherwise scroll the flow.
    e.stopPropagation();
    const move = moveFocus(rows, focused, e.key as TreeKey);
    if (move.expand) toggle(move.expand);
    if (move.collapse) toggle(move.collapse);
    focusRow(move.focusId);
  }

  /** **Reset** is one confirm (§4), inline: a modal for ten rows of state would be theatre. */
  let confirming = $state(false);

  /**
   * The width, dragged from the panel's left edge and persisted per install.
   *
   * A separator with a keyboard: `role="separator"` with `aria-valuenow` is what a resizer is,
   * and a resizer only a mouse can reach is a resizer half the point of the panel is lost to.
   */
  function startResize(e: PointerEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = store.objectivesWidth;
    const move = (ev: PointerEvent): void => store.setObjectivesWidth(startWidth + (startX - ev.clientX));
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function resizeKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    store.setObjectivesWidth(store.objectivesWidth + (e.key === 'ArrowLeft' ? 16 : -16));
  }
</script>

<aside class="panel" style={`width: ${store.objectivesWidth}px`} aria-label="Learning objectives">
  <!--
    A `separator` that can be focused is the ARIA window-splitter pattern, and the whole point of
    it here is that the width is reachable without a mouse: the rule below assumes a separator is
    decoration, which a resize handle is not.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="resizer"
    role="separator"
    aria-label="Panel width"
    aria-orientation="vertical"
    aria-valuenow={store.objectivesWidth}
    aria-valuemin={MIN_PANEL_WIDTH}
    aria-valuemax={MAX_PANEL_WIDTH}
    tabindex="0"
    onpointerdown={startResize}
    onkeydown={resizeKey}
  ></div>

  <header class="head">
    <div class="titles">
      <span class="name" title={fileName}>{fileName}</span>
      <span class="count" aria-label={`${onlineLabel(count)}. Online means you have explained it in your own words.`}>
        {onlineLabel(count)}
      </span>
    </div>
    <button type="button" class="mini" title="Hide the objectives (⌥⌘L)" onclick={() => onclose?.()}>
      Hide <kbd>⌥⌘L</kbd>
    </button>
  </header>

  <div class="acts">
    {#if confirming}
      <!-- What Reset actually costs, in the learner's terms, before they spend it. -->
      <span class="confirm">Forget what you have shown on this deck?</span>
      <button
        type="button"
        class="mini danger"
        onclick={() => {
          confirming = false;
          void store.resetObjectives();
        }}
      >Reset</button>
      <button type="button" class="mini" onclick={() => (confirming = false)}>Keep it</button>
    {:else}
      <button
        type="button"
        class="mini"
        disabled={count.online === 0 && store.objectivesStates.length === 0}
        title="Set every objective back to untouched. The tree itself stays."
        onclick={() => (confirming = true)}
      >Reset</button>
      <button
        type="button"
        class="mini"
        disabled={store.objectivesBusy || !store.objectivesLive}
        title={store.objectivesLive
          ? 'Read the deck again. Objectives you have already shown keep their state.'
          : 'Regenerating needs a live backend.'}
        onclick={() => void store.regenerateObjectives()}
      >Regenerate</button>
    {/if}
  </div>

  {#if status.text}
    <p class="status" class:pending={status.pending} role="status">
      {status.text}
      {#if status.retry}
        <button type="button" class="retry" onclick={() => void store.regenerateObjectives()}>Try again</button>
      {/if}
    </p>
  {/if}

  {#if note}
    <p class="note">{note}</p>
  {/if}

  <!--
    One live region for the panel, one sentence at a time (WCAG 4.1.3). It announces a node
    coming **online** and nothing else: a tree that narrated every re-fetch would be unusable
    with a screen reader open, and "online" is the only event in here the learner earned.
  -->
  <p class="sr-only" aria-live="polite" aria-atomic="true">{store.objectivesAnnounce}</p>

  <!-- `tabindex="-1"` on the tree itself, and the roving 0 on whichever row holds focus: the
       container is where a key lands, never where the tab order stops (WAI-ARIA APG). -->
  <div
    class="list"
    bind:this={listEl}
    role="tree"
    tabindex="-1"
    aria-label="Objectives for this deck"
    {onkeydown}
  >
    {#each rows as row (row.id)}
      <ObjectiveNode
        {row}
        focused={focused === row.id}
        selected={selectedId === row.id}
        lit={store.objectivesLit.ids.includes(row.id)}
        teachable={row.node.objective.assumedByDeck && firstRef(row.node.objective) === null}
        onfocusrow={() => (focusId = row.id)}
        ontoggle={() => toggle(row.id)}
        onactivate={() => {
          focusRow(row.id);
          onactivate?.(row.id, true);
        }}
        onask={() => onactivate?.(row.id, true)}
        onteach={() => onteach?.(row.id)}
      />
    {/each}

    {#if rows.length === 0 && !status.pending}
      <p class="empty">
        {#if note}
          No objectives for this deck yet.
        {:else}
          Nothing to show for this deck yet.
        {/if}
      </p>
    {/if}
  </div>

  <p class="legend" aria-hidden="true">
    <span>·</span> not yet <span>○</span> stated <span>◐</span> online <span>●</span> defended
  </p>
</aside>

<style>
  .panel {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
  }

  .resizer {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
    z-index: 5;
  }
  .resizer:hover,
  .resizer:focus-visible { background: var(--indigo-tint); outline: none; }

  .head {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px 6px;
  }
  .titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count { font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }

  .acts { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px 8px; }
  .confirm { font-size: 11px; color: var(--text-2); line-height: 1.35; }
  .mini { font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .mini:hover:not(:disabled) { color: var(--indigo); }
  .mini:disabled { color: var(--muted); cursor: default; }
  .mini.danger:hover { color: #8a2708; }
  .mini kbd { font: inherit; font-size: 10px; opacity: 0.7; }

  .status {
    flex: none;
    margin: 0;
    padding: 0 12px 8px;
    font-size: 11px;
    color: var(--text-2);
    line-height: 1.45;
  }
  .status.pending { color: var(--muted); }
  .retry { font-size: 11px; color: var(--indigo); margin-left: 6px; }

  .note {
    flex: none;
    margin: 0 12px 8px;
    padding: 6px 9px;
    font-size: 10.5px;
    line-height: 1.45;
    color: #7a4a06;
    background: #fdf6e7;
    border: 1px solid #f0e2c2;
    border-radius: 4px;
  }

  .list { flex: 1; overflow-y: auto; min-height: 0; padding: 2px 8px 12px; }
  .empty { margin: 10px 4px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }

  .legend {
    flex: none;
    margin: 0;
    padding: 7px 12px;
    border-top: 1px solid var(--hairline);
    font-size: 10px;
    color: var(--muted);
  }
  .legend span { color: var(--glyph); margin-right: 2px; margin-left: 7px; }
  .legend span:first-child { margin-left: 0; }
</style>
