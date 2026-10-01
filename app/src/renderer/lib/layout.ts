/**
 * The arithmetic behind the resizable panels, the document zoom and the trackpad gestures that
 * drive both — pure, so every rule here is tested without a DOM (`layout.test.ts`).
 *
 * The state that uses it is `layoutstore.svelte.ts`; the pointer and wheel plumbing is in the
 * components. What lives here is only what has a right answer: which size a key press lands on,
 * when a drag has gone far enough to mean "close this panel", which step ⌘+ goes to next.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Panels ────────────────────────────────────────────────────────────────

export interface PanelBounds {
  min: number;
  max: number;
  /** What a double-click on the splitter puts it back to. */
  initial: number;
}

/** The file panel: the vault sidebar, in the shell and beside the page viewer. */
export const FILES: PanelBounds = { min: 180, max: 440, initial: 244 };
/**
 * The chat column. The ceiling was 620; a learner who has turned the interface text up has
 * longer lines to fit, and the document keeps its own 380 px floor whatever this says.
 */
export const CHAT: PanelBounds = { min: 340, max: 760, initial: 396 };

/**
 * How far past its minimum a panel is dragged before the drag means "close it". Far enough that
 * a learner squeezing it to the minimum does not lose it by overshooting by a few pixels.
 */
export const COLLAPSE_SLACK = 72;

/**
 * Which way the panel grows as the pointer moves right: +1 when the panel is on the splitter's
 * left (the file panel), −1 when it is on the right (the chat column).
 */
export type GrowSign = 1 | -1;

/**
 * A drag, as a function of where it started. Delta-based rather than "window width minus the
 * pointer", so a panel's size does not depend on what else happens to be beside it.
 */
export function dragSize(
  start: number,
  startX: number,
  x: number,
  sign: GrowSign,
  bounds: PanelBounds,
  collapsible = false,
): { size: number; collapse: boolean } {
  const raw = start + (x - startX) * sign;
  const collapse = collapsible && raw < bounds.min - COLLAPSE_SLACK;
  return { size: Math.round(clamp(raw, bounds.min, bounds.max)), collapse };
}

/**
 * The keyboard's half of a splitter (the WAI-ARIA window-splitter pattern): arrows move it by a
 * small step, Shift by a large one, Home and End go to the ends. The arrows move the *splitter*,
 * so → grows a panel on its left and shrinks one on its right. `null` means the key is not one
 * of the splitter's.
 */
export function keySize(
  size: number,
  key: string,
  shift: boolean,
  sign: GrowSign,
  bounds: PanelBounds,
): number | null {
  const step = shift ? 48 : 16;
  switch (key) {
    case 'ArrowRight':
      return clamp(size + step * sign, bounds.min, bounds.max);
    case 'ArrowLeft':
      return clamp(size - step * sign, bounds.min, bounds.max);
    case 'Home':
      return bounds.min;
    case 'End':
      return bounds.max;
    default:
      return null;
  }
}

// ── Zoom ──────────────────────────────────────────────────────────────────

export interface ZoomLadder {
  steps: readonly number[];
  /** The floor and ceiling a pinch is clamped to; the same as the ladder's ends. */
  min: number;
  max: number;
}

function ladder(steps: readonly number[]): ZoomLadder {
  return { steps, min: steps[0]!, max: steps[steps.length - 1]! };
}

/**
 * The notes document. 100 % is 15 px body text; 200 % is the large-print end, and 75 % is as
 * small as the gutter chips stay legible.
 */
export const NOTES_ZOOM = ladder([0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);

/** The slide modal, in units of "the whole slide, visible" — the ladder it already had. */
export const SLIDE_ZOOM = ladder([0.6, 0.8, 1, 1.35, 1.8, 2.4]);

/** The next step up from wherever a pinch left the zoom, not the next step from the last step. */
export function zoomIn(current: number, z: ZoomLadder): number {
  return z.steps.find((s) => s > current + 0.001) ?? z.max;
}

export function zoomOut(current: number, z: ZoomLadder): number {
  return [...z.steps].reverse().find((s) => s < current - 0.001) ?? z.min;
}

/** A stored zoom read defensively: missing, corrupt or out of range is 100 %. */
export function readZoom(raw: unknown, z: ZoomLadder): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === null || raw === '' || !Number.isFinite(n) || n <= 0) return 1;
  return clamp(n, z.min, z.max);
}

