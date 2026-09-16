<script lang="ts">
  /**
   * One row of the objectives panel (`learning-objectives.md` §5).
   *
   * A row is a `treeitem`: the panel owns the keyboard and the roving tabindex, this owns what
   * a node *looks like*. Four things are on it and each earns its place —
   *
   *  - the **glyph**, which is the whole state in one character (`objectives.ts`'s four marks,
   *    the ledger's ○◐● plus a dim one). It is the only thing on the row that moves on its own,
   *    which is why a node that has just come online animates once and nothing else does;
   *  - the **title**, ≤ 12 words by the ingest schema, one line, ellipsised rather than wrapped
   *    so a long tree stays scannable;
   *  - **"assumed by the deck"** on a prerequisite the deck never teaches — the tag is the whole
   *    point of those nodes existing (Lucas, 2026-09-16), and without it a learner would read
   *    one as an objective the deck failed to cover;
   *  - the **hover card**: statement, criteria and refs. The criteria are what a correct
   *    demonstration contains, so this is the closest thing the learner has to "what do you want
   *    me to say", and it is one hover away rather than behind a click.
   *
   * It opens to the **left**, because the panel is on the right edge of the window and a popover
   * that opens right is a popover half off the screen.
   */
  import { glyphFor, refLabel, wordFor, type ObjectiveRow } from '../lib/objectives.js';

  let {
    row,
    /** Holds the roving tabindex — one row in the tree is tabbable at a time (WAI-ARIA APG). */
    focused = false,
    /** This node just crossed into online: animate, once. */
    lit = false,
    /** The row the flow is currently scrolled to, kept marked so the pair reads as connected. */
    selected = false,
    /** Offered on an assumed prerequisite, which by definition has no segment to scroll to. */
    teachable = false,
    onactivate,
    ontoggle,
    onfocusrow,
    onteach,
  }: {
    row: ObjectiveRow;
    focused?: boolean;
    lit?: boolean;
    selected?: boolean;
    teachable?: boolean;
    /** `ask` is what separates Enter from a click and ⌘Enter (§5): navigate, or also ask. */
    onactivate?: (ask: boolean) => void;
    ontoggle?: () => void;
    onfocusrow?: () => void;
    onteach?: () => void;
  } = $props();

  const objective = $derived(row.node.objective);
  const level = $derived(row.node.level);
  const refs = $derived(refLabel(objective.refs));

  /**
   * **The hover card has to be `fixed`, and this is why.**
   *
   * The tree scrolls, so `.list` is an `overflow-y: auto` box — and a scroll container clips on
   * *both* axes, whatever the other one is set to. An absolutely-positioned card opening
   * leftwards out of the panel was therefore laid out, painted, and clipped away to nothing: on
   * screen it was invisible, and `elementFromPoint` over its **Teach me this** button hit the
   * flow behind it. Found by driving the real pointer at it over CDP, not by reading the CSS.
   *
   * So it is positioned against the viewport instead, from the row's own rect, and clamped so a
   * node near the bottom of a long tree opens a card that is still on the screen.
   */
  let el = $state<HTMLDivElement | null>(null);
  let cardEl = $state<HTMLDivElement | null>(null);
  let pos = $state<{ top: number; right: number } | null>(null);

  function place(): void {
    const r = el?.getBoundingClientRect();
    if (!r) return;
    const height = cardEl?.offsetHeight ?? 200;
    pos = {
      top: Math.max(8, Math.min(r.top, window.innerHeight - height - 8)),
      right: Math.max(8, window.innerWidth - r.left + 8),
    };
    // The first placement is made before the card has been laid out, so its height is a guess;
    // re-place once it is real, which is one frame and no flicker.
    requestAnimationFrame(() => {
      const h = cardEl?.offsetHeight ?? height;
      if (h === height || !r) return;
      pos = {
        top: Math.max(8, Math.min(r.top, window.innerHeight - h - 8)),
        right: Math.max(8, window.innerWidth - r.left + 8),
      };
    });
  }
</script>

<!--
  `aria-level` on a flat list of `treeitem`s is the structure a screen reader reads; the panel
  renders the rows flat so the roving tabindex and the arrow keys have one list to move through
  rather than a recursion to walk.
-->
<div
  bind:this={el}
  class="node"
  class:lit
  class:selected
  class:pre={objective.kind === 'prerequisite'}
  role="treeitem"
  data-objective={objective.id}
  aria-level={row.depth}
  aria-selected={selected}
  aria-expanded={row.hasChildren ? row.expanded : undefined}
  aria-label={`${objective.title}. ${wordFor(level)}.${objective.assumedByDeck ? ' Assumed by the deck.' : ''}`}
  tabindex={focused ? 0 : -1}
  style={`padding-left: ${(row.depth - 1) * 14}px`}
  onclick={() => onactivate?.(true)}
  onfocus={() => onfocusrow?.()}
  onmouseenter={place}
  onfocusin={place}
  onkeydown={(e) => {
    // Enter scrolls, ⌘Enter opens the Ask (§5). The panel owns every other key.
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    onactivate?.(e.metaKey || e.ctrlKey);
  }}
