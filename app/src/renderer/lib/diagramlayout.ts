/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHERE A DIAGRAM'S NODES GO, AND HOW ITS EDGES RUN (2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A `diagram` block says *what* is in the picture: labelled nodes, edges by `nodeId`, a `parent`
 * for a tree and a `group` for a comparison. It says nothing about where anything is, so a label
 * the learner rewrites reflows instead of overflowing a box somebody drew. This file is the
 * "somewhere": pure, DOM-free, and the tested half of `pm/diagram.ts`.
 *
 * Two steps, because only the first can be done without a browser:
 *
 *  1. **`layoutDiagram`** puts each node in a cell of a CSS grid. The grid is the layout: the
 *     boxes are real document text, and CSS sizes them, wraps them and keeps them readable at any
 *     zoom. Nothing here is a pixel.
 *  2. **`routeEdges`** takes the boxes the browser actually drew (measured by the node view) and
 *     turns each edge into a polyline: straight when the two boxes face each other, otherwise a
 *     single elbow or a jog through the gap between rows, and never, in the common cases,
 *     through a box it does not connect.
 *
 * Bad input is expected — the learner can switch any diagram to any layout, delete nodes, or
 * select across two labels and type — so nothing here throws, loops, or trusts an id. An edge to
 * a node that is not there is dropped; a cycle in `parent` is cut where it was found; a node with
 * no group in a comparison goes under "Other".
 */

import type { DiagramLayout, DiagramSpec } from '../../shared/doc/types.js';

/** One node's place. `cells[i]` is always `spec.nodes[i]`, so a view can match them by index. */
export interface DiagramCell {
  nodeId: string;
  /** 0-based grid row and column. */
  row: number;
  col: number;
  /** How many columns the box may use: a tree's parent spans its children, a ring uses 2 of 2c. */
  colSpan: number;
  /** `root`: a tree's top. `stacked`: a tree's leaf listed under its parent rather than beside. */
  role: 'node' | 'root' | 'stacked';
  /** A tree node whose children are stacked under it: it sits at its column's left, over them. */
  holdsStack?: true;
}

/** An edge to draw. `tree` is a parent-to-child connector, drawn without an arrowhead. */
export interface LaidEdge {
  from: string;
  to: string;
  /** Indexes into `spec.nodes`: ids may repeat mid-edit, positions never do. */
  fromIndex: number;
  toIndex: number;
  label: string | null;
  kind: 'arrow' | 'tree';
  /** Not in the spec: the sequence a `flow` or `cycle` with no edges implies. */
  implied: boolean;
}

export interface DiagramGrid {
  layout: DiagramLayout;
  columns: number;
  rows: number;
  cells: DiagramCell[];
  /** `compare` only: a heading per column, above the grid (not a grid row). */
  groups: { label: string; col: number }[];
  edges: LaidEdge[];
}

export interface LayoutOptions {
  /** Boxes per row for `flow`, and the ring's width for `cycle`. The view sets it from its width. */
  maxColumns?: number;
  /** The widest a `hierarchy` may spread before sibling leaves are stacked under their parent. */
  maxLeaves?: number;
}

export const FLOW_MAX_COLUMNS = 4;
export const TREE_MAX_LEAVES = 6;
/** The column a node with no `group` goes under, when the others have one. */
export const OTHER_GROUP = 'Other';

// ── edges, cleaned ──────────────────────────────────────────────────────────────────────────

interface CleanEdge {
  from: number;
  to: number;
  label: string | null;
}

/**
 * The spec's edges by node index: the first node with each id wins, an edge naming a node that is
 * not there is dropped, and so is a self-loop or a repeat of an edge already seen.
 */
function cleanEdges(spec: DiagramSpec): CleanEdge[] {
  const index = indexById(spec);
  const seen = new Set<string>();
  const out: CleanEdge[] = [];
  for (const edge of spec.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${String(from)}>${String(to)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, label: edge.label && edge.label.trim().length > 0 ? edge.label.trim() : null });
  }
  return out;
}

