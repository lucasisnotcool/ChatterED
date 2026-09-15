/**
 * Stage 3 — candidate cut lines (`pdf-fidelity-segmentation.md` §C2, §C6).
 *
 * A candidate is a line in page space that (a) lies in a vertical gap between boxes,
 * (b) crosses **no** non-text-ink box, and (c) is below the title band. Condition (b) is the
 * "won't cut a figure" refusal; condition (c) stops a slide title being severed from its slide.
 *
 * Near-misses come back too, each with a `blockedBy` reason, for two reasons: the UI can say
 * *why* it will not cut there, and a free drag can still snap to a gap that was merely too
 * small to be worth a tick.
 *
 * Expected yield on slides, from `segmentation-genres.md` §D1: 1–5 per page, and **zero is a
 * correct answer** — that slide is one concept and the segment is the whole page.
 */
import { bodyBoxes } from './chrome.js';
import { clamp01, columnGutters, EPS } from './boxes.js';
import { DEFAULTS, type CutCandidate, type PageGeometry, type SegmentOptions } from './types.js';

interface Band {
  top: number;
  bottom: number;
}

/** Ink this large is a background or a clip rect, not a figure (§B1.3's own filter). */
const BACKGROUND_AREA = 0.95;

function span(page: PageGeometry, b: { y0: number; y1: number }): [number, number] {
  return [clamp01(b.y0), clamp01(b.y1)];
}

/** The empty bands left between a set of possibly overlapping 1-D intervals. */
function freeBands(intervals: Array<[number, number]>): Band[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Band[] = [];
  let end = sorted[0]![1];
  for (let i = 1; i < sorted.length; i += 1) {
    const [s, e] = sorted[i]!;
    if (s > end + EPS) out.push({ top: end, bottom: s });
    if (e > end) end = e;
  }
  return out;
}

/** What may refuse a cut: real ink, never a container or a page-sized background (§B1.3). */
export function figureBoxes(page: PageGeometry): PageGeometry['inkBoxes'] {
  return page.inkBoxes.filter(
    (b) => b.kind !== 'container' && (b.x1 - b.x0) * (b.y1 - b.y0) < BACKGROUND_AREA,
  );
}

/** Clip `bands` to the inside of `outer`, dropping anything that survives with no width. */
function clipTo(bands: Band[], outer: Band): Band[] {
  const out: Band[] = [];
  for (const b of bands) {
    const top = Math.max(b.top, outer.top);
    const bottom = Math.min(b.bottom, outer.bottom);
    if (bottom - top > EPS) out.push({ top, bottom });
  }
  return out;
}

/**
 * Horizontal candidates for one page.
 *
 * The sweep runs twice: once over body text only (which says where a gap *could* be, and by
 * construction has content above and below it), and once over body text **plus** ink (which
 * says where the page is actually empty). A text gap with no empty sub-band inside it is
 * exactly the figure-in-the-gap case, and is reported rather than dropped.
 */
export function horizontalCandidates(page: PageGeometry, opts: SegmentOptions): CutCandidate[] {
  const body = bodyBoxes(page);
  if (body.length < 2) return [];

  const figures = figureBoxes(page);
  const textGaps = freeBands(body.map((b) => span(page, b)));
  const emptyBands = freeBands([
    ...body.map((b) => span(page, b)),
    ...figures.map((b) => span(page, b)),
  ]);
  const chromeSpans = page.textBoxes
    .filter((_, i) => page.chrome[i])
    .map((b) => span(page, b));

  const toPt = (v: number): number => v * page.height;
  const out: CutCandidate[] = [];

  for (const gap of textGaps) {
    const gapPt = toPt(gap.bottom - gap.top);
    const inside = clipTo(emptyBands, gap);
    const best = inside.reduce<Band | null>(
      (acc, b) => (acc === null || b.bottom - b.top > acc.bottom - acc.top ? b : acc),
      null,
    );

    const hasChrome = chromeSpans.some(([s, e]) => s < gap.bottom - EPS && gap.top < e - EPS);
    const hasFigure = figures.some((f) => f.y0 < gap.bottom - EPS && gap.top < f.y1 - EPS);

    const freePt = best === null ? 0 : toPt(best.bottom - best.top);
    if (best === null || freePt < opts.gapPt) {
      // Not cuttable at `G`. A figure or a footline in the gap is always reported, however
      // little room is left — that near-miss is the "won't cut a figure" message, and the UI
      // needs it at the y the learner was aiming at, not at whatever sliver survived.
      if (hasFigure || hasChrome) {
        out.push({
          page: page.page,
          axis: 'horizontal',
          at: (gap.top + gap.bottom) / 2,
          gapPt,
          blockedBy: hasFigure ? 'figure' : 'chrome',
        });
      } else if (best !== null && freePt >= opts.nearMissPt) {
        // A real gap, merely too small for a tick. Kept so a free drag can still snap to it.
        out.push({
          page: page.page,
          axis: 'horizontal',
          at: (best.top + best.bottom) / 2,
          gapPt: freePt,
          blockedBy: 'gap-too-small',
        });
      }
      continue;
    }

    const at = (best.top + best.bottom) / 2;
    out.push({
      page: page.page,
      axis: 'horizontal',
      at,
      gapPt: freePt,
      blockedBy: at < opts.titleBand ? 'title-band' : hasChrome ? 'chrome' : null,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Vertical candidates — §C6 mechanism 1, "the same computation rotated".
 *
 * Offered only when the body text forms **exactly two** x-clusters, i.e. one gutter. Three or
 * more clusters on a slide is a row of boxes, not a column layout, and a vertical cut through
 * it would be arbitrary; two is the "figure beside the bullets" slide where the concept
 * boundary genuinely is vertical and each segment keeps its own column.
 */
export function verticalCandidates(page: PageGeometry, opts: SegmentOptions): CutCandidate[] {
  // Below the title band only. A slide title spans the page, so counting it closes the gutter
  // on exactly the layout this rule exists for: a figure on the left, bullets on the right,
  // one title across the top (measured: fixture page 4).
  const body = bodyBoxes(page)
    .filter((b) => b.y1 > opts.titleBand)
    // A run wider than half the page is a header or a caption laid *across* the columns, not
    // column content. Counting it closes the gutter (measured: fixture page 4, where one
    // 0.02–0.54 run sat across the whole left half).
    .filter((b) => b.x1 - b.x0 <= 0.5);
  if (body.length < 2) return [];
  const gutters = columnGutters(body, opts.gapPt / page.width);
  if (gutters.length !== 1) return [];

  const [left, right] = gutters[0]!;
  const at = (left + right) / 2;
  const figures = figureBoxes(page);
  const crosses = figures.some((f) => f.x0 < at - EPS && at < f.x1 - EPS);
  return [
    {
      page: page.page,
      axis: 'vertical',
      at,
      gapPt: (right - left) * page.width,
      blockedBy: crosses ? 'figure' : null,
    },
  ];
}

export function candidatesForPage(
  page: PageGeometry,
  opts: Partial<SegmentOptions> = {},
): CutCandidate[] {
  const o = { ...DEFAULTS, ...opts };
  return [...horizontalCandidates(page, o), ...verticalCandidates(page, o)];
}

/** The ones the UI draws as ticks. Everything else is a near-miss with a reason attached. */
export function acceptedCuts(candidates: CutCandidate[]): CutCandidate[] {
  return candidates.filter((c) => c.blockedBy === null);
}
