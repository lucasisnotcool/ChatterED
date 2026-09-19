/**
 * The schema's own promises: ids, provenance on every block, the author mark that does not merge
 * spans by different authors, the outline a prompt is given, and the learner's spans.
 */

import { describe, expect, it } from 'vitest';
import { docOf, fixtureDoc, heading, mixed, para, stateOf } from './fixture.test-support.js';
import { inlineToNodes } from './inline.js';
import {
  assignMissingBlockIds,
  authorMark,
  blockAttrs,
  blockPos,
  blocksForPages,
  docFromJson,
  docOutline,
  docOutlineNear,
  emptyDoc,
  hasLearnerText,
  learnerSpans,
  newBlockId,
  notesSchema,
} from './schema.js';

describe('newBlockId', () => {
  it('is b_ plus 12 hex, and does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newBlockId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^b_[0-9a-f]{12}$/);
  });
});

describe('the schema', () => {
  it('carries provenance on every block-level node', () => {
    for (const name of ['paragraph', 'heading', 'bullet_list', 'ordered_list', 'code_block', 'math_block', 'q_block', 'slide_figure']) {
      const type = notesSchema.nodes[name]!;
      expect(Object.keys(type.spec.attrs ?? {})).toEqual(
        expect.arrayContaining(['blockId', 'pages', 'reason', 'objectiveIds']),
      );
    }
  });

  it('gives list_item a blockId and nothing else', () => {
    expect(Object.keys(notesSchema.nodes.list_item!.spec.attrs ?? {})).toEqual(['blockId']);
  });

  it('emits data-block-id from toDOM', () => {
    const node = para('b_1', 'Hello.');
    const dom = notesSchema.nodes.paragraph!.spec.toDOM!(node) as [string, Record<string, string>, number];
    expect(dom[0]).toBe('p');
    expect(dom[1]['data-block-id']).toBe('b_1');
  });

  it('emits the q_block attributes the renderer styles on', () => {
    const q = notesSchema.nodes.q_block!.create(
      {
        blockId: 'b_q',
        questionId: 'q1',
        askedBy: 'max',
        status: 'resolved',
        resolution: 'partly_yours',
        pages: [7],
        reason: null,
        objectiveIds: [],
      },
      para('b_qp', 'Why does it converge?', 'max'),
    );
    const dom = notesSchema.nodes.q_block!.spec.toDOM!(q) as [string, Record<string, string>, number];
    expect(dom[1]).toMatchObject({
      'data-block-id': 'b_q',
      'data-question-id': 'q1',
      'data-status': 'resolved',
      'data-resolution': 'partly_yours',
    });
  });

  it('emits data-page on a slide figure', () => {
    const fig = notesSchema.nodes.slide_figure!.create({
      blockId: 'b_f',
      page: 12,
      rect: { x0: 0, y0: 0.1, x1: 1, y1: 0.6 },
      caption: 'The MDP loop',
      pages: [12],
      reason: null,
      objectiveIds: [],
    });
    const dom = notesSchema.nodes.slide_figure!.spec.toDOM!(fig) as [string, Record<string, string>];
    expect(dom[0]).toBe('figure');
    expect(dom[1]['data-page']).toBe('12');
    expect(dom[1]['data-rect']).toBe('0,0.1,1,0.6');
  });

  it('emits data-author and data-edit-id, and omits the edit id once it is kept', () => {
    const withEdit = authorMark('ellie', 'e_1', 1);
    const kept = authorMark('ellie', null, 1);
    const spec = notesSchema.marks.author!.spec.toDOM!;
    expect((spec(withEdit, true) as [string, Record<string, string>])[1]).toMatchObject({
      'data-author': 'ellie',
      'data-edit-id': 'e_1',
    });
    expect((spec(kept, true) as [string, Record<string, string>])[1]['data-edit-id']).toBeUndefined();
  });

  it('emits the suggestion marks the accept/reject control draws on', () => {
    const mark = notesSchema.marks.suggest_del!.create({ suggestionId: 'sg_1', by: 'max' });
    const dom = notesSchema.marks.suggest_del!.spec.toDOM!(mark, true) as [string, Record<string, string>];
    expect(dom[1]).toMatchObject({ 'data-suggest': 'del', 'data-suggestion-id': 'sg_1', 'data-by': 'max' });
  });

  it('never merges spans by different authors or different edits', () => {
    const block = mixed('b_x', [
      { text: 'one ', by: 'ellie', editId: 'e_1' },
      { text: 'two ', by: 'ellie', editId: 'e_2' },
      { text: 'three', by: 'user' },
    ]);
    expect(block.content.childCount).toBe(3);
    // And a round trip through JSON keeps them apart.
    const back = docFromJson(docOf(block).toJSON());
    expect(back.firstChild!.content.childCount).toBe(3);
  });

  it('does not let an author mark bleed onto text typed after it', () => {
    // `inclusive: false` is what stops learner typing at the end of Ellie's sentence from
    // becoming Ellie's — the property T4's typing plugin is built on.
    expect(notesSchema.marks.author!.spec.inclusive).toBe(false);
  });
});