function indexById(spec: DiagramSpec): Map<string, number> {
  const index = new Map<string, number>();
  spec.nodes.forEach((node, i) => {
    if (node.id && !index.has(node.id)) index.set(node.id, i);
  });
  return index;
}

/**
 * The nodes in the order the edges walk them: a topological order, with the chain being followed
 * preferred over a jump, and document order breaking ties. A cycle stalls a plain topological
 * sort, so a stall places the next successor of the last node placed (or the first node left) and
 * carries on. Every node appears exactly once.
 */
export function edgeOrder(count: number, edges: readonly { from: number; to: number }[]): number[] {
  const indegree = new Array<number>(count).fill(0);
  const out: number[][] = Array.from({ length: count }, () => []);
  for (const edge of edges) {
    if (edge.from < 0 || edge.to < 0 || edge.from >= count || edge.to >= count) continue;
    indegree[edge.to]!++;
    out[edge.from]!.push(edge.to);
  }
  const placed = new Array<boolean>(count).fill(false);
  const order: number[] = [];
  let last = -1;
  while (order.length < count) {
    let next = -1;
    // Follow the chain when the next link is ready…
    if (last >= 0) next = out[last]!.find((to) => !placed[to] && indegree[to] === 0) ?? -1;
    // …else the first node in the document that nothing unplaced still points at…
    if (next < 0) for (let i = 0; i < count && next < 0; i++) if (!placed[i] && indegree[i] === 0) next = i;
    // …else a cycle: break it at the last node's successor, or at the first node left.
    if (next < 0 && last >= 0) next = out[last]!.find((to) => !placed[to]) ?? -1;
    if (next < 0) for (let i = 0; i < count && next < 0; i++) if (!placed[i]) next = i;
    placed[next] = true;
    order.push(next);
    for (const to of out[next]!) indegree[to]!--;
    last = next;
  }
  return order;
}

// ── the four layouts ────────────────────────────────────────────────────────────────────────

