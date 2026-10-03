/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SLIDE IMAGES, IN LINE WITH TEXT (2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Lucas's brief: "mimic image positioning capability of word doc". A slide (or a crop of one) in
 * the notes is a `slide_image`, an inline atom inside a paragraph, which gives Word's "in line with
 * text" behaviour for free from ProseMirror, and this file adds the rest:
 *
 *  - **The caret on either side.** An inline node always has a text position before and after it,
 *    so there is no need for a space to put the caret by an image. ← and → step over it as one
 *    character rather than stopping on it first.
 *  - **Backspace after it deletes it; Delete before it deletes it.** Backspace *before* it at the
 *    start of a line is ProseMirror's own join, which moves the line, image and all, up onto the
 *    one above — as in Word.
 *  - **Drag it anywhere, select across it.** The node is `draggable`, so a press-and-drag moves it
 *    to the drop position (the drop cursor shows where), and a text selection across it cuts,
 *    copies and pastes it with the words.
 *  - **Resize from its corners, in proportion.** Four diagonal handles while it is selected; the
 *    width is stored on the node (the height follows the crop's shape) and is one undoable step.
 *  - **Click it to open the slide** in a window (`slidewindow.ts`) whose yellow box is the image's
 *    crop, which can be moved and resized there; the image follows. A click on one of the slide's
 *    own labels (the hotspots) still asks Ellie about that label instead.
 */
import type { Node } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { blockAttrs } from '../../../shared/doc/schema.js';
import { hotspotQuestion, hotspotsIn } from '../../../shared/doc/cite.js';
import type { Rect } from '../../../shared/doc/types.js';
import type { NodeViewContext } from './nodeviews.js';
import { drawHotspots, toLineRect } from './sourcepop.js';

/** The narrowest an image can be made: below this its label is unreadable and its handles overlap. */
export const MIN_IMAGE_WIDTH = 60;
/**
 * Room left on the line beside an image, so there is always somewhere to click to put the caret
 * next to it, as in Word: an image never takes the whole column (its 6 px side margins plus this).
 */
export const LINE_ROOM = 16;
/** An image with no width of its own fits the column, up to this. */
export const FIT_WIDTH = 640;

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * **The width a corner drag gives**, in the image's own CSS px. `dx` is the pointer's travel across
 * the screen; `zoom` is the notes zoom (the sheet is CSS-zoomed, so a screen pixel is 1/zoom of the
 * image's pixel). An east corner grows with a drag to the right, a west corner with a drag to the
 * left; the height follows the crop's shape, so only the width is computed. Clamped between
 * `MIN_IMAGE_WIDTH` and the column.
 */
export function cornerWidth(start: number, corner: Corner, dx: number, zoom: number, max: number): number {
  const sign = corner === 'ne' || corner === 'se' ? 1 : -1;
  const width = start + (sign * dx) / (zoom > 0 ? zoom : 1);
  return Math.round(Math.min(Math.max(MIN_IMAGE_WIDTH, max), Math.max(MIN_IMAGE_WIDTH, width)));
}

/** The width an image is shown at: its own, or the column's, never wider than the column. */
export function shownWidth(width: number | null, column: number): number {
  const room = column > 0 ? Math.max(MIN_IMAGE_WIDTH, column - LINE_ROOM) : FIT_WIDTH;
  return Math.round(Math.max(MIN_IMAGE_WIDTH, Math.min(width ?? Math.min(FIT_WIDTH, room), room)));
}

/** The crop's height over its width on a page `page.width` × `page.height` (null: the whole page). */
export function cropAspect(rect: Rect | null, page: { width: number; height: number }): number {
  const w = (rect ? rect.x1 - rect.x0 : 1) * page.width;
  const h = (rect ? rect.y1 - rect.y0 : 1) * page.height;
  return w > 0 && h > 0 ? h / w : 9 / 16;
}

const RETRY_MS = 400;
const RETRIES = 75;

export class SlideImageView implements NodeView {
  readonly dom: HTMLElement;
  #frame: HTMLElement;
  #layer: HTMLElement;
  #node: Node;
  #view: EditorView;
  #getPos: () => number | undefined;
  #ctx: NodeViewContext;
  #token = 0;
  #retries = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #rendered = 0;
  #aspect: number | null = null;
  #hotKey = '';
  /** The width while a corner is being dragged, before it is committed to the node. */
  #live: number | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, ctx: NodeViewContext) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.#ctx = ctx;
    this.dom = document.createElement('span');
    this.dom.className = 'nd-img';
    this.dom.contentEditable = 'false';
    this.dom.draggable = true;
    this.#frame = document.createElement('span');
    this.#frame.className = 'nd-img-frame';
    this.#layer = document.createElement('span');
    this.#layer.className = 'nd-hot-layer';
    this.dom.append(this.#frame, this.#layer);
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) this.dom.append(this.#handle(corner));
    this.dom.title = this.#title();
    this.dom.addEventListener('click', (event) => this.#click(event));
    queueMicrotask(() => this.#paint());
  }

  #title(): string {
    const caption = (this.#node.attrs.caption as string) || '';
    const page = `slide ${String(this.#node.attrs.page as number)}`;
    return `${caption ? `${caption}, ${page}` : page[0]!.toUpperCase() + page.slice(1)}: drag to move, drag a corner to resize, click to open`;
  }

  /** The room the image has: the width of the block it sits in. */
  #column(): number {
    const block = this.dom.parentElement?.closest('p, li, td, th, div');
    return Math.round((block as HTMLElement | null)?.clientWidth ?? this.#view.dom.clientWidth ?? FIT_WIDTH);
  }

  #width(): number {
    return this.#live ?? shownWidth((this.#node.attrs.width as number | null) ?? null, this.#column());
  }

  /** Size the box at once (no jump when the pixels arrive), then draw the pixels if they are stale. */
  #paint(): void {
    const width = this.#width();
    this.dom.style.width = `${String(width)}px`;
    if (this.#aspect !== null) this.#frame.style.height = `${String(Math.round(width * this.#aspect))}px`;
    const source = this.#ctx.slides();
    if (!source) {
      // The deck is still opening, and nothing else re-enters a node view once it is built.
      if (this.#retries < RETRIES) {
        this.#retries++;
        this.#retry = setTimeout(() => this.#paint(), RETRY_MS);
      }
      return;
    }
    const page = this.#node.attrs.page as number;
    const rect = (this.#node.attrs.rect as Rect | null) ?? null;
    if (this.#aspect === null) {
      void source.measure(page).then(
        (size) => {
          this.#aspect = cropAspect(rect, size);
          this.#paint();
        },
        () => undefined,
      );
      return;
    }
    // Only re-render when it grew: shrinking is what `drawImage` scaling is for.
    if (this.#rendered >= width && this.#frame.firstElementChild) return;
    const token = ++this.#token;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void source
      .crop(page, rect, width, dpr)
      .then((canvas) => {
        if (!canvas || token !== this.#token) return;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        this.#rendered = width;
        this.#frame.replaceChildren(canvas);
        this.dom.classList.add('nd-img-ready');
        this.#hotspots();
      })
      .catch(() => undefined);
  }

  /** The slide's own labels inside this crop, as buttons over the pixels (`sourcepop.drawHotspots`). */
  #hotspots(): void {
    const read = this.#ctx.pageLines;
    if (!read) return;
    const page = this.#node.attrs.page as number;
    const rect = (this.#node.attrs.rect as Rect | null) ?? null;
    const key = `${String(page)}:${JSON.stringify(rect)}`;
    if (key === this.#hotKey) return;
    this.#hotKey = key;
    void read(page)
      .then((view) => {
        if (key !== this.#hotKey) return;
        if (!view) {
          this.#hotKey = '';
          return;
        }
        const aspect = view.height > 0 ? view.width / view.height : undefined;
        const blockId = this.#blockId();
        const ask = this.#ctx.onAskAboutFigure;
        drawHotspots(this.#layer, {
          page,
          hotspots: hotspotsIn(view.items, rect ? toLineRect(rect) : null, aspect),
          onAsk: ask && blockId ? (label) => ask({ blockId, quote: label, question: hotspotQuestion(label, page) }) : null,
        });
      })
      .catch(() => undefined);
  }

  /** The id of the block the image sits in: where an insert from its window goes, and a thread anchors. */
  #blockId(): string | null {
    const pos = this.#getPos();
    if (pos === undefined) return null;
    const $pos = this.#view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
      const id = blockAttrs($pos.node(depth)).blockId;
      if (id) return id;
    }
    return null;
  }

  #click(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.nd-img-handle, .nd-hot, .nd-hotpop')) return;
    event.preventDefault();
    const page = this.#node.attrs.page as number;
    const rect = (this.#node.attrs.rect as Rect | null) ?? null;
    const open = this.#ctx.onOpenImage;
    if (open) {
      open({ page, rect, anchor: this.dom, blockId: this.#blockId(), onRecrop: (next) => this.#setAttrs({ rect: next }) });
    } else {
      this.#ctx.onOpenSlide(page, rect, this.dom, this.#blockId());
    }
  }

  /** One undoable step that changes the image's own attrs (its width, its crop). */
  #setAttrs(attrs: Partial<{ width: number | null; rect: Rect | null }>): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const node = this.#view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'slide_image') return;
    this.#view.dispatch(this.#view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
  }

  #handle(corner: Corner): HTMLElement {
    const handle = document.createElement('span');
    handle.className = `nd-img-handle nd-img-handle-${corner}`;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const start = this.#width();
      const x = event.clientX;
      const zoom = this.dom.offsetWidth > 0 ? this.dom.getBoundingClientRect().width / this.dom.offsetWidth : 1;
      const max = Math.max(MIN_IMAGE_WIDTH, this.#column() - LINE_ROOM);
      this.dom.classList.add('nd-img-resizing');
      const move = (e: PointerEvent): void => {
        this.#live = cornerWidth(start, corner, e.clientX - x, zoom, max);
        this.#paint();
      };
      const up = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.dom.classList.remove('nd-img-resizing');
        const width = this.#live;
        this.#live = null;
        if (width !== null && width !== start) this.#setAttrs({ width });
        else this.#paint();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    return handle;
  }

  update(node: Node): boolean {
    if (node.type.name !== 'slide_image') return false;
    const samePage = node.attrs.page === this.#node.attrs.page;
    const sameRect = JSON.stringify(node.attrs.rect) === JSON.stringify(this.#node.attrs.rect);
    this.#node = node;
    this.dom.title = this.#title();
    if (!samePage || !sameRect) {
      this.#aspect = null;
      this.#rendered = 0;
      this.#hotKey = '';
      this.#frame.replaceChildren();
      this.#layer.replaceChildren();
    }
    this.#paint();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('nd-img-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('nd-img-selected');
  }

  /** The handles and the hotspots are this view's; a press anywhere else is ProseMirror's (select, drag). */
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest?.('.nd-img-handle, .nd-hot, .nd-hotpop');
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    if (this.#retry) clearTimeout(this.#retry);
    this.#token++;
  }
}

/**
 * **The keys by an image**, and the press beside one. Backspace with the caret after one deletes
 * it, Delete with the caret before one deletes it, and ← → step over it in one press. Backspace
 * before an image at the start of a line is not here: the base keymap's join moves the line up,
 * image and all.
 */
/** How close beside an image a press puts the caret next to it, rather than where the browser guesses. */
const BESIDE_PX = 14;

/**
 * **A press just beside an image puts the caret beside it** (2026-10-03). Chrome places the caret
 * unreliably for a click next to an inline element that is not editable — a click just left of an
 * image at the start of a line went after it — so within `BESIDE_PX` of an image, on its line, the
 * caret is placed explicitly: before it on its left, after it on its right.
 */
function caretBesideImage(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target || target.closest('.nd-img')) return false;
  for (const el of view.dom.querySelectorAll<HTMLElement>('.nd-img')) {
    const r = el.getBoundingClientRect();
    if (event.clientY < r.top || event.clientY > r.bottom) continue;
    const left = event.clientX < r.left && event.clientX >= r.left - BESIDE_PX;
    const right = event.clientX > r.right && event.clientX <= r.right + BESIDE_PX;
    if (!left && !right) continue;
    let pos = view.posAtDOM(el, 0);
    if (view.state.doc.nodeAt(pos)?.type.name !== 'slide_image' && view.state.doc.nodeAt(pos - 1)?.type.name === 'slide_image') pos -= 1;
    if (view.state.doc.nodeAt(pos)?.type.name !== 'slide_image') return false;
    event.preventDefault();
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, left ? pos : pos + 1)));
    return true;
  }
  return false;
}

export function imageKeysPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => caretBesideImage(view, event),
        /**
         * **Typing next to an image goes where the caret is.** With the caret between an image and
         * whatever is beside it, Chrome puts typed characters in the nearest editable text instead,
         * which can be on the image's other side ("LEFT" typed before an image landed after it).
         * Beside an image the text is inserted here instead of by the browser.
         */
        beforeinput: (view, event) => {
          const input = event as InputEvent;
          if (input.inputType !== 'insertText' || !input.data || input.isComposing) return false;
          const { selection } = view.state;
          if (!selection.empty) return false;
          const $at = selection.$from;
          const beside = $at.nodeBefore?.type.name === 'slide_image' || $at.nodeAfter?.type.name === 'slide_image';
          if (!beside) return false;
          event.preventDefault();
          const marks = view.state.storedMarks ?? $at.marks();
          view.dispatch(view.state.tr.insert($at.pos, view.state.schema.text(input.data, marks)).scrollIntoView());
          return true;
        },
      },
      handleKeyDown(view, event) {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
        const { selection } = view.state;
        if (!selection.empty) return false;
        const $at = selection.$from;
        const before = $at.nodeBefore;
        const after = $at.nodeAfter;
        const isImage = (node: Node | null | undefined): boolean => node?.type.name === 'slide_image';
        const pos = $at.pos;
        if (event.key === 'Backspace' && isImage(before)) {
          view.dispatch(view.state.tr.delete(pos - 1, pos).scrollIntoView());
          return true;
        }
        if (event.key === 'Delete' && isImage(after)) {
          view.dispatch(view.state.tr.delete(pos, pos + 1).scrollIntoView());
          return true;
        }
        if (event.key === 'ArrowLeft' && isImage(before)) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos - 1)).scrollIntoView());
          return true;
        }
        if (event.key === 'ArrowRight' && isImage(after)) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).scrollIntoView());
          return true;
        }
        return false;
      },
    },
  });
}
