/**
 * **The ops, and the guard's contract as tests** (`app/docs/COLLAB-CONTRACT.md`, §5 of the brief).
 *
 * The six rules, each with its own `describe`:
 *
 *  1. `insert_after` / `insert_before` / `insert_q` / `resolve_q` never conflict.
 *  2. `replace_block` → suggestion · `remove_block` → dropped · `append_to_block` → relocated.
 *  3. Rejecting a suggestion leaves the learner's text byte-identical (`suggest.test.ts` owns the
 *     general case; here it is asserted end to end, through a real batch).
 *  4. `frozen` ⇒ `no_change`, nothing applied, nothing queued.
 *  5. An ingest window only ever appends.
 *  6. An agent may freely rewrite `ingest` / `ellie` / `max` text.
 */

import { describe, expect, it } from 'vitest';
import { docOf, fixtureDoc, heading, mixed, para, stateOf } from './fixture.test-support.js';
import { learnerConflicts } from './guard.js';
import {
  appendWindow,
  applyBatch,
  draftToNodes,
  keepEdit,
  removeEdit,
  type ApplyResult,
} from './ops.js';
import { blockAttrs, blockPos, emptyDoc, learnerSpans, notesSchema } from './schema.js';
import { rejectSuggestion } from './suggest.js';
import type { AgentDocOp, AgentDocOpBatch, DocBlockDraft } from './types.js';

const NOW = '2026-09-19T14:00:00.000Z';
const OPTS = { frozen: false, docId: 'doc_1', now: NOW };

function batchOf(ops: AgentDocOp[], extra: Partial<AgentDocOpBatch> = {}): AgentDocOpBatch {
  return {
    editId: 'e_new',
    author: 'ellie',
    cause: 'answer_missing',
    ops,
    focusBlockId: null,
    why: 'The learner asked and the doc did not say it.',
    ...extra,
  };
}

const P = (text: string, pages: number[] = [5]): DocBlockDraft => ({
  kind: 'paragraph',
  text,
  prov: { pages, reason: null },
});

/** Apply a batch to the fixture and hand back the result and the document it produced. */
function run(ops: AgentDocOp[], extra: Partial<AgentDocOpBatch> = {}, docNode = fixtureDoc()) {
  const state = stateOf(docNode);
  const result: ApplyResult = applyBatch(state, batchOf(ops, extra), OPTS);
  return { state, result, doc: result.tr ? state.apply(result.tr).doc : state.doc };
}

// ── rule 1: the adding ops never conflict ───────────────────────────────────────────────────