export function percent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * Where to scroll so the text under a point stays under it while the zoom changes.
 *
 * The notes reflow when they zoom (the column is narrower than the sheet at 150 %), so scroll
 * offsets do not scale linearly and `anchorScroll`'s arithmetic would drift by paragraphs. The
 * anchor is a block instead: measure it before and after, and keep the same fraction of it
 * under the point. Returns the amount to add to `scrollTop`.
 */
export function blockAnchorDelta(
  before: { top: number; height: number },
  after: { top: number; height: number },
  pointY: number,
): number {
  const frac = before.height > 0 ? clamp((pointY - before.top) / before.height, 0, 1) : 0;
  return after.top + frac * after.height - pointY;
}

/**
 * The gutters' full width (notes.css `--nd-gutter`), and the least they shrink to. The floor was
 * 72, the width of a `p. 12` chip; the live run of 1 Oct 2026 showed that is not all a gutter
 * holds. The left one holds **Remove · Keep** (about 76 px at 10.5 px, and at 72 it read
 * "emove"), the right one the block's action toolbar under its chip (about 90 px with its
 * margin, notes.css `.nd-tools`). 104 fits both, and the text column still gets the rest.
 */
export const GUTTER_FULL = 132;
export const GUTTER_FLOOR = 104;
/** The text column the gutters give way to before they will shrink no further. */
const TEXT_WANTED = 560;

/**
 * The notes' side gutters, in the sheet's own (zoomed) units, for a pane `paneWidth` CSS px
 * wide at `zoom`.
 *
 * Fixed 132 px gutters are fine at 100 % in a wide pane. At 200 % in an 850 px column the
 * gutters are doubled along with everything else, and the text is left with a 300 px strip
 * wrapped three words to a line — zooming in made the notes *harder* to read. So the text
 * column comes first: the gutters shrink toward the floor until the text has
 * `TEXT_WANTED` units, and are full width again whenever there is room.
 */
export function sheetGutter(paneWidth: number, zoom: number): number {
  if (paneWidth <= 0 || zoom <= 0) return GUTTER_FULL;
  const inner = paneWidth / zoom;
  return Math.round(clamp((inner - TEXT_WANTED) / 2, GUTTER_FLOOR, GUTTER_FULL));
}

// ── Swipes ────────────────────────────────────────────────────────────────

/**
 * Is this wheel event a sideways swipe rather than a scroll? Sideways by a clear margin, so a
 * slightly diagonal scroll down a thread never flips the tab under the learner.
 */
export function isSideways(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) > 2 * Math.abs(deltaY);
}

/**
 * Could anything between the event target and the swipe surface scroll sideways in this
 * direction? If so the gesture is a pan of that thing — a wide code block, a table — and not a
 * swipe. `el` is walked up to (and including) `boundary`.
 */
export function canScrollSideways(
  el: Element | null,
  boundary: Element,
  deltaX: number,
  style: (el: Element) => { overflowX: string } = (e) => getComputedStyle(e),
): boolean {
  for (let node = el; node; node = node.parentElement) {
    const { scrollWidth, clientWidth, scrollLeft } = node as HTMLElement;
    if (scrollWidth > clientWidth + 1) {
      const overflow = style(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') {
        if (deltaX > 0 && scrollLeft + clientWidth < scrollWidth - 1) return true;
        if (deltaX < 0 && scrollLeft > 0) return true;
      }
    }
    if (node === boundary) break;
  }
  return false;
}

/** Tab n steps along a strip, stopping at the ends — a swipe past the last tab does nothing. */
export function stepTab<T>(tabs: readonly T[], current: T, by: number): T {
  const at = tabs.indexOf(current);
  if (at < 0) return current;
  return tabs[clamp(at + by, 0, tabs.length - 1)]!;
}
