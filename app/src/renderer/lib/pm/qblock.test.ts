import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { authorMark, blockPos, learnerSpans, notesSchema } from '../../../shared/doc/schema.js';
import type { DocAuthor } from '../../../shared/doc/types.js';
import { authorship } from './authorship.js';
import {
  OWN_QUESTION_REASON,
  answerTarget,
  insertOwnQuestion,
  isRailQuestion,
  isSelfCheck,
  newQuestionId,
  questionParts,
  selfCheckLabel,
  selfCheckLine,
  startAnswer,
} from './qblock.js';

type Span = { text: string; by: DocAuthor };

function para(blockId: string, spans: Span[], pages: number[] = [3]): Node {
  return notesSchema.node(
    'paragraph',
    { blockId, pages, reason: null, objectiveIds: [] },
    spans.map((s) => notesSchema.text(s.text, [authorMark(s.by, null, 1)])),
  );
}

function qBlock(children: Node[], attrs: Record<string, unknown> = {}): Node {
  return notesSchema.node(
    'q_block',
    { blockId: 'b_q', pages: [3], reason: null, objectiveIds: ['o_1'], questionId: 'q_1', ...attrs },
    children,
  );
}

const QUESTION = para('b_qp', [{ text: 'Why does it converge?', by: 'max' }]);

function stateOf(...blocks: Node[]): EditorState {
  return EditorState.create({ doc: notesSchema.node('doc', null, blocks), plugins: [authorship({ now: () => 5 })] });
}

