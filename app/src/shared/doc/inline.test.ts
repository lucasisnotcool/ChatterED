/**
 * The closed inline subset, and the round trip. `aitext.ts` owns the same subset on the chat
 * side; these tests pin the two behaviours that file argues for — bold before italics, and a
 * marker with a space next to it is not a marker — plus the two this one adds (code spans, and
 * maths as a mark rather than as escaped text).
 */

import { describe, expect, it } from 'vitest';
import { blockToInline, inlineToNodes, nodesToInline } from './inline.js';
import { draftToNodes } from './ops.js';
import { notesSchema } from './schema.js';
import { docOf, para } from './fixture.test-support.js';

function marksOf(text: string): { text: string; marks: string[] }[] {
  return inlineToNodes(notesSchema, text, 'ellie', 'e_1', 1).map((node) => ({
    text: node.text ?? '',
    marks: node.marks.map((mark) => mark.type.name).filter((name) => name !== 'author').sort(),
  }));
}

function fragmentOf(text: string): ReturnType<typeof notesSchema.nodes.paragraph.create> {
  return notesSchema.nodes.paragraph!.create(
    { blockId: 'b_1', pages: [], reason: 'x', objectiveIds: [] },
    inlineToNodes(notesSchema, text, 'ellie', 'e_1', 1),
  );
}

describe('inlineToNodes', () => {
  it('authors every span it produces', () => {
    for (const node of inlineToNodes(notesSchema, 'a **b** `c` $d$', 'max', 'e_2', 9)) {
      const author = node.marks.find((mark) => mark.type.name === 'author')!;
      expect(author.attrs).toMatchObject({ by: 'max', editId: 'e_2', at: 9 });
    }
  });

  it('reads the four markers and nothing else', () => {
    expect(marksOf('plain **bold** *em* `code` $x^2$ end')).toEqual([
      { text: 'plain ', marks: [] },
      { text: 'bold', marks: ['strong'] },
      { text: ' ', marks: [] },
      { text: 'em', marks: ['em'] },
      { text: ' ', marks: [] },
      { text: 'code', marks: ['code'] },
      { text: ' ', marks: [] },
      { text: 'x^2', marks: ['math_inline'] },
      { text: ' end', marks: [] },
    ]);
  });

  it('leaves everything outside the subset literal', () => {
    // No headings, quotes, links or HTML: `aitext.ts`'s rule, and the same reason.
    const nodes = marksOf('# not a heading > not a quote [a](b) <img src=x>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.marks).toEqual([]);
  });

  it('takes bold before italics', () => {
    expect(marksOf('**x**')).toEqual([{ text: 'x', marks: ['strong'] }]);
  });

  it('needs a non-space next to the marker', () => {
    expect(marksOf('3 * 4 * 5')).toEqual([{ text: '3 * 4 * 5', marks: [] }]);
    expect(marksOf('a ** b ** c')).toEqual([{ text: 'a ** b ** c', marks: [] }]);
  });

  it('nests emphasis inside bold', () => {
    expect(marksOf('**a *b* c**')).toEqual([
      { text: 'a ', marks: ['strong'] },
      { text: 'b', marks: ['em', 'strong'] },
      { text: ' c', marks: ['strong'] },
    ]);
  });

  it('does not read a marker inside maths or code', () => {
    expect(marksOf('$a*b*c$')).toEqual([{ text: 'a*b*c', marks: ['math_inline'] }]);
    expect(marksOf('`a**b**c`')).toEqual([{ text: 'a**b**c', marks: ['code'] }]);
  });

  it('keeps the bold around a formula', () => {
    // The earliest marker wins, so `**` opens before `$` and the maths is inside it.
    expect(marksOf('**$x$**')).toEqual([{ text: 'x', marks: ['math_inline', 'strong'] }]);
  });

  it('leaves a lone dollar alone', () => {
    expect(marksOf('it costs $5 to run')).toEqual([{ text: 'it costs $5 to run', marks: [] }]);
  });
});

describe('nodesToInline', () => {
  it('round-trips everything the subset can express', () => {
    for (const text of [
      'plain text',
      'a **bold** word',
      'an *em* word',
      'a `code` word',
      'maths $x^2 + 1$ inline',
      '**a *nested* one**',
      'nothing # special > here',
    ]) {
      expect(nodesToInline(fragmentOf(text).content)).toBe(text);
    }
  });

  it('gives the text of a block as the subset, for a prompt or a quote', () => {
    expect(blockToInline(para('b_1', 'The **Bellman** update.'))).toBe('The **Bellman** update.');
  });

  it('flattens a nested block onto its own line', () => {
    const list = notesSchema.nodes.bullet_list!.create(
      { blockId: 'b_l', pages: [], reason: 'x', objectiveIds: [] },
      [
        notesSchema.nodes.list_item!.create({ blockId: 'b_i1' }, para('b_p1', 'One.')),
        notesSchema.nodes.list_item!.create({ blockId: 'b_i2' }, para('b_p2', 'Two.')),
      ],
    );
    expect(nodesToInline(docOf(list).content)).toBe('One.\nTwo.');
  });
});

describe('blockToInline — a table and a diagram', () => {
  it('puts a table’s row on one line, cells in order, markup kept', () => {
    const [node] = draftToNodes(
      notesSchema,
      [
        {
          kind: 'table',
          columns: ['Method', 'Cost'],
          rows: [{ cells: ['**Value** iteration', '$O(n^2)$'] }, { cells: ['Q-learning', ''] }],
          prov: { pages: [5], reason: null },
        },
      ],
      'ellie',
      null,
    );
    expect(blockToInline(node!)).toBe('Method | Cost\n**Value** iteration | $O(n^2)$\nQ-learning | ');
  });

  it('puts each diagram label on its own line', () => {
    const [node] = draftToNodes(
      notesSchema,
      [
        {
          kind: 'diagram',
          layout: 'flow',
          nodes: [
            { id: 'a', label: 'Observe' },
            { id: 'b', label: '*Act*' },
          ],
          prov: { pages: [5], reason: null },
        },
      ],
      'ellie',
      null,
    );
    expect(blockToInline(node!)).toBe('Observe\n*Act*');
  });
});
