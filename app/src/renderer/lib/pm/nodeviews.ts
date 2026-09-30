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
 *    resolution *inside* the block and the learner may edit that like anything else. Since
 *    2026-10-01 it is also where the learner answers (a footer with Answer here and Submit), and
 *    a question may be the learner's own (`askedBy: 'user'`, "You asked").
 *
 * **`math_inline` is a mark, not a node**, so it cannot have a node view at all; it is styled as
 * maths (KaTeX's own italic face) and left editable, which is the honest trade — a mark view that
 * replaced its own text with KaTeX output would make the source unreachable to the cursor. The
 * closed inline subset writes display maths for anything worth typesetting, and that path is
 * real. Noted as a limitation rather than faked.
 */

import katex from 'katex';
import type { Node } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import type { AnswerQuestionRefusal, NotesAnswerQuestionResult } from '../../../shared/ipc.js';
import { blockAttrs } from '../../../shared/doc/schema.js';
import type { QResolution, Rect } from '../../../shared/doc/types.js';
import { AGENT_NAME, qStatusLabel } from './chrome.js';
import { answerTarget, questionParts, startAnswer, type QuestionAnswer } from './qblock.js';
import type { SlideSource } from '../rasterise.js';
import { hotspotQuestion, hotspotsIn, type PageLinesView } from '../../../shared/doc/cite.js';
import { drawHotspots, toLineRect } from './sourcepop.js';
import { TableView } from './tableview.js';
import { diagramNodeViews } from './diagram.js';

export interface NodeViewContext {
  /** The open deck, once its bytes have arrived. Null while it is still loading. */
  slides: () => SlideSource | null;
  /** A figure's click: open the in-doc modal at that page, outlining the rect. */
  onOpenSlide: (page: number, rect: Rect | null) => void;
  /** Submit on a Q block: the learner's answer, in place, goes to main to be marked. */
  onAnswerQuestion: (input: QuestionAnswer) => Promise<NotesAnswerQuestionResult>;
  /** A slide's own text with its boxes: what a figure's hotspots are built from. Optional. */
  pageLines?: (page: number) => Promise<PageLinesView | null>;
  /** "Ask Ellie about this" on a figure's label: a span thread on the figure's block. Optional. */
  onAskAboutFigure?: (input: { blockId: string; quote: string; question: string }) => void;
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
  /** The hotspots, over the frame. It takes no pointer events itself; its buttons do. */
  #layer: HTMLElement;
  /** Which page and crop the layer was last built for, so a re-render does not refetch. */
  #hotKey = '';
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
    // The frame and the hotspot layer share one box. The layer is a sibling and not a child: a
    // repaint replaces the frame's children, and a button may not hold buttons.
    const stage = document.createElement('div');
    stage.className = 'nd-figure-stage';
    this.#layer = document.createElement('div');
    this.#layer.className = 'nd-hot-layer';
    stage.append(this.#frame, this.#layer);
    this.dom.append(stage);

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
        this.#hotspots();
      })
      .catch(() => undefined);
  }

  /**
   * The slide's own text labels inside this crop, as buttons over the pixels.
   *
   * From the PDF's text geometry (`notes:pageLines`), so each sits exactly on its label, and a
   * crop with no text in it has none. A click anywhere else still reaches the frame.
   */
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
          // Not known yet (the call failed): the next repaint asks again.
          this.#hotKey = '';
          return;
        }
        const aspect = view.height > 0 ? view.width / view.height : undefined;
        const { blockId } = blockAttrs(this.#node);
        const ask = this.#ctx.onAskAboutFigure;
        drawHotspots(this.#layer, {
          page,
          hotspots: hotspotsIn(view.items, rect ? toLineRect(rect) : null, aspect),
          // A block with no id yet cannot anchor a thread (`chat:openSpan` refuses it).
          onAsk:
            ask && blockId
              ? (label) => ask({ blockId, quote: label, question: hotspotQuestion(label, page) })
              : null,
        });
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
      this.#layer.replaceChildren();
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

/** Why an in-place answer was not marked, in the learner's words. */
const REFUSAL_LINE: Record<AnswerQuestionRefusal, string> = {
  not_open: 'This question is closed. Ask Max for another in the chat.',
  in_flight: 'Still marking your last answer.',
  empty: 'Write an answer first.',
  no_question: 'Write the question first.',
  no_doc: 'The notes are not ready yet.',
};

/** The call itself failed. Not one of main's refusals, so it has its own line. */
const FAILED_LINE = 'That did not reach Max. Try again.';

/**
 * Where a Submit stands. `idle` is the resting state; `marking` is the call being out; the rest
 * are a line under the block that stays until the learner changes what it was said about.
 */
