import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramLayout, DiagramSpec } from '../../shared/doc/types.js';
import {
  ARROW_INSET,
  OTHER_GROUP,
  edgeOrder,
  layoutDiagram,
  layoutOptionsFor,
  pathData,
  routeEdges,
  simplify,
  type Box,
  type DiagramGrid,
} from './diagramlayout.js';

type NodeSeed = { id: string; parent?: string | null; group?: string | null };

function spec(layout: DiagramLayout, nodes: (string | NodeSeed)[], edges: [string, string, string?][] = []): DiagramSpec {
  return {
    layout,
    title: null,
    nodes: nodes.map((n) => {
      const seed = typeof n === 'string' ? { id: n } : n;
      return { id: seed.id, label: seed.id.toUpperCase(), parent: seed.parent ?? null, group: seed.group ?? null, pages: [] };
    }),
    edges: edges.map(([from, to, label]): DiagramEdge => ({ from, to, label: label ?? null })),
  };
}

/** The grid as rows of ids, `.` for an empty cell, a spanning node repeated across its span. */
function picture(grid: DiagramGrid): string[] {
  const rows = Array.from({ length: grid.rows }, () => new Array<string>(grid.columns).fill('.'));
  for (const cell of grid.cells) {
    for (let c = cell.col; c < cell.col + cell.colSpan; c++) rows[cell.row]![c] = cell.nodeId;
  }
  return rows.map((row) => row.join(' '));
}

const pairs = (grid: DiagramGrid): string[] => grid.edges.map((e) => `${e.from}>${e.to}`);

describe('edgeOrder', () => {
  it('is document order when there are no edges', () => {
    expect(edgeOrder(4, [])).toEqual([0, 1, 2, 3]);
  });

  it('follows the edges, whatever the document order', () => {
    // 3 -> 1 -> 0 -> 2
    expect(edgeOrder(4, [{ from: 3, to: 1 }, { from: 1, to: 0 }, { from: 0, to: 2 }])).toEqual([3, 1, 0, 2]);
  });

  it('keeps a branch after both of its inputs, and follows a chain before jumping', () => {
    // 0 -> 1, 0 -> 2, 1 -> 3, 2 -> 3
    expect(edgeOrder(4, [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }])).toEqual([
      0, 1, 2, 3,
    ]);
    // Two chains interleaved in the document: 0 -> 2, 1 -> 3.
    expect(edgeOrder(4, [{ from: 0, to: 2 }, { from: 1, to: 3 }])).toEqual([0, 2, 1, 3]);
  });

  it('breaks a cycle instead of stalling, and places every node once', () => {
    expect(edgeOrder(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0 }])).toEqual([0, 1, 2]);
    expect(edgeOrder(3, [{ from: 1, to: 2 }, { from: 2, to: 1 }])).toEqual([0, 1, 2]);
  });

  it('ignores an edge with an index out of range', () => {
    expect(edgeOrder(2, [{ from: 0, to: 9 }, { from: -1, to: 1 }])).toEqual([0, 1]);
  });
});

