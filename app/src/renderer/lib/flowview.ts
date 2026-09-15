/**
 * The flow's arithmetic, extracted from the components so it can be tested.
 *
 * Same division of labour as `lib/pdfview.ts`: the components do layout, pdf.js and the DOM;
 * every number lives here as a plain function with a test. `vitest` runs `environment: 'node'`,
 * so nothing in this file may touch a canvas, an element or `window` — a `CanvasRenderingContext2D`
 * is only ever *described* here (a source rectangle and a destination size) and handed to the
 * card to draw.
 *
 * Read `app/docs/SEGMENTS.md` first. Two of its rules are the reason most of this file exists:
 *
 *   1. **Every rectangle is normalised 0–1 against the page box, y down.** A segment therefore
 *      multiplies straight into `drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, dw, dh)` with no
 *      flip, and nothing here ever flips one either.
 *   2. **Ticks live outside the slide pixels.** `tickPositions` returns offsets down the card's
 *      *gutter*; the only thing ever drawn over a crop is the active split guide.
 *
 * And three rules from `flow-build-plan.md` §4.1 that are bugs if broken, all of them enforced
 * in `drawPlan`:
 *
 *   - `devicePixelRatio` never enters a segment rectangle. The card's CSS box is computed from
 *     the page's size in points and the content width; the DPR only multiplies the backing store.
 *   - Use the page's **own** size, never page 1's (the same bug `governingSize` exists for in
 *     `pdfview.ts`: a portrait cover in front of landscape slides).
 *   - Round to CSS pixels at the last possible moment, and derive the drawn rectangle and the
 *     crop's source rectangle from the same rounded integer.
 */
import {
  DEFAULTS,
  PAGE_BOX,
  snapTo,
  type Box,
  type CutCandidate,
  type SegmentView,
} from '../../shared/segment/index.js';

/**
 * The flow's content width in CSS px (`pdf-fidelity-segmentation.md` §C3: "the flow's content
 * width (~760 px, per the earlier mockups)"). A crop scales to it, which is safe because a crop
 * is one slide's region and slides are wide.
 */
export const CONTENT_WIDTH = 760;

/**
 * The F1 fallback switch (`flow-build-plan.md` §3.8): with this false the flow is exactly what
 * the genre router already ships for every non-slide document — one segment per page, no ticks,
 * no split, no merge — and nothing else in the renderer changes.
 */
export const SPLIT_ENABLED = true;

/** Card chrome, in CSS px. These are layout constants the split's scroll anchor has to know. */
export const LABEL_STRIP = 28;
export const ASK_LINE = 26;
export const CARD_GAP = 16;
/** Everything a card is made of that is not the crop itself. */
export const CARD_CHROME = LABEL_STRIP + ASK_LINE;
/**
 * How much taller the flow gets when one card becomes two: a second card's chrome and gap.
 *
 * The analytic value, and `scrollAfterSplit`'s default. The component measures the real change
 * and passes it in, because a split also brings a merge affordance into the gap between the two
 * halves — and an anchor that is 18 px out is an anchor that visibly slips.
 */
export const SPLIT_ADDED_HEIGHT = CARD_CHROME + CARD_GAP;

/**
 * Ceiling on the page render scale. A 16:9 slide at 760 px content width and a 0.48-wide
 * vertical segment wants 2.1×, doubled again by a Retina DPR — 4 is that case with headroom,
 * and it caps one page canvas at ~22 MB on the fixture deck.
 */
export const MAX_RENDER_SCALE = 4;

/**
 * How many rendered page canvases the flow keeps. Risk 3 in `flow-build-plan.md` §5 is **blank
 * cards on camera**, and the cause it names is a crop drawn off a canvas that someone else's
 * `release()` has evicted. So the flow owns its own cache and is deliberately more generous
 * than `pdfview.ts`'s ±3: the fixture deck is 7 pages and never evicts anything at all.
 */
export const PAGE_CACHE = 8;

/**
 * The placeholder a card paints while its page is still rasterising. Never white: a dark deck
 * would flash a white rectangle the size of a slide, which is the single most visible artefact
 * the storyboard could catch. This is the app's own paper grey, and it is only the fallback —
 * `colourFromPixel` replaces it with the page's own corner as soon as one page has rendered.
 */
export const PLACEHOLDER = '#e9eaf0';

/** A page's size in PDF points — its viewport at scale 1. Always the page's own, never page 1's. */
export interface PagePt {
  width: number;
  height: number;
}

