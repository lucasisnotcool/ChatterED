/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE TABLE, EDITED AS TEXT AND KEPT RECTANGULAR (2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Ellie inserts a comparison table when the learner asks (`notesGenerateBlock`), and from then on
 * it is the learner's to edit like any other text: what they type in a cell wears their author
 * mark (`authorship.ts`), and the guard protects it. This file is the pure half — where the cursor
 * is in a table, the keys that move between cells, the four structure edits, and the plugin that
 * keeps every table a rectangle. The chrome (caption, toolbar, row chips) is `tableview.ts`.
 *
 * ## Why there is no prosemirror-tables
 *
 * The schema has no colspan or rowspan, so the one hard problem that library solves (a cell grid
 * that is not a grid) does not exist here. What is left is small enough to own: the invariant is
 * **every row has the same number of cells**, and the ways to break it are few and named below.
 *
 * ## How the invariant is kept
 *
 *  1. **No selection spans cells.** `constrainSelection` clamps a text selection that starts in a
 *     cell to that cell, and stretches one that starts outside a table and ends inside it over the
 *     whole table. That closes every path at once — Delete, typing over, paste, cut, drag, IME —
 *     where a cross-cell selection would have joined two cells into one. A multi-cell selection is
 *     the price, and nothing in the notes needs one.
 *  2. **No key merges or splits a cell.** Enter moves down instead of splitting; Backspace at a
 *     cell's start and Delete at its end do nothing (`stayInCell`) instead of falling through to
 *     the browser, which would merge the cells in the DOM for ProseMirror to read back.
 *  3. **No gap cursor inside a table.** The cells are isolating textblocks, which makes the gap
 *     *between* two cells a valid gap-cursor position to `prosemirror-gapcursor`; text typed there
 *     would become a new cell in one row. The arrow keys are handled here before the gap cursor's,
 *     and a gap cursor that gets in anyway (a click on a border) is turned into a caret.
 *  4. **A paste or a drop into a cell is one line** (`flattenForCell`): pasted paragraphs are
 *     joined. ProseMirror's own fit of two paragraphs into a cell cuts the table in two round the
 *     second one, which no padding could put back.
 *  5. **A ragged table is padded** (`padTables`) as the backstop, for whatever is left: a pasted
 *     HTML table with a short row, or a path nobody has thought of. Padding adds empty cells at
 *     the row's end; it never moves or removes a cell's text.
 *
 * Every edit here is an ordinary undoable transaction with small steps (an insert of empty cells,
 * a delete of whole ones), never a replace of the whole table: `authorship` stamps whatever a
 * learner transaction *inserted*, and a whole-table replace would hand Ellie's cells to the learner.
 */

import { Fragment, Slice, type Node, type ResolvedPos } from 'prosemirror-model';
import { GapCursor } from 'prosemirror-gapcursor';
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { notesSchema } from '../../../shared/doc/schema.js';

/** The fewest columns a table may be edited down to, and the fewest data rows. */
export const MIN_COLUMNS = 2;
export const MIN_DATA_ROWS = 1;

// ── where the cursor is ──────────────────────────────────────────────────────────────────────

export interface CellContext {
  /** Position before the `table` node, and the node. */
  tablePos: number;
  table: Node;
  /** Row and column index of the cell (the heading row is row 0). */
  row: number;
  col: number;
  /** Position before the `table_cell` node, and the node. */
  cellPos: number;
  cell: Node;
}

/** The cell a position is in, or null outside every table. The innermost table wins. */
export function cellContext($pos: ResolvedPos): CellContext | null {
  for (let depth = $pos.depth; depth >= 2; depth--) {
    if ($pos.node(depth).type.name !== 'table_cell') continue;
    return {
      tablePos: $pos.before(depth - 2),
      table: $pos.node(depth - 2),
      row: $pos.index(depth - 2),
      col: $pos.index(depth - 1),
      cellPos: $pos.before(depth),
      cell: $pos.node(depth),
    };
  }
  return null;
}

/** A row is the heading row when every cell in it is a header cell (`tableGrid`'s rule). */
export function isHeaderRow(row: Node): boolean {
  let header = row.childCount > 0;
  row.forEach((cell) => {
    if (!(cell.attrs.header as boolean)) header = false;
  });
  return header;
}

/** The widest row. Equal to every row's width in a table this file has had its hands on. */
export function tableWidth(table: Node): number {
  let width = 0;
  table.forEach((row) => {
    width = Math.max(width, row.childCount);
  });
  return width;
}

function headed(table: Node): boolean {
  return table.childCount > 0 && isHeaderRow(table.child(0));
}

/** Position before the cell at (`row`, `col`), or null when there is none. */
export function cellPosAt(table: Node, tablePos: number, row: number, col: number): number | null {
  if (row < 0 || row >= table.childCount) return null;
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  const tr = table.child(row);
  if (col < 0 || col >= tr.childCount) return null;
  pos += 1;
  for (let c = 0; c < col; c++) pos += tr.child(c).nodeSize;
  return pos;
}

function rowPosAt(table: Node, tablePos: number, row: number): number {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  return pos;
}

/** A caret at the start or the end of the cell at `cellPos`. */
function caretIn(doc: Node, cellPos: number, at: 'start' | 'end'): TextSelection {
  const cell = doc.nodeAt(cellPos);
  const offset = at === 'start' || !cell ? 1 : cell.nodeSize - 1;
  return TextSelection.create(doc, cellPos + offset);
}

function emptyCell(header: boolean): Node {
  return notesSchema.nodes.table_cell!.create({ header });
}

// ── moving between cells ─────────────────────────────────────────────────────────────────────

/**
 * **Tab / Shift-Tab**: the next or previous cell, in reading order, with the caret at its end.
 *
 * Tab in the last cell adds a row (copying that row's `pages`, as the toolbar's add does) and puts
 * the caret in its first cell. Shift-Tab in the first cell stays put, but is still *handled*: left
 * to the browser, it would move focus out of the notes altogether.
 */
export function goToCell(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const at = cellContext(state.selection.$head);
    if (!at) return false;
    const { table, tablePos } = at;
    let row = at.row;
    let col = at.col + dir;
    if (col >= table.child(row).childCount) {
      row += 1;
      col = 0;
    } else if (col < 0) {
      row -= 1;
      col = row >= 0 ? table.child(row).childCount - 1 : 0;
    }
    if (row < 0) return true;
    if (!dispatch) return true;
    if (row >= table.childCount) {
      const tr = insertRow(state.tr, tablePos, table, at.row);
      const first = cellPosAt(tr.doc.nodeAt(tablePos)!, tablePos, at.row + 1, 0)!;
      dispatch(tr.setSelection(caretIn(tr.doc, first, 'start')).scrollIntoView());
      return true;
    }
    const target = cellPosAt(table, tablePos, row, col)!;
    dispatch(state.tr.setSelection(caretIn(state.doc, target, 'end')).scrollIntoView());
    return true;
  };
}

