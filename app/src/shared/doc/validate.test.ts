/**
 * The ingest's gate (§2). The input here is `unknown` on purpose — it is whatever a model
 * returned — so the cases are the ones a model actually produces: a page the deck does not have,
 * a missing `prov`, a heading at level 7, a rect with three corners, a `kind` nobody defined.
 */

import { describe, expect, it } from 'vitest';
import { docFromJson, blockAttrs } from './schema.js';
import {
  DIAGRAM_DRAFT_JSON_SCHEMA,
  DRAFT_BLOCK_JSON_SCHEMA,
  TABLE_DRAFT_JSON_SCHEMA,
  draftsToDocJson,
  validateDiagramDraft,
  validateDrafts,
  validateTableDraft,
} from './validate.js';
import type { DocBlockDraft, Provenance } from './types.js';

const ok = { kind: 'paragraph', text: 'Value iteration converges.', prov: { pages: [5], reason: null } };

describe('validateDrafts', () => {
  it('takes an array or a { blocks } wrapper, and nothing else', () => {
    expect(validateDrafts([ok], 10).blocks).toHaveLength(1);
    expect(validateDrafts({ blocks: [ok] }, 10).blocks).toHaveLength(1);
    expect(validateDrafts(null, 10)).toEqual({ blocks: [], issues: [] });
    expect(validateDrafts('[]', 10)).toEqual({ blocks: [], issues: [] });
  });

  it('rejects a block with neither pages nor a reason', () => {
    const { blocks, issues } = validateDrafts(
      [{ kind: 'paragraph', text: 'From nowhere.', prov: { pages: [], reason: '' } }, ok],
      10,
    );
    expect(blocks).toHaveLength(1);
    expect(issues).toEqual([{ index: 0, reason: 'no_provenance' }]);
  });

  it('rejects a block with no prov at all', () => {
    expect(validateDrafts([{ kind: 'paragraph', text: 'Bare.' }], 10).issues).toEqual([
      { index: 0, reason: 'no_provenance' },
    ]);
  });

  it('keeps a bridging block that has only a reason', () => {
    const { blocks, issues } = validateDrafts(
      [{ kind: 'paragraph', text: 'This links the two ideas.', prov: { pages: [], reason: 'bridges p. 12 and p. 13' } }],
      20,
    );
    expect(issues).toEqual([]);
    expect(blocks[0]!.prov).toEqual({ pages: [], reason: 'bridges p. 12 and p. 13' });
  });

  it('drops a page the deck does not have and keeps the block', () => {
    const { blocks, issues } = validateDrafts(
      [{ kind: 'paragraph', text: 'Mostly right.', prov: { pages: [5, 99, 0, -2, 6.4], reason: null } }],
      10,
    );
    expect(issues).toEqual([{ index: 0, reason: 'bad_page' }]);
    expect(blocks[0]!.prov.pages).toEqual([5, 6]); // 6.4 truncates to a page the deck has
  });

  it('rejects the block when dropping its bad pages leaves no provenance', () => {
    const { blocks, issues } = validateDrafts(
      [{ kind: 'paragraph', text: 'All invented.', prov: { pages: [99], reason: null } }],
      10,
    );
    expect(blocks).toEqual([]);
    expect(issues).toEqual([
      { index: 0, reason: 'bad_page' },
      { index: 0, reason: 'no_provenance' },
    ]);
  });

  it('reports an empty body', () => {
    const input = [
      { kind: 'paragraph', text: '   ', prov: { pages: [1], reason: null } },
      { kind: 'heading', level: 2, text: '', prov: { pages: [1], reason: null } },
      { kind: 'bullets', items: ['', '  '], prov: { pages: [1], reason: null } },
      { kind: 'math', tex: '', prov: { pages: [1], reason: null } },
    ];
    const { blocks, issues } = validateDrafts(input, 10);
    expect(blocks).toEqual([]);
    expect(issues.map((issue) => issue.reason)).toEqual(['empty', 'empty', 'empty', 'empty']);
  });

  it('reports a kind nobody defined, and a block that is not an object', () => {
    const { blocks, issues } = validateDrafts([{ kind: 'table', rows: [] }, 'nope', 42, null], 10);
    expect(blocks).toEqual([]);
    expect(issues.map((issue) => issue.reason)).toEqual(['unknown_kind', 'unknown_kind', 'unknown_kind', 'unknown_kind']);
  });

  it('clamps a heading level to 1–3', () => {
    const levels = [0, 1, 3, 7, 2.6].map(
      (level) =>
        validateDrafts([{ kind: 'heading', level, text: 'H', prov: { pages: [1], reason: null } }], 10)
          .blocks[0] as Extract<DocBlockDraft, { kind: 'heading' }>,
    );
    expect(levels.map((block) => block.level)).toEqual([1, 1, 3, 3, 2]);
  });

  it('coerces a malformed figure rect to null and keeps the figure', () => {
    const bad = [
      { x0: 0, y0: 0, x1: 1 },
      { x0: 0.5, y0: 0, x1: 0.2, y1: 1 },
      { x0: -1, y0: 0, x1: 2, y1: 1 },
      'nope',
      null,
    ];
    for (const rect of bad) {
      const { blocks, issues } = validateDrafts(
        [{ kind: 'figure', page: 3, rect, caption: 'A diagram', prov: { pages: [3], reason: null } }],
        10,
      );
      expect(issues).toEqual([]);
      expect((blocks[0] as Extract<DocBlockDraft, { kind: 'figure' }>).rect).toBeNull();
    }
    const good = validateDrafts(
      [{ kind: 'figure', page: 3, rect: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }, caption: '', prov: { pages: [3], reason: null } }],
      10,
    );
    expect((good.blocks[0] as Extract<DocBlockDraft, { kind: 'figure' }>).rect).toEqual({ x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 });
  });

  it('rejects a figure whose page the deck does not have — a figure is its page', () => {
    const { blocks, issues } = validateDrafts(
      [{ kind: 'figure', page: 99, rect: null, caption: 'x', prov: { pages: [], reason: 'evidentiary' } }],
      10,
    );
    expect(blocks).toEqual([]);
    expect(issues).toEqual([{ index: 0, reason: 'bad_page' }]);
  });

  it('puts a figure’s own page into its provenance', () => {
    const { blocks } = validateDrafts(
      [{ kind: 'figure', page: 4, rect: null, caption: 'x', prov: { pages: [], reason: 'evidentiary' } }],
      10,
    );
    expect(blocks[0]!.prov.pages).toEqual([4]);
  });

  it('keeps code indentation but trims prose', () => {
    const { blocks } = validateDrafts(
      [
        { kind: 'code', text: '  if x:\n    return 1  \n', lang: ' python ', prov: { pages: [2], reason: null } },
        { kind: 'paragraph', text: '  Padded.  ', prov: { pages: [2], reason: null } },
      ],
      10,
    );
    const code = blocks[0] as Extract<DocBlockDraft, { kind: 'code' }>;
    expect(code.text).toBe('  if x:\n    return 1');
    expect(code.lang).toBe('python');
    expect((blocks[1] as Extract<DocBlockDraft, { kind: 'paragraph' }>).text).toBe('Padded.');
  });

  it('de-duplicates pages and keeps their order', () => {
    const { blocks } = validateDrafts(
      [{ kind: 'paragraph', text: 'x', prov: { pages: [3, 1, 3], reason: null } }],
      10,
    );
    expect(blocks[0]!.prov.pages).toEqual([3, 1]);
  });
});

