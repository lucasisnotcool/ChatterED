/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE EDITABLE DIAGRAM (2026-10-01): A PICTURE WHOSE LABELS ARE THE DOCUMENT'S OWN TEXT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A `diagram` block is drawn here, and nowhere else. Its nodes are `diagram_node` textblocks —
 * real, editable text in the per-span author mark, so the guard protects what the learner types
 * in a box exactly as it protects a paragraph — and the picture around them is laid out in code
 * (`../diagramlayout.ts`), never drawn by a model. Three parts:
 *
 *  - **The node views.** The figure's `contentDOM` is a CSS grid holding the nodes; its head is
 *    chrome (the title, and a small toolbar); an SVG layer behind the boxes draws the edges and
 *    one above them draws the edge labels. Both layers take no pointer events. Each node's grid
 *    cell is set on its DOM by the figure after every update, and the node's view ignores that
 *    mutation, so a re-rendered node is put back where it belongs on the next frame.
 *  - **The commands** the toolbar and the keys run, pure over `EditorState` and tested: switch
 *    layout, set the title, add a node, delete a node. Every one is an ordinary transaction, in
 *    the history, and so the learner's own (`authorship.ts`).
 *  - **The plugin**: the keys that must not do what they do in a paragraph. Enter would split a
 *    node and duplicate its `nodeId`, Backspace at a node's start would merge two, a paste of
 *    paragraphs would break the diagram apart. And, as the net under all of that, a pass that
 *    re-mints any `nodeId` a transaction has left empty or duplicated.
 */

import type { Node, Slice } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from 'prosemirror-view';
import { DIAGRAM_LAYOUTS, blockAttrs, diagramSpec, isDiagramLayout, notesSchema } from '../../../shared/doc/schema.js';
import type { DiagramEdge, DiagramLayout } from '../../../shared/doc/types.js';
import {
  layoutDiagram,
  layoutOptionsFor,
  pathData,
  routeEdges,
  walkOrder,
  type Box,
  type DiagramGrid,
  type LayoutOptions,
} from '../diagramlayout.js';
import { provenanceLabel } from './chrome.js';
import type { NodeViewContext } from './nodeviews.js';
import { attachCitePreview } from './sourcepop.js';

/** The layouts' names on the toolbar. "Tree" is what a learner calls a hierarchy. */
export const LAYOUT_NAME: Record<DiagramLayout, string> = {
  flow: 'Flow',
  hierarchy: 'Tree',
  compare: 'Compare',
  cycle: 'Cycle',
};

// ── where the cursor is ─────────────────────────────────────────────────────────────────────

export interface DiagramHit {
  diagramPos: number;
  diagram: Node;
  /** The node holding the selection's start, or null when the selection is on the figure itself. */
  index: number | null;
  nodePos: number | null;
}

/** The diagram the selection starts in, and the node inside it, if any. */
export function diagramAt(state: EditorState): DiagramHit | null {
  const { selection } = state;
  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'diagram_node' && $from.node(d - 1).type.name === 'diagram') {
      return { diagramPos: $from.before(d - 1), diagram: $from.node(d - 1), index: $from.index(d - 1), nodePos: $from.before(d) };
    }
  }
  const selected = state.doc.nodeAt(selection.from);
  if (selected?.type.name === 'diagram' && selection.to === selection.from + selected.nodeSize) {
    return { diagramPos: selection.from, diagram: selected, index: null, nodePos: null };
  }
  return null;
}

/** Where child `index` of the diagram at `diagramPos` starts. */
function childPos(diagram: Node, diagramPos: number, index: number): number {
  let pos = diagramPos + 1;
  for (let i = 0; i < index; i++) pos += diagram.child(i).nodeSize;
  return pos;
}

// ── the commands (pure; the toolbar and the keys run these) ─────────────────────────────────

/**
 * An id no node, edge or parent of this diagram uses: `n1`, `n2`, … An id an edge still names
 * (the node it named was deleted) is skipped too, or a new node would inherit an old arrow.
 */
export function freshNodeId(diagram: Node): string {
  const taken = new Set<string>();
  diagram.forEach((child) => {
    taken.add(child.attrs.nodeId as string);
    const parent = child.attrs.parent as string | null;
    if (parent) taken.add(parent);
  });
  for (const edge of diagramSpec(diagram).edges) {
    taken.add(edge.from);
    taken.add(edge.to);
  }
  let k = 1;
  while (taken.has(`n${String(k)}`)) k++;
  return `n${String(k)}`;
}