/**
 * **Enter** (and Shift-Enter): the cell below, same column, caret at its end. Never a split: the
 * base keymap's `splitBlock` would cut the cell in two and leave its row a cell longer than the
 * rest. In the last row it does nothing, and says so by handling the key.
 */
export const cellBelow: Command = (state, dispatch) => {
  const at = cellContext(state.selection.$head);
  if (!at) return false;
  const next = at.row + 1;
  if (next >= at.table.childCount || !dispatch) return true;
  const col = Math.min(at.col, at.table.child(next).childCount - 1);
  const target = cellPosAt(at.table, at.tablePos, next, col)!;
  dispatch(state.tr.setSelection(caretIn(state.doc, target, 'end')).scrollIntoView());
  return true;
};

/**
 * **Backspace at a cell's start, Delete at its end**: handled, and nothing happens.
 *
 * `joinBackward` and `joinForward` already refuse to cross an isolating cell — but they refuse by
 * returning false, and then the key reaches the browser, whose own contenteditable delete merges
 * the two `<td>`s for ProseMirror to read back as a joined cell. Returning true stops that.
 */
export function stayInCell(dir: -1 | 1): Command {
  return (state) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const $head = selection.$head;
    if (!cellContext($head)) return false;
    return dir < 0 ? $head.parentOffset === 0 : $head.parentOffset === $head.parent.content.size;
  };
}

