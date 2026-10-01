/**
 * Update overview's carry-over (`notebooks.md` §2; #58): what the learner owns survives, under the
 * section it belongs to, and nothing the ingest wrote does.
 */
import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { NOTE_SLOT_REASON, type DocAuthor } from '../../shared/doc/types.js';
import { authorMark, blockAttrs, notesSchema } from '../../shared/doc/schema.js';
import { carryOver, carriedBlocks, normaliseHeading } from './carry.js';
import { EARLIER_NOTES_HEADING, mintOverview, validateOverview } from './overview.js';

const AT = 1_759_000_000_000;

function textOf(parts: { text: string; by: DocAuthor; editId?: string | null }[]): Node[] {
  return parts.map((p) => notesSchema.text(p.text, [authorMark(p.by, p.editId ?? null, AT)]));
}
function para(blockId: string, parts: { text: string; by: DocAuthor; editId?: string | null }[], pages: number[] = [1], reason: string | null = null): Node {
  return notesSchema.nodes.paragraph!.create({ blockId, pages, reason, objectiveIds: [] }, parts.length ? textOf(parts) : null);
}
function heading(blockId: string, level: 1 | 2 | 3, text: string, reason: string | null = null): Node {
  return notesSchema.nodes.heading!.create({ blockId, level, pages: [1], reason, objectiveIds: [] }, textOf([{ text, by: 'ingest' }]));
}
function bullet(blockId: string, text: string, by: DocAuthor = 'ingest'): Node {
  return notesSchema.nodes.bullet_list!.create({ blockId, pages: [2], reason: null, objectiveIds: [] }, [
    notesSchema.nodes.list_item!.create({ blockId: `${blockId}_i` }, [para(`${blockId}_p`, [{ text, by }], [2])]),
  ]);
}
function doc(...blocks: Node[]): Node {
  return notesSchema.nodes.doc!.create(null, blocks);
}

/** The new overview: sections "Heuristics" and "Abstraction". */
function fresh(): Node[] {
  const sections = (heading: string, pages: number[]) => ({ heading, pages, takeaway: `About ${heading}.`, ideas: [{ text: `${heading} idea.`, pages }] });
  const { overview } = validateOverview(
    {
      title: 'Planning',
      lede: { text: 'Lede.', pages: [1] },
      objectives: [{ title: 'Explain heuristics', statement: 's', criteria: [], quizSeeds: [], pages: [3] }],
      sections: [sections('Heuristics', [3, 4]), sections('Abstraction', [5])],
      greeting: 'Hi.',
      starterQuestions: ['a', 'b', 'c'],
    },
    { pageCount: 10, pageExists: () => true, fallbackTitle: 'x' },
  );
  return mintOverview(overview!, ['Explain heuristics']).nodes;
}

/** The old doc, as the learner left it. */
function old(): Node {
  return doc(
    heading('t', 1, 'Old title', 'title'),
    para('lede', [{ text: 'Old lede.', by: 'ingest' }]),
    heading('h1', 2, 'Heuristics — the basics!'),
    para('take', [{ text: 'Old takeaway.', by: 'ingest' }]),
    bullet('idea1', 'Old idea.'),
    para('mine', [{ text: 'h_max is **admissible** because ', by: 'user' }, { text: 'it never overestimates.', by: 'user' }], [3]),
    para('typed-in', [{ text: 'Ingest words, ', by: 'ingest' }, { text: 'then my words.', by: 'user' }], [4]),
    para('ellie-kept', [{ text: 'Ellie: one line kept.', by: 'ellie', editId: 'e_kept' }], [4]),
    para('ellie-applied', [{ text: 'Ellie: one line never kept.', by: 'ellie', editId: 'e_applied' }], [4]),
    para('slot1', [{ text: 'My note on heuristics.', by: 'user' }], [3, 4], NOTE_SLOT_REASON),
    heading('h2', 2, 'Scheduling'),
    para('mine2', [{ text: 'A scheduling thought.', by: 'user' }], [8]),
    bullet('kept-list', 'Max kept a bullet.', 'max'),
    para('slot2', [], [8], NOTE_SLOT_REASON),
  );
}

const ids = (nodes: readonly Node[]) => nodes.map((n) => blockAttrs(n).blockId);

describe('normaliseHeading', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normaliseHeading('Heuristics — the basics!')).toBe('heuristics the basics');
    expect(normaliseHeading('  HEURISTICS ')).toBe(normaliseHeading('heuristics'));
  });
});

