/**
 * Where the header's **Insert** lands (2026-10-01): the top-level block that holds the selection.
 *
 * Main is given that block's id (`notesGenerateBlock`), reads the section it belongs to, and puts
 * Ellie's table or diagram after it. Top-level, as `insertOwnQuestion` is, so a table asked for
 * with the cursor inside a Q block goes after the question rather than into it; `$to`, as there,
 * so a selection that runs over several blocks inserts after the last of them.
 *
 * **Inside a concept card** (`notebooks.md` §11.2, amended 2026-10-06) the rule is the ops' own
 * (`shared/doc/ops.ts` `placementTarget`): from a block in a card's depth, an insert lands in that
 * depth item, straight after the block (a table or a figure for that example belongs to it); from
 * the core line, after the whole card, since nothing can stand between the core line and the
 * depth. Main is handed the id that says so: the item's block, or the card.
 */

import type { Node, ResolvedPos } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { blockAttrs, blockPos, isConcept } from '../../../shared/doc/schema.js';

/**
 * The block an insert at `$at` goes after, as the node and where it ends. In a card's depth, the
 * item's own block holding `$at` (`$at` between two of them: the one before it); in its core line,
 * the card; anywhere else, the top-level block.
 */
function anchorAt($at: ResolvedPos): { node: Node; end: number } | null {
  if ($at.depth >= 1 && isConcept($at.node(1)) && $at.depth >= 2 && $at.node(2).type.name === 'concept_item') {
    if ($at.depth >= 3) return { node: $at.node(3), end: $at.after(3) };
    const before = $at.nodeBefore;
    if (before) return { node: before, end: $at.pos };
    const after = $at.nodeAfter;
    if (after) return { node: after, end: $at.pos + after.nodeSize };
  }
  if ($at.depth >= 1) return { node: $at.node(1), end: $at.after(1) };
  return null;
}

/** The id of the block at the end of the selection that an insert goes after, or null when it has none yet. */
export function insertTargetId(state: EditorState): string | null {
  const to = state.selection.$to;
  // Depth 0 is a selection that ends between top-level blocks: a figure selected as a node, a gap
  // cursor, select-all. The block just before it is the place, as in `insertOwnQuestion`.
  const node = to.depth >= 1 ? anchorAt(to)?.node : (to.nodeBefore ?? to.nodeAfter);
  if (!node) return null;
  return blockAttrs(node).blockId || null;
}

/**
 * **The document position a new block goes to, after `blockId`** (a slide inserted from a chip or a
 * slide window, an image dropped on a block): after the block itself at the top level or in a
 * card's depth item, after the card from its core line or the card, after the top-level container
 * from anywhere else (a Q block's paragraph). Null for an unknown id.
 */
export function insertPosAfter(doc: Node, blockId: string): number | null {
  const hit = blockPos(doc, blockId);
  if (!hit) return null;
  const $pos = doc.resolve(hit.pos);
  if ($pos.depth === 0) return hit.pos + hit.node.nodeSize;
  // The block is a direct child of a depth item: straight after it, inside the item.
  if ($pos.depth === 2 && $pos.parent.type.name === 'concept_item') return hit.pos + hit.node.nodeSize;
  // Deeper in an item (a list's paragraph): after the item's block that holds it.
  if ($pos.depth >= 3 && isConcept($pos.node(1)) && $pos.node(2).type.name === 'concept_item') return $pos.after(3);
  return $pos.after(1);
}

/** The position a new block goes to from the caret: as `insertPosAfter`, for the caret's block. Null at depth 0. */
export function caretInsertPos(state: EditorState): number | null {
  const $from = state.selection.$from;
  if ($from.depth === 0) return null;
  return anchorAt($from)?.end ?? null;
}