describe('flow', () => {
  it('puts a short flow in one row, in edge order, with the edges as given', () => {
    const grid = layoutDiagram(spec('flow', ['c', 'a', 'b'], [['a', 'b'], ['b', 'c', 'then']]));
    expect(picture(grid)).toEqual(['a b c']);
    expect(pairs(grid)).toEqual(['a>b', 'b>c']);
    expect(grid.edges[1]!.label).toBe('then');
    expect(grid.edges.every((e) => !e.implied && e.kind === 'arrow')).toBe(true);
  });

  it('implies the sequence when there are no edges', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c']));
    expect(picture(grid)).toEqual(['a b c']);
    expect(pairs(grid)).toEqual(['a>b', 'b>c']);
    expect(grid.edges.every((e) => e.implied)).toBe(true);
  });

  it('wraps after four into balanced rows, and snakes so every step is to a neighbour', () => {
    const five = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e']));
    expect(picture(five)).toEqual(['a b c', '. e d']);
    const eight = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    expect(picture(eight)).toEqual(['a b c d', 'h g f e']);
    const nine = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']));
    expect(picture(nine)).toEqual(['a b c', 'f e d', 'g h i']);
  });

  it('narrows with the column', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd']), { maxColumns: 2 });
    expect(picture(grid)).toEqual(['a b', 'd c']);
  });

  it('keeps cells in document order, whatever the edges say', () => {
    const grid = layoutDiagram(spec('flow', ['c', 'a', 'b'], [['a', 'b'], ['b', 'c']]));
    expect(grid.cells.map((cell) => cell.nodeId)).toEqual(['c', 'a', 'b']);
  });

  it('drops an edge to a missing node, a self-loop and a repeat', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b'], [['a', 'ghost'], ['a', 'a'], ['a', 'b'], ['a', 'b']]));
    expect(pairs(grid)).toEqual(['a>b']);
  });
});

describe('hierarchy', () => {
  it('puts depth on rows and centres a parent over its children', () => {
    const grid = layoutDiagram(
      spec('hierarchy', [
        'root',
        { id: 'l', parent: 'root' },
        { id: 'r', parent: 'root' },
        { id: 'l1', parent: 'l' },
        { id: 'l2', parent: 'l' },
      ]),
    );
    expect(picture(grid)).toEqual(['root root root', 'l l r', 'l1 l2 .']);
    expect(grid.cells[0]!.role).toBe('root');
    expect(grid.edges.map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual([
      'root>l:tree',
      'root>r:tree',
      'l>l1:tree',
      'l>l2:tree',
    ]);
  });

  it('allows several roots, side by side', () => {
    const grid = layoutDiagram(spec('hierarchy', ['a', 'b', { id: 'b1', parent: 'b' }, { id: 'b2', parent: 'b' }]));
    expect(picture(grid)).toEqual(['a b b', '. b1 b2']);
    // Only a root that heads something is marked as one.
    expect(grid.cells.filter((c) => c.role === 'root').map((c) => c.nodeId)).toEqual(['b']);
  });

  it('wraps a tree with no parents at all like a flow, rather than a row of slivers', () => {
    const grid = layoutDiagram(spec('hierarchy', ['a', 'b', 'c', 'd', 'e', 'f', 'g']));
    expect(picture(grid)).toEqual(['a b c d', 'e f g .']);
    expect(grid.edges).toEqual([]);
    // Few enough to sit in one row: they do, as roots.
    expect(picture(layoutDiagram(spec('hierarchy', ['a', 'b', 'c'])))).toEqual(['a b c']);
  });

  it('makes a node whose parent is missing a root', () => {
    const grid = layoutDiagram(spec('hierarchy', ['a', { id: 'b', parent: 'ghost' }]));
    expect(picture(grid)).toEqual(['a b']);
    expect(grid.edges).toEqual([]);
  });

  it('cuts a loop in parent instead of looping', () => {
    const grid = layoutDiagram(
      spec('hierarchy', [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'c' }]),
    );
    expect(picture(grid)).toEqual(['a c', 'b .']);
    expect(pairs(grid)).toEqual(['a>b']);
  });

  it('stacks sibling leaves under their parent when the tree is too wide', () => {
    const nodes: NodeSeed[] = [{ id: 'r' }];
    for (const branch of ['x', 'y', 'z']) {
      nodes.push({ id: branch, parent: 'r' });
      for (const leaf of ['1', '2', '3']) nodes.push({ id: `${branch}${leaf}`, parent: branch });
    }
    const grid = layoutDiagram(spec('hierarchy', nodes));
    expect(picture(grid)).toEqual(['r r r', 'x y z', 'x1 y1 z1', 'x2 y2 z2', 'x3 y3 z3']);
    expect(grid.cells.find((c) => c.nodeId === 'x2')!.role).toBe('stacked');
    expect(grid.cells.find((c) => c.nodeId === 'x')!.holdsStack).toBe(true);
    // The same tree spread when there is room for nine leaves.
    expect(layoutDiagram(spec('hierarchy', nodes), { maxLeaves: 9 }).columns).toBe(9);
  });

  it('labels a tree connector with an explicit edge between the same pair, and keeps other edges as arrows', () => {
    const grid = layoutDiagram(
      spec('hierarchy', ['a', { id: 'b', parent: 'a' }, { id: 'c', parent: 'a' }], [['b', 'a', 'is a'], ['b', 'c', 'feeds']]),
    );
    expect(grid.edges.map((e) => `${e.from}>${e.to}:${e.kind}:${e.label ?? ''}`)).toEqual([
      'a>b:tree:is a',
      'a>c:tree:',
      'b>c:arrow:feeds',
    ]);
  });
});

