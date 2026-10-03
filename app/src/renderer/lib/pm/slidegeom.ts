/**
 * **The geometry of a slide window, and of the peek beside a chip** (2026-10-03). Pure: plain
 * boxes and numbers, never elements, so every edge — a chip at the bottom of the scroller, a
 * narrow window, a window dragged off the side, a slide taller than its window — is a vitest case
 * in node (`slidegeom.test.ts`). The DOM halves (`slidewindow.ts`, `sourcepop.ts`) only measure
 * and apply.
 */
import type { Rect } from '../../../shared/doc/types.js';

// ── the numbers ─────────────────────────────────────────────────────────────────────────────

/**
 * A new window's size in CSS px, until the learner resizes one. 520 is the narrowest at which a
 * lecture slide's body text (18–24 pt on a 720 pt page) lands at ~12 px, readable without zoom.
 */
export const WINDOW_SIZE = { width: 520, height: 420 } as const;

/** The smallest a window may be dragged to: under this a slide is a thumbnail again. */
export const WINDOW_MIN = { width: 320, height: 240 } as const;

/** How much of a window must stay inside the app: enough of the title bar to grab it back by. */
export const KEEP_VISIBLE = 64;

/** The title bar's height, which `clampWindow` keeps on screen (`slidewindow.css`). */
export const BAR_HEIGHT = 36;

/** A second window opens this far down and right of one already there. */
export const CASCADE = 26;

/** The narrowest a window placed beside its anchor is made to fit a side. */
export const MIN_WIDTH = WINDOW_MIN.width;

/** Between the anchor and the popover: close enough to read as one thing, apart enough to see both. */
export const GAP = 8;

/** Between the popover and the edge of the visible area. */
export const MARGIN = 8;

/** The smallest crop worth inserting, as a fraction of the slide on each side. A click is not a crop. */
export const MIN_CROP = 0.02;

// ── pure geometry ───────────────────────────────────────────────────────────────────────────

/** A box in viewport px. A `DOMRect` is one. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Side = 'left' | 'right';

export interface Placement {
  left: number;
  top: number;
  side: Side;
  width: number;
}

export interface PlaceOptions {
  /** Between anchor and popover. */
  gap?: number;
  /** The popover may shrink to fit a side, down to this. */
  minWidth?: number;
  /** Which side wins when both have room. Left: a chip lives in the right gutter of the notes. */
  prefer?: Side;
  /**
   * The horizontal room, when it is not `bounds`. The popover may lie over the chat column, which
   * is outside the notes scroller, so the room to either side is the window's; only the vertical
   * clamp is the scroller's visible area.
   */
  horizontal?: Box;
}

