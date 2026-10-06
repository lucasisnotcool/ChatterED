/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * CONCEPT CARDS IN THE EDITOR (`notebooks.md` §11.2, amended 2026-10-06; decision D1)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A card shows its **core line** and folds its **depth** under it. Three pieces, all view state:
 *
 *  - **`conceptPlugin`** holds which cards are open in this view (a set of card ids), draws each
 *    open card's `nd-concept-open` class as a node decoration, and opens a card by itself when
 *    something must be seen inside its depth (`conceptmodel.ts`, `cardsRevealedBy…`): the caret
 *    arriving there, a search hit or the read-aloud highlight landing there, a scroll to a block
 *    there (`revealInView`, from the store), an agent's edit landing there.
 *  - **`ConceptView`**, the card: its `contentDOM` holds the core line and the items, so all of it
 *    stays editable; the disclosure caret beside the core line and the quiet hint under it
 *    (`equation · example · pitfall`) are chrome outside it.
 *  - **`ConceptItemView`**, one depth item: its role label (Example, Pitfall…, "added" on what is
 *    not on the slides) and its body.
 *
 * **A fold is never a document change.** Opening and closing are transactions with no steps,
 * `addToHistory: false` (as `readaloud.ts` and `searchhit.ts` do it): `docChanged` is false, so the
 * store schedules no save, the authorship plugin stamps nothing, the learner's "has touched the
 * doc" stays as it was, and ⌘Z never folds a card. Hiding is CSS on that class (`concept.css`):
 * the blocks are in the DOM, and a hidden block's chip and toolbar are hidden with it.
 *
 * **A click on the core line opens or closes the card** (§11.2), unless the learner is working in
 * that line: a click while the caret is already in it only moves the caret, so a learner editing
 * the definition never folds it away by clicking into a word. Never on a link, a formula, an
 * image or any control, never on a drag or a double-click. The caret beside the line is a real
 * button (`aria-expanded`), and ⌘⌥↩ folds or opens the card the caret is in.
 */
import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from 'prosemirror-view';
import { blockAttrs, isConcept } from '../../../shared/doc/schema.js';
import {
  cardFolds,
  cardIdOfNode,
  cardsRevealedByBlocks,
  cardsRevealedBySelection,
  cardsToOpen,
  coreLineAt,
  foldedHint,
  isAddedItem,
  roleLabel,
  type CardFolds,
} from './conceptmodel.js';
import { readAloudKey } from './readaloud.js';
import { searchHitKey } from './searchhit.js';
// Carried by the module that draws with it, as `tutorial.ts` carries `tutorial.css`.
import '../../components/notes/concept.css';

/** On an open card's root (its node decoration). Everything folded is hidden by its absence. */
export const CONCEPT_OPEN_CLASS = 'nd-concept-open';

export interface ConceptState {
  /** The ids of the cards open in this view. Replaced, never mutated, so a change is `!==`. */
  open: ReadonlySet<string>;
  decorations: DecorationSet;
}

interface ConceptMeta {
  /** Open or close one card. */
  toggle?: string;
  /** Open the cards whose depth holds any of these blocks (`cardsRevealedByBlocks`). */
  reveal?: readonly string[];
}

export const conceptKey = new PluginKey<ConceptState>('chattered:concept');

/** The decoration spec that tells a card's view it is open (read in `ConceptView.update`). */
interface OpenSpec {
  conceptOpen: true;
}

/**
 * A steps-free transaction opening the cards whose depth holds any of `blockIds`. What the store
 * dispatches before it scrolls to a block, and after an agent's edit lands. Not undoable, not saved.
 */
export function revealBlocks(tr: Transaction, blockIds: readonly string[]): Transaction {
  return tr.setMeta(conceptKey, { reveal: [...blockIds] } satisfies ConceptMeta).setMeta('addToHistory', false);
}

/**
 * **Open what must be seen, and only when it is folded**: the store's call before a scroll, and
 * after an agent's edit. Dispatches nothing (no redraw, no transaction) when every card concerned
 * is open already, or none is. True when it opened one.
 */
export function revealInView(view: EditorView, blockIds: readonly string[]): boolean {
  if (!conceptKey.getState(view.state)) return false;
  const opening = cardsToOpen(cardsRevealedByBlocks(view.state.doc, blockIds), openCards(view.state));
  if (opening.length === 0) return false;
  view.dispatch(revealBlocks(view.state.tr, blockIds));
  return true;
}

