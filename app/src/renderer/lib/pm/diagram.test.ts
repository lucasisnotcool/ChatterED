import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import { Slice, Fragment } from 'prosemirror-model';
import { diagramSpec, notesSchema } from '../../../shared/doc/schema.js';
import { diagram, docOf, para } from '../../../shared/doc/fixture.test-support.js';
import type { DiagramEdge, DiagramLayout } from '../../../shared/doc/types.js';
import { authorship } from './authorship.js';
import {
  addDiagramNode,
  deleteAcrossNodes,
  deleteDiagramNode,
  deleteSelectionAcross,
  diagramAt,
  diagramPlugin,
  freshNodeId,
  guardNodeEdge,
  hasBlocks,
  moveInDiagram,
  repairNodeIds,
  setDiagramLayout,
  setDiagramTitle,
} from './diagram.js';

/** `para` · diagram(a, b, c) · `para`. The diagram starts at `DIAGRAM`. */
function stateWith(
  opts: { layout?: DiagramLayout; edges?: DiagramEdge[]; nodes?: { id: string; label: string; parent?: string | null; group?: string | null }[] } = {},
): EditorState {
  const nodes = opts.nodes ?? [
    { id: 'a', label: 'Plan' },
    { id: 'b', label: 'Build' },
    { id: 'c', label: 'Test' },
  ];
  const doc = docOf(
    para('p1', 'Before.'),
    diagram('d1', nodes, { layout: opts.layout ?? 'flow', edges: opts.edges ?? [], title: 'Loop', pages: [12] }),
    para('p2', 'After.'),
  );
  return EditorState.create({ schema: notesSchema, doc, plugins: [history(), authorship({ now: () => 5 }), diagramPlugin()] });
}

/** Where the diagram starts: after the first paragraph. */
function diagramPos(state: EditorState): number {
  let at = -1;
  state.doc.forEach((node, offset) => {
    if (node.type.name === 'diagram' && at < 0) at = offset;
  });
  return at;
}

function diagramOf(state: EditorState): Node {
  return state.doc.nodeAt(diagramPos(state))!;
}

/** The text position `offset` characters into node `index`. */
function inNode(state: EditorState, index: number, offset = 0): number {
  const pos = diagramPos(state);
  let at = pos + 1;
  const d = diagramOf(state);
  for (let i = 0; i < index; i++) at += d.child(i).nodeSize;
  return at + 1 + offset;
}

function withCursor(state: EditorState, pos: number, to = pos): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos, to)));
}

function apply(state: EditorState, tr: Transaction | null): EditorState {
  expect(tr).not.toBeNull();
  return state.apply(tr!);
}

function run(state: EditorState, command: Command): { handled: boolean; state: EditorState } {
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { handled, state: next };
}

const ids = (state: EditorState): string[] => diagramSpec(diagramOf(state)).nodes.map((n) => n.id);
const labels = (state: EditorState): string[] => diagramSpec(diagramOf(state)).nodes.map((n) => n.label);
const edgePairs = (state: EditorState): string[] => diagramSpec(diagramOf(state)).edges.map((e) => `${e.from}>${e.to}`);

describe('where the cursor is', () => {
  it('finds the diagram and the node the cursor is in', () => {
    const state = withCursor(stateWith(), inNode(stateWith(), 1, 2));
    const hit = diagramAt(state)!;
    expect(hit.diagramPos).toBe(diagramPos(state));
    expect(hit.index).toBe(1);
  });

  it('finds a selected figure, with no node', () => {
    const base = stateWith();
    const state = base.apply(base.tr.setSelection(NodeSelection.create(base.doc, diagramPos(base))));
    expect(diagramAt(state)).toMatchObject({ index: null, nodePos: null });
  });

  it('finds nothing outside a diagram', () => {
    expect(diagramAt(withCursor(stateWith(), 2))).toBeNull();
  });
});

describe('the toolbar commands', () => {
  it('switches the layout, and does nothing for the current one or a bad one', () => {
    const state = stateWith();
    const next = apply(state, setDiagramLayout(state, diagramPos(state), 'cycle'));
    expect(diagramOf(next).attrs.layout).toBe('cycle');
    expect(setDiagramLayout(next, diagramPos(next), 'cycle')).toBeNull();
    expect(setDiagramLayout(next, diagramPos(next), 'radial' as DiagramLayout)).toBeNull();
  });

  it('sets the title, trimmed, and clears it with an empty one', () => {
    const state = stateWith();
    const titled = apply(state, setDiagramTitle(state, diagramPos(state), '  The   HCD loop '));
    expect(diagramOf(titled).attrs.title).toBe('The HCD loop');
    expect(setDiagramTitle(titled, diagramPos(titled), 'The HCD loop')).toBeNull();
    expect(diagramOf(apply(titled, setDiagramTitle(titled, diagramPos(titled), '   '))).attrs.title).toBeNull();
  });

  it('is undoable, one step per command', () => {
    let state = stateWith();
    state = apply(state, setDiagramLayout(state, diagramPos(state), 'compare'));
    state = apply(state, addDiagramNode(state, diagramPos(state)));
    expect(ids(state)).toHaveLength(4);
    const back = run(state, undo).state;
    expect(ids(back)).toHaveLength(3);
    expect(diagramOf(back).attrs.layout).toBe('compare');
    expect(diagramOf(run(back, undo).state).attrs.layout).toBe('flow');
  });
});

