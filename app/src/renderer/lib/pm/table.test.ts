import { describe, expect, it } from 'vitest';
import { Fragment, Slice, type Node } from 'prosemirror-model';
import { GapCursor } from 'prosemirror-gapcursor';
import { history, undo } from 'prosemirror-history';
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state';
import { deleteSelection } from 'prosemirror-commands';
import { blockPos, hasLearnerText, notesSchema, tableGrid } from '../../../shared/doc/schema.js';
import { docOf, para, table } from '../../../shared/doc/fixture.test-support.js';
import { authorship } from './authorship.js';
import { insertTargetId } from './insertat.js';
import {
  addColumnRight,
  addRowBelow,
  canRemoveColumn,
  canRemoveRow,
  cellContext,
  cellPosAt,
  constrainSelection,
  deleteColumn,
  deleteRow,
  flattenForCell,
  padTables,
  setCaption,
  tableGuard,
  tableKeymap,
  tableWidth,
} from './table.js';

const keys = tableKeymap();

/** Paragraph · a 3-column table (heading + 2 rows, row pages [4] and [5]) · paragraph. */
function sample(opts: { last?: boolean } = {}): Node {
  const grid = table(
    'b_t',
    ['Prototype', 'Tests', 'Hides'],
    [
      ['Paper', 'flow', 'timing'],
      ['Wizard', 'dialogue', 'cost'],
    ],
    { editId: 'e_1', rowPages: [[4], [5]], caption: 'Fidelity' },
  );
  return opts.last ? docOf(para('b_a', 'Before.', 'ingest', null, [3]), grid) : docOf(
    para('b_a', 'Before.', 'ingest', null, [3]),
    grid,
    para('b_z', 'After.', 'ingest', null, [6]),
  );
}

function stateWith(doc: Node): EditorState {
  return EditorState.create({ doc, plugins: [authorship({ now: () => 7 }), tableGuard(), history()] });
}

function tableOf(state: EditorState): { pos: number; node: Node } {
  return blockPos(state.doc, 'b_t')!;
}

/** A caret in cell (row, col) of the sample table: at its start, its end, or `offset` in. */
function inCell(state: EditorState, row: number, col: number, at: 'start' | 'end' | number = 'end'): EditorState {
  const t = tableOf(state);
  const pos = cellPosAt(t.node, t.pos, row, col)!;
  const cell = state.doc.nodeAt(pos)!;
  const offset = at === 'start' ? 1 : at === 'end' ? cell.nodeSize - 1 : 1 + at;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + offset)));
}