describe('draftsToDocJson', () => {
  it('produces a document docFromJson accepts, titled, with provenance on every block', () => {
    const { blocks } = validateDrafts(
      [
        { kind: 'heading', level: 2, text: 'Value iteration', prov: { pages: [5], reason: null } },
        ok,
        { kind: 'bullets', items: ['One.', 'Two.'], prov: { pages: [5], reason: null } },
        { kind: 'figure', page: 6, rect: null, caption: 'The loop', prov: { pages: [6], reason: null } },
      ],
      10,
    );
    const doc = docFromJson(draftsToDocJson('CS3249 Lecture 4', blocks));
    expect(doc.firstChild!.type.name).toBe('heading');
    expect(doc.firstChild!.textContent).toBe('CS3249 Lecture 4');
    expect(doc.childCount).toBe(5);
    doc.forEach((node) => {
      const attrs = blockAttrs(node);
      expect(attrs.blockId).toMatch(/^b_[0-9a-f]{12}$/);
      expect(attrs.pages.length > 0 || attrs.reason !== null).toBe(true);
    });
  });

  it('authors the whole document as the ingest', () => {
    const doc = docFromJson(draftsToDocJson('Deck', validateDrafts([ok], 10).blocks));
    doc.descendants((node) => {
      if (!node.isText) return true;
      expect(node.marks.find((mark) => mark.type.name === 'author')!.attrs).toMatchObject({
        by: 'ingest',
        editId: null,
      });
      return false;
    });
  });

  it('still opens when every block failed validation', () => {
    const doc = docFromJson(draftsToDocJson('Empty deck', []));
    expect(doc.childCount).toBe(2);
    doc.check();
  });
});