function sameEdges(a: readonly DiagramEdge[], b: readonly DiagramEdge[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function setDiagramLayout(state: EditorState, diagramPos: number, layout: DiagramLayout): Transaction | null {
  const diagram = state.doc.nodeAt(diagramPos);
  if (diagram?.type.name !== 'diagram' || !isDiagramLayout(layout) || diagram.attrs.layout === layout) return null;
  return state.tr.setNodeAttribute(diagramPos, 'layout', layout);
}

/** The title, trimmed; an empty one is none. */
export function setDiagramTitle(state: EditorState, diagramPos: number, title: string): Transaction | null {
  const diagram = state.doc.nodeAt(diagramPos);
  if (diagram?.type.name !== 'diagram') return null;
  const next = title.replace(/\s+/g, ' ').trim() || null;
  if (next === ((diagram.attrs.title as string | null) || null)) return null;
  return state.tr.setNodeAttribute(diagramPos, 'title', next);
}

/**
 * **Add node**: a new, empty box at the end of the diagram, the cursor in it, carrying the
 * diagram's own pages. Where it lands is the layout's business, so the attrs say where:
 *
 *  - `hierarchy`: a child of the node the cursor is in, or a sibling of the last node;
 *  - `compare`: in the group of the node the cursor is in (or of the last node);
 *  - `flow` and `cycle` with explicit edges: joined on after the last node of the walk, and in a
 *    cycle spliced into the closing edge, so the ring stays a ring. With no edges the sequence is
 *    implied and the new node is already on the end of it.
 */
export function addDiagramNode(state: EditorState, diagramPos: number): Transaction | null {
  const diagram = state.doc.nodeAt(diagramPos);
  if (diagram?.type.name !== 'diagram') return null;
  const spec = diagramSpec(diagram);
  const layout = spec.layout;
  const hit = diagramAt(state);
  const here = hit && hit.diagramPos === diagramPos && hit.index !== null ? spec.nodes[hit.index] : undefined;
  const last = spec.nodes[spec.nodes.length - 1];
  const id = freshNodeId(diagram);

  let parent: string | null = null;
  let group: string | null = null;
  if (layout === 'hierarchy') parent = here ? here.id : (last?.parent ?? null);
  if (layout === 'compare') group = (here ?? last)?.group ?? null;

  let edges = spec.edges;
  const valid = new Set(spec.nodes.map((n) => n.id));
  const live = edges.filter((e) => valid.has(e.from) && valid.has(e.to) && e.from !== e.to);
  if ((layout === 'flow' || layout === 'cycle') && live.length > 0) {
    const order = walkOrder(spec);
    const tail = spec.nodes[order[order.length - 1]!]!.id;
    const head = spec.nodes[order[0]!]!.id;
    const closing = layout === 'cycle' ? edges.findIndex((e) => e.from === tail && e.to === head) : -1;
    edges =
      closing >= 0
        ? [
            ...edges.slice(0, closing),
            { from: tail, to: id, label: null },
            { from: id, to: head, label: edges[closing]!.label },
            ...edges.slice(closing + 1),
          ]
        : [...edges, { from: tail, to: id, label: null }];
  }

  const node = notesSchema.nodes.diagram_node!.create({
    nodeId: id,
    parent,
    group,
    pages: blockAttrs(diagram).pages,
    reason: null,
  });
  const at = diagramPos + diagram.nodeSize - 1;
  const tr = state.tr;
  if (!sameEdges(edges, spec.edges)) tr.setNodeAttribute(diagramPos, 'edges', edges);
  tr.insert(at, node);
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  return tr.scrollIntoView();
}

/**
 * **Delete node**: the box at `index`, and every edge that touches it. A node that was the one
 * link between two others (one edge in, one out) leaves them joined, so deleting the middle step
 * of a flow does not cut the flow in two; its children in a tree move up to its parent. The last
 * node of a diagram cannot be deleted (`diagram_node+`). The cursor goes to the node before.
 */
export function deleteDiagramNode(state: EditorState, diagramPos: number, index: number): Transaction | null {
  const diagram = state.doc.nodeAt(diagramPos);
  if (diagram?.type.name !== 'diagram' || diagram.childCount <= 1) return null;
  if (!Number.isInteger(index) || index < 0 || index >= diagram.childCount) return null;
  const spec = diagramSpec(diagram);
  const target = diagram.child(index);
  const id = target.attrs.nodeId as string;
  // A twin with the same id (mid-repair) keeps the edges: they are as much its as this one's.
  const twin = spec.nodes.some((n, i) => i !== index && n.id === id);
  const tr = state.tr;

  if (!twin) {
    const ins = spec.edges.filter((e) => e.to === id && e.from !== id);
    const outs = spec.edges.filter((e) => e.from === id && e.to !== id);
    const edges = spec.edges.filter((e) => e.from !== id && e.to !== id);
    if (ins.length === 1 && outs.length === 1) {
      const from = ins[0]!.from;
      const to = outs[0]!.to;
      if (from !== to && !edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, label: null });
    }
    if (!sameEdges(edges, spec.edges)) tr.setNodeAttribute(diagramPos, 'edges', edges);
    const up = (target.attrs.parent as string | null) || null;
    diagram.forEach((child, offset, i) => {
      if (i === index || (child.attrs.parent as string | null) !== id) return;
      tr.setNodeAttribute(diagramPos + 1 + offset, 'parent', up && up !== child.attrs.nodeId ? up : null);
    });
  }

  const from = childPos(diagram, diagramPos, index);
  tr.delete(from, from + target.nodeSize);
  const caret =
    index > 0
      ? from - 1 // the end of the node before, which the delete did not move
      : from + 1; // the start of the node after, now first
  tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
  return tr.scrollIntoView();
}

/**
 * Tab, Shift-Tab and Enter: to the end of the next (or previous) node's label. At either end of
 * the diagram the key is still taken, so it cannot fall through to a split or to the browser's
 * focus change.
 */
export function moveInDiagram(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const hit = diagramAt(state);
    if (!hit || hit.index === null) return false;
    const next = hit.index + direction;
    if (next < 0 || next >= hit.diagram.childCount) return true;
    if (dispatch) {
      const pos = childPos(hit.diagram, hit.diagramPos, next);
      const end = pos + hit.diagram.child(next).nodeSize - 1;
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, end)).scrollIntoView());
    }
    return true;
  };
}

