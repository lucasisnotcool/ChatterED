import { describe, expect, it } from 'vitest';
import { docOf, heading, para } from '../../../shared/doc/fixture.test-support.js';
import type { SlideGroup } from '../../../shared/doc/slidegroups.js';
import { pageRuns, stripPositions } from './slidestrip.js';

const group = (key: string, pages: number[], lastBlockId: string | null): SlideGroup => ({
  key,
  title: key,
  headingBlockId: key === 'opening' || key === 'other' ? null : key,
  lastBlockId,
  pages,
  moved: [],
});

describe('pageRuns', () => {
  it('writes a strip’s pages as runs', () => {
    expect(pageRuns([34, 35, 36, 37, 38, 39, 40, 41, 42, 43])).toBe('pp. 34–43');
    expect(pageRuns([44, 45, 46, 51, 56])).toBe('pp. 44–46, 51, 56');
    expect(pageRuns([41])).toBe('p. 41');
    expect(pageRuns([])).toBe('');
  });
});

describe('stripPositions', () => {
  const doc = docOf(
    heading('h_title', 1, 'Real World Planning'),
    para('b_lede', 'The lede.', 'ingest', null, [1]),
    heading('h_a', 2, 'Classical planning', [3]),
    para('b_a1', 'A takeaway.', 'ingest', null, [3]),
    heading('h_b', 2, 'Reachable sets', [41]),
    para('b_b1', 'Another.', 'ingest', null, [41]),
  );
  const end = (id: string): number => {
    let at = -1;
    doc.forEach((node, offset) => {
      if (node.attrs.blockId === id) at = offset + node.nodeSize;
    });
    return at;
  };

  it('puts each section’s strip after its last block, the opening before the first section, the rest at the end', () => {
    const placed = stripPositions(doc, [
      group('opening', [1, 2], null),
      group('h_a', [3, 4], 'b_a1'),
      group('h_b', [41], 'b_b1'),
      group('other', [57], null),
    ]);
    expect(placed.map((p) => [p.group.key, p.pos])).toEqual([
      ['opening', end('b_lede')],
      ['h_a', end('b_a1')],
      ['h_b', end('b_b1')],
      ['other', doc.content.size],
    ]);
  });

  it('closes a section even when its last block has no id yet (a figure just inserted)', () => {
    const fresh = docOf(heading('h_a', 2, 'A', [3]), para('', 'No id yet.', 'user'), heading('h_b', 2, 'B', [41]));
    let next = -1;
    fresh.forEach((node, offset) => {
      if (node.attrs.blockId === 'h_b') next = offset;
    });
    expect(stripPositions(fresh, [group('h_a', [3], null)])).toEqual([{ group: group('h_a', [3], null), pos: next }]);
  });

  it('draws no strip for a section with no slides', () => {
    expect(stripPositions(doc, [group('h_a', [], 'b_a1')])).toEqual([]);
  });
});
