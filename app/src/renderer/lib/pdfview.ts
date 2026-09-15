/**
 * The PDF viewer's arithmetic, extracted from the component so it can be tested.
 *
 * `PdfViewer.svelte` is a Svelte component and the test runner is `environment: 'node'` with no
 * DOM, so every number the viewer depends on — the fit scale, which page the counter should
 * read, whether a marked range is usable, which canvases may be thrown away, where a pinch
 * leaves the scroll position — lives here as a plain function. The component does layout and
 * pdf.js; this file does the sums.
 *
 * Measured evidence for why each of these exists is in docs/research/ui-review-code.md §1 and §5.
 */

/** `null` means "the learner set the zoom by hand"; the two named modes are the Fit buttons. */
export type FitMode = 'width' | 'page' | null;

/** A page's size in PDF points, i.e. its viewport at scale 1. */
export interface PageSize {
  w: number;
  h: number;
}

/**
 * The horizontal breathing room either side of a page, in CSS px, and the same value above and
 * below it for fit-page. The old code subtracted 48 as an undocumented fudge; this is half of
 * it per side, and it is applied to both axes so "fit page" really does leave the page inside
 * the pane rather than exactly filling it.
 */
export const GUTTER = 24;

/** Fit may go this small — an A1 poster in a narrow pane needs 0.3 (ui-review-code.md §1). */
export const MIN_FIT = 0.05;
export const MAX_SCALE = 6;

/** The manual zoom steps behind ⊟ / ⊞ and the View menu. Not the floor for a fit scale. */
export const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export function nextZoom(current: number): number {
  return STEPS.find((z) => z > current + 0.01) ?? STEPS[STEPS.length - 1]!;
}

export function prevZoom(current: number): number {
  return [...STEPS].reverse().find((z) => z < current - 0.01) ?? STEPS[0]!;
}

/**
 * The page size the fit is computed against: the widest and the tallest page in the document.
 *
 * Not page 1 (ui-review-code.md §5.8 — a portrait cover in front of landscape slides laid every
 * later page out at the wrong height), and not the current page either, because a fit scale that
 * changes as you scroll reads as the viewer zooming on its own. The widest-and-tallest box means
 * *every* page fits, which is what the word "fit" claims.
 */