/** The cards open in this view (empty without the plugin). */
export function openCards(state: EditorState): ReadonlySet<string> {
  return conceptKey.getState(state)?.open ?? new Set<string>();
}

/** An open card's class, on every open card; and on a card with no id yet, which cannot be folded. */
function decorate(doc: Node, open: ReadonlySet<string>): DecorationSet {
  const out: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (!isConcept(node)) return;
    const id = cardIdOfNode(node);
    if (id !== null && !open.has(id)) return;
    out.push(Decoration.node(offset, offset + node.nodeSize, { class: CONCEPT_OPEN_CLASS }, { conceptOpen: true } satisfies OpenSpec));
  });
  return out.length > 0 ? DecorationSet.create(doc, out) : DecorationSet.empty;
}

/**
 * **Fold or open one card**, from its caret, its core line or the key. Closing it with the caret
 * inside its depth moves the caret to the end of the core line first: a caret left in a hidden
 * block would type into words nobody can see, and would open the card again on the next key.
 */
export function toggleCardTr(state: EditorState, cardPos: number): Transaction | null {
  const card = state.doc.nodeAt(cardPos);
  const id = card && isConcept(card) ? cardIdOfNode(card) : null;
  if (!card || !id) return null;
  const tr = state.tr.setMeta(conceptKey, { toggle: id } satisfies ConceptMeta).setMeta('addToHistory', false);
  if (openCards(state).has(id)) {
    const { from, to } = state.selection;
    const inside = (at: number): boolean => cardsRevealedBySelection(state.doc, at, at).includes(id);
    if (inside(from) || inside(to)) {
      const core = card.firstChild;
      const end = cardPos + 1 + (core ? core.nodeSize - 1 : 0);
      tr.setSelection(TextSelection.create(state.doc, end));
    }
  }
  return tr;
}

