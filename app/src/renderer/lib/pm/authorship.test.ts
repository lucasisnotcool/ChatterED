import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Mark, Slice, Fragment, type Node } from 'prosemirror-model';
import { authorMark, notesSchema } from '../../../shared/doc/schema.js';
import { AGENT_TR, authorship, insertedRanges, isLearnerInput, mergeRanges } from './authorship.js';

const NOW = 1_700_000_000_000;

function para(blockId: string, text: string, by: 'ingest' | 'ellie' | 'max' | 'user', editId: string | null = null): Node {
  return notesSchema.node(
    'paragraph',
    { blockId, pages: [1], reason: null, objectiveIds: [] },
    text.length > 0 ? [notesSchema.text(text, [authorMark(by, editId, 1)])] : [],
  );
}

function stateOf(...blocks: Node[]): EditorState {
  return EditorState.create({
    doc: notesSchema.node('doc', null, blocks),
    plugins: [authorship({ now: () => NOW })],
  });
}

/** The `author.by` of the character at `pos` (1-based document position of a text offset). */
function authorAt(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos);
  const node = $pos.parent.childAfter($pos.parentOffset).node;
  const mark = node?.marks.find((m) => m.type.name === 'author');
  return mark ? (mark.attrs.by as string) : null;
}

function textOf(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, '\n');
}

describe('mergeRanges', () => {
  it('folds overlapping and abutting ranges', () => {
    expect(mergeRanges([{ from: 5, to: 9 }, { from: 1, to: 3 }, { from: 3, to: 6 }])).toEqual([
      { from: 1, to: 9 },
    ]);
  });

  it('keeps disjoint ranges apart', () => {
    expect(mergeRanges([{ from: 1, to: 3 }, { from: 7, to: 9 }])).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ]);
  });
});

describe('insertedRanges', () => {
  it('reports one insertion in the positions of the document that is left behind', () => {
    const state = stateOf(para('b_a', 'Value iteration.', 'ellie'));
    const tr = state.tr.insertText('!', 6);
    expect(insertedRanges([tr])).toEqual([{ from: 6, to: 7 }]);
  });

  it('maps an early insertion forward through a later one in the same transaction', () => {
    const state = stateOf(para('b_a', 'abcdef', 'ellie'));
    const tr = state.tr.insertText('XY', 6).insertText('Z', 2);
    // 'a' Z 'bcd' XY 'ef' — the first insertion has been pushed one to the right.
    const ranges = insertedRanges([tr]);
    expect(ranges).toEqual([{ from: 2, to: 3 }, { from: 7, to: 9 }]);
  });

  it('ignores a pure deletion', () => {
    const state = stateOf(para('b_a', 'abcdef', 'ellie'));
    expect(insertedRanges([state.tr.delete(2, 4)])).toEqual([]);
  });

  it('reports the new half of a replacement, not the old one', () => {
    const state = stateOf(para('b_a', 'abcdef', 'ellie'));
    const tr = state.tr.insertText('XYZ', 2, 4);
    expect(insertedRanges([tr])).toEqual([{ from: 2, to: 5 }]);
  });
});

describe('isLearnerInput', () => {
  it('is true for a plain typed transaction', () => {
    const state = stateOf(para('b_a', 'abc', 'ellie'));
    expect(isLearnerInput(state.tr.insertText('d', 4))).toBe(true);
  });

  it('is false for an agent transaction, a programmatic one and an undo', () => {
    const state = stateOf(para('b_a', 'abc', 'ellie'));
    expect(isLearnerInput(state.tr.insertText('d', 4).setMeta(AGENT_TR, true))).toBe(false);
    expect(isLearnerInput(state.tr.insertText('d', 4).setMeta('addToHistory', false))).toBe(false);
    expect(isLearnerInput(state.tr.insertText('d', 4).setMeta('history$', { redo: false }))).toBe(false);
  });

  it('is false for a selection-only transaction', () => {
    const state = stateOf(para('b_a', 'abc', 'ellie'));
    expect(isLearnerInput(state.tr.scrollIntoView())).toBe(false);
  });
});