function clampColumns(value: number | undefined, fallback: number): number {
  const n = Math.floor(value ?? fallback);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** The implied sequence: consecutive nodes in `order`, and back to the first when `close`. */
function sequenceEdges(spec: DiagramSpec, order: number[], close: boolean): LaidEdge[] {
  const out: LaidEdge[] = [];
  const link = (a: number, b: number): void => {
    out.push({
      from: spec.nodes[a]!.id,
      to: spec.nodes[b]!.id,
      fromIndex: a,
      toIndex: b,
      label: null,
      kind: 'arrow',
      implied: true,
    });
  };
  for (let i = 0; i + 1 < order.length; i++) link(order[i]!, order[i + 1]!);
  if (close && order.length >= 2) link(order[order.length - 1]!, order[0]!);
  return out;
}

function arrows(spec: DiagramSpec, edges: readonly CleanEdge[]): LaidEdge[] {
  return edges.map((edge) => ({
    from: spec.nodes[edge.from]!.id,
    to: spec.nodes[edge.to]!.id,
    fromIndex: edge.from,
    toIndex: edge.to,
    label: edge.label,
    kind: 'arrow' as const,
    implied: false,
  }));
}

/**
 * **flow**: the edge order, left to right, in balanced rows of at most `maxColumns`, and every
 * second row right to left (a snake), so each step of the sequence is to a neighbouring box and
 * the turn at the end of a row is one short drop.
 */
function flowGrid(spec: DiagramSpec, edges: CleanEdge[], maxColumns: number): DiagramGrid {
  const n = spec.nodes.length;
  const order = edgeOrder(n, edges);
  const rows = Math.ceil(n / maxColumns);
  const columns = rows <= 1 ? n : Math.ceil(n / rows);
  const cells = new Array<DiagramCell>(n);
  order.forEach((index, k) => {
    const row = Math.floor(k / columns);
    const step = k % columns;
    const col = row % 2 === 0 ? step : columns - 1 - step;
    cells[index] = { nodeId: spec.nodes[index]!.id, row, col, colSpan: 1, role: 'node' };
  });
  return {
    layout: 'flow',
    columns,
    rows,
    cells,
    groups: [],
    edges: edges.length > 0 ? arrows(spec, edges) : sequenceEdges(spec, order, false),
  };
}

/**
 * **cycle**: the edge order clockwise round the perimeter of a grid — along the top, down the
 * right, back along the bottom, up the left. The grid is in half-columns (each box spans two),
 * so a bottom row one shorter than the top sits centred under it: three nodes make a triangle,
 * five a trapezium, and nothing is left hanging off one corner.
 */
function cycleGrid(spec: DiagramSpec, edges: CleanEdge[], maxColumns: number): DiagramGrid {
  const n = spec.nodes.length;
  const order = edgeOrder(n, edges);
  // Top row `c`, `s` down each side, bottom `b` (c or c − 1): n = c + 2s + b.
  let c: number;
  let b: number;
  let s: number;
  if (n <= 2) {
    c = n;
    b = 0;
    s = 0;
  } else {
    c = Math.max(2, Math.min(maxColumns, Math.ceil(n / 2)));
    const rest = n - c;
    b = (rest - (c - 1)) % 2 === 0 && rest >= c - 1 ? c - 1 : Math.min(c, rest);
    s = Math.max(0, (rest - b) / 2);
    // A narrow ring (`maxColumns` 2) can leave an odd remainder; the extra node goes on the bottom.
    if (!Number.isInteger(s)) {
      s = Math.floor(s);
      b = rest - 2 * s;
    }
  }
  const places: { row: number; col: number }[] = [];
  for (let i = 0; i < c; i++) places.push({ row: 0, col: 2 * i });
  for (let r = 1; r <= s; r++) places.push({ row: r, col: 2 * (c - 1) });
  const bottom = s + 1;
  // Right to left; a short bottom row starts half a box in, so it is centred.
  const shift = b < c ? 1 : 0;
  for (let j = 0; j < b; j++) places.push({ row: bottom, col: Math.max(0, 2 * (c - 1 - j) - shift) });
  for (let r = s; r >= 1; r--) places.push({ row: r, col: 0 });

  const cells = new Array<DiagramCell>(n);
  order.forEach((index, k) => {
    const place = places[k] ?? { row: bottom + 1 + (k - places.length), col: 0 };
    cells[index] = { nodeId: spec.nodes[index]!.id, row: place.row, col: place.col, colSpan: 2, role: 'node' };
  });
  const rows = cells.reduce((max, cell) => Math.max(max, cell.row + 1), 0);
  return {
    layout: 'cycle',
    columns: 2 * Math.max(1, Math.max(c, b)),
    rows,
    cells,
    groups: [],
    edges: edges.length > 0 ? arrows(spec, edges) : sequenceEdges(spec, order, true),
  };
}

/**
 * **hierarchy**: a tree from `parent`. Depth is the row, each leaf takes a column, and a parent
 * spans the columns of its children (the box is centred in that span by CSS). Several roots sit
 * side by side. A tree wider than `maxLeaves` lists each group of sibling leaves *under* their
 * parent instead, as an org chart does, which is what keeps twelve nodes readable in 680 px.
 *
 * A `parent` naming no node makes a root. A loop in `parent` is cut: the first node of the loop
 * in document order becomes a root, and nothing is visited twice.
 */
function hierarchyGrid(spec: DiagramSpec, edges: CleanEdge[], maxLeaves: number, maxColumns: number): DiagramGrid {
  const n = spec.nodes.length;
  const index = indexById(spec);
  const parentOf = spec.nodes.map((node, i) => {
    const p = node.parent ? index.get(node.parent) : undefined;
    return p === undefined || p === i ? -1 : p;
  });
  const children: number[][] = Array.from({ length: n }, () => []);
  // Roots, then every node reachable from them. Whatever is left is on a loop; cut it and repeat.
  const reached = new Array<boolean>(n).fill(false);
  const roots: number[] = [];
  const walk = (root: number): void => {
    const stack = [root];
    reached[root] = true;
    while (stack.length > 0) {
      const at = stack.pop()!;
      for (let i = 0; i < n; i++) {
        if (!reached[i] && parentOf[i] === at) {
          reached[i] = true;
          children[at]!.push(i);
          stack.push(i);
        }
      }
    }
  };
  for (let i = 0; i < n; i++) if (parentOf[i] === -1) roots.push(i);
  for (const root of roots) walk(root);
  for (let i = 0; i < n; i++) {
    if (reached[i]) continue;
    parentOf[i] = -1;
    roots.push(i);
    walk(i);
  }
  roots.sort((a, b) => a - b);
  for (const list of children) list.sort((a, b) => a - b);

  // No `parent` anywhere (a flow switched to a tree): every node is a root and a leaf, and a row of
  // twelve would be twelve slivers. They wrap like a flow's boxes instead, with nothing joining them.
  if (roots.length > maxLeaves && children.every((list) => list.length === 0)) {
    const columns = Math.min(n, maxColumns);
    const cells = spec.nodes.map((node, i) => ({
      nodeId: node.id,
      row: Math.floor(i / columns),
      col: i % columns,
      colSpan: 1,
      role: 'node' as const,
    }));
    return { layout: 'hierarchy', columns, rows: Math.ceil(n / columns), cells, groups: [], edges: arrows(spec, edges) };
  }

  const isLeaf = (i: number): boolean => children[i]!.length === 0;
  const stacks = (i: number, stack: boolean): boolean =>
    stack && children[i]!.length >= 2 && children[i]!.every(isLeaf);
  const width = (i: number, stack: boolean): number =>
    isLeaf(i) || stacks(i, stack) ? 1 : children[i]!.reduce((sum, c) => sum + width(c, stack), 0);
  const stack = roots.reduce((sum, r) => sum + width(r, false), 0) > maxLeaves;

  const cells = new Array<DiagramCell>(n);
  const place = (i: number, depth: number, col: number): number => {
    // A root is marked only when it heads something: a lone box is not the top of a tree.
    const role = depth === 0 && !isLeaf(i) ? 'root' : 'node';
    const nodeId = spec.nodes[i]!.id;
    if (isLeaf(i)) {
      cells[i] = { nodeId, row: depth, col, colSpan: 1, role };
      return 1;
    }
    if (stacks(i, stack)) {
      cells[i] = { nodeId, row: depth, col, colSpan: 1, role, holdsStack: true };
      children[i]!.forEach((child, k) => {
        cells[child] = { nodeId: spec.nodes[child]!.id, row: depth + 1 + k, col, colSpan: 1, role: 'stacked' };
      });
      return 1;
    }
    let used = 0;
    for (const child of children[i]!) used += place(child, depth + 1, col + used);
    cells[i] = { nodeId, row: depth, col, colSpan: used, role };
    return used;
  };
  let columns = 0;
  for (const root of roots) columns += place(root, 0, columns);

  // The tree's own connectors, labelled by an explicit edge between the same two nodes (either
  // way round). Any other explicit edge is an arrow on top of the tree.
  const byPair = new Map<string, CleanEdge>();
  for (const edge of edges) byPair.set(`${String(Math.min(edge.from, edge.to))}:${String(Math.max(edge.from, edge.to))}`, edge);
  const used = new Set<CleanEdge>();
  const laid: LaidEdge[] = [];
  for (let i = 0; i < n; i++) {
    const p = parentOf[i]!;
    if (p < 0) continue;
    const match = byPair.get(`${String(Math.min(p, i))}:${String(Math.max(p, i))}`);
    if (match) used.add(match);
    laid.push({
      from: spec.nodes[p]!.id,
      to: spec.nodes[i]!.id,
      fromIndex: p,
      toIndex: i,
      label: match?.label ?? null,
      kind: 'tree',
      implied: false,
    });
  }
  laid.push(...arrows(spec, edges.filter((edge) => !used.has(edge))));

  const rows = cells.reduce((max, cell) => Math.max(max, cell.row + 1), 0);
  return { layout: 'hierarchy', columns, rows, cells, groups: [], edges: laid };
}

/**
 * **compare**: one column per `group`, in the order the groups first appear, the group's nodes
 * stacked under its heading in document order. "Other" is last. A comparison in which no node
 * has a group at all (a flow switched to compare) is one column with no heading, rather than a
 * column called "Other" with everything in it. Arrows only if there are edges.
 */
function compareGrid(spec: DiagramSpec, edges: CleanEdge[]): DiagramGrid {
  const named = (group: string | null): string | null => (group && group.trim().length > 0 ? group.trim() : null);
  const labels: string[] = [];
  let other = false;
  for (const node of spec.nodes) {
    const group = named(node.group);
    if (group === null) other = true;
    else if (!labels.includes(group)) labels.push(group);
  }
  const headed = labels.length > 0;
  if (headed && other) labels.push(OTHER_GROUP);
  const columnOf = (group: string | null): number => {
    if (!headed) return 0;
    const at = labels.indexOf(named(group) ?? OTHER_GROUP);
    return at >= 0 ? at : labels.length - 1;
  };
  const depth = new Array<number>(Math.max(1, labels.length)).fill(0);
  const cells = spec.nodes.map((node) => {
    const col = columnOf(node.group);
    const row = depth[col]!++;
    return { nodeId: node.id, row, col, colSpan: 1, role: 'node' as const };
  });
  return {
    layout: 'compare',
    columns: Math.max(1, labels.length),
    rows: Math.max(0, ...depth),
    cells,
    groups: labels.map((label, col) => ({ label, col })),
    edges: arrows(spec, edges),
  };
}

/**
 * The nodes' indexes in the order the spec's edges walk them (document order when there are none):
 * what "the last node of a flow" means when the learner adds one.
 */
export function walkOrder(spec: DiagramSpec): number[] {
  return edgeOrder(spec.nodes.length, cleanEdges(spec));
}

/** Where every node goes, and which edges to draw. See the file header. */
export function layoutDiagram(spec: DiagramSpec, options: LayoutOptions = {}): DiagramGrid {
  if (spec.nodes.length === 0) {
    return { layout: spec.layout, columns: 0, rows: 0, cells: [], groups: [], edges: [] };
  }
  const edges = cleanEdges(spec);
  const maxColumns = clampColumns(options.maxColumns, FLOW_MAX_COLUMNS);
  switch (spec.layout) {
    case 'hierarchy':
      return hierarchyGrid(spec, edges, clampColumns(options.maxLeaves, TREE_MAX_LEAVES), maxColumns);
    case 'compare':
      return compareGrid(spec, edges);
    case 'cycle':
      return cycleGrid(spec, edges, maxColumns);
    case 'flow':
    default:
      return flowGrid(spec, edges, maxColumns);
  }
}

/**
 * The budgets for a diagram drawn `width` CSS px wide: about 150 px a box in a flow, about 100 a
 * leaf in a tree. 680 px (the notes column) gives the defaults, 4 and 6.
 */
export function layoutOptionsFor(width: number): Required<LayoutOptions> {
  if (!Number.isFinite(width) || width <= 0) return { maxColumns: FLOW_MAX_COLUMNS, maxLeaves: TREE_MAX_LEAVES };
  return {
    maxColumns: Math.max(1, Math.min(FLOW_MAX_COLUMNS, Math.floor(width / 150))),
    maxLeaves: Math.max(2, Math.min(8, Math.floor(width / 104))),
  };
}

// ── routing, over measured boxes ────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RoutedEdge {
  edge: LaidEdge;
  points: Point[];
  /** An arrowhead at the last point. Tree connectors have none. */
  arrow: boolean;
  /** Where the label goes, if there is one: above a level run, beside an upright one. */
  labelAt: { x: number; y: number; anchor: 'middle' | 'start' } | null;
}