function run(state: EditorState, command: Command): { handled: boolean; state: EditorState } {
  let next = state;
  const handled = command(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  return { handled, state: next };
}

function where(state: EditorState): { row: number; col: number; offset: number } | null {
  const at = cellContext(state.selection.$head);
  return at ? { row: at.row, col: at.col, offset: state.selection.$head.parentOffset } : null;
}

/** The table is a rectangle, the schema holds, and the heading row is still all header cells. */
function expectWellFormed(state: EditorState): void {
  state.doc.check();
  const t = tableOf(state);
  const widths: number[] = [];
  t.node.forEach((row) => widths.push(row.childCount));
  expect(new Set(widths).size).toBe(1);
  t.node.child(0).forEach((cell) => expect(cell.attrs.header).toBe(true));
}

function type(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

describe('cellContext', () => {
  it('names the row and column the caret is in, and nothing outside a table', () => {
    const state = stateWith(sample());
    expect(where(inCell(state, 2, 1, 'start'))).toEqual({ row: 2, col: 1, offset: 0 });
    expect(cellContext(state.doc.resolve(2))).toBeNull();
  });
});

describe('Tab and Shift-Tab', () => {
  it('moves to the next cell, wrapping onto the next row, with the caret at the end', () => {
    let state = inCell(stateWith(sample()), 0, 2, 'start');
    const tab = run(state, keys.Tab!);
    expect(tab.handled).toBe(true);
    expect(where(tab.state)).toEqual({ row: 1, col: 0, offset: 'Paper'.length });
    state = run(tab.state, keys['Shift-Tab']!).state;
    expect(where(state)).toEqual({ row: 0, col: 2, offset: 'Hides'.length });
  });

  it('adds a row from the last cell, copying that row’s pages, and puts the caret in it', () => {
    const state = inCell(stateWith(sample()), 2, 2);
    const next = run(state, keys.Tab!).state;
    expectWellFormed(next);
    const t = tableOf(next).node;
    expect(t.childCount).toBe(4);
    expect(t.child(3).attrs.pages).toEqual([5]);
    expect(t.child(3).textContent).toBe('');
    expect(where(next)).toEqual({ row: 3, col: 0, offset: 0 });
  });

  it('stays in the first cell on Shift-Tab, but handles the key', () => {
    const state = inCell(stateWith(sample()), 0, 0, 'start');
    const back = run(state, keys['Shift-Tab']!);
    expect(back.handled).toBe(true);
    expect(back.state.doc.eq(state.doc)).toBe(true);
  });

  it('is not the table’s outside a table', () => {
    const state = stateWith(sample());
    expect(run(state, keys.Tab!).handled).toBe(false);
  });
});

describe('Enter', () => {
  it('moves to the cell below and never splits the cell', () => {
    const state = inCell(stateWith(sample()), 1, 1, 2);
    const next = run(state, keys.Enter!);
    expect(next.handled).toBe(true);
    expect(next.state.doc.eq(state.doc)).toBe(true);
    expect(where(next.state)).toEqual({ row: 2, col: 1, offset: 'dialogue'.length });
  });

  it('does nothing in the last row, and still handles the key', () => {
    const state = inCell(stateWith(sample()), 2, 0, 1);
    const next = run(state, keys.Enter!);
    expect(next.handled).toBe(true);
    expect(next.state.doc.eq(state.doc)).toBe(true);
    expect(where(next.state)).toEqual({ row: 2, col: 0, offset: 1 });
  });
});

describe('Backspace and Delete at a cell’s edges', () => {
  it('swallows Backspace at the start and Delete at the end, and passes both inside the text', () => {
    const state = stateWith(sample());
    expect(keys.Backspace!(inCell(state, 1, 1, 'start'))).toBe(true);
    expect(keys['Alt-Backspace']!(inCell(state, 1, 1, 'start'))).toBe(true);
    expect(keys.Delete!(inCell(state, 1, 1, 'end'))).toBe(true);
    expect(keys.Backspace!(inCell(state, 1, 1, 2))).toBe(false);
    expect(keys.Delete!(inCell(state, 1, 1, 2))).toBe(false);
  });

  it('never dispatches: the document is untouched', () => {
    const state = inCell(stateWith(sample()), 2, 0, 'start');
    const next = run(state, keys.Backspace!);
    expect(next.state).toBe(state);
  });
});

describe('the arrow keys at a cell’s edges', () => {
  it('moves right into the next cell and left into the previous one', () => {
    const state = stateWith(sample());
    const right = run(inCell(state, 1, 0, 'end'), keys.ArrowRight!).state;
    expect(where(right)).toEqual({ row: 1, col: 1, offset: 0 });
    const left = run(inCell(state, 1, 0, 'start'), keys.ArrowLeft!).state;
    expect(where(left)).toEqual({ row: 0, col: 2, offset: 'Hides'.length });
  });

  it('leaves the text inside a cell to the browser', () => {
    const state = inCell(stateWith(sample()), 1, 0, 2);
    expect(run(state, keys.ArrowRight!).handled).toBe(false);
    expect(run(state, keys.ArrowLeft!).handled).toBe(false);
  });

  it('moves up and down in the same column, and out of the table past its ends', () => {
    const state = stateWith(sample());
    expect(where(run(inCell(state, 1, 2, 1), keys.ArrowDown!).state)).toEqual({ row: 2, col: 2, offset: 0 });
    const out = run(inCell(state, 2, 1, 1), keys.ArrowDown!).state;
    expect(out.selection.$head.parent.attrs.blockId).toBe('b_z');
    const up = run(inCell(state, 0, 1, 1), keys.ArrowUp!).state;
    expect(up.selection.$head.parent.attrs.blockId).toBe('b_a');
  });

  it('puts a gap cursor after a table that ends the notes, never one between cells', () => {
    const state = stateWith(sample({ last: true }));
    const out = run(inCell(state, 2, 2), keys.ArrowRight!).state;
    expect(out.selection).toBeInstanceOf(GapCursor);
    expect(out.selection.$head.depth).toBe(0);
    expect(out.selection.head).toBe(out.doc.content.size);
  });
});

describe('structure edits', () => {
  it('adds a row below the cursor’s, empty, with that row’s pages, in the history', () => {
    const state = inCell(stateWith(sample()), 1, 1);
    const next = run(state, addRowBelow).state;
    expectWellFormed(next);
    const t = tableOf(next).node;
    expect(t.childCount).toBe(4);
    expect(t.child(2).attrs.pages).toEqual([4]);
    expect(t.child(2).textContent).toBe('');
    expect(where(next)).toEqual({ row: 2, col: 1, offset: 0 });
    expect(undo(next, (tr) => expect(next.apply(tr).doc.eq(state.doc)).toBe(true))).toBe(true);
  });

  it('adds a data row with no pages under the heading row', () => {
    const next = run(inCell(stateWith(sample()), 0, 0), addRowBelow).state;
    const row = tableOf(next).node.child(1);
    expect(row.attrs.pages).toEqual([]);
    row.forEach((cell) => expect(cell.attrs.header).toBe(false));
  });

  it('adds a column to the right, a header cell in the heading row and empty cells below', () => {
    const next = run(inCell(stateWith(sample()), 2, 0), addColumnRight).state;
    expectWellFormed(next);
    expect(tableGrid(tableOf(next).node)).toEqual({
      caption: 'Fidelity',
      columns: ['Prototype', '', 'Tests', 'Hides'],
      rows: [
        ['Paper', '', 'flow', 'timing'],
        ['Wizard', '', 'dialogue', 'cost'],
      ],
    });
    expect(where(next)).toEqual({ row: 2, col: 1, offset: 0 });
  });

  it('deletes the cursor’s row and column, and refuses the heading row, the last data row and the second column', () => {
    let state = inCell(stateWith(sample()), 1, 2);
    const t = tableOf(state).node;
    expect(canRemoveRow(t, 0)).toBe(false);
    expect(run(inCell(state, 0, 1), deleteRow).handled).toBe(false);

    state = run(state, deleteRow).state;
    expectWellFormed(state);
    expect(tableGrid(tableOf(state).node).rows).toEqual([['Wizard', 'dialogue', 'cost']]);
    expect(run(inCell(state, 1, 0), deleteRow).handled).toBe(false);

    state = run(inCell(state, 1, 1), deleteColumn).state;
    expectWellFormed(state);
    expect(tableGrid(tableOf(state).node).columns).toEqual(['Prototype', 'Hides']);
    expect(canRemoveColumn(tableOf(state).node)).toBe(false);
    expect(run(inCell(state, 1, 0), deleteColumn).handled).toBe(false);
  });

  it('never hands Ellie’s cells to the learner', () => {
    let state = inCell(stateWith(sample()), 1, 1);
    state = run(state, addRowBelow).state;
    state = run(inCell(state, 1, 1), addColumnRight).state;
    state = run(inCell(state, 2, 0), deleteRow).state;
    state = run(inCell(state, 1, 1), deleteColumn).state;
    expect(hasLearnerText(tableOf(state).node)).toBe(false);
  });

  it('makes what the learner types in a cell theirs', () => {
    const state = type(run(inCell(stateWith(sample()), 1, 1), addRowBelow).state, 'mine');
    const cell = tableOf(state).node.child(2).child(1);
    expect(cell.textContent).toBe('mine');
    expect(cell.firstChild!.marks.find((m) => m.type.name === 'author')?.attrs.by).toBe('user');
  });

  it('sets and clears the caption as an undoable edit, and ignores a no-op', () => {
    const state = stateWith(sample());
    const pos = tableOf(state).pos;
    const set = state.apply(setCaption(state, pos, '  Paper vs Wizard ')!);
    expect(tableOf(set).node.attrs.caption).toBe('Paper vs Wizard');
    expect(setCaption(set, pos, 'Paper vs Wizard')).toBeNull();
    expect(tableOf(set.apply(setCaption(set, pos, '')!)).node.attrs.caption).toBeNull();
    expect(hasLearnerText(tableOf(set).node)).toBe(false);
  });
});

describe('selecting across cells', () => {
  it('clamps a selection that starts in a cell to that cell, so Delete leaves a rectangle', () => {
    const state = stateWith(sample());
    const t = tableOf(state);
    const from = cellPosAt(t.node, t.pos, 1, 0)! + 3;
    const to = cellPosAt(t.node, t.pos, 2, 1)! + 3;
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    expect(selected.selection.from).toBe(from);
    expect(selected.selection.to).toBe(cellPosAt(t.node, t.pos, 1, 0)! + 1 + 'Paper'.length);

    const deleted = run(selected, deleteSelection).state;
    expectWellFormed(deleted);
    expect(tableGrid(tableOf(deleted).node).rows).toEqual([
      ['Pa', 'flow', 'timing'],
      ['Wizard', 'dialogue', 'cost'],
    ]);
  });

  it('clamps backwards too: a head before the anchor goes to the cell’s start', () => {
    const state = stateWith(sample());
    const t = tableOf(state);
    const anchor = cellPosAt(t.node, t.pos, 2, 1)! + 3;
    const head = cellPosAt(t.node, t.pos, 1, 0)! + 2;
    const fixed = constrainSelection(state.doc, TextSelection.create(state.doc, anchor, head))!;
    expect(fixed.anchor).toBe(anchor);
    expect(fixed.head).toBe(cellPosAt(t.node, t.pos, 2, 1)! + 1);
  });

  it('stretches a selection from outside over the whole table, so Delete removes it whole', () => {
    const state = stateWith(sample());
    const t = tableOf(state);
    const into = cellPosAt(t.node, t.pos, 1, 1)! + 2;
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, into)));
    expect(selected.selection.head).toBe(t.pos + t.node.nodeSize + 1);
    const deleted = run(selected, deleteSelection).state;
    deleted.doc.check();
    expect(blockPos(deleted.doc, 'b_t')).toBeNull();
    expect(deleted.doc.textContent).toBe('BeAfter.');
  });

  it('turns a node selection of a cell into a caret, and a gap cursor between cells into one too', () => {
    const state = stateWith(sample());
    const t = tableOf(state);
    const cell = cellPosAt(t.node, t.pos, 1, 1)!;
    const node = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, cell)));
    expect(node.selection).toBeInstanceOf(TextSelection);
    expect(where(node)).toEqual({ row: 1, col: 1, offset: 'flow'.length });

    const gap = state.apply(state.tr.setSelection(new GapCursor(state.doc.resolve(cell))));
    expect(gap.selection).toBeInstanceOf(TextSelection);
    expect(cellContext(gap.selection.$head)).not.toBeNull();
  });
});

