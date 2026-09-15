/**
 * Segment operations — `pdf-fidelity-segmentation.md` §C5.
 *
 * "This is the part that is *easier* on crops than on any other representation." Split inserts
 * one boundary; merge is the union of two adjacent rectangles; reorder moves cards and never
 * moves pixels. Every operation only ever changes numbers, so the original page box is always
 * recoverable — which is the structural form of *the slide is the arbiter*.
 *
 * The three invariants §C5 asks to assert live here as `checkPartition`, and the tests use it
 * after every operation rather than hand-checking coordinates:
 *   1. every page is fully covered by its segments (no orphaned strip of slide);
 *   2. segments never overlap;
 *   3. split and merge are inverses.
 */
import { EPS, PAGE_BOX, area, nearly } from './boxes.js';
import { labelFor } from './labels.js';
import {
  DEFAULTS,
  type CutBlock,
  type CutCandidate,
  type PageGeometry,
  type Segment,
  type SegmentOptions,
} from './types.js';

/** The lazy starting state: one whole-page segment per kept page (issue #25 decision 2). */
export function wholePageSegments(pages: PageGeometry[]): Segment[] {
  return pages.map((page) => ({
    page: page.page,
    ...PAGE_BOX,
    label: labelFor(page, PAGE_BOX),
    source: 'geometry' as const,
  }));
}

export interface SplitRequest {
  page: number;
  /** Normalised position of the gesture: a `y` for a horizontal cut, an `x` for a vertical one. */
  at: number;
  axis?: 'horizontal' | 'vertical';
  /** Which segment to cut. Omitted: the first segment on the page that contains `at`. */
  index?: number;
  /** Hold the modifier — release the snap (lazy-split §4, "free cuts snap, then release"). */
  free?: boolean;
}

export interface SplitResult {
  segments: Segment[];
  /** Index of the first of the two resulting segments; `-1` when the cut was refused. */
  index: number;
  /** Where the cut actually landed, after snapping. */
  at: number;
  snappedTo: CutCandidate | null;
  /** `'figure'` is the "won't cut a figure" message. `null` when the split happened. */
  refused: CutBlock | 'no-segment' | 'degenerate' | null;
}

/** Ink this large is a background, not a figure — the same filter Stage 3 uses. */
const BACKGROUND_AREA = 0.95;

/**
 * Nearest candidate within `snapPt`, measured in points along the cut's own axis. Blocked
 * candidates are snap targets too: a gap that was too small for a tick is still a real gap, and
 * a learner dragging near it meant it (lazy-split §4).
 */
export function snapTo(
  at: number,
  axis: 'horizontal' | 'vertical',
  candidates: CutCandidate[],
  sizePt: number,
  snapPt: number,
): CutCandidate | null {
  let best: CutCandidate | null = null;
  let bestPt = snapPt;
  for (const c of candidates) {
    if (c.axis !== axis || c.blockedBy === 'figure') continue;
    const d = Math.abs(c.at - at) * sizePt;
    if (d <= bestPt) {
      best = c;
      bestPt = d;
    }
  }
  return best;
}

function crossesFigure(page: PageGeometry, axis: 'horizontal' | 'vertical', at: number, within: Segment): boolean {
  return page.inkBoxes.some((f) => {
    if (f.kind === 'container' || area(f) >= BACKGROUND_AREA) return false;
    if (axis === 'horizontal') {
      return f.y0 < at - EPS && at < f.y1 - EPS && f.x0 < within.x1 - EPS && within.x0 < f.x1 - EPS;
    }
    return f.x0 < at - EPS && at < f.x1 - EPS && f.y0 < within.y1 - EPS && within.y0 < f.y1 - EPS;
  });
}

export function splitSegment(
  segments: Segment[],
  page: PageGeometry,
  req: SplitRequest,
  opts: Partial<SegmentOptions> & { candidates?: CutCandidate[] } = {},
): SplitResult {
  const o = { ...DEFAULTS, ...opts };
  const axis = req.axis ?? 'horizontal';
  const sizePt = axis === 'horizontal' ? page.height : page.width;

  const snapped = req.free === true
    ? null
    : snapTo(req.at, axis, opts.candidates ?? [], sizePt, o.snapPt);
  const at = snapped?.at ?? req.at;

  const index =
    req.index ??
    segments.findIndex(
      (s) =>
        s.page === req.page &&
        // Closed range on purpose: a drag to the very edge of a card must come back as
        // `degenerate` ("nothing to cut there"), not as `no-segment` ("which card?").
        (axis === 'horizontal' ? s.y0 <= at && at <= s.y1 : s.x0 <= at && at <= s.x1),
    );
  const target = index >= 0 ? segments[index] : undefined;
  if (!target || target.page !== req.page) {
    return { segments, index: -1, at, snappedTo: snapped, refused: 'no-segment' };
  }

  const lo = axis === 'horizontal' ? target.y0 : target.x0;
  const hi = axis === 'horizontal' ? target.y1 : target.x1;
  // A cut on or outside an existing edge would make a zero-height segment, which would break
  // the partition invariant in a way no UI gesture should be able to reach.
  if (at <= lo + EPS || at >= hi - EPS) {
    return { segments, index: -1, at, snappedTo: snapped, refused: 'degenerate' };
  }
  if (crossesFigure(page, axis, at, target)) {
    return { segments, index: -1, at, snappedTo: snapped, refused: 'figure' };
  }

  const source: Segment['source'] = snapped !== null ? 'geometry' : 'learner';
  const first: Segment =
    axis === 'horizontal' ? { ...target, y1: at, source } : { ...target, x1: at, source };
  const second: Segment =
    axis === 'horizontal' ? { ...target, y0: at, source } : { ...target, x0: at, source };
  first.label = labelFor(page, first);
  second.label = labelFor(page, second);

  const out = [...segments];
  out.splice(index, 1, first, second);
  return { segments: out, index, at, snappedTo: snapped, refused: null };
}

