/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * CONCEPT CARDS, THE RULES (`notebooks.md` §11.2, amended 2026-10-06; decision D1)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The notes are written as **concept cards**: one card per idea, its **core line** (the term in
 * bold and a one-sentence definition, cited) always visible, its **depth** (intuition, equation,
 * steps, example, table, figure, result, pitfall, note) folded under it and opened in place. The
 * schema holds the card whole (`shared/doc/schema.ts`, `concept` and `concept_item`); this file is
 * the editor's half of the rule, kept pure so it is tested without a DOM, as `tutorialmodel.ts`
 * is beside `tutorial.ts`:
 *
 *  - **what the learner reads** on a card: each item's role label, whether it is "added" (not on
 *    the slides), and the quiet hint naming what a folded card holds;
 *  - **where folding lives**: view state, never the document (`CardFolds`). A fold is not an
 *    edit: it is not saved, not undone, not sent to a model, and the outline, the search index
 *    and every agent see the card whole whether or not the learner has opened it;
 *  - **when a card opens by itself**, so nothing lands invisibly: the caret moving into its depth,
 *    a block inside its depth being scrolled to, picked as a search hit or read aloud, and an
 *    agent's edit landing in it (`cardsRevealedBy…`);
 *  - **the rows of a card**: the core line and each block inside a depth item, which are what the
 *    chips and the action toolbar sit on (`cardRows`, `cardRowAt`).
 *
 * The plugin and the node views that act on these are `concept.ts`.
 */
import type { Node, ResolvedPos } from 'prosemirror-model';
import { blockAttrs, cardOf, conceptItems, isConcept, isConceptRole } from '../../../shared/doc/schema.js';
import { CONCEPT_ROLES, type ConceptRole } from '../../../shared/doc/types.js';

// ── what the learner reads ──────────────────────────────────────────────────────────────────

/** Each depth item's label, above its body. In the reading order of `CONCEPT_ROLES`. */
export const CONCEPT_ROLE_LABEL: Readonly<Record<ConceptRole, string>> = {
  intuition: 'Intuition',
  equation: 'Equation',
  steps: 'Steps',
  example: 'Example',
  table: 'Table',
  figure: 'Figure',
  result: 'Result',
  pitfall: 'Pitfall',
  note: 'Note',
};

/** A role's label; an unknown role reads as a note, as the schema files it. */
export function roleLabel(role: unknown): string {
  return CONCEPT_ROLE_LABEL[isConceptRole(role) ? role : 'note'];
}

/**
 * The two roles that are never on the slides (§11.2): an intuition and a pitfall are the notes'
 * own, so they always read as "added", whatever their `reason` says.
 */
const ALWAYS_ADDED: ReadonlySet<ConceptRole> = new Set<ConceptRole>(['intuition', 'pitfall']);

/**
 * **Is this depth item "added"**, content not on the slides? The same signal the provenance chip
 * already reads (`added: <reason>`): a non-null `reason`. Intuition and pitfall always are.
 */
export function isAddedItem(item: Node): boolean {
  const role = item.attrs.role as unknown;
  if (isConceptRole(role) && ALWAYS_ADDED.has(role)) return true;
  return blockAttrs(item).reason !== null;
}

/**
 * **The quiet hint under a folded card**: what its depth holds, by role, in reading order, each
 * once (`equation · example · pitfall`). Empty for a card with no depth: it has nothing to open,
 * so it shows no caret and no hint.
 */
export function foldedHint(card: Node): string {
  const roles = new Set(conceptItems(card).map((item) => item.role));
  return CONCEPT_ROLES.filter((role) => roles.has(role))
    .map((role) => CONCEPT_ROLE_LABEL[role].toLowerCase())
    .join(' · ');
}

/** Does the card have anything folded under its core line? */
export function hasDepth(card: Node): boolean {
  return conceptItems(card).length > 0;
}

/** A card's id, or null when it has none yet (the authorship stamp mints it a moment later). */
export function cardIdOfNode(card: Node): string | null {
  return blockAttrs(card).blockId || null;
}

// ── where folding lives: view state, never the document ────────────────────────────────────

/**
 * **Which cards the learner has opened, per document.** Folded is the default, so only the open
 * ones are held, keyed by the document's id and then the card's `blockId`.
 *
 * **Session-local, on purpose.** The renderer keeps no per-document UI state across launches (the
 * only `localStorage` it writes is per install: panel widths, zoom), and a fold is the lightest
 * state there is. A module-level instance (`cardFolds`) outlives the editor view, so a card stays
 * open across a round trip through the page viewer, a Split, or a notebook switch and back, and
 * every launch starts with the notes as written: every card folded to its core line.
 */
export class CardFolds {
  readonly #open = new Map<string, Set<string>>();

