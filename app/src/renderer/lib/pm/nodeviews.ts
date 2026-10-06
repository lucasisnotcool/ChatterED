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
 *    a question may be the learner's own (`askedBy: 'user'`, "You asked"). Since 2026-10-06 (D4)
 *    Max's open question reads in a side rail and a closed one folds to a one-line self-check.
 *
 * **`math_inline` is a mark, not a node**, so it cannot have a node view at all. Since 2026-10-03
 * it is typeset by a decoration instead (`math.ts`), with its source hidden at rest and edited in
 * the formula popover, so the text stays the learner's or the agent's words underneath.
 */

import katex from 'katex';
import type { Node } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import type { AnswerQuestionRefusal, NotesAnswerQuestionResult } from '../../../shared/ipc.js';
import { blockAttrs } from '../../../shared/doc/schema.js';
import type { QResolution, Rect } from '../../../shared/doc/types.js';
import { AGENT_NAME, qStatusLabel } from './chrome.js';
import {
  answerTarget,
  isRailQuestion,
  isSelfCheck,
  questionParts,
  selfCheckLabel,
  selfCheckLine,
  selfCheckNote,
  selfCheckState,
  startAnswer,
  type QuestionAnswer,
} from './qblock.js';
import { paragraphs } from '../aitext.js';
import type { SlideSource } from '../rasterise.js';
import { hotspotQuestion, hotspotsIn, type PageLinesView } from '../../../shared/doc/cite.js';
import { drawHotspots, toLineRect } from './sourcepop.js';
import { TableView } from './tableview.js';
import { editBlock } from './math.js';
import { SlideImageView } from './image.js';
import { diagramNodeViews } from './diagram.js';
import { flashcardNodeViews } from './flashcards.js';
import { infographicNodeViews } from './infographic.js';
import { quizNodeViews } from './quiz.js';
import { conceptNodeViews } from './concept.js';
// The stylesheet of the three blocks of notebooks §5.3, carried by the views that need it so no
// other file has to import it (`blocks.css`).
import '../../components/notes/blocks.css';

export interface NodeViewContext {
  /** The open deck, once its bytes have arrived. Null while it is still loading. */
  slides: () => SlideSource | null;
  /**
   * A figure’s click: a slide window beside `anchor`, outlining the rect (2026-10-03: it was
   * the in-doc modal). `afterBlockId` is where an Insert from it goes.
   */
  onOpenSlide: (page: number, rect: Rect | null, anchor?: HTMLElement, afterBlockId?: string | null) => void;
  /**
   * **Insert into notes**, from a slide window (2026-10-03): the whole slide or a crop of it, as a
   * figure after `afterBlockId` (the block the slide was opened from), or the caret's block.
   */
  onInsertSlide?: (target: { page: number; rect: Rect | null }, afterBlockId: string | null) => void;
  /**
   * **An image's click** (2026-10-03): its slide in a window whose yellow box is the image's crop,
   * editable there; `onRecrop` writes a new crop back to the image.
   */
  onOpenImage?: (input: {
    page: number;
    rect: Rect | null;
    anchor: HTMLElement;
    blockId: string | null;
    onRecrop: (rect: Rect | null) => void;
  }) => void;
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

/**
 * A display formula: KaTeX, and a click opens the formula editor on it (`math.ts`, 2026-10-03).
 * It used to be read-only, so a learner could not fix a formula, or write one, at all.
 */
class MathBlockView implements NodeView {
  readonly dom: HTMLElement;
  #tex: string;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.dom = document.createElement('div');
    this.#tex = (node.attrs.tex as string) || '';
    this.#draw();
    this.dom.addEventListener('mousedown', (event) => {
      if (!view.editable) return;
      event.preventDefault();
      const pos = getPos();
      if (pos !== undefined) editBlock(view, pos);
    });
  }