describe('rule 1 — the ops that only add', () => {
  it('insert_after puts the blocks after the anchor, authored and provenanced', () => {
    const { result, doc } = run([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [P('Ellie adds a line.', [4])] }]);
    expect(result.status).toBe('applied');
    expect(result.conflicts).toEqual([]);
    expect(result.blockIds).toHaveLength(1);

    const added = blockPos(doc, result.blockIds[0]!)!;
    expect(doc.child(2)).toBe(added.node);
    expect(added.node.textContent).toBe('Ellie adds a line.');
    expect(blockAttrs(added.node).pages).toEqual([4]);
    const mark = added.node.firstChild!.marks.find((m) => m.type.name === 'author')!;
    expect(mark.attrs).toMatchObject({ by: 'ellie', editId: 'e_new', at: Date.parse(NOW) });
  });

  it('insert_before puts them in front of the anchor', () => {
    const { doc, result } = run([{ op: 'insert_before', anchorBlockId: 'b_1', blocks: [P('First.')] }]);
    expect(doc.child(1).textContent).toBe('First.');
    expect(result.status).toBe('applied');
  });

  it('inserts every draft kind the ingest can produce', () => {
    const blocks: DocBlockDraft[] = [
      { kind: 'heading', level: 2, text: 'Bellman', prov: { pages: [5], reason: null } },
      { kind: 'bullets', items: ['One.', 'Two.'], prov: { pages: [5], reason: null } },
      { kind: 'numbers', items: ['Step one.'], prov: { pages: [5], reason: null } },
      { kind: 'code', text: 'v = max(q)', lang: 'python', prov: { pages: [], reason: 'bridging' } },
      { kind: 'math', tex: 'v(s) = \\max_a q(s,a)', prov: { pages: [5], reason: null } },
      { kind: 'figure', page: 6, rect: null, caption: 'The loop', prov: { pages: [6], reason: null } },
    ];
    const { doc, result } = run([{ op: 'insert_after', anchorBlockId: 'b_2', blocks }]);
    expect(result.status).toBe('applied');
    const kinds = [4, 5, 6, 7, 8, 9].map((i) => doc.child(i).type.name);
    expect(kinds).toEqual(['heading', 'bullet_list', 'ordered_list', 'code_block', 'math_block', 'slide_figure']);
    expect(doc.child(5).childCount).toBe(2); // two bullets
    expect(doc.child(7).attrs.lang).toBe('python');
    expect(doc.child(8).attrs.tex).toContain('\\max_a');
    expect(doc.child(9).attrs.page).toBe(6);
    doc.check();
  });

  it('insert_q writes the question in as an open Q block at the segment', () => {
    const { doc, result } = run(
      [
        {
          op: 'insert_q',
          anchorBlockId: 'b_2',
          questionId: 'q_1',
          objectiveId: 'o_1',
          text: 'Why does the Bellman update converge?',
          prov: { pages: [5], reason: null },
        },
      ],
      { author: 'max', cause: 'q_block' },
    );
    expect(result.status).toBe('applied');
    const q = doc.child(4);
    expect(q.type.name).toBe('q_block');
    expect(q.attrs).toMatchObject({ questionId: 'q_1', askedBy: 'max', status: 'open', resolution: null, objectiveId: 'o_1' });
    expect(q.firstChild!.textContent).toBe('Why does the Bellman update converge?');
    expect(result.blockIds).toEqual([blockAttrs(q).blockId]);
  });

  it('resolve_q resolves the Q block in place and writes the answer under the question', () => {
    const asked = run(
      [
        {
          op: 'insert_q',
          anchorBlockId: 'b_2',
          questionId: 'q_1',
          objectiveId: null,
          text: 'Why does it converge?',
          prov: { pages: [5], reason: null },
        },
      ],
      { author: 'max', cause: 'q_block' },
    );
    const { doc, result } = run(
      [{ op: 'resolve_q', questionId: 'q_1', resolution: 'partly_yours', blocks: [P('Because the update is a contraction.')] }],
      { author: 'max', cause: 'q_resolved', editId: 'e_2' },
      asked.doc,
    );
    expect(result.status).toBe('applied');
    const q = doc.child(4);
    expect(q.type.name).toBe('q_block'); // it stays
    expect(q.attrs.status).toBe('resolved');
    expect(q.attrs.resolution).toBe('partly_yours');
    expect(q.childCount).toBe(2);
    expect(q.child(0).textContent).toBe('Why does it converge?');
    expect(q.child(1).textContent).toBe('Because the update is a contraction.');
    doc.check();
  });

  it('none of the four conflicts, even aimed at the block the learner wrote in', () => {
    const adds: AgentDocOp[] = [
      { op: 'insert_after', anchorBlockId: 'b_mix', blocks: [P('After.')] },
      { op: 'insert_before', anchorBlockId: 'b_mix', blocks: [P('Before.')] },
      {
        op: 'insert_q',
        anchorBlockId: 'b_mix',
        questionId: 'q_2',
        objectiveId: null,
        text: 'Say more?',
        prov: { pages: [], reason: 'quiz' },
      },
    ];
    for (const op of adds) {
      const { result, state } = run([op]);
      expect(result.status).toBe('applied');
      expect(result.conflicts).toEqual([]);
      expect(learnerConflicts(state, result.tr!)).toEqual([]);
    }
  });

  it('skips an op whose block is gone and applies the rest', () => {
    const { result, doc } = run([
      { op: 'insert_after', anchorBlockId: 'b_gone', blocks: [P('Lost.')] },
      { op: 'insert_after', anchorBlockId: 'b_1', blocks: [P('Landed.')] },
    ]);
    expect(result.status).toBe('applied');
    expect(result.blockIds).toHaveLength(1);
    expect(doc.textContent).toContain('Landed.');
    expect(doc.textContent).not.toContain('Lost.');
  });

  it('is no_change when nothing in the batch resolves', () => {
    const { result } = run([{ op: 'insert_after', anchorBlockId: 'b_gone', blocks: [P('Lost.')] }]);
    expect(result).toMatchObject({ tr: null, status: 'no_change', blockIds: [], suggestion: null });
  });
});

