/**
 * Stage 2 — chrome removal (`pdf-fidelity-segmentation.md` §A1.6, §C2).
 *
 * "A box whose text repeats verbatim at the same normalised position on ≥ 60 % of pages is
 * chrome: **excluded from boundary detection, included in every crop**" — it is part of how
 * the slide looks, so it must never be cropped away, only ignored when looking for gaps.
 *
 * On two-column papers this is not tidying: `segmentation-genres.md` §D2 measured that 100 %
 * of full-width candidates on one paper sat in the page-number band. Killing chrome is the
 * difference between one useless candidate per page and zero.
 *
 * The position key is rounded to 1 % of the page. Finer and a footline that drifts half a
 * point between pages reads as seven different boxes; coarser and two genuinely different
 * lines of body text collapse into one.
 */
import { DEFAULTS, type PageGeometry } from './types.js';

const GRID = 100;

function key(text: string, x0: number, y0: number): string {
  return `${Math.round(x0 * GRID)}:${Math.round(y0 * GRID)}:${text.trim()}`;
}

/**
 * Fills `chrome` on every page, in place-free style: the pages are returned as new objects and
 * the inputs are not mutated.
 *
 * A slide number is *not* verbatim-repeating ("3" then "4"), which is deliberate: it is one
 * small box in a corner, it opens no gap a cut could use, and treating a differing digit as
 * chrome would need a numeric special case that would also eat a one-word bullet.
 */
export function markChrome(
  pages: PageGeometry[],
  opts: { chromeShare?: number } = {},
): PageGeometry[] {
  const share = opts.chromeShare ?? DEFAULTS.chromeShare;
  const seen = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const b of page.textBoxes) {
      if (b.text.trim() === '') continue;
      const k = key(b.text, b.x0, b.y0);
      let pagesWith = seen.get(k);
      if (!pagesWith) seen.set(k, (pagesWith = new Set()));
      pagesWith.add(page.page);
    }
  }
  // One page cannot have chrome: everything on it repeats on 100 % of pages.
  const needed = pages.length < 2 ? Number.POSITIVE_INFINITY : share * pages.length;
  return pages.map((page) => ({
    ...page,
    chrome: page.textBoxes.map((b) => {
      if (b.text.trim() === '') return false;
      return (seen.get(key(b.text, b.x0, b.y0))?.size ?? 0) >= needed;
    }),
  }));
}

/** The boxes Stage 3 is allowed to look at: everything the chrome test did not claim. */
export function bodyBoxes(page: PageGeometry): PageGeometry['textBoxes'] {
  return page.textBoxes.filter((_, i) => !page.chrome[i] && page.textBoxes[i]!.text.trim() !== '');
}
