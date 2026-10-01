/**
 * The commands for a deck, a quiz and an infographic (`blockfields.ts`), over a real
 * `EditorState` and no view, as `pm/diagram.test.ts` tests the diagram's.
 */
import { TextSelection, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { docOf, flashcards, infographic, para, quiz, stateOf } from '../../shared/doc/fixture.test-support.js';
import { blockPos, flashcardsSpec, infographicSpec, quizSpec } from '../../shared/doc/schema.js';
import {
  addItem,
  addOption,
  clearAcrossFields,
  deleteItem,
  fieldBlockAt,
  fieldRanges,
  guardFieldEdge,
  markCorrect,
  moveField,
  questionAt,
  removeOption,
  setBlockTitle,
  setInfographicLayout,
} from './blockfields.js';

function at(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/** The cursor at the end of field `n` of the block `id`. */
function inField(state: EditorState, id: string, n: number, where: 'start' | 'end' = 'end'): EditorState {
  const target = blockPos(state.doc, id)!;
  const range = fieldRanges(target.node, target.pos)[n]!;
  return at(state, where === 'end' ? range.to : range.from);
}

const deck = () => stateOf(docOf(flashcards('b_f', [['Front 1', 'Back 1', [4]], ['Front 2', 'Back 2']], { pages: [3] })));
const test = () =>
  stateOf(
    docOf(
      quiz('b_q', [
        { prompt: 'Pick one', options: [{ text: 'A', correct: true }, { text: 'B' }, { text: 'C' }], explain: 'Because A.' },
        { prompt: 'Say why', explain: 'Because.' },
      ]),
    ),
  );
const info = () =>
  stateOf(docOf(infographic('b_i', [{ value: '1', heading: 'One', body: 'x' }, { heading: 'Two', body: 'y' }], { layout: 'steps' })));

describe('where the cursor is', () => {
  it('finds the block, the item and every field in order', () => {
    const state = inField(deck(), 'b_f', 3, 'start');
    const hit = fieldBlockAt(state)!;
    expect(hit).toMatchObject({ name: 'flashcards', index: 1 });
    expect(fieldRanges(hit.block, hit.blockPos).map((r) => r.type)).toEqual([
      'flashcard_front', 'flashcard_back', 'flashcard_front', 'flashcard_back',
    ]);
  });

  it('finds nothing outside the three blocks', () => {
    expect(fieldBlockAt(stateOf(docOf(para('b_p', 'plain'))))).toBeNull();
  });
});

describe('moving', () => {
  it('Tab goes to the next field across items, and stops at the ends', () => {
    let state = inField(deck(), 'b_f', 1);
    const run = (dir: 1 | -1): boolean => moveField(dir)(state, (tr) => (state = state.apply(tr)));
    expect(run(1)).toBe(true);
    expect(state.selection.$from.parent.type.name).toBe('flashcard_front');
    expect(state.selection.$from.parent.textContent).toBe('Front 2');
    state = inField(state, 'b_f', 3);
    const before = state.selection.from;
    expect(run(1)).toBe(true);
    expect(state.selection.from).toBe(before);
    expect(run(-1)).toBe(true);
    expect(state.selection.$from.parent.textContent).toBe('Front 2');
  });

  it('is not taken outside a field of these blocks', () => {
    expect(moveField(1)(stateOf(docOf(para('b_p', 'plain'), flashcards('b_f', [['a', 'b']]))), undefined)).toBe(false);
  });
});

describe('deleting', () => {
  it('takes Backspace at a field’s start and Delete at its end, and nothing else', () => {
    const state = inField(deck(), 'b_f', 1, 'start');
    expect(guardFieldEdge('start')(state)).toBe(true);
    expect(guardFieldEdge('end')(state)).toBe(false);
    expect(guardFieldEdge('end')(inField(deck(), 'b_f', 1, 'end'))).toBe(true);
  });

  it('clears a selection across fields field by field, never merging them', () => {
    const state = deck();
    const target = blockPos(state.doc, 'b_f')!;
    const ranges = fieldRanges(target.node, target.pos);
    const tr = clearAcrossFields(state, ranges[0]!.from + 3, ranges[1]!.from + 2)!;
    const spec = flashcardsSpec(blockPos(tr.doc, 'b_f')!.node);
    expect(spec.cards.map((c) => [c.front, c.back])).toEqual([['Fro', 'ck 1'], ['Front 2', 'Back 2']]);
    expect(() => tr.doc.check()).not.toThrow();
  });

  it('leaves a selection inside one field to the ordinary delete', () => {
    const state = deck();
    const target = blockPos(state.doc, 'b_f')!;
    const r = fieldRanges(target.node, target.pos)[0]!;
    expect(clearAcrossFields(state, r.from + 1, r.from + 3)).toBeNull();
  });
});

describe('items', () => {
  it('adds a card after the one the cursor is in, with the block’s pages, and puts the cursor in it', () => {
    const state = inField(deck(), 'b_f', 0);
    const next = state.apply(addItem(state, blockPos(state.doc, 'b_f')!.pos)!);
    const node = blockPos(next.doc, 'b_f')!.node;
    expect(node.childCount).toBe(3);
    expect(node.child(1).attrs.pages).toEqual([3]);
    expect(flashcardsSpec(node).cards.map((c) => c.front)).toEqual(['Front 1', '', 'Front 2']);
    expect(next.selection.$from.parent.type.name).toBe('flashcard_front');
    expect(next.selection.$from.index(1)).toBe(1);
  });

  it('adds a short-answer question, a panel, and deletes all but the last item', () => {
    const q = test();
    const withQ = q.apply(addItem(q, blockPos(q.doc, 'b_q')!.pos)!);
    expect(quizSpec(blockPos(withQ.doc, 'b_q')!.node).questions.map((x) => x.type)).toEqual(['mc', 'short', 'short']);

    const i = info();
    const withPanel = i.apply(addItem(i, blockPos(i.doc, 'b_i')!.pos)!);
    expect(infographicSpec(blockPos(withPanel.doc, 'b_i')!.node).panels).toHaveLength(3);

    const d = deck();
    const pos = blockPos(d.doc, 'b_f')!.pos;
    const one = d.apply(deleteItem(d, pos, 0)!);
    expect(flashcardsSpec(blockPos(one.doc, 'b_f')!.node).cards.map((c) => c.front)).toEqual(['Front 2']);
    expect(deleteItem(one, blockPos(one.doc, 'b_f')!.pos, 0)).toBeNull();
    expect(() => one.doc.check()).not.toThrow();
  });

  it('sets a trimmed title, and an infographic’s layout', () => {
    const d = deck();
    const pos = blockPos(d.doc, 'b_f')!.pos;
    expect(blockPos(d.apply(setBlockTitle(d, pos, '  A  deck ')!).doc, 'b_f')!.node.attrs.title).toBe('A deck');
    expect(setBlockTitle(d, pos, '')).toBeNull();
    const i = info();
    const ipos = blockPos(i.doc, 'b_i')!.pos;
    expect(infographicSpec(blockPos(i.apply(setInfographicLayout(i, ipos, 'stats')!).doc, 'b_i')!.node).layout).toBe('stats');
    expect(setInfographicLayout(i, ipos, 'steps')).toBeNull();
    expect(setInfographicLayout(i, ipos, 'mindmap' as never)).toBeNull();
  });
});

describe('a quiz’s options', () => {
  it('knows which option the cursor is in', () => {
    const state = inField(test(), 'b_q', 2); // option B
    expect(questionAt(state)).toMatchObject({ option: 1 });
    expect(questionAt(inField(test(), 'b_q', 0))).toMatchObject({ option: null });
  });

  it('marks one option correct and clears the rest', () => {
    const state = inField(test(), 'b_q', 2);
    const next = state.apply(markCorrect(state)!);
    expect(quizSpec(blockPos(next.doc, 'b_q')!.node).questions[0]!.correct).toBe(1);
    expect(markCorrect(next)).toBeNull();
  });

  it('adds an option to a short question, making it multiple choice with that option the key', () => {
    const state = inField(test(), 'b_q', 5); // the second question's prompt
    const next = state.apply(addOption(state)!);
    const q = quizSpec(blockPos(next.doc, 'b_q')!.node).questions[1]!;
    expect(q).toMatchObject({ type: 'mc', options: [''], correct: 0 });
    expect(next.selection.$from.parent.type.name).toBe('quiz_option');
    expect(() => next.doc.check()).not.toThrow();
  });

  it('stops at six options', () => {
    let state = inField(test(), 'b_q', 0);
    for (let n = 0; n < 5; n++) {
      const tr = addOption(state);
      if (!tr) break;
      state = state.apply(tr);
    }
    expect(quizSpec(blockPos(state.doc, 'b_q')!.node).questions[0]!.options).toHaveLength(6);
    expect(addOption(state)).toBeNull();
  });

  it('removes an option, and a question with none left is short answer again', () => {
    let state = inField(test(), 'b_q', 1);
    state = state.apply(removeOption(state)!);
    expect(quizSpec(blockPos(state.doc, 'b_q')!.node).questions[0]!.options).toEqual(['B', 'C']);
    const one = stateOf(docOf(quiz('b_q', [{ prompt: 'p', options: [{ text: 'only', correct: true }], explain: 'e' }])));
    const at1 = inField(one, 'b_q', 1);
    const gone = at1.apply(removeOption(at1)!);
    expect(quizSpec(blockPos(gone.doc, 'b_q')!.node).questions[0]).toMatchObject({ type: 'short', options: [] });
    expect(() => gone.doc.check()).not.toThrow();
  });
});
