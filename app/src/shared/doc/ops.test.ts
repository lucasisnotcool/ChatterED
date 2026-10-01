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
import { diagram, docOf, fixtureDoc, heading, mixed, para, stateOf, table } from './fixture.test-support.js';
import { learnerConflicts } from './guard.js';
import {
  appendWindow,
  applyBatch,
  draftToNodes,
  keepEdit,
  removeEdit,
  type ApplyResult,
} from './ops.js';
import { Fragment, Slice } from 'prosemirror-model';
import {
  authorMark,
  blockAttrs,
  blockPos,
  diagramSpec,
  docFromJson,
  emptyDoc,
  learnerSpans,
  notesSchema,
  tableGrid,
} from './schema.js';
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

  /** Live run, 1 Oct 2026: Max's release went in above the answer the learner wrote in place. */
  it('resolve_q writes the resolution after the learner\'s own answer under the question', () => {
    const asked = run(
      [{ op: 'insert_q', anchorBlockId: 'b_2', questionId: 'q_1', objectiveId: null, text: 'Why?', prov: { pages: [5], reason: null } }],
      { author: 'max', cause: 'q_block' },
    );
    // The learner's in-place answer, as the Q block's "Answer here" writes it.
    const q0 = asked.doc.child(4);
    const answer = notesSchema.nodes.paragraph!.create(
      { blockId: 'b_ans', pages: [5], reason: 'your answer', objectiveIds: [] },
      notesSchema.text('Because it contracts.', [authorMark('user', null, 1)]),
    );
    let pos = 0;
    asked.doc.forEach((node, offset, index) => {
      if (index === 4) pos = offset + node.nodeSize - 1;
    });
    const answered = asked.doc.replace(pos, pos, new Slice(Fragment.from(answer), 0, 0));
    expect(answered.child(4).childCount).toBe(q0.childCount + 1);
    const { doc } = run(
      [{ op: 'resolve_q', questionId: 'q_1', resolution: 'released', blocks: [P('The update is a contraction in the max norm.')] }],
      { author: 'max', cause: 'q_resolved', editId: 'e_2' },
      answered,
    );
    const q = doc.child(4);
    expect([0, 1, 2].map((i) => q.child(i).textContent)).toEqual([
      'Why?',
      'Because it contracts.',
      'The update is a contraction in the max norm.',
    ]);
    doc.check();
  });

  /** #49: every feedback turn used to resolve again, each one inserted above the last. */
  it('resolve_q on a question already resolved changes nothing', () => {
    const asked = run(
      [{ op: 'insert_q', anchorBlockId: 'b_2', questionId: 'q_1', objectiveId: null, text: 'Why?', prov: { pages: [5], reason: null } }],
      { author: 'max', cause: 'q_block' },
    );
    const once = run(
      [{ op: 'resolve_q', questionId: 'q_1', resolution: 'released', blocks: [P('Because it contracts.')] }],
      { author: 'max', cause: 'q_resolved', editId: 'e_2' },
      asked.doc,
    );
    const twice = run(
      [{ op: 'resolve_q', questionId: 'q_1', resolution: 'you_got_this', blocks: [P('Well done.')] }],
      { author: 'max', cause: 'q_resolved', editId: 'e_3' },
      once.doc,
    );
    expect(twice.result.status).toBe('no_change');
    expect(twice.doc.child(4).attrs.resolution).toBe('released');
    expect(twice.doc.child(4).childCount).toBe(2);
  });

  /**
   * #49, Lucas's call: on *you got this* the learner's own answer is the entry. Their words, so
   * their author mark — and no edit id, so Remove on Max's edit takes his line and leaves theirs.
   */
  it('files the learner’s answer under the question as theirs, above Max’s line', () => {
    const asked = run(
      [{ op: 'insert_q', anchorBlockId: 'b_2', questionId: 'q_1', objectiveId: null, text: 'Why?', prov: { pages: [5], reason: null } }],
      { author: 'max', cause: 'q_block' },
    );
    const { doc, result } = run(
      [
        {
          op: 'resolve_q',
          questionId: 'q_1',
          resolution: 'you_got_this',
          blocks: [P('The slide calls this a contraction.')],
          learnerAnswer: 'because each update shrinks the error',
        },
      ],
      { author: 'max', cause: 'q_resolved', editId: 'e_2' },
      asked.doc,
    );
    expect(result.status).toBe('applied');
    const q = doc.child(4);
    expect(q.childCount).toBe(3);
    expect(q.child(1).textContent).toBe('because each update shrinks the error');
    const mark = q.child(1).firstChild!.marks.find((m) => m.type.name === 'author')!;
    expect(mark.attrs).toMatchObject({ by: 'user', editId: null });
    expect(q.child(1).attrs.pages).toEqual([5]);
    expect(q.child(2).textContent).toBe('The slide calls this a contraction.');

    const removed = removeEdit(stateOf(doc), { editId: 'e_2', blockIds: result.blockIds });
    expect(removed).not.toBeNull();
    expect(removed!.doc.textContent).toContain('because each update shrinks the error');
    expect(removed!.doc.textContent).not.toContain('The slide calls this a contraction.');
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

// ── the table and the diagram (2026-10-01) ──────────────────────────────────────────────────

const TABLE: DocBlockDraft = {
  kind: 'table',
  caption: 'Planning vs learning',
  columns: ['Method', 'Needs a model'],
  rows: [
    { cells: ['**Value** iteration', 'yes'], pages: [5] },
    { cells: ['Q-learning', ''] },
  ],
  prov: { pages: [5, 9], reason: null },
};

const DIAGRAM: DocBlockDraft = {
  kind: 'diagram',
  layout: 'hierarchy',
  title: 'What an MDP is made of',
  nodes: [
    { id: 'n1', label: 'MDP', pages: [3] },
    { id: 'n2', label: 'States', parent: 'n1' },
    { id: 'n3', label: '*Rewards*', parent: 'n1', group: 'signal' },
  ],
  edges: [{ from: 'n2', to: 'n3' }],
  prov: { pages: [], reason: 'asked for in the chat' },
};

/** Every text node under `node`, as `[text, by, editId]`. */
function authorsIn(node: ReturnType<typeof fixtureDoc>): [string, unknown, unknown][] {
  const out: [string, unknown, unknown][] = [];
  node.descendants((child) => {
    if (!child.isText) return true;
    const mark = child.marks.find((m) => m.type.name === 'author');
    out.push([child.text ?? '', mark?.attrs.by, mark?.attrs.editId]);
    return false;
  });
  return out;
}

describe('draftToNodes — table and diagram', () => {
  it('builds a table: a heading row, the rows with their own pages, every span the agent’s', () => {
    const [node] = draftToNodes(notesSchema, [TABLE], 'ellie', 'e_1', 7);
    expect(node!.type.name).toBe('table');
    expect(blockAttrs(node!)).toMatchObject({ pages: [5, 9], reason: null });
    expect(blockAttrs(node!).blockId).toMatch(/^b_[0-9a-f]{12}$/);
    expect(tableGrid(node!)).toEqual({
      caption: 'Planning vs learning',
      columns: ['Method', 'Needs a model'],
      rows: [
        ['Value iteration', 'yes'],
        ['Q-learning', ''],
      ],
    });
    expect([0, 1, 2].map((i) => node!.child(i).attrs.pages)).toEqual([[], [5], []]);
    expect(node!.child(0).child(0).attrs.header).toBe(true);
    expect(node!.child(1).child(0).attrs.header).toBe(false);
    // The inline subset is parsed in a cell as it is in a paragraph.
    expect(node!.child(1).child(0).firstChild!.marks.map((m) => m.type.name)).toContain('strong');
    expect(node!.child(2).child(1).childCount).toBe(0);
    for (const [, by, editId] of authorsIn(node!)) expect([by, editId]).toEqual(['ellie', 'e_1']);
    expect(() => docOf(node!).check()).not.toThrow();
  });

  it('builds a diagram: nodes by id with authored labels, edges normalised onto the block', () => {
    const [node] = draftToNodes(notesSchema, [DIAGRAM], 'ellie', 'e_1', 7);
    expect(node!.type.name).toBe('diagram');
    expect(blockAttrs(node!)).toMatchObject({ pages: [], reason: 'asked for in the chat' });
    expect(diagramSpec(node!)).toEqual({
      layout: 'hierarchy',
      title: 'What an MDP is made of',
      nodes: [
        { id: 'n1', label: 'MDP', parent: null, group: null, pages: [3] },
        { id: 'n2', label: 'States', parent: 'n1', group: null, pages: [] },
        { id: 'n3', label: 'Rewards', parent: 'n1', group: 'signal', pages: [] },
      ],
      edges: [{ from: 'n2', to: 'n3', label: null }],
    });
    expect(authorsIn(node!)).toEqual([
      ['MDP', 'ellie', 'e_1'],
      ['States', 'ellie', 'e_1'],
      ['Rewards', 'ellie', 'e_1'],
    ]);
    expect(() => docFromJson(docOf(node!).toJSON())).not.toThrow();
  });

  it('drops a table with no columns and a diagram with no nodes, like an empty list', () => {
    const nodes = draftToNodes(
      notesSchema,
      [
        { kind: 'table', columns: [], rows: [], prov: { pages: [1], reason: null } },
        { kind: 'diagram', layout: 'flow', nodes: [], prov: { pages: [1], reason: null } },
      ],
      'ellie',
      null,
    );
    expect(nodes).toEqual([]);
  });
});

describe('a table or a diagram in a batch', () => {
  const withBoth = () =>
    docOf(
      heading('b_title', 1, 'Planning'),
      para('b_1', 'Classical planning.', 'ingest', null, [4]),
      table('b_tab', ['Method', 'Cost'], [['Value iteration', [{ text: 'a sweep per step', by: 'user' }]]]),
      diagram('b_dia', [
        { id: 'n1', label: 'Observe' },
        { id: 'n2', label: [{ text: 'then I act', by: 'user' }] },
      ]),
      table('b_agents', ['A', 'B'], [['1', '2']]),
      para('b_mine', 'My own sentence about planning.', 'user', null, [4]),
    );

  it('inserts each as one block with one id', () => {
    const { result, doc } = run([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [TABLE, DIAGRAM] }]);
    expect(result.status).toBe('applied');
    expect(result.blockIds).toHaveLength(2);
    expect([doc.child(2).type.name, doc.child(3).type.name]).toEqual(['table', 'diagram']);
    expect(result.blockIds).toEqual([blockAttrs(doc.child(2)).blockId, blockAttrs(doc.child(3)).blockId]);
  });

  it('holds back a replace_block on a table or a diagram the learner wrote in (rule 2)', () => {
    for (const blockId of ['b_tab', 'b_dia']) {
      const { result, doc, state } = run([{ op: 'replace_block', blockId, blocks: [TABLE] }], {}, withBoth());
      expect(result.status).toBe('rejected_guard');
      expect(result.tr).toBeNull();
      expect(result.suggestion).toBeNull();
      expect(result.conflicts.map((c) => c.blockId)).toEqual([blockId]);
      expect(doc.toJSON()).toEqual(state.doc.toJSON());
    }
  });

  it('drops a remove_block on either, and reports the learner’s words', () => {
    const { result, doc, state } = run(
      [
        { op: 'remove_block', blockId: 'b_tab' },
        { op: 'remove_block', blockId: 'b_dia' },
      ],
      {},
      withBoth(),
    );
    expect(result.status).toBe('rejected_guard');
    expect(result.conflicts.map((c) => c.text)).toEqual(['a sweep per step', 'then I act']);
    expect(doc.toJSON()).toEqual(state.doc.toJSON());
  });

  it('relocates an append_to_block to a paragraph after the block', () => {
    const { result, doc } = run([{ op: 'append_to_block', blockId: 'b_tab', text: 'One more thing.' }], {}, withBoth());
    expect(result.status).toBe('applied');
    expect(doc.child(2).toJSON()).toEqual(withBoth().child(2).toJSON());
    expect(doc.child(3).type.name).toBe('paragraph');
    expect(doc.child(3).textContent).toBe('One more thing.');
  });

  it('lets an agent replace or remove one only the agents wrote (rule 6)', () => {
    const replaced = run([{ op: 'replace_block', blockId: 'b_agents', blocks: [DIAGRAM] }], {}, withBoth());
    expect(replaced.result.status).toBe('applied');
    expect(replaced.result.conflicts).toEqual([]);
    expect(replaced.doc.child(4).type.name).toBe('diagram');

    const removed = run([{ op: 'remove_block', blockId: 'b_agents' }], {}, withBoth());
    expect(removed.result.status).toBe('applied');
    expect(blockPos(removed.doc, 'b_agents')).toBeNull();
  });

  it('offers a table over a learner paragraph as a suggestion, in words', () => {
    const { result, doc } = run([{ op: 'replace_block', blockId: 'b_mine', blocks: [TABLE] }], {}, withBoth());
    expect(result.status).toBe('applied');
    expect(result.suggestion).toMatchObject({ blockId: 'b_mine' });
    expect(doc.child(5).type.name).toBe('paragraph');
    expect(doc.child(5).textContent).toContain('My own sentence about planning.');
    expect(doc.child(5).textContent).toContain('Method | Needs a model');
  });
});

describe('Remove · Keep on a table and a diagram', () => {
  function inserted() {
    const state = stateOf(fixtureDoc());
    const before = JSON.stringify(state.doc.toJSON());
    const applied = applyBatch(
      state,
      batchOf([{ op: 'insert_after', anchorBlockId: 'b_1', blocks: [TABLE, DIAGRAM] }]),
      OPTS,
    );
    return { before, applied, open: state.apply(applied.tr!) };
  }

  it('Remove deletes the whole table and the whole diagram the edit inserted', () => {
    const { before, applied, open } = inserted();
    const back = open.apply(removeEdit(open, { editId: 'e_new', blockIds: applied.blockIds })!);
    expect(JSON.stringify(back.doc.toJSON())).toBe(before);
  });

  it('Remove still deletes them whole when the record’s blockIds have drifted', () => {
    const { before, open } = inserted();
    const back = open.apply(removeEdit(open, { editId: 'e_new', blockIds: [] })!);
    expect(JSON.stringify(back.doc.toJSON())).toBe(before);
  });

  it('Remove keeps a table the learner has typed a cell of, and takes only the agent’s cells', () => {
    const { applied, open } = inserted();
    const tableId = applied.blockIds[0]!;
    // The learner fills the empty cell of the second row.
    const target = blockPos(open.doc, tableId)!;
    let emptyCell = -1;
    target.node.descendants((node, offset) => {
      if (node.type.name === 'table_cell' && node.childCount === 0) emptyCell = target.pos + 1 + offset + 1;
      return true;
    });
    const mine = notesSchema.text('no model needed', [notesSchema.marks.author!.create({ by: 'user', editId: null, at: 1 })]);
    const typed = open.apply(open.tr.insert(emptyCell, mine));

    const back = typed.apply(removeEdit(typed, { editId: 'e_new', blockIds: applied.blockIds })!);
    const kept = blockPos(back.doc, tableId)!.node;
    expect(kept.type.name).toBe('table');
    expect(kept.textContent).toBe('no model needed');
    expect(learnerSpans(back.doc).map((span) => span.text)).toContain('no model needed');
    // The diagram had nothing of the learner's in it, and went whole.
    expect(blockPos(back.doc, applied.blockIds[1]!)).toBeNull();
    expect(() => back.doc.check()).not.toThrow();
  });

  it('Keep clears the edit id on every cell and label, and changes nothing else', () => {
    const { applied, open } = inserted();
    const kept = open.apply(keepEdit(open, { editId: 'e_new', blockIds: applied.blockIds })!);
    for (const id of applied.blockIds) {
      const block = blockPos(kept.doc, id)!.node;
      const spans = authorsIn(block);
      expect(spans.length).toBeGreaterThan(0);
      for (const [, by, editId] of spans) expect([by, editId]).toEqual(['ellie', null]);
      expect(block.textContent).toBe(blockPos(open.doc, id)!.node.textContent);
      expect(blockAttrs(block)).toEqual(blockAttrs(blockPos(open.doc, id)!.node));
    }
    expect(diagramSpec(blockPos(kept.doc, applied.blockIds[1]!)!.node).edges).toEqual([{ from: 'n2', to: 'n3', label: null }]);
    expect(keepEdit(kept, { editId: 'e_new', blockIds: applied.blockIds })).toBeNull();
    expect(removeEdit(kept, { editId: 'e_new', blockIds: [] })).toBeNull();
  });
});