/** Are `from` and `to` in two different nodes of one diagram? Then a plain delete would merge them. */
function spansNodes(state: EditorState, from: number, to: number): { diagramPos: number; diagram: Node } | null {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'diagram_node') continue;
    const diagram = $from.node(d - 1);
    if (d > $to.depth || $to.node(d - 1) !== diagram || $to.before(d - 1) !== $from.before(d - 1)) return null;
    return $to.node(d) === $from.node(d) && $to.before(d) === $from.before(d) ? null : { diagramPos: $from.before(d - 1), diagram };
  }
  return null;
}

/**
 * Delete `from`–`to` inside a diagram **node by node**: each node keeps its box, and loses only
 * the text inside the range. Null when the range is inside one node (an ordinary delete is right).
 */
export function deleteAcrossNodes(state: EditorState, from: number, to: number): Transaction | null {
  const within = spansNodes(state, from, to);
  if (!within) return null;
  const tr = state.tr;
  const ranges: [number, number][] = [];
  within.diagram.forEach((child, offset) => {
    const start = within.diagramPos + 2 + offset;
    const end = start + child.content.size;
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (b > a) ranges.push([a, b]);
  });
  for (const [a, b] of ranges.reverse()) tr.delete(a, b);
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, -1)));
  return tr;
}

/**
 * Backspace at the very start of a node, or Delete at the very end: taken, and nothing happens.
 * The base keymap would find nothing to join across an isolating node and hand the key to the
 * browser, whose own delete *does* merge two blocks — so "nothing" has to be said explicitly.
 */
export function guardNodeEdge(edge: 'start' | 'end'): Command {
  return (state) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const $at = selection.$from;
    if ($at.parent.type.name !== 'diagram_node') return false;
    return edge === 'start' ? $at.parentOffset === 0 : $at.parentOffset === $at.parent.content.size;
  };
}