/** How far a line stops short of the box it points at, so the arrowhead's tip does not touch it. */
export const ARROW_INSET = 2;
/** Two edges between the same pair, one each way, are drawn this far either side of the centre. */
export const PAIR_OFFSET = 5;
/** How far off a side's centre a jog between rows leaves and arrives. */
export const PORT_SHIFT = 24;
/** How far past the boxes' right edge a route round the side runs. */
export const SIDE_DETOUR = 14;
/** How far a stacked child is indented from its parent's left edge (`.nd-dg-node[data-role='stacked']`). */
export const STACK_INDENT = 18;

const right = (b: Box): number => b.x + b.w;
const bottom = (b: Box): number => b.y + b.h;
const cx = (b: Box): number => b.x + b.w / 2;
const cy = (b: Box): number => b.y + b.h / 2;

/** Does the axis-aligned segment `p`–`q` pass through the inside of `box`? Touching is not. */
function crosses(p: Point, q: Point, box: Box): boolean {
  const inset = 1;
  const x0 = box.x + inset;
  const x1 = right(box) - inset;
  const y0 = box.y + inset;
  const y1 = bottom(box) - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  if (p.y === q.y) {
    const lo = Math.min(p.x, q.x);
    const hi = Math.max(p.x, q.x);
    return p.y > y0 && p.y < y1 && hi > x0 && lo < x1;
  }
  if (p.x === q.x) {
    const lo = Math.min(p.y, q.y);
    const hi = Math.max(p.y, q.y);
    return p.x > x0 && p.x < x1 && hi > y0 && lo < y1;
  }
  // Not axis-aligned (never produced here): test the bounding box, which errs on "crosses".
  return !(Math.max(p.x, q.x) <= x0 || Math.min(p.x, q.x) >= x1 || Math.max(p.y, q.y) <= y0 || Math.min(p.y, q.y) >= y1);
}