/**
 * Out of the table past its first or last cell: the nearest place to put a cursor before or after
 * it, or a gap cursor beside it when there is nothing there (a table that ends the notes).
 */
function leaveTable(state: EditorState, at: CellContext, dir: 1 | -1): Selection {
  const $edge = state.doc.resolve(dir > 0 ? at.tablePos + at.table.nodeSize : at.tablePos);
  return Selection.findFrom($edge, dir) ?? new GapCursor($edge);
}

/**
 * **The arrow keys**, only where the caret is at the edge of its cell in that direction; inside a
 * cell's text they are the browser's, as everywhere else.
 *
 * At an edge they move to the neighbouring cell (left and right in reading order, up and down in
 * the same column) and out of the table past its ends. They exist for rule 3 of the header: the
 * gap cursor's own arrow handling would otherwise stop *between* two cells. `view` decides what an
 * edge is (a cell can wrap onto several lines); without one, the caret's offset does.
 */
export function arrow(axis: 'horiz' | 'vert', dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const at = cellContext(selection.$head);
    if (!at) return false;
    const $head = selection.$head;
    const side = axis === 'horiz' ? (dir > 0 ? 'right' : 'left') : dir > 0 ? 'down' : 'up';
    const edge = view
      ? view.endOfTextblock(side)
      : axis === 'vert' || (dir > 0 ? $head.parentOffset === $head.parent.content.size : $head.parentOffset === 0);
    if (!edge) return false;

    const { table, tablePos } = at;
    let target: number | null;
    if (axis === 'horiz') {
      let row = at.row;
      let col = at.col + dir;
      if (col >= table.child(row).childCount) {
        row += 1;
        col = 0;
      } else if (col < 0) {
        row -= 1;
        col = row >= 0 ? table.child(row).childCount - 1 : 0;
      }
      target = cellPosAt(table, tablePos, row, col);
    } else {
      const row = at.row + dir;
      const width = row >= 0 && row < table.childCount ? table.child(row).childCount : 0;
      target = width > 0 ? cellPosAt(table, tablePos, row, Math.min(at.col, width - 1)) : null;
    }
    if (dispatch) {
      const next =
        target === null
          ? leaveTable(state, at, dir)
          : caretIn(state.doc, target, dir > 0 ? 'start' : 'end');
      dispatch(state.tr.setSelection(next).scrollIntoView());
    }
    return true;
  };
}

// ── structure: rows and columns ──────────────────────────────────────────────────────────────

/**
 * Insert an empty row after row `after`. It copies that row's width and its `pages` ("a new row
 * copies the pages of the row it was added from"); a row added under the heading row is a data
 * row, with no pages, because the heading row has none of its own.
 */
function insertRow(tr: Transaction, tablePos: number, table: Node, after: number): Transaction {
  const from = table.child(after);
  const width = Math.max(tableWidth(table), 1);
  const heading = after === 0 && headed(table);
  const pages = heading ? [] : [...((from.attrs.pages as number[] | undefined) ?? [])];
  const row = notesSchema.nodes.table_row!.create(
    { pages },
    Array.from({ length: width }, () => emptyCell(false)),
  );
  const at = rowPosAt(table, tablePos, after) + from.nodeSize;
  return tr.insert(at, row);
}

/** The table at `tablePos`, or null when something else is there now. */
function tableAt(state: EditorState, tablePos: number): Node | null {
  const node = state.doc.nodeAt(tablePos);
  return node && node.type.name === 'table' ? node : null;
}

/** Add a row below row `after` (clamped to the last row), caret in its cell under `col`. */
export function addRow(state: EditorState, tablePos: number, after: number, col = 0): Transaction | null {
  const table = tableAt(state, tablePos);
  if (!table) return null;
  const row = Math.max(0, Math.min(after, table.childCount - 1));
  const tr = insertRow(state.tr, tablePos, table, row);
  const next = tr.doc.nodeAt(tablePos)!;
  const cell = cellPosAt(next, tablePos, row + 1, Math.max(0, Math.min(col, next.child(row + 1).childCount - 1)))!;
  return tr.setSelection(caretIn(tr.doc, cell, 'start')).scrollIntoView();
}

