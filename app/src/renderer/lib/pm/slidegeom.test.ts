import {
  CASCADE,
  GAP,
  KEEP_VISIBLE,
  BAR_HEIGHT,
  MARGIN,
  MIN_WIDTH,
  WINDOW_MIN,
  WINDOW_SIZE,
  cascade,
  citedStep,
  clampSize,
  clampWindow,
  dragRect,
  fitSlide,
  intersect,
  placeBeside,
  rectPercent,
  usableCrop,
  windowKey,
  type Box,
} from './slidegeom.js';

/** A box from its left, top, width and height: how the cases below are easiest to read. */
const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/**
 * The layout the popover was designed against: a 1440 × 900 window, the notes scroller from
 * x 300 to 1040 below a 60 px toolbar, the chat column to its right, and a chip 60 × 20 in the
 * notes' right gutter.
 */
const WINDOW = box(0, 0, 1440, 900);
const SCROLLER = box(300, 60, 740, 840);
const chipAt = (top: number, left = 960): Box => box(left, top, 60, 20);

describe('intersect', () => {
  it('is the overlap, and empty when there is none', () => {
    expect(intersect(SCROLLER, WINDOW)).toEqual(SCROLLER);
    expect(intersect(box(0, 0, 100, 100), box(50, 50, 100, 100))).toEqual(box(50, 50, 50, 50));
    const none = intersect(box(0, 0, 10, 10), box(20, 20, 10, 10));
    expect(none.right <= none.left || none.bottom <= none.top).toBe(true);
  });
});

describe('placeBeside: to the left or right of the tag, never over it', () => {
  const pop = { width: WINDOW_SIZE.width, height: 400 };

  it('goes left of a gutter chip, its right edge GAP from the chip, its top at the chip top', () => {
    const at = chipAt(300);
    const p = placeBeside(at, pop, SCROLLER, MARGIN, { horizontal: WINDOW });
    expect(p.side).toBe('left');
    expect(p.width).toBe(WINDOW_SIZE.width);
    expect(p.left + p.width).toBe(at.left - GAP);
    expect(p.top).toBe(300);
  });

  it('never overlaps the anchor while either side has room for the minimum', () => {
    for (const left of [40, 200, 400, 700, 960, 1300]) {
      const at = chipAt(300, left);
      const p = placeBeside(at, pop, SCROLLER, MARGIN, { horizontal: WINDOW });
      const overlaps = p.left < at.right && p.left + p.width > at.left;
      expect(overlaps, `chip at ${String(left)}`).toBe(false);
    }
  });

  it('goes right, over the chat column, when the left has no room (a narrow window)', () => {
    const narrow = box(0, 0, 1100, 800);
    const at = box(400, 300, 60, 20); // a chip near the left: 392 px of room on the left
    const p = placeBeside(at, pop, narrow, MARGIN);
    expect(p.side).toBe('right');
    expect(p.left).toBe(at.right + GAP);
    expect(p.width).toBe(WINDOW_SIZE.width);
  });

  it('honours a preference for the right when the right fits', () => {
    const p = placeBeside(chipAt(300, 400), pop, WINDOW, MARGIN, { prefer: 'right' });
    expect(p.side).toBe('right');
  });

  it('shrinks to the larger side when neither fits at full width, down to the minimum', () => {
    const tight = box(0, 0, 900, 800);
    const at = box(470, 300, 60, 20); // 454 px of room left, 354 right
    const p = placeBeside(at, pop, tight, MARGIN);
    expect(p.side).toBe('left');
    expect(p.width).toBe(at.left - GAP - MARGIN);
    expect(p.width).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(p.left).toBe(MARGIN);
  });

  it('stays on screen, overlapping, when even the minimum fits neither side', () => {
    const tiny = box(0, 0, 500, 800);
    const p = placeBeside(box(220, 300, 60, 20), pop, tiny, MARGIN);
    expect(p.width).toBe(MIN_WIDTH);
    expect(p.left).toBeGreaterThanOrEqual(MARGIN);
    expect(p.left + p.width).toBeLessThanOrEqual(500 - MARGIN);
  });

  it('is stable: placing again at the width it chose gives the same answer', () => {
    const tight = box(0, 0, 900, 800);
    const at = box(470, 300, 60, 20);
    const first = placeBeside(at, pop, tight, MARGIN);
    const again = placeBeside(at, { width: first.width, height: pop.height }, tight, MARGIN);
    expect(again).toEqual(first);
  });

  it('slides along with a chip near the bottom, then rests MARGIN above the edge', () => {
    // Chip top 600: 600 + 400 would run past 900 − 8, so the popover rests at 492.
    expect(placeBeside(chipAt(600), pop, SCROLLER, MARGIN, { horizontal: WINDOW }).top).toBe(900 - MARGIN - 400);
    // Chip top 450: still fits, still aligned.
    expect(placeBeside(chipAt(450), pop, SCROLLER, MARGIN, { horizontal: WINDOW }).top).toBe(450);
  });

  it('never rises above the scroller’s visible top, whatever the chip does', () => {
    expect(placeBeside(chipAt(62), pop, SCROLLER, MARGIN, { horizontal: WINDOW }).top).toBe(60 + MARGIN);
  });

  it('hangs from the top when it is taller than the visible area', () => {
    const p = placeBeside(chipAt(300), { width: 520, height: 2000 }, SCROLLER, MARGIN, { horizontal: WINDOW });
    expect(p.top).toBe(60 + MARGIN);
  });

  it('takes its horizontal room from the window, not the scroller, so it may lie over the chat', () => {
    const at = box(310, 300, 60, 20); // a chip at the scroller's left edge
    const p = placeBeside(at, pop, SCROLLER, MARGIN, { horizontal: WINDOW });
    expect(p.side).toBe('right');
    expect(p.left).toBe(at.right + GAP);
  });
});

