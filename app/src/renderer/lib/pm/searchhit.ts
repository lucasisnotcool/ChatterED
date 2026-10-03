/**
 * **The search page's hit** (`docs/research/search.md` §5): the block a picked hit points at,
 * highlighted until another is picked.
 *
 * The same shape as `readaloud.ts`, and for the same reason: a highlight must never edit the
 * document. It is plugin state set by a transaction with no steps (nothing saved, nothing to
 * undo), held as the block's id and found again after every change rather than mapped.
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { blockPos } from '../../../shared/doc/schema.js';

export const SEARCH_HIT_CLASS = 'nd-search-hit';

interface HitState {
  blockId: string | null;
  decorations: DecorationSet;
}

export const searchHitKey = new PluginKey<HitState>('chattered:searchhit');

export function setSearchHit(tr: Transaction, blockId: string | null): Transaction {
  return tr.setMeta(searchHitKey, { blockId }).setMeta('addToHistory', false);
}

export function searchHitBlockId(state: EditorState): string | null {
  return searchHitKey.getState(state)?.blockId ?? null;
}

function decorate(doc: EditorState['doc'], blockId: string | null): DecorationSet {
  const target = blockId ? blockPos(doc, blockId) : null;
  if (!target) return DecorationSet.empty;
  return DecorationSet.create(doc, [Decoration.node(target.pos, target.pos + target.node.nodeSize, { class: SEARCH_HIT_CLASS })]);
}

export function searchHitPlugin(): Plugin<HitState> {
  return new Plugin<HitState>({
    key: searchHitKey,
    state: {
      init: (): HitState => ({ blockId: null, decorations: DecorationSet.empty }),
      apply(tr, value): HitState {
        const action = tr.getMeta(searchHitKey) as { blockId: string | null } | undefined;
        const blockId = action ? action.blockId : value.blockId;
        if (!action && !tr.docChanged) return value;
        if (blockId === null) return value.blockId === null ? value : { blockId: null, decorations: DecorationSet.empty };
        return { blockId, decorations: decorate(tr.doc, blockId) };
      },
    },
    props: {
      decorations: (state: EditorState) => searchHitKey.getState(state)?.decorations ?? null,
    },
  });
}
