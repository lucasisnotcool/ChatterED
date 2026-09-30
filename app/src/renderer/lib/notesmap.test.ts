import { describe, expect, it } from 'vitest';
import {
  currentEntry,
  entryDepths,
  entryLabel,
  fillWords,
  headingLevel,
  mapEntries,
  pagesFromAttr,
  sameBlocks,
  sectionFill,
  type MapBlock,
} from './notesmap.js';
import type { ProgressObjectiveView, ProgressView } from '../../shared/doc/types.js';

function objective(id: string, fill: 0 | 0.5 | 1, over: Partial<ProgressObjectiveView> = {}): ProgressObjectiveView {
  return {
    objectiveId: id,
    title: id,
    statement: '',
    criteria: [],
    pages: [],
    blockIds: [],
    fill,
    level: fill === 1 ? 3 : fill === 0.5 ? 2 : 0,
    assumedByDeck: false,
    evidence: null,
    lastMovedAt: null,
    ...over,
  };
}

function view(objectives: ProgressObjectiveView[]): ProgressView {
  return { fileId: 'f', docId: 'd', status: 'ready', completed: 0, total: 0, fraction: 0, objectives };
}

const h = (blockId: string, level: number, text: string, pages: number[] = []): MapBlock => ({
  blockId,
  level,
  text,
  pages,
});
const p = (blockId: string, pages: number[]): MapBlock => ({ blockId, level: null, text: 'body', pages });

/** A title, two `##` sections, the second with a `###` under it. */
const DOC: MapBlock[] = [
  h('t', 1, 'Prototyping CUIs'),
  p('t1', [1]),
  h('a', 2, 'Why prototype', [2]),
  p('a1', [2, 3]),
  h('b', 2, 'Wizard of Oz', [4]),
  p('b1', [4]),
  h('c', 3, 'Running a session', [5]),
  p('c1', [5, 6]),
];

describe('a section is a heading and everything up to the next one at its level or above', () => {
  it('makes one entry per heading, in document order, with the level and the title', () => {
    const entries = mapEntries(DOC, null);
    expect(entries.map((e) => [e.blockId, e.level, e.title])).toEqual([
      ['t', 1, 'Prototyping CUIs'],
      ['a', 2, 'Why prototype'],
      ['b', 2, 'Wizard of Oz'],
      ['c', 3, 'Running a session'],
    ]);
  });

  it('gives a section the pages of its own blocks, stopping at a heading of the same level', () => {
    const [, a] = mapEntries(DOC, null);
    expect(a!.pages).toEqual([2, 3]);
  });

  it('gives a parent the pages of the sections under it', () => {
    const [title, , b, c] = mapEntries(DOC, null);
    expect(b!.pages).toEqual([4, 5, 6]);
    expect(c!.pages).toEqual([5, 6]);
    expect(title!.pages).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ignores blocks before the first heading, and names an emptied heading', () => {
    const entries = mapEntries([p('x', [1]), h('e', 2, '  \n '), p('e1', [2])], null);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Untitled section');
  });

  it('collapses whitespace in a title', () => {
    expect(mapEntries([h('e', 1, ' Value \n iteration ')], null)[0]!.title).toBe('Value iteration');
  });

  it('gives a heading with no id no entry, but still lets it close the section above', () => {
    const entries = mapEntries([h('a', 2, 'One'), p('a1', [1]), h('', 2, 'Two'), p('b1', [9])], null);
    expect(entries.map((e) => e.blockId)).toEqual(['a']);
    expect(entries[0]!.pages).toEqual([1]);
  });

  it('drops a page that is not a page', () => {
    expect(mapEntries([h('a', 1, 'One', [0, -1, 2.5, 3])], null)[0]!.pages).toEqual([3]);
  });
});

describe('a section covers an objective by its blocks or by its pages', () => {
  it('maps by the objective’s own block ids, the mapping Start scrolls by', () => {
    const entries = mapEntries(DOC, view([objective('o1', 1, { blockIds: ['a1'] })]));
    expect(entries.map((e) => e.objectiveIds)).toEqual([['o1'], ['o1'], [], []]);
  });

  it('maps by page overlap when the block ids have not caught up with the document', () => {
    const entries = mapEntries(DOC, view([objective('o1', 0.5, { pages: [6], blockIds: ['gone'] })]));
    expect(entries.map((e) => e.objectiveIds)).toEqual([['o1'], [], ['o1'], ['o1']]);
  });

  it('lists an objective once when both rules find it, and keeps deck order', () => {
    const entries = mapEntries(
      DOC,
      view([objective('o1', 0, { pages: [3] }), objective('o2', 0, { pages: [2], blockIds: ['a1'] })]),
    );
    expect(entries[1]!.objectiveIds).toEqual(['o1', 'o2']);
  });

  it('does not count what the deck assumes rather than teaches', () => {
    const entries = mapEntries(DOC, view([objective('pre', 0, { pages: [2], assumedByDeck: true })]));
    expect(entries[1]!.objectiveIds).toEqual([]);
    expect(entries[1]!.fill).toBe('unmapped');
  });

  it('leaves every section unmapped when there is no progress view yet', () => {
    expect(mapEntries(DOC, null).every((e) => e.fill === 'unmapped')).toBe(true);
  });
});

