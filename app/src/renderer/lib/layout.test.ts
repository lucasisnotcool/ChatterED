import { describe, expect, it } from 'vitest';
import {
  CHAT,
  COLLAPSE_SLACK,
  COMPACT_BELOW,
  GUTTER_COMPACT,
  NOTES_HEAD_COMPACT_BELOW,
  TUTORIAL_HEAD_COMPACT_BELOW,
  TWO_PANES_WANTED,
  filesChosen,
  filesCrowdTutorial,
  roomForTutorial,
  type FilesRoom,
  headCompact,
  sheetFit,
  tutorialSheetFit,
  FILES,
  HOME_ZOOM,
  NOTES_ZOOM,
  SLIDE_ZOOM,
  GUTTER_FLOOR,
  GUTTER_FULL,
  blockAnchorDelta,
  canScrollSideways,
  dragOvershoots,
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

  it('gives the Notebooks home its own ladder, from 80 % to the large-print 200 %', () => {
    expect(zoomIn(1, HOME_ZOOM)).toBe(1.1);
    expect(zoomOut(1, HOME_ZOOM)).toBe(0.9);
    expect(HOME_ZOOM.min).toBe(0.8);
    expect(HOME_ZOOM.max).toBe(2);
    expect(readZoom('7', HOME_ZOOM)).toBe(2);
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

describe('the compact sheet', () => {
  it('leaves a wide pane exactly as the gutters had it', () => {
    for (const [w, z] of [[1100, 1], [1000, 1.25], [600, 1], [1400, 2]] as const) {
      expect(sheetFit(w, z)).toEqual({ compact: false, gutter: sheetGutter(w, z) });
    }
  });

  it('drops the gutters below COMPACT_BELOW units, so a 340 px pane is not a 132 px column', () => {
    expect(sheetFit(340, 1)).toEqual({ compact: true, gutter: GUTTER_COMPACT });
    expect(sheetFit(COMPACT_BELOW - 1, 1).compact).toBe(true);
    // Zoomed: 1000 px at 200 % is 500 units, a narrow sheet.
    expect(sheetFit(1000, 2).compact).toBe(true);
    // The compact column is always wider than the floor gutters' one at the same width.
    for (let w = 300; w < COMPACT_BELOW; w += 20) {
      expect(w - 2 * GUTTER_COMPACT).toBeGreaterThan(w - 2 * GUTTER_FLOOR);
    }
  });

  it('is not compact before the pane has been measured', () => {
    expect(sheetFit(0, 1).compact).toBe(false);
    expect(tutorialSheetFit(0).compact).toBe(false);
  });

  it("keeps the tutorial's own wide gutters, and compacts at the same width", () => {
    expect(tutorialSheetFit(1000)).toEqual({ compact: false, gutter: GUTTER_FULL });
    expect(tutorialSheetFit(800)).toEqual({ compact: false, gutter: 88 });
    expect(tutorialSheetFit(COMPACT_BELOW)).toEqual({ compact: false, gutter: 88 });
    expect(tutorialSheetFit(360)).toEqual({ compact: true, gutter: GUTTER_COMPACT });
  });

  it('lays the zoomed tutorial out in its unzoomed width, as the notes are', () => {
    expect(tutorialSheetFit(1000, 2)).toEqual({ compact: true, gutter: GUTTER_COMPACT });
    expect(tutorialSheetFit(1000, 1)).toEqual(tutorialSheetFit(1000));
    expect(tutorialSheetFit(500, 0.75).compact).toBe(false);
  });
});

describe('the panes\' headers', () => {
  it('fold below their widths, and never before they are measured', () => {
    expect(headCompact(0, NOTES_HEAD_COMPACT_BELOW)).toBe(false);
    expect(headCompact(340, NOTES_HEAD_COMPACT_BELOW)).toBe(true);
    expect(headCompact(NOTES_HEAD_COMPACT_BELOW, NOTES_HEAD_COMPACT_BELOW)).toBe(false);
    expect(headCompact(400, TUTORIAL_HEAD_COMPACT_BELOW)).toBe(true);
    expect(headCompact(700, TUTORIAL_HEAD_COMPACT_BELOW)).toBe(false);
  });
});

describe('room for a docked tutorial', () => {
  it('folds the sources when the doc column would be under two readable panes', () => {
    // 1440 px window, 48 px rail: 1392 - 280 - 380 leaves 732.
    expect(filesCrowdTutorial(1392, 280, 380)).toBe(true);
    // 1728 px: 1680 - 280 - 380 leaves 1020.
    expect(filesCrowdTutorial(1680, 280, 380)).toBe(false);
    expect(filesCrowdTutorial(280 + 380 + TWO_PANES_WANTED, 280, 380)).toBe(false);
    expect(filesCrowdTutorial(280 + 380 + TWO_PANES_WANTED - 1, 280, 380)).toBe(true);
  });

  it('says nothing before the shell is measured', () => {
    expect(filesCrowdTutorial(0, 280, 380)).toBe(false);
  });
});

describe('folding the sources for a docked tutorial (roomForTutorial)', () => {
  const opened: FilesRoom = { open: true, madeRoom: false, docked: false, chose: false };
  const run = (s: FilesRoom, ...steps: (boolean | null | 'open' | 'close')[]): FilesRoom =>
    steps.reduce<FilesRoom>(
      (at, step) => (step === 'open' ? filesChosen(at, true) : step === 'close' ? filesChosen(at, false) : roomForTutorial(at, step)),
      s,
    );

  it('folds the sources when crowded, and brings them back when the tutorial goes', () => {
    const folded = run(opened, true);
    expect(folded).toMatchObject({ open: false, madeRoom: true });
    expect(run(folded, null)).toMatchObject({ open: true, madeRoom: false });
  });

  it('leaves them alone with room, and brings them back while docked when the window grows', () => {
    expect(run(opened, false, null).open).toBe(true);
    expect(run(opened, true, false)).toMatchObject({ open: true, madeRoom: false });
  });

  it('never opens a panel the learner had closed', () => {
    expect(run({ ...opened, open: false }, true, false, null).open).toBe(false);
  });

  it('respects a learner who reopens the panel while docked, until the tutorial closes', () => {
    const chose = run(opened, true, 'open', true);
    expect(chose.open).toBe(true);
    expect(run(chose, null).open).toBe(true);
    // The next docking starts afresh.
    expect(run(chose, null, true).open).toBe(false);
  });

  it('does not reopen a panel the learner closed after it was folded for them', () => {
    expect(run(opened, true, 'open', 'close', null).open).toBe(false);
  });

  it('remembers no choice made while nothing is docked', () => {
    expect(run(opened, 'open', true).open).toBe(false);
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

describe('dragging past the maximum', () => {
  it('closes the panel on the other side only after the slack', () => {
    const b = { min: 220, max: 600, initial: 400 };
    expect(dragOvershoots(500, 0, 100 + 72, 1, b)).toBe(false);
    expect(dragOvershoots(500, 0, 100 + 73, 1, b)).toBe(true);
    expect(dragOvershoots(500, 0, -200, -1, b)).toBe(true);
  });
});

describe('the tutorial window (floatFrame)', () => {
  it('starts on the right with nothing remembered, inside the app', async () => {
    const { floatFrame } = await import('./layout.js');
    const f = floatFrame(null, { width: 1400, height: 900 });
    expect(f.left + f.width).toBeLessThanOrEqual(1400);
    expect(f.left).toBeGreaterThan(700);
    expect(f.top).toBeGreaterThanOrEqual(0);
  });

  it('keeps a remembered window grabbable and no bigger than the app', async () => {
    const { floatFrame, TUTORIAL_WINDOW_MIN } = await import('./layout.js');
    const f = floatFrame({ left: 3000, top: -50, width: 5000, height: 100 }, { width: 1200, height: 800 });
    expect(f.width).toBeLessThanOrEqual(1200);
    expect(f.height).toBe(TUTORIAL_WINDOW_MIN.height);
    expect(f.left).toBeLessThan(1200);
    expect(f.top).toBe(0);
  });

  it('never under the app title bar: a remembered frame there comes back below it', async () => {
    const { floatFrame } = await import('./layout.js');
    const f = floatFrame({ left: 400, top: 0, width: 500, height: 600 }, { width: 1400, height: 900, top: 38 });
    expect(f).toEqual({ left: 400, top: 38, width: 500, height: 600 });
    const fresh = floatFrame(null, { width: 1400, height: 900, top: 38 });
    expect(fresh.top).toBeGreaterThanOrEqual(38);
    expect(fresh.top + fresh.height).toBeLessThanOrEqual(900);
  });

  it('caps the height at the app below the title bar', async () => {
    const { floatFrame } = await import('./layout.js');
    const f = floatFrame({ left: 100, top: 100, width: 500, height: 5000 }, { width: 1200, height: 800, top: 38 });
    expect(f.height).toBe(800 - 38 - 16);
    expect(f.top).toBe(100);
  });

  it('reads a stored frame defensively', async () => {
    const { readFloatFrame } = await import('./layout.js');
    expect(readFloatFrame(null)).toBeNull();
    expect(readFloatFrame('nope')).toBeNull();
    expect(readFloatFrame('{"left":1,"top":2,"width":"3","height":4}')).toBeNull();
    expect(readFloatFrame('{"left":1,"top":2,"width":3,"height":4}')).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });
});

describe('the tutorial’s Split ratio', () => {
  it('follows the divider, kept inside the bounds and leaving both views usable', async () => {
    const { splitRatioAt, TUTORIAL_SPLIT, SPLIT_VIEW_MIN } = await import('./layout.js');
    expect(splitRatioAt(300, 1000)).toBe(0.3);
    expect(splitRatioAt(10, 1000)).toBe(TUTORIAL_SPLIT.min);
    expect(splitRatioAt(990, 1000)).toBe(TUTORIAL_SPLIT.max);
    // A short window: the 72 px floor is stricter than 15 %.
    expect(splitRatioAt(0, 300) * 300).toBeCloseTo(SPLIT_VIEW_MIN, 0);
    expect(splitRatioAt(0, 0)).toBe(TUTORIAL_SPLIT.initial);
  });

  it('moves by key, and ignores keys that are not its own', async () => {
    const { splitKeyRatio, TUTORIAL_SPLIT } = await import('./layout.js');
    expect(splitKeyRatio(0.4, 'ArrowUp', false)).toBe(0.35);
    expect(splitKeyRatio(0.4, 'ArrowDown', true)).toBe(0.55);
    expect(splitKeyRatio(0.4, 'Home', false)).toBe(TUTORIAL_SPLIT.min);
    expect(splitKeyRatio(0.4, 'End', false)).toBe(TUTORIAL_SPLIT.max);
    expect(splitKeyRatio(0.4, 'a', false)).toBeNull();
  });

  it('reads a stored ratio defensively', async () => {
    const { readSplitRatio, TUTORIAL_SPLIT } = await import('./layout.js');
    expect(readSplitRatio(null)).toBe(TUTORIAL_SPLIT.initial);
    expect(readSplitRatio('nope')).toBe(TUTORIAL_SPLIT.initial);
    expect(readSplitRatio('0.62')).toBe(0.62);
    expect(readSplitRatio('5')).toBe(TUTORIAL_SPLIT.max);
  });
});

describe('the tutorial as the main view (4 Oct 2026): per notebook, remembered, off by default', () => {
  it('is off for a notebook that never turned it on, and needs a tutorial to be on', async () => {
    const { mainTutorialFor } = await import('./layout.js');
    expect(mainTutorialFor({}, 'nb_1', [{ fileId: 'f_t1' }])).toBeNull();
    expect(mainTutorialFor({ nb_1: 'f_t1' }, 'nb_1', [])).toBeNull();
    expect(mainTutorialFor({ nb_1: 'f_t1' }, null, [{ fileId: 'f_t1' }])).toBeNull();
    // Another notebook's choice is not this one's.
    expect(mainTutorialFor({ nb_2: 'f_t1' }, 'nb_1', [{ fileId: 'f_t1' }])).toBeNull();
  });

  it('shows the remembered tutorial, or the first when that one is gone', async () => {
    const { mainTutorialFor } = await import('./layout.js');
    const tutorials = [{ fileId: 'f_t1' }, { fileId: 'f_t2' }];
    expect(mainTutorialFor({ nb_1: 'f_t2' }, 'nb_1', tutorials)).toBe('f_t2');
    expect(mainTutorialFor({ nb_1: 'f_gone' }, 'nb_1', tutorials)).toBe('f_t1');
  });

  it('turns on and off per notebook, leaving the others alone', async () => {
    const { withTutorialMain } = await import('./layout.js');
    const on = withTutorialMain({ nb_2: 'f_x' }, 'nb_1', 'f_t1');
    expect(on).toEqual({ nb_2: 'f_x', nb_1: 'f_t1' });
    expect(withTutorialMain(on, 'nb_1', 'f_t2')).toEqual({ nb_2: 'f_x', nb_1: 'f_t2' });
    expect(withTutorialMain(on, 'nb_1', null)).toEqual({ nb_2: 'f_x' });
    expect(withTutorialMain({}, 'nb_1', null)).toEqual({});
  });

  it('keeps the newest notebooks when there are too many to remember', async () => {
    const { withTutorialMain, TUTORIAL_MAIN_KEEP } = await import('./layout.js');
    let map: Readonly<Record<string, string>> = {};
    for (let i = 0; i < TUTORIAL_MAIN_KEEP + 5; i++) map = withTutorialMain(map, `nb_${i}`, 'f');
    expect(Object.keys(map)).toHaveLength(TUTORIAL_MAIN_KEEP);
    expect(map).not.toHaveProperty('nb_0');
    expect(map).toHaveProperty(`nb_${TUTORIAL_MAIN_KEEP + 4}`, 'f');
  });

  it('opens the notes’ window below the doc header, and where it was left after that', async () => {
    const { notesFloatFrame, NOTES_WINDOW_BELOW } = await import('./layout.js');
    const view = { width: 1500, height: 950, top: 38 };
    const fresh = notesFloatFrame(null, view);
    expect(fresh.top).toBe(38 + NOTES_WINDOW_BELOW);
    expect(fresh.left + fresh.width).toBeLessThanOrEqual(1500);
    expect(fresh.top + fresh.height).toBeLessThanOrEqual(950);
    const moved = { left: 300, top: 200, width: 600, height: 500 };
    expect(notesFloatFrame(moved, view)).toEqual(moved);
  });

  it('round-trips through storage, and reads anything else as nothing remembered', async () => {
    const { readTutorialMain, withTutorialMain } = await import('./layout.js');
    const map = withTutorialMain({}, 'nb_1', 'f_t1');
    expect(readTutorialMain(JSON.stringify(map))).toEqual({ nb_1: 'f_t1' });
    expect(readTutorialMain(null)).toEqual({});
    expect(readTutorialMain('not json')).toEqual({});
    expect(readTutorialMain('[1,2]')).toEqual({});
    expect(readTutorialMain('"nb_1"')).toEqual({});
    expect(readTutorialMain(JSON.stringify({ nb_1: 'f_t1', nb_2: 3, nb_3: '' }))).toEqual({ nb_1: 'f_t1' });
  });
});