type SubmitPhase = 'idle' | 'marking' | 'sent' | 'failed' | AnswerQuestionRefusal;

/** The Q block view behind each root element, so ⌘↩ can reach the one the cursor is in. */
const Q_VIEWS = new WeakMap<HTMLElement, QBlockView>();

/**
 * A question in the document (§5.2): Max's, or since 2026-10-01 the learner's own. Its status tag,
 * the learner's remove, and the footer where an answer written in place is submitted.
 */
class QBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #who: HTMLElement;
  #tag: HTMLElement;
  #foot: HTMLElement;
  #act: HTMLButtonElement;
  #note: HTMLElement;
  #node: Node;
  #view: EditorView;
  #getPos: () => number | undefined;
  #ctx: NodeViewContext;
  /** What the footer's one button does right now. */
  #mode: 'start' | 'submit' = 'start';
  #phase: SubmitPhase = 'idle';
  /** The question and answer the current `#phase` is about. A change to either clears it. */
  #about = '';
  #destroyed = false;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, ctx: NodeViewContext) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.#ctx = ctx;
    this.dom = document.createElement('section');
    this.dom.className = 'nd-q';
    Q_VIEWS.set(this.dom, this);

    const head = document.createElement('div');
    head.className = 'nd-q-head';

    this.#who = document.createElement('span');
    this.#who.className = 'nd-q-who';

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

    head.append(this.#who, this.#tag, remove);
    this.dom.append(head);

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'nd-q-body';
    this.dom.append(this.contentDOM);

    // The footer is chrome like the head: outside `contentDOM`, not editable, and its events are
    // its own (`stopEvent`), so a press on Submit is never a click in the document.
    this.#foot = document.createElement('div');
    this.#foot.className = 'nd-q-foot';
    this.#foot.contentEditable = 'false';

    this.#act = document.createElement('button');
    this.#act.type = 'button';
    this.#act.className = 'nd-q-act';
    // Keeps the caret where it is: the press must not blur the answer being submitted.
    this.#act.addEventListener('mousedown', (event) => event.preventDefault());
    this.#act.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.#mode === 'submit') this.submit();
      else this.#startAnswer();
    });

    this.#note = document.createElement('span');
    this.#note.className = 'nd-q-note';
    this.#note.setAttribute('role', 'status');

    this.#foot.append(this.#act, this.#note);
    this.dom.append(this.#foot);

    this.#paintHead();
    this.#paintTag();
    this.#paintFoot();
  }

  #own(): boolean {
    return (this.#node.attrs.askedBy as string) === 'user';
  }

  #paintHead(): void {
    const askedBy = (this.#node.attrs.askedBy as string) || 'max';
    // On the root, so the CSS can give the learner's own question its own rail.
    this.dom.dataset.askedBy = askedBy;
    const name = askedBy === 'user' ? 'You' : AGENT_NAME[askedBy === 'ellie' ? 'ellie' : 'max'];
    this.#who.textContent = `${name} asked`;
  }

  #paintTag(): void {
    const status = (this.#node.attrs.status as string) ?? 'open';
    const resolution = (this.#node.attrs.resolution as QResolution | null) ?? null;
    this.#tag.textContent = qStatusLabel(status, resolution);
    this.#tag.dataset.status = status === 'resolved' ? (resolution ?? 'resolved') : 'open';
  }

  /**
   * The footer, from the node and the phase. Called on every `update`, which is every keystroke
   * inside the block, so it only writes to the DOM what has actually changed.
   */
  #paintFoot(): void {
    const open = ((this.#node.attrs.status as string) ?? 'open') === 'open';
    if (this.#foot.hidden === open) this.#foot.hidden = !open;
    if (!open) return;

    const parts = questionParts(this.#node);
    // A line about an answer stays until that answer changes ("Sent to Max" until they revise
    // it). The call being out is not cleared by typing: its result is still on its way.
    if (this.#phase !== 'idle' && this.#phase !== 'marking' && this.#about !== `${parts.question}\n\n${parts.answer}`) {
      this.#phase = 'idle';
    }

    let label: string | null;
    let note = '';
    let kind = 'refused';
    if (this.#phase === 'marking') {
      this.#mode = 'submit';
      label = 'Submit answer';
      note = 'Max is marking…';
      kind = 'busy';
    } else if (this.#phase === 'sent') {
      // No button: the same words are already with Max. Revising them brings Submit back.
      label = null;
      note = 'Sent to Max. His feedback is in the chat.';
      kind = 'sent';
    } else if (parts.answer.length > 0) {
      this.#mode = 'submit';
      label = 'Submit answer';
    } else if (this.#own() && parts.question.length === 0) {
      label = null;
      if (this.#phase === 'idle') {
        note = 'Write your question, then your answer on the next line';
        kind = 'hint';
      }
    } else {
      this.#mode = 'start';
      label = 'Answer here';
    }
    if (this.#phase === 'failed') note = FAILED_LINE;
    else if (this.#phase !== 'idle' && this.#phase !== 'marking' && this.#phase !== 'sent') {
      note = REFUSAL_LINE[this.#phase];
    }

    const hidden = label === null;
    if (this.#act.hidden !== hidden) this.#act.hidden = hidden;
    if (label !== null && this.#act.textContent !== label) {
      this.#act.textContent = label;
      this.#act.title =
        this.#mode === 'submit' ? 'Send your answer to Max to be marked (⌘↩)' : 'Write your answer under the question';
    }
    const busy = this.#phase === 'marking';
    if (this.#act.disabled !== busy) this.#act.disabled = busy;
    if (this.#note.textContent !== note) this.#note.textContent = note;
    if (this.#note.dataset.kind !== kind) this.#note.dataset.kind = kind;
  }

  /** **Answer here**: open a line under the question and put the caret in it. */
  #startAnswer(): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const tr = startAnswer(this.#view.state, pos);
    if (!tr) return;
    // The learner's own gesture, like Remove: in the history, and what they type there is theirs.
    this.#view.dispatch(tr.scrollIntoView());
    this.#view.focus();
  }

  /**
   * **Submit answer**, from the button or from ⌘↩.
   *
   * The two refusals the block can see for itself are said without a round trip; main checks
   * them again. Everything else is main's to decide, and the view only reports what it said.
   */
  submit(): void {
    const node = this.#node;
    if (this.#phase === 'marking' || (node.attrs.status as string) !== 'open') return;
    const parts = questionParts(node);
    this.#about = `${parts.question}\n\n${parts.answer}`;
    const own = this.#own();
    if (parts.answer.length === 0 || parts.answerBlockId === null) {
      this.#settle('empty');
      return;
    }
    if (own && parts.question.length === 0) {
      this.#settle('no_question');
      return;
    }
    const about = this.#about;
    this.#settle('marking');
    this.#ctx
      .onAnswerQuestion({
        questionId: (node.attrs.questionId as string) || '',
        qBlockId: blockAttrs(node).blockId,
        askedBy: own ? 'user' : 'max',
        question: parts.question,
        answerBlockId: parts.answerBlockId,
        answer: parts.answer,
      })
      .then(
        (result) => (result.accepted ? 'sent' : (result.reason ?? 'failed')),
        () => 'failed' as const,
      )
      .then((phase: SubmitPhase) => {
        if (this.#destroyed) return;
        // The line is about the answer that was sent. `#paintFoot` drops it at once if the
        // learner has already written past that answer while it was out.
        this.#about = about;
        this.#settle(phase);
      });
  }

  #settle(phase: SubmitPhase): void {
    this.#phase = phase;
    this.#paintFoot();
  }

  update(node: Node): boolean {
    if (node.type.name !== 'q_block') return false;
    // ProseMirror may hand a view the *next* Q block when the one it drew is removed. A line
    // about one question must not follow the view onto another; a call still out for the old
    // one is left to land, and `#about` will not match it.
    if (node.attrs.questionId !== this.#node.attrs.questionId && this.#phase !== 'marking') this.#phase = 'idle';
    this.#node = node;
    this.#paintHead();
    this.#paintTag();
    this.#paintFoot();
    return true;
  }

  /** The footer's events are the footer's: ProseMirror must not read a press there as a click. */
  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.#foot.contains(event.target);
  }

  /** The head and the footer are chrome; a mutation there is ours, not the learner's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.#destroyed = true;
    Q_VIEWS.delete(this.dom);
  }
}

/**
 * ⌘↩ with the cursor in the answer of an open Q block: the same as pressing Submit answer.
 *
 * False anywhere else, so the key falls through to whatever else binds it (`exitCode`, in a code
 * block). It goes through the node view rather than around it because the view owns the "Max is
 * marking…" state, and two ways to submit must not mean two calls.
 */
export const submitAnswerAtSelection: Command = (state, _dispatch, view) => {
  if (!view) return false;
  const target = answerTarget(state);
  if (!target) return false;
  const dom = view.nodeDOM(target.pos);
  const q = dom instanceof HTMLElement ? Q_VIEWS.get(dom) : undefined;
  if (!q) return false;
  q.submit();
  return true;
};

export function nodeViews(ctx: NodeViewContext): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    math_block: (node) => new MathBlockView(node),
    slide_figure: (node) => new SlideFigureView(node, ctx),
    q_block: (node, view, getPos) => new QBlockView(node, view, getPos, ctx),
    table: (node, view, getPos) => new TableView(node, view, getPos, ctx),
    ...diagramNodeViews(ctx),
  };
}