// ── rule 2: the three cases on a block holding learner text ─────────────────────────────────

describe('rule 2 — an op on a block the learner has written in', () => {
  it('replace_block becomes a suggestion', () => {
    const { result, doc } = run([
      { op: 'replace_block', blockId: 'b_mix', blocks: [P('Value iteration converges by contraction.')] },
    ]);
    expect(result.status).toBe('applied');
    expect(result.suggestion).toMatchObject({
      docId: 'doc_1',
      editId: 'e_new',
      author: 'ellie',
      blockId: 'b_mix',
      status: 'open',
      createdAt: NOW,
      resolvedAt: null,
    });
    expect(result.conflicts.map((c) => c.text)).toEqual(['I think it converges because of the contraction.']);

    // The learner's characters are all still there, struck rather than gone.
    expect(doc.textContent).toContain('I think it converges because of the contraction.');
    expect(doc.textContent).toContain('Value iteration converges by contraction.');
    const struck: string[] = [];
    doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'suggest_del')) struck.push(node.text ?? '');
      return true;
    });
    expect(struck.join('')).toContain('I think it converges');
  });

  it('remove_block is dropped, and the status says the guard did it', () => {
    const { result, doc, state } = run([{ op: 'remove_block', blockId: 'b_mix' }]);
    expect(result.status).toBe('rejected_guard');
    expect(result.tr).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    expect(doc.toJSON()).toEqual(state.doc.toJSON());
  });

  it('append_to_block is relocated to an insert_after of the same block', () => {
    const { result, doc, state } = run([{ op: 'append_to_block', blockId: 'b_mix', text: 'Ellie adds a sentence.' }]);
    expect(result.status).toBe('applied');
    expect(result.conflicts).toHaveLength(1);

    // The learner's block is untouched, character for character.
    const before = state.doc.child(4);
    expect(doc.child(4).toJSON()).toEqual(before.toJSON());
    // And the sentence landed in a new block right after it, with the block's provenance.
    expect(doc.child(5).textContent).toBe('Ellie adds a sentence.');
    expect(blockAttrs(doc.child(5)).pages).toEqual(blockAttrs(before).pages);
  });

  it('drops the whole batch if any part of it would still reach learner text', () => {
    // The guard runs on the finished transaction, not only on the ops' own reasoning.
    const state = stateOf(fixtureDoc());
    const span = learnerSpans(state.doc)[0]!;
    const tr = state.tr.delete(span.from, span.to);
    expect(learnerConflicts(state, tr)).toHaveLength(1);
  });

  it('never conflicts on a block only the agents have written in (rule 6)', () => {
    const { result, doc } = run([
      { op: 'replace_block', blockId: 'b_2', blocks: [P('Rewritten freely.', [5])] },
      { op: 'append_to_block', blockId: 'b_1', text: ' And one more clause.' },
    ]);
    expect(result.status).toBe('applied');
    expect(result.suggestion).toBeNull();
    expect(result.conflicts).toEqual([]);
    expect(doc.child(1).textContent).toBe('Classical planning assumes a deterministic world. And one more clause.');
    expect(doc.textContent).toContain('Rewritten freely.');
    expect(doc.textContent).not.toContain('Bellman update');
  });

  it('removes an agent block outright', () => {
    const { result, doc } = run([{ op: 'remove_block', blockId: 'b_2' }]);
    expect(result.status).toBe('applied');
    expect(doc.textContent).not.toContain('Bellman');
    expect(result.blockIds).toEqual(['b_2']);
  });
});

// ── rule 3: the suggestion a batch carries, and its reject ──────────────────────────────────