describe('a section’s fill is a summary of fills it was sent', () => {
  it('is complete only when every mapped objective is at 1', () => {
    expect(sectionFill([1, 1])).toBe('complete');
    expect(sectionFill([1, 0.5])).toBe('partial');
  });

  it('is none only when every mapped objective is at 0', () => {
    expect(sectionFill([0, 0])).toBe('none');
    expect(sectionFill([0, 1])).toBe('partial');
    expect(sectionFill([0.5])).toBe('partial');
  });

  it('is unmapped, not none, when nothing maps to it', () => {
    expect(sectionFill([])).toBe('unmapped');
  });

  it('rolls a parent up from the sections under it', () => {
    const entries = mapEntries(
      DOC,
      view([objective('o1', 1, { pages: [2] }), objective('o2', 0, { pages: [4] }), objective('o3', 0, { pages: [5] })]),
    );
    expect(entries.map((e) => e.fill)).toEqual(['partial', 'complete', 'none', 'none']);
  });

  it('follows the view: the same document, a later verdict', () => {
    const before = mapEntries(DOC, view([objective('o1', 0.5, { pages: [5] })]));
    const after = mapEntries(DOC, view([objective('o1', 1, { pages: [5] })]));
    expect(before[3]!.fill).toBe('partial');
    expect(after[3]!.fill).toBe('complete');
  });
});

describe('the words beside the colour', () => {
  it('says each state in words', () => {
    expect(fillWords('complete')).toBe('complete');
    expect(fillWords('partial')).toBe('partly done');
    expect(fillWords('none')).toBe('not started');
    expect(fillWords('unmapped')).toBe('no objective here');
  });

  it('labels an entry with its title, its state and how many objectives it covers', () => {
    const entries = mapEntries(DOC, view([objective('o1', 1, { pages: [2] }), objective('o2', 0, { pages: [3] })]));
    expect(entryLabel(entries[1]!)).toBe('Why prototype, partly done, 2 objectives');
    expect(entryLabel(entries[2]!)).toBe('Wizard of Oz, no objective here');
    const one = mapEntries(DOC, view([objective('o1', 1, { pages: [5] })]));
    expect(entryLabel(one[3]!)).toBe('Running a session, complete, 1 objective');
  });
});

describe('indent and position', () => {
  it('indents from the shallowest heading in the document', () => {
    expect(entryDepths(mapEntries(DOC, null))).toEqual([0, 1, 1, 2]);
    expect(entryDepths(mapEntries([h('a', 2, 'A'), h('b', 3, 'B')], null))).toEqual([0, 1]);
    expect(entryDepths([])).toEqual([]);
  });

  it('marks the last heading at or above the reading line', () => {
    const tops = [
      { blockId: 'a', top: -400 },
      { blockId: 'b', top: 80 },
      { blockId: 'c', top: 600 },
    ];
    expect(currentEntry(tops, 100)).toBe('b');
    expect(currentEntry(tops, 79)).toBe('a');
    expect(currentEntry(tops, -500)).toBeNull();
    expect(currentEntry([], 100)).toBeNull();
  });
});

describe('reading the rendered document', () => {
  it('reads a heading level off a tag name', () => {
    expect(headingLevel('H2')).toBe(2);
    expect(headingLevel('h3')).toBe(3);
    expect(headingLevel('P')).toBeNull();
    expect(headingLevel('H4')).toBeNull();
  });

  it('reads the pages back out of `data-pages`', () => {
    expect(pagesFromAttr('12,15,16')).toEqual([12, 15, 16]);
    expect(pagesFromAttr('')).toEqual([]);
    expect(pagesFromAttr(null)).toEqual([]);
    expect(pagesFromAttr('3,x,0')).toEqual([3]);
  });

  it('tells a reading that would draw the same map from one that would not', () => {
    expect(sameBlocks(DOC, DOC.map((b) => ({ ...b, pages: [...b.pages] })))).toBe(true);
    expect(sameBlocks(DOC, DOC.slice(1))).toBe(false);
    expect(sameBlocks(DOC, DOC.map((b, i) => (i === 2 ? { ...b, text: 'Why we prototype' } : b)))).toBe(false);
    expect(sameBlocks(DOC, DOC.map((b, i) => (i === 3 ? { ...b, pages: [2] } : b)))).toBe(false);
  });
});
