/**
 * **The guard, against hand-built transactions** (§5.4).
 *
 * Hand-built on purpose: `ops.ts` is one caller of the guard, and if the only transactions the
 * guard ever saw were the ones `ops.ts` builds, the suite would be testing that two files agree
 * rather than that the rule holds. These are the transactions an editor actually produces — a
 * delete, a replace that straddles a boundary, an insertion pressed against learner text, a
 * move, a paste over a selection — expressed with `tr.delete` / `tr.insert` / `tr.replaceWith`
 * exactly as a command would.
 */

import { describe, expect, it } from 'vitest';
import { diagram, docOf, fixtureDoc, mixed, para, stateOf, table } from './fixture.test-support.js';
import { isLearnerRange, learnerConflicts } from './guard.js';
import { inlineToNodes } from './inline.js';
import { blockPos, notesSchema } from './schema.js';

/** The fixture's learner run: "I think it converges because of the contraction." */
function learnerRange(): { from: number; to: number; doc: ReturnType<typeof fixtureDoc> } {
  const doc = fixtureDoc();
  const text = 'I think it converges because of the contraction.';
  let from = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) from = pos;
    return true;
  });
  return { doc, from, to: from + text.length };
}

describe('isLearnerRange', () => {
  it('is true for any range holding learner text, false for one that holds none', () => {
    const { doc, from, to } = learnerRange();
    expect(isLearnerRange(doc, from, to)).toBe(true);
    expect(isLearnerRange(doc, from + 4, from + 9)).toBe(true); // a word of it
    expect(isLearnerRange(doc, from - 3, from + 1)).toBe(true); // one character of it
    expect(isLearnerRange(doc, 0, 10)).toBe(false); // the title
    expect(isLearnerRange(doc, from, from)).toBe(false); // an empty range
  });
});

describe('learnerConflicts', () => {
  it('reports a delete over learner text, in pre-transaction positions', () => {
    const { doc, from, to } = learnerRange();
    const state = stateOf(doc);
    const tr = state.tr.delete(from + 2, to - 2);
    const conflicts = learnerConflicts(state, tr);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.blockId).toBe('b_mix');
    expect(conflicts[0]!.from).toBe(from + 2);
    expect(conflicts[0]!.to).toBe(to - 2);
    expect(state.doc.textBetween(conflicts[0]!.from, conflicts[0]!.to)).toBe(conflicts[0]!.text);
  });

  it('reports a replacement that straddles the boundary, clipped to the learner half', () => {
    const { doc, from, to } = learnerRange();
    const state = stateOf(doc);
    // Ellie rewrites from inside her own sentence to inside the learner's.
    const tr = state.tr.replaceWith(from - 6, from + 12, inlineToNodes(notesSchema, 'Rewritten.', 'ellie', 'e_1', 1));
    const conflicts = learnerConflicts(state, tr);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.from).toBe(from);
    expect(conflicts[0]!.to).toBe(from + 12);
    expect(conflicts[0]!.to).toBeLessThan(to);
  });

  it('does not report a pure insertion, even pressed right against learner text', () => {
    const { doc, from, to } = learnerRange();
    const state = stateOf(doc);
    for (const at of [from, from + 5, to]) {
      const tr = state.tr.insert(at, inlineToNodes(notesSchema, ' Ellie adds.', 'ellie', 'e_1', 1));
      expect(learnerConflicts(state, tr)).toEqual([]);
    }
  });

  it('does not report an edit that only touches agent text', () => {
    const doc = fixtureDoc();
    const state = stateOf(doc);
    const block = state.doc.child(1);
    const tr = state.tr.delete(2 + 1, 2 + 1 + block.content.size - 1);
    expect(learnerConflicts(state, tr)).toEqual([]);
  });

  it('reports a move on its delete half — "never moved" is in the rule', () => {
    const { doc, from, to } = learnerRange();
    const state = stateOf(doc);
    const slice = state.doc.slice(from, to);
    const tr = state.tr.delete(from, to);
    tr.insert(2, slice.content); // dropped into the first paragraph instead
    const conflicts = learnerConflicts(state, tr);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.text).toContain('I think it converges');
  });

  it('reports every learner run a multi-step transaction touches, once each', () => {
    const doc = docOf(
      mixed('b_a', [
        { text: 'Ellie. ', by: 'ellie', editId: 'e_1' },
        { text: 'Mine A.', by: 'user' },
      ]),
      mixed('b_b', [
        { text: 'Mine B.', by: 'user' },
        { text: ' Ellie.', by: 'ellie', editId: 'e_1' },
      ]),
    );
    const state = stateOf(doc);
    const tr = state.tr;
    // Back to front, the way a multi-block rewrite has to go.
    tr.delete(doc.child(0).nodeSize + 1, doc.child(0).nodeSize + 1 + 7);
    tr.delete(1 + 7, 1 + 7 + 7);
    const conflicts = learnerConflicts(state, tr);
    expect(conflicts.map((c) => c.text)).toEqual(['Mine A.', 'Mine B.']);
    expect(conflicts.map((c) => c.blockId)).toEqual(['b_a', 'b_b']);
  });

  it('reports a whole-block delete that takes learner text with it', () => {
    const doc = fixtureDoc();
    const state = stateOf(doc);
    let pos = 0;
    doc.forEach((node, offset) => {
      if (node.attrs.blockId === 'b_mix') pos = offset;
    });
    const tr = state.tr.delete(pos, pos + doc.child(4).nodeSize);
    expect(learnerConflicts(state, tr)).toHaveLength(1);
  });

  it('says nothing about a transaction with no steps', () => {
    const state = stateOf(fixtureDoc());
    expect(learnerConflicts(state, state.tr)).toEqual([]);
  });

  it('ignores a mark change: adding a mark deletes nothing', () => {
    const { doc, from, to } = learnerRange();
    const state = stateOf(doc);
    const tr = state.tr.addMark(from, to, notesSchema.marks.suggest_del!.create({ suggestionId: 'sg_1', by: 'max' }));
    expect(learnerConflicts(state, tr)).toEqual([]);
  });

  it('protects learner text wherever it is — inside a q_block too', () => {
    const q = notesSchema.nodes.q_block!.create(
      { blockId: 'b_q', questionId: 'q1', pages: [], reason: 'quiz', objectiveIds: [] },
      [para('b_qp', 'Why?', 'max', 'e_1'), mixed('b_ans', [{ text: 'Because of the contraction.', by: 'user' }])],
    );
    const doc = docOf(para('b_1', 'Before.'), q);
    const state = stateOf(doc);
    const tr = state.tr.delete(0, doc.content.size);
    const conflicts = learnerConflicts(state, tr);
    expect(conflicts.map((c) => c.text)).toEqual(['Because of the contraction.']);
    expect(conflicts[0]!.blockId).toBe('b_ans');
  });
});

