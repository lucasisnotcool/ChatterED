import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { authorMark, notesSchema } from '../../../shared/doc/schema.js';
import { ATOM_COST } from '../typing.js';
import { revealPlan, revealText } from './reveal.js';

const attrs = (blockId: string) => ({ blockId, pages: [2], reason: null, objectiveIds: [] });

function para(blockId: string, text: string): Node {
  return notesSchema.node('paragraph', attrs(blockId), notesSchema.text(text, [authorMark('ellie', 'e_1', 1)]));
}

function mathBlock(blockId: string): Node {
  return notesSchema.node('math_block', { ...attrs(blockId), tex: 'V^*(s)' });
}

function docOf(...blocks: Node[]): Node {
  return notesSchema.node('doc', null, blocks);
}

/** The whole document as one reveal range. */
function whole(doc: Node) {
  return [{ from: 0, to: doc.content.size }];
}

describe('revealText', () => {
  it('is the text of the range', () => {
    const doc = docOf(para('b_a', 'Hello there'));
    expect(revealText(doc, whole(doc))).toBe('Hello there');
  });

  it('separates two paragraphs with a space, so they are not one enormous word', () => {
    const doc = docOf(para('b_a', 'one'), para('b_b', 'two'));
    expect(revealText(doc, whole(doc))).toBe('one two');
  });

  it('prices an atom at ATOM_COST and keeps it one word', () => {
    const doc = docOf(mathBlock('b_m'));
    const text = revealText(doc, whole(doc));
    expect(text.length).toBe(ATOM_COST);
    expect(text.trim().length).toBe(ATOM_COST - 1);
  });

  it('takes only the part of a text node inside the range', () => {
    const doc = docOf(para('b_a', 'abcdefgh'));
    expect(revealText(doc, [{ from: 3, to: 6 }])).toBe('cde');
  });
});

describe('revealPlan', () => {
  it('hides everything at revealed 0', () => {
    const doc = docOf(para('b_a', 'Hello'));
    const plan = revealPlan(doc, whole(doc), 0);
    // The whole paragraph is inside the range, so it is hidden as a block, not as text.
    expect(plan.blocks).toEqual([0]);
    expect(plan.inline).toEqual([]);
    expect(plan.frontier).toBe(0);
  });

  it('hides nothing once the whole edit is revealed', () => {
    const doc = docOf(para('b_a', 'Hello'));
    const plan = revealPlan(doc, whole(doc), 999);
    expect(plan.inline).toEqual([]);
    expect(plan.blocks).toEqual([]);
  });

  it('cuts a partially revealed paragraph at the right character', () => {
    const doc = docOf(para('b_a', 'Hello there'));
    const plan = revealPlan(doc, whole(doc), 5);
    // Text starts at position 1; five characters revealed ⇒ hide from 6 to the end of the text.
    expect(plan.inline).toEqual([{ from: 6, to: 12 }]);
    expect(plan.blocks).toEqual([]);
    expect(plan.frontier).toBe(6);
  });

  it('hides a later paragraph as a whole block while an earlier one is still being typed', () => {
    const doc = docOf(para('b_a', 'first'), para('b_b', 'second'));
    const plan = revealPlan(doc, whole(doc), 3);
    expect(plan.inline).toEqual([{ from: 4, to: 6 }]);
    // The second paragraph starts right after the first one closes.
    expect(plan.blocks).toEqual([7]);
    expect(plan.frontier).toBe(4);
  });

  it('reveals the first paragraph entirely and keeps the second hidden at the boundary', () => {
    const doc = docOf(para('b_a', 'first'), para('b_b', 'second'));
    // 'first' is 5 characters; the block-boundary space is not a document character, so the
    // block cost of paragraph one is exactly 5.
    const plan = revealPlan(doc, whole(doc), 5);
    expect(plan.inline).toEqual([]);
    expect(plan.blocks).toEqual([7]);
  });

  it('reveals an atom only once its whole cost is paid', () => {
    const doc = docOf(para('b_a', 'ab'), mathBlock('b_m'));
    expect(revealPlan(doc, whole(doc), 2).blocks).toEqual([4]);
    expect(revealPlan(doc, whole(doc), 2 + ATOM_COST).blocks).toEqual([]);
  });

  it('walks only the ranges it is given, and leaves the rest of the doc alone', () => {
    const doc = docOf(para('b_a', 'untouched'), para('b_b', 'agent wrote this'));
    const agent = [{ from: 11, to: doc.content.size }];
    const plan = revealPlan(doc, agent, 0);
    expect(plan.blocks).toEqual([11]);
    expect(plan.inline).toEqual([]);
  });
});