export interface MergeResult {
  segments: Segment[];
  index: number;
  refused: 'different-pages' | 'not-adjacent' | 'no-segment' | null;
}

/**
 * Same-page merge only, for now: `y_top = min, y_bottom = max` (§C5). Cross-page merge is an
 * ordered list of crops in one card and is deferred to A2 (lazy-split §2.5).
 *
 * The two rectangles must tile their own union exactly — otherwise the merge would claim a
 * strip of the page that belongs to a third segment, and the partition invariant would break.
 */
export function mergeSegments(segments: Segment[], a: number, b: number): MergeResult {
  const [i, j] = a <= b ? [a, b] : [b, a];
  const first = segments[i];
  const second = segments[j];
  if (!first || !second || i === j) return { segments, index: -1, refused: 'no-segment' };
  if (first.page !== second.page) return { segments, index: -1, refused: 'different-pages' };

  const box = {
    x0: Math.min(first.x0, second.x0),
    y0: Math.min(first.y0, second.y0),
    x1: Math.max(first.x1, second.x1),
    y1: Math.max(first.y1, second.y1),
  };
  if (!nearly(area(box), area(first) + area(second), 1e-9)) {
    return { segments, index: -1, refused: 'not-adjacent' };
  }

  const merged: Segment = {
    page: first.page,
    ...box,
    // The surviving label is the upper-left one: it is the one the learner has been reading.
    label: first.y0 < second.y0 || (nearly(first.y0, second.y0) && first.x0 <= second.x0)
      ? first.label
      : second.label,
    source: 'learner',
  };
  const out = segments.filter((_, k) => k !== i && k !== j);
  out.splice(i, 0, merged);
  return { segments: out, index: i, refused: null };
}

/** Move one card in the flow. Pixels never move (§C5). */
export function reorderSegments(segments: Segment[], from: number, to: number): Segment[] {
  if (from < 0 || from >= segments.length) return segments;
  const clamped = Math.max(0, Math.min(segments.length - 1, to));
  const out = [...segments];
  const [moved] = out.splice(from, 1);
  if (moved) out.splice(clamped, 0, moved);
  return out;
}

/**
 * The invariant check. Returns the violations, empty when the segments tile every page they
 * mention exactly once.
 *
 * Implemented as a rectangle-partition test rather than a y-interval test, because a vertical
 * cut (§C6) makes the partition genuinely two-dimensional: collect every distinct edge, and
 * assert that the centre of every cell is inside exactly one segment.
 */
export function checkPartition(segments: Segment[], pages: number[]): string[] {
  const problems: string[] = [];
  const byPage = new Map<number, Segment[]>();
  for (const s of segments) {
    const list = byPage.get(s.page);
    if (list) list.push(s);
    else byPage.set(s.page, [s]);
  }
  for (const page of pages) {
    const list = byPage.get(page) ?? [];
    if (list.length === 0) {
      problems.push(`page ${page} has no segments`);
      continue;
    }
    const xs = [...new Set([0, 1, ...list.flatMap((s) => [s.x0, s.x1])])].sort((a, b) => a - b);
    const ys = [...new Set([0, 1, ...list.flatMap((s) => [s.y0, s.y1])])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 1) {
      for (let j = 0; j + 1 < ys.length; j += 1) {
        const cx = (xs[i]! + xs[i + 1]!) / 2;
        const cy = (ys[j]! + ys[j + 1]!) / 2;
        const n = list.filter((s) => s.x0 <= cx && cx <= s.x1 && s.y0 <= cy && cy <= s.y1).length;
        if (n === 0) problems.push(`page ${page}: no segment covers (${cx.toFixed(4)}, ${cy.toFixed(4)})`);
        if (n > 1) problems.push(`page ${page}: ${n} segments overlap at (${cx.toFixed(4)}, ${cy.toFixed(4)})`);
      }
    }
  }
  for (const page of byPage.keys()) {
    if (!pages.includes(page)) problems.push(`segment on page ${page}, which is not a kept page`);
  }
  return problems;
}
