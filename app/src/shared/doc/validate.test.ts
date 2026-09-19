/**
 * The ingest's gate (§2). The input here is `unknown` on purpose — it is whatever a model
 * returned — so the cases are the ones a model actually produces: a page the deck does not have,
 * a missing `prov`, a heading at level 7, a rect with three corners, a `kind` nobody defined.
 */

import { describe, expect, it } from 'vitest';
import { docFromJson, blockAttrs } from './schema.js';
import { DRAFT_BLOCK_JSON_SCHEMA, draftsToDocJson, validateDrafts } from './validate.js';
import type { DocBlockDraft } from './types.js';

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