describe('dragRect and usableCrop: the crop', () => {
  it('is normalised whichever way the drag went', () => {
    const r = { x0: 0.2, y0: 0.3, x1: 0.6, y1: 0.7 };
    expect(dragRect({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 })).toEqual(r);
    expect(dragRect({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 })).toEqual(r);
    expect(dragRect({ x: 0.6, y: 0.3 }, { x: 0.2, y: 0.7 })).toEqual(r);
  });

  it('clamps an overshoot to the slide edge', () => {
    expect(dragRect({ x: -0.3, y: 0.5 }, { x: 1.4, y: 1.2 })).toEqual({ x0: 0, y0: 0.5, x1: 1, y1: 1 });
  });

  it('is not a crop when it is a click or a sliver', () => {
    expect(usableCrop(dragRect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }))).toBe(false);
    expect(usableCrop({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.11 })).toBe(false);
    expect(usableCrop({ x0: 0.1, y0: 0.1, x1: 0.13, y1: 0.4 })).toBe(true);
    expect(usableCrop(null)).toBe(false);
  });
});

describe('citedStep: the cited slides, distinct from the deck', () => {
  it('walks the block’s own order and wraps', () => {
    expect(citedStep([12, 14, 3], 12, 1)).toBe(14);
    expect(citedStep([12, 14, 3], 3, 1)).toBe(12);
    expect(citedStep([12, 14, 3], 12, -1)).toBe(3);
  });

  it('leads back to the nearest cited slide in that direction after a step off them', () => {
    expect(citedStep([3, 12, 14], 13, 1)).toBe(14);
    expect(citedStep([3, 12, 14], 13, -1)).toBe(12);
    expect(citedStep([3, 12, 14], 20, 1)).toBe(3); // wraps
    expect(citedStep([3, 12, 14], 1, -1)).toBe(14); // wraps
    expect(citedStep([12], 15, -1)).toBe(12);
  });

  it('has nowhere to go with no cited pages', () => {
    expect(citedStep([], 4, 1)).toBeNull();
  });
});

describe('rectPercent', () => {
  it('places a normalised rect as percentages of the slide', () => {
    expect(rectPercent({ x0: 0.1, y0: 0.25, x1: 0.6, y1: 0.75 })).toEqual({
      left: '10%',
      top: '25%',
      width: '50%',
      height: '50%',
    });
  });
});

// ── the windows (3 Oct 2026, second cut) ──────────────────────────────────────────────────────

const app: Box = { left: 0, top: 0, right: 1320, bottom: 860 };

