/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * FLASHCARDS (notebooks §5.3, 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A `flashcards` block is a grid of cards. Each card is a `flashcard` of two real, editable text
 * fields (`flashcard_front`, `flashcard_back`) in the per-span author mark, so what the learner
 * types on a card is protected exactly as a paragraph is. **The back is held until the learner
 * flips the card** (the Show answer button, which is a real button: Space and Enter work). A
 * flipped card shows its back and hides its front; flip again and it is as it was.
 *
 * **Flip state is view chrome.** It is `data-flipped` on the card's own DOM and nothing else: not
 * an attr, not plugin state, never a transaction, so it is never saved, never undone, never read
 * by the progress ledger, and a reload shows every card fronts up. **Editing reveals both sides**:
 * the plugin marks the card the caret is in (`nd-item-active`, `blockkit.ts`) and the stylesheet
 * shows front and back together for it.
 */

import type { Node } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { BlockView, ItemView, tool, type ItemViewConfig } from './blockkit.js';
import type { NodeViewContext } from './nodeviews.js';

/** The flip button's words for a card in this state. The button is the only way to flip. */
export function flipLabel(flipped: boolean): string {
  return flipped ? 'Show front' : 'Show answer';
}

const CARD: ItemViewConfig = {
  type: 'flashcard',
  className: 'nd-fc-card',
  build(item) {
    const button = tool('nd-fc-flip', flipLabel(false), 'Flip this card', () => {
      const flipped = item.dom.dataset.flipped !== 'true';
      item.dom.dataset.flipped = String(flipped);
      button.textContent = flipLabel(flipped);
    });
    item.dom.dataset.flipped = 'false';
    return [button];
  },
};

export function flashcardNodeViews(ctx: NodeViewContext): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    flashcards: (node, view, getPos) =>
      new BlockView(node, view, getPos, {
        name: 'flashcards',
        className: 'nd-fc',
        label: 'Flashcards',
        itemName: 'Card',
        tools: () => [],
      }),
    flashcard: (node) => new ItemView(node, CARD, ctx),
  };
}