describe('flattenForCell, a paste into a cell', () => {
  const twoParagraphs = new Slice(
    Fragment.from([para('b_p1', 'First **line**', 'user'), para('b_p2', 'second.', 'user')]),
    1,
    1,
  );

  it('joins pasted paragraphs into one line, marks kept, and the row keeps its width', () => {
    const state = inCell(stateWith(sample()), 1, 1);
    const flat = flattenForCell(twoParagraphs)!;
    const next = state.apply(state.tr.replaceSelection(flat));
    expectWellFormed(next);
    const cell = tableOf(next).node.child(1).child(1);
    expect(cell.textContent).toBe('flowFirst line second.');
    expect(cell.content.child(2).marks.some((m) => m.type.name === 'strong')).toBe(true);
  });

  it('is what stops the default fit, which cuts the table in two round the second paragraph', () => {
    const bare = inCell(EditorState.create({ doc: sample() }), 1, 1);
    const fitted = bare.apply(bare.tr.replaceSelection(twoParagraphs));
    const kinds: string[] = [];
    fitted.doc.forEach((node) => kinds.push(node.type.name));
    expect(kinds).toEqual(['paragraph', 'table', 'paragraph', 'table', 'paragraph']);
  });

  it('leaves inline content and a single textblock to the default', () => {
    expect(flattenForCell(new Slice(Fragment.from(notesSchema.text('x')), 0, 0))).toBeNull();
    expect(flattenForCell(new Slice(Fragment.from(para('b_p', 'one')), 1, 1))).toBeNull();
  });
});

