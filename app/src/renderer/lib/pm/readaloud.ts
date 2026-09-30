/**
 * **The block being read aloud** (`../readaloud.ts`, 2026-10-01).
 *
 * A node decoration — a class on the block — and nothing else. Reading aloud must never edit the
 * document, so the highlight is not a mark and not an attr: it is plugin state, set by a
 * transaction that carries **no steps**. That is what keeps it out of everything that watches for
 * a change: `tr.docChanged` is false, so `docstore.onTransaction` schedules no save and the
 * authorship plugin stamps nothing, and with no steps there is nothing for history to record
 * (`addToHistory: false` is set as well, to say so).
 *
 * The state is the block's **id**, not its position: the learner may keep typing above the block
 * being read, and an id is found again where a position would have to be mapped.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { blockPos } from '../../../shared/doc/schema.js';

export const READING_CLASS = 'nd-reading';

export interface ReadingState {
  blockId: string | null;
  decorations: DecorationSet;
}

export const readAloudKey = new PluginKey<ReadingState>('chattered:readaloud');

/** A steps-free transaction that moves the highlight to `blockId`, or clears it with null. */
export function setReading(tr: Transaction, blockId: string | null): Transaction {
  return tr.setMeta(readAloudKey, { blockId }).setMeta('addToHistory', false);
}

/** The id of the block highlighted as being read, or null. */
export function readingBlockId(state: EditorState): string | null {
  return readAloudKey.getState(state)?.blockId ?? null;
}

function decorate(state: { doc: EditorState['doc'] }, blockId: string | null): DecorationSet {
  const target = blockId ? blockPos(state.doc, blockId) : null;
  if (!target) return DecorationSet.empty;
  return DecorationSet.create(state.doc, [
    Decoration.node(target.pos, target.pos + target.node.nodeSize, { class: READING_CLASS }),
  ]);
}

export function readAloudPlugin(): Plugin<ReadingState> {
  return new Plugin<ReadingState>({
    key: readAloudKey,
    state: {
      init(): ReadingState {
        return { blockId: null, decorations: DecorationSet.empty };
      },
      apply(tr, value): ReadingState {
        const action = tr.getMeta(readAloudKey) as { blockId: string | null } | undefined;
        const blockId = action ? action.blockId : value.blockId;
        if (!action && !tr.docChanged) return value;
        if (blockId === null) {
          return value.blockId === null ? value : { blockId: null, decorations: DecorationSet.empty };
        }
        // Found again by id rather than mapped: a split or a join of the block being read would
        // leave a mapped node decoration on a range that is no longer one node.
        return { blockId, decorations: decorate(tr, blockId) };
      },
    },
    props: {
      decorations(state: EditorState) {
        return readAloudKey.getState(state)?.decorations ?? null;
      },
    },
  });
}