  #draw(): void {
    this.dom.className = 'nd-mathblock';
    this.dom.title = 'Click to edit this formula';
    if (this.#tex.trim().length === 0) {
      this.dom.textContent = 'An empty formula. Click to write one.';
      this.dom.classList.add('nd-mathblock-empty');
      return;
    }
    typeset(this.dom, this.#tex, true);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'math_block') return false;
    const tex = (node.attrs.tex as string) || '';
    if (tex !== this.#tex) {
      this.#tex = tex;
      this.#draw();
    }
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('nd-mathblock-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('nd-mathblock-selected');
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
      const blockId = (this.#node.attrs.blockId as string | null) ?? null;
      ctx.onOpenSlide(this.#node.attrs.page as number, (this.#node.attrs.rect as Rect | null) ?? null, this.#frame, blockId);
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
 * **The narrowest editor that gets the side rail** (D4, 2026-10-06). Below it Max's open question
 * stays a card in the flow, as it was. The rail card is about 260 px with its 22 px gap, and the
 * text beside it needs about 280 px to read as prose rather than three words a line; the
 * compact sheet (`layout.ts` `COMPACT_BELOW`) and the floor gutters' narrowest column (~390 px)
 * both fall under it, so a docked tutorial or a zoomed narrow pane keep the in-flow card.
 */
const RAIL_MIN_WIDTH = 560;

/**
 * A question in the document (§5.2): Max's, or since 2026-10-01 the learner's own. Its status tag,
 * the learner's remove, and the footer where an answer written in place is submitted.
 *
 * **Three ways to draw it** since 2026-10-06 (D4, "a clean doc"; `collab-doc.md` §5.2/§5.3 and
 * `notebooks.md` §5.2, amended 2026-10-06), on the root's `data-view`:
 *
 *  - `rail`: Max's **open** question, a card floated into the column's right side beside the
 *    lines under the block it asks about, so the notes read on around it instead of being split
 *    by it. Not the gutter: the gutters are 104–132 px and already hold the chip and the toolbar,
 *    and a card there was cut off the moment the column narrowed (the suggestion card's history,
 *    notes.css `.nd-suggest`). On an editor under `RAIL_MIN_WIDTH` it stays in the flow
 *    (`data-rail="inline"`). Answer here and Submit are unchanged; the body is still `contentDOM`.
 *  - `chip`: Max's **closed** question, one line under the block: *Self-check*, the question in
 *    one line, and *your answer*, *recall* or *revisit* (`selfCheckLabel`; *recall* since 6 Oct
 *    afternoon, decision 14). A click opens it to the question and what is under it, and on *your
 *    answer* Max's one sentence after it, marked as his (`selfCheckNote`, decision 12); that is
 *    this view's own state, never saved.
 *  - `block`: the learner's own question, open or closed, exactly as before.
 */
class QBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #who: HTMLElement;
  #tag: HTMLElement;
  #foot: HTMLElement;
  #act: HTMLButtonElement;
  #note: HTMLElement;
  #chip: HTMLElement;
  #chipToggle: HTMLButtonElement;
  #chipLine: HTMLElement;
  #chipState: HTMLElement;
  /** Max's one sentence under the learner's answer on an open chip (decision 12), or hidden. */
  #maxNote: HTMLElement;
  #maxNoteText: HTMLElement;
  /** The sentence `#maxNoteText` was last drawn from, so it is typeset only when it changes. */
  #maxNoteDrawn: string | null = null;
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
  /** The chip is open. View-local: a reopened doc shows every chip closed again. */
  #expanded = false;
  /** The editor is wide enough for the rail (`RAIL_MIN_WIDTH`). */
  #wide = false;
  #observer: ResizeObserver | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, ctx: NodeViewContext) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.#ctx = ctx;
    this.dom = document.createElement('section');
    this.dom.className = 'nd-q';
    Q_VIEWS.set(this.dom, this);

    // The closed question's one line. Chrome like the head: outside `contentDOM`, not editable,
    // its events its own (`stopEvent`). CSS shows it only when `data-view` is `chip`.
    this.#chip = document.createElement('div');
    this.#chip.className = 'nd-q-chip';
    this.#chip.contentEditable = 'false';
    this.#chipToggle = document.createElement('button');
    this.#chipToggle.type = 'button';
    this.#chipToggle.className = 'nd-q-chip-toggle';
    const mark = document.createElement('span');
    mark.className = 'nd-q-chip-mark';
    mark.textContent = 'Self-check';
    this.#chipLine = document.createElement('span');
    this.#chipLine.className = 'nd-q-chip-line';
    this.#chipState = document.createElement('span');
    this.#chipState.className = 'nd-q-chip-state';
    this.#chipToggle.append(mark, this.#chipLine, this.#chipState);
    this.#chipToggle.addEventListener('mousedown', (event) => event.preventDefault());
    this.#chipToggle.addEventListener('click', (event) => {
      event.preventDefault();
      this.#expanded = !this.#expanded;
      this.#paintView();
    });
    this.#chip.append(this.#chipToggle, this.#removeButton());
    this.dom.append(this.#chip);

    const head = document.createElement('div');
    head.className = 'nd-q-head';

    this.#who = document.createElement('span');
    this.#who.className = 'nd-q-who';

    this.#tag = document.createElement('span');
    this.#tag.className = 'nd-q-tag';

    head.append(this.#who, this.#tag, this.#removeButton());
    this.dom.append(head);

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'nd-q-body';
    this.dom.append(this.contentDOM);

    /**
     * **Max's sentence on the chip** (6 Oct afternoon, decision 12 on #67; `notebooks.md`
     * §11.10.5). Chrome, outside `contentDOM`: it is the Q block's `maxNote` attribute, not
     * document text, so it can never be taken for the learner's answer above it. Marked as his by
     * name and by his dashed rail, never by colour alone. CSS shows it only on an open chip.
     */
    this.#maxNote = document.createElement('div');
    this.#maxNote.className = 'nd-q-maxnote';
    this.#maxNote.contentEditable = 'false';
    this.#maxNote.hidden = true;
    const noteWho = document.createElement('span');
    noteWho.className = 'nd-q-maxnote-who';
    noteWho.textContent = AGENT_NAME.max;
    this.#maxNoteText = document.createElement('div');
    this.#maxNoteText.className = 'nd-q-maxnote-text';
    this.#maxNote.append(noteWho, this.#maxNoteText);
    this.dom.append(this.#maxNote);

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

    // The rail needs the editor's width, which a stylesheet cannot ask for: the notes column is
    // sized by `--nd-gutter` and `zoom`, not by the viewport, so a media query would be wrong.
    // Read once now as well, so a question does not first draw in the flow and then jump.
    this.#wide = view.dom.clientWidth >= RAIL_MIN_WIDTH;
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => {
        const wide = view.dom.clientWidth >= RAIL_MIN_WIDTH;
        if (wide === this.#wide) return;
        this.#wide = wide;
        this.#paintView();
      });
      this.#observer.observe(view.dom);
    }

    this.#paintHead();
    this.#paintTag();
    this.#paintFoot();
    this.#paintView();
  }

  /**
   * Remove, in the head and on the chip. The learner's own gesture, so it IS in the history: an
   * accidental Remove is one ⌘Z away.
   */
  #removeButton(): HTMLButtonElement {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'nd-q-remove';
    remove.textContent = 'Remove';
    remove.title = 'Take this question out of the notes';
    remove.addEventListener('mousedown', (event) => event.preventDefault());
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      const pos = this.#getPos();
      if (pos === undefined) return;
      const target = this.#view.state.doc.nodeAt(pos);
      if (!target) return;
      this.#view.dispatch(this.#view.state.tr.delete(pos, pos + target.nodeSize).scrollIntoView());
      this.#view.focus();
    });
    return remove;
  }