function clear(points: readonly Point[], obstacles: readonly Box[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    for (const box of obstacles) if (crosses(points[i]!, points[i + 1]!, box)) return false;
  }
  return true;
}

/** Drop repeated points and the middle of any three in a line. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) continue;
    const before = out[out.length - 2];
    if (before && last) {
      const level = Math.abs(before.y - last.y) < 0.5 && Math.abs(last.y - point.y) < 0.5;
      const upright = Math.abs(before.x - last.x) < 0.5 && Math.abs(last.x - point.x) < 0.5;
      if (level || upright) out.pop();
    }
    out.push({ ...point });
  }
  return out;
}

/** Pull the last point back along its segment by `by`, for the arrowhead. */
function inset(points: Point[], by: number): Point[] {
  if (points.length < 2) return points;
  const end = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const dx = end.x - prev.x;
  const dy = end.y - prev.y;
  const length = Math.hypot(dx, dy);
  if (length <= by * 2) return points;
  const out = points.slice(0, -1);
  out.push({ x: end.x - (dx / length) * by, y: end.y - (dy / length) * by });
  return out;
}

/**
 * The ways to get from `a` to `b`, best first. Same row: straight across between the facing
 * sides, or over (forwards) / under (backwards) the row through the gap when something is in the
 * way. Different rows: straight up or down when the boxes overlap sideways, else a jog through
 * the gap next to the target or the source, else one elbow.
 */