>
  <!-- The twist is a real button so a pointer can open a branch without scrolling the flow. -->
  {#if row.hasChildren}
    <button
      type="button"
      class="twist"
      tabindex="-1"
      aria-hidden="true"
      onclick={(e) => {
        e.stopPropagation();
        ontoggle?.();
      }}
    >{row.expanded ? '▾' : '▸'}</button>
  {:else}
    <span class="twist empty" aria-hidden="true"></span>
  {/if}

  <span class="glyph" class:dim={level === 0} aria-hidden="true">{glyphFor(level)}</span>

  <span class="title" title={objective.title}>{objective.title}</span>

  {#if objective.assumedByDeck}
    <span class="tag" title="The deck relies on this but never teaches it">assumed by the deck</span>
  {/if}

  <!--
    The hover card. `position: fixed` would follow the mouse out of the panel; it is absolute
    inside the row and opens leftwards, over the flow, which has nothing under it that the
    learner is reading at the moment they are pointing at a node.
  -->
  <div
    class="card"
    role="note"
    bind:this={cardEl}
    style={pos ? `top: ${pos.top}px; right: ${pos.right}px` : ''}
  >
    <p class="statement">{objective.statement}</p>
    {#if objective.criteria.length > 0}
      <p class="crit-head">A good answer says:</p>
      <ul class="crit">
        {#each objective.criteria as c, i (i)}<li>{c}</li>{/each}
      </ul>
    {/if}
    <p class="foot">
      <span class="state">{glyphFor(level)} {wordFor(level)}</span>
      {#if refs}<span class="refs">{refs}</span>{:else}<span class="refs">not taught in this deck</span>{/if}
    </p>
    {#if teachable}
      <button
        type="button"
        class="teach"
        tabindex="-1"
        onclick={(e) => {
          e.stopPropagation();
          onteach?.();
        }}
      >Teach me this</button>
    {/if}
  </div>
</div>

<style>
  .node {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: default;
    outline-offset: -2px;
  }
  .node:hover { background: var(--ground); }
  .node:focus-visible { outline: 2px solid var(--indigo); }
  .node.selected { background: var(--indigo-tint); }

  .twist {
    flex: none;
    width: 10px;
    font-size: 9px;
    line-height: 1;
    color: var(--muted);
    text-align: left;
  }
  .twist.empty { display: inline-block; }

  /* Monochrome, and a progression rather than a traffic light — `LedgerRow`'s rule, kept. */
  .glyph { flex: none; font-size: 12px; color: var(--glyph); line-height: 1; }
  .glyph.dim { color: var(--muted); opacity: 0.55; }

  .title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node.pre .title { color: var(--text-2); }

  .tag {
    flex: none;
    font-size: 9px;
    color: var(--muted);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 0 5px;
    white-space: nowrap;
  }

  /* One animation in the panel, and it fires on the one event that deserves it. */
  .node.lit { animation: lit 900ms ease-out; }
  .node.lit .glyph { animation: pop 900ms ease-out; }
  @keyframes lit {
    0% { background: rgb(79 70 229 / 16%); }
    100% { background: transparent; }
  }
  @keyframes pop {
    0% { opacity: 0.2; }
    45% { opacity: 1; }
    100% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .node.lit,
    .node.lit .glyph { animation: none; }
  }

  .card {
    display: none;
    /* Fixed, not absolute: the tree scrolls, and a scroll container clips both axes. */
    position: fixed;
    z-index: 50;
    top: 0;
    right: 0;
    width: 280px;
    padding: 10px 12px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
    text-align: left;
    cursor: default;
  }
  .node:hover .card,
  .node:focus-within .card { display: block; }

  .statement { margin: 0; font-size: 11.5px; line-height: 1.55; color: var(--text); }
  .crit-head { margin: 8px 0 3px; font-size: 10px; color: var(--muted); }
  .crit { margin: 0; padding-left: 15px; font-size: 11px; line-height: 1.5; color: var(--text-2); }
  .foot {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin: 9px 0 0;
    font-size: 10px;
    color: var(--muted);
  }
  .state { white-space: nowrap; }
  .refs { font-variant-numeric: tabular-nums; }

  .teach {
    margin-top: 9px;
    font-size: 11px;
    color: var(--indigo);
    border: 1px solid var(--indigo);
    border-radius: var(--radius);
    padding: 3px 9px;
  }
  .teach:hover { background: var(--indigo-tint); }
</style>