describe('compare', () => {
  it('makes a column per group in first-appearance order, stacked in document order', () => {
    const grid = layoutDiagram(
      spec('compare', [
        { id: 'f1', group: 'Formative' },
        { id: 's1', group: 'Summative' },
        { id: 'f2', group: 'Formative' },
        { id: 's2', group: ' Summative ' },
      ]),
    );
    expect(grid.groups).toEqual([
      { label: 'Formative', col: 0 },
      { label: 'Summative', col: 1 },
    ]);
    expect(picture(grid)).toEqual(['f1 s1', 'f2 s2']);
    expect(grid.edges).toEqual([]);
  });

  it('puts a node with no group under "Other", last', () => {
    const grid = layoutDiagram(spec('compare', [{ id: 'x' }, { id: 'a', group: 'A' }, { id: 'b', group: 'B' }]));
    expect(grid.groups.map((g) => g.label)).toEqual(['A', 'B', OTHER_GROUP]);
    expect(picture(grid)).toEqual(['a b x']);
  });

  it('is one unheaded column when no node has a group', () => {
    const grid = layoutDiagram(spec('compare', ['a', 'b']));
    expect(grid.groups).toEqual([]);
    expect(picture(grid)).toEqual(['a', 'b']);
  });

  it('draws arrows only when there are edges', () => {
    const grid = layoutDiagram(spec('compare', [{ id: 'a', group: 'A' }, { id: 'b', group: 'B' }], [['a', 'b']]));
    expect(pairs(grid)).toEqual(['a>b']);
  });
});

describe('cycle', () => {
  const ring = (n: number, options = {}): string[] =>
    picture(layoutDiagram(spec('cycle', 'abcdefghijklmn'.slice(0, n).split('')), options));

  it('goes clockwise round the perimeter, a short bottom row centred', () => {
    expect(ring(3)).toEqual(['a a b b', '. c c .']);
    expect(ring(4)).toEqual(['a a b b', 'd d c c']);
    expect(ring(5)).toEqual(['a a b b c c', '. e e d d .']);
    expect(ring(6)).toEqual(['a a b b c c', 'f f e e d d']);
    expect(ring(9)).toEqual(['a a b b c c d d', 'i i . . . . e e', '. h h g g f f .']);
    expect(ring(12)).toEqual(['a a b b c c d d', 'l l . . . . e e', 'k k . . . . f f', 'j j i i h h g g']);
  });

  it('puts two nodes side by side', () => {
    expect(ring(2)).toEqual(['a a b b']);
  });

  it('narrows to a ring two wide', () => {
    expect(ring(5, { maxColumns: 2 })).toEqual(['a a b b', 'e e c c', '. d d .']);
  });

  it('implies the ring, closing edge included, when there are no edges', () => {
    const grid = layoutDiagram(spec('cycle', ['a', 'b', 'c']));
    expect(pairs(grid)).toEqual(['a>b', 'b>c', 'c>a']);
  });

  it('orders the ring by its edges', () => {
    const grid = layoutDiagram(spec('cycle', ['a', 'b', 'c', 'd'], [['a', 'c'], ['c', 'b'], ['b', 'd'], ['d', 'a']]));
    expect(picture(grid)).toEqual(['a a c c', 'd d b b']);
  });
});

