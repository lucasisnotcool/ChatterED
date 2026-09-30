/**
 * Where the header's **Insert** lands (2026-10-01): the top-level block that holds the selection.
 *
 * Main is given that block's id (`notesGenerateBlock`), reads the section it belongs to, and puts
 * Ellie's table or diagram after it. Top-level, as `insertOwnQuestion` is, so a table asked for
 * with the cursor inside a Q block goes after the question rather than into it; `$to`, as there,
 * so a selection that runs over several blocks inserts after the last of them.
 */

import type { EditorState } from 'prosemirror-state';
import { blockAttrs } from '../../../shared/doc/schema.js';

/** The id of the top-level block at the end of the selection, or null when it has none yet. */
export function insertTargetId(state: EditorState): string | null {
  const to = state.selection.$to;
  // Depth 0 is a selection that ends between top-level blocks: a figure selected as a node, a gap
  // cursor, select-all. The block just before it is the place, as in `insertOwnQuestion`.
  const node = to.depth >= 1 ? to.node(1) : (to.nodeBefore ?? to.nodeAfter);
  if (!node) return null;
  return blockAttrs(node).blockId || null;
}