describe('blockPos', () => {
  it('finds a block and refuses the empty id', () => {
    const doc = fixtureDoc();
    const found = blockPos(doc, 'b_2')!;
    expect(found.node.textContent).toContain('Bellman');
    expect(doc.nodeAt(found.pos)).toBe(found.node);
    expect(blockPos(doc, '')).toBeNull();
    expect(blockPos(doc, 'b_nope')).toBeNull();
  });
});

describe('learnerSpans', () => {
  it('returns the learner run, in document positions', () => {
    const doc = fixtureDoc();
    const spans = learnerSpans(doc);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.blockId).toBe('b_mix');
    expect(spans[0]!.text).toBe('I think it converges because of the contraction.');
    expect(doc.textBetween(spans[0]!.from, spans[0]!.to)).toBe(spans[0]!.text);
  });

  it('merges a run that a bold word split in two', () => {
    const doc = docOf(
      notesSchema.nodes.paragraph!.create(
        { blockId: 'b_1', pages: [], reason: 'mine', objectiveIds: [] },
        inlineToNodes(notesSchema, 'I think **value** iteration converges.', 'user', null, 1),
      ),
    );
    const spans = learnerSpans(doc);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe('I think value iteration converges.');
  });

  it('is empty for a document nobody has written in', () => {
    expect(learnerSpans(docOf(para('b_1', 'All Ellie.')))).toEqual([]);
    expect(hasLearnerText(para('b_1', 'All Ellie.'))).toBe(false);
  });
});

