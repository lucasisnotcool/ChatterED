/** The chunker's three explain modes (migration 033, 2026-10-07; `ExplainMode`). */
import { describe, expect, it } from 'vitest';
import { noteChunks } from './chunk.js';
import { doc, h, list, p, table, wordsOf } from './fixtures.test-support.js';

const NB = 'nb_1';
const O = { notebookId: NB, title: 'Lecture-complex v4.0' };

describe('noteChunks: explain comments', () => {
  const d = doc(
    h('s', 2, 'Heuristics', [13]),
    p('b1', `Admissible heuristics never overestimate. ${wordsOf(40)}`, [13]),
    list('l', ['Consistent', 'Informative'], [14]),
    table('t', ['Name', 'Means'], [['h_max', 'the max']], { pages: [15] }),
  );
  const explains = new Map([
    ['b1', 'Because the true cost is a lower bound.'],
    ['l_li1', 'More informative means fewer nodes expanded.'],
    ['t', 'A table of heuristics.'],
  ]);

  it('reads nothing in mode off, whatever comments there are', () => {
    expect(noteChunks(d, { ...O, explains, explainMode: 'off' })).toEqual(noteChunks(d, O));
  });

  it('append: the embedded text gets the explains of the chunk, its items included; the text does not', () => {
    const { chunks, units } = noteChunks(d, { ...O, explains, explainMode: 'append' });
    const plain = noteChunks(d, O);
    expect(chunks.map((c) => c.text)).toEqual(plain.chunks.map((c) => c.text));
    const first = chunks.find((c) => c.blockIds.includes('b1'))!;
    expect(first.embedText.endsWith('\nBecause the true cost is a lower bound.')).toBe(true);
    expect(first.hash).not.toBe(plain.chunks.find((c) => c.blockIds.includes('b1'))!.hash);
    expect(chunks.find((c) => c.blockIds.includes('l'))!.embedText).toContain('More informative means fewer nodes expanded.');
    expect(chunks.find((c) => c.key.endsWith(':t#0'))!.embedText).toContain('A table of heuristics.');
    const unit = units.find((u) => u.blockId === 'l')!;
    expect(unit.embedText).toContain('More informative');
    expect(unit.text).not.toContain('More informative');
    expect(chunks.every((c) => c.kind === 'note')).toBe(true);
  });

  it('separate: one explain chunk per comment, resolving to its block (then the member holding it)', () => {
    const { chunks, units } = noteChunks(d, { ...O, explains, explainMode: 'separate' });
    const plain = noteChunks(d, O);
    // The note chunks and units are untouched, so their vectors are kept.
    expect(chunks.filter((c) => c.kind === 'note')).toEqual(plain.chunks);
    expect(units).toEqual(plain.units);
    const ex = chunks.filter((c) => c.kind === 'explain');
    expect(ex.map((c) => [c.key, c.blockIds, c.pages])).toEqual([
      [`explain:${NB}:b1`, ['b1'], [13]],
      [`explain:${NB}:l_li1`, ['l_li1', 'l'], [14]],
      [`explain:${NB}:t`, ['t'], [15]],
    ]);
    expect(ex[0]!.text).toContain('Admissible heuristics');
    // A list item's own text is its snippet, not the whole list's.
    expect(ex[1]!.text).toBe('Informative');
    expect(ex[1]!.embedText).toBe('Lecture-complex v4.0 › Heuristics\nMore informative means fewer nodes expanded.');
    expect(ex[2]!.text).toContain('h_max');
  });

  it('a comment on a block the chunker does not index, or on no block, makes nothing', () => {
    const { chunks } = noteChunks(d, { ...O, explains: new Map([['s', 'A heading.'], ['nope', 'x']]), explainMode: 'separate' });
    expect(chunks.some((c) => c.kind === 'explain')).toBe(false);
  });
});