describe('DRAFT_BLOCK_JSON_SCHEMA', () => {
  it('describes { blocks: DocBlockDraft[] } with one object shape and a kind enum', () => {
    const schema = DRAFT_BLOCK_JSON_SCHEMA as {
      properties: { blocks: { items: { properties: Record<string, unknown>; required: string[] } } };
    };
    const item = schema.properties.blocks.items;
    expect(item.required).toEqual(['kind', 'prov']);
    expect((item.properties.kind as { enum: string[] }).enum).toEqual([
      'heading',
      'paragraph',
      'bullets',
      'numbers',
      'code',
      'math',
      'figure',
    ]);
    // Permissive on purpose: no oneOf, so a model cannot fail branch selection and return nothing.
    expect(JSON.stringify(DRAFT_BLOCK_JSON_SCHEMA)).not.toContain('oneOf');
    expect(item.properties.prov).toBeDefined();
  });

  it('is plain JSON, so it can be sent as a structured-output schema', () => {
    expect(JSON.parse(JSON.stringify(DRAFT_BLOCK_JSON_SCHEMA))).toEqual(DRAFT_BLOCK_JSON_SCHEMA);
  });
});

// ── the table and the diagram: their own validators (2026-10-01) ────────────────────────────

const PROV: Provenance = { pages: [5], reason: null };

const rawTable = () => ({
  caption: '  Planning vs learning ',
  columns: ['Method', ' Needs a model '],
  rows: [
    { cells: ['Value iteration', 'yes'], pages: [5] },
    { cells: ['Q-learning', ''] },
  ],
});

const rawDiagram = () => ({
  layout: 'flow',
  title: 'The agent loop',
  nodes: [
    { id: 'n1', label: 'Observe', pages: [7] },
    { id: 'n2', label: ' Act ' },
    { id: 'n3', label: 'Reward' },
  ],
  edges: [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3', label: 'environment' },
  ],
});

describe('the ingest does not write tables or diagrams', () => {
  it('validateDrafts still refuses both kinds', () => {
    const { blocks, issues } = validateDrafts(
      [
        { kind: 'table', ...rawTable(), prov: PROV },
        { kind: 'diagram', ...rawDiagram(), prov: PROV },
      ],
      10,
    );
    expect(blocks).toEqual([]);
    expect(issues).toEqual([
      { index: 0, reason: 'unknown_kind' },
      { index: 1, reason: 'unknown_kind' },
    ]);
  });

  it('DRAFT_BLOCK_JSON_SCHEMA does not offer them', () => {
    const text = JSON.stringify(DRAFT_BLOCK_JSON_SCHEMA);
    expect(text).not.toContain('table');
    expect(text).not.toContain('diagram');
  });
});

