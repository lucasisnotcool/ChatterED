import { describe, expect, it } from 'vitest';
import {
  CHAT,
  COLLAPSE_SLACK,
  FILES,
  NOTES_ZOOM,
  SLIDE_ZOOM,
  GUTTER_FLOOR,
  GUTTER_FULL,
  blockAnchorDelta,
  canScrollSideways,
  dragSize,
  isSideways,
  keySize,
  percent,
  readZoom,
  sheetGutter,
  stepTab,
  zoomIn,
  zoomOut,
} from './layout.js';

describe('dragging a panel edge', () => {
  it('grows a left-hand panel as the pointer moves right, and a right-hand one as it moves left', () => {
    expect(dragSize(244, 300, 340, 1, FILES).size).toBe(284);
    expect(dragSize(396, 900, 860, -1, CHAT).size).toBe(436);
  });

  it('holds the panel between its bounds', () => {
    expect(dragSize(244, 300, 1000, 1, FILES).size).toBe(FILES.max);
    expect(dragSize(396, 900, 1400, -1, CHAT).size).toBe(CHAT.min);
  });

  it('closes a closable panel only once it is dragged well past its minimum', () => {
    // Just past the minimum is a learner squeezing it, not closing it.
    const squeeze = dragSize(FILES.min, 300, 300 - COLLAPSE_SLACK + 4, 1, FILES, true);
    expect(squeeze).toEqual({ size: FILES.min, collapse: false });
    const close = dragSize(FILES.min, 300, 300 - COLLAPSE_SLACK - 4, 1, FILES, true);
    expect(close.collapse).toBe(true);
  });

  it('never closes a panel that has no way back', () => {
    expect(dragSize(FILES.min, 300, 0, 1, FILES, false).collapse).toBe(false);
  });
});

describe('the splitter keys', () => {
  it('moves the splitter with the arrows, so → grows the left panel and shrinks the right one', () => {
    expect(keySize(244, 'ArrowRight', false, 1, FILES)).toBe(260);
    expect(keySize(396, 'ArrowRight', false, -1, CHAT)).toBe(380);
    expect(keySize(396, 'ArrowLeft', true, -1, CHAT)).toBe(444);
  });

  it('goes to the ends with Home and End, and stops there', () => {
    expect(keySize(300, 'Home', false, 1, FILES)).toBe(FILES.min);
    expect(keySize(300, 'End', false, 1, FILES)).toBe(FILES.max);
    expect(keySize(FILES.max, 'ArrowRight', true, 1, FILES)).toBe(FILES.max);
  });

  it('leaves every other key alone', () => {
    expect(keySize(300, 'a', false, 1, FILES)).toBeNull();
    expect(keySize(300, 'ArrowUp', false, 1, FILES)).toBeNull();
  });
});

describe('the zoom ladders', () => {
  it('steps up and down the notes ladder, and stops at its ends', () => {
    expect(zoomIn(1, NOTES_ZOOM)).toBe(1.1);
    expect(zoomOut(1, NOTES_ZOOM)).toBe(0.9);
    expect(zoomIn(NOTES_ZOOM.max, NOTES_ZOOM)).toBe(NOTES_ZOOM.max);
    expect(zoomOut(NOTES_ZOOM.min, NOTES_ZOOM)).toBe(NOTES_ZOOM.min);
  });

  it('steps from wherever a pinch left it, to the next rung rather than a rung further', () => {
    expect(zoomIn(1.37, NOTES_ZOOM)).toBe(1.5);
    expect(zoomOut(1.37, NOTES_ZOOM)).toBe(1.25);
    expect(zoomIn(1.02, SLIDE_ZOOM)).toBe(1.35);
  });

  it('reads a stored zoom defensively', () => {
    expect(readZoom('1.25', NOTES_ZOOM)).toBe(1.25);
    expect(readZoom(null, NOTES_ZOOM)).toBe(1);
    expect(readZoom('', NOTES_ZOOM)).toBe(1);
    expect(readZoom('huge', NOTES_ZOOM)).toBe(1);
    expect(readZoom('-2', NOTES_ZOOM)).toBe(1);
    expect(readZoom('9', NOTES_ZOOM)).toBe(NOTES_ZOOM.max);
  });

  it('says the zoom as a whole percent', () => {
    expect(percent(1)).toBe('100%');
    expect(percent(1.347)).toBe('135%');
  });
});