/** ⌘⌥↩: fold or open the card the caret is in. False outside a card, or in one with no depth. */
function toggleAtCaret(view: EditorView): boolean {
  const $from = view.state.selection.$from;
  if ($from.depth < 1 || !isConcept($from.node(1))) return false;
  if ($from.node(1).childCount < 2) return false;
  const tr = toggleCardTr(view.state, $from.before(1));
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

/** What a click on the core line must leave alone: a link, a formula, an image, any control. */
const NOT_A_FOLD_CLICK = 'a, button, input, textarea, select, img, canvas, math-field, .katex, .nd-img, [contenteditable="false"]';

export interface ConceptPluginOptions {
  /** The open document's id: what the folds are kept under. Null keeps them for this view only. */
  docKey: () => string | null;
  /** Where the folds outlive the view (`cardFolds`, the shared one, by default). */
  folds?: CardFolds;
  /**
   * **A card was opened** in this view, by the learner or by something they did (the caret, a
   * search hit). Its id is the card's `blockId`. Opening a card's depth is one of readiness's
   * signals (2026-10-06, D2: `core/readiness`, `DocStore.noteDepthOpened`). Not called for the
   * folds a reopened view starts with: those were counted when they were opened.
   */
  onOpened?: (cardIds: string[]) => void;
}

export function conceptPlugin(options: ConceptPluginOptions): Plugin<ConceptState> {
  const folds = options.folds ?? cardFolds;
  /** The card whose core line held the caret when the button went down (`handleClick`). */
  let pressedIn: string | null = null;

  return new Plugin<ConceptState>({
    key: conceptKey,
    state: {
      init(_config, state): ConceptState {
        const key = options.docKey();
        const open = key ? folds.openIn(key) : new Set<string>();
        // Where the caret starts may already be inside a card's depth (a reopened view).
        for (const id of cardsRevealedBySelection(state.doc, state.selection.from, state.selection.to)) open.add(id);
        return { open, decorations: decorate(state.doc, open) };
      },
      apply(tr, value, _old, next): ConceptState {
        const meta = tr.getMeta(conceptKey) as ConceptMeta | undefined;
        let open: Set<string> | null = null;
        const mutable = (): Set<string> => (open ??= new Set(value.open));

        if (meta?.toggle) {
          const ids = mutable();
          if (ids.has(meta.toggle)) ids.delete(meta.toggle);
          else ids.add(meta.toggle);
        }
        // Everything that names a block to be seen: the store's reveal, a search hit, read aloud.
        const named: string[] = [...(meta?.reveal ?? [])];
        const hit = tr.getMeta(searchHitKey) as { blockId: string | null } | undefined;
        if (hit?.blockId) named.push(hit.blockId);
        const reading = tr.getMeta(readAloudKey) as { blockId: string | null } | undefined;
        if (reading?.blockId) named.push(reading.blockId);
        const candidates = named.length > 0 ? cardsRevealedByBlocks(next.doc, named) : [];
        // The caret arriving in a folded card's depth. Not on the toggle that just closed the card:
        // that one moved the caret out first (`toggleCardTr`).
        if (tr.selectionSet || tr.docChanged) {
          candidates.push(...cardsRevealedBySelection(next.doc, next.selection.from, next.selection.to));
        }
        const current: ReadonlySet<string> = open ?? value.open;
        const opening = cardsToOpen(candidates, current);
        if (opening.length > 0) for (const id of opening) mutable().add(id);

        if (open) return { open, decorations: decorate(next.doc, open) };
        // Found again rather than mapped: one pass over the top-level blocks, and a card the
        // change brought in (or minted an id for) is drawn as it now is.
        if (tr.docChanged) return { open: value.open, decorations: decorate(next.doc, value.open) };
        return value;
      },
    },
    view(editor) {
      let last = conceptKey.getState(editor.state)?.open;
      return {
        update(view) {
          const now = conceptKey.getState(view.state)?.open;
          if (!now || now === last) return;
          const opened = [...now].filter((id) => !last?.has(id));
          last = now;
          if (opened.length > 0) options.onOpened?.(opened);
          const key = options.docKey();
          if (key) folds.replace(key, now);
        },
      };
    },
    props: {
      decorations: (state) => conceptKey.getState(state)?.decorations ?? null,
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return false;
        return toggleAtCaret(view);
      },
      handleDOMEvents: {
        // Before ProseMirror's own: where the caret was *before* this press placed it.
        mousedown(view) {
          // An unfocused editor's selection is where it was left, not where the learner is working.
          const { $head } = view.state.selection;
          pressedIn = view.hasFocus() ? (coreLineAt(view.state.doc, $head.pos)?.cardId ?? null) : null;
          return false;
        },
      },
      handleClick(view, pos, event) {
        const was = pressedIn;
        pressedIn = null;
        if (event.button !== 0 || event.detail > 1 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest(NOT_A_FOLD_CLICK)) return false;
        const hit = coreLineAt(view.state.doc, pos);
        if (!hit || !hit.cardId || hit.card.childCount < 2) return false;
        // The learner is working in this line: a click moves the caret and nothing else.
        if (was === hit.cardId) return false;
        const tr = toggleCardTr(view.state, hit.cardPos);
        if (!tr) return false;
        // The caret where they clicked, in the same transaction: a dispatch here redraws the view
        // with the selection the state still holds, which would put the browser's new caret back
        // where it was before the click (found in a live run: the caret never reached the line).
        const $pos = view.state.doc.resolve(pos);
        if ($pos.parent.inlineContent) tr.setSelection(TextSelection.create(view.state.doc, pos));
        view.dispatch(tr);
        // Not handled: ProseMirror finishes the click as usual.
        return false;
      },
    },
  });
}

// ── the node views ──────────────────────────────────────────────────────────────────────────

function isOpenBy(decorations: readonly Decoration[]): boolean {
  return decorations.some((d) => (d.spec as Partial<OpenSpec>).conceptOpen === true);
}

let viewSerial = 0;

/**
 * **A concept card.** The root is a `<section>` like the schema's `toDOM`; the core line and the
 * depth items are its `contentDOM`; the caret and the hint are chrome around it, outside the
 * editable content, with their own events (`stopEvent`).
 */