describe('validateTableDraft', () => {
  it('returns the typed draft, trimmed, with the caller’s provenance', () => {
    const { draft, problems } = validateTableDraft(rawTable(), 10, PROV);
    expect(problems).toEqual([]);
    expect(draft).toEqual({
      kind: 'table',
      caption: 'Planning vs learning',
      columns: ['Method', 'Needs a model'],
      rows: [
        { cells: ['Value iteration', 'yes'], pages: [5] },
        { cells: ['Q-learning', ''], pages: [] },
      ],
      prov: { pages: [5], reason: null },
    });
    expect(() => docFromJson(draftsToDocJson('Deck', [draft!]))).not.toThrow();
  });

  it('takes a { table } wrapper, rows as bare arrays and numbers as cells', () => {
    const { draft, problems } = validateTableDraft(
      { table: { columns: ['n', 'n squared'], rows: [[2, 4], ['3', 9]] } },
      10,
      PROV,
    );
    expect(problems).toEqual([]);
    expect(draft!.caption).toBeNull();
    expect(draft!.rows.map((row) => row.cells)).toEqual([['2', '4'], ['3', '9']]);
  });

  it('needs provenance: a page of this deck or a reason', () => {
    const none = validateTableDraft(rawTable(), 10, { pages: [], reason: ' ' });
    expect(none.draft).toBeNull();
    expect(none.problems).toEqual(['no provenance: neither a page of the deck nor a reason']);

    const outside = validateTableDraft(rawTable(), 10, { pages: [99], reason: null });
    expect(outside.draft).toBeNull();
    expect(outside.problems).toHaveLength(2);

    const repaired = validateTableDraft(rawTable(), 10, { pages: [99, 4], reason: null });
    expect(repaired.draft!.prov).toEqual({ pages: [4], reason: null });
    expect(repaired.problems).toEqual(['provenance: a page outside the deck was dropped']);

    expect(validateTableDraft(rawTable(), 10, { pages: [], reason: 'asked for' }).draft!.prov).toEqual({
      pages: [],
      reason: 'asked for',
    });
  });

  it('drops a row’s page the deck does not have and keeps the row', () => {
    const raw = rawTable();
    raw.rows[0]!.pages = [5, 0, 11, 5];
    const { draft, problems } = validateTableDraft(raw, 10, PROV);
    expect(draft!.rows[0]!.pages).toEqual([5]);
    expect(problems).toEqual(['table: row 1 cited a page outside the deck, dropped']);
  });

  it('wants 2 to 6 columns, each with a heading', () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => `c${String(i)}`);
    const one = validateTableDraft({ columns: cols(1), rows: [{ cells: ['a'] }] }, 10, PROV);
    expect(one.draft).toBeNull();
    expect(one.problems).toEqual(['table: 1 columns (2 to 6 allowed)']);

    const seven = validateTableDraft({ columns: cols(7), rows: [{ cells: cols(7) }] }, 10, PROV);
    expect(seven.draft).toBeNull();
    expect(seven.problems).toEqual(['table: 7 columns (2 to 6 allowed)']);

    expect(validateTableDraft({ columns: cols(6), rows: [{ cells: cols(6) }] }, 10, PROV).draft).not.toBeNull();

    const blank = validateTableDraft({ columns: ['Method', ' '], rows: [{ cells: ['a', 'b'] }] }, 10, PROV);
    expect(blank.draft).toBeNull();
    expect(blank.problems).toEqual(['table: column 2 has no heading']);

    expect(validateTableDraft({ rows: [] }, 10, PROV).problems).toEqual([
      'table: 0 columns (2 to 6 allowed)',
      'table: 0 rows (1 to 12 allowed)',
    ]);
  });

  it('wants 1 to 12 rows', () => {
    const rows = (n: number) => Array.from({ length: n }, () => ({ cells: ['a', 'b'] }));
    expect(validateTableDraft({ columns: ['A', 'B'], rows: rows(0) }, 10, PROV).problems).toEqual([
      'table: 0 rows (1 to 12 allowed)',
    ]);
    expect(validateTableDraft({ columns: ['A', 'B'], rows: rows(13) }, 10, PROV).draft).toBeNull();
    expect(validateTableDraft({ columns: ['A', 'B'], rows: rows(12) }, 10, PROV).draft!.rows).toHaveLength(12);
  });

  it('refuses a row with the wrong number of cells, and pads nothing', () => {
    const raw = rawTable();
    raw.rows[1]!.cells = ['Q-learning'];
    raw.rows.push({ cells: ['a', 'b', 'c'] });
    const { draft, problems } = validateTableDraft(raw, 10, PROV);
    expect(draft).toBeNull();
    expect(problems).toEqual(['table: row 2 has 1 cells, expected 2', 'table: row 3 has 3 cells, expected 2']);
  });

  it('refuses what is not an object', () => {
    expect(validateTableDraft(null, 10, PROV)).toEqual({ draft: null, problems: ['table: not an object'] });
    expect(validateTableDraft('a | b', 10, PROV).draft).toBeNull();
  });
});