describe('padTables, the backstop', () => {
  it('pads a row that lost a cell, and the guard does it on any transaction', () => {
    const state = stateWith(sample());
    const t = tableOf(state);
    // A cross-cell delete with no guard in the way: ProseMirror joins the two cells into one.
    const bare = EditorState.create({ doc: state.doc });
    const from = cellPosAt(t.node, t.pos, 1, 0)! + 3;
    const to = cellPosAt(t.node, t.pos, 1, 1)! + 3;
    const ragged = bare.apply(bare.tr.delete(from, to));
    const widths: number[] = [];
    tableOf(ragged).node.forEach((row) => widths.push(row.childCount));
    expect(widths).toEqual([3, 2, 3]);

    const padded = padTables(ragged.tr)!;
    expect(tableWidth(padded.doc.nodeAt(t.pos)!)).toBe(3);
    const fixed = ragged.apply(padded);
    expectWellFormed(fixed);
    expect(tableGrid(tableOf(fixed).node).rows[0]).toEqual(['Paow', 'timing', '']);

    const guarded = state.apply(state.tr.delete(from, to));
    expectWellFormed(guarded);
  });

  it('does nothing to a rectangle', () => {
    expect(padTables(stateWith(sample()).tr)).toBeNull();
  });
});

describe('insertTargetId', () => {
  it('is the top-level block the selection ends in, a table included', () => {
    const state = stateWith(sample());
    expect(insertTargetId(inCell(state, 2, 1))).toBe('b_t');
    expect(insertTargetId(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3))))).toBe('b_a');
  });

  it('is the block before a selection that ends between blocks', () => {
    const doc = docOf(para('b_a', 'Before.'), notesSchema.nodes.math_block!.create({ blockId: 'b_m', tex: 'x' }));
    const state = EditorState.create({ doc });
    const math = blockPos(doc, 'b_m')!.pos;
    expect(insertTargetId(state.apply(state.tr.setSelection(NodeSelection.create(doc, math))))).toBe('b_m');
  });
});