describe('Add node', () => {
  it('appends an empty node with a fresh id and the diagram\'s pages, the cursor inside', () => {
    const state = stateWith();
    const next = apply(state, addDiagramNode(state, diagramPos(state)));
    expect(ids(next)).toEqual(['a', 'b', 'c', 'n1']);
    const added = diagramOf(next).child(3);
    expect(added.attrs.pages).toEqual([12]);
    expect(added.content.size).toBe(0);
    expect(diagramAt(next)?.index).toBe(3);
  });

  it('never reuses an id a node, a parent or a dangling edge still names', () => {
    const state = stateWith({
      nodes: [
        { id: 'n1', label: 'One' },
        { id: 'x', label: 'Two', parent: 'n2' },
      ],
      edges: [{ from: 'n3', to: 'x', label: null }],
    });
    expect(freshNodeId(diagramOf(state))).toBe('n4');
  });

  it('in a flow with edges, joins the new node on after the last step', () => {
    const state = stateWith({ edges: [{ from: 'a', to: 'b', label: null }, { from: 'b', to: 'c', label: null }] });
    const next = apply(state, addDiagramNode(state, diagramPos(state)));
    expect(edgePairs(next)).toEqual(['a>b', 'b>c', 'c>n1']);
  });

  it('in a flow with no edges, adds none: the sequence is implied', () => {
    const state = stateWith();
    expect(edgePairs(apply(state, addDiagramNode(state, diagramPos(state))))).toEqual([]);
  });

  it('in a cycle, splices the new node into the closing edge', () => {
    const state = stateWith({
      layout: 'cycle',
      edges: [
        { from: 'a', to: 'b', label: null },
        { from: 'b', to: 'c', label: null },
        { from: 'c', to: 'a', label: 'again' },
      ],
    });
    const next = apply(state, addDiagramNode(state, diagramPos(state)));
    expect(edgePairs(next)).toEqual(['a>b', 'b>c', 'c>n1', 'n1>a']);
    expect(diagramSpec(diagramOf(next)).edges[3]!.label).toBe('again');
  });

  it('in a tree, adds a child of the node the cursor is in', () => {
    const base = stateWith({
      layout: 'hierarchy',
      nodes: [
        { id: 'r', label: 'Root' },
        { id: 'k', label: 'Kid', parent: 'r' },
      ],
    });
    const state = withCursor(base, inNode(base, 1));
    const next = apply(state, addDiagramNode(state, diagramPos(state)));
    expect(diagramSpec(diagramOf(next)).nodes[2]!.parent).toBe('k');
    // With no cursor in the diagram: a sibling of the last node.
    const other = apply(base, addDiagramNode(base, diagramPos(base)));
    expect(diagramSpec(diagramOf(other)).nodes[2]!.parent).toBe('r');
  });

  it('in a comparison, adds to the group of the node the cursor is in', () => {
    const base = stateWith({
      layout: 'compare',
      nodes: [
        { id: 'f', label: 'Early', group: 'Formative' },
        { id: 's', label: 'Late', group: 'Summative' },
      ],
    });
    const state = withCursor(base, inNode(base, 0));
    expect(diagramSpec(diagramOf(apply(state, addDiagramNode(state, diagramPos(state))))).nodes[2]!.group).toBe('Formative');
  });

  it('is the learner\'s edit, and what they then type is theirs', () => {
    const state = stateWith();
    let next = apply(state, addDiagramNode(state, diagramPos(state)));
    next = next.apply(next.tr.insertText('Ship'));
    const text = diagramOf(next).child(3).firstChild!;
    expect(text.text).toBe('Ship');
    expect(text.marks.find((m) => m.type.name === 'author')?.attrs.by).toBe('user');
  });
});