describe('layoutDiagram, whatever it is given', () => {
  it('lays out nothing as nothing', () => {
    expect(layoutDiagram(spec('flow', []))).toMatchObject({ columns: 0, rows: 0, cells: [], edges: [] });
  });

  it('survives repeated ids by position', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'a', 'b'], [['a', 'b']]));
    expect(grid.cells).toHaveLength(3);
    expect(grid.edges.map((e) => [e.fromIndex, e.toIndex])).toEqual([[0, 2]]);
  });

  it('sets its budgets from the width it has', () => {
    expect(layoutOptionsFor(680)).toEqual({ maxColumns: 4, maxLeaves: 6 });
    expect(layoutOptionsFor(320)).toEqual({ maxColumns: 2, maxLeaves: 3 });
    expect(layoutOptionsFor(0)).toEqual({ maxColumns: 4, maxLeaves: 6 });
  });
});

// ── routing ─────────────────────────────────────────────────────────────────────────────────

const gap = { x: 36, y: 32 };

/** Boxes for a grid: 100 × 40 cells, `gap` apart; a span covers its columns and the gaps inside. */
function boxesFor(grid: DiagramGrid, narrow: Record<number, number> = {}): Box[] {
  return grid.cells.map((cell, i) => {
    const x = cell.col * (100 + gap.x);
    const w = cell.colSpan * 100 + (cell.colSpan - 1) * gap.x;
    const own = narrow[i];
    return own ? { x: x + (w - own) / 2, y: cell.row * (40 + gap.y), w: own, h: 40 } : { x, y: cell.row * (40 + gap.y), w, h: 40 };
  });
}