/**
 * Add an empty column to the right of column `after` (clamped to the last), caret in its cell on
 * row `row`. Its heading cell is a header cell. One small insert per row, from the bottom up so
 * no insert moves the positions of the ones still to come.
 */
export function addColumn(state: EditorState, tablePos: number, after: number, row = 0): Transaction | null {
  const table = tableAt(state, tablePos);
  if (!table) return null;
  const tr = state.tr;
  for (let r = table.childCount - 1; r >= 0; r--) {
    const current = table.child(r);
    const col = Math.max(0, Math.min(after, current.childCount - 1));
    const cellPos = cellPosAt(table, tablePos, r, col)!;
    tr.insert(cellPos + current.child(col).nodeSize, emptyCell(isHeaderRow(current)));
  }
  const next = tr.doc.nodeAt(tablePos)!;
  const r = Math.max(0, Math.min(row, next.childCount - 1));
  const col = Math.min(Math.max(0, after) + 1, next.child(r).childCount - 1);
  return tr.setSelection(caretIn(tr.doc, cellPosAt(next, tablePos, r, col)!, 'end')).scrollIntoView();
}

/** How many rows are data rows: all of them but the heading row. */
function dataRows(table: Node): number {
  return table.childCount - (headed(table) ? 1 : 0);
}

/** Row `row` may go: it is not the heading row, and it is not the last data row. */
export function canRemoveRow(table: Node, row: number): boolean {
  if (row < 0 || row >= table.childCount) return false;
  if (row === 0 && headed(table)) return false;
  return dataRows(table) > MIN_DATA_ROWS;
}

/** A column may go while the table is wider than `MIN_COLUMNS`. */
export function canRemoveColumn(table: Node): boolean {
  return tableWidth(table) > MIN_COLUMNS;
}

/** Delete row `row`, caret in the same column of the row that takes its place. Null if refused. */
export function removeRow(state: EditorState, tablePos: number, row: number, col = 0): Transaction | null {
  const table = tableAt(state, tablePos);
  if (!table || !canRemoveRow(table, row)) return null;
  const from = rowPosAt(table, tablePos, row);
  const tr = state.tr.delete(from, from + table.child(row).nodeSize);
  const next = tr.doc.nodeAt(tablePos)!;
  const r = Math.min(row, next.childCount - 1);
  const c = Math.max(0, Math.min(col, next.child(r).childCount - 1));
  return tr.setSelection(caretIn(tr.doc, cellPosAt(next, tablePos, r, c)!, 'end')).scrollIntoView();
}

/** Delete column `col` from every row that has one, caret in the cell to its left. Null if refused. */
export function removeColumn(state: EditorState, tablePos: number, col: number, row = 0): Transaction | null {
  const table = tableAt(state, tablePos);
  if (!table || !canRemoveColumn(table) || col < 0 || col >= tableWidth(table)) return null;
  const tr = state.tr;
  for (let r = table.childCount - 1; r >= 0; r--) {
    const cellPos = cellPosAt(table, tablePos, r, col);
    // A short row has no cell here; a one-cell row keeps its cell (`table_cell+`).
    if (cellPos === null || table.child(r).childCount <= 1) continue;
    tr.delete(cellPos, cellPos + table.child(r).child(col).nodeSize);
  }
  const next = tr.doc.nodeAt(tablePos)!;
  const r = Math.max(0, Math.min(row, next.childCount - 1));
  const c = Math.max(0, Math.min(col - 1, next.child(r).childCount - 1));
  return tr.setSelection(caretIn(tr.doc, cellPosAt(next, tablePos, r, c)!, 'end')).scrollIntoView();
}