describe('the authorship plugin', () => {
  it('stamps a character typed in the MIDDLE of an agent span as the learner', () => {
    // The dangerous case: `inclusive: false` does not help here, because a position inside a
    // span inherits that span's marks. Without the plugin this character would be Ellie's.
    const before = stateOf(para('b_a', 'Value iteration.', 'ellie'));
    const after = before.apply(before.tr.insertText('X', 6));
    expect(textOf(after)).toBe('ValueX iteration.');
    expect(authorAt(after, 6)).toBe('user');
    expect(authorAt(after, 1)).toBe('ellie');
    expect(authorAt(after, 8)).toBe('ellie');
  });

  it('stamps text typed at the end of an agent span, where no mark is inherited at all', () => {
    const before = stateOf(para('b_a', 'Value iteration.', 'ellie'));
    const after = before.apply(before.tr.insertText(' Mine.', 17));
    expect(authorAt(after, 18)).toBe('user');
  });

  it('stamps a paste that arrives with no author mark of its own', () => {
    const before = stateOf(para('b_a', 'abc', 'ellie'));
    const pasted = Slice.maxOpen(Fragment.from(notesSchema.text('pasted')));
    const after = before.apply(before.tr.replace(4, 4, pasted));
    expect(textOf(after)).toBe('abcpasted');
    expect(authorAt(after, 4)).toBe('user');
  });

  it('leaves an agent transaction alone', () => {
    const before = stateOf(para('b_a', 'abc', 'ellie'));
    const tr = before.tr
      .insert(4, notesSchema.text(' and more', [authorMark('ellie', 'e_1', 2)]))
      .setMeta(AGENT_TR, true);
    const after = before.apply(tr);
    expect(authorAt(after, 5)).toBe('ellie');
  });

  it('leaves an undo alone, so an agent sentence is not transferred to the learner', () => {
    const before = stateOf(para('b_a', 'abc', 'ellie'));
    const tr = before.tr
      .insert(4, notesSchema.text('def', [authorMark('ellie', null, 2)]))
      .setMeta('history$', { redo: false });
    const after = before.apply(tr);
    expect(authorAt(after, 5)).toBe('ellie');
  });

  it('mints a fresh blockId when Enter splits a paragraph, so no two blocks share one', () => {
    const before = stateOf(para('b_a', 'first second', 'ellie'));
    const after = before.apply(before.tr.split(7));
    const ids: string[] = [];
    after.doc.forEach((node) => ids.push(node.attrs.blockId as string));
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe('b_a');
    expect(ids[1]).toMatch(/^b_[0-9a-f]{12}$/);
  });

  it('mints ids for pasted blocks that arrived with none', () => {
    const before = stateOf(para('b_a', 'abc', 'ellie'));
    const fresh = notesSchema.node('paragraph', {}, notesSchema.text('pasted block'));
    const after = before.apply(before.tr.insert(5, fresh));
    const ids: string[] = [];
    after.doc.forEach((node) => ids.push(node.attrs.blockId as string));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it('stores the learner author mark at the cursor, so an IME composition starts out theirs', () => {
    const before = stateOf(para('b_a', 'Value iteration.', 'ellie'));
    // Put the cursor in the middle of Ellie's span, as a click would.
    const after = before.apply(before.tr.setSelection(TextSelection.create(before.doc, 6)));
    const stored = after.storedMarks ?? [];
    const author = stored.find((m) => m.type.name === 'author');
    expect(author?.attrs.by).toBe('user');
  });

  it('keeps the other marks at the cursor when it stores the author mark', () => {
    const doc = notesSchema.node('doc', null, [
      notesSchema.node(
        'paragraph',
        { blockId: 'b_a', pages: [1], reason: null, objectiveIds: [] },
        notesSchema.text('bold', [authorMark('ellie', null, 1), notesSchema.marks.strong!.create()]),
      ),
    ]);
    const before = EditorState.create({ doc, plugins: [authorship({ now: () => NOW })] });
    const after = before.apply(before.tr.setSelection(TextSelection.create(before.doc, 3)));
    const names = (after.storedMarks ?? []).map((m) => m.type.name).sort();
    expect(names).toEqual(['author', 'strong']);
  });

  it('stores a mark with a fixed `at`, so two cursor moves converge instead of churning', () => {
    // A timestamp on the stored mark would make it compare unequal on every single cursor move,
    // and the plugin would append a transaction forever. The real `at` is written by the stamp.
    const before = stateOf(para('b_a', 'abcdef', 'user'));
    const first = before.apply(before.tr.setSelection(TextSelection.create(before.doc, 3)));
    const second = first.apply(first.tr.setSelection(TextSelection.create(first.doc, 4)));
    expect(Mark.sameSet(second.storedMarks ?? [], first.storedMarks ?? [])).toBe(true);
    expect((first.storedMarks ?? []).find((m) => m.type.name === 'author')?.attrs.at).toBe(0);
  });

  it('reports the learner edit exactly once per transaction that changed the doc', () => {
    const seen: number[] = [];
    const state = EditorState.create({
      doc: notesSchema.node('doc', null, [para('b_a', 'abc', 'ellie')]),
      plugins: [authorship({ now: () => NOW, onLearnerEdit: (at) => seen.push(at) })],
    });
    const next = state.apply(state.tr.insertText('d', 4));
    next.apply(next.tr.scrollIntoView());
    expect(seen).toEqual([NOW]);
  });
});
