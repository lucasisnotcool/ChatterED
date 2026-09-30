/**
 * The schema's own promises: ids, provenance on every block, the author mark that does not merge
 * spans by different authors, the outline a prompt is given, and the learner's spans.
 */

import type { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { diagram, docOf, fixtureDoc, heading, mixed, para, stateOf, table } from './fixture.test-support.js';
import { inlineToNodes } from './inline.js';
import {
  assignMissingBlockIds,
  authorMark,
  blockAttrs,
  blockPos,
  blockPages,
  blocksForPages,
  diagramSpec,
  diagramText,
  docFromJson,
  docOutline,
  docOutlineNear,
  emptyDoc,
  hasLearnerText,
  isContainerBlock,
  isStructuredBlock,
  learnerSpans,
  newBlockId,
  notesSchema,
  tableGrid,
  tableText,
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
    for (const name of ['paragraph', 'heading', 'bullet_list', 'ordered_list', 'code_block', 'math_block', 'q_block', 'slide_figure', 'table', 'diagram']) {
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

  it('gives a block the learner wrote in far more room, so their notes reach the prompt', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${String(i)}`).join(' ');
    const outline = docOutline(docOf(para('b_1', long, 'user')));
    expect(outline[0]!.learnerText).toBe(true);
    expect(outline[0]!.text.split(' ')).toHaveLength(60);
    // …and it is still capped: a pasted essay cannot swamp a turn.
    const essay = Array.from({ length: 400 }, (_, i) => `w${String(i)}`).join(' ');
    expect(docOutline(docOf(para('b_2', essay, 'user')))[0]!.text.split(' ')).toHaveLength(160);
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

// ── the table and the diagram (2026-10-01) ──────────────────────────────────────────────────

/** Ellie's table, with one cell the learner filled in. */
function compareTable(): Node {
  return table(
    'b_tab',
    ['Method', 'Needs a model', 'Cost'],
    [
      ['Value iteration', 'yes', [{ text: 'one sweep per step', by: 'user' }]],
      ['Q-learning', 'no', ''],
    ],
    { caption: 'Planning vs learning', pages: [5], rowPages: [[5], [9]] },
  );
}

function flowDiagram(): Node {
  return diagram(
    'b_dia',
    [
      { id: 'n1', label: 'Observe', pages: [7] },
      { id: 'n2', label: 'Act' },
      { id: 'n3', label: 'Reward', pages: [8] },
    ],
    {
      layout: 'cycle',
      title: 'The agent loop',
      edges: [
        { from: 'n1', to: 'n2', label: null },
        { from: 'n2', to: 'n3', label: 'environment' },
      ],
      pages: [],
    },
  );
}

/** `toDOM` → the attributes it wrote → the matching `parseDOM` rule's `getAttrs`. No DOM needed. */
function throughDom(node: Node): { tag: string; attrs: Record<string, unknown>; dom: unknown[] } {
  const dom = node.type.spec.toDOM!(node) as unknown as unknown[];
  const tag = dom[0] as string;
  const written = (typeof dom[1] === 'object' && !Array.isArray(dom[1]) ? dom[1] : {}) as Record<string, string>;
  const source = { getAttribute: (name: string): string | null => written[name] ?? null };
  const rule = (node.type.spec.parseDOM ?? []).find((r) => {
    const [ruleTag, attr] = (r.tag ?? '').replace(']', '').split('[');
    return ruleTag === tag && (attr === undefined || attr in written);
  });
  if (!rule) throw new Error(`no parse rule for <${tag}>`);
  const getAttrs = rule.getAttrs as unknown as (dom: typeof source) => Record<string, unknown>;
  return { tag, attrs: getAttrs(source), dom };
}

describe('table and diagram — the schema', () => {
  it('gives rows, cells and diagram nodes no blockId: only the table or the diagram is addressable', () => {
    for (const name of ['table_row', 'table_cell', 'diagram_node']) {
      expect(Object.keys(notesSchema.nodes[name]!.spec.attrs ?? {})).not.toContain('blockId');
    }
    expect(Object.keys(notesSchema.nodes.table_row!.spec.attrs ?? {})).toEqual(['pages']);
    expect(Object.keys(notesSchema.nodes.table_cell!.spec.attrs ?? {})).toEqual(['header']);
    expect(Object.keys(notesSchema.nodes.diagram_node!.spec.attrs ?? {})).toEqual([
      'nodeId',
      'parent',
      'group',
      'pages',
      'reason',
    ]);
  });

  it('makes both blocks isolating and defining, and neither a container', () => {
    for (const node of [compareTable(), flowDiagram()]) {
      expect(node.type.spec.isolating).toBe(true);
      expect(node.type.spec.defining).toBe(true);
      expect(node.type.spec.group).toBe('block');
      expect(isStructuredBlock(node)).toBe(true);
      expect(isContainerBlock(node)).toBe(false);
    }
    expect(isStructuredBlock(para('b_p', 'Prose.'))).toBe(false);
  });

  it('writes a real table, and reads every attr back', () => {
    const node = compareTable();
    const t = throughDom(node);
    expect(t.tag).toBe('table');
    expect(t.dom[2]).toEqual(['tbody', 0]);
    expect(t.attrs).toEqual(node.attrs);

    const row = throughDom(node.child(1));
    expect(row.tag).toBe('tr');
    expect(row.attrs).toEqual({ pages: [5] });
    expect(throughDom(node.child(0)).attrs).toEqual({ pages: [] });

    const th = throughDom(node.child(0).child(0));
    expect([th.tag, th.attrs]).toEqual(['th', { header: true }]);
    const td = throughDom(node.child(1).child(0));
    expect([td.tag, td.attrs]).toEqual(['td', { header: false }]);
  });

  it('writes a diagram as figure[data-diagram] with its edges as JSON, and reads every attr back', () => {
    const node = flowDiagram();
    const d = throughDom(node);
    expect(d.tag).toBe('figure');
    const written = d.dom[1] as Record<string, string>;
    expect(written['data-diagram']).toBe('');
    // Never `data-page`: that is the slide figure's parse rule, and a diagram is not a crop.
    expect(written['data-page']).toBeUndefined();
    expect(JSON.parse(written['data-edges']!)).toEqual(node.attrs.edges);
    expect(d.attrs).toEqual(node.attrs);

    const child = notesSchema.nodes.diagram_node!.create(
      { nodeId: 'n9', parent: 'n1', group: 'Planning', pages: [3, 4], reason: 'from the chat' },
      inlineToNodes(notesSchema, 'A label', 'ellie', null, 1),
    );
    const n = throughDom(child);
    expect(n.tag).toBe('div');
    expect((n.dom[1] as Record<string, string>)['data-diagram-node']).toBe('');
    expect(n.attrs).toEqual(child.attrs);
    expect(throughDom(node.child(1)).attrs).toEqual(node.child(1).attrs);
  });

  it('reads a diagram with a damaged layout or edges as a flow with none, not as a throw', () => {
    const rule = notesSchema.nodes.diagram!.spec.parseDOM![0]!;
    const getAttrs = rule.getAttrs as unknown as (dom: { getAttribute(n: string): string | null }) => Record<string, unknown>;
    const attrs = getAttrs({
      getAttribute: (name) => ({ 'data-layout': 'spiral', 'data-edges': '{not json' })[name] ?? null,
    });
    expect(attrs.layout).toBe('flow');
    expect(attrs.edges).toEqual([]);
  });

  it('survives JSON, authors and all', () => {
    const doc = docOf(heading('b_t', 1, 'Planning'), compareTable(), flowDiagram());
    const back = docFromJson(JSON.parse(JSON.stringify(doc.toJSON())));
    expect(back.eq(doc)).toBe(true);
    expect(back.toJSON()).toEqual(doc.toJSON());
    expect(hasLearnerText(back.child(1))).toBe(true);
  });

  it('refuses a table with no rows and a diagram with no nodes', () => {
    const bare = (type: string) => ({
      type: 'doc',
      content: [{ type, attrs: { blockId: 'b_x', pages: [1], reason: null, objectiveIds: [] } }],
    });
    expect(() => docFromJson(bare('table'))).toThrow(/notes doc|Invalid content/);
    expect(() => docFromJson(bare('diagram'))).toThrow(/notes doc|Invalid content/);
  });
});

describe('tableGrid and diagramSpec', () => {
  it('reads a table back as its caption, its headings and its rows of plain text', () => {
    expect(tableGrid(compareTable())).toEqual({
      caption: 'Planning vs learning',
      columns: ['Method', 'Needs a model', 'Cost'],
      rows: [
        ['Value iteration', 'yes', 'one sweep per step'],
        ['Q-learning', 'no', ''],
      ],
    });
  });

  it('gives a table with no heading row no columns, and every row as a row', () => {
    const { table: t, table_row: tr, table_cell: td } = notesSchema.nodes;
    const cell = (text: string) => td!.create({ header: false }, inlineToNodes(notesSchema, text, 'user', null, 1));
    const node = t!.create({ blockId: 'b_t', pages: [1] }, [tr!.create(null, [cell('a'), cell('b')])]);
    expect(tableGrid(node)).toEqual({ caption: null, columns: [], rows: [['a', 'b']] });
  });

  it('reads a diagram back as what a layout needs', () => {
    expect(diagramSpec(flowDiagram())).toEqual({
      layout: 'cycle',
      title: 'The agent loop',
      nodes: [
        { id: 'n1', label: 'Observe', parent: null, group: null, pages: [7] },
        { id: 'n2', label: 'Act', parent: null, group: null, pages: [] },
        { id: 'n3', label: 'Reward', parent: null, group: null, pages: [8] },
      ],
      edges: [
        { from: 'n1', to: 'n2', label: null },
        { from: 'n2', to: 'n3', label: 'environment' },
      ],
    });
  });

  it('hands back copies, never the node’s own arrays', () => {
    const node = flowDiagram();
    const spec = diagramSpec(node);
    spec.nodes[0]!.pages.push(99);
    spec.edges[0]!.label = 'changed';
    expect(diagramSpec(node).nodes[0]!.pages).toEqual([7]);
    expect((node.attrs.edges as { label: string | null }[])[0]!.label).toBeNull();
  });
});

describe('table and diagram — walking the document', () => {
  const doc = () =>
    docOf(heading('b_t', 1, 'Planning'), para('b_p', 'Before.', 'ingest', null, [4]), compareTable(), flowDiagram());

  it('is one outline line each: rows with " | ", a diagram as title, labels, then edges', () => {
    const outline = docOutline(doc());
    expect(outline.map((entry) => entry.kind)).toEqual(['heading', 'paragraph', 'table', 'diagram']);

    const t = outline[2]!;
    expect(t.text).toBe(
      'Planning vs learning: Method | Needs a model | Cost || Value iteration | yes | one sweep per step || Q-learning | no |',
    );
    expect(t.learnerText).toBe(true);
    expect(t.path).toEqual(['Planning']);

    const d = outline[3]!;
    expect(d.text).toBe('The agent loop: Observe, Act, Reward; Observe -> Act, Act -> Reward (environment)');
    expect(d.learnerText).toBe(false);
  });

  it('says where a node sits when the layout depends on it', () => {
    const tree = diagram(
      'b_tree',
      [
        { id: 'a', label: 'MDP' },
        { id: 'b', label: 'Policy', parent: 'a' },
        { id: 'c', label: 'Greedy', group: 'Planning' },
      ],
      { layout: 'hierarchy' },
    );
    expect(diagramText(tree)).toBe('MDP, Policy (under MDP), Greedy [Planning]');
    expect(tableText(table('b_x', ['A', 'B'], [['1', '2']]))).toBe('A | B || 1 | 2');
  });

  it('keeps an agent-only table to the short outline and a learner one to the long', () => {
    const long = Array.from({ length: 12 }, (_, i) => [`row ${String(i)} alpha beta`, 'gamma delta epsilon']);
    const agents = docOutline(docOf(table('b_a', ['One', 'Two'], long)))[0]!;
    expect(agents.text.endsWith('…')).toBe(true);
    const learners = docOutline(docOf(table('b_l', ['One', 'Two'], long, { by: 'user' })))[0]!;
    expect(learners.text.endsWith('…')).toBe(false);
    expect(learners.text.length).toBeGreaterThan(agents.text.length);
  });

  it('reports the pages of its rows and nodes as the block’s own', () => {
    const outline = docOutline(doc());
    expect(outline[2]!.pages).toEqual([5, 9]);
    expect(outline[3]!.pages).toEqual([7, 8]);
    expect(blockPages(para('b_p', 'x', 'ingest', null, [4]))).toEqual([4]);
    expect(blocksForPages(doc(), [9])).toEqual(['b_tab']);
    expect(blocksForPages(doc(), [8])).toEqual(['b_dia']);
    expect(blocksForPages(doc(), [5, 7])).toEqual(['b_tab', 'b_dia']);
  });

  it('is in the outline near an anchor like any other block', () => {
    expect(docOutlineNear(doc(), 'b_tab', 1).map((entry) => entry.blockId)).toEqual(['b_t', 'b_p', 'b_tab', 'b_dia']);
  });

  it('reports a cell the learner typed as their span, against the table', () => {
    expect(learnerSpans(doc())).toEqual([
      expect.objectContaining({ blockId: 'b_tab', text: 'one sweep per step' }),
    ]);
    expect(hasLearnerText(compareTable())).toBe(true);
    expect(hasLearnerText(flowDiagram())).toBe(false);
  });

  it('does not run two learner cells, or two learner labels, together', () => {
    const t = table('b_t2', ['A', 'B'], [['mine', 'also mine']], { by: 'user' });
    expect(learnerSpans(docOf(t)).map((span) => span.text)).toEqual(['A', 'B', 'mine', 'also mine']);
    const d = diagram('b_d2', [{ id: 'a', label: 'first' }, { id: 'b', label: 'second' }], { by: 'user' });
    expect(learnerSpans(docOf(d)).map((span) => [span.blockId, span.text])).toEqual([
      ['b_d2', 'first'],
      ['b_d2', 'second'],
    ]);
  });

  it('finds the block by id, and mints an id for the block only', () => {
    const d = doc();
    expect(blockPos(d, 'b_tab')!.node.type.name).toBe('table');
    expect(blockPos(d, 'b_dia')!.node.type.name).toBe('diagram');

    const unminted = docOf(table('', ['A', 'B'], [['1', '2']]), diagram('', [{ id: 'a', label: 'x' }, { id: 'b', label: 'y' }]));
    const state = stateOf(unminted);
    const tr = assignMissingBlockIds(state.tr)!;
    const after = state.apply(tr).doc;
    expect(blockAttrs(after.child(0)).blockId).toMatch(/^b_[0-9a-f]{12}$/);
    expect(blockAttrs(after.child(1)).blockId).toMatch(/^b_[0-9a-f]{12}$/);
    expect(after.child(0).child(0).attrs).toEqual({ pages: [] });
    expect(after.child(1).child(0).attrs.nodeId).toBe('a');
    expect(assignMissingBlockIds(stateOf(after).tr)).toBeNull();
  });
});
