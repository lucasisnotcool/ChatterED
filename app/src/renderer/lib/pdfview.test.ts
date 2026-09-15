import { describe, expect, it } from 'vitest';
import {
  anchorScroll,
  emptyLatch,
  evictable,
  fitScale,
  governingSize,
  markEnd,
  markStart,
  nextZoom,
  pageAtViewportTop,
  pinchScale,
  prevZoom,
  pushHorizontal,
  scrollTopForPage,
  toggleFit,
  validateRange,
  visiblePages,
} from './pdfview.js';

/**
 * The numbers in these tests are the ones measured in the running app and written down in
 * docs/research/ui-review-code.md §1 and §5 — the 16:9 deck at 960 pt, the A4-landscape lecture
 * deck at 841.9 pt, the 891 px pane. A test that passes against invented numbers would not have
 * caught the bug.
 */

const LETTER = { w: 612, h: 792 };
const A4_LANDSCAPE = { w: 841.9, h: 595.3 };
const SLIDE_16_9 = { w: 960, h: 540 };

describe('fitScale', () => {
  it('fits the width of a 16:9 deck into the measured pane instead of dividing by 612', () => {
    // Before the fix: (891 - 48) / 612 = 1.377 → a 1322 px page in an 891 px pane.
    const scale = fitScale({ mode: 'width', zoom: 1, paneW: 891, paneH: 678, page: SLIDE_16_9 });
    expect(Math.round(SLIDE_16_9.w * scale)).toBeLessThanOrEqual(891);
    expect(Math.round(SLIDE_16_9.w * scale)).toBe(843);
  });

  it('fits an A4-landscape lecture deck and a US-Letter paper to the same rendered width', () => {
    const pane = { paneW: 891, paneH: 678 };
    const landscape = fitScale({ mode: 'width', zoom: 1, page: A4_LANDSCAPE, ...pane });
    const letter = fitScale({ mode: 'width', zoom: 1, page: LETTER, ...pane });
    expect(Math.round(A4_LANDSCAPE.w * landscape)).toBe(843);
    expect(Math.round(LETTER.w * letter)).toBe(843);
  });

  it('fit-page shows a whole page where fit-width still leaves it taller than the pane', () => {
    const pane = { paneW: 891, paneH: 678 };
    const byWidth = fitScale({ mode: 'width', zoom: 1, page: LETTER, ...pane });
    const byPage = fitScale({ mode: 'page', zoom: 1, page: LETTER, ...pane });
    expect(LETTER.h * byWidth).toBeGreaterThan(678); // 1091 px of page in a 678 px viewport
    expect(LETTER.h * byPage).toBeLessThanOrEqual(678);
    expect(LETTER.w * byPage).toBeLessThanOrEqual(891);
    expect(byPage).toBeLessThan(byWidth);
  });

  it('is the same answer for a 16:9 deck in a wide pane — the slide already fits either way', () => {
    const pane = { paneW: 891, paneH: 678 };
    expect(fitScale({ mode: 'page', zoom: 1, page: SLIDE_16_9, ...pane })).toBeCloseTo(
      fitScale({ mode: 'width', zoom: 1, page: SLIDE_16_9, ...pane }),
      6,
    );
    // …and fit-page is what saves it once the room's source pane is short.
    const short = { paneW: 891, paneH: 380 };
    expect(SLIDE_16_9.h * fitScale({ mode: 'page', zoom: 1, page: SLIDE_16_9, ...short })).toBeLessThanOrEqual(380);
  });

  it('returns 0 — "do not paint" — until both the pane and the page are measured', () => {
    expect(fitScale({ mode: 'width', zoom: 1, paneW: 0, paneH: 0, page: SLIDE_16_9 })).toBe(0);
    expect(fitScale({ mode: 'width', zoom: 1, paneW: 891, paneH: 678, page: null })).toBe(0);
    expect(fitScale({ mode: 'page', zoom: 1, paneW: 891, paneH: 0, page: SLIDE_16_9 })).toBe(0);
    expect(fitScale({ mode: 'width', zoom: 1, paneW: 891, paneH: 678, page: SLIDE_16_9 })).toBeGreaterThan(0);
  });

  it('lets a fit go below the 0.4 manual-zoom floor for an oversized page', () => {
    // A1 portrait, 1684 × 2384 pt, in a 500 px pane: 0.4 would still overflow by 3.3×.
    const scale = fitScale({ mode: 'width', zoom: 1, paneW: 500, paneH: 700, page: { w: 1684, h: 2384 } });
    expect(scale).toBeLessThan(0.4);
    expect(1684 * scale).toBeLessThanOrEqual(500);
  });

  it('passes the manual zoom straight through when no fit is active', () => {
    expect(fitScale({ mode: null, zoom: 1.25, paneW: 891, paneH: 678, page: LETTER })).toBe(1.25);
  });
});