describe('rule 3 — batch.suggestion, and rejecting it', () => {
  const suggestionBatch = batchOf([], {
    author: 'max',
    cause: 'suggestion',
    editId: 'e_sg',
    suggestion: {
      blockId: 'b_mix',
      quote: 'I think it converges',
      replacement: 'It converges',
      note: 'Say it as a claim, not a guess.',
      threadId: 'span_abc',
    },
  });

  it('expresses it as strike + offer, and reports the Suggestion record', () => {
    const state = stateOf(fixtureDoc());
    const result = applyBatch(state, suggestionBatch, OPTS);
    expect(result.status).toBe('applied');
    expect(result.suggestion).toMatchObject({
      blockId: 'b_mix',
      author: 'max',
      note: 'Say it as a claim, not a guess.',
      threadId: 'span_abc',
      status: 'open',
    });
    expect(result.blockIds).toEqual(['b_mix']);
    expect(state.apply(result.tr!).doc.textContent).toContain('I think it convergesIt converges');
  });

  it('rejecting leaves the doc byte-identical', () => {
    const state = stateOf(fixtureDoc());
    const baseline = JSON.stringify(state.doc.toJSON());
    const result = applyBatch(state, suggestionBatch, OPTS);
    const open = state.apply(result.tr!);
    const after = open.apply(rejectSuggestion(open, result.suggestion!.suggestionId)!);
    expect(JSON.stringify(after.doc.toJSON())).toBe(baseline);
  });

  it('is no_change when the quoted words are not in the block', () => {
    const state = stateOf(fixtureDoc());
    const result = applyBatch(
      state,
      batchOf([], {
        cause: 'suggestion',
        suggestion: { blockId: 'b_mix', quote: 'words nobody wrote', replacement: 'x', note: 'No such words.', threadId: null },
      }),
      OPTS,
    );
    expect(result).toMatchObject({ tr: null, status: 'no_change', suggestion: null });
  });
});

// ── rule 4: Freeze ──────────────────────────────────────────────────────────────────────────

describe('rule 4 — frozen', () => {
  it('drops the edit: nothing applied, nothing queued, no suggestion', () => {
    const state = stateOf(fixtureDoc());
    const result = applyBatch(
      state,
      batchOf([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [P('Would have been written.')] }]),
      { ...OPTS, frozen: true },
    );
    expect(result).toEqual({ tr: null, status: 'no_change', blockIds: [], conflicts: [], suggestion: null });
  });

  it('drops a suggestion batch too', () => {
    const state = stateOf(fixtureDoc());
    const result = applyBatch(
      state,
      batchOf([], {
        cause: 'suggestion',
        suggestion: { blockId: 'b_mix', quote: 'I think', replacement: 'It is', note: 'Say it plainly.', threadId: null },
      }),
      { ...OPTS, frozen: true },
    );
    expect(result.tr).toBeNull();
    expect(result.suggestion).toBeNull();
  });
});

// ── rule 5: the ingest's windows ────────────────────────────────────────────────────────────