/** The overlap of two boxes. Empty (right ≤ left or bottom ≤ top) when they do not meet. */
export function intersect(a: Box, b: Box): Box {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

/**
 * **Where a new window (or the peek) goes: beside the anchor, never over it.**
 *
 * Horizontally, `prefer`'s side if the popover fits there at its own width, else the other side
 * if it fits there, else whichever side has more room, with the popover shrunk to that room (not
 * below `minWidth`). When even `minWidth` does not fit either side the popover overlaps the
 * anchor rather than leave the window — a 600 px window is a degenerate case, not a reason to
 * show nothing. Then clamped into `horizontal` with `margin`.
 *
 * Vertically, the popover's top is the anchor's top, clamped so the popover stays inside
 * `bounds` with `margin`. One taller than `bounds` hangs from the top.
 */
export function placeBeside(
  anchor: Box,
  pop: { width: number; height: number },
  bounds: Box,
  margin = MARGIN,
  options: PlaceOptions = {},
): Placement {
  const gap = options.gap ?? GAP;
  const minWidth = Math.min(options.minWidth ?? MIN_WIDTH, pop.width);
  const prefer = options.prefer ?? 'left';
  const h = options.horizontal ?? bounds;
  const room: Record<Side, number> = {
    left: anchor.left - gap - (h.left + margin),
    right: h.right - margin - (anchor.right + gap),
  };
  const other: Side = prefer === 'left' ? 'right' : 'left';

  let side: Side;
  let width = pop.width;
  if (room[prefer] >= pop.width) side = prefer;
  else if (room[other] >= pop.width) side = other;
  else {
    side = room[prefer] >= room[other] ? prefer : other;
    width = Math.max(minWidth, Math.floor(room[side]));
  }

  let left = side === 'left' ? anchor.left - gap - width : anchor.right + gap;
  const maxLeft = h.right - margin - width;
  left = Math.max(h.left + margin, Math.min(left, maxLeft));

  let top = anchor.top;
  top = Math.min(top, bounds.bottom - margin - pop.height);
  top = Math.max(top, bounds.top + margin);

  return { left: Math.round(left), top: Math.round(top), side, width: Math.round(width) };
}

/** A point on the slide, normalised: 0–1 across and down. */
export interface Point {
  x: number;
  y: number;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The crop a drag from `a` to `b` draws, normalised, y down (`shared/doc/types.ts` `Rect`),
 * whichever way the drag went and clamped to the slide, so a drag that overshoots the edge
 * takes the slide to its edge.
 */
export function dragRect(a: Point, b: Point): Rect {
  const ax = unit(a.x);
  const ay = unit(a.y);
  const bx = unit(b.x);
  const by = unit(b.y);
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** Is this crop something to insert, rather than a click or a sliver? */
export function usableCrop(rect: Rect | null, min = MIN_CROP): rect is Rect {
  return rect !== null && rect.x1 - rect.x0 >= min && rect.y1 - rect.y0 >= min;
}

/**
 * The cited page `delta` away from `page` (the ‹ › beside "2 of 3"). On a cited page: the
 * neighbour in the block's own order, wrapping. Off them (the learner stepped through the deck):
 * the nearest cited page in that direction in deck order, wrapping, so ‹ › always lead back.
 */
export function citedStep(pages: readonly number[], page: number, delta: number): number | null {
  const n = pages.length;
  if (n === 0) return null;
  const at = pages.indexOf(page);
  if (at >= 0) return pages[(((at + delta) % n) + n) % n]!;
  const sorted = [...new Set(pages)].sort((x, y) => x - y);
  if (delta > 0) return sorted.find((p) => p > page) ?? sorted[0]!;
  return [...sorted].reverse().find((p) => p < page) ?? sorted[sorted.length - 1]!;
}

/** A normalised rect as CSS percentages of the slide. */
export function rectPercent(rect: Rect): { left: string; top: string; width: string; height: string } {
  const pct = (v: number): string => `${String(Math.round(v * 10000) / 100)}%`;
  return {
    left: pct(rect.x0),
    top: pct(rect.y0),
    width: pct(rect.x1 - rect.x0),
    height: pct(rect.y1 - rect.y0),
  };
}

// ── an image's crop, edited in the window (2026-10-03, third cut) ───────────────────────────
//
// A slide figure in the notes is an inline image the learner can crop, as in Word. Its window
// shows the crop as a box with eight handles: drag inside to move it, a corner to resize it freely,
// an edge to resize it along one axis. The box never leaves the slide and never shrinks below
// `CROP_EDIT_MIN`; a box within `WHOLE_TOLERANCE` of every edge *is* the whole slide, stored as no
// crop at all.

/**
 * The smallest an image's crop may be resized to, as a fraction of the slide on each side. Twice
 * `MIN_CROP`: a box this size is still about 20 px in a default window, so it can be grabbed again.
 */
export const CROP_EDIT_MIN = 0.04;

/** How near every edge a crop must be to count as the whole slide: half a percent, below a hand's precision. */
export const WHOLE_TOLERANCE = 0.005;

/** How far one Shift+arrow nudges the box, as a fraction of the slide. */
export const NUDGE = 0.01;

/** The whole slide, as a crop. */
export const WHOLE_SLIDE: Readonly<Rect> = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

/** A resize handle, by compass point: the edges it moves. North is the top (y down). */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** All eight, clockwise from the top-left corner. */
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The box moved by `dx`, `dy`, its size kept, and stopped at the slide's edge: a drag past the
 * edge slides the box along it rather than squashing it.
 */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  const w = Math.min(1, rect.x1 - rect.x0);
  const h = Math.min(1, rect.y1 - rect.y0);
  const x0 = Math.max(0, Math.min(rect.x0 + dx, 1 - w));
  const y0 = Math.max(0, Math.min(rect.y0 + dy, 1 - h));
  return { x0, y0, x1: Math.min(1, x0 + w), y1: Math.min(1, y0 + h) };
}

/** Where a handle sits on the box: a corner, or the middle of an edge. */
export function handleAt(rect: Rect, handle: Handle): Point {
  const x = handle.includes('w') ? rect.x0 : handle.includes('e') ? rect.x1 : (rect.x0 + rect.x1) / 2;
  const y = handle.includes('n') ? rect.y0 : handle.includes('s') ? rect.y1 : (rect.y0 + rect.y1) / 2;
  return { x, y };
}

/**
 * **The box with `handle` dragged to `point`.** The edges the handle names follow the point; the
 * opposite edge or corner stays put. An edge handle moves one axis only (the point's other
 * coordinate is ignored), a corner both. An edge dragged across its opposite stops `min` short of
 * it instead of flipping the box, and no edge leaves the slide.
 */
export function resizeRect(rect: Rect, handle: Handle, point: Point, min = CROP_EDIT_MIN): Rect {
  let { x0, y0, x1, y1 } = rect;
  if (handle.includes('w')) x0 = Math.max(0, Math.min(point.x, x1 - min));
  if (handle.includes('e')) x1 = Math.min(1, Math.max(point.x, x0 + min));
  if (handle.includes('n')) y0 = Math.max(0, Math.min(point.y, y1 - min));
  if (handle.includes('s')) y1 = Math.min(1, Math.max(point.y, y0 + min));
  return { x0, y0, x1, y1 };
}

/** Is this crop the whole slide? No crop is; so is one within `tolerance` of every edge. */
export function wholeSlide(rect: Rect | null, tolerance = WHOLE_TOLERANCE): boolean {
  if (rect === null) return true;
  return rect.x0 <= tolerance && rect.y0 <= tolerance && rect.x1 >= 1 - tolerance && rect.y1 >= 1 - tolerance;
}

/**
 * **The crop as it is stored**: null for the whole slide (`wholeSlide`), otherwise clamped to the
 * slide and rounded to four places, so a doc attribute reads `0.1234` rather than a pointer's
 * `0.12340000000000001`, and what the window goes on showing is exactly what was stored.
 */
export function settleCrop(rect: Rect, tolerance = WHOLE_TOLERANCE): Rect | null {
  if (wholeSlide(rect, tolerance)) return null;
  const r = (v: number): number => Math.round(unit(v) * 10000) / 10000;
  return { x0: r(rect.x0), y0: r(rect.y0), x1: r(rect.x1), y1: r(rect.y1) };
}

/** The same crop, exactly. */
export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

// ── the window's own geometry (2026-10-03, second cut) ───────────────────────────────────────

/** A window's place and size, in viewport px. */
export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A window's size, kept between `WINDOW_MIN` and the app's own size: a window saved large on a
 * big screen must still fit when the app is opened on a laptop.
 */
export function clampSize(size: { width: number; height: number }, view: Box, margin = MARGIN): { width: number; height: number } {
  const maxW = Math.max(WINDOW_MIN.width, view.right - view.left - 2 * margin);
  const maxH = Math.max(WINDOW_MIN.height, view.bottom - view.top - 2 * margin);
  return {
    width: Math.round(Math.min(maxW, Math.max(WINDOW_MIN.width, size.width))),
    height: Math.round(Math.min(maxH, Math.max(WINDOW_MIN.height, size.height))),
  };
}

/**
 * **Where a window may be dragged: anywhere, as long as it can be dragged back.** Its title bar
 * stays inside the app top to bottom, and at least `keep` px of it stays inside left to right, so
 * a window flung against an edge is never lost off it.
 */
export function clampWindow(frame: Frame, view: Box, keep = KEEP_VISIBLE, bar = BAR_HEIGHT): { left: number; top: number } {
  const left = Math.min(view.right - keep, Math.max(view.left + keep - frame.width, frame.left));
  const top = Math.min(view.bottom - bar, Math.max(view.top, frame.top));
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * A new window's corner, moved down and right by `step` for as long as a window already open sits
 * (within 4 px) at that corner, so two clicks on the same chip's neighbours do not stack two
 * windows exactly on top of each other. Wraps back when it would leave `view`.
 */
export function cascade(at: { left: number; top: number }, taken: readonly { left: number; top: number }[], view: Box, step = CASCADE): { left: number; top: number } {
  let { left, top } = at;
  for (let i = 0; i < 20; i++) {
    const clash = taken.some((t) => Math.abs(t.left - left) < 4 && Math.abs(t.top - top) < 4);
    if (!clash) break;
    left += step;
    top += step;
    if (top > view.bottom - BAR_HEIGHT - step) top = view.top + MARGIN;
    if (left > view.right - KEEP_VISIBLE - step) left = view.left + MARGIN;
  }
  return { left: Math.round(left), top: Math.round(top) };
}

/** The slide inside a window's slide area: as large as fits, in the slide's own shape. */
export function fitSlide(area: { width: number; height: number }, aspect: number): { width: number; height: number } {
  if (!(aspect > 0) || area.width <= 0 || area.height <= 0) return { width: Math.max(0, Math.floor(area.width)), height: 0 };
  // The height from the whole-pixel width, so the box keeps the slide's shape exactly.
  const width = Math.floor(Math.min(area.width, area.height / aspect));
  return { width, height: Math.floor(width * aspect) };
}

export type WindowKey =
  | 'deck-prev'
  | 'deck-next'
  | 'cited-prev'
  | 'cited-next'
  | 'close'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down';

/**
 * **The keys, with a slide window focused** (Lucas, 3 Oct 2026): ← → step through the deck, ↑ ↓
 * through the slides the block cites (or the section's strip), Esc closes. With a modifier held
 * the key is not the window's: ⌘← and friends keep their meaning in a text selection.
 *
 * Shift is the one exception, and only when `nudge` says an image's crop is being edited on this
 * page: Shift+arrow nudges the box by `NUDGE`, as it would move a shape in a slide editor. Without
 * an editable box Shift is ignored, as it always was, so Shift+→ still steps the deck.
 */
export function windowKey(
  event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  options: { nudge?: boolean } = {},
): WindowKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.shiftKey && options.nudge) {
    switch (event.key) {
      case 'ArrowLeft':
        return 'nudge-left';
      case 'ArrowRight':
        return 'nudge-right';
      case 'ArrowUp':
        return 'nudge-up';
      case 'ArrowDown':
        return 'nudge-down';
      default:
        break;
    }
  }
  switch (event.key) {
    case 'ArrowLeft':
      return 'deck-prev';
    case 'ArrowRight':
      return 'deck-next';
    case 'ArrowUp':
      return 'cited-prev';
    case 'ArrowDown':
      return 'cited-next';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}

