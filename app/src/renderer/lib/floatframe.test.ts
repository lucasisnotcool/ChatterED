import { describe, expect, it } from 'vitest';
import { EDGES, clampFrame, edgeCursor, maxSize, moveFrame, resizeFrame, type Area, type ClampOptions, type Frame } from './floatframe.js';

/** A 1200 × 800 app with a 38 px title bar. */
const AREA: Area = { left: 0, top: 38, right: 1200, bottom: 800 };
const MIN = { width: 320, height: 240 };
const OPTS: ClampOptions = { min: MIN, keep: 64, bar: 36, margin: 8 };
const START: Frame = { left: 300, top: 200, width: 500, height: 400 };

describe('the eight handles', () => {
  it('has one per compass point, each with its cursor', () => {
    expect([...EDGES].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(edgeCursor('n')).toBe('ns-resize');
    expect(edgeCursor('s')).toBe('ns-resize');
    expect(edgeCursor('e')).toBe('ew-resize');
    expect(edgeCursor('w')).toBe('ew-resize');
    expect(edgeCursor('nw')).toBe('nwse-resize');
    expect(edgeCursor('se')).toBe('nwse-resize');
    expect(edgeCursor('ne')).toBe('nesw-resize');
    expect(edgeCursor('sw')).toBe('nesw-resize');
  });
});

describe('clampFrame: never under the title bar', () => {
  it('keeps a window dragged up against the title bar just below it', () => {
    expect(clampFrame({ ...START, top: 0 }, AREA, OPTS).top).toBe(38);
    expect(clampFrame({ ...START, top: -500 }, AREA, OPTS).top).toBe(38);
    expect(clampFrame({ ...START, top: 39 }, AREA, OPTS).top).toBe(39);
  });

  it('restores a frame remembered under the title bar below it, at its size', () => {
    const f = clampFrame({ left: 200, top: 5, width: 500, height: 400 }, AREA, OPTS);
    expect(f).toEqual({ left: 200, top: 38, width: 500, height: 400 });
  });

  it('keeps the header inside the app at the bottom', () => {
    expect(clampFrame({ ...START, top: 2000 }, AREA, OPTS).top).toBe(800 - 36);
  });

  it('caps the size at the area below the title bar less the margins', () => {
    const f = clampFrame({ left: 0, top: 0, width: 5000, height: 5000 }, AREA, OPTS);
    expect(f.width).toBe(1200 - 16);
    expect(f.height).toBe(800 - 38 - 16);
    expect(maxSize(AREA, MIN, 8)).toEqual({ width: 1184, height: 746 });
  });

  it('never below the minimum, even in a tiny app', () => {
    const tiny: Area = { left: 0, top: 38, right: 200, bottom: 150 };
    const f = clampFrame(START, tiny, OPTS);
    expect(f.width).toBe(MIN.width);
    expect(f.height).toBe(MIN.height);
    expect(f.top).toBe(150 - 36);
    expect(clampFrame({ ...START, top: 0 }, tiny, OPTS).top).toBe(38);
  });

  it('lets a window hang off the side, keeping `keep` px to grab', () => {
    expect(clampFrame({ ...START, left: -2000 }, AREA, OPTS).left).toBe(64 - 500);
    expect(clampFrame({ ...START, left: 5000 }, AREA, OPTS).left).toBe(1200 - 64);
  });

  it('re-clamps when the app shrinks', () => {
    const small: Area = { left: 0, top: 38, right: 700, bottom: 500 };
    const f = clampFrame({ left: 600, top: 450, width: 900, height: 700 }, small, OPTS);
    expect(f.width).toBe(684);
    expect(f.height).toBe(500 - 38 - 16);
    expect(f.top).toBeLessThanOrEqual(500 - 36);
    expect(f.left).toBeLessThanOrEqual(700 - 64);
  });
});

describe('moveFrame', () => {
  it('moves by the pointer, size kept', () => {
    expect(moveFrame(START, 40, -30, AREA, OPTS)).toEqual({ left: 340, top: 170, width: 500, height: 400 });
  });

  it('stops at the title bar going up', () => {
    expect(moveFrame(START, 0, -400, AREA, OPTS)).toEqual({ ...START, top: 38 });
  });
});

describe('resizeFrame: from any edge or corner', () => {
  const r = (edge: Parameters<typeof resizeFrame>[1], dx: number, dy: number): Frame => resizeFrame(START, edge, dx, dy, AREA, MIN, 8);

  it('an edge moves one axis, the opposite edge stays put', () => {
    expect(r('e', 50, 99)).toEqual({ left: 300, top: 200, width: 550, height: 400 });
    expect(r('w', -50, 99)).toEqual({ left: 250, top: 200, width: 550, height: 400 });
    expect(r('s', 99, 60)).toEqual({ left: 300, top: 200, width: 500, height: 460 });
    expect(r('n', 99, -60)).toEqual({ left: 300, top: 140, width: 500, height: 460 });
  });

  it('a corner moves both, the opposite corner stays put', () => {
    expect(r('se', 20, 30)).toEqual({ left: 300, top: 200, width: 520, height: 430 });
    expect(r('nw', -20, -30)).toEqual({ left: 280, top: 170, width: 520, height: 430 });
    expect(r('ne', 20, -30)).toEqual({ left: 300, top: 170, width: 520, height: 430 });
    expect(r('sw', -20, 30)).toEqual({ left: 280, top: 200, width: 520, height: 430 });
  });

  it('stops at the minimum rather than flipping, the fixed edge unmoved', () => {
    expect(r('e', -1000, 0)).toEqual({ left: 300, top: 200, width: 320, height: 400 });
    expect(r('w', 1000, 0)).toEqual({ left: 300 + 500 - 320, top: 200, width: 320, height: 400 });
    expect(r('n', 0, 1000)).toEqual({ left: 300, top: 200 + 400 - 240, width: 500, height: 240 });
    expect(r('s', 0, -1000)).toEqual({ left: 300, top: 200, width: 500, height: 240 });
  });

  it('the top edge stops at the title bar, the bottom one stays put', () => {
    const f = r('n', 0, -1000);
    expect(f.top).toBe(38);
    expect(f.top + f.height).toBe(600);
    const g = r('ne', 0, -1000);
    expect(g.top).toBe(38);
  });

  it('the other edges stop at the app less the margin', () => {
    expect(r('e', 5000, 0).left + r('e', 5000, 0).width).toBe(1192);
    expect(r('w', -5000, 0).left).toBe(8);
    expect(r('s', 0, 5000).top + r('s', 0, 5000).height).toBe(792);
  });

  it('a window already hanging off the side does not jump in, nor go further out', () => {
    const off: Frame = { left: -200, top: 100, width: 500, height: 400 };
    expect(resizeFrame(off, 'w', -100, 0, AREA, MIN).left).toBe(-200);
    expect(resizeFrame(off, 'w', 50, 0, AREA, MIN)).toEqual({ left: -150, top: 100, width: 450, height: 400 });
    expect(resizeFrame(off, 'e', 30, 0, AREA, MIN)).toEqual({ left: -200, top: 100, width: 530, height: 400 });
  });

  it('never grows past the largest size clampFrame allows', () => {
    const big: Frame = { left: 8, top: 40, width: 1100, height: 700 };
    const f = resizeFrame(big, 'se', 5000, 5000, AREA, MIN);
    expect(f.width).toBeLessThanOrEqual(maxSize(AREA, MIN).width);
    expect(f.height).toBeLessThanOrEqual(maxSize(AREA, MIN).height);
    expect(clampFrame(f, AREA, OPTS)).toEqual(f);
  });

  it('a zero move is the same frame', () => {
    for (const edge of EDGES) expect(r(edge, 0, 0)).toEqual(START);
  });
});