  /** The open cards of one document, as a fresh set. */
  openIn(docKey: string): Set<string> {
    return new Set(this.#open.get(docKey) ?? []);
  }

  isOpen(docKey: string, cardId: string): boolean {
    return this.#open.get(docKey)?.has(cardId) ?? false;
  }

  set(docKey: string, cardId: string, open: boolean): void {
    const ids = new Set(this.#open.get(docKey) ?? []);
    if (open) ids.add(cardId);
    else ids.delete(cardId);
    this.replace(docKey, ids);
  }

  /** The whole open set of a document, as the editor holds it now. */
  replace(docKey: string, ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === 0) this.#open.delete(docKey);
    else this.#open.set(docKey, next);
  }
}

/** The one the editors share. */
export const cardFolds = new CardFolds();

// ── when a card opens by itself ─────────────────────────────────────────────────────────────

/**
 * **The card whose depth holds this position**, or null: inside the card, and past its core line
 * (anywhere in a depth item, or between two items, where a gap cursor or a selected item sits). A
 * position in the core line, or just before it, is not in the depth: the core line is always
 * visible. Cards stand only at the top level (`schema.ts`), so the card is always `node(1)`.
 */
export function depthCardAt($pos: ResolvedPos): string | null {
  if ($pos.depth < 1) return null;
  const card = $pos.node(1);
  if (!isConcept(card) || $pos.index(1) < 1) return null;
  return cardIdOfNode(card);
}

/**
 * **The caret moved into a folded card's depth** (arrow keys, a Find, a placed caret, a selected
 * item): the cards whose depth either end of the selection is in. A selection that only runs over
 * a whole card (select-all) opens nothing: both of its ends are outside every card.
 */
export function cardsRevealedBySelection(doc: Node, from: number, to: number): string[] {
  const out: string[] = [];
  for (const at of from === to ? [from] : [from, to]) {
    if (at < 0 || at > doc.content.size) continue;
    const id = depthCardAt(doc.resolve(at));
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * **Blocks that must be seen**: scrolled to, picked as a search hit, read aloud, or written by an
 * agent. The cards whose *depth* holds any of them. A card, or its core line, is visible folded
 * and opens nothing.
 *
 * A card that is itself among the blocks (a whole card an agent has just written) stays folded:
 * it arrived as a card, core line first, like every card the ingest writes. Only an addition to
 * a card that was already there opens it (Ellie's `card_attach`, `notebooks.md` §4.2 as amended).
 */
export function cardsRevealedByBlocks(doc: Node, blockIds: readonly string[]): string[] {
  const named = new Set(blockIds);
  const out: string[] = [];
  for (const blockId of blockIds) {
    if (!blockId) continue;
    const ref = cardOf(doc, blockId);
    if (!ref || ref.isCore || ref.item === null || !ref.cardId) continue;
    if (named.has(ref.cardId) || out.includes(ref.cardId)) continue;
    out.push(ref.cardId);
  }
  return out;
}

/** Of `candidates`, the ones not already open, in order. */
export function cardsToOpen(candidates: readonly string[], open: ReadonlySet<string>): string[] {
  return candidates.filter((id, i) => !open.has(id) && candidates.indexOf(id) === i);
}

// ── the rows of a card: where the chips and the toolbar sit ─────────────────────────────────

export interface CardRow {
  node: Node;
  pos: number;
  /** `core` for the core line; `item` for a block directly inside a depth item. */
  kind: 'core' | 'item';
}

/**
 * **A card's rows**: its core line, then each block directly inside each depth item, with their
 * document positions. The card and its items are frames, not rows: the core line carries the
 * card's chip and toolbar, and an item's label is its header.
 */
export function cardRows(card: Node, cardPos: number): CardRow[] {
  const rows: CardRow[] = [];
  if (!isConcept(card)) return rows;
  card.forEach((child, offset, index) => {
    const pos = cardPos + 1 + offset;
    if (index === 0 && child.type.name === 'paragraph') {
      rows.push({ node: child, pos, kind: 'core' });
      return;
    }
    if (child.type.name !== 'concept_item') return;
    child.forEach((block, inner) => rows.push({ node: block, pos: pos + 1 + inner, kind: 'item' }));
  });
  return rows;
}

/** The row of a card that holds `pos`, or null outside every card's rows. */
export function cardRowAt(doc: Node, pos: number): CardRow | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth < 2 || !isConcept($pos.node(1))) return null;
  if ($pos.index(1) === 0) {
    const core = $pos.node(2);
    return core.type.name === 'paragraph' ? { node: core, pos: $pos.before(2), kind: 'core' } : null;
  }
  if ($pos.node(2).type.name !== 'concept_item' || $pos.depth < 3) return null;
  return { node: $pos.node(3), pos: $pos.before(3), kind: 'item' };
}

/**
 * **Is the block at `pos` a card row** (`cardRows`)? For a walk that visits every block
 * (`eachBlock`) and has to tell a row from the card's frames and from anything nested deeper.
 */
export function isCardRow(doc: Node, pos: number): boolean {
  const $pos = doc.resolve(pos);
  if ($pos.depth === 1) return isConcept($pos.parent) && $pos.index(1) === 0 && $pos.nodeAfter?.type.name === 'paragraph';
  return $pos.depth === 2 && $pos.parent.type.name === 'concept_item' && isConcept($pos.node(1));
}

/** The core line a position is in, as its card's id and position, or null. */
export function coreLineAt(doc: Node, pos: number): { cardId: string | null; cardPos: number; card: Node } | null {
  const row = cardRowAt(doc, pos);
  if (!row || row.kind !== 'core') return null;
  const $pos = doc.resolve(pos);
  const card = $pos.node(1);
  return { cardId: cardIdOfNode(card), cardPos: $pos.before(1), card };
}
