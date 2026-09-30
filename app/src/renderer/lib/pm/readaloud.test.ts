import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';
import { history, undo, undoDepth } from 'prosemirror-history';
import { authorMark, notesSchema } from '../../../shared/doc/schema.js';
import { READING_CLASS, readAloudKey, readAloudPlugin, readingBlockId, setReading } from './readaloud.js';

const attrs = (blockId: string) => ({ blockId, pages: [2], reason: null, objectiveIds: [] });

function para(blockId: string, text: string): Node {
  return notesSchema.node('paragraph', attrs(blockId), notesSchema.text(text, [authorMark('ingest', null, 1)]));
}

function stateOf(...blocks: Node[]): EditorState {
  return EditorState.create({
    doc: notesSchema.node('doc', null, blocks),
    plugins: [history(), readAloudPlugin()],
  });
}

/** The highlighted ranges, as `[from, to, class]`. */
function highlights(state: EditorState): [number, number, string][] {
  const set = readAloudKey.getState(state)!.decorations as DecorationSet;
  return set.find().map((d) => [d.from, d.to, (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class]);
}

describe('the read-aloud highlight', () => {
  it('starts with nothing highlighted', () => {
    const state = stateOf(para('a', 'One'), para('b', 'Two'));
    expect(readingBlockId(state)).toBeNull();
    expect(highlights(state)).toEqual([]);
  });

  it('puts a class on the block with the id, and moves and clears it', () => {
    let state = stateOf(para('a', 'One'), para('b', 'Two'));
    state = state.apply(setReading(state.tr, 'b'));
    expect(readingBlockId(state)).toBe('b');
    expect(highlights(state)).toEqual([[5, 10, READING_CLASS]]);

    state = state.apply(setReading(state.tr, 'a'));
    expect(highlights(state)).toEqual([[0, 5, READING_CLASS]]);

    state = state.apply(setReading(state.tr, null));
    expect(readingBlockId(state)).toBeNull();
    expect(highlights(state)).toEqual([]);
  });

  it('never changes the document, so nothing is saved and nothing is undoable', () => {
    const state = stateOf(para('a', 'One'), para('b', 'Two'));
    const tr = setReading(state.tr, 'b');
    // `docstore.onTransaction(tr.docChanged)` is what schedules a save.
    expect(tr.docChanged).toBe(false);
    expect(tr.steps.length).toBe(0);
    const next = state.apply(tr);
    expect(next.doc).toBe(state.doc);
    expect(next.doc.toJSON()).toEqual(state.doc.toJSON());
    expect(undoDepth(next)).toBe(0);
    expect(undo(next)).toBe(false);
  });

  it('stays on the block while the learner types above it', () => {
    let state = stateOf(para('a', 'One'), para('b', 'Two'));
    state = state.apply(setReading(state.tr, 'b'));
    state = state.apply(state.tr.insertText('Zero and ', 1));
    expect(highlights(state)).toEqual([[14, 19, READING_CLASS]]);
    // Undo takes the typing back and leaves the highlight where it is.
    let undone = state;
    undo(state, (tr) => {
      undone = state.apply(tr);
    });
    expect(undone.doc.textContent).toBe('OneTwo');
    expect(readingBlockId(undone)).toBe('b');
    expect(highlights(undone)).toEqual([[5, 10, READING_CLASS]]);
  });

  it('highlights nothing for an id that is not in the document, or has been deleted', () => {
    let state = stateOf(para('a', 'One'), para('b', 'Two'));
    state = state.apply(setReading(state.tr, 'nope'));
    expect(highlights(state)).toEqual([]);

    state = state.apply(setReading(state.tr, 'b'));
    state = state.apply(state.tr.delete(5, 10));
    expect(highlights(state)).toEqual([]);
  });

  it('finds a list item inside its list', () => {
    const item = notesSchema.node('list_item', { blockId: 'li' }, para('li_p', 'Point'));
    let state = stateOf(notesSchema.node('bullet_list', attrs('l'), [item]));
    state = state.apply(setReading(state.tr, 'li'));
    expect(highlights(state)).toEqual([[1, 1 + item.nodeSize, READING_CLASS]]);
  });
});