/** The four structure edits as commands on the cell that holds the cursor. */
function onCell(edit: (state: EditorState, at: CellContext) => Transaction | null): Command {
  return (state, dispatch) => {
    const at = cellContext(state.selection.$head);
    if (!at) return false;
    const tr = edit(state, at);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

export const addRowBelow = onCell((state, at) => addRow(state, at.tablePos, at.row, at.col));
export const addColumnRight = onCell((state, at) => addColumn(state, at.tablePos, at.col, at.row));
export const deleteRow = onCell((state, at) => removeRow(state, at.tablePos, at.row, at.col));
export const deleteColumn = onCell((state, at) => removeColumn(state, at.tablePos, at.col, at.row));

/** Set or clear the caption (`null` for none). The learner's own, undoable edit. */
export function setCaption(state: EditorState, tablePos: number, caption: string | null): Transaction | null {
  const table = tableAt(state, tablePos);
  if (!table) return null;
  const next = caption && caption.trim().length > 0 ? caption.trim() : null;
  if (next === ((table.attrs.caption as string | null) || null)) return null;
  return state.tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, caption: next });
}

// ── the invariant ────────────────────────────────────────────────────────────────────────────

/**
 * Pad every short row to the table's width with empty cells at its end (rule 4). Null when every
 * table is already a rectangle. Header cells in the heading row, data cells elsewhere.
 */
export function padTables(tr: Transaction): Transaction | null {
  const fixes: { at: number; cells: Node[] }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock;
    const width = tableWidth(node);
    node.forEach((row, offset) => {
      if (row.childCount >= width) return;
      const header = isHeaderRow(row);
      fixes.push({
        at: pos + 1 + offset + row.nodeSize - 1,
        cells: Array.from({ length: width - row.childCount }, () => emptyCell(header)),
      });
    });
    return false;
  });
  if (fixes.length === 0) return null;
  for (const fix of fixes.reverse()) tr.insert(fix.at, fix.cells);
  return tr;
}

/**
 * The selection the table rules allow in place of `selection`, or null when it is allowed as it
 * is (rules 1 and 3).
 *
 *  - A text selection starting in a cell ends in that cell: its head is clamped to the cell's
 *    start or end, whichever way it was going.
 *  - A text selection starting outside every table and ending inside one covers that whole table:
 *    its head goes to the first place past it, or back to the last place before it when the table
 *    ends the notes. (Whole tables in a range are fine: deleting them is deleting a block.)
 *  - A node selection of a row or a cell becomes a caret in that cell (a Delete there would take
 *    a cell out of one row), and a gap cursor inside a table becomes the nearest caret.
 */
export function constrainSelection(doc: Node, selection: Selection): Selection | null {
  if (selection instanceof AllSelection) return null;
  if (selection instanceof NodeSelection) {
    const name = selection.node.type.name;
    if (name === 'table_cell') return caretIn(doc, selection.from, 'end');
    if (name === 'table_row') return caretIn(doc, selection.from + 1, 'end');
    return null;
  }
  if (!(selection instanceof TextSelection)) {
    const parent = selection.$head.parent.type.name;
    return parent === 'table' || parent === 'table_row' ? Selection.near(selection.$head) : null;
  }
  const anchor = cellContext(selection.$anchor);
  const head = cellContext(selection.$head);
  if (anchor) {
    if (head && head.cellPos === anchor.cellPos) return null;
    const start = anchor.cellPos + 1;
    const end = anchor.cellPos + anchor.cell.nodeSize - 1;
    return TextSelection.create(doc, selection.anchor, selection.head > selection.anchor ? end : start);
  }
  if (!head) return null;
  const forward = selection.head > selection.anchor;
  const past = Selection.findFrom(
    doc.resolve(forward ? head.tablePos + head.table.nodeSize : head.tablePos),
    forward ? 1 : -1,
    true,
  );
  if (past) return TextSelection.create(doc, selection.anchor, past.head);
  const before = Selection.findFrom(
    doc.resolve(forward ? head.tablePos : head.tablePos + head.table.nodeSize),
    forward ? -1 : 1,
    true,
  );
  return TextSelection.create(doc, selection.anchor, before ? before.head : selection.anchor);
}

/**
 * A paste into a cell, as the one line a cell can hold, or null when it already is one.
 *
 * Two paragraphs pasted into a cell would otherwise be *fitted* by ProseMirror, and the fit for
 * two textblocks inside a row is two cells: the row grows by one, and the padding then grows every
 * other row to match, so a paste would add a column. Here the pasted blocks' inline content is
 * joined by a space instead, marks and all. One textblock, or inline content, is left to the
 * default, which already puts it in the cell.
 */