describe('Delete node', () => {
  it('removes the node and every edge that touches it, and joins a link it was the middle of', () => {
    const state = stateWith({
      edges: [
        { from: 'a', to: 'b', label: null },
        { from: 'b', to: 'c', label: 'then' },
      ],
    });
    const next = apply(state, deleteDiagramNode(state, diagramPos(state), 1));
    expect(ids(next)).toEqual(['a', 'c']);
    expect(edgePairs(next)).toEqual(['a>c']);
    // The caret is at the end of the node before.
    expect(diagramAt(next)?.index).toBe(0);
    expect(next.selection.$from.parentOffset).toBe(4);
  });

  it('does not bridge a node that had several links', () => {
    const state = stateWith({
      edges: [
        { from: 'a', to: 'b', label: null },
        { from: 'c', to: 'b', label: null },
        { from: 'b', to: 'a', label: null },
      ],
    });
    expect(edgePairs(apply(state, deleteDiagramNode(state, diagramPos(state), 1)))).toEqual([]);
  });

  it('moves a deleted parent\'s children up to its own parent', () => {
    const state = stateWith({
      layout: 'hierarchy',
      nodes: [
        { id: 'r', label: 'Root' },
        { id: 'm', label: 'Middle', parent: 'r' },
        { id: 'l', label: 'Leaf', parent: 'm' },
      ],
    });
    const next = apply(state, deleteDiagramNode(state, diagramPos(state), 1));
    expect(diagramSpec(diagramOf(next)).nodes.map((n) => `${n.id}:${n.parent ?? '-'}`)).toEqual(['r:-', 'l:r']);
  });

  it('puts the caret in the new first node when the first is deleted', () => {
    const state = stateWith();
    const next = apply(state, deleteDiagramNode(state, diagramPos(state), 0));
    expect(labels(next)).toEqual(['Build', 'Test']);
    expect(diagramAt(next)?.index).toBe(0);
  });

  it('refuses to delete the last node, or one that is not there', () => {
    const state = stateWith({ nodes: [{ id: 'a', label: 'Only' }] });
    expect(deleteDiagramNode(state, diagramPos(state), 0)).toBeNull();
    const three = stateWith();
    expect(deleteDiagramNode(three, diagramPos(three), 7)).toBeNull();
  });
});

describe('the keys', () => {
  it('moves to the end of the next or previous node, and takes the key at either end', () => {
    const state = withCursor(stateWith(), inNode(stateWith(), 0, 1));
    const next = run(state, moveInDiagram(1));
    expect(diagramAt(next.state)?.index).toBe(1);
    expect(next.state.selection.$from.parentOffset).toBe('Build'.length);
    const back = run(next.state, moveInDiagram(-1));
    expect(diagramAt(back.state)?.index).toBe(0);
    const first = run(withCursor(stateWith(), inNode(stateWith(), 0)), moveInDiagram(-1));
    expect(first.handled).toBe(true);
    expect(diagramAt(first.state)?.index).toBe(0);
  });

  it('leaves the keys alone outside a diagram', () => {
    expect(run(withCursor(stateWith(), 2), moveInDiagram(1)).handled).toBe(false);
    expect(run(withCursor(stateWith(), 1), guardNodeEdge('start')).handled).toBe(false);
  });

  it('takes Backspace at a node\'s start and Delete at its end, and nowhere else', () => {
    const base = stateWith();
    expect(guardNodeEdge('start')(withCursor(base, inNode(base, 1)), undefined)).toBe(true);
    expect(guardNodeEdge('start')(withCursor(base, inNode(base, 1, 1)), undefined)).toBe(false);
    expect(guardNodeEdge('end')(withCursor(base, inNode(base, 1, 'Build'.length)), undefined)).toBe(true);
    expect(guardNodeEdge('end')(withCursor(base, inNode(base, 1, 2)), undefined)).toBe(false);
  });

  it('deletes a selection across nodes node by node, keeping every box', () => {
    const base = stateWith();
    // From "Pl|an" to "Te|st".
    const state = withCursor(base, inNode(base, 0, 2), inNode(base, 2, 2));
    const next = run(state, deleteSelectionAcross);
    expect(next.handled).toBe(true);
    expect(ids(next.state)).toEqual(['a', 'b', 'c']);
    expect(labels(next.state)).toEqual(['Pl', '', 'st']);
    expect(diagramAt(next.state)?.index).toBe(0);
    // Inside one node it is an ordinary delete.
    expect(deleteAcrossNodes(base, inNode(base, 0, 1), inNode(base, 0, 3))).toBeNull();
  });
});

describe('the id repair', () => {
  it('re-mints a duplicate id left by a split, and leaves the first one its edges', () => {
    const state = stateWith({ edges: [{ from: 'a', to: 'b', label: null }] });
    // What Enter would have done, had it not been bound: split "Pl|an".
    const split = state.apply(state.tr.split(inNode(state, 0, 2)));
    expect(ids(split)).toEqual(['a', 'n1', 'b', 'c']);
    expect(edgePairs(split)).toEqual(['a>b']);
  });

  it('does nothing to a diagram whose ids are fine', () => {
    const state = stateWith();
    expect(repairNodeIds(state.tr)).toBeNull();
  });
});

describe('pasting into a label', () => {
  it('treats text lifted out of a paragraph as inline, and whole paragraphs as blocks', () => {
    const p = notesSchema.nodes.paragraph!.create(null, notesSchema.text('x'));
    expect(hasBlocks(new Slice(Fragment.from(p), 1, 1))).toBe(false);
    expect(hasBlocks(new Slice(Fragment.from([p, p]), 1, 1))).toBe(true);
    expect(hasBlocks(new Slice(Fragment.from(notesSchema.text('x')), 0, 0))).toBe(false);
  });
});