describe('routeEdges', () => {
  it('runs straight between the facing sides of neighbours, stopping short for the arrowhead', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b']));
    const [edge] = routeEdges(grid, boxesFor(grid), gap);
    expect(edge!.points).toEqual([
      { x: 100, y: 20 },
      { x: 136 - ARROW_INSET, y: 20 },
    ]);
    expect(edge!.arrow).toBe(true);
  });

  it('drops straight down at the turn of a snake, and points left along the second row', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e']));
    const routed = routeEdges(grid, boxesFor(grid), gap);
    const turn = routed.find((r) => r.edge.from === 'c')!;
    expect(turn.points).toEqual([
      { x: 322, y: 40 },
      { x: 322, y: 72 - ARROW_INSET },
    ]);
    const back = routed.find((r) => r.edge.from === 'd')!;
    expect(back.points[0]!.x).toBeGreaterThan(back.points[1]!.x);
  });

  it('goes over the row rather than through a box in between', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['a', 'c']]));
    const skip = routeEdges(grid, boxesFor(grid), gap).find((r) => r.edge.from === 'a' && r.edge.to === 'c')!;
    expect(skip.points.length).toBe(4);
    expect(Math.min(...skip.points.map((p) => p.y))).toBeLessThan(0);
  });

  it('leaves and enters a jog between rows off-centre, clear of a straight edge on the same side', () => {
    // a b c / . e d, with d -> b jogging up into b while b's own edges run beside it.
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'b']]));
    const routed = routeEdges(grid, boxesFor(grid), gap);
    const jog = routed.find((r) => r.edge.from === 'e')!;
    const last = jog.points[jog.points.length - 1]!;
    expect(jog.points).toHaveLength(2);
    // e sits under b: straight up at the centre. Now one that has to jog: d -> a.
    const other = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['d', 'a']]));
    const up = routeEdges(other, boxesFor(other), gap).find((r) => r.edge.to === 'a' && r.edge.from === 'd')!;
    expect(up.points[0]!.x).toBe(322 - 24);
    expect(up.points[up.points.length - 1]!.x).toBe(50 + 24);
    expect(last.x).toBe(186);
  });

  it('goes under the row for an edge back against the flow', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]));
    const back = routeEdges(grid, boxesFor(grid), gap).find((r) => r.edge.from === 'c')!;
    expect(Math.max(...back.points.map((p) => p.y))).toBeGreaterThan(40);
  });

  it('draws a two-way pair either side of the centre line', () => {
    const grid = layoutDiagram(spec('cycle', ['a', 'b']));
    const [ab, ba] = routeEdges(grid, boxesFor(grid), gap);
    expect(ab!.points[0]!.y).not.toBe(ba!.points[0]!.y);
  });

  it('drops a straight line from a top-row box to the half-offset box under it', () => {
    const grid = layoutDiagram(spec('cycle', ['a', 'b', 'c']));
    const routed = routeEdges(grid, boxesFor(grid), gap);
    const down = routed.find((r) => r.edge.from === 'b')!;
    expect(down.points).toHaveLength(2);
    expect(down.points[0]!.x).toBe(down.points[1]!.x);
  });

  it('joins a tree with shared buses and no arrowheads', () => {
    const grid = layoutDiagram(spec('hierarchy', ['r', { id: 'a', parent: 'r' }, { id: 'b', parent: 'r' }]));
    const routed = routeEdges(grid, boxesFor(grid, { 0: 80 }), gap);
    expect(routed.map((r) => r.arrow)).toEqual([false, false]);
    const busY = routed.map((r) => r.points[1]!.y);
    expect(busY[0]).toBe(busY[1]);
    expect(busY[0]).toBe(56);
  });

  it('hangs stacked leaves off a rail down the indent', () => {
    const nodes: NodeSeed[] = [{ id: 'r' }, { id: 'x', parent: 'r' }, { id: 'x1', parent: 'x' }, { id: 'x2', parent: 'x' }];
    const grid = layoutDiagram(spec('hierarchy', nodes), { maxLeaves: 1 });
    const boxes = boxesFor(grid).map((box, i) => (grid.cells[i]!.role === 'stacked' ? { ...box, x: box.x + 18, w: box.w - 18 } : box));
    const leaf = routeEdges(grid, boxes, gap).find((r) => r.edge.to === 'x2')!;
    expect(leaf.points).toEqual([
      { x: 9, y: 112 },
      { x: 9, y: 236 },
      { x: 18, y: 236 },
    ]);
  });

  it('takes a back edge up a column round the side, not through the boxes in between', () => {
    const grid = layoutDiagram(spec('compare', ['a', 'b', 'c'], [['c', 'a']]));
    const [edge] = routeEdges(grid, boxesFor(grid), gap);
    expect(edge!.points.map((p) => p.x)).toEqual([100, 114, 114, 100 + ARROW_INSET]);
  });

  it('skips an edge to a box that is not on screen', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c']));
    const boxes: (Box | null)[] = boxesFor(grid);
    boxes[2] = null;
    expect(routeEdges(grid, boxes, gap).map((r) => r.edge.to)).toEqual(['b']);
  });

  it('puts a label above a level run and beside an upright one', () => {
    const grid = layoutDiagram(spec('flow', ['a', 'b', 'c', 'd', 'e'], [['a', 'b', 'yes'], ['c', 'd', 'next']]));
    const routed = routeEdges(grid, boxesFor(grid), gap);
    expect(routed.find((r) => r.edge.from === 'a')!.labelAt).toMatchObject({ anchor: 'middle', y: 15 });
    expect(routed.find((r) => r.edge.from === 'c')!.labelAt).toMatchObject({ anchor: 'start' });
    expect(routed.find((r) => r.edge.from === 'b')).toBeUndefined();
  });
});

describe('simplify and pathData', () => {
  it('drops repeats and collinear middles', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ]);
  });

  it('rounds an elbow and leaves a straight line straight', () => {
    expect(pathData([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M0 0 L10 0');
    expect(pathData([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 20, y: 20 }], 6)).toBe('M0 0 L0 14 Q0 20 6 20 L20 20');
  });
});