describe('docOutline', () => {
  it('gives one line per block, with the heading path and the learner flag', () => {
    const outline = docOutline(fixtureDoc());
    expect(outline.map((entry) => entry.blockId)).toEqual(['b_title', 'b_1', 'b_h2', 'b_2', 'b_mix']);
    expect(outline[1]!.path).toEqual(['Planning']);
    expect(outline[3]!.path).toEqual(['Planning', 'Value iteration']);
    expect(outline[3]!.pages).toEqual([5]);
    expect(outline[4]!.learnerText).toBe(true);
    expect(outline[1]!.learnerText).toBe(false);
    // The markers are gone: an outline is text, not markup.
    expect(outline[1]!.text).toBe('Classical planning assumes a deterministic world.');
  });

  it('truncates a block to about 24 words', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${String(i)}`).join(' ');
    const outline = docOutline(docOf(para('b_1', long)));
    expect(outline[0]!.text.split(' ')).toHaveLength(24);
    expect(outline[0]!.text.endsWith('…')).toBe(true);
  });

  it('names a q_block by its question id', () => {
    const q = notesSchema.nodes.q_block!.create(
      { blockId: 'b_q', questionId: 'q7', pages: [], reason: 'quiz', objectiveIds: [] },
      para('b_qp', 'Why does value iteration converge?', 'max'),
    );
    const outline = docOutline(docOf(para('b_1', 'Before.'), q));
    expect(outline.map((e) => e.kind)).toEqual(['paragraph', 'q_block', 'paragraph']);
    expect(outline[1]!.questionId).toBe('q7');
    expect(outline[2]!.blockId).toBe('b_qp');
  });

  it('treats a list as one block, not one per bullet', () => {
    const list = notesSchema.nodes.bullet_list!.create(
      { blockId: 'b_l', pages: [3], reason: null, objectiveIds: [] },
      [
        notesSchema.nodes.list_item!.create({ blockId: 'b_li1' }, para('b_lp1', 'First.')),
        notesSchema.nodes.list_item!.create({ blockId: 'b_li2' }, para('b_lp2', 'Second.')),
      ],
    );
    const outline = docOutline(docOf(list));
    expect(outline).toHaveLength(1);
    expect(outline[0]!.kind).toBe('bullet_list');
    expect(outline[0]!.text).toBe('First. Second.');
  });
});

describe('docOutlineNear', () => {
  const wide = (): ReturnType<typeof docOf> =>
    docOf(
      heading('b_h1', 1, 'Planning'),
      ...Array.from({ length: 12 }, (_, i) => para(`b_a${String(i)}`, `Alpha ${String(i)}.`)),
      heading('b_h2', 2, 'Value iteration'),
      ...Array.from({ length: 12 }, (_, i) => para(`b_b${String(i)}`, `Beta ${String(i)}.`)),
    );

  it('returns the blocks within the radius plus every heading on the path', () => {
    const near = docOutlineNear(wide(), 'b_b8', 2);
    const ids = near.map((entry) => entry.blockId);
    expect(ids).toContain('b_b6');
    expect(ids).toContain('b_b10');
    expect(ids).not.toContain('b_b3');
    // Both headings above it, however far up.
    expect(ids).toContain('b_h1');
    expect(ids).toContain('b_h2');
    // Document order, always.
    expect(ids).toEqual([...ids].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
  });

  it('falls back to the headings plus the opening when there is no anchor', () => {
    const near = docOutlineNear(wide(), null, 3);
    const ids = near.map((entry) => entry.blockId);
    expect(ids.slice(0, 3)).toEqual(['b_h1', 'b_a0', 'b_a1']);
    expect(ids).toContain('b_h2');
    expect(ids).not.toContain('b_b9');
  });

  it('falls back the same way when the anchor has been deleted', () => {
    expect(docOutlineNear(wide(), 'b_gone', 3).map((e) => e.blockId)).toEqual(
      docOutlineNear(wide(), null, 3).map((e) => e.blockId),
    );
  });
});

describe('blocksForPages', () => {
  it('is the blocks whose pages intersect', () => {
    expect(blocksForPages(fixtureDoc(), [5])).toEqual(['b_h2', 'b_2']);
    expect(blocksForPages(fixtureDoc(), [4, 5])).toEqual(['b_1', 'b_h2', 'b_2']);
    expect(blocksForPages(fixtureDoc(), [99])).toEqual([]);
  });

  it('counts the page a figure names', () => {
    const fig = notesSchema.nodes.slide_figure!.create({
      blockId: 'b_f',
      page: 9,
      rect: null,
      caption: 'x',
      pages: [],
      reason: 'evidentiary',
      objectiveIds: [],
    });
    expect(blocksForPages(docOf(fig), [9])).toEqual(['b_f']);
  });
});

describe('docFromJson / emptyDoc', () => {
  it('round-trips a document', () => {
    const doc = fixtureDoc();
    expect(docFromJson(doc.toJSON()).toJSON()).toEqual(doc.toJSON());
  });

  it('throws on something that is not a document', () => {
    expect(() => docFromJson(null)).toThrow(/expected an object/);
    expect(() => docFromJson({ type: 'paragraph' })).toThrow(/notes doc/);
    expect(() => docFromJson({ type: 'doc', content: [] })).toThrow();
  });

  it('opens a new doc with the title as an H1 and somewhere to type', () => {
    const doc = emptyDoc('CS3249 Lecture 4');
    expect(doc.childCount).toBe(2);
    expect(doc.firstChild!.type.name).toBe('heading');
    expect(doc.firstChild!.textContent).toBe('CS3249 Lecture 4');
    expect(blockAttrs(doc.firstChild!).reason).toBe('title');
    expect(doc.lastChild!.type.name).toBe('paragraph');
    doc.check();
  });
});

describe('assignMissingBlockIds', () => {
  it('mints ids for the duplicate a split leaves behind', () => {
    // What `splitBlock` produces: two paragraphs carrying the same id.
    const doc = docOf(para('b_1', 'First half.'), para('b_1', 'Second half.'));
    const tr = assignMissingBlockIds(stateOf(doc).tr)!;
    const ids = [blockAttrs(tr.doc.child(0)).blockId, blockAttrs(tr.doc.child(1)).blockId];
    expect(ids[0]).toBe('b_1');
    expect(ids[1]).not.toBe('b_1');
    expect(ids[1]).toMatch(/^b_[0-9a-f]{12}$/);
    // The text is untouched: this is an attrs pass, not a rewrite.
    expect(tr.doc.textContent).toBe(doc.textContent);
  });

  it('mints an id for a block that has none', () => {
    const doc = docOf(notesSchema.nodes.paragraph!.create(null, notesSchema.text('Typed fresh.')));
    const tr = assignMissingBlockIds(stateOf(doc).tr)!;
    expect(blockAttrs(tr.doc.child(0)).blockId).toMatch(/^b_[0-9a-f]{12}$/);
  });

  it('is null when there is nothing to do', () => {
    expect(assignMissingBlockIds(stateOf(fixtureDoc()).tr)).toBeNull();
  });
});