function candidates(a: Box, b: Box, sameRow: boolean, gap: Point, offset: number): Point[][] {
  const out: Point[][] = [];
  if (sameRow) {
    const top = Math.max(a.y, b.y);
    const low = Math.min(bottom(a), bottom(b));
    const y = (top < low ? (top + low) / 2 : (cy(a) + cy(b)) / 2) + offset;
    const forward = cx(a) <= cx(b);
    out.push(forward ? [{ x: right(a), y }, { x: b.x, y }] : [{ x: a.x, y }, { x: right(b), y }]);
    const over = Math.min(a.y, b.y) - gap.y / 2;
    const under = Math.max(bottom(a), bottom(b)) + gap.y / 2;
    const viaOver = [{ x: cx(a), y: a.y }, { x: cx(a), y: over }, { x: cx(b), y: over }, { x: cx(b), y: b.y }];
    const viaUnder = [
      { x: cx(a), y: bottom(a) },
      { x: cx(a), y: under },
      { x: cx(b), y: under },
      { x: cx(b), y: bottom(b) },
    ];
    out.push(...(forward ? [viaOver, viaUnder] : [viaUnder, viaOver]));
    return out;
  }
  const down = cy(a) < cy(b);
  const ya = down ? bottom(a) : a.y;
  const yb = down ? b.y : bottom(b);
  const lo = Math.max(a.x, b.x);
  const hi = Math.min(right(a), right(b));
  if (hi - lo >= 16) {
    const x = (lo + hi) / 2 + offset;
    out.push([{ x, y: ya }, { x, y: yb }]);
  }
  const sign = down ? 1 : -1;
  const between = (ya + yb) / 2;
  const nearTarget = Math.abs(yb - ya) > gap.y * 1.5 ? yb - (sign * gap.y) / 2 : between;
  const nearSource = Math.abs(yb - ya) > gap.y * 1.5 ? ya + (sign * gap.y) / 2 : between;
  // A jog leaves and enters off-centre, towards the other box: the centre of a side is where a
  // straight edge runs, and two edges on one line read as one double-headed arrow.
  const toward = Math.sign(cx(b) - cx(a));
  const xa = cx(a) + toward * Math.min(a.w / 4, PORT_SHIFT);
  const xb = cx(b) - toward * Math.min(b.w / 4, PORT_SHIFT);
  for (const ym of nearTarget === nearSource ? [between] : [nearTarget, nearSource]) {
    out.push([{ x: xa, y: ya }, { x: xa, y: ym }, { x: xb, y: ym }, { x: xb, y: yb }]);
  }
  // One elbow: across from the source's side, then into the target's top or bottom…
  if (cx(b) > right(a) || cx(b) < a.x) {
    const xa = cx(b) > right(a) ? right(a) : a.x;
    out.push([{ x: xa, y: cy(a) }, { x: cx(b), y: cy(a) }, { x: cx(b), y: yb }]);
  }
  // …or out of the source's top or bottom, then across into the target's side.
  if (cx(a) > right(b) || cx(a) < b.x) {
    const xb = cx(a) > right(b) ? right(b) : b.x;
    out.push([{ x: cx(a), y: ya }, { x: cx(a), y: cy(b) }, { x: xb, y: cy(b) }]);
  }
  // Last: round the right of both, past whatever is stacked between them (a back edge up a
  // column, which every other route would run straight through).
  const side = Math.max(right(a), right(b)) + SIDE_DETOUR;
  out.push([{ x: right(a), y: cy(a) }, { x: side, y: cy(a) }, { x: side, y: cy(b) }, { x: right(b), y: cy(b) }]);
  return out;
}

