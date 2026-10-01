/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE TABLE ON SCREEN: ITS BOX, ITS CAPTION, ITS TOOLBAR AND ITS ROW CHIPS (2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `toDOM` already draws a real `<table>`, and the cells need nothing more: they are ordinary
 * editable text. The node view exists for three things `toDOM` cannot give it:
 *
 *  - **A box that scrolls sideways.** A wide table scrolls inside its own frame rather than
 *    pushing the notes column (and the gutter chips) off the page. The frame is not positioned,
 *    on purpose: the provenance chip and Remove · Keep that `chrome.ts` hangs at the block's start
 *    are absolutely positioned against the node view's outer element, and a positioned frame in
 *    between would clip them to its overflow.
 *  - **The caption**, above the table, and set by clicking it (an attr, not content — `schema.ts`).
 *  - **The toolbar**: add row, add column, delete row, delete column, shown on hover and while the
 *    cursor is in the table. The edits themselves are `table.ts`'s.
 *
 * The row chips are not the node view's: they are widgets at the end of each row's last cell,
 * from `tableChrome` below, because a row's DOM is ProseMirror's and only a decoration can put
 * something in it. The node view listens for their clicks, since it is what holds `onOpenSlide`.
 */

import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from 'prosemirror-view';
import { blockAttrs, blockPages } from '../../../shared/doc/schema.js';
import type { Rect } from '../../../shared/doc/types.js';
import { citationFor } from './chrome.js';
import {
  addColumn,
  addRow,
  canRemoveColumn,
  canRemoveRow,
  cellContext,
  removeColumn,
  removeRow,
  setCaption,
  tableWidth,
  type CellContext,
} from './table.js';

export interface TableViewContext {
  /** A row chip's click: open the in-doc slide modal at the row's first page. */
  onOpenSlide: (page: number, rect: Rect | null) => void;
}

/** On the node view's root while the cursor is in the table: the toolbar shows. */
const ACTIVE_CLASS = 'nd-table-active';

type ToolKind = 'row' | 'column' | 'delete-row' | 'delete-column';

const TOOLS: { kind: ToolKind; label: string; title: string }[] = [
  { kind: 'row', label: '+ Row', title: 'Add a row below this one' },
  { kind: 'column', label: '+ Column', title: 'Add a column to the right of this one' },
  { kind: 'delete-row', label: '− Row', title: 'Delete this row' },
  { kind: 'delete-column', label: '− Column', title: 'Delete this column' },
];

export class TableView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #head: HTMLElement;
  #caption: HTMLElement;
  #tools = new Map<ToolKind, HTMLButtonElement>();
  #node: Node;
  #view: EditorView;
  #getPos: () => number | undefined;
  #editing: HTMLInputElement | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, ctx: TableViewContext) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'nd-table';

    // The head is chrome: not editable, and its events are its own (`stopEvent`).
    this.#head = document.createElement('div');
    this.#head.className = 'nd-table-head';
    this.#head.contentEditable = 'false';

    this.#caption = document.createElement('div');
    this.#caption.className = 'nd-table-caption';
    this.#caption.addEventListener('mousedown', (event) => {
      if (this.#editing) return;
      event.preventDefault();
    });
    this.#caption.addEventListener('click', (event) => {
      event.preventDefault();
      this.#editCaption();
    });

    const tools = document.createElement('div');
    tools.className = 'nd-table-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Table rows and columns');
    for (const tool of TOOLS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tool.label;
      button.title = tool.title;
      // Keeps the caret in its cell: the edit is about the cell the cursor is in.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this.#run(tool.kind);
      });
      this.#tools.set(tool.kind, button);
      tools.append(button);
    }
    this.#head.append(this.#caption, tools);
    // The cursor may have moved between cells since the toolbar was last painted.
    this.#head.addEventListener('pointerenter', () => this.#paintTools());

    const frame = document.createElement('div');
    frame.className = 'nd-table-scroll';
    const grid = document.createElement('table');
    grid.className = 'nd-table-grid';
    this.contentDOM = document.createElement('tbody');
    grid.append(this.contentDOM);
    frame.append(grid);
    this.dom.append(this.#head, frame);

    // The row chips are decoration widgets inside the rows (`tableChrome`); their clicks land here.
    this.dom.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const chip = target?.closest<HTMLElement>('.nd-rowchip');
      if (!chip || !this.dom.contains(chip)) return;
      event.preventDefault();
      const page = Number.parseInt(chip.dataset.page ?? '', 10);
      if (Number.isInteger(page) && page > 0) ctx.onOpenSlide(page, null);
    });

    this.#paint();
  }

  /** The `data-*` the schema's `toDOM` would have put on the `<table>`: the outline and the jump read them. */
  #paintData(): void {
    const { blockId, reason } = blockAttrs(this.#node);
    const pages = blockPages(this.#node);
    const set = (name: string, value: string | null): void => {
      if (value === null || value === '') this.dom.removeAttribute(name);
      else if (this.dom.getAttribute(name) !== value) this.dom.setAttribute(name, value);
    };
    set('data-block-id', blockId);
    set('data-pages', pages.length > 0 ? pages.join(',') : null);
    set('data-reason', reason);
  }

  #paintCaption(): void {
    if (this.#editing) return;
    const caption = (this.#node.attrs.caption as string | null) || '';
    this.#caption.textContent = caption || 'Add a caption';
    this.#caption.classList.toggle('nd-table-caption-empty', caption.length === 0);
    this.#caption.title = caption ? 'Click to change the caption' : 'Give this table a caption';
  }

  /** The cell the cursor is in, when it is in *this* table. */
  #here(state: EditorState, pos: number): CellContext | null {
    const at = cellContext(state.selection.$head);
    return at && at.tablePos === pos ? at : null;
  }

  /**
   * The delete buttons say why they cannot act: the heading row and the last data row stay, and
   * a table keeps two columns. The add buttons always work — with the cursor elsewhere they add
   * at the bottom and at the right.
   */
  #paintTools(): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const at = this.#here(this.#view.state, pos);
    const table = this.#node;
    const deleteRow = this.#tools.get('delete-row')!;
    const deleteColumn = this.#tools.get('delete-column')!;
    let rowWhy = 'Delete this row';
    if (!at) rowWhy = 'Put the cursor in a row to delete it';
    else if (!canRemoveRow(table, at.row)) rowWhy = at.row === 0 ? 'The heading row stays' : 'A table keeps at least one row';
    let columnWhy = 'Delete this column';
    if (!at) columnWhy = 'Put the cursor in a column to delete it';
    else if (!canRemoveColumn(table)) columnWhy = 'A table keeps at least two columns';
    deleteRow.disabled = rowWhy !== 'Delete this row';
    deleteRow.title = rowWhy;
    deleteColumn.disabled = columnWhy !== 'Delete this column';
    deleteColumn.title = columnWhy;
  }

  #paint(): void {
    this.#paintData();
    this.#paintCaption();
    this.#paintTools();
  }

  /** A toolbar press: the learner's own edit, so it is in the history and ⌘Z takes it back. */
  #run(kind: ToolKind): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const state = this.#view.state;
    const table = state.doc.nodeAt(pos);
    if (!table || table.type.name !== 'table') return;
    const at = this.#here(state, pos);
    let tr = null;
    if (kind === 'row') tr = addRow(state, pos, at ? at.row : table.childCount - 1, at?.col ?? 0);
    else if (kind === 'column') tr = addColumn(state, pos, at ? at.col : tableWidth(table) - 1, at?.row ?? 1);
    else if (kind === 'delete-row' && at) tr = removeRow(state, pos, at.row, at.col);
    else if (kind === 'delete-column' && at) tr = removeColumn(state, pos, at.col, at.row);
    if (tr) this.#view.dispatch(tr);
    this.#view.focus();
    this.#paintTools();
  }

  /** The caption, edited in place: Enter or leaving the field sets it, Escape leaves it alone. */
  #editCaption(): void {
    if (this.#editing) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nd-table-caption-input';
    input.value = (this.#node.attrs.caption as string | null) || '';
    input.placeholder = 'Caption';
    input.setAttribute('aria-label', 'Table caption');
    this.#editing = input;
    this.#caption.replaceChildren(input);
    this.#caption.classList.remove('nd-table-caption-empty');
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      this.#editing = null;
      const pos = this.#getPos();
      if (commit && pos !== undefined) {
        const tr = setCaption(this.#view.state, pos, input.value);
        if (tr) this.#view.dispatch(tr);
      }
      this.#paintCaption();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
        this.#view.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        this.#view.focus();
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
  }

  update(node: Node): boolean {
    if (node.type !== this.#node.type) return false;
    this.#node = node;
    this.#paint();
    return true;
  }

  /** The head's events are the head's: a press on a tool or in the caption is not a click in the doc. */
  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.#head.contains(event.target);
  }

  /** The head is chrome; a mutation there (the caption field, a button's state) is ours. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}

// ── the row chips, and "the cursor is in this table" ────────────────────────────────────────

export const tableChromeKey = new PluginKey<DecorationSet>('chattered:table-chrome');

/** A row's chip: the same label and the same click as the block chip (`chrome.ts`), smaller. */
function rowChip(label: string, page: number): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'nd-rowchip-holder';
  holder.contentEditable = 'false';
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'nd-rowchip';
  chip.textContent = label;
  chip.title = `Open the source slide (${label})`;
  chip.tabIndex = -1;
  chip.dataset.page = String(page);
  chip.addEventListener('mousedown', (event) => event.preventDefault());
  holder.append(chip);
  return holder;
}

function build(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const active = cellContext(state.selection.$head);
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock;
    if (active && active.tablePos === pos) {
      // The cell is in an attr so that moving between cells changes the decoration, and the node
      // view's `update` repaints the toolbar for the cell the cursor is now in.
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: ACTIVE_CLASS,
          'data-cell': `${String(active.row)}:${String(active.col)}`,
        }),
      );
    }
    node.forEach((row, offset) => {
      const pages = ((row.attrs.pages as number[] | undefined) ?? []).filter((p) => Number.isInteger(p) && p > 0);
      if (pages.length === 0 || row.childCount === 0) return;
      // Through the notebook's sources (C1): `Lecture p. 17` when the notebook has several.
      const label = citationFor(state, pages);
      // Inside the row's last cell, after its text: the end of the row.
      const at = pos + 1 + offset + row.nodeSize - 2;
      decorations.push(
        Decoration.widget(at, () => rowChip(label, Math.min(...pages)), {
          key: `rowprov:${label}`,
          side: 1,
          ignoreSelection: true,
          stopEvent: () => true,
        }),
      );
    });
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * The row chips and the active-table class. Rebuilt on a change to the document or the selection:
 * the walk skips every textblock's inside, so it is a pass over the block list and nothing more.
 */
export function tableChrome(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tableChromeKey,
    state: {
      init: (_config, state) => build(state),
      apply: (tr, value, _old, state) => (tr.docChanged || tr.selectionSet ? build(state) : value),
    },
    props: {
      decorations: (state) => tableChromeKey.getState(state),
    },
  });
}
