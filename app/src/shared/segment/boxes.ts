/** Box arithmetic shared by the stages. Pure, allocation-light, no I/O. */
import type { Box, PageGeometry, TextBox } from './types.js';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Numbers are compared at this resolution everywhere, so 0.1 + 0.2 never splits a segment. */
export const EPS = 1e-6;

export function nearly(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function area(b: Box): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

export function contains(outer: Box, inner: Box, eps = EPS): boolean {
  return (
    inner.x0 >= outer.x0 - eps &&
    inner.y0 >= outer.y0 - eps &&
    inner.x1 <= outer.x1 + eps &&
    inner.y1 <= outer.y1 + eps
  );
}

export function containsPoint(b: Box, x: number, y: number, eps = EPS): boolean {
  return x >= b.x0 - eps && x <= b.x1 + eps && y >= b.y0 - eps && y <= b.y1 + eps;
}

export function overlaps(a: Box, b: Box, eps = EPS): boolean {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

export function union(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** The page's own box, as a rectangle. Every page starts as exactly this. */
export const PAGE_BOX: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * Words, lowercased, punctuation stripped. Used for Stage 0 containment and nothing else —
 * it is a *set* comparison, so hyphenation and reading order do not matter.
 */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function pageTokens(page: PageGeometry): string[] {
  return page.textBoxes.flatMap((b) => tokens(b.text));
}

export function wordCount(page: PageGeometry): number {
  return pageTokens(page).length;
}

/**
 * The fraction of the page under the union of text boxes — `segmentation-genres.md` §C's
 * "text cov", and one of the two numbers the genre router turns on.
 *
 * Computed by sweeping distinct y bands rather than summing areas, so overlapping boxes (very
 * common: pdf.js emits one item per run, and runs on a line share their band) are not counted
 * twice. That over-count is what would push a slide over the 0.40 threshold.
 */
export function textCoverage(boxes: Box[]): number {
  if (boxes.length === 0) return 0;
  const edges = new Set<number>();
  for (const b of boxes) {
    edges.add(clamp01(b.y0));
    edges.add(clamp01(b.y1));
  }
  const ys = [...edges].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < ys.length; i += 1) {
    const top = ys[i]!;
    const bottom = ys[i + 1]!;
    const h = bottom - top;
    if (h <= EPS) continue;
    const mid = (top + bottom) / 2;
    const spans: Array<[number, number]> = [];
    for (const b of boxes) {
      if (b.y0 <= mid && mid <= b.y1) spans.push([clamp01(b.x0), clamp01(b.x1)]);
    }
    total += h * mergedLength(spans);
  }
  return clamp01(total);
}

/** Total length covered by a set of possibly overlapping 1-D intervals. */
export function mergedLength(spans: Array<[number, number]>): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0]!;
  for (let i = 1; i < sorted.length; i += 1) {
    const [s, e] = sorted[i]!;
    if (s > end) {
      total += end - start;
      start = s;
      end = e;
    } else if (e > end) {
      end = e;
    }
  }
  return total + (end - start);
}

/**
 * Column detection: cluster text boxes on x and count the clusters separated by a gutter at
 * least `gutter` wide (normalised). One cluster is a single-column page; two is the
 * two-column paper the router is looking for, and the gutter a vertical cut can live in (§C6).
 *
 * Returns the gutters, each as the `[left, right]` normalised x band between two clusters.
 */
export function columnGutters(boxes: TextBox[], gutter: number): Array<[number, number]> {
  const spans = boxes.map((b) => [clamp01(b.x0), clamp01(b.x1)] as [number, number]);
  if (spans.length === 0) return [];
  spans.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let end = spans[0]![1];
  for (let i = 1; i < spans.length; i += 1) {
    const [s, e] = spans[i]!;
    if (s - end >= gutter) out.push([end, s]);
    if (e > end) end = e;
  }
  return out;
}