  /** Rail, chip or block (see the class comment), from the node and the editor's width. */
  #paintView(): void {
    const node = this.#node;
    const chip = isSelfCheck(node);
    const rail = isRailQuestion(node);
    const view = chip ? 'chip' : rail ? 'rail' : 'block';
    if (this.dom.dataset.view !== view) this.dom.dataset.view = view;
    const side = rail ? (this.#wide ? 'side' : 'inline') : null;
    if (side === null) delete this.dom.dataset.rail;
    else if (this.dom.dataset.rail !== side) this.dom.dataset.rail = side;
    const note = selfCheckNote(node);
    if (this.#maxNote.hidden !== (note === null)) this.#maxNote.hidden = note === null;
    if (note !== null && note !== this.#maxNoteDrawn) {
      // `paragraphs` escapes everything it does not typeset: the sentence is Max's text, as HTML.
      this.#maxNoteText.innerHTML = paragraphs(note);
      this.#maxNoteDrawn = note;
    }
    if (!chip) {
      delete this.dom.dataset.expanded;
      return;
    }
    const line = selfCheckLine(node) || 'A question from Max';
    if (this.#chipLine.textContent !== line) {
      this.#chipLine.textContent = line;
      this.#chipLine.title = line;
    }
    const label = selfCheckLabel((node.attrs.resolution as QResolution | null) ?? null);
    if (this.#chipState.textContent !== label) {
      this.#chipState.textContent = label;
      this.#chipState.dataset.state = selfCheckState(label);
    }
    const expanded = String(this.#expanded);
    if (this.dom.dataset.expanded !== expanded) this.dom.dataset.expanded = expanded;
    this.#chipToggle.setAttribute('aria-expanded', expanded);
    this.#chipToggle.title = this.#expanded
      ? 'Fold this question away'
      : label === 'your answer'
        ? note !== null
          ? "Show the question, your answer and Max's note"
          : 'Show the question and your answer'
        : label === 'recall'
          ? 'Show the question and the term you recalled'
          : 'Show the question, to try it again';
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
    const label = qStatusLabel(status, resolution);
    this.#tag.textContent = label;
    this.#tag.dataset.status =
      status !== 'resolved' ? 'open' : selfCheckState(selfCheckLabel(resolution));
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
    // A question that has just closed (or a different one) starts folded: the chip is the point.
    if (node.attrs.questionId !== this.#node.attrs.questionId || node.attrs.status !== this.#node.attrs.status) {
      this.#expanded = false;
    }
    this.#node = node;
    this.#paintHead();
    this.#paintTag();
    this.#paintFoot();
    this.#paintView();
    return true;
  }

  /** The footer's and the chip's events are theirs: ProseMirror must not read a press as a click. */
  stopEvent(event: Event): boolean {
    if (!(event.target instanceof globalThis.Node)) return false;
    return this.#foot.contains(event.target) || this.#chip.contains(event.target);
  }

  /** The head, the chip and the footer are chrome; a mutation there is ours, not the learner's. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#observer?.disconnect();
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

export function nodeViews(ctx: NodeViewContext): Record<string, NodeViewConstructor> {
  return {
    math_block: (node, view, getPos) => new MathBlockView(node, view, getPos),
    slide_figure: (node) => new SlideFigureView(node, ctx),
    slide_image: (node, view, getPos) => new SlideImageView(node, view, getPos, ctx),
    q_block: (node, view, getPos) => new QBlockView(node, view, getPos, ctx),
    table: (node, view, getPos) => new TableView(node, view, getPos, ctx),
    ...diagramNodeViews(ctx),
    ...flashcardNodeViews(ctx),
    ...quizNodeViews(ctx),
    ...infographicNodeViews(ctx),
    // A concept card and its depth items (`notebooks.md` §11.2, amended 2026-10-06): `concept.ts`.
    ...conceptNodeViews(),
  };
}