describe('the notes gutters', () => {
  it('are full width at 100 % in a pane with room for them', () => {
    expect(sheetGutter(1100, 1)).toBe(GUTTER_FULL);
  });

  it('give way to the text when the notes are zoomed in a narrow pane', () => {
    // 850 px at 200 % is 425 units: the text would have 161 of them behind full gutters.
    expect(sheetGutter(850, 2)).toBe(GUTTER_FLOOR);
    const g = sheetGutter(1000, 1.25);
    expect(g).toBeGreaterThan(GUTTER_FLOOR);
    expect(g).toBeLessThan(GUTTER_FULL);
    expect(1000 / 1.25 - 2 * g).toBeCloseTo(560, 0);
  });

  it('never shrink below what the gutters hold: Remove · Keep on the left, the action toolbar on the right', () => {
    // Measured live on 1 Oct 2026: Remove · Keep is about 76 px of a gutter's width less 22,
    // and the stacked toolbar about 78 px plus its 12 px margin. At 72 the first read "emove".
    expect(GUTTER_FLOOR - 22).toBeGreaterThanOrEqual(76);
    expect(GUTTER_FLOOR).toBeGreaterThanOrEqual(78 + 12);
  });

  it('never go below the width a page chip needs, nor above their design width', () => {
    expect(sheetGutter(300, 2)).toBe(GUTTER_FLOOR);
    expect(sheetGutter(4000, 0.75)).toBe(GUTTER_FULL);
    expect(sheetGutter(0, 1)).toBe(GUTTER_FULL);
  });
});

describe('keeping the paragraph under the pointer while the notes reflow', () => {
  it('scrolls by however far the same point of the block has moved', () => {
    // The pointer is a quarter of the way down a 100 px block at 200. At 150 % the block is
    // 150 px tall and starts at 260; a quarter of the way down it is now 297.5.
    expect(blockAnchorDelta({ top: 175, height: 100 }, { top: 260, height: 150 }, 200)).toBe(97.5);
  });

  it('is zero when nothing moved', () => {
    expect(blockAnchorDelta({ top: 10, height: 40 }, { top: 10, height: 40 }, 30)).toBe(0);
  });

  it('pins to the block’s top when the point is above it', () => {
    expect(blockAnchorDelta({ top: 100, height: 40 }, { top: 130, height: 60 }, 80)).toBe(50);
  });
});

describe('telling a swipe from a scroll', () => {
  it('wants a clearly sideways gesture', () => {
    expect(isSideways(40, 5)).toBe(true);
    expect(isSideways(40, 30)).toBe(false);
    expect(isSideways(0, 0)).toBe(false);
  });

  /** Just enough of an element for the walk. */
  function box(
    over: Partial<{ scrollWidth: number; clientWidth: number; scrollLeft: number; overflowX: string }>,
    parent: Element | null = null,
  ): Element {
    return {
      scrollWidth: 100,
      clientWidth: 100,
      scrollLeft: 0,
      overflowX: 'visible',
      parentElement: parent,
      ...over,
    } as unknown as Element;
  }
  const style = (el: Element) => ({ overflowX: (el as unknown as { overflowX: string }).overflowX });

  it('gives way to a wide code block that can still pan in that direction', () => {
    const column = box({});
    const code = box({ scrollWidth: 400, clientWidth: 200, scrollLeft: 0, overflowX: 'auto' }, column);
    expect(canScrollSideways(code, column, 30, style)).toBe(true);
    // At its left edge it cannot pan further left, so a swipe that way is a swipe.
    expect(canScrollSideways(code, column, -30, style)).toBe(false);
  });

  it('ignores content that overflows but is clipped rather than scrollable', () => {
    const column = box({});
    const clipped = box({ scrollWidth: 400, clientWidth: 200, overflowX: 'hidden' }, column);
    expect(canScrollSideways(clipped, column, 30, style)).toBe(false);
  });

  it('stops at the swipe surface and does not look above it', () => {
    const page = box({ scrollWidth: 4000, clientWidth: 1000, overflowX: 'auto' });
    const column = box({}, page);
    expect(canScrollSideways(column, column, 30, style)).toBe(false);
  });
});

describe('swiping along the tab strip', () => {
  const tabs = ['doc', 'ellie', 'max'] as const;
  it('moves one tab per swipe and stops at the ends', () => {
    expect(stepTab(tabs, 'doc', 1)).toBe('ellie');
    expect(stepTab(tabs, 'ellie', -1)).toBe('doc');
    expect(stepTab(tabs, 'max', 1)).toBe('max');
    expect(stepTab(tabs, 'doc', -1)).toBe('doc');
  });
});