function run(state: EditorState, command: typeof insertOwnQuestion): EditorState {
  let next = state;
  const done = command(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  expect(done).toBe(true);
  return next;
}

describe('newQuestionId', () => {
  it('is q_ and twelve hex characters, like a block id', () => {
    expect(newQuestionId()).toMatch(/^q_[0-9a-f]{12}$/);
  });
});

describe('questionParts', () => {
  it('reads the first child as the question and finds no answer in a fresh block', () => {
    expect(questionParts(qBlock([QUESTION]))).toEqual({
      question: 'Why does it converge?',
      answerBlockId: null,
      answer: '',
    });
  });

  it('takes the learner text under the question as the answer, and names its block', () => {
    const q = qBlock([QUESTION, para('b_a', [{ text: 'Because the update contracts.', by: 'user' }])]);
    expect(questionParts(q)).toEqual({
      question: 'Why does it converge?',
      answerBlockId: 'b_a',
      answer: 'Because the update contracts.',
    });
  });

  it('never counts what an agent wrote under the question', () => {
    const q = qBlock([
      QUESTION,
      para('b_max', [{ text: 'The Bellman update is a contraction in the max norm.', by: 'max' }]),
      para('b_ellie', [{ text: 'See p. 12.', by: 'ellie' }]),
    ]);
    expect(questionParts(q)).toMatchObject({ answerBlockId: null, answer: '' });
  });

  it('joins spans within a block by a space and blocks by a newline, skipping agent blocks', () => {
    const q = qBlock([
      QUESTION,
      para('b_max', [{ text: 'A resolution.', by: 'max' }]),
      para('b_a', [
        { text: 'It contracts', by: 'user' },
        { text: ' (Ellie: in the max norm) ', by: 'ellie' },
        { text: 'so it has a fixed point.', by: 'user' },
      ]),
      para('b_empty', []),
      para('b_b', [{ text: 'And gamma is below one.', by: 'user' }]),
    ]);
    expect(questionParts(q)).toMatchObject({
      answerBlockId: 'b_a',
      answer: 'It contracts so it has a fixed point.\nAnd gamma is below one.',
    });
  });

  it('merges learner runs that only a formatting mark split', () => {
    const bold = notesSchema.text('contracts', [notesSchema.marks.strong!.create(), authorMark('user', null, 1)]);
    const q = qBlock([
      QUESTION,
      notesSchema.node('paragraph', { blockId: 'b_a', pages: [3], reason: null, objectiveIds: [] }, [
        notesSchema.text('It ', [authorMark('user', null, 1)]),
        bold,
        notesSchema.text('.', [authorMark('user', null, 1)]),
      ]),
    ]);
    expect(questionParts(q).answer).toBe('It contracts.');
  });

  it('does not take a learner edit to the question itself for an answer', () => {
    const q = qBlock([para('b_qp', [{ text: 'Why does it ', by: 'max' }, { text: 'always converge?', by: 'user' }])]);
    expect(questionParts(q)).toEqual({ question: 'Why does it always converge?', answerBlockId: null, answer: '' });
  });

  it("reads a learner's own question the same way", () => {
    const q = qBlock(
      [
        para('b_qp', [{ text: 'What is a policy?', by: 'user' }]),
        para('b_a', [{ text: 'A map from states to actions.', by: 'user' }]),
      ],
      { askedBy: 'user' },
    );
    expect(questionParts(q)).toEqual({
      question: 'What is a policy?',
      answerBlockId: 'b_a',
      answer: 'A map from states to actions.',
    });
  });

  it('treats whitespace as no question and no answer', () => {
    const q = qBlock([para('b_qp', []), para('b_a', [{ text: '   ', by: 'user' }])], { askedBy: 'user' });
    expect(questionParts(q)).toEqual({ question: '', answerBlockId: null, answer: '' });
  });
});

describe('insertOwnQuestion', () => {
  const first = para('b_one', [{ text: 'First.', by: 'ingest' }], [4, 5]);
  const second = para('b_two', [{ text: 'Second.', by: 'ingest' }], [6]);

  it('inserts an open Q block of the learner after the block that holds the cursor', () => {
    const state = stateOf(first, second);
    const next = run(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3))), insertOwnQuestion);

    expect(next.doc.childCount).toBe(3);
    const q = next.doc.child(1);
    expect(q.type.name).toBe('q_block');
    expect(q.attrs).toMatchObject({
      askedBy: 'user',
      status: 'open',
      resolution: null,
      objectiveId: null,
      pages: [4, 5],
      reason: OWN_QUESTION_REASON,
    });
    expect(q.attrs.questionId).toMatch(/^q_[0-9a-f]{12}$/);
    expect(q.attrs.blockId).toMatch(/^b_[0-9a-f]{12}$/);
    // A copy, never the neighbour's own array.
    expect(q.attrs.pages).not.toBe(first.attrs.pages);

    expect(q.childCount).toBe(1);
    const p = q.firstChild!;
    expect(p.type.name).toBe('paragraph');
    expect(p.content.size).toBe(0);
    expect(p.attrs.blockId).toMatch(/^b_[0-9a-f]{12}$/);
    expect(p.attrs.blockId).not.toBe(q.attrs.blockId);

    // The cursor is in that paragraph.
    expect(next.selection.empty).toBe(true);
    expect(next.selection.$from.parent).toBe(p);
  });

  it('makes what is typed there the learner’s own', () => {
    const state = stateOf(first, second);
    const withQ = run(state, insertOwnQuestion);
    const typed = withQ.applyTransaction(withQ.tr.insertText('What is a policy?')).state;
    const q = typed.doc.child(1);
    expect(questionParts(q).question).toBe('What is a policy?');
    expect(learnerSpans(typed.doc).map((s) => s.text)).toEqual(['What is a policy?']);
    expect(learnerSpans(typed.doc)[0]!.blockId).toBe(q.firstChild!.attrs.blockId);
  });

  it('goes after a whole Q block when the cursor is inside one, never into it', () => {
    const state = stateOf(first, qBlock([QUESTION]), second);
    const inQ = blockPos(state.doc, 'b_qp')!.pos + 2;
    const next = run(state.apply(state.tr.setSelection(TextSelection.create(state.doc, inQ))), insertOwnQuestion);
    expect(next.doc.childCount).toBe(4);
    expect(next.doc.child(1).attrs.questionId).toBe('q_1');
    expect(next.doc.child(1).childCount).toBe(1);
    expect(next.doc.child(2).attrs.askedBy).toBe('user');
    expect(next.doc.child(2).attrs.pages).toEqual([3]);
  });

  it('goes after a selected figure and takes its page', () => {
    const figure = notesSchema.node('slide_figure', { blockId: 'b_fig', page: 9 });
    const state = stateOf(first, figure, second);
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, blockPos(state.doc, 'b_fig')!.pos)));
    const next = run(selected, insertOwnQuestion);
    expect(next.doc.child(1).type.name).toBe('slide_figure');
    expect(next.doc.child(2).type.name).toBe('q_block');
    expect(next.doc.child(2).attrs.pages).toEqual([9]);
  });

  it('only says it can, and changes nothing, without a dispatch', () => {
    const state = stateOf(first);
    expect(insertOwnQuestion(state)).toBe(true);
    expect(state.doc.childCount).toBe(1);
  });
});