describe('governingSize', () => {
  it('is the widest and the tallest page, not page 1 (a portrait cover then landscape slides)', () => {
    expect(governingSize([LETTER, A4_LANDSCAPE, A4_LANDSCAPE])).toEqual({ w: 841.9, h: 792 });
  });

  it('is null while nothing has been measured', () => {
    expect(governingSize([])).toBeNull();
  });
});

describe('pageAtViewportTop', () => {
  const boxes = [
    { page: 1, top: 0, height: 1110 },
    { page: 2, top: 1124, height: 1110 },
    { page: 3, top: 2248, height: 1110 },
    { page: 4, top: 3372, height: 1110 },
  ];

  it('reads 1 at the top of a freshly opened document', () => {
    expect(pageAtViewportTop(boxes, 0)).toBe(1);
  });

  it('stays on a page until the next page\'s top edge passes the viewport top', () => {
    expect(pageAtViewportTop(boxes, 1100)).toBe(1);
    expect(pageAtViewportTop(boxes, 1124)).toBe(2);
    expect(pageAtViewportTop(boxes, 2300)).toBe(3);
  });

  it('keeps working when a page is taller than twice the viewport (the 300 % case)', () => {
    // 24-page A4 at 300 %: page height 2376 px, viewport 693 px. intersectionRatio could never
    // reach 0.5 here, which is why the counter used to freeze on page 1 (§5.3).
    const tall = Array.from({ length: 24 }, (_, i) => ({ page: i + 1, top: i * 2390, height: 2376 }));
    expect(pageAtViewportTop(tall, 2390 * 5)).toBe(6);
    expect(pageAtViewportTop(tall, 2390 * 5 + 2000)).toBe(6);
    expect(pageAtViewportTop(tall, 2390 * 6)).toBe(7);
  });

  it('tolerates the sub-pixel top edge a fractional scale produces', () => {
    expect(pageAtViewportTop([{ page: 1, top: 0.5, height: 100 }], 0)).toBe(1);
  });

  it('answers 1 for an empty document rather than throwing', () => {
    expect(pageAtViewportTop([], 400)).toBe(1);
  });

  it('gives back the offset a page has to be scrolled to', () => {
    expect(scrollTopForPage(boxes, 3)).toBe(2248);
    expect(scrollTopForPage(boxes, 9)).toBeNull();
  });
});

describe('validateRange', () => {
  it('refuses an inverted range instead of seeding an empty paste box', () => {
    const range = validateRange(9, 3, 24);
    expect(range.valid).toBe(false);
    expect(range.error).toMatch(/backwards/);
  });

  it('clamps a typed page number to the document', () => {
    expect(validateRange(0, 99, 24)).toMatchObject({ from: 1, to: 24, valid: true });
  });

  it('treats an empty field as "the page I am on"', () => {
    expect(validateRange(null, null, 24)).toMatchObject({ from: null, to: null, valid: true });
    expect(validateRange(3, null, 24)).toMatchObject({ from: 3, to: null, valid: true });
  });

  it('accepts a single-page range', () => {
    expect(validateRange(3, 3, 24).valid).toBe(true);
  });

  it('survives a pageCount of 0 — the range fields exist before the document has loaded', () => {
    expect(validateRange(2, 5, 0)).toMatchObject({ from: 1, to: 1, valid: true });
  });
});

describe('marking a range', () => {
  it('pushes the end along when the start is marked past it', () => {
    expect(markStart(9, 3)).toEqual({ from: 9, to: 9 });
    expect(markStart(2, 7)).toEqual({ from: 2, to: 7 });
    expect(markStart(2, null)).toEqual({ from: 2, to: null });
  });

  it('pulls the start back when the end is marked before it', () => {
    expect(markEnd(3, 9)).toEqual({ from: 3, to: 3 });
    expect(markEnd(9, 3)).toEqual({ from: 3, to: 9 });
  });
});

describe('evictable', () => {
  it('releases every canvas outside ±3 pages of the one on screen', () => {
    const drawn = Array.from({ length: 60 }, (_, i) => i + 1);
    expect(evictable(drawn, 30)).toEqual([
      ...Array.from({ length: 26 }, (_, i) => i + 1),
      ...Array.from({ length: 27 }, (_, i) => i + 34),
    ]);
  });

  it('caps a 60-page read-through at seven live canvases', () => {
    const drawn = new Set<number>();
    for (let page = 1; page <= 60; page += 1) {
      drawn.add(page);
      for (const gone of evictable(drawn, page)) drawn.delete(gone);
      expect(drawn.size).toBeLessThanOrEqual(7);
    }
    // 15.0 MB per page measured on the A4-landscape deck: 7 × 15.0 = 105 MB, not 901 MB.
    expect(drawn.size * 15.0).toBeLessThan(150);
  });

  it('keeps the neighbours a small scroll will come straight back to', () => {
    expect(evictable([1, 2, 3, 4, 5], 3)).toEqual([]);
  });
});