/**
 * A parent-to-child connector: down from the parent, along the gap above the child's row, down
 * into the child, as in an org chart, so siblings share one bus. A stacked child hangs off a
 * rail down its left instead.
 */
function treeRoute(p: Box, c: Box, stacked: boolean, gap: Point): Point[] {
  if (stacked) {
    // The parent sits at the column's left and the stacked children are indented (notes.css), so
    // the rail runs down the indent: under the parent's box, clear of the children's.
    const rail = Math.min(right(p) - 6, Math.max(p.x + 6, c.x - STACK_INDENT / 2));
    return [{ x: rail, y: bottom(p) }, { x: rail, y: cy(c) }, { x: c.x, y: cy(c) }];
  }
  const ym = c.y - bottom(p) > gap.y * 1.5 ? c.y - gap.y / 2 : (bottom(p) + c.y) / 2;
  return [{ x: cx(p), y: bottom(p) }, { x: cx(p), y: ym }, { x: cx(c), y: ym }, { x: cx(c), y: c.y }];
}

function labelPoint(points: readonly Point[]): RoutedEdge['labelAt'] {
  let best = -1;
  let length = -1;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    if (d > length) {
      length = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const p = points[best]!;
  const q = points[best + 1]!;
  if (Math.abs(p.y - q.y) < 0.5) return { x: (p.x + q.x) / 2, y: p.y - 5, anchor: 'middle' };
  return { x: p.x + 6, y: (p.y + q.y) / 2 + 3, anchor: 'start' };
}

/**
 * Each edge as a polyline over the boxes the browser drew. `boxes[i]` is `spec.nodes[i]`'s box in
 * the overlay's own px, or null when it is not on screen (still being typed in, say): an edge to a
 * box that is not there is not drawn. `gap` is the grid's column and row gap.
 */
export function routeEdges(grid: DiagramGrid, boxes: readonly (Box | null)[], gap: Point): RoutedEdge[] {
  const pairs = new Set(grid.edges.map((e) => `${String(e.fromIndex)}>${String(e.toIndex)}`));
  const out: RoutedEdge[] = [];
  for (const edge of grid.edges) {
    const a = boxes[edge.fromIndex];
    const b = boxes[edge.toIndex];
    const ca = grid.cells[edge.fromIndex];
    const cb = grid.cells[edge.toIndex];
    if (!a || !b || !ca || !cb || a.w <= 0 || b.w <= 0) continue;
    let points: Point[];
    if (edge.kind === 'tree') {
      points = simplify(treeRoute(a, b, cb.role === 'stacked', gap));
    } else {
      const reverse = pairs.has(`${String(edge.toIndex)}>${String(edge.fromIndex)}`);
      const offset = reverse ? (edge.fromIndex < edge.toIndex ? -PAIR_OFFSET : PAIR_OFFSET) : 0;
      const obstacles = boxes.filter(
        (box, i): box is Box => box !== null && box.w > 0 && i !== edge.fromIndex && i !== edge.toIndex,
      );
      const options = candidates(a, b, ca.row === cb.row, gap, offset).map(simplify);
      points = options.find((option) => clear(option, obstacles)) ?? options[0] ?? [];
      points = inset(points, ARROW_INSET);
    }
    if (points.length < 2) continue;
    out.push({ edge, points, arrow: edge.kind === 'arrow', labelAt: edge.label ? labelPoint(points) : null });
  }
  return out;
}

/** A polyline as SVG path data, its corners rounded by up to `radius`. */
export function pathData(points: readonly Point[], radius = 6): string {
  const f = (n: number): string => String(Math.round(n * 10) / 10);
  if (points.length === 0) return '';
  let d = `M${f(points[0]!.x)} ${f(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const at = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += ` L${f(at.x)} ${f(at.y)}`;
      break;
    }
    const prev = points[i - 1]!;
    const r = Math.min(radius, Math.hypot(at.x - prev.x, at.y - prev.y) / 2, Math.hypot(next.x - at.x, next.y - at.y) / 2);
    const inX = at.x - Math.sign(at.x - prev.x) * r;
    const inY = at.y - Math.sign(at.y - prev.y) * r;
    const outX = at.x + Math.sign(next.x - at.x) * r;
    const outY = at.y + Math.sign(next.y - at.y) * r;
    d += ` L${f(inX)} ${f(inY)} Q${f(at.x)} ${f(at.y)} ${f(outX)} ${f(outY)}`;
  }
  return d;
}
