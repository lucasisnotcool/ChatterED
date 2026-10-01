/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE KIT UNDER FLASHCARDS, QUIZ AND INFOGRAPHIC (notebooks §5.3, 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The three blocks are drawn by one pair of node views and one plugin, configured per block
 * (`flashcards.ts`, `quiz.ts`, `infographic.ts` say what is different about each):
 *
 *  - **`BlockView`**: the top-level block. Its `contentDOM` holds the items; its head is chrome (a
 *    title and a small toolbar that shows on hover or with the caret inside, as the diagram's
 *    does). The commands the toolbar runs are `../blockfields.ts`'s.
 *  - **`ItemView`**: one card, question or panel. Its `contentDOM` holds the fields, which are
 *    plain text blocks rendered by their schema `toDOM` and styled by their `data-*` attributes
 *    (`components/notes/blocks.css`). The item's pages are a chip on its corner with the same
 *    preview a block's chip has.
 *  - **The plugin**: the keys that must not do what they do in a paragraph, and the decoration
 *    that marks the block and the item the caret is in. **The caret being in an item is what
 *    reveals everything in it** (both sides of a card, a question's answer): nobody can edit what
 *    they cannot see.
 *
 * Nothing the learner does to *view* one of these (flip a card, pick an option, show an answer)
 * is ever a transaction. That state lives on the item's DOM, so it is chrome, never saved, and
 * can never reach the progress ledger (§6: only the learner's own words fill it).
 */

import type { Node, Slice } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from 'prosemirror-view';
import {
  clearAcrossFields,
  deleteItem,
  fieldBlockAt,
  guardFieldEdge,
  moveField,
  setBlockTitle,
  addItem,
  type FieldBlockName,
  type FieldHit,
} from '../blockfields.js';
import { hasBlocks } from './diagram.js';
import { provenanceLabel } from './chrome.js';
import type { NodeViewContext } from './nodeviews.js';
import { attachCitePreview } from './sourcepop.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A button: the press never takes the caret out of the field it is about. */
export function tool(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
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

/** An item's pages, filtered to real ones. */
export function pagesOf(node: Node): number[] {
  const pages = node.attrs.pages as unknown;
  return Array.isArray(pages) ? (pages as number[]).filter((p) => Number.isInteger(p) && p > 0) : [];
}

// ── the plugin ──────────────────────────────────────────────────────────────────────────────

export const blockKitKey = new PluginKey('chattered:blockkit');
export const BLOCK_ACTIVE_CLASS = 'nd-blk-active';
export const ITEM_ACTIVE_CLASS = 'nd-item-active';

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  const state = view.state;
  const hit = fieldBlockAt(state);
  if (!hit || hit.index === null) return false;
  const key = event.key;
  const run = (command: Command): boolean => command(state, view.dispatch, view);
  if (key === 'Tab') return run(moveField(event.shiftKey ? -1 : 1));
  if (key === 'Enter') {
    // Plain Enter and Shift-Enter go on to the next field; any other Enter is only taken.
    if (!event.metaKey && !event.ctrlKey && !event.altKey) return run(moveField(event.shiftKey ? -1 : 1));
    return true;
  }
  // Ctrl-H and Ctrl-D are macOS's own Backspace and Delete.
  const back = key === 'Backspace' || (event.ctrlKey && !event.metaKey && key === 'h');
  const forward = key === 'Delete' || (event.ctrlKey && !event.metaKey && key === 'd');
  if (back || forward) {
    const { from, to, empty } = state.selection;
    if (!empty) {
      const tr = clearAcrossFields(state, from, to);
      if (tr) {
        view.dispatch(tr.scrollIntoView());
        return true;
      }
    }
    return run(guardFieldEdge(back ? 'start' : 'end'));
  }
  return false;
}

/** Is the range inside one of the three blocks? Then a block-level paste or drop would break it. */
function insideFieldBlock(doc: Node, pos: number): boolean {
  const $at = doc.resolve(pos);
  for (let d = $at.depth; d > 0; d--) {
    const name = $at.node(d).type.name;
    if (name === 'flashcards' || name === 'quiz' || name === 'infographic') return true;
  }
  return false;
}

export function blockKitPlugin(): Plugin {
  return new Plugin({
    key: blockKitKey,
    props: {
      handleKeyDown: handleKey,
      /** Typing over a selection that spans two fields: each keeps its box, the text goes in the first. */
      handleTextInput(view, from, to, text) {
        const tr = clearAcrossFields(view.state, from, to);
        if (!tr) return false;
        view.dispatch(tr.insertText(text, tr.mapping.map(from, -1)).scrollIntoView());
        return true;
      },
      /** A paste of paragraphs into a field: its text, on one line, in place of the selection. */
      handlePaste(view, _event, slice: Slice) {
        const hit = fieldBlockAt(view.state);
        if (!hit || hit.index === null || !hasBlocks(slice)) return false;
        const text = slice.content.textBetween(0, slice.content.size, ' ', ' ').replace(/\s+/g, ' ').trim();
        const { from, to } = view.state.selection;
        const tr = clearAcrossFields(view.state, from, to) ?? view.state.tr.deleteSelection();
        if (text.length > 0) tr.insertText(text, tr.mapping.map(from, -1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      /** Blocks dropped into a field would break the block apart; refused. Text drops as usual. */
      handleDrop(view, event, slice: Slice) {
        if (!hasBlocks(slice)) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        return at ? insideFieldBlock(view.state.doc, at.pos) : false;
      },
      /** The block and the item the caret is in: the toolbar shows, and the item shows all of itself. */
      decorations(state) {
        const hit = fieldBlockAt(state);
        if (!hit) return null;
        const decorations = [
          Decoration.node(hit.blockPos, hit.blockPos + hit.block.nodeSize, { class: BLOCK_ACTIVE_CLASS }),
        ];
        if (hit.itemPos !== null && hit.index !== null) {
          const item = hit.block.child(hit.index);
          decorations.push(Decoration.node(hit.itemPos, hit.itemPos + item.nodeSize, { class: ITEM_ACTIVE_CLASS }));
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

// ── the pages chip ──────────────────────────────────────────────────────────────────────────

/** An item's pages on its corner: opens the slide, with the block chip's preview when wired. */
export class PagesChip {
  #host: HTMLElement;
  #ctx: NodeViewContext;
  #text: () => string;
  #chip: HTMLButtonElement | null = null;
  #key = '';

  constructor(host: HTMLElement, ctx: NodeViewContext, text: () => string) {
    this.#host = host;
    this.#ctx = ctx;
    this.#text = text;
  }

  contains(target: unknown): boolean {
    return this.#chip !== null && target instanceof globalThis.Node && this.#chip.contains(target);
  }

  update(pages: readonly number[]): void {
    const key = pages.join(',');
    if (key === this.#key) return;
    this.#key = key;
    this.#chip?.remove();
    this.#chip = null;
    if (pages.length === 0) return;
    const label = provenanceLabel(pages, null);
    const first = pages[0]!;
    const chip = el('button', 'nd-blk-pages', label);
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
      else this.#ctx.onOpenSlide(first, null);
    });
    const pageLines = this.#ctx.pageLines;
    if (pageLines) {
      openRegion = attachCitePreview(chip, {
        pages: [...pages],
        reason: null,
        // Read on hover: the learner may have rewritten the item since.
        text: this.#text,
        figure: null,
        reader: { slides: this.#ctx.slides, pageLines },
        onOpenSlide: this.#ctx.onOpenSlide,
      });
      chip.title = '';
      chip.setAttribute('aria-label', `Open the source slide (${label})`);
    }
    this.#chip = chip;
    this.#host.append(chip);
  }
}

// ── the item view ───────────────────────────────────────────────────────────────────────────

export interface ItemViewConfig {
  /** The item's node type, e.g. `flashcard`. */
  type: string;
  /** The class on its element, e.g. `nd-fc-card`. */
  className: string;
  /** Extra chrome beside the fields (a flip button, a status line), built once. */
  build?: (item: ItemView) => HTMLElement[];
  /** After every update: repaint that chrome from the node. */
  refresh?: (item: ItemView) => void;
}

/** One card, question or panel. */
export class ItemView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  node: Node;
  readonly #config: ItemViewConfig;
  readonly #chip: PagesChip;
  readonly #chrome: HTMLElement[];

  constructor(node: Node, config: ItemViewConfig, ctx: NodeViewContext) {
    this.node = node;
    this.#config = config;
    this.dom = el('div', config.className);
    this.contentDOM = el('div', `${config.className}-fields`);
    this.dom.append(this.contentDOM);
    this.#chrome = config.build?.(this) ?? [];
    for (const piece of this.#chrome) {
      piece.contentEditable = 'false';
      this.dom.append(piece);
    }
    this.#chip = new PagesChip(this.dom, ctx, () => this.node.textContent);
    this.#paint();
  }

  #paint(): void {
    this.#chip.update(pagesOf(this.node));
    this.#config.refresh?.(this);
  }

  update(node: Node): boolean {
    if (node.type.name !== this.#config.type) return false;
    this.node = node;
    this.#paint();
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (this.#chip.contains(target)) return true;
    return target instanceof globalThis.Node && this.#chrome.some((piece) => piece.contains(target));
  }

  /** Only what happens inside the fields is the document's; the chip, the chrome and our own data-* are ours. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }
}

// ── the block view ──────────────────────────────────────────────────────────────────────────

export type Run = (make: (state: EditorState, pos: number) => Transaction | null) => void;

export interface ToolSpec {
  el: HTMLElement;
  /** Repaint from the node and the caret (a pressed layout, a disabled delete). */
  sync?: (node: Node, hit: FieldHit | null, state: EditorState) => void;
}

export interface BlockViewConfig {
  name: FieldBlockName;
  /** The class on the element, e.g. `nd-fc`; the fields' grid is `${className}-grid`. */
  className: string;
  /** What the block is called to a screen reader and to the title's label. */
  label: string;
  /** The toolbar's buttons, beyond the add and delete every block has. */
  tools: (run: Run) => ToolSpec[];
  /** After every update: data attributes from the node (an infographic's layout). */
  paint?: (node: Node, dom: HTMLElement) => void;
  /** What an item is called on the add and delete buttons: card, question, panel. */
  itemName: string;
}

export class BlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #node: Node;
  #view: EditorView;
  #getPos: () => number | undefined;
  #config: BlockViewConfig;
  #title: HTMLInputElement;
  #tools: ToolSpec[];
  #delete: HTMLButtonElement;
  #destroyed = false;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, config: BlockViewConfig) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.#config = config;
    this.dom = el('section', config.className);
    this.dom.setAttribute('role', 'group');

    const head = el('div', `${config.className}-head nd-blk-head`);
    head.contentEditable = 'false';
    this.#title = el('input', 'nd-blk-title');
    this.#title.type = 'text';
    this.#title.placeholder = 'Add a title';
    this.#title.setAttribute('aria-label', `${config.label} title`);
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

    const tools = el('div', 'nd-blk-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', config.label);
    const run: Run = (make) => this.#run(make);
    const add = tool('nd-blk-tool', `+ ${config.itemName}`, `Add a ${config.itemName.toLowerCase()} after the one the cursor is in`, () =>
      this.#run((state, pos) => addItem(state, pos)),
    );
    this.#delete = tool('nd-blk-tool', `Delete ${config.itemName.toLowerCase()}`, `Delete the ${config.itemName.toLowerCase()} the cursor is in`, () =>
      this.#run((state, pos) => {
        const hit = fieldBlockAt(state);
        return hit && hit.blockPos === pos && hit.index !== null ? deleteItem(state, pos, hit.index) : null;
      }),
    );
    this.#tools = config.tools(run);
    tools.append(...this.#tools.map((t) => t.el), add, this.#delete);
    head.append(this.#title, tools);

    this.contentDOM = el('div', `${config.className}-grid nd-blk-items`);
    this.dom.append(head, this.contentDOM);
    this.#paint();
  }

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
    const tr = setBlockTitle(this.#view.state, pos, this.#title.value);
    if (tr) this.#view.dispatch(tr);
  }

  #paint(): void {
    const node = this.#node;
    const title = (node.attrs.title as string | null) ?? '';
    if (document.activeElement !== this.#title && this.#title.value !== title) this.#title.value = title;
    const described = title ? `${this.#config.label}: ${title}` : this.#config.label;
    if (this.dom.getAttribute('aria-label') !== described) this.dom.setAttribute('aria-label', described);
    this.#config.paint?.(node, this.dom);

    const hit = fieldBlockAt(this.#view.state);
    const here = hit !== null && hit.blockPos === this.#getPos() ? hit : null;
    const removable = here !== null && here.index !== null && node.childCount > 1;
    if (this.#delete.disabled === removable) this.#delete.disabled = !removable;
    for (const spec of this.#tools) spec.sync?.(node, here, this.#view.state);
  }

  update(node: Node): boolean {
    if (node.type.name !== this.#config.name) return false;
    this.#node = node;
    this.#paint();
    return true;
  }

  /** The head is chrome: its input and buttons keep their events from ProseMirror. */
  stopEvent(event: Event): boolean {
    const head = this.dom.firstElementChild;
    return head !== null && event.target instanceof globalThis.Node && head.contains(event.target);
  }

  /** Only what happens inside the items is the document's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.#destroyed = true;
  }
}