describe('validateDiagramDraft', () => {
  it('returns the typed draft, trimmed, with the caller’s provenance', () => {
    const { draft, problems } = validateDiagramDraft(rawDiagram(), 10, PROV);
    expect(problems).toEqual([]);
    expect(draft).toEqual({
      kind: 'diagram',
      layout: 'flow',
      title: 'The agent loop',
      nodes: [
        { id: 'n1', label: 'Observe', parent: null, group: null, pages: [7] },
        { id: 'n2', label: 'Act', parent: null, group: null, pages: [] },
        { id: 'n3', label: 'Reward', parent: null, group: null, pages: [] },
      ],
      edges: [
        { from: 'n1', to: 'n2', label: null },
        { from: 'n2', to: 'n3', label: 'environment' },
      ],
      prov: { pages: [5], reason: null },
    });
    expect(() => docFromJson(draftsToDocJson('Deck', [draft!]))).not.toThrow();
  });

  it('takes a { diagram } wrapper and a diagram with no edges', () => {
    const { nodes, layout } = rawDiagram();
    const { draft, problems } = validateDiagramDraft({ diagram: { layout, nodes } }, 10, PROV);
    expect(problems).toEqual([]);
    expect(draft!.edges).toEqual([]);
    expect(draft!.title).toBeNull();
  });

  it('needs provenance, and drops a node’s page the deck does not have', () => {
    expect(validateDiagramDraft(rawDiagram(), 10, { pages: [], reason: null }).draft).toBeNull();
    const raw = rawDiagram();
    raw.nodes[0]!.pages = [7, 70];
    const { draft, problems } = validateDiagramDraft(raw, 10, PROV);
    expect(draft!.nodes[0]!.pages).toEqual([7]);
    expect(problems).toEqual(['diagram: node "n1" cited a page outside the deck, dropped']);
  });

  it('wants a layout it knows', () => {
    const { draft, problems } = validateDiagramDraft({ ...rawDiagram(), layout: 'spiral' }, 10, PROV);
    expect(draft).toBeNull();
    expect(problems).toEqual(['diagram: layout must be one of flow, hierarchy, compare, cycle']);
  });

  it('wants 2 to 12 nodes', () => {
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${String(i)}`, label: `L${String(i)}` }));
    expect(validateDiagramDraft({ layout: 'flow', nodes: nodes(1) }, 10, PROV).problems).toEqual([
      'diagram: 1 nodes (2 to 12 allowed)',
    ]);
    expect(validateDiagramDraft({ layout: 'flow', nodes: nodes(13) }, 10, PROV).draft).toBeNull();
    expect(validateDiagramDraft({ layout: 'flow', nodes: nodes(12) }, 10, PROV).draft!.nodes).toHaveLength(12);
    expect(validateDiagramDraft({ layout: 'flow' }, 10, PROV).draft).toBeNull();
  });

  it('wants every id present and unique', () => {
    const raw = rawDiagram();
    raw.nodes[1]!.id = 'n1';
    raw.nodes[2]!.id = '  ';
    raw.edges = [];
    const { draft, problems } = validateDiagramDraft(raw, 10, PROV);
    expect(draft).toBeNull();
    expect(problems).toEqual(['diagram: node id "n1" is used more than once', 'diagram: node 3 has no id']);
  });

  it('wants every label present and at most 80 characters', () => {
    const raw = rawDiagram();
    raw.nodes[0]!.label = '';
    raw.nodes[1]!.label = 'x'.repeat(81);
    raw.nodes[2]!.label = 'y'.repeat(80);
    const { draft, problems } = validateDiagramDraft(raw, 10, PROV);
    expect(draft).toBeNull();
    expect(problems).toEqual([
      'diagram: node "n1" has no label',
      'diagram: node "n2" has a label of 81 characters (at most 80)',
    ]);
  });

  it('drops an edge with a missing endpoint and keeps the diagram', () => {
    const raw = rawDiagram();
    raw.edges.push({ from: 'n3', to: 'n9' }, { from: '', to: 'n1' });
    const { draft, problems } = validateDiagramDraft(raw, 10, PROV);
    expect(draft!.edges).toHaveLength(2);
    expect(problems).toEqual([
      'diagram: edge 3 ("n3" -> "n9") names a node that does not exist, dropped',
      'diagram: edge 4 ("" -> "n1") names a node that does not exist, dropped',
    ]);
  });

  it('refuses a parent that is not a node', () => {
    const raw = { ...rawDiagram(), layout: 'hierarchy', edges: [] } as ReturnType<typeof rawDiagram>;
    (raw.nodes[1] as { parent?: string }).parent = 'n1';
    (raw.nodes[2] as { parent?: string }).parent = 'root';
    const { draft, problems } = validateDiagramDraft(raw, 10, PROV);
    expect(draft).toBeNull();
    expect(problems).toEqual(['diagram: node "n3" names a parent "root" that is not a node']);
  });

  it('refuses a node that is its own ancestor, at any distance', () => {
    const chain = (parents: (string | null)[]) => ({
      layout: 'hierarchy',
      nodes: parents.map((parent, i) => ({ id: `n${String(i + 1)}`, label: `L${String(i + 1)}`, parent })),
    });
    expect(validateDiagramDraft(chain([null, 'n1', 'n2']), 10, PROV).draft).not.toBeNull();

    const self = validateDiagramDraft(chain(['n1', null]), 10, PROV);
    expect(self.draft).toBeNull();
    expect(self.problems).toEqual(['diagram: node "n1" is its own ancestor']);

    const loop = validateDiagramDraft(chain(['n3', 'n1', 'n2', null]), 10, PROV);
    expect(loop.draft).toBeNull();
    expect(loop.problems).toEqual([
      'diagram: node "n1" is its own ancestor',
      'diagram: node "n2" is its own ancestor',
      'diagram: node "n3" is its own ancestor',
    ]);
  });

  it('wants a group on every node of a compare, and on no other layout', () => {
    const raw = { ...rawDiagram(), layout: 'compare', edges: [] } as ReturnType<typeof rawDiagram>;
    (raw.nodes[0] as { group?: string }).group = 'Planning';
    (raw.nodes[1] as { group?: string }).group = ' ';
    (raw.nodes[2] as { group?: string }).group = 'Learning';
    const { draft, problems } = validateDiagramDraft(raw, 10, PROV);
    expect(draft).toBeNull();
    expect(problems).toEqual(['diagram: node "n2" has no group, and a compare layout needs one on every node']);

    (raw.nodes[1] as { group?: string }).group = 'Planning';
    expect(validateDiagramDraft(raw, 10, PROV).draft!.nodes.map((n) => n.group)).toEqual([
      'Planning',
      'Planning',
      'Learning',
    ]);
    expect(validateDiagramDraft(rawDiagram(), 10, PROV).draft).not.toBeNull();
  });

  it('refuses what is not an object', () => {
    expect(validateDiagramDraft([], 10, PROV)).toEqual({ draft: null, problems: ['diagram: not an object'] });
  });
});

describe('TABLE_DRAFT_JSON_SCHEMA and DIAGRAM_DRAFT_JSON_SCHEMA', () => {
  it('are flat, plain JSON, and ask for no prov', () => {
    for (const schema of [TABLE_DRAFT_JSON_SCHEMA, DIAGRAM_DRAFT_JSON_SCHEMA]) {
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
      expect(JSON.stringify(schema)).not.toContain('oneOf');
      expect(Object.keys(schema.properties as object)).not.toContain('prov');
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('name the fields the validators read', () => {
    const t = TABLE_DRAFT_JSON_SCHEMA as { required: string[]; properties: Record<string, unknown> };
    expect(t.required).toEqual(['columns', 'rows']);
    expect(Object.keys(t.properties)).toEqual(['caption', 'columns', 'rows']);

    const d = DIAGRAM_DRAFT_JSON_SCHEMA as {
      required: string[];
      properties: { layout: { enum: string[] }; nodes: { items: { properties: Record<string, unknown> } } };
    };
    expect(d.required).toEqual(['layout', 'nodes']);
    expect(Object.keys(d.properties)).toEqual(['layout', 'title', 'nodes', 'edges']);
    expect(d.properties.layout.enum).toEqual(['flow', 'hierarchy', 'compare', 'cycle']);
    expect(Object.keys(d.properties.nodes.items.properties)).toEqual(['id', 'label', 'parent', 'group', 'pages']);
  });
});