/** A canvas's backing-store size in device pixels. */
export interface CanvasPx {
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The card's CSS box: the content width, and whatever height the crop's own aspect ratio asks
 * for at that width.
 *
 * The aspect ratio is taken in **points**, not in normalised units: a segment that is half the
 * width and half the height of a 16:9 page is 16:9 itself, and normalised numbers alone cannot
 * say that.
 */
export function cardSize(rect: Box, page: PagePt, contentWidth = CONTENT_WIDTH): { w: number; h: number } {
  const wPt = Math.max(0, rect.x1 - rect.x0) * page.width;
  const hPt = Math.max(0, rect.y1 - rect.y0) * page.height;
  const w = Math.max(1, Math.round(contentWidth));
  if (wPt <= 0 || hPt <= 0) return { w, h: 1 };
  return { w, h: Math.max(1, Math.round((w * hPt) / wPt)) };
}

/** A source rectangle in a page canvas's own device pixels, ready for `drawImage`. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The segment's rectangle, in the page canvas's device pixels.
 *
 * Clamped to the canvas rather than trusted: `drawImage` with a source rectangle that overhangs
 * the source canvas by a sub-pixel silently draws transparent edges, which on a slide reads as
 * a hairline of missing pixels along the bottom of every card.
 */
export function sourceRect(rect: Box, canvas: CanvasPx): SourceRect {
  const sx = clamp(Math.round(rect.x0 * canvas.width), 0, Math.max(0, canvas.width - 1));
  const sy = clamp(Math.round(rect.y0 * canvas.height), 0, Math.max(0, canvas.height - 1));
  const sw = clamp(Math.round((rect.x1 - rect.x0) * canvas.width), 1, canvas.width - sx);
  const sh = clamp(Math.round((rect.y1 - rect.y0) * canvas.height), 1, canvas.height - sy);
  return { sx, sy, sw, sh };
}

/** Everything one `drawImage` call needs, plus the canvas box the card must size itself to. */
export interface DrawPlan {
  /** The CSS box of the crop. `devicePixelRatio` is not in here, by rule. */
  css: { w: number; h: number };
  /** The backing store. This is the only place the DPR appears. */
  backing: { w: number; h: number };
  src: SourceRect;
}

/**
 * The whole of a card's geometry, derived once so the drawn rectangle and the source rectangle
 * cannot disagree about a rounding.
 */
export function drawPlan(
  rect: Box,
  page: PagePt,
  canvas: CanvasPx,
  contentWidth = CONTENT_WIDTH,
  dpr = 1,
): DrawPlan {
  const css = cardSize(rect, page, contentWidth);
  const ratio = clamp(dpr, 1, 3);
  return {
    css,
    backing: { w: Math.max(1, Math.round(css.w * ratio)), h: Math.max(1, Math.round(css.h * ratio)) },
    src: sourceRect(rect, canvas),
  };
}

/**
 * The narrowest segment on a page, as a fraction of the page width.
 *
 * It decides how hard the page has to be rasterised: a half-width vertical segment (§C6's
 * two-panel slide, page 6 of the fixture deck) is blown up 2× when it is drawn at the content
 * width, and rendering the page at 1× would show it at half resolution. Whole-page segments
 * give 1 and cost nothing.
 */
export function minWidthFraction(segments: readonly Box[]): number {
  let min = 1;
  for (const s of segments) {
    const w = s.x1 - s.x0;
    if (w > 0 && w < min) min = w;
  }
  return clamp(min, 0.05, 1);
}

/**
 * The pdf.js scale to rasterise one page at, including the DPR.
 *
 * `contentWidth / page.width` is the scale at which a full-width crop is 1:1 on screen; dividing
 * by the narrowest segment's width keeps the most magnified crop on the page at 1:1 too.
 */
export function pageRenderScale(
  page: PagePt,
  narrowest: number,
  contentWidth = CONTENT_WIDTH,
  dpr = 1,
  max = MAX_RENDER_SCALE,
): number {
  if (page.width <= 0) return 0;
  const base = contentWidth / page.width;
  const ratio = clamp(dpr, 1, 3);
  return clamp((base / clamp(narrowest, 0.05, 1)) * ratio, 0.05, max);
}

/** One tick in the card's gutter. `offset` is CSS px from the card's top (or left, vertical). */
export interface TickView {
  key: string;
  axis: 'horizontal' | 'vertical';
  /** The page-normalised position the split will be asked for. */
  at: number;
  offset: number;
  gapPt: number;
}

/**
 * Where the ticks go.
 *
 * Only `blockedBy === null` candidates are drawn — SEGMENTS.md §2: a blocked candidate is a
 * near-miss, carried so a refusal can be explained and so a free drag can still snap, and it
 * must never appear as an offer. Candidates on the segment's own edges are dropped too: a tick
 * flush with the top of a card proposes a cut that `splitSegment` would refuse as `degenerate`.
 */
export function tickPositions(
  segment: { x0: number; y0: number; x1: number; y1: number; candidates?: readonly CutCandidate[] },
  page: PagePt,
  contentWidth = CONTENT_WIDTH,
  enabled = SPLIT_ENABLED,
): TickView[] {
  if (!enabled) return [];
  const { w, h } = cardSize(segment, page, contentWidth);
  const out: TickView[] = [];
  for (const c of segment.candidates ?? []) {
    if (c.blockedBy !== null) continue;
    const lo = c.axis === 'horizontal' ? segment.y0 : segment.x0;
    const hi = c.axis === 'horizontal' ? segment.y1 : segment.x1;
    if (!(c.at > lo && c.at < hi)) continue;
    const span = c.axis === 'horizontal' ? h : w;
    out.push({
      key: `${c.axis}:${c.at.toFixed(6)}`,
      axis: c.axis,
      at: c.at,
      offset: Math.round(offsetFromNorm(c.at, span, lo, hi)),
      gapPt: c.gapPt,
    });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/** A page-normalised coordinate → CSS px inside the card, along the cut's own axis. */
export function offsetFromNorm(at: number, span: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return ((at - lo) / (hi - lo)) * span;
}

/** CSS px inside the card → a page-normalised coordinate, along the cut's own axis. */
export function normFromOffset(offset: number, span: number, lo: number, hi: number): number {
  if (span <= 0) return lo;
  return clamp(lo + (offset / span) * (hi - lo), lo, hi);
}

export interface SnapPreview {
  /** Where the guide is drawn, and where the split will be asked for. */
  at: number;
  snappedTo: CutCandidate | null;
}

/**
 * The renderer's own snap, so the dashed guide lands exactly where the cut will.
 *
 * It calls the same `snapTo` the main process calls, with the same 8 pt radius, against the
 * page's own height (or width, for a vertical cut) — SEGMENTS.md §4 asks for precisely this,
 * and doing the arithmetic twice with one implementation is the only way the preview cannot
 * lie. `free` is the held modifier: no snap, and the cut is recorded as the learner's.
 */
export function snapPreview(
  at: number,
  axis: 'horizontal' | 'vertical',
  candidates: readonly CutCandidate[],
  page: PagePt,
  opts: { free?: boolean; snapPt?: number } = {},
): SnapPreview {
  if (opts.free === true) return { at, snappedTo: null };
  const sizePt = axis === 'horizontal' ? page.height : page.width;
  const snapped = snapTo(at, axis, [...candidates], sizePt, opts.snapPt ?? DEFAULTS.snapPt);
  return { at: snapped?.at ?? at, snappedTo: snapped };
}

/**
 * Where the scroller has to be after a split so the viewport does not move.
 *
 * A split only ever *adds* chrome: the crop above the cut keeps its pixels and its position, and
 * everything below it slides down by one label strip, one ask line and one gap. So the rule is
 * the one every anchored list uses — if the cut is above the top of the viewport, the content
 * under the learner's eye has moved, and the scroller has to follow it; if the cut is on screen
 * or below, nothing above the fold moved and the scroller must not be touched.
 *
 * `cutTop` is the cut's position in *scroller* coordinates, which is the card's top plus the
 * offset `offsetFromNorm` gives.
 */
export function scrollAfterSplit(scrollTop: number, cutTop: number, added = SPLIT_ADDED_HEIGHT): number {
  return cutTop < scrollTop ? Math.max(0, scrollTop + added) : scrollTop;
}

/** The inverse: a merge removes that chrome again. */
export function scrollAfterMerge(scrollTop: number, seamTop: number, added = SPLIT_ADDED_HEIGHT): number {
  return seamTop < scrollTop ? Math.max(0, scrollTop - added) : scrollTop;
}

/**
 * A least-recently-used cache of rendered page canvases.
 *
 * Generic over its value so it can be tested without a DOM: the component instantiates it as
 * `PageLru<HTMLCanvasElement>` and passes `dispose` a function that sets the canvas to 0 × 0,
 * which is the reliable release in Chromium (`pdfview.ts` `release()` says why).
 *
 * `pin` is the risk-3 rule: the pages a card is currently showing are never evicted, however
 * old they are, because evicting one is exactly the blank card the plan is afraid of.
 */
export class PageLru<T> {
  readonly capacity: number;
  readonly #dispose: ((page: number, value: T) => void) | undefined;
  /** Insertion order is the LRU order; `get` re-inserts. */
  readonly #entries = new Map<number, T>();
  #pinned: ReadonlySet<number> = new Set();

  constructor(capacity = PAGE_CACHE, dispose?: (page: number, value: T) => void) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.#dispose = dispose;
  }

  get size(): number {
    return this.#entries.size;
  }

  pages(): number[] {
    return [...this.#entries.keys()];
  }

  has(page: number): boolean {
    return this.#entries.has(page);
  }

  /** Reading marks the page as most recently used. */
  get(page: number): T | undefined {
    const hit = this.#entries.get(page);
    if (hit === undefined) return undefined;
    this.#entries.delete(page);
    this.#entries.set(page, hit);
    return hit;
  }

  /** The pages on screen right now. Never evicted. */
  pin(pages: Iterable<number>): void {
    this.#pinned = new Set(pages);
  }

  set(page: number, value: T): void {
    const previous = this.#entries.get(page);
    if (previous !== undefined && previous !== value) this.#dispose?.(page, previous);
    this.#entries.delete(page);
    this.#entries.set(page, value);
    this.#trim();
  }

  delete(page: number): void {
    const hit = this.#entries.get(page);
    if (hit === undefined) return;
    this.#entries.delete(page);
    this.#dispose?.(page, hit);
  }

  clear(): void {
    for (const page of [...this.#entries.keys()]) this.delete(page);
    this.#pinned = new Set();
  }

  #trim(): void {
    if (this.#entries.size <= this.capacity) return;
    for (const page of [...this.#entries.keys()]) {
      if (this.#entries.size <= this.capacity) return;
      if (this.#pinned.has(page)) continue;
      this.delete(page);
    }
  }
}

/**
 * The page's own background colour, from one pixel of it.
 *
 * Sampled from the rendered canvas's top-left corner: a slide's background is a flat fill in
 * every deck in the corpus, and a corner is the pixel least likely to carry content. A fully
 * transparent pixel means the page painted no background at all, which for a PDF means paper —
 * and paper under a dark theme is still the placeholder grey, not white.
 */
export function colourFromPixel(rgba: ArrayLike<number>): string {
  const a = rgba.length > 3 ? Number(rgba[3]) : 255;
  if (!Number.isFinite(a) || a < 8) return PLACEHOLDER;
  const r = Math.round(clamp(Number(rgba[0]) || 0, 0, 255));
  const g = Math.round(clamp(Number(rgba[1]) || 0, 0, 255));
  const b = Math.round(clamp(Number(rgba[2]) || 0, 0, 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** One card in the flow, in the order it is drawn. */
export interface FlowCard {
  /** Keyed by segment id in both modes, so Svelte keeps the same DOM node across the toggle. */
  key: string;
  segmentId: string;
  page: number;
  rect: Box;
  label: string;
  buildSteps: number[];
  candidates: CutCandidate[];
  /** True when the card is showing the whole page — Original pages, or an untouched deck. */
  whole: boolean;
}

export type FlowMode = 'segments' | 'pages';

/**
 * The cards, for either mode.
 *
 * **Original pages is not a re-render and not a refetch** (`pdf-fidelity-segmentation.md` §C3:
 * "it changes which rectangle each card displays… and which order they are in"). That claim is
 * this function: same segments in, the full page box and page order out, and the component
 * hands the same page canvas to the same `drawImage`. One card per page, carrying the first
 * segment's identity so the label strip, the chip and "+ Ask here" still address something real.
 */
export function flowCards(segments: readonly SegmentView[], mode: FlowMode = 'segments'): FlowCard[] {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  if (mode === 'segments') {
    return ordered.map((s) => ({
      key: s.id,
      segmentId: s.id,
      page: s.page,
      rect: { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 },
      label: s.label,
      buildSteps: s.buildSteps,
      candidates: s.candidates,
      whole: isWholePage(s),
    }));
  }
  const seen = new Set<number>();
  const out: FlowCard[] = [];
  for (const s of [...ordered].sort((a, b) => a.page - b.page || a.y0 - b.y0 || a.x0 - b.x0)) {
    if (seen.has(s.page)) continue;
    seen.add(s.page);
    out.push({
      key: s.id,
      segmentId: s.id,
      page: s.page,
      rect: { ...PAGE_BOX },
      label: s.label,
      buildSteps: s.buildSteps,
      candidates: [],
      whole: true,
    });
  }
  return out;
}

const EDGE = 1e-6;

export function isWholePage(rect: Box): boolean {
  return (
    rect.x0 <= EDGE && rect.y0 <= EDGE && rect.x1 >= 1 - EDGE && rect.y1 >= 1 - EDGE
  );
}

/**
 * Whether two cards may be merged, and where their seam is.
 *
 * Same page, and the two rectangles must tile their own union exactly — the same test
 * `shared/segment/ops.ts` applies, restated here so the affordance is not offered for a merge
 * the main process would refuse. Cross-page merge is A2 (SEGMENTS.md §3).
 */
export function mergeSeam(a: Box & { page: number }, b: Box & { page: number }): { at: number; axis: 'horizontal' | 'vertical' } | null {
  if (a.page !== b.page) return null;
  const sameCols = near(a.x0, b.x0) && near(a.x1, b.x1);
  const sameRows = near(a.y0, b.y0) && near(a.y1, b.y1);
  if (sameCols && (near(a.y1, b.y0) || near(b.y1, a.y0))) {
    return { at: near(a.y1, b.y0) ? a.y1 : b.y1, axis: 'horizontal' };
  }
  if (sameRows && (near(a.x1, b.x0) || near(b.x1, a.x0))) {
    return { at: near(a.x1, b.x0) ? a.x1 : b.x1, axis: 'vertical' };
  }
  return null;
}

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

/**
 * The undo stack.
 *
 * `segmentation-lazy-split.md` §4: "Split is undoable and merge is its inverse. Both are one
 * number in page space, so the undo stack is trivial and should exist from Day 3." It is
 * trivial because nothing is inverted *locally* — every undo is the opposite operation sent
 * back through the same IPC channel, so SQLite stays the source of truth and the invariants in
 * SEGMENTS.md §5 are checked by the service on the way back in, exactly as they are for a
 * gesture the learner made by hand.
 *
 * The one subtlety is the split's inverse: it merges the two halves, and it can only do that if
 * it knows the id of the half that was minted. `newSegmentIds` recovers it by diffing the view
 * the channel returned, because SEGMENTS.md §5 rule 4 promises the upper half keeps the cut
 * segment's id and only the lower half is new.
 */
export type FlowOp =
  | { kind: 'split'; upperId: string; lowerId: string; at: number; axis: 'horizontal' | 'vertical' }
  | { kind: 'merge'; ids: [string, string]; at: number; axis: 'horizontal' | 'vertical' }
  | { kind: 'reorder'; segmentId: string; from: number; to: number }
  | { kind: 'rename'; segmentId: string; from: string; to: string };

export function invert(op: FlowOp): FlowOp {
  switch (op.kind) {
    case 'split':
      return { kind: 'merge', ids: [op.upperId, op.lowerId], at: op.at, axis: op.axis };
    case 'merge':
      // `free` is implied by the caller: the seam is an exact number, and snapping it to a
      // nearby tick would undo the merge somewhere other than where it happened.
      return { kind: 'split', upperId: op.ids[0], lowerId: op.ids[1], at: op.at, axis: op.axis };
    case 'reorder':
      return { kind: 'reorder', segmentId: op.segmentId, from: op.to, to: op.from };
    case 'rename':
      return { kind: 'rename', segmentId: op.segmentId, from: op.to, to: op.from };
  }
}

/** The ids in `after` that were not in `before`, in `after`'s order. */
export function newSegmentIds(before: readonly { id: string }[], after: readonly { id: string }[]): string[] {
  const had = new Set(before.map((s) => s.id));
  return after.filter((s) => !had.has(s.id)).map((s) => s.id);
}

/** Where a segment sits in the flow, by id. `-1` when it is gone. */
export function indexOfSegment(segments: readonly SegmentView[], id: string): number {
  const hit = segments.find((s) => s.id === id);
  return hit ? hit.order : -1;
}

/** The page chip's text. Build groups say so, because the chip is the honest bit (§C3). */
export function pageChipLabel(card: { page: number }): string {
  return `p. ${card.page}`;
}

export function buildChipLabel(steps: readonly number[]): string | null {
  if (steps.length === 0) return null;
  return `⏴ ${steps.length} build step${steps.length === 1 ? '' : 's'}`;
}

/** The compare-on-hover caption. One sentence, and it is a claim about fidelity (§C3). */
export function compareCaption(page: number): string {
  return `Region of page ${page} · nothing has been re-typeset`;
}