describe('carriedBlocks', () => {
  it('carries learner text and kept edits, never ingest blocks, unkept edits or an empty slot', () => {
    const carried = carriedBlocks(old(), new Set(['ellie-kept', 'kept-list']));
    expect(carried.map((c) => blockAttrs(c.node).blockId)).toEqual(['mine', 'typed-in', 'ellie-kept', 'slot1', 'mine2', 'kept-list']);
    expect(carried[0]!.under).toEqual(['heuristics the basics', 'old title']);
  });
});

describe('carryOver', () => {
  it('keeps the learner\'s words byte-identical, marks and all', () => {
    const before = old();
    const { nodes } = carryOver(before, fresh(), new Set(['ellie-kept']));
    for (const id of ['mine', 'typed-in', 'mine2']) {
      const was = before.content.content.find((n) => blockAttrs(n).blockId === id)!;
      const now = nodes.find((n) => blockAttrs(n).blockId === id)!;
      expect(now.toJSON()).toEqual(was.toJSON());
    }
  });

  it('matches the whole heading: "Heuristics — the basics!" is not "Heuristics"', () => {
    const { nodes, stats } = carryOver(old(), fresh(), new Set(['ellie-kept', 'kept-list']));
    const a = nodes.findIndex((n) => n.type.name === 'heading' && n.textContent === 'Abstraction');
    // A reworded heading is a different section: its blocks go under Earlier notes, after it all.
    expect(ids(nodes).indexOf('mine')).toBeGreaterThan(a);
    expect(stats.earlier).toBe(stats.carried);
  });

  it('matches case- and punctuation-insensitively, and the learner\'s note takes the new slot\'s place', () => {
    const before = doc(
      heading('t', 1, 'Old', 'title'),
      heading('h', 2, 'HEURISTICS.'),
      para('mine', [{ text: 'mine', by: 'user' }], [3]),
      para('slot', [{ text: 'My note.', by: 'user' }], [9], NOTE_SLOT_REASON),
    );
    const next = fresh();
    const newSlotId = blockAttrs(next.find((n) => blockAttrs(n).reason === NOTE_SLOT_REASON)!).blockId;
    const { nodes, stats } = carryOver(before, next, new Set());
    const order = ids(nodes);
    const h = nodes.findIndex((n) => n.textContent === 'Heuristics');
    const a = nodes.findIndex((n) => n.textContent === 'Abstraction');
    expect(order.indexOf('mine')).toBeGreaterThan(h);
    expect(order.indexOf('mine')).toBeLessThan(order.indexOf('slot'));
    expect(order.indexOf('slot')).toBeLessThan(a);
    // The new empty slot is gone; the learner's one stands in it with the new section's pages.
    expect(order).not.toContain(newSlotId);
    const slot = nodes.find((n) => blockAttrs(n).blockId === 'slot')!;
    expect(slot.textContent).toBe('My note.');
    expect(blockAttrs(slot).pages).toEqual([3, 4]);
    expect(stats.earlier).toBe(0);
  });

  it('puts what matches nothing under a final "Earlier notes", in its old order', () => {
    const { nodes, stats } = carryOver(old(), fresh(), new Set(['ellie-kept', 'kept-list']));
    const earlierAt = nodes.findIndex((n) => n.type.name === 'heading' && n.textContent === EARLIER_NOTES_HEADING);
    expect(earlierAt).toBeGreaterThan(0);
    expect(blockAttrs(nodes[earlierAt]!).reason).toBeTruthy();
    expect(ids(nodes.slice(earlierAt + 1))).toEqual(['mine', 'typed-in', 'ellie-kept', 'slot1', 'mine2', 'kept-list']);
    expect(stats).toEqual({ carried: 6, earlier: 6, learnerBlocks: 4, keptBlocks: 2 });
  });

  it('drops every ingest block and every edit the learner did not keep', () => {
    const { nodes } = carryOver(old(), fresh(), new Set(['ellie-kept']));
    const all = ids(nodes);
    for (const gone of ['lede', 'h1', 'take', 'idea1', 'ellie-applied', 'slot2', 'h2', 'kept-list', 't']) expect(all).not.toContain(gone);
    expect(nodes[0]!.textContent).toBe('Planning');
    expect(() => doc(...nodes).check()).not.toThrow();
  });

  it('is the new overview alone when there is nothing to carry', () => {
    const next = fresh();
    expect(ids(carryOver(null, next, new Set()).nodes)).toEqual(ids(next));
    expect(ids(carryOver(doc(heading('t', 1, 'x', 'title'), para('p', [])), next, new Set()).nodes)).toEqual(ids(next));
  });
});