describe('pinch and anchor', () => {
  it('zooms in on a negative deltaY and out on a positive one', () => {
    expect(pinchScale(1, -5)).toBeGreaterThan(1);
    expect(pinchScale(1, 5)).toBeLessThan(1);
  });

  it('caps one flicked event to a tenth either way', () => {
    expect(pinchScale(1, -1000)).toBeCloseTo(1.1, 5);
    expect(pinchScale(1, 1000)).toBeCloseTo(1 / 1.1, 5);
  });

  it('never leaves the scale outside the viewer\'s limits', () => {
    expect(pinchScale(6, -50)).toBeLessThanOrEqual(6);
    expect(pinchScale(0.05, 50)).toBeGreaterThanOrEqual(0.05);
  });

  it('keeps the point under the cursor under the cursor', () => {
    // The document point at scroll 400 + pointer 200 = 600 must stay under pointer 200 at 2×.
    const next = anchorScroll(400, 200, 1, 2);
    expect(next).toBe(1000);
    expect((next + 200) / 2).toBe(600);
  });

  it('never scrolls to a negative offset', () => {
    expect(anchorScroll(0, 100, 2, 1)).toBe(0);
  });
});

describe('the horizontal page-turn latch', () => {
  it('turns exactly one page for one flick, momentum included', () => {
    let state = emptyLatch();
    let turns = 0;
    // A real flick: the fingers move, then thirty momentum events decay away.
    const deltas = [40, 60, 70, 55, ...Array.from({ length: 30 }, (_, i) => 30 / (i + 1))];
    for (const [i, d] of deltas.entries()) {
      const out = pushHorizontal(state, d, i * 16);
      state = out.state;
      turns += Math.abs(out.turn);
    }
    expect(turns).toBe(1);
  });

  it('turns forward on a leftward push and back on a rightward one', () => {
    expect(pushHorizontal(emptyLatch(), 130, 0).turn).toBe(1);
    expect(pushHorizontal(emptyLatch(), -130, 0).turn).toBe(-1);
  });

  it('ignores a drift below the threshold', () => {
    let state = emptyLatch();
    for (let i = 0; i < 5; i += 1) {
      const out = pushHorizontal(state, 10, i * 16);
      state = out.state;
      expect(out.turn).toBe(0);
    }
  });

  it('re-arms once the momentum has died, so a second flick turns a second page', () => {
    const first = pushHorizontal(emptyLatch(), 130, 0);
    expect(first.turn).toBe(1);
    const tooSoon = pushHorizontal(first.state, 130, 100);
    expect(tooSoon.turn).toBe(0);
    const later = pushHorizontal(tooSoon.state, 130, 1000);
    expect(later.turn).toBe(1);
  });
});

describe('zoom steps and the double-click toggle', () => {
  it('steps through the fixed ladder', () => {
    expect(nextZoom(1)).toBe(1.25);
    expect(prevZoom(1)).toBe(0.75);
    expect(nextZoom(3)).toBe(3);
    expect(prevZoom(0.5)).toBe(0.5);
  });

  it('leaves a fit for 100 % and comes back to the fit it left', () => {
    expect(toggleFit('page', 'page')).toEqual({ mode: null, zoom: 1 });
    expect(toggleFit(null, 'page')).toEqual({ mode: 'page', zoom: 1 });
    expect(toggleFit(null, 'width')).toEqual({ mode: 'width', zoom: 1 });
  });
});

describe('visiblePages', () => {
  it('is the whole document when nothing is pinned', () => {
    expect(visiblePages(3, null)).toEqual([1, 2, 3]);
  });

  it('is exactly the referenced slide in the room\'s source pane', () => {
    expect(visiblePages(38, { from: 31, to: 31 })).toEqual([31]);
    expect(visiblePages(38, { from: 30, to: 32 })).toEqual([30, 31, 32]);
  });

  it('clamps a range that outlived a re-scan rather than showing an empty pane', () => {
    expect(visiblePages(4, { from: 9, to: 12 })).toEqual([4]);
    expect(visiblePages(4, { from: 0, to: 99 })).toEqual([1, 2, 3, 4]);
    expect(visiblePages(4, { from: 3, to: 1 })).toEqual([3]);
  });

  it('is empty before the document has loaded', () => {
    expect(visiblePages(0, { from: 1, to: 1 })).toEqual([]);
  });
});