/** Backspace or Delete over a selection that spans nodes: node by node, never a merge. */
export const deleteSelectionAcross: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const tr = deleteAcrossNodes(state, from, to);
  if (!tr) return false;
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Every node of every diagram with a `nodeId` of its own. A duplicate (the later one in the
 * document) or an empty id is re-minted. Returns null when there is nothing to do.
 */
export function repairNodeIds(tr: Transaction): Transaction | null {
  const fixes: { pos: number; id: string }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'diagram') return !node.isTextblock;
    const seen = new Set<string>();
    let dirty = false;
    node.forEach((child) => {
      const id = child.attrs.nodeId as string;
      if (!id || seen.has(id)) dirty = true;
      seen.add(id);
    });
    if (!dirty) return false;
    // Mint against the diagram as it stands, adding each new id to it so two fixes differ.
    const taken = new Set<string>(seen);
    for (const edge of diagramSpec(node).edges) taken.add(edge.from).add(edge.to);
    const kept = new Set<string>();
    node.forEach((child, offset) => {
      const id = child.attrs.nodeId as string;
      if (id && !kept.has(id)) {
        kept.add(id);
        return;
      }
      let k = 1;
      while (taken.has(`n${String(k)}`)) k++;
      const fresh = `n${String(k)}`;
      taken.add(fresh);
      fixes.push({ pos: pos + 1 + offset, id: fresh });
    });
    return false;
  });
  if (fixes.length === 0) return null;
  for (const fix of fixes) tr.setNodeAttribute(fix.pos, 'nodeId', fix.id);
  return tr;
}

// ── the plugin: keys, paste, drop, the active classes, the id repair ────────────────────────

export const diagramKey = new PluginKey('chattered:diagram');

export const DIAGRAM_ACTIVE_CLASS = 'nd-dg-active';
export const NODE_ACTIVE_CLASS = 'nd-dg-node-active';

/** Is this slice more than inline content (whole paragraphs, a list, a table)? */
export function hasBlocks(slice: Slice): boolean {
  const { content } = slice;
  let blocks = false;
  content.forEach((child) => {
    if (!child.isInline) blocks = true;
  });
  // One open textblock is text lifted out of a paragraph: it pastes into a label as it is.
  if (blocks && content.childCount === 1 && content.firstChild?.isTextblock && slice.openStart > 0) return false;
  return blocks;
}

/** The keys that do something different inside a diagram node. */
function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  const state = view.state;
  const hit = diagramAt(state);
  if (!hit || hit.index === null) return false;
  const key = event.key;
  const run = (command: Command): boolean => command(state, view.dispatch, view);
  if (key === 'Tab') return run(moveInDiagram(event.shiftKey ? -1 : 1));
  if (key === 'Enter') {
    // Plain Enter and Shift-Enter go on to the next box; any other Enter is only taken.
    if (!event.metaKey && !event.ctrlKey && !event.altKey) return run(moveInDiagram(event.shiftKey ? -1 : 1));
    return true;
  }
  // Ctrl-H and Ctrl-D are macOS's own Backspace and Delete.
  const back = key === 'Backspace' || (event.ctrlKey && !event.metaKey && key === 'h');
  const forward = key === 'Delete' || (event.ctrlKey && !event.metaKey && key === 'd');
  if (back || forward) {
    if (run(deleteSelectionAcross)) return true;
    return run(guardNodeEdge(back ? 'start' : 'end'));
  }
  return false;
}