export function flattenForCell(slice: Slice): Slice | null {
  const { content } = slice;
  let inline = true;
  content.forEach((node) => {
    if (!node.isInline) inline = false;
  });
  if (inline) return null;
  const only = content.childCount === 1 ? content.firstChild : null;
  if (only && only.isTextblock && only.type.name !== 'table_cell') return null;
  const parts: Node[] = [];
  content.descendants((node) => {
    if (!node.isTextblock) return true;
    if (node.content.size === 0) return false;
    if (parts.length > 0) parts.push(notesSchema.text(' '));
    node.forEach((child) => parts.push(child));
    return false;
  });
  return new Slice(Fragment.from(parts), 0, 0);
}

export const tableGuardKey = new PluginKey('chattered:table-guard');

/**
 * The plugin that keeps the invariant: pad a ragged table, then fix a selection the rules do not
 * allow. One appended transaction, and it takes the source's `addToHistory`, so the padding
 * after an agent's batch is no more undoable than the batch, and after a learner's edit it undoes
 * with it (prosemirror-history folds an appended transaction into the one it follows).
 */
export function tableGuard(): Plugin {
  return new Plugin({
    key: tableGuardKey,
    appendTransaction(transactions, _old, state) {
      const changed = transactions.some((tr) => tr.docChanged);
      if (!changed && !transactions.some((tr) => tr.selectionSet)) return null;
      const tr = state.tr;
      if (changed) padTables(tr);
      const fixed = constrainSelection(tr.doc, tr.selection);
      if (fixed) tr.setSelection(fixed);
      if (tr.steps.length === 0 && !fixed) return null;
      if (transactions.some((t) => t.getMeta('addToHistory') === false)) tr.setMeta('addToHistory', false);
      return tr;
    },
    props: {
      handlePaste(view, _event, slice) {
        if (!cellContext(view.state.selection.$from)) return false;
        const flat = flattenForCell(slice);
        if (!flat) return false;
        view.dispatch(view.state.tr.replaceSelection(flat).scrollIntoView().setMeta('uiEvent', 'paste'));
        return true;
      },
      /** A drop of blocks into a cell, flattened the same way. A drop that lands in what it moves is dropped. */
      handleDrop(view, event, slice, moved) {
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at || !cellContext(view.state.doc.resolve(at.pos))) return false;
        const flat = flattenForCell(slice);
        if (!flat) return false;
        const tr = view.state.tr;
        if (moved) tr.deleteSelection();
        const target = tr.mapping.mapResult(at.pos);
        if (target.deleted) return true;
        tr.insert(target.pos, flat.content);
        view.dispatch(tr.setMeta('uiEvent', 'drop'));
        return true;
      },
    },
  });
}

/**
 * The table's keys, as one keymap for `setup.ts` to place ahead of its own. Every entry returns
 * false outside a table cell, so everywhere else the keys mean what they meant before.
 *
 * The delete family is listed whole — the macOS word and line deletes, and the Emacs-style
 * Ctrl-H / Ctrl-D — because each is its own binding in the base keymap and each would reach the
 * browser at a cell's edge otherwise.
 */
export function tableKeymap(): Record<string, Command> {
  const back = stayInCell(-1);
  const forward = stayInCell(1);
  return {
    Tab: goToCell(1),
    'Shift-Tab': goToCell(-1),
    Enter: cellBelow,
    'Shift-Enter': cellBelow,
    ArrowLeft: arrow('horiz', -1),
    ArrowRight: arrow('horiz', 1),
    ArrowUp: arrow('vert', -1),
    ArrowDown: arrow('vert', 1),
    Backspace: back,
    'Mod-Backspace': back,
    'Alt-Backspace': back,
    'Shift-Backspace': back,
    'Ctrl-h': back,
    'Ctrl-Alt-Backspace': back,
    Delete: forward,
    'Mod-Delete': forward,
    'Alt-Delete': forward,
    'Ctrl-d': forward,
    'Alt-d': forward,
  };
}