describe('clampSize: between the smallest useful window and the app', () => {
  it('keeps a size inside the bounds', () => {
    expect(clampSize({ width: 520, height: 420 }, app)).toEqual({ width: 520, height: 420 });
    expect(clampSize({ width: 100, height: 50 }, app)).toEqual({ width: WINDOW_MIN.width, height: WINDOW_MIN.height });
    expect(clampSize({ width: 5000, height: 5000 }, app)).toEqual({ width: 1320 - 2 * MARGIN, height: 860 - 2 * MARGIN });
  });
});

describe('clampWindow: anywhere, as long as it can be dragged back', () => {
  const frame = { left: 0, top: 0, width: 520, height: 420 };
  it('leaves a window inside the app where it is', () => {
    expect(clampWindow({ ...frame, left: 300, top: 200 }, app)).toEqual({ left: 300, top: 200 });
  });
  it('lets a window hang off the right or left edge, but keeps a grip of its title bar', () => {
    expect(clampWindow({ ...frame, left: 1300, top: 200 }, app)).toEqual({ left: 1320 - KEEP_VISIBLE, top: 200 });
    expect(clampWindow({ ...frame, left: -900, top: 200 }, app)).toEqual({ left: KEEP_VISIBLE - 520, top: 200 });
  });
  it('never lets the title bar leave the top or the bottom', () => {
    expect(clampWindow({ ...frame, left: 300, top: -50 }, app).top).toBe(0);
    expect(clampWindow({ ...frame, left: 300, top: 2000 }, app).top).toBe(860 - BAR_HEIGHT);
  });
});

describe('cascade: a second window does not hide the first', () => {
  it('moves down and right past every window already at that corner', () => {
    expect(cascade({ left: 100, top: 100 }, [], app)).toEqual({ left: 100, top: 100 });
    expect(cascade({ left: 100, top: 100 }, [{ left: 100, top: 100 }], app)).toEqual({ left: 100 + CASCADE, top: 100 + CASCADE });
    expect(
      cascade({ left: 100, top: 100 }, [{ left: 100, top: 100 }, { left: 100 + CASCADE, top: 100 + CASCADE }], app),
    ).toEqual({ left: 100 + 2 * CASCADE, top: 100 + 2 * CASCADE });
  });
  it('wraps back to the top when it would leave the app', () => {
    const near = { left: 300, top: 860 - BAR_HEIGHT - 10 };
    expect(cascade(near, [near], app).top).toBe(MARGIN);
  });
});

describe('fitSlide: the whole slide, as large as the window allows', () => {
  it('is limited by width in a tall window and by height in a wide one', () => {
    expect(fitSlide({ width: 500, height: 900 }, 9 / 16)).toEqual({ width: 500, height: 281 });
    expect(fitSlide({ width: 1200, height: 300 }, 9 / 16)).toEqual({ width: 533, height: 299 });
  });
  it('draws nothing in a window with no room, or before the slide is measured', () => {
    expect(fitSlide({ width: 0, height: 300 }, 0.75).width).toBe(0);
    expect(fitSlide({ width: 400, height: 300 }, 0)).toEqual({ width: 400, height: 0 });
  });
});

describe('windowKey: the keys a focused slide window takes', () => {
  it('← → step the deck, ↑ ↓ the cited slides, Esc closes', () => {
    expect(windowKey({ key: 'ArrowLeft' })).toBe('deck-prev');
    expect(windowKey({ key: 'ArrowRight' })).toBe('deck-next');
    expect(windowKey({ key: 'ArrowUp' })).toBe('cited-prev');
    expect(windowKey({ key: 'ArrowDown' })).toBe('cited-next');
    expect(windowKey({ key: 'Escape' })).toBe('close');
  });
  it('leaves modified keys and every other key alone', () => {
    expect(windowKey({ key: 'ArrowLeft', metaKey: true })).toBeNull();
    expect(windowKey({ key: 'ArrowRight', altKey: true })).toBeNull();
    expect(windowKey({ key: 'c', metaKey: true })).toBeNull();
    expect(windowKey({ key: 'a' })).toBeNull();
  });
});

describe('a new window beside its chip', () => {
  it('opens to the left of a gutter chip at the default size', () => {
    const chip = { left: 1100, top: 400, right: 1140, bottom: 418 };
    const spot = placeBeside(chip, WINDOW_SIZE, app, MARGIN, { minWidth: MIN_WIDTH });
    expect(spot.side).toBe('left');
    expect(spot.left).toBe(1100 - GAP - WINDOW_SIZE.width);
    expect(spot.top).toBe(400);
  });
});
