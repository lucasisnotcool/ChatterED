/**
 * **The search page's three columns** (`docs/research/search.md` §5, Lucas 3 Oct): slides (J),
 * notes (K) and the hit list (L), in that order, each shown or hidden with ⌘J, ⌘K and ⌘L.
 *
 * Pure, so the rules are tested without a DOM:
 *
 *  - **L keeps its width.** Hiding or showing J or K never takes from or gives to the hit list;
 *    only its own divider changes it.
 *  - **J and K share the rest.** With both shown, J has its width and K takes what is left; with
 *    one hidden, the other takes all of it. A hidden column stays as a thin strip, so it can be
 *    clicked open again.
 *  - **Nothing is shown narrower than usable.** A divider dragged past a column's minimum hides
 *    it (`PaneSplitter`'s collapse slack). A window too narrow for both J and K at their minimums
 *    shows K only (the notes are what a learner edits), without forgetting that J is meant to be
 *    shown.
 */
import { clamp, type PanelBounds } from './layout.js';

/** J: the slides. Its width is the one remembered; K takes the rest. */
export const SEARCH_SLIDES: PanelBounds = { min: 240, max: 1600, initial: 440 };
/** K: the notes. No width of its own, only the floor below which it is hidden. */
export const SEARCH_NOTES_MIN = 320;
/** L: the hit list. */
export const SEARCH_HITS: PanelBounds = { min: 280, max: 640, initial: 360 };
/** A hidden column's strip. */
export const STRIP = 28;

export interface SearchColumns {
  slides: boolean;
  notes: boolean;
  hits: boolean;
  slidesWidth: number;
  hitsWidth: number;
}

export const DEFAULT_COLUMNS: SearchColumns = {
  slides: true,
  notes: true,
  hits: true,
  slidesWidth: SEARCH_SLIDES.initial,
  hitsWidth: SEARCH_HITS.initial,
};

export interface SearchWidths {
  /** 0 when not drawn; STRIP when hidden; else its width. */
  slides: number;
  notes: number;
  hits: number;
  /** J is meant to be shown but the window is too narrow for both: drawn as a strip for now. */
  slidesSqueezed: boolean;
  /** The bounds J's divider may drag within now: its max leaves K its minimum. */
  slidesBounds: PanelBounds;
  hitsBounds: PanelBounds;
}

export function searchWidths(total: number, c: SearchColumns): SearchWidths {
  const hits = c.hits ? clamp(c.hitsWidth, SEARCH_HITS.min, SEARCH_HITS.max) : STRIP;
  const rest = Math.max(0, total - hits);
  let slides = c.slides ? 0 : STRIP;
  let notes = c.notes ? 0 : STRIP;
  let slidesSqueezed = false;
  if (c.slides && c.notes) {
    if (rest < SEARCH_SLIDES.min + SEARCH_NOTES_MIN) {
      slidesSqueezed = true;
      slides = STRIP;
      notes = rest - STRIP;
    } else {
      slides = clamp(c.slidesWidth, SEARCH_SLIDES.min, rest - SEARCH_NOTES_MIN);
      notes = rest - slides;
    }
  } else if (c.slides) {
    slides = rest - notes;
  } else if (c.notes) {
    notes = rest - slides;
  }
  const slidesMax = Math.max(SEARCH_SLIDES.min, rest - SEARCH_NOTES_MIN);
  // L may grow until the columns beside it would drop below their minimum.
  const besideMin = (c.slides ? SEARCH_SLIDES.min : STRIP) + (c.notes ? SEARCH_NOTES_MIN : STRIP);
  const hitsMax = clamp(total - besideMin, SEARCH_HITS.min, SEARCH_HITS.max);
  return {
    slides,
    notes,
    hits,
    slidesSqueezed,
    slidesBounds: { min: SEARCH_SLIDES.min, max: Math.min(SEARCH_SLIDES.max, slidesMax), initial: SEARCH_SLIDES.initial },
    hitsBounds: { min: SEARCH_HITS.min, max: hitsMax, initial: SEARCH_HITS.initial },
  };
}

/** A stored layout read defensively: anything missing or wrong is the default. */
export function readColumns(raw: unknown): SearchColumns {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof SearchColumns, unknown>>;
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  const num = (v: unknown, b: PanelBounds): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, b.min, b.max)) : b.initial;
  return {
    slides: bool(o.slides, true),
    notes: bool(o.notes, true),
    hits: bool(o.hits, true),
    slidesWidth: num(o.slidesWidth, SEARCH_SLIDES),
    hitsWidth: num(o.hitsWidth, SEARCH_HITS),
  };
}