describe('startAnswer', () => {
  it('appends an empty paragraph as the last child and puts the cursor in it', () => {
    const resolution = para('b_max', [{ text: 'A resolution.', by: 'max' }]);
    const state = stateOf(qBlock([QUESTION, resolution]), para('b_after', [{ text: 'After.', by: 'ingest' }]));
    const tr = startAnswer(state, 0)!;
    const next = state.apply(tr);
    const q = next.doc.child(0);
    expect(q.childCount).toBe(3);
    const last = q.lastChild!;
    expect(last.content.size).toBe(0);
    expect(last.attrs.blockId).toMatch(/^b_[0-9a-f]{12}$/);
    expect(last.attrs.pages).toEqual([3]);
    expect(last.attrs.objectiveIds).toEqual(['o_1']);
    expect(next.selection.$from.parent).toBe(last);

    // What is typed there is the answer, and it is the learner's.
    const typed = next.applyTransaction(next.tr.insertText('Because it contracts.')).state;
    expect(questionParts(typed.doc.child(0))).toMatchObject({
      answerBlockId: last.attrs.blockId,
      answer: 'Because it contracts.',
    });
  });

  it('reuses a trailing empty paragraph instead of stacking another', () => {
    const state = stateOf(qBlock([QUESTION, para('b_blank', [])]));
    const tr = startAnswer(state, 0)!;
    expect(tr.docChanged).toBe(false);
    const next = state.apply(tr);
    expect(next.doc.child(0).childCount).toBe(2);
    expect(next.selection.$from.parent.attrs.blockId).toBe('b_blank');
  });

  it('does not mistake an empty QUESTION paragraph for the place to answer', () => {
    const state = stateOf(qBlock([para('b_qp', [])], { askedBy: 'user' }));
    const next = state.apply(startAnswer(state, 0)!);
    expect(next.doc.child(0).childCount).toBe(2);
    expect(next.selection.$from.parent).toBe(next.doc.child(0).lastChild);
  });

  it('is null when the position is not a Q block', () => {
    const state = stateOf(para('b_one', [{ text: 'First.', by: 'ingest' }]));
    expect(startAnswer(state, 0)).toBeNull();
  });
});

describe('answerTarget', () => {
  const answer = para('b_a', [{ text: 'Because it contracts.', by: 'user' }]);

  function at(state: EditorState, blockId: string): EditorState {
    const pos = blockPos(state.doc, blockId)!.pos + 1;
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  }

  it('finds the open Q block when the cursor is in its answer', () => {
    const state = at(stateOf(para('b_one', []), qBlock([QUESTION, answer])), 'b_a');
    const target = answerTarget(state);
    expect(target?.node.attrs.questionId).toBe('q_1');
    expect(state.doc.nodeAt(target!.pos)).toBe(target!.node);
  });

  it('is null in the question paragraph, in a resolved block, and outside any block', () => {
    expect(answerTarget(at(stateOf(qBlock([QUESTION, answer])), 'b_qp'))).toBeNull();
    expect(answerTarget(at(stateOf(qBlock([QUESTION, answer], { status: 'resolved' })), 'b_a'))).toBeNull();
    expect(answerTarget(at(stateOf(para('b_one', []), qBlock([QUESTION, answer])), 'b_one'))).toBeNull();
  });
});

describe('the self-check chip (D4, 2026-10-06)', () => {
  it('says "your answer" only when the learner earned it, and "revisit" for everything else', () => {
    expect(selfCheckLabel('you_got_this')).toBe('your answer');
    for (const resolution of ['partly_yours', 'released', 'revisit', null, undefined] as const) {
      expect(selfCheckLabel(resolution)).toBe('revisit');
    }
  });

  it("never says Max's old grading words", () => {
    const said = (['you_got_this', 'partly_yours', 'released', 'revisit', null] as const).map(selfCheckLabel);
    expect(said.join(' ')).not.toMatch(/got this|partly|released/i);
  });

  it("is a closed question of Max's, including an old doc's, and never the learner's own", () => {
    expect(isSelfCheck(qBlock([QUESTION], { status: 'resolved', resolution: 'you_got_this' }))).toBe(true);
    expect(isSelfCheck(qBlock([QUESTION], { status: 'resolved', resolution: null }))).toBe(true);
    expect(isSelfCheck(qBlock([QUESTION]))).toBe(false);
    expect(isSelfCheck(qBlock([QUESTION], { askedBy: 'user', status: 'resolved' }))).toBe(false);
    expect(isSelfCheck(para('b_one', []))).toBe(false);
  });

  it("puts Max's open question in the rail, and the learner's own nowhere but the text", () => {
    expect(isRailQuestion(qBlock([QUESTION]))).toBe(true);
    expect(isRailQuestion(qBlock([QUESTION], { askedBy: 'user' }))).toBe(false);
    expect(isRailQuestion(qBlock([QUESTION], { status: 'resolved' }))).toBe(false);
  });

  it("reads the question in one line, without an old block's chat preamble", () => {
    const old = para('b_old', [{ text: 'Max here. This one tests the statement, not you. Why does it converge?', by: 'max' }]);
    expect(selfCheckLine(qBlock([old], { status: 'resolved' }))).toBe('Why does it converge?');
    expect(selfCheckLine(qBlock([QUESTION], { status: 'resolved' }))).toBe('Why does it converge?');
  });
});
