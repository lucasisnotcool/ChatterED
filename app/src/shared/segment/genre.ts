/**
 * The genre router — `segmentation-genres.md` §H, issue #31.
 *
 * "The router itself is ten lines and needs no model, from the numbers in §C: **words/page
 * < 150 and text coverage < 0.40 and landscape → slides; words/page > 500 with two detected
 * gutters → 2-column paper; words/page > 250, one column → prose; words/page < 5 → image-only
 * (if image XObjects present) or ink-only handwriting (if not).** Every one of the 19 files in
 * this corpus is classified correctly by those four rules."
 *
 * Two readings had to be fixed to make that executable, and both are stated here rather than
 * buried:
 *
 * 1. **"two detected gutters" is read as "two detected columns", i.e. one gutter.** §C's own
 *    `cols` column counts columns (its two-column papers read `2`), and §D3's `pc8`/`pc16` are
 *    "per column band". A literal two gutters would mean a three-column layout, which appears
 *    nowhere in the corpus.
 * 2. **The rules do not tile the space** (a 200-word landscape page matches none of them). The
 *    default is `'prose'`, which is the conservative answer: prose gets whole-page segments
 *    plus a notice in A1, so a misroute costs a notice, never a wrong cut.
 *
 * Only `'slides'` produces candidate cuts in A1. Everything else opens as whole pages with the
 * notice §H asks for — "say it in the UI".
 */
import { columnGutters, textCoverage, wordCount } from './boxes.js';
import { DEFAULTS, type Genre, type GenreSignals, type PageGeometry } from './types.js';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function genreSignals(pages: PageGeometry[]): GenreSignals {
  if (pages.length === 0) {
    return { wordsPerPage: 0, textCoverage: 0, columns: 0, landscape: false, images: 0 };
  }
  const words = pages.map(wordCount);
  const cov = pages.map((p) => textCoverage(p.textBoxes.filter((b) => b.text.trim() !== '')));
  const cols = pages.map((p) => {
    const body = p.textBoxes.filter((b) => b.text.trim() !== '');
    return columnGutters(body, DEFAULTS.gapPt / p.width).length + 1;
  });
  return {
    wordsPerPage: median(words),
    textCoverage: median(cov),
    columns: median(cols),
    landscape: median(pages.map((p) => p.width)) > median(pages.map((p) => p.height)),
    images: pages.reduce((n, p) => n + p.imageCount, 0),
  };
}

export function routeGenre(signals: GenreSignals): Genre {
  if (signals.wordsPerPage < 5) return signals.images > 0 ? 'image-only' : 'ink-only';
  if (signals.wordsPerPage < 150 && signals.textCoverage < 0.4 && signals.landscape) return 'slides';
  if (signals.wordsPerPage > 500 && signals.columns >= 2) return 'paper-2col';
  if (signals.wordsPerPage > 250) return 'prose';
  return 'prose';
}

/** The sentence the flow shows above the first card. `null` for slides: nothing to apologise for. */
export function noticeFor(genre: Genre): string | null {
  switch (genre) {
    case 'slides':
      return null;
    case 'image-only':
    case 'ink-only':
      return 'This document has no text layer — segments are whole pages.';
    default:
      return 'This document is not a slide deck — segments are whole pages.';
  }
}