export function governingSize(sizes: Iterable<PageSize>): PageSize | null {
  let w = 0;
  let h = 0;
  for (const s of sizes) {
    if (s.w > w) w = s.w;
    if (s.h > h) h = s.h;
  }
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * The scale to render at.
 *
 * Returns **0** when a fit is wanted but the pane or the page has not been measured yet. 0 is
 * the signal "do not paint": the old code guessed 1, laid every page box out at the wrong size,
 * and then re-laid them out a frame later, which is what made the page counter land on an
 * arbitrary page on open (§5.2).
 *
 * `paneW` must be the scroller's `clientWidth`, which already excludes the scrollbar. With
 * `scrollbar-gutter: stable` in the stylesheet it does not change when the scrollbar appears,
 * so the first paint is the final paint.
 */
export function fitScale(input: {
  mode: FitMode;
  zoom: number;
  paneW: number;
  paneH: number;
  page: PageSize | null;
  gutter?: number;
}): number {
  const { mode, zoom, paneW, paneH, page } = input;
  if (mode === null) return clamp(zoom, MIN_FIT, MAX_SCALE);
  if (!page || paneW <= 0 || (mode === 'page' && paneH <= 0)) return 0;
  const gutter = input.gutter ?? GUTTER;
  const byWidth = (paneW - gutter * 2) / page.w;
  const byPage = (paneH - gutter * 2) / page.h;
  const scale = mode === 'width' ? byWidth : Math.min(byWidth, byPage);
  return clamp(scale, MIN_FIT, MAX_SCALE);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Which pages a pane renders: all of them, or just the referenced slide.
 *
 * The room's source pane is page-locked — §B0 calls it "the slide you are explaining", and a
 * learner who can page away from it mid-round is looking at something the agents were never
 * given. Clamped rather than validated: a material whose range outlives a re-scan should show
 * *something*, not an empty pane.
 */
export function visiblePages(pageCount: number, window: { from: number; to: number } | null): number[] {
  if (pageCount <= 0) return [];
  const from = Math.max(1, Math.min(Math.round(window?.from ?? 1), pageCount));
  const to = Math.min(pageCount, Math.max(Math.round(window?.to ?? pageCount), from));
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** A laid-out page box, in scroller coordinates. */
export interface PageBox {
  page: number;
  top: number;
  height: number;
}

/**
 * Which page the counter should read: the last page whose top edge has passed the top of the
 * viewport — the page you are looking at in every Mac PDF reader.
 *
 * It is scroll-position arithmetic on purpose. The old rule was `intersectionRatio > 0.5` from
 * an IntersectionObserver, which (a) had no arbitration between the several pages that clear
 * that threshold at once and simply took whichever entry arrived last, and (b) stops working
 * entirely above ~180 % zoom, where a page is more than twice the viewport's height and its
 * ratio can never reach 0.5 at all (ui-review-code.md §5.2, §5.3). Neither failure is possible
 * here: the answer depends only on `scrollTop`.
 */
export function pageAtViewportTop(boxes: readonly PageBox[], scrollTop: number): number {
  if (boxes.length === 0) return 1;
  let best = boxes[0]!.page;
  for (const box of boxes) {
    // 1 px of slack: a fractional scale leaves the first page's top at 0.5, not 0.
    if (box.top <= scrollTop + 1) best = box.page;
  }
  return best;
}

/** Where the scroller has to be for `page`'s top edge to sit at the top of the viewport. */
export function scrollTopForPage(boxes: readonly PageBox[], page: number): number | null {
  const box = boxes.find((b) => b.page === page);
  return box ? box.top : null;
}

export interface PageRange {
  from: number | null;
  to: number | null;
  /** The inline message under the fields, or null when the range is usable. */
  error: string | null;
  /** False when nothing downstream — "Explain", "Show the room" — may be pressed. */
  valid: boolean;
}

/**
 * Validate the two page-range fields.
 *
 * `null` in either field means "the page I am on" and is legal — `DocumentPane` already falls
 * back that way. What is not legal is an inverted range: `pp. 9–3` produced an empty extraction
 * and seeded session setup with a blank paste box and no explanation (ui-review-code.md §5.4).
 * Out-of-range numbers are clamped silently, because a typed `99` on a 24-page PDF is a slip;
 * an inverted range is not clamped away, because swapping it silently would change what the
 * learner asked for.
 */
export function validateRange(from: number | null, to: number | null, pageCount: number): PageRange {
  const cap = Math.max(1, Math.floor(pageCount) || 1);
  const f = from === null ? null : Math.round(clamp(from, 1, cap));
  const t = to === null ? null : Math.round(clamp(to, 1, cap));
  if (f !== null && t !== null && f > t) {
    return { from: f, to: t, error: `Pages ${f}–${t} runs backwards. The first page has to come first.`, valid: false };
  }
  return { from: f, to: t, error: null, valid: true };
}

/**
 * Marking a range must never be able to produce an empty one: "Start here" past the end pushes
 * the end along with it, and "End here" before the start pulls the start back.
 */
export function markStart(page: number, to: number | null): { from: number; to: number | null } {
  return { from: page, to: to !== null && to < page ? page : to };
}

export function markEnd(page: number, from: number | null): { from: number | null; to: number } {
  return { from: from !== null && from > page ? page : from, to: page };
}

/**
 * Which rasterised pages may be released: everything more than `radius` pages from the one on
 * screen.
 *
 * Measured before this existed: reading one 60-page A4-landscape deck end to end left **60 of
 * 60** canvases rasterised at 15.0 MB each — 901 MB of bitmaps that were never returned until
 * the document was closed (ui-review-code.md §5.1). ±3 pages is wide enough that an ordinary
 * scroll does not thrash the cache, and it caps a document of any length at ~7 canvases, i.e.
 * ~105 MB at the measured per-page cost.
 */
export const KEEP_RADIUS = 3;

export function evictable(drawnPages: Iterable<number>, current: number, radius = KEEP_RADIUS): number[] {
  const out: number[] = [];
  for (const page of drawnPages) {
    if (Math.abs(page - current) > radius) out.push(page);
  }
  return out.sort((a, b) => a - b);
}

/**
 * A macOS pinch arrives in the renderer as a `wheel` event with `ctrlKey` set — verified on
 * Electron 44.3.0 / Chromium 152, cancelable, with the gesture centroid on the event
 * (ui-review-code.md §4, mechanic 1).
 *
 * Multiplicative rather than a linear step, because pinch deltas are continuous and
 * momentum-decayed, so a fixed increment feels wrong at both ends. The per-event factor is
 * capped so one flicked event cannot jump three zoom levels.
 */
export function pinchScale(current: number, deltaY: number, maxStep = 1.1): number {
  const raw = Math.exp(-deltaY / 100);
  const factor = clamp(raw, 1 / maxStep, maxStep);
  return clamp(current * factor, MIN_FIT, MAX_SCALE);
}

/**
 * Keep the document point under the cursor under the cursor while the scale changes from
 * `from` to `to`. `offset` is the scroll offset on that axis; `pointer` is the cursor's
 * position relative to the scroller's own box.
 */
export function anchorScroll(offset: number, pointer: number, from: number, to: number): number {
  if (from <= 0) return offset;
  const k = to / from;
  return Math.max(0, (offset + pointer) * k - pointer);
}

/**
 * Two-finger horizontal scrolling → one page turn per flick.
 *
 * macOS keeps sending momentum `wheel` events for tens of frames after the fingers lift, so
 * without a latch one flick turns fifteen pages. The latch is armed by the first accumulated
 * `threshold` px and only disarms after `idleMs` with no horizontal delta at all.
 *
 * Written as a reducer over an explicit clock so it can be tested without timers.
 */
export interface LatchState {
  accum: number;
  latched: boolean;
  at: number;
}

export const IDLE_MS = 220;
export const TURN_THRESHOLD = 120;

export function emptyLatch(): LatchState {
  return { accum: 0, latched: false, at: 0 };
}

export function pushHorizontal(
  state: LatchState,
  deltaX: number,
  at: number,
  opts: { threshold?: number; idleMs?: number } = {},
): { state: LatchState; turn: -1 | 0 | 1 } {
  const threshold = opts.threshold ?? TURN_THRESHOLD;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const stale = state.at > 0 && at - state.at > idleMs;
  const base = stale ? emptyLatch() : state;
  const accum = base.accum + deltaX;
  if (!base.latched && Math.abs(accum) >= threshold) {
    // A trackpad pushes content left (positive deltaX) to move forward through a document.
    return { state: { accum, latched: true, at }, turn: accum > 0 ? 1 : -1 };
  }
  return { state: { accum, latched: base.latched, at }, turn: 0 };
}

/** Double-click toggles between a fit and 100 %, and back to the fit it came from. */
export function toggleFit(mode: FitMode, remembered: Exclude<FitMode, null>): {
  mode: FitMode;
  zoom: number;
} {
  return mode === null ? { mode: remembered, zoom: 1 } : { mode: null, zoom: 1 };
}
