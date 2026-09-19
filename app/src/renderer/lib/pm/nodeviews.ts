/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * NODE VIEWS: MATHS, SLIDE FIGURES, AND MAX'S QUESTION (`collab-doc.md` §3, §5.2)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Three nodes in the schema cannot be drawn by `toDOM` alone, because drawing them needs
 * something `toDOM` is not allowed to have: a typesetting library, a pdf.js canvas, and a button.
 *
 *  - **`math_block`** — KaTeX, in the app's own faces. `pdf-fidelity-segmentation.md` §C4 is the
 *    rule and `aitext.ts` restates it: "Matching Beamer's typeface would make agent-written maths
 *    visually indistinguishable from the lecturer's — which is the exact confusion S5 exists to
 *    prevent, and in a maths module it is the confusion with the highest cost."
 *  - **`slide_figure`** — a crop of the *rendered* page. §3: pixels, not a redraw. The pixels come
 *    from `rasterise.ts`'s `SlideSource`, the same canvases the carousel and the modal use.
 *  - **`q_block`** — Max's question, with its red rail, its name, its status tag and the learner's
 *    one-click remove. Its body is real editable content (`contentDOM`), because §5.3 writes the
 *    resolution *inside* the block and the learner may edit that like anything else.
 *
 * **`math_inline` is a mark, not a node**, so it cannot have a node view at all; it is styled as
 * maths (KaTeX's own italic face) and left editable, which is the honest trade — a mark view that
 * replaced its own text with KaTeX output would make the source unreachable to the cursor. The
 * closed inline subset writes display maths for anything worth typesetting, and that path is
 * real. Noted as a limitation rather than faked.
 */

import katex from 'katex';
import type { Node } from 'prosemirror-model';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import type { QResolution, Rect } from '../../../shared/doc/types.js';
import { AGENT_NAME, qStatusLabel } from './chrome.js';
import type { SlideSource } from '../rasterise.js';

export interface NodeViewContext {
  /** The open deck, once its bytes have arrived. Null while it is still loading. */
  slides: () => SlideSource | null;
  /** A figure's click: open the in-doc modal at that page, outlining the rect. */
  onOpenSlide: (page: number, rect: Rect | null) => void;
}

/**
 * KaTeX, with `aitext.ts`'s settings verbatim (`throwOnError: false`, `strict: false`) and its
 * failure behaviour: a broken formula shows as **what was written**, never as an error card. The
 * learner can then see the source and fix it, which is the only useful thing to do with it.
 */
function typeset(target: HTMLElement, tex: string, display: boolean): void {
  try {
    katex.render(tex, target, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    target.textContent = display ? `$$${tex}$$` : `$${tex}$`;
    target.classList.add('nd-math-error');
  }
}

class MathBlockView implements NodeView {
  readonly dom: HTMLElement;
  #tex: string;

  constructor(node: Node) {
    this.dom = document.createElement('div');
    this.dom.className = 'nd-mathblock';
    this.#tex = (node.attrs.tex as string) || '';
    typeset(this.dom, this.#tex, true);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'math_block') return false;
    const tex = (node.attrs.tex as string) || '';
    if (tex !== this.#tex) {
      this.#tex = tex;
      this.dom.className = 'nd-mathblock';
      typeset(this.dom, tex, true);
    }
    return true;
  }

  /** An atom: ProseMirror must not look inside it for a selection or a mutation. */
  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/**
 * The inline crop.
 *
 * Rendered asynchronously — the deck may still be opening when the node first appears — and
 * re-rendered when the figure's own box changes width, so a crop is never an upscaled thumbnail.
 * The canvas is replaced wholesale rather than redrawn in place, which is what keeps the "one
 * `drawImage` out of a real page canvas" chain intact.
 */
/** How long a figure waits for the deck to finish opening, and how often it looks. */
const FIGURE_RETRY_MS = 400;
const FIGURE_RETRIES = 75;

class SlideFigureView implements NodeView {
  readonly dom: HTMLElement;
  #frame: HTMLElement;
  #node: Node;
  #ctx: NodeViewContext;
  #width = 0;
  #observer: ResizeObserver | null = null;
  #token = 0;
  #retries = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;

  constructor(node: Node, ctx: NodeViewContext) {
    this.#node = node;
    this.#ctx = ctx;
    this.dom = document.createElement('figure');
    this.dom.className = 'nd-figure';
    this.#frame = document.createElement('button');
    this.#frame.className = 'nd-figure-frame';
    (this.#frame as HTMLButtonElement).type = 'button';
    this.#frame.addEventListener('mousedown', (event) => event.preventDefault());
    this.#frame.addEventListener('click', (event) => {
      event.preventDefault();
      ctx.onOpenSlide(this.#node.attrs.page as number, (this.#node.attrs.rect as Rect | null) ?? null);
    });
    this.dom.append(this.#frame);

    const caption = document.createElement('figcaption');
    caption.className = 'nd-figure-caption';
    caption.textContent = this.#captionText();
    this.dom.append(caption);

    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.#paint());
      this.#observer.observe(this.dom);
    }
    queueMicrotask(() => this.#paint());
  }

  #captionText(): string {
    const caption = (this.#node.attrs.caption as string) || '';
    const page = String(this.#node.attrs.page as number);
    return caption ? `${caption} — slide ${page}` : `Slide ${page}`;
  }

  #paint(): void {
    const width = Math.round(this.dom.clientWidth || 640);
    if (width <= 0) return;
    // Only re-render when the box grew: shrinking is what `drawImage` scaling is for.
    if (this.#width >= width && this.#frame.firstElementChild) return;
    const source = this.#ctx.slides();
    if (!source) {
      // The deck is still opening. A figure that gave up here would stay an empty grey box for
      // the life of the document, because nothing else re-enters a node view once it is built:
      // the ResizeObserver only fires on a size change, and a decoration rebuild does not
      // repaint an atom. So it waits, briefly and with a bound.
      if (this.#retries < FIGURE_RETRIES) {
        this.#retries++;
        this.#retry = setTimeout(() => this.#paint(), FIGURE_RETRY_MS);
      }
      return;
    }
    this.#width = width;
    const token = ++this.#token;
    const page = this.#node.attrs.page as number;
    const rect = (this.#node.attrs.rect as Rect | null) ?? null;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void source
      .crop(page, rect, width, dpr)
      .then((canvas) => {
        if (!canvas || token !== this.#token) return;
        this.#frame.replaceChildren(canvas);
        this.#frame.classList.add('nd-figure-ready');
      })
      .catch(() => undefined);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'slide_figure') return false;
    const samePage = node.attrs.page === this.#node.attrs.page;
    const sameRect = JSON.stringify(node.attrs.rect) === JSON.stringify(this.#node.attrs.rect);
    this.#node = node;
    const caption = this.dom.querySelector('.nd-figure-caption');
    if (caption) caption.textContent = this.#captionText();
    if (!samePage || !sameRect) {
      this.#width = 0;
      this.#frame.replaceChildren();
      this.#paint();
    }
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.#observer?.disconnect();
    if (this.#retry) clearTimeout(this.#retry);
    this.#token++;
  }
}

/** Max's question in the document (§5.2), with its status tag and the learner's remove. */
class QBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #tag: HTMLElement;
  #node: Node;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.#node = node;
    this.dom = document.createElement('section');
    this.dom.className = 'nd-q';

    const head = document.createElement('div');
    head.className = 'nd-q-head';

    const who = document.createElement('span');
    who.className = 'nd-q-who';
    who.textContent = `${AGENT_NAME[(node.attrs.askedBy as 'ellie' | 'max') ?? 'max']} asked`;

    this.#tag = document.createElement('span');
    this.#tag.className = 'nd-q-tag';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'nd-q-remove';
    remove.textContent = 'Remove';
    remove.title = 'Take this question out of the notes';
    remove.addEventListener('mousedown', (event) => event.preventDefault());
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      const pos = getPos();
      if (pos === undefined) return;
      const target = view.state.doc.nodeAt(pos);
      if (!target) return;
      // The learner's own gesture, so it IS in the history: an accidental Remove is one ⌘Z away.
      view.dispatch(view.state.tr.delete(pos, pos + target.nodeSize).scrollIntoView());
      view.focus();
    });

    head.append(who, this.#tag, remove);
    this.dom.append(head);

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'nd-q-body';
    this.dom.append(this.contentDOM);
    this.#paintTag();
  }

  #paintTag(): void {
    const status = (this.#node.attrs.status as string) ?? 'open';
    const resolution = (this.#node.attrs.resolution as QResolution | null) ?? null;
    this.#tag.textContent = qStatusLabel(status, resolution);
    this.#tag.dataset.status = status === 'resolved' ? (resolution ?? 'resolved') : 'open';
  }

  update(node: Node): boolean {
    if (node.type.name !== 'q_block') return false;
    this.#node = node;
    this.#paintTag();
    return true;
  }

  /** The head is chrome; a mutation there is ours, not the learner's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}

export function nodeViews(ctx: NodeViewContext): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    math_block: (node) => new MathBlockView(node),
    slide_figure: (node) => new SlideFigureView(node, ctx),
    q_block: (node, view, getPos) => new QBlockView(node, view, getPos),
  };
}
