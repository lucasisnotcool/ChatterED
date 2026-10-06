import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { blockPos, notesSchema } from '../../../shared/doc/schema.js';
import { caretInsertPos, insertPosAfter, insertTargetId } from './insertat.js';

function para(blockId: string, text: string): Node {
  return notesSchema.node('paragraph', { blockId, pages: [3], reason: null, objectiveIds: [] }, [notesSchema.text(text)]);
}

/** p0 · card c1 (core c1p; example i1 [i1a, list l1 [li1 → li1p]]) · p1 · Q block q (qp). */
function sample(): Node {
  const list = notesSchema.node('bullet_list', { blockId: 'l1', pages: [3], reason: null, objectiveIds: [] }, [
    notesSchema.node('list_item', { blockId: 'li1', pages: [], reason: null, objectiveIds: [] }, [para('li1p', 'A bullet.')]),
  ]);
  const card = notesSchema.node('concept', { blockId: 'c1', term: 'Gradient', pages: [3], reason: null, objectiveIds: [] }, [
    para('c1p', 'Gradient: steepest ascent.'),
    notesSchema.node('concept_item', { blockId: 'i1', role: 'example', pages: [3], reason: null, objectiveIds: [] }, [
      para('i1a', 'For x squared it is 2x.'),
      list,
    ]),
  ]);
  const q = notesSchema.node('q_block', { blockId: 'q', pages: [3], reason: null, objectiveIds: [], questionId: 'q_1' }, [para('qp', 'Why?')]);
  return notesSchema.node('doc', null, [para('p0', 'Before.'), card, para('p1', 'After.'), q]);
}

function at(doc: Node, blockId: string): { pos: number; end: number } {
  const hit = blockPos(doc, blockId)!;
  return { pos: hit.pos, end: hit.pos + hit.node.nodeSize };
}

function caretIn(doc: Node, blockId: string): EditorState {
  return EditorState.create({ doc, selection: TextSelection.create(doc, at(doc, blockId).pos + 2) });
}

describe('Insert in a concept card (notebooks.md §11.2, as the ops place it)', () => {
  const doc = sample();

  it('names the item’s block from the depth, and the card from the core line', () => {
    expect(insertTargetId(caretIn(doc, 'i1a'))).toBe('i1a');
    expect(insertTargetId(caretIn(doc, 'li1p'))).toBe('l1');
    expect(insertTargetId(caretIn(doc, 'c1p'))).toBe('c1');
  });

  it('is unchanged outside a card: the top-level block', () => {
    expect(insertTargetId(caretIn(doc, 'p1'))).toBe('p1');
    expect(insertTargetId(caretIn(doc, 'qp'))).toBe('q');
  });

  it('puts a block after an item’s block inside the item, and after the card from its core line', () => {
    expect(insertPosAfter(doc, 'i1a')).toBe(at(doc, 'i1a').end);
    expect(insertPosAfter(doc, 'li1p')).toBe(at(doc, 'l1').end);
    expect(insertPosAfter(doc, 'c1p')).toBe(at(doc, 'c1').end);
    expect(insertPosAfter(doc, 'i1')).toBe(at(doc, 'c1').end);
    expect(insertPosAfter(doc, 'c1')).toBe(at(doc, 'c1').end);
    expect(insertPosAfter(doc, 'qp')).toBe(at(doc, 'q').end);
    expect(insertPosAfter(doc, 'p0')).toBe(at(doc, 'p0').end);
    expect(insertPosAfter(doc, 'nope')).toBeNull();
  });

  it('places from the caret the same way, and the result is a valid place for an image line', () => {
    expect(caretInsertPos(caretIn(doc, 'i1a'))).toBe(at(doc, 'i1a').end);
    expect(caretInsertPos(caretIn(doc, 'c1p'))).toBe(at(doc, 'c1').end);
    expect(caretInsertPos(caretIn(doc, 'p1'))).toBe(at(doc, 'p1').end);
    for (const id of ['i1a', 'li1p', 'c1p', 'p0']) {
      const pos = insertPosAfter(doc, id)!;
      const state = EditorState.create({ doc });
      expect(() => state.tr.insert(pos, para('new', 'A figure line.'))).not.toThrow();
    }
  });
});