export function diagramPlugin(): Plugin {
  return new Plugin({
    key: diagramKey,
    appendTransaction(transactions, _old, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      return repairNodeIds(newState.tr);
    },
    props: {
      handleKeyDown: handleKey,
      /** Typing over a selection that spans two boxes: each keeps its box, the text goes in the first. */
      handleTextInput(view, from, to, text) {
        const tr = deleteAcrossNodes(view.state, from, to);
        if (!tr) return false;
        view.dispatch(tr.insertText(text, tr.mapping.map(from, -1)).scrollIntoView());
        return true;
      },
      /** A paste of paragraphs into a label: its text, on one line, in place of the selection. */
      handlePaste(view, _event, slice) {
        const hit = diagramAt(view.state);
        if (!hit || hit.index === null || !hasBlocks(slice)) return false;
        const text = slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\s+/g, ' ').trim();
        const { from, to } = view.state.selection;
        const tr = deleteAcrossNodes(view.state, from, to) ?? view.state.tr.deleteSelection();
        if (text.length > 0) tr.insertText(text, tr.mapping.map(from, -1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      /** Blocks dropped into a label would break the diagram apart; refused. Text drops as usual. */
      handleDrop(view, event, slice) {
        if (!hasBlocks(slice)) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return false;
        const $at = view.state.doc.resolve(at.pos);
        for (let d = $at.depth; d >= 0; d--) if ($at.node(d).type.name === 'diagram') return true;
        return false;
      },
      /** The figure and the box the cursor is in: the toolbar shows, and the box is marked. */
      decorations(state) {
        const hit = diagramAt(state);
        if (!hit) return null;
        const decorations = [
          Decoration.node(hit.diagramPos, hit.diagramPos + hit.diagram.nodeSize, { class: DIAGRAM_ACTIVE_CLASS }),
        ];
        if (hit.nodePos !== null && hit.index !== null) {
          const node = hit.diagram.child(hit.index);
          decorations.push(Decoration.node(hit.nodePos, hit.nodePos + node.nodeSize, { class: NODE_ACTIVE_CLASS }));
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

// ── the node views ──────────────────────────────────────────────────────────────────────────

const SVG = 'http://www.w3.org/2000/svg';
/** A label longer than this is cut, with the whole of it on hover. */
const EDGE_LABEL_MAX = 24;
/** The grid gaps if the stylesheet has not given any (notes.css sets them per layout). */
const FALLBACK_GAP = { x: 36, y: 32 };

let arrowIds = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** A toolbar button: the press never takes the caret out of the label it is about. */
function tool(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.title = title;
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return node;
}

/**
 * The figure. Owns the layout: it reads the spec on every update, places its children in the
 * grid, and redraws the edges on the next frame (and whenever a box changes size).
 */
class DiagramView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #node: Node;
  #view: EditorView;
  #getPos: () => number | undefined;
  #head: HTMLElement;
  #title: HTMLInputElement;
  #layouts = new Map<DiagramLayout, HTMLButtonElement>();
  #add: HTMLButtonElement;
  #remove: HTMLButtonElement;
  #groups: HTMLElement;
  #lines: SVGSVGElement;
  #edges: SVGGElement;
  #labels: SVGSVGElement;
  #probe: HTMLElement;
  #arrowId: string;
  #grid: DiagramGrid;
  #options: LayoutOptions = {};
  #frame = 0;
  #resize: ResizeObserver | null = null;
  #mutations: MutationObserver | null = null;
  #observed = new Set<Element>();
  #destroyed = false;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.#arrowId = `nd-dg-arrow-${String(++arrowIds)}`;

    this.dom = el('figure', 'nd-dg');

    this.#head = el('div', 'nd-dg-head');
    this.#head.contentEditable = 'false';
    this.#title = el('input', 'nd-dg-title');
    this.#title.type = 'text';
    this.#title.placeholder = 'Add a title';
    this.#title.setAttribute('aria-label', 'Diagram title');
    this.#title.spellcheck = true;
    // Enter keeps the title and Escape drops the change; either way the caret goes back to the
    // document, where ⌘Z can take the title back.
    this.#title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (event.key === 'Escape') this.#title.value = (this.#node.attrs.title as string | null) ?? '';
        this.#title.blur();
        this.#view.focus();
      }
    });
    this.#title.addEventListener('blur', () => this.#commitTitle());

    const tools = el('div', 'nd-dg-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Diagram');
    const layouts = el('span', 'nd-dg-layouts');
    for (const layout of DIAGRAM_LAYOUTS) {
      const button = tool('nd-dg-tool nd-dg-layout', LAYOUT_NAME[layout], `Lay this out as a ${LAYOUT_NAME[layout].toLowerCase()}`, () =>
        this.#run((state, pos) => setDiagramLayout(state, pos, layout)),
      );
      this.#layouts.set(layout, button);
      layouts.append(button);
    }
    this.#add = tool('nd-dg-tool', '+ Node', 'Add a box to this diagram', () =>
      this.#run((state, pos) => addDiagramNode(state, pos)),
    );
    this.#remove = tool('nd-dg-tool', 'Delete node', 'Delete the box the cursor is in', () =>
      this.#run((state, pos) => {
        const hit = diagramAt(state);
        return hit && hit.diagramPos === pos && hit.index !== null ? deleteDiagramNode(state, pos, hit.index) : null;
      }),
    );
    tools.append(layouts, this.#add, this.#remove);
    this.#head.append(this.#title, tools);

    this.#groups = el('div', 'nd-dg-groups');
    this.#groups.contentEditable = 'false';

    this.#lines = svg('svg', { class: 'nd-dg-lines', 'aria-hidden': 'true' });
    const defs = svg('defs');
    const marker = svg('marker', {
      id: this.#arrowId,
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '7',
      markerHeight: '7',
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    });
    marker.append(svg('path', { d: 'M0 1 L9 5 L0 9 z', class: 'nd-dg-arrowhead' }));
    defs.append(marker);
    this.#edges = svg('g');
    this.#lines.append(defs, this.#edges);

    this.contentDOM = el('div', 'nd-dg-grid');

    this.#labels = svg('svg', { class: 'nd-dg-labels', 'aria-hidden': 'true' });

    // 100 CSS px wide in the figure's own space: its measured width is the ratio between what
    // `getBoundingClientRect` reports and CSS px, whatever the notes' zoom does to the former.
    this.#probe = el('span', 'nd-dg-probe');
    this.#probe.setAttribute('aria-hidden', 'true');

    this.dom.append(this.#head, this.#groups, this.#lines, this.contentDOM, this.#labels, this.#probe);

    this.#grid = layoutDiagram(diagramSpec(node));
    this.#paint();

    if (typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => this.#schedule());
      this.#resize.observe(this.dom);
    }
    if (typeof MutationObserver !== 'undefined') {
      // A node added, removed or retyped: its box moved. Attributes are left out on purpose, as
      // `#place` writes them.
      this.#mutations = new MutationObserver(() => this.#schedule());
      this.#mutations.observe(this.contentDOM, { childList: true, subtree: true, characterData: true });
    }
    void globalThis.document?.fonts?.ready.then(() => this.#schedule());
    this.#schedule();
  }

  /** A toolbar command, dispatched as the learner's own transaction, the caret kept in the doc. */
  #run(make: (state: EditorState, pos: number) => Transaction | null): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const tr = make(this.#view.state, pos);
    if (tr) this.#view.dispatch(tr);
    this.#view.focus();
  }

  #commitTitle(): void {
    const pos = this.#getPos();
    if (pos === undefined || this.#destroyed) return;
    const tr = setDiagramTitle(this.#view.state, pos, this.#title.value);
    if (tr) this.#view.dispatch(tr);
  }

  /** The chrome, from the node. Called on every update, so it only writes what changed. */
  #paint(): void {
    const node = this.#node;
    const layout = this.#grid.layout;
    if (this.dom.dataset.layout !== layout) this.dom.dataset.layout = layout;
    const edges = this.#grid.edges.length > 0 ? 'true' : 'false';
    if (this.dom.dataset.edges !== edges) this.dom.dataset.edges = edges;
    const labelled = this.#grid.edges.some((e) => e.label) ? 'true' : 'false';
    if (this.dom.dataset.labelled !== labelled) this.dom.dataset.labelled = labelled;

    const title = (node.attrs.title as string | null) ?? '';
    if (document.activeElement !== this.#title && this.#title.value !== title) this.#title.value = title;
    const described = title ? `Diagram: ${title}` : 'Diagram';
    if (this.dom.getAttribute('aria-label') !== described) this.dom.setAttribute('aria-label', described);

    for (const [name, button] of this.#layouts) {
      const pressed = String(name === layout);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    }
    const hit = diagramAt(this.#view.state);
    const here = hit !== null && hit.index !== null && hit.diagramPos === this.#getPos();
    const removable = here && node.childCount > 1;
    if (this.#remove.disabled === removable) this.#remove.disabled = !removable;

    const template = `repeat(${String(Math.max(1, this.#grid.columns))}, minmax(0, 1fr))`;
    if (this.contentDOM.style.gridTemplateColumns !== template) this.contentDOM.style.gridTemplateColumns = template;
    this.#paintGroups(template);
  }

  #paintGroups(template: string): void {
    const groups = this.#grid.layout === 'compare' ? this.#grid.groups : [];
    this.#groups.hidden = groups.length === 0;
    const key = groups.map((g) => g.label).join('\u0000');
    if (this.#groups.dataset.key === key) return;
    this.#groups.dataset.key = key;
    this.#groups.style.gridTemplateColumns = template;
    this.#groups.replaceChildren(
      ...groups.map((group) => {
        const head = el('div', 'nd-dg-group', group.label);
        head.style.gridColumn = String(group.col + 1);
        head.title = group.label;
        return head;
      }),
    );
  }

  /** The node elements, in document order: `cells[i]` is `children[i]`. */
  #children(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const child of Array.from(this.contentDOM.children)) {
      if (child instanceof HTMLElement && child.classList.contains('nd-dg-node')) out.push(child);
    }
    return out;
  }

  /** Each node into its cell. The node's own view ignores these writes (`ignoreMutation`). */
  #place(children: HTMLElement[]): void {
    children.forEach((child, i) => {
      const cell = this.#grid.cells[i];
      const column = cell ? `${String(cell.col + 1)} / span ${String(cell.colSpan)}` : '';
      const row = cell ? String(cell.row + 1) : '';
      if (child.style.gridColumn !== column) child.style.gridColumn = column;
      if (child.style.gridRow !== row) child.style.gridRow = row;
      const role = cell?.role ?? 'node';
      if (child.dataset.role !== role) child.dataset.role = role;
      const holds = cell?.holdsStack ? 'true' : 'false';
      if (child.dataset.holdsStack !== holds) child.dataset.holdsStack = holds;
    });
  }

  #schedule(): void {
    if (this.#frame || this.#destroyed) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  /**
   * Place, measure, route, draw. Positions are read with `getBoundingClientRect` and divided by
   * the probe's scale, so the overlay is in the figure's own CSS px at any zoom.
   */
  #draw(): void {
    if (this.#destroyed || !this.dom.isConnected) return;
    const scale = this.#probe.getBoundingClientRect().width / 100 || 1;
    const frame = this.dom.getBoundingClientRect();

    // The budgets follow the figure's width; a change means a different grid.
    const options = layoutOptionsFor(frame.width / scale);
    if (options.maxColumns !== this.#options.maxColumns || options.maxLeaves !== this.#options.maxLeaves) {
      this.#options = options;
      this.#grid = layoutDiagram(diagramSpec(this.#node), options);
      this.#paint();
    }
    const children = this.#children();
    this.#place(children);
    this.#watch(children);

    const boxes: (Box | null)[] = children.map((child) => {
      const box = child.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return null;
      return {
        x: (box.left - frame.left) / scale,
        y: (box.top - frame.top) / scale,
        w: box.width / scale,
        h: box.height / scale,
      };
    });
    const style = getComputedStyle(this.contentDOM);
    const gap = {
      x: Number.parseFloat(style.columnGap) || FALLBACK_GAP.x,
      y: Number.parseFloat(style.rowGap) || FALLBACK_GAP.y,
    };
    const routed = routeEdges(this.#grid, boxes, gap);

    const paths: SVGElement[] = [];
    const labels: SVGElement[] = [];
    for (const route of routed) {
      const path = svg('path', {
        d: pathData(route.points),
        class: route.edge.kind === 'tree' ? 'nd-dg-edge nd-dg-edge-tree' : 'nd-dg-edge',
      });
      if (route.arrow) path.setAttribute('marker-end', `url(#${this.#arrowId})`);
      paths.push(path);
      if (route.labelAt && route.edge.label) {
        const full = route.edge.label;
        const text = svg('text', {
          x: String(route.labelAt.x),
          y: String(route.labelAt.y),
          'text-anchor': route.labelAt.anchor,
          class: 'nd-dg-edge-label',
        });
        text.textContent = full.length > EDGE_LABEL_MAX ? `${full.slice(0, EDGE_LABEL_MAX - 1)}…` : full;
        if (full.length > EDGE_LABEL_MAX) {
          const tip = svg('title');
          tip.textContent = full;
          text.append(tip);
        }
        labels.push(text);
      }
    }
    this.#edges.replaceChildren(...paths);
    this.#labels.replaceChildren(...labels);
  }

  /** Every node's own size change is a redraw too: a label that wraps moves its box's edges. */
  #watch(children: HTMLElement[]): void {
    if (!this.#resize) return;
    const now = new Set<Element>(children);
    for (const old of this.#observed) if (!now.has(old)) this.#resize.unobserve(old);
    for (const child of children) if (!this.#observed.has(child)) this.#resize.observe(child);
    this.#observed = now;
  }

  update(node: Node): boolean {
    if (node.type.name !== 'diagram') return false;
    this.#node = node;
    this.#grid = layoutDiagram(diagramSpec(node), this.#options);
    this.#paint();
    this.#schedule();
    return true;
  }

  /** The head is chrome: its input and buttons keep their events from ProseMirror. */
  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.#head.contains(event.target);
  }

  /**
   * Only what happens *inside* the grid is the document's. The head, the group headings, the
   * overlays, and the grid's own style (written by `#paint`) are ours.
   */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.target === this.contentDOM && mutation.type === 'attributes') return true;
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.#destroyed = true;
    if (this.#frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.#frame);
    this.#resize?.disconnect();
    this.#mutations?.disconnect();
  }
}

/**
 * One box. The label is `contentDOM`; its pages are a chip on the box's corner that opens the
 * slide, with the same preview a block's provenance chip has when the preview is wired.
 */
class DiagramNodeView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #node: Node;
  #ctx: NodeViewContext;
  #chip: HTMLButtonElement | null = null;
  #pagesKey = '';

  constructor(node: Node, ctx: NodeViewContext) {
    this.#node = node;
    this.#ctx = ctx;
    this.dom = el('div', 'nd-dg-node');
    this.contentDOM = el('div', 'nd-dg-label');
    this.dom.append(this.contentDOM);
    this.#paint();
  }

  #pages(): number[] {
    const pages = this.#node.attrs.pages as unknown;
    return Array.isArray(pages) ? (pages as number[]).filter((p) => Number.isInteger(p) && p > 0) : [];
  }

  #paint(): void {
    const node = this.#node;
    const id = node.attrs.nodeId as string;
    if (this.dom.dataset.nodeId !== id) this.dom.dataset.nodeId = id;
    this.dom.classList.toggle('nd-dg-empty', node.content.size === 0);

    const pages = this.#pages();
    const key = pages.join(',');
    if (key === this.#pagesKey) return;
    this.#pagesKey = key;
    this.#chip?.remove();
    this.#chip = null;
    if (pages.length === 0) return;
    // Through the notebook's sources (C1); the slides know them once a notebook is open.
    const label = this.#ctx.slides()?.citation(pages) ?? provenanceLabel(pages, null);
    const first = pages[0]!;
    const chip = el('button', 'nd-dg-pages', label);
    chip.type = 'button';
    chip.contentEditable = 'false';
    chip.title = `Open the source slide (${label})`;
    let openRegion: (() => void) | null = null;
    chip.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openRegion) openRegion();
      else this.#ctx.onOpenSlide(first, null, chip);
    });
    const pageLines = this.#ctx.pageLines;
    if (pageLines) {
      openRegion = attachCitePreview(chip, {
        pages,
        reason: null,
        // Read on hover: the learner may have rewritten the label since.
        text: () => this.#node.textContent,
        figure: null,
        reader: { slides: this.#ctx.slides, pageLines },
        onOpenSlide: this.#ctx.onOpenSlide,
        // After the block the chip is on: its nearest ancestor with an id.
        onInsert: this.#ctx.onInsertSlide ? (target) => this.#ctx.onInsertSlide?.(target, chip.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null) : undefined,
      });
      chip.title = '';
      chip.setAttribute('aria-label', `Open the source slide (${label})`);
    }
    this.#chip = chip;
    this.dom.append(chip);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'diagram_node') return false;
    this.#node = node;
    this.#paint();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.#chip !== null && event.target instanceof globalThis.Node && this.#chip.contains(event.target);
  }

  /** The figure writes this box's grid cell onto `dom`; that, and the chip, are not the document. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false;
    if (mutation.target === this.dom && mutation.type === 'attributes') return true;
    return this.#chip !== null && this.#chip.contains(mutation.target);
  }
}

/** The two views, for `nodeviews.ts`'s map. */
export function diagramNodeViews(ctx: NodeViewContext): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    diagram: (node, view, getPos) => new DiagramView(node, view, getPos),
    diagram_node: (node) => new DiagramNodeView(node, ctx),
  };
}