describe('rule 5 — appendWindow', () => {
  const window: DocBlockDraft[] = [
    { kind: 'heading', level: 2, text: 'Policy iteration', prov: { pages: [7], reason: null } },
    P('It alternates evaluation and improvement.', [7]),
  ];

  it('appends after the previous window, touching nothing that is already there', () => {
    const state = stateOf(fixtureDoc());
    const before = JSON.stringify(state.doc.toJSON());
    const tr = appendWindow(state, 'b_2', window);
    const doc = state.apply(tr).doc;

    expect(learnerConflicts(state, tr)).toEqual([]);
    expect(doc.child(4).textContent).toBe('Policy iteration');
    expect(doc.child(5).textContent).toBe('It alternates evaluation and improvement.');
    // Every original block is still there, unchanged.
    const original = JSON.parse(before) as { content: unknown[] };
    const after = doc.toJSON() as { content: unknown[] };
    expect(after.content.slice(0, 4)).toEqual(original.content.slice(0, 4));
    expect(after.content[6]).toEqual(original.content[4]);
  });

  it('appends at the end when there is no previous window, or it has been deleted', () => {
    const state = stateOf(fixtureDoc());
    for (const after of [null, 'b_gone']) {
      const doc = state.apply(appendWindow(state, after, window)).doc;
      expect(doc.lastChild!.textContent).toBe('It alternates evaluation and improvement.');
    }
  });

  it('authors the window as the ingest, with no edit id (nothing to Remove · Keep)', () => {
    const state = stateOf(fixtureDoc());
    const doc = state.apply(appendWindow(state, 'b_2', window)).doc;
    const mark = doc.child(4).firstChild!.marks.find((m) => m.type.name === 'author')!;
    expect(mark.attrs).toMatchObject({ by: 'ingest', editId: null });
  });

  it('is a no-op transaction for an empty window', () => {
    const state = stateOf(fixtureDoc());
    expect(appendWindow(state, 'b_2', []).steps).toHaveLength(0);
  });

  /**
   * The live run of 19 Sep opened every freshly ingested deck with an empty paragraph between
   * the title and the first heading, wearing an amber `no source` chip — `emptyDoc`'s seed,
   * which §2 would reject as a block with no provenance if the ingest had produced it.
   */
  it('takes the seed paragraph out once the first window has landed', () => {
    const state = stateOf(emptyDoc('Lecture 4'));
    expect(state.doc.childCount).toBe(2);

    const doc = state.apply(appendWindow(state, null, window)).doc;

    expect(doc.childCount).toBe(3);
    expect(doc.child(0).textContent).toBe('Lecture 4');
    expect(doc.child(1).textContent).toBe('Policy iteration');
    const empties = [] as string[];
    doc.forEach((node) => {
      if (node.content.size === 0) empties.push(node.type.name);
    });
    expect(empties).toEqual([]);
  });

  it('leaves the seed alone once the learner has written anywhere in the document', () => {
    // Two blocks, but the second one is the learner's: this is no longer a pristine seed, and
    // the caret may well be sitting in it (§5.4 — an agent never undoes the learner's place).
    const state = stateOf(docOf(heading('b_t', 1, 'Lecture 4'), para('b_u', 'My own note.', 'user')));
    const doc = state.apply(appendWindow(state, null, window)).doc;

    expect(doc.child(1).textContent).toBe('My own note.');
    expect(doc.childCount).toBe(4);
  });

  it('leaves a second window alone: there is no seed left to take', () => {
    const state = stateOf(emptyDoc('Lecture 4'));
    const first = state.apply(appendWindow(state, null, window));
    const second = first.apply(appendWindow(first, null, [P('And a second window.', [8])]));

    expect(second.doc.childCount).toBe(4);
    expect(second.doc.lastChild!.textContent).toBe('And a second window.');
  });
});

// ── Remove · Keep ───────────────────────────────────────────────────────────────────────────

