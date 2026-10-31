/**
 * The arithmetic behind the resizable panels, the document zoom and the trackpad gestures that
 * drive both — pure, so every rule here is tested without a DOM (`layout.test.ts`).
 *
 * The state that uses it is `layoutstore.svelte.ts`; the pointer and wheel plumbing is in the
 * components. What lives here is only what has a right answer: which size a key press lands on,
 * when a drag has gone far enough to mean "close this panel", which step ⌘+ goes to next.
 */
import { FLOAT_MARGIN, clampFrame } from './floatframe.js';

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
export const FILES: PanelBounds = { min: 280, max: 440, initial: 300 };
/**
 * The chat column. The ceiling was 620; a learner who has turned the interface text up has
 * longer lines to fit, and the document keeps its own 380 px floor whatever this says.
 */
export const CHAT: PanelBounds = { min: 340, max: 760, initial: 396 };

/**
 * The tutorial sheet beside the notes (`docs/research/tutorials.md` §2): a split column inside the
 * doc column. Its floor is the narrowest a part's chrome (label, status, the four buttons) fits
 * on one line; the notes keep their own floor (`NOTES_SPLIT_MIN`) beside it.
 */

/** The notes' own floor while a tutorial is docked beside them. */
export const NOTES_SPLIT_MIN = 340;

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
 * A drag past the panel's **maximum** by the same slack: the panel on the splitter's other side
 * has been squeezed below what is usable, and closes (the search page's slides | notes edge).
 */
export function dragOvershoots(start: number, startX: number, x: number, sign: GrowSign, bounds: PanelBounds): boolean {
  return start + (x - startX) * sign > bounds.max + COLLAPSE_SLACK;
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

/**
 * The Notebooks home. On a large display at 100 % the grid is a small block of cards; ⌘+ and a
 * pinch scale the whole column, cards and text together, the way a browser zooms a page.
 */
export const HOME_ZOOM = ladder([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);

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

/**
 * **The compact sheet** (2026-10-03, the tutorial docked beside the notes). Below
 * `COMPACT_BELOW` of the sheet's own units the floor gutters cost more than they hold: at a
 * 340 px pane two 104 px gutters left the notes a 132 px column, a heading wrapped a word to a
 * line, and a sheet is not readable like that. Below it the gutters drop to 20 px on the left
 * and 32 on the right (notes.css `.nd-compact`; `GUTTER_COMPACT` is the `--nd-gutter` the sheet's
 * own sums see), and what lived in them moves: the toolbar folds behind a `⋯` handle in the
 * narrow right gutter, the chip shows beside that handle (or over the block's corner, on a block
 * without one), and Remove · Keep becomes a bar above the block. 600 is where the floor gutters
 * leave a ~390 px column; the compact sheet gives the same pane ~550. Wide panes are exactly as
 * they were (`sheetGutter`).
 */
export const COMPACT_BELOW = 600;
export const GUTTER_COMPACT = 24;

export interface SheetFit {
  compact: boolean;
  /** `--nd-gutter`, in the sheet's own units. */
  gutter: number;
}

/** The notes' sheet: compact below `COMPACT_BELOW` units, `sheetGutter`'s gutters above it. */
export function sheetFit(paneWidth: number, zoom: number): SheetFit {
  if (paneWidth > 0 && zoom > 0 && paneWidth / zoom < COMPACT_BELOW) return { compact: true, gutter: GUTTER_COMPACT };
  return { compact: false, gutter: sheetGutter(paneWidth, zoom) };
}

/**
 * The tutorial's sheet. Its wide gutters give way earlier than the notes' do: a part's chrome is
 * inside its card, and what the margin still holds (a citation chip, "Max wrote this · Remove ·
 * Keep") needs about 88 px at 10.5 px. Zoomed (2026-10-04), the sheet is laid out in the pane's
 * width in CSS px at 100 %, as the notes' is (`sheetFit`).
 */
export function tutorialSheetFit(paneWidth: number, zoom = 1): SheetFit {
  const width = zoom > 0 ? paneWidth / zoom : paneWidth;
  if (width > 0 && width < COMPACT_BELOW) return { compact: true, gutter: GUTTER_COMPACT };
  return { compact: false, gutter: Math.round(clamp((width - 640) / 2, 88, GUTTER_FULL)) };
}

/**
 * The panes' headers fold before their sheets do. The notes' header holds the title, Listen,
 * − 100 % +, Insert, Add a question and Freeze: about 640 px on one line, and below that it
 * wrapped onto three rows. Narrower, zoom, Add a question and Freeze go behind a `⋯` menu.
 * The tutorial's holds a label, its title, *Parts n / m* with a bar, Read again, Pop out and
 * ×; below 520 the bar goes and Pop out / Dock are icons, so the title keeps its room.
 */
export const NOTES_HEAD_COMPACT_BELOW = 640;
export const TUTORIAL_HEAD_COMPACT_BELOW = 520;

/** True when a pane `width` px wide (0: not measured yet) should draw its compact header. */
export function headCompact(width: number, below: number): boolean {
  return width > 0 && width < below;
}

/**
 * **Room for a docked tutorial.** Two readable sheets side by side want about 800 px between
 * them (two compact sheets of ~350 px text each). When the shell, less the sources panel and the
 * chat at the widths the learner gave them, leaves the doc column less than that, the sources
 * panel folds away while the tutorial is docked (`LayoutStore.roomForTutorial`). Measured
 * against the panels' set widths, never their drawn ones, so folding it cannot flip the answer.
 */
export const TWO_PANES_WANTED = 800;

export function filesCrowdTutorial(shellWidth: number, filesWidth: number, chatWidth: number): boolean {
  if (shellWidth <= 0) return false;
  return shellWidth - filesWidth - chatWidth < TWO_PANES_WANTED;
}

/** The sources panel's state, as far as a docked tutorial is concerned (`LayoutStore`). */
export interface FilesRoom {
  open: boolean;
  /** Folded by the app to make room for a docked tutorial, not by the learner. */
  madeRoom: boolean;
  docked: boolean;
  /** The learner opened or closed the panel while this tutorial was docked. */
  chose: boolean;
}

/** The learner opened or closed the panel (the toggle, its edge, View ▸ Show/Hide Files). */
export function filesChosen(s: FilesRoom, open: boolean): FilesRoom {
  return { open, madeRoom: false, docked: s.docked, chose: s.docked };
}

/**
 * `crowded` while a tutorial is docked, `null` when none is. Docked and crowded, an open panel
 * folds; docked with room again (the window grew, the chat narrowed), or no longer docked, a
 * panel this folded comes back. A learner who opens or closes the panel while the tutorial is
 * docked has decided, and is left alone until it closes.
 */
export function roomForTutorial(s: FilesRoom, crowded: boolean | null): FilesRoom {
  if (crowded === null) {
    return { open: s.madeRoom ? true : s.open, madeRoom: false, docked: false, chose: false };
  }
  const next = { ...s, docked: true };
  if (s.chose) return next;
  if (crowded && s.open) return { ...next, open: false, madeRoom: true };
  if (!crowded && s.madeRoom) return { ...next, open: true, madeRoom: false };
  return next;
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

// ── The tutorial's floating window (`tutorials.md` §2: Pop out) ───────────────────────────

/** The smallest the tutorial window may be resized to: a part's chrome on one line, a few lines of it. */
export const TUTORIAL_WINDOW_MIN = { width: 380, height: 300 } as const;

/** A window's place and size in viewport px (the slide windows' `Frame`, `pm/slidegeom.ts`). */
export interface FloatFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How much of the window's title bar must stay inside the app to drag it back by. */
const FLOAT_KEEP = 80;
const FLOAT_BAR = 40;

/**
 * The app's size, and where the area a floating window may use starts: `top` is the bottom of the
 * app's title bar (`floatArea`, `lib/floatframe.ts`), which no floating window may go under —
 * it is the OS drag region, and a window there could neither be dragged nor clicked. 0 when absent.
 */
export interface FloatView {
  width: number;
  height: number;
  top?: number;
}

/**
 * **Where the tutorial window goes**, from what was remembered (or nothing) and the app's size
 * now: the size between the minimum and the area below the title bar less a margin, the place
 * anywhere as long as its title bar can still be grabbed and its top is below the app's title bar
 * (`clampFrame`). A frame remembered under the title bar (before 2026-10-04) comes back below it.
 * With nothing remembered: the right half of the app, below the title bar, where it covers the
 * chat rather than the notes it is about.
 */
export function floatFrame(saved: FloatFrame | null, view: FloatView): FloatFrame {
  const area = { left: 0, top: view.top ?? 0, right: view.width, bottom: view.height };
  const base = saved ?? {
    width: Math.min(560, view.width * 0.42),
    height: Math.min(720, view.height - 120),
    left: view.width - Math.min(560, view.width * 0.42) - 24,
    top: Math.max(64, area.top + 16),
  };
  return clampFrame(base, area, { min: TUTORIAL_WINDOW_MIN, keep: FLOAT_KEEP, bar: FLOAT_BAR, margin: FLOAT_MARGIN });
}

/** How far below the app's title bar the notes' window first opens: the doc header, the sheet's header, a gap. */
export const NOTES_WINDOW_BELOW = 92;

/**
 * **Where the notes' window goes** while the tutorial is the main view (2026-10-04): as the
 * tutorial window, but with nothing remembered it starts below the doc header and the sheet's
 * header, so the *Main view* switch and the sheet's **Notes** button stay in sight above it.
 */
export function notesFloatFrame(saved: FloatFrame | null, view: FloatView): FloatFrame {
  if (saved) return floatFrame(saved, view);
  const top = (view.top ?? 0) + NOTES_WINDOW_BELOW;
  const width = Math.min(560, view.width * 0.42);
  return floatFrame({ width, height: Math.min(720, view.height - top - 24), left: view.width - width - 24, top }, view);
}

/** A stored frame read defensively: anything but four finite numbers is nothing remembered. */
export function readFloatFrame(raw: string | null): FloatFrame | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof FloatFrame, unknown>>;
    const nums = [o.left, o.top, o.width, o.height];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return { left: o.left as number, top: o.top as number, width: o.width as number, height: o.height as number };
  } catch {
    return null;
  }
}

// ── The tutorial as the main view (4 Oct 2026, Lucas: the swap) ──────────────────────────

/**
 * **Which notebooks have the tutorial as the main view, and which tutorial** (`tutorials.md` §2,
 * 2026-10-04): notebook id → the tutorial source's file id. Kept per install with the other panel
 * state; a notebook not in it has the notes as the main view, as every notebook did before.
 */
export type TutorialMainMap = Readonly<Record<string, string>>;

/** At most this many notebooks are remembered; the oldest entries go first. */
export const TUTORIAL_MAIN_KEEP = 200;

/** A stored map read defensively: anything but string → non-empty string pairs is dropped. */
export function readTutorialMain(raw: string | null): TutorialMainMap {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k && typeof v === 'string' && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** The swap turned on (a tutorial's file id) or off (null) for one notebook. */
export function withTutorialMain(map: TutorialMainMap, notebookId: string, fileId: string | null): TutorialMainMap {
  const { [notebookId]: _was, ...rest } = map;
  if (fileId === null) return rest;
  // Re-inserted last, so the newest choice is the last kept when the map is trimmed.
  const entries = [...Object.entries(rest), [notebookId, fileId] as const];
  return Object.fromEntries(entries.slice(-TUTORIAL_MAIN_KEEP));
}

/**
 * **The tutorial the middle column shows, or null for the notes.** On only when the notebook has
 * the swap on *and* has a tutorial: the one remembered, or, if that one is gone (its role changed,
 * its source removed), the notebook's first. A notebook with no tutorial left shows its notes.
 */
export function mainTutorialFor(
  map: TutorialMainMap,
  notebookId: string | null,
  tutorials: readonly { fileId: string }[],
): string | null {
  if (!notebookId) return null;
  const want = map[notebookId];
  if (!want || tutorials.length === 0) return null;
  return tutorials.some((t) => t.fileId === want) ? want : tutorials[0]!.fileId;
}

// ── The tutorial's Split: two views of the sheet, one above the other (4 Oct 2026) ─────────

/** The top view's share of the pane's body: never less than a figure's worth, never all of it. */
export const TUTORIAL_SPLIT = { min: 0.15, max: 0.85, initial: 0.4 } as const;

/** Neither view is ever squeezed below this, whatever the ratio says (a short floating window). */
export const SPLIT_VIEW_MIN = 72;

/** A ratio kept inside the bounds, and inside what leaves both views `SPLIT_VIEW_MIN` px tall. */
export function clampSplit(ratio: number, height = 0): number {
  let min: number = TUTORIAL_SPLIT.min;
  let max: number = TUTORIAL_SPLIT.max;
  if (height > SPLIT_VIEW_MIN * 2) {
    min = Math.max(min, SPLIT_VIEW_MIN / height);
    max = Math.min(max, 1 - SPLIT_VIEW_MIN / height);
  }
  if (!Number.isFinite(ratio)) return TUTORIAL_SPLIT.initial;
  return Math.round(clamp(ratio, min, max) * 1000) / 1000;
}

/** The top view's share for a divider dragged to `y` px below the top of a body `height` px tall. */
export function splitRatioAt(y: number, height: number): number {
  if (!(height > 0)) return TUTORIAL_SPLIT.initial;
  return clampSplit(y / height, height);
}

/** ↑/↓ move the divider by 5 % (Shift: 15 %), Home/End to the ends; anything else is not ours. */
export function splitKeyRatio(ratio: number, key: string, shift: boolean, height = 0): number | null {
  const step = shift ? 0.15 : 0.05;
  if (key === 'ArrowUp') return clampSplit(ratio - step, height);
  if (key === 'ArrowDown') return clampSplit(ratio + step, height);
  if (key === 'Home') return clampSplit(0, height);
  if (key === 'End') return clampSplit(1, height);
  return null;
}

/** A stored ratio read defensively: anything but a number in bounds is the initial one. */
export function readSplitRatio(raw: string | null): number {
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? clampSplit(value) : TUTORIAL_SPLIT.initial;
}