class ConceptView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #caret: HTMLButtonElement;
  #hint: HTMLButtonElement;
  #node: Node;
  #open: boolean;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]) {
    this.#node = node;
    this.#open = isOpenBy(decorations);
    this.dom = document.createElement('section');
    this.dom.className = 'nd-concept';
    this.dom.setAttribute('data-concept', '');

    const toggle = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      const pos = getPos();
      if (pos === undefined) return;
      const tr = toggleCardTr(view.state, pos);
      if (tr) view.dispatch(tr);
    };

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'nd-concept-body';
    this.contentDOM.id = `nd-concept-${String(++viewSerial)}`;

    this.#caret = document.createElement('button');
    this.#caret.type = 'button';
    this.#caret.className = 'nd-concept-caret';
    this.#caret.contentEditable = 'false';
    this.#caret.setAttribute('aria-controls', this.contentDOM.id);
    // Pressed, not clicked, would move the caret first; the press keeps the caret where it is.
    this.#caret.addEventListener('mousedown', (event) => event.preventDefault());
    this.#caret.addEventListener('click', toggle);
    // A chevron drawn, not a glyph: '▸' renders at a few pixels in the system face. Rotated open by CSS.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 10 10');
    svg.setAttribute('width', '10');
    svg.setAttribute('height', '10');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3.5 1.5 L7 5 L3.5 8.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    this.#caret.append(svg);

    this.#hint = document.createElement('button');
    this.#hint.type = 'button';
    this.#hint.className = 'nd-concept-hint';
    this.#hint.contentEditable = 'false';
    this.#hint.tabIndex = -1;
    this.#hint.addEventListener('mousedown', (event) => event.preventDefault());
    this.#hint.addEventListener('click', toggle);

    this.dom.append(this.#caret, this.contentDOM, this.#hint);
    this.#paint();
  }

  #paint(): void {
    const node = this.#node;
    const { blockId } = blockAttrs(node);
    if (blockId) this.dom.dataset.blockId = blockId;
    else delete this.dom.dataset.blockId;
    this.dom.dataset.term = (node.attrs.term as string) || '';
    const hint = foldedHint(node);
    const depth = hint.length > 0;
    const open = this.#open || !cardIdOfNode(node);
    // Not `hidden` attributes: a card with no depth has no caret at all, and the CSS hides the hint
    // of an open card, so the class on the root is the one switch.
    this.dom.classList.toggle('nd-concept-flat', !depth);
    this.#caret.hidden = !depth;
    this.#hint.hidden = !depth;
    if (!depth) return;
    const term = ((node.attrs.term as string) || '').trim() || 'this idea';
    this.#caret.setAttribute('aria-expanded', String(open));
    this.#caret.setAttribute('aria-label', open ? `Fold ${term} to its line` : `Open ${term}: ${hint}`);
    this.#caret.title = open ? 'Fold to the core line (⌘⌥↩)' : `Open: ${hint} (⌘⌥↩)`;
    if (this.#hint.textContent !== hint) this.#hint.textContent = hint;
    this.#hint.title = `Open: ${hint}`;
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type.name !== 'concept') return false;
    this.#node = node;
    this.#open = isOpenBy(decorations);
    this.#paint();
    return true;
  }

  /** The caret and the hint are chrome: a press there is theirs, never a click in the document. */
  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof globalThis.Node && (this.#caret.contains(target) || this.#hint.contains(target));
  }

  /** Only the content is the document's; a change to the chrome is ours. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }
}

/** **One depth item**: its role label over its body, "added" when it is not on the slides. */
class ConceptItemView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #role: HTMLElement;
  #added: HTMLElement;
  #node: Node;

  constructor(node: Node) {
    this.#node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'nd-ci';
    const label = document.createElement('div');
    label.className = 'nd-ci-label';
    label.contentEditable = 'false';
    this.#role = document.createElement('span');
    this.#role.className = 'nd-ci-role';
    this.#added = document.createElement('span');
    this.#added.className = 'nd-ci-added';
    this.#added.textContent = 'added';
    label.append(this.#role, this.#added);
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'nd-ci-body';
    this.dom.append(label, this.contentDOM);
    this.#paint();
  }

  #paint(): void {
    const node = this.#node;
    const role = String(node.attrs.role as string);
    this.dom.dataset.conceptItem = role;
    const { blockId, reason } = blockAttrs(node);
    if (blockId) this.dom.dataset.blockId = blockId;
    else delete this.dom.dataset.blockId;
    const label = roleLabel(role);
    if (this.#role.textContent !== label) this.#role.textContent = label;
    const added = isAddedItem(node);
    this.dom.classList.toggle('nd-ci-is-added', added);
    this.#added.hidden = !added;
    // The reason in words where the chip keeps it: on hover, for a reader who wants to know why.
    this.#added.title = added ? (reason ? `Not on the slides: ${reason}` : 'Not on the slides') : '';
  }

  update(node: Node): boolean {
    if (node.type.name !== 'concept_item') return false;
    this.#node = node;
    this.#paint();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }
}

export function conceptNodeViews(): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]) => NodeView
> {
  return {
    concept: (node, view, getPos, decorations) => new ConceptView(node, view, getPos, decorations),
    concept_item: (node) => new ConceptItemView(node),
  };
}