describe('removeEdit', () => {
  it('removes the blocks the edit created and leaves the rest', () => {
    const state = stateOf(fixtureDoc());
    const before = JSON.stringify(state.doc.toJSON());
    const applied = applyBatch(
      state,
      batchOf([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [P('One.'), P('Two.')] }]),
      OPTS,
    );
    const open = state.apply(applied.tr!);
    const back = open.apply(removeEdit(open, { editId: 'e_new', blockIds: applied.blockIds })!);
    expect(JSON.stringify(back.doc.toJSON())).toBe(before);
  });

  it('removes a resolved Q block whole', () => {
    const state = stateOf(fixtureDoc());
    const asked = state.apply(
      applyBatch(
        state,
        batchOf(
          [
            {
              op: 'insert_q',
              anchorBlockId: 'b_2',
              questionId: 'q_1',
              objectiveId: null,
              text: 'Why?',
              prov: { pages: [5], reason: null },
            },
          ],
          { author: 'max', editId: 'e_q' },
        ),
        OPTS,
      ).tr!,
    );
    const resolved = applyBatch(
      asked,
      batchOf([{ op: 'resolve_q', questionId: 'q_1', resolution: 'released', blocks: [P('Because.')] }], {
        author: 'max',
        editId: 'e_q',
      }),
      OPTS,
    );
    const open = asked.apply(resolved.tr!);
    expect(open.doc.child(4).type.name).toBe('q_block');

    const back = open.apply(removeEdit(open, { editId: 'e_q', blockIds: resolved.blockIds })!);
    expect(back.doc.childCount).toBe(5);
    expect(back.doc.textContent).not.toContain('Why?');
    expect(back.doc.textContent).not.toContain('Because.');
  });

  it('keeps a block the learner has typed into, and removes only the agent spans', () => {
    // Ellie's block, then the learner writes a sentence inside it.
    const doc = docOf(
      heading('b_title', 1, 'Planning'),
      mixed('b_1', [
        { text: "Ellie's opener. ", by: 'ellie', editId: 'e_1' },
        { text: 'My own sentence.', by: 'user' },
        { text: " Ellie's close.", by: 'ellie', editId: 'e_1' },
      ]),
    );
    const state = stateOf(doc);
    const back = state.apply(removeEdit(state, { editId: 'e_1', blockIds: ['b_1'] })!);
    expect(back.doc.childCount).toBe(2);
    expect(back.doc.child(1).textContent).toBe('My own sentence.');
    expect(learnerSpans(back.doc)).toHaveLength(1);
  });

  it('keeps a resolved Q block the learner answered inside', () => {
    const q = notesSchema.nodes.q_block!.create(
      { blockId: 'b_q', questionId: 'q_1', status: 'resolved', resolution: 'you_got_this', pages: [], reason: 'quiz', objectiveIds: [] },
      [
        para('b_qp', 'Why does it converge?', 'max', 'e_q'),
        mixed('b_mine', [{ text: 'Because the update contracts.', by: 'user' }]),
      ],
    );
    const state = stateOf(docOf(para('b_1', 'Before.'), q));
    const back = state.apply(removeEdit(state, { editId: 'e_q', blockIds: ['b_q'] })!);
    expect(back.doc.child(1).type.name).toBe('q_block');
    expect(back.doc.textContent).not.toContain('Why does it converge?');
    expect(back.doc.textContent).toContain('Because the update contracts.');
  });

  it('is null for an edit the document no longer carries', () => {
    const state = stateOf(fixtureDoc());
    expect(removeEdit(state, { editId: 'e_gone', blockIds: ['b_gone'] })).toBeNull();
  });
});

describe('keepEdit', () => {
  it('clears the edit id and keeps the author, the text and the provenance', () => {
    const state = stateOf(fixtureDoc());
    const applied = applyBatch(
      state,
      batchOf([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [P('Kept for good.', [4])] }]),
      OPTS,
    );
    const open = state.apply(applied.tr!);
    const kept = open.apply(keepEdit(open, { editId: 'e_new', blockIds: applied.blockIds })!);

    const block = blockPos(kept.doc, applied.blockIds[0]!)!.node;
    expect(block.textContent).toBe('Kept for good.');
    expect(blockAttrs(block).pages).toEqual([4]);
    const mark = block.firstChild!.marks.find((m) => m.type.name === 'author')!;
    expect(mark.attrs).toMatchObject({ by: 'ellie', editId: null });
    // Nothing else moved.
    expect(kept.doc.childCount).toBe(open.doc.childCount);
  });

  it('is null for an edit the document no longer carries', () => {
    const state = stateOf(fixtureDoc());
    expect(keepEdit(state, { editId: 'e_gone', blockIds: [] })).toBeNull();
  });
});

describe('draftToNodes', () => {
  it('gives every block a fresh id and the draft its provenance', () => {
    const nodes = draftToNodes(notesSchema, [P('One.', [1]), P('Two.', [2])], 'max', 'e_1', 7);
    const ids = nodes.map((node) => blockAttrs(node).blockId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => /^b_[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(blockAttrs(nodes[1]!).pages).toEqual([2]);
    expect(nodes[0]!.firstChild!.marks[0]!.attrs).toMatchObject({ by: 'max', editId: 'e_1', at: 7 });
  });

  it('leaves code literal and drops an empty list', () => {
    const nodes = draftToNodes(
      notesSchema,
      [
        { kind: 'code', text: 'a = b ** 2', prov: { pages: [], reason: 'example' } },
        { kind: 'bullets', items: ['  ', ''], prov: { pages: [1], reason: null } },
      ],
      'ellie',
      null,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.textContent).toBe('a = b ** 2');
  });
});