// ── a table and a diagram the learner wrote in (2026-10-01) ─────────────────────────────────

describe('learnerConflicts — tables and diagrams', () => {
  const doc = () =>
    docOf(
      para('b_p', 'Before.', 'ingest', null, [4]),
      table('b_tab', ['Method', 'Cost'], [['Value iteration', [{ text: 'a sweep per step', by: 'user' }]]]),
      diagram('b_dia', [
        { id: 'n1', label: 'Observe' },
        { id: 'n2', label: [{ text: 'then I act', by: 'user' }] },
      ]),
      table('b_agents', ['A', 'B'], [['1', '2']]),
    );

  it('reports the learner’s cell, against the table, when the whole table would go', () => {
    const state = stateOf(doc());
    const target = blockPos(state.doc, 'b_tab')!;
    const conflicts = learnerConflicts(state, state.tr.delete(target.pos, target.pos + target.node.nodeSize));
    expect(conflicts).toEqual([expect.objectContaining({ blockId: 'b_tab', text: 'a sweep per step' })]);
  });

  it('reports the learner’s label when the diagram is replaced by something else', () => {
    const state = stateOf(doc());
    const target = blockPos(state.doc, 'b_dia')!;
    const tr = state.tr.replaceWith(target.pos, target.pos + target.node.nodeSize, para('b_new', 'A sentence instead.', 'ellie', 'e_1'));
    expect(learnerConflicts(state, tr)).toEqual([expect.objectContaining({ blockId: 'b_dia', text: 'then I act' })]);
  });

  it('reports a cut inside the learner’s cell, clipped to what was cut', () => {
    const state = stateOf(doc());
    let from = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'a sweep per step') from = pos;
      return true;
    });
    expect(isLearnerRange(state.doc, from, from + 1)).toBe(true);
    expect(learnerConflicts(state, state.tr.delete(from + 2, from + 7))).toEqual([
      expect.objectContaining({ blockId: 'b_tab', text: 'sweep' }),
    ]);
  });

  it('lets a table only the agents wrote go, and lets an agent write in the cell next to the learner’s', () => {
    const state = stateOf(doc());
    const agents = blockPos(state.doc, 'b_agents')!;
    expect(learnerConflicts(state, state.tr.delete(agents.pos, agents.pos + agents.node.nodeSize))).toEqual([]);

    let at = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Value iteration') at = pos + node.nodeSize;
      return true;
    });
    const tr = state.tr.insert(at, inlineToNodes(notesSchema, ' (exact)', 'ellie', 'e_1'));
    expect(learnerConflicts(state, tr)).toEqual([]);
  });
});
