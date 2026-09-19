/**
 * **Suggestions** (§5.4, §6) — and the one assertion the whole mechanism exists for:
 *
 *   *rejecting a suggestion leaves the learner's text byte-identical in the serialised doc.*
 *
 * It is asserted on `JSON.stringify(doc.toJSON())`, not on `textContent`: the promise is about
 * the document that gets saved to SQLite, so a reject that restored the characters but left a
 * stray mark, a split text node or a changed attr would still be a broken promise.
 */

import { describe, expect, it } from 'vitest';
import { docOf, mixed, para, stateOf } from './fixture.test-support.js';
import { acceptSuggestion, rejectSuggestion, suggestReplace, suggestionIds } from './suggest.js';
import { inlineToNodes } from './inline.js';
import { notesSchema } from './schema.js';

/** A learner sentence with Ellie either side of it — the §6 case, where suggestions arise. */
function learnerDoc(): ReturnType<typeof docOf> {
  return docOf(
    para('b_1', 'Ellie wrote the section opener.'),
    mixed('b_2', [
      { text: 'Value iteration converges. ', by: 'ellie', editId: 'e_1' },
      { text: 'It converges because the update is a contration mapping.', by: 'user' },
    ]),
  );
}

const input = {
  suggestionId: 'sg_1',
  by: 'max' as const,
  blockId: 'b_2',
  quote: 'contration',
  replacement: 'contraction',
};

describe('suggestReplace', () => {
  it('strikes the quote and offers the replacement beside it', () => {
    const state = stateOf(learnerDoc());
    const tr = suggestReplace(state, input)!;
    expect(tr).not.toBeNull();
    const doc = state.apply(tr).doc;

    // Both halves are present, in order, and the learner's characters are still there.
    expect(doc.textContent).toContain('contrationcontraction');

    const del: string[] = [];
    const ins: string[] = [];
    doc.descendants((node) => {
      if (!node.isText) return true;
      for (const mark of node.marks) {
        if (mark.type.name === 'suggest_del') del.push(node.text ?? '');
        if (mark.type.name === 'suggest_ins') ins.push(node.text ?? '');
      }
      return false;
    });
    expect(del).toEqual(['contration']);
    expect(ins).toEqual(['contraction']);
    expect(suggestionIds(doc)).toEqual(['sg_1']);
  });

  it('keeps the learner as the author of the struck text, and the agent of the offer', () => {
    const state = stateOf(learnerDoc());
    const doc = state.apply(suggestReplace(state, input)!).doc;
    doc.descendants((node) => {
      if (!node.isText) return true;
      const author = node.marks.find((mark) => mark.type.name === 'author');
      if (node.marks.some((mark) => mark.type.name === 'suggest_del')) expect(author!.attrs.by).toBe('user');
      if (node.marks.some((mark) => mark.type.name === 'suggest_ins')) expect(author!.attrs.by).toBe('max');
      return false;
    });
  });

  it('finds a quote that a bold run split in two', () => {
    const doc = docOf(
      notesSchema.nodes.paragraph!.create(
        { blockId: 'b_1', pages: [], reason: 'mine', objectiveIds: [] },
        inlineToNodes(notesSchema, 'the **contration** mapping', 'user', null, 1),
      ),
    );
    const state = stateOf(doc);
    const tr = suggestReplace(state, { ...input, blockId: 'b_1', quote: 'the contration mapping', replacement: 'the contraction mapping' });
    expect(tr).not.toBeNull();
    expect(state.apply(tr!).doc.textContent).toBe('the contration mappingthe contraction mapping');
  });

  it('is null when the quote is not in the block verbatim, or the block is gone', () => {
    const state = stateOf(learnerDoc());
    expect(suggestReplace(state, { ...input, quote: 'a phrase nobody wrote' })).toBeNull();
    expect(suggestReplace(state, { ...input, blockId: 'b_missing' })).toBeNull();
    expect(suggestReplace(state, { ...input, quote: '  ' })).toBeNull();
  });
});

describe('acceptSuggestion', () => {
  it('drops the struck text and keeps the offer as ordinary agent text', () => {
    const before = stateOf(learnerDoc());
    const open = before.apply(suggestReplace(before, input)!);
    const doc = open.apply(acceptSuggestion(open, 'sg_1')!).doc;

    expect(doc.textContent).toContain('a contraction mapping');
    expect(doc.textContent).not.toContain('contration');
    expect(suggestionIds(doc)).toEqual([]);

    // The accepted text is Max's, and is not wearing an edit colour.
    let found = false;
    doc.descendants((node) => {
      if (node.isText && node.text === 'contraction') {
        found = true;
        const author = node.marks.find((mark) => mark.type.name === 'author')!;
        expect(author.attrs.by).toBe('max');
        expect(author.attrs.editId).toBeNull();
      }
      return true;
    });
    expect(found).toBe(true);
  });

  it('is null for an id the document does not carry', () => {
    const state = stateOf(learnerDoc());
    expect(acceptSuggestion(state, 'sg_nope')).toBeNull();
  });
});

describe('rejectSuggestion', () => {
  it('leaves the document byte-identical to what it was before the suggestion', () => {
    const before = stateOf(learnerDoc());
    const baseline = JSON.stringify(before.doc.toJSON());

    const open = before.apply(suggestReplace(before, input)!);
    expect(JSON.stringify(open.doc.toJSON())).not.toBe(baseline);

    const after = open.apply(rejectSuggestion(open, 'sg_1')!);
    expect(JSON.stringify(after.doc.toJSON())).toBe(baseline);
  });

  it('is byte-identical for a suggestion over a whole block, marks and splits included', () => {
    const before = stateOf(learnerDoc());
    const baseline = JSON.stringify(before.doc.toJSON());
    const whole = {
      ...input,
      quote: 'It converges because the update is a contration mapping.',
      replacement: 'It converges because the update is a **contraction** mapping.',
    };
    const open = before.apply(suggestReplace(before, whole)!);
    const after = open.apply(rejectSuggestion(open, 'sg_1')!);
    expect(JSON.stringify(after.doc.toJSON())).toBe(baseline);
  });

  it('leaves a second open suggestion alone', () => {
    const before = stateOf(learnerDoc());
    const one = before.apply(suggestReplace(before, input)!);
    const two = one.apply(
      suggestReplace(one, { ...input, suggestionId: 'sg_2', quote: 'Value iteration', replacement: 'Value-iteration' })!,
    );
    const after = two.apply(rejectSuggestion(two, 'sg_1')!);
    expect(suggestionIds(after.doc)).toEqual(['sg_2']);
    expect(after.doc.textContent).toContain('contration');
    expect(after.doc.textContent).toContain('Value-iteration');
  });

  it('is null for an id the document does not carry', () => {
    const state = stateOf(learnerDoc());
    expect(rejectSuggestion(state, 'sg_nope')).toBeNull();
  });
});
