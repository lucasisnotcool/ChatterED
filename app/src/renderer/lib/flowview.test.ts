import { describe, expect, it } from 'vitest';
import {
  CARD_GAP,
  CONTENT_WIDTH,
  DEFAULT_ZOOM,
  MAX_BACKING_RATIO,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_GUTTER,
  ZOOM_STEPS,
  backingRatio,
  clampZoom,
  fitWidthZoom,
  nextZoom,
  pinchZoom,
  prevZoom,
  readZoom,
  toggleZoom,
  zoomAnchorScroll,
  zoomChipLabel,
  zoomedWidth,
  PAGE_CACHE,
  PLACEHOLDER,
  PageLru,
  SPLIT_ADDED_HEIGHT,
  buildChipLabel,
  cardSize,
  colourFromPixel,
  compareCaption,
  drawPlan,
  flowCards,
  indexOfSegment,
  invert,
  isWholePage,
  mergeSeam,
  minWidthFraction,
  newSegmentIds,
  normFromOffset,
  offsetFromNorm,
  pageRenderScale,
  scrollAfterMerge,
  scrollAfterSplit,
  snapPreview,
  sourceRect,
  tickPositions,
  type FlowOp,
} from './flowview.js';
import { PAGE_BOX, type CutCandidate, type SegmentView } from '../../shared/segment/index.js';

/**
 * Every number here is the fixture deck's, measured and pinned in `app/docs/SEGMENTS.md` §7:
 * `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`, 7 pages at
 * **959.76 × 540 pt**, page 1's four accepted cuts at y 0.510 / 0.634 / 0.747 / 0.833, and
 * page 6's vertical gutter at x 0.482. A test that passed against invented numbers would not
 * catch the bug the plan's §4.1 warns about (a card laid out against page 1's size, or a DPR
 * leaking into a segment rectangle).
 */
const SLIDE = { width: 959.76, height: 540 };

function candidate(partial: Partial<CutCandidate> & { at: number }): CutCandidate {
  return {
    page: 1,
    axis: 'horizontal',
    gapPt: 20,
    blockedBy: null,
    ...partial,
  };
}

function segment(partial: Partial<SegmentView> = {}): SegmentView {
  return {
    id: 's1',
    order: 0,
    page: 1,
    ...PAGE_BOX,
    label: '/btw',
    source: 'geometry',
    buildSteps: [],
    candidates: [],
    ...partial,
  };
}

describe('cardSize', () => {
  it('lays a whole 16:9 page out at the content width with the page’s own aspect ratio', () => {
    const { w, h } = cardSize(PAGE_BOX, SLIDE);
    expect(w).toBe(CONTENT_WIDTH);
    // 760 × 540 / 959.76 = 427.6
    expect(h).toBe(428);
  });

  it('uses the page’s own size, not a governing one: a portrait cover is not laid out as 16:9', () => {
    const cover = { width: 612, height: 792 };
    expect(cardSize(PAGE_BOX, cover).h).toBe(984);
    expect(cardSize(PAGE_BOX, SLIDE).h).toBe(428);
  });

  it('keeps a crop’s aspect ratio in points, so a half-by-half crop is still 16:9', () => {
    const half = { x0: 0, y0: 0, x1: 0.5, y1: 0.5 };
    expect(cardSize(half, SLIDE)).toEqual(cardSize(PAGE_BOX, SLIDE));
  });

  it('gives page 1’s top segment, cut at y 0.510, its share of the height', () => {
    const top = { x0: 0, y0: 0, x1: 1, y1: 0.51 };
    // 760 × (0.51 × 540) / 959.76 = 218.1
    expect(cardSize(top, SLIDE).h).toBe(218);
  });
});

describe('sourceRect', () => {
  it('multiplies straight into the canvas with no flip — y stays down', () => {
    const canvas = { width: 1600, height: 900 };
    expect(sourceRect({ x0: 0, y0: 0.51, x1: 1, y1: 1 }, canvas)).toEqual({
      sx: 0,
      sy: 459,
      sw: 1600,
      sh: 441,
    });
  });

  it('never overhangs the canvas, so a crop cannot draw a transparent hairline', () => {
    const canvas = { width: 100, height: 100 };
    const r = sourceRect({ x0: 0.999, y0: 0.999, x1: 1.4, y1: 1.4 }, canvas);
    expect(r.sx + r.sw).toBeLessThanOrEqual(canvas.width);
    expect(r.sy + r.sh).toBeLessThanOrEqual(canvas.height);
    expect(r.sw).toBeGreaterThan(0);
  });
});

describe('drawPlan', () => {
  it('keeps devicePixelRatio out of the segment rectangle and inside the backing store', () => {
    const canvas = { width: 3150, height: 1772 };
    const one = drawPlan(PAGE_BOX, SLIDE, canvas, CONTENT_WIDTH, 1);
    const two = drawPlan(PAGE_BOX, SLIDE, canvas, CONTENT_WIDTH, 2);
    expect(two.css).toEqual(one.css);
    expect(two.src).toEqual(one.src);
    expect(two.backing).toEqual({ w: one.css.w * 2, h: one.css.h * 2 });
  });

  it('derives the drawn box and the backing store from the same rounded integer', () => {
    const plan = drawPlan({ x0: 0, y0: 0.51, x1: 1, y1: 0.634 }, SLIDE, { width: 3150, height: 1772 }, CONTENT_WIDTH, 2);
    expect(plan.backing.w).toBe(plan.css.w * 2);
    expect(plan.backing.h).toBe(plan.css.h * 2);
  });
});

describe('pageRenderScale', () => {
  it('rasterises a whole-page deck at 1:1 for the content width', () => {
    expect(pageRenderScale(SLIDE, 1, CONTENT_WIDTH, 1)).toBeCloseTo(0.792, 3);
  });

  it('rasterises harder when page 6’s vertical cut at x 0.482 leaves a half-width crop', () => {
    const narrow = pageRenderScale(SLIDE, 0.482, CONTENT_WIDTH, 1);
    expect(narrow).toBeCloseTo(0.792 / 0.482, 2);
    // At that scale the narrow crop is still 1:1 on screen.
    expect(0.482 * SLIDE.width * narrow).toBeCloseTo(CONTENT_WIDTH, 0);
  });

  it('is capped, so a pathological sliver cannot ask for a 400 MB canvas', () => {
    expect(pageRenderScale(SLIDE, 0.001, CONTENT_WIDTH, 2)).toBe(4);
  });
});

describe('minWidthFraction', () => {
  it('is 1 for an untouched deck and the gutter fraction once a vertical cut lands', () => {
    expect(minWidthFraction([PAGE_BOX])).toBe(1);
    expect(
      minWidthFraction([
        { x0: 0, y0: 0, x1: 0.482, y1: 1 },
        { x0: 0.482, y0: 0, x1: 1, y1: 1 },
      ]),
    ).toBeCloseTo(0.482, 6);
  });
});

describe('tickPositions', () => {
  const page1 = segment({
    candidates: [0.51, 0.634, 0.747, 0.833].map((at) => candidate({ at })),
  });

  it('draws page 1’s four accepted cuts, in gutter order', () => {
    const ticks = tickPositions(page1, SLIDE);
    expect(ticks).toHaveLength(4);
    expect(ticks.map((t) => t.at)).toEqual([0.51, 0.634, 0.747, 0.833]);
    // 0.51 of a 428 px card.
    expect(ticks[0]!.offset).toBe(218);
    expect(ticks.map((t) => t.offset)).toEqual([...ticks.map((t) => t.offset)].sort((a, b) => a - b));
  });

  it('never draws a blocked candidate — page 4 has 13 of them and no ticks', () => {
    const page4 = segment({
      page: 4,
      candidates: [
        candidate({ at: 0.3, page: 4, blockedBy: 'figure' }),
        candidate({ at: 0.62, page: 4, blockedBy: 'gap-too-small' }),
      ],
    });
    expect(tickPositions(page4, SLIDE)).toEqual([]);
  });

  it('drops a candidate on the segment’s own edge, which a split would refuse as degenerate', () => {
    const cut = segment({ y0: 0.51, y1: 1, candidates: [candidate({ at: 0.51 }), candidate({ at: 0.634 })] });
    expect(tickPositions(cut, SLIDE).map((t) => t.at)).toEqual([0.634]);
  });

  it('positions a tick relative to its own card, not to the page', () => {
    const lower = segment({ y0: 0.51, y1: 1, candidates: [candidate({ at: 0.747 })] });
    const { h } = cardSize(lower, SLIDE);
    expect(tickPositions(lower, SLIDE)[0]!.offset).toBe(Math.round(((0.747 - 0.51) / 0.49) * h));
  });

  it('places a vertical tick along the card’s width', () => {
    const page6 = segment({ page: 6, candidates: [candidate({ page: 6, axis: 'vertical', at: 0.482 })] });
    const tick = tickPositions(page6, SLIDE)[0]!;
    expect(tick.axis).toBe('vertical');
    expect(tick.offset).toBe(Math.round(0.482 * CONTENT_WIDTH));
  });

  it('draws nothing at all when SPLIT_ENABLED is off — the F1 fallback', () => {
    expect(tickPositions(page1, SLIDE, CONTENT_WIDTH, false)).toEqual([]);
  });
});

describe('offsetFromNorm / normFromOffset', () => {
  it('round-trip', () => {
    const { h } = cardSize({ x0: 0, y0: 0.51, x1: 1, y1: 1 }, SLIDE);
    const at = 0.747;
    expect(normFromOffset(offsetFromNorm(at, h, 0.51, 1), h, 0.51, 1)).toBeCloseTo(at, 5);
  });

  it('clamps a drag past the card’s edge to the card', () => {
    expect(normFromOffset(-40, 428, 0, 1)).toBe(0);
    expect(normFromOffset(999, 428, 0, 1)).toBe(1);
  });
});

describe('snapPreview', () => {
  const candidates = [0.51, 0.634].map((at) => candidate({ at }));

  it('snaps a free drag to page 1’s tick within 8 pt, so the guide is where the cut lands', () => {
    // 8 pt of 540 is 0.0148 normalised.
    const out = snapPreview(0.5, 'horizontal', candidates, SLIDE);
    expect(out.at).toBe(0.51);
    expect(out.snappedTo?.at).toBe(0.51);
  });

  it('leaves a drag beyond the snap radius alone', () => {
    const out = snapPreview(0.57, 'horizontal', candidates, SLIDE);
    expect(out.at).toBe(0.57);
    expect(out.snappedTo).toBeNull();
  });

  it('releases the snap when the modifier is held', () => {
    const out = snapPreview(0.5, 'horizontal', candidates, SLIDE, { free: true });
    expect(out.at).toBe(0.5);
    expect(out.snappedTo).toBeNull();
  });

  it('measures the radius against the page’s own axis — a vertical cut snaps in width', () => {
    const vertical = [candidate({ axis: 'vertical', at: 0.482 })];
    // 8 pt of 959.76 is 0.0083 normalised: 0.487 snaps, 0.5 does not.
    expect(snapPreview(0.487, 'vertical', vertical, SLIDE).at).toBe(0.482);
    expect(snapPreview(0.5, 'vertical', vertical, SLIDE).at).toBe(0.5);
  });
});

describe('scrollAfterSplit', () => {
  it('follows the content when the cut is above the fold', () => {
    expect(scrollAfterSplit(1200, 900)).toBe(1200 + SPLIT_ADDED_HEIGHT);
  });

  it('does not move the scroller when the cut is the card you are looking at', () => {
    expect(scrollAfterSplit(1200, 1400)).toBe(1200);
    expect(scrollAfterSplit(0, 0)).toBe(0);
  });

  it('merge is its inverse', () => {
    const after = scrollAfterSplit(1200, 900);
    expect(scrollAfterMerge(after, 900)).toBe(1200);
  });

  it('a card’s worth of chrome is a label strip, an ask line and a gap', () => {
    expect(SPLIT_ADDED_HEIGHT).toBe(28 + 26 + CARD_GAP);
  });
});

describe('PageLru', () => {
  it('evicts the least recently used page and disposes it', () => {
    const gone: number[] = [];
    const lru = new PageLru<string>(2, (page) => gone.push(page));
    lru.set(1, 'a');
    lru.set(2, 'b');
    lru.set(3, 'c');
    expect(lru.pages()).toEqual([2, 3]);
    expect(gone).toEqual([1]);
  });

  it('reading a page makes it recent', () => {
    const lru = new PageLru<string>(2);
    lru.set(1, 'a');
    lru.set(2, 'b');
    lru.get(1);
    lru.set(3, 'c');
    expect(lru.pages()).toEqual([1, 3]);
  });

  it('never evicts a pinned page — risk 3: a card on screen must never go blank', () => {
    const lru = new PageLru<string>(2);
    lru.set(1, 'a');
    lru.set(2, 'b');
    lru.pin([1]);
    lru.set(3, 'c');
    lru.set(4, 'd');
    expect(lru.has(1)).toBe(true);
    expect(lru.pages()).toContain(4);
  });

  it('holds the whole fixture deck without evicting anything', () => {
    const lru = new PageLru<string>(PAGE_CACHE);
    for (let page = 1; page <= 7; page += 1) lru.set(page, `p${page}`);
    expect(lru.size).toBe(7);
  });

  it('disposes a replaced canvas, so a re-render does not leak the old backing store', () => {
    const gone: string[] = [];
    const lru = new PageLru<string>(4, (_, value) => gone.push(value));
    lru.set(1, 'old');
    lru.set(1, 'new');
    expect(gone).toEqual(['old']);
    expect(lru.get(1)).toBe('new');
  });
});

describe('colourFromPixel', () => {
  it('reads the page’s own background', () => {
    expect(colourFromPixel([255, 255, 255, 255])).toBe('rgb(255, 255, 255)');
    expect(colourFromPixel([16, 18, 24, 255])).toBe('rgb(16, 18, 24)');
  });

  it('falls back to paper grey — never white — when the page painted no background', () => {
    expect(colourFromPixel([0, 0, 0, 0])).toBe(PLACEHOLDER);
    expect(PLACEHOLDER).not.toBe('#fff');
  });
});

describe('flowCards', () => {
  const segments: SegmentView[] = [
    segment({ id: 'a', order: 0, page: 1, y1: 0.51 }),
    segment({ id: 'b', order: 1, page: 1, y0: 0.51, label: 'the whisper' }),
    segment({ id: 'c', order: 2, page: 2, label: 'Use /btw' }),
  ];

  it('is segment order, with each card’s own rectangle', () => {
    const cards = flowCards(segments, 'segments');
    expect(cards.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(cards[1]!.rect).toEqual({ x0: 0, y0: 0.51, x1: 1, y1: 1 });
    expect(cards[0]!.whole).toBe(false);
  });

  it('Original pages is one card per page, in page order, at the full page box', () => {
    const cards = flowCards(segments, 'pages');
    expect(cards.map((c) => c.page)).toEqual([1, 2]);
    expect(cards.every((c) => c.whole)).toBe(true);
    expect(cards[0]!.rect).toEqual(PAGE_BOX);
  });

  it('keeps the segment ids, so the toggle is a rectangle change and not a re-mount', () => {
    const cards = flowCards(segments, 'pages');
    expect(cards.map((c) => c.key)).toEqual(['a', 'c']);
  });

  it('offers no ticks over an original page: nothing is being proposed there', () => {
    const withTicks = [segment({ id: 'a', candidates: [candidate({ at: 0.51 })] })];
    expect(flowCards(withTicks, 'segments')[0]!.candidates).toHaveLength(1);
    expect(flowCards(withTicks, 'pages')[0]!.candidates).toHaveLength(0);
  });

  it('respects `order` rather than array position — that is what reorder changes', () => {
    const shuffled = [segment({ id: 'x', order: 2 }), segment({ id: 'y', order: 0 }), segment({ id: 'z', order: 1 })];
    expect(flowCards(shuffled).map((c) => c.key)).toEqual(['y', 'z', 'x']);
  });
});

describe('isWholePage', () => {
  it('is true for the page box and false for any crop of it', () => {
    expect(isWholePage(PAGE_BOX)).toBe(true);
    expect(isWholePage({ x0: 0, y0: 0, x1: 1, y1: 0.999 })).toBe(false);
  });
});

describe('mergeSeam', () => {
  const upper = { page: 1, x0: 0, y0: 0, x1: 1, y1: 0.51 };
  const lower = { page: 1, x0: 0, y0: 0.51, x1: 1, y1: 1 };

  it('finds the horizontal seam a split left behind', () => {
    expect(mergeSeam(upper, lower)).toEqual({ at: 0.51, axis: 'horizontal' });
    expect(mergeSeam(lower, upper)).toEqual({ at: 0.51, axis: 'horizontal' });
  });

  it('finds page 6’s vertical seam', () => {
    const left = { page: 6, x0: 0, y0: 0, x1: 0.482, y1: 1 };
    const right = { page: 6, x0: 0.482, y0: 0, x1: 1, y1: 1 };
    expect(mergeSeam(left, right)).toEqual({ at: 0.482, axis: 'vertical' });
  });

  it('refuses across pages — cross-page merge is A2', () => {
    expect(mergeSeam(upper, { ...lower, page: 2 })).toBeNull();
  });

  it('refuses two rectangles that do not tile their union', () => {
    expect(mergeSeam(upper, { page: 1, x0: 0, y0: 0.7, x1: 1, y1: 1 })).toBeNull();
    expect(mergeSeam(upper, { page: 1, x0: 0.3, y0: 0.51, x1: 1, y1: 1 })).toBeNull();
  });
});

describe('the undo stack', () => {
  it('inverts a split into the merge of exactly the two halves it made', () => {
    const split: FlowOp = { kind: 'split', upperId: 'a', lowerId: 'b', at: 0.51, axis: 'horizontal' };
    expect(invert(split)).toEqual({ kind: 'merge', ids: ['a', 'b'], at: 0.51, axis: 'horizontal' });
  });

  it('inverts a merge into a split at the seam, and the two are inverses of each other', () => {
    const split: FlowOp = { kind: 'split', upperId: 'a', lowerId: 'b', at: 0.51, axis: 'horizontal' };
    expect(invert(invert(split))).toEqual(split);
  });

  it('inverts a reorder and a rename', () => {
    expect(invert({ kind: 'reorder', segmentId: 'a', from: 0, to: 3 })).toEqual({
      kind: 'reorder',
      segmentId: 'a',
      from: 3,
      to: 0,
    });
    expect(invert({ kind: 'rename', segmentId: 'a', from: '/btw', to: 'Whisper' })).toEqual({
      kind: 'rename',
      segmentId: 'a',
      from: 'Whisper',
      to: '/btw',
    });
  });
});

describe('newSegmentIds', () => {
  it('recovers the id a split minted — the upper half keeps its own (SEGMENTS.md §5 rule 4)', () => {
    const before = [{ id: 'a' }, { id: 'c' }];
    const after = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(newSegmentIds(before, after)).toEqual(['b']);
  });

  it('is empty for a reorder, which mints nothing', () => {
    expect(newSegmentIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }])).toEqual([]);
  });
});

describe('indexOfSegment', () => {
  it('reads the order the service assigned, not the array position', () => {
    const segments = [segment({ id: 'x', order: 2 }), segment({ id: 'y', order: 0 })];
    expect(indexOfSegment(segments, 'x')).toBe(2);
    expect(indexOfSegment(segments, 'gone')).toBe(-1);
  });
});

describe('labels', () => {
  it('numbers the build chip and says nothing when there are no build steps', () => {
    expect(buildChipLabel([])).toBeNull();
    expect(buildChipLabel([3])).toBe('⏴ 1 build step');
    expect(buildChipLabel([3, 4, 5])).toBe('⏴ 3 build steps');
  });

  it('says what the compare panel is claiming', () => {
    expect(compareCaption(3)).toBe('Region of page 3 · nothing has been re-typeset');
  });
});

/**
 * The flow's zoom (Lucas: "cannot zoom in on main UI").
 *
 * The numbers that matter are the ones the component cannot check for itself: that 100 % is
 * still exactly today's 760 px, that the ladder has no gap a keystroke can fall through, that
 * the backing store actually grows with the zoom (or "zoom in" is a blurry upscale), and that
 * the cursor anchor is the same arithmetic the page viewer uses.
 */
describe('the flow zoom ladder', () => {
  it('keeps 100 % at exactly the 760 px the flow has always been laid out from', () => {
    expect(DEFAULT_ZOOM).toBe(1);
    expect(zoomedWidth(1)).toBe(CONTENT_WIDTH);
    expect(ZOOM_STEPS).toContain(1);
    expect(MIN_ZOOM).toBe(0.6);
    expect(MAX_ZOOM).toBe(2);
  });

  it('is a sorted ladder from 60 % to 200 % with 100 % on a rung', () => {
    expect([...ZOOM_STEPS]).toEqual([...ZOOM_STEPS].sort((a, b) => a - b));
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(MAX_ZOOM);
  });

  it('steps up and down the rungs and stops at both ends', () => {
    expect(nextZoom(1)).toBe(1.15);
    expect(prevZoom(1)).toBe(0.9);
    expect(nextZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(prevZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it('lands a hand-set zoom on the next rung rather than nudging it by a hair', () => {
    // A pinch leaves 1.07; ⌘+ must go to 1.15, not to 1.0999…
    expect(nextZoom(1.07)).toBe(1.15);
    expect(prevZoom(1.07)).toBe(1);
  });

  it('clamps anything off the ladder, and a nonsense zoom is 100 %', () => {
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
  });

  it('scales the content width, which is the only thing the flow is laid out from', () => {
    expect(zoomedWidth(1.5)).toBe(1140);
    expect(zoomedWidth(0.6)).toBe(456);
    // Past the ladder it is the ladder's end, never the raw multiplier.
    expect(zoomedWidth(4)).toBe(zoomedWidth(MAX_ZOOM));
  });
});

describe('the pinch', () => {
  it('zooms in on a negative delta and out on a positive one, the way macOS sends it', () => {
    expect(pinchZoom(1, -10)).toBeGreaterThan(1);
    expect(pinchZoom(1, 10)).toBeLessThan(1);
  });

  it('never moves more than one step per event, however violent the delta', () => {
    expect(pinchZoom(1, -1000)).toBeCloseTo(1.1, 5);
    expect(pinchZoom(1, 1000)).toBeCloseTo(1 / 1.1, 5);
  });

  it('cannot leave the flow ladder — 600 % is the page viewer, not the flow', () => {
    let z = 1;
    for (let i = 0; i < 60; i += 1) z = pinchZoom(z, -50);
    expect(z).toBe(MAX_ZOOM);
    for (let i = 0; i < 60; i += 1) z = pinchZoom(z, 50);
    expect(z).toBe(MIN_ZOOM);
  });
});

describe('fit width and the double-click', () => {
  it('fits the card to the pane, leaving the tick track room to hang off its edge', () => {
    expect(fitWidthZoom(760 + ZOOM_GUTTER)).toBeCloseTo(1, 5);
    expect(fitWidthZoom(1216)).toBeCloseTo((1216 - ZOOM_GUTTER) / CONTENT_WIDTH, 5);
  });

  it('refuses to leave the ladder for a very wide or a very narrow window', () => {
    expect(fitWidthZoom(4000)).toBe(MAX_ZOOM);
    expect(fitWidthZoom(300)).toBe(MIN_ZOOM);
    expect(fitWidthZoom(0)).toBe(DEFAULT_ZOOM);
  });

  it('toggles 100 % ↔ fit-width, and always changes something', () => {
    expect(toggleZoom(1, 1.4)).toBe(1.4);
    expect(toggleZoom(1.4, 1.4)).toBe(1);
    // Already at 100 % *and* fit is 100 %: the gesture must still be answered, not a no-op loop.
    expect(toggleZoom(1.5, 1)).toBe(1);
  });
});

describe('the backing store and the anchor', () => {
  it('grows the crop bitmap with the zoom, or zooming in is an upscale of what was there', () => {
    expect(backingRatio(2, 1)).toBe(2);
    expect(backingRatio(2, 2)).toBe(4);
    expect(backingRatio(1, 1.5)).toBe(1.5);
  });

  it('caps at 6 — a 3× DPR at 200 %, which is the worst case the flow can ask for', () => {
    expect(backingRatio(3, 2)).toBe(MAX_BACKING_RATIO);
    expect(backingRatio(8, 2)).toBe(MAX_BACKING_RATIO);
    expect(backingRatio(Number.NaN, 2)).toBe(2);
  });

  it('lets a zoomed crop actually reach that backing store — the ceiling used to be 3', () => {
    const plan = drawPlan(PAGE_BOX, SLIDE, { width: 4000, height: 2250 }, CONTENT_WIDTH, 4);
    expect(plan.backing.w).toBe(CONTENT_WIDTH * 4);
    // And the CSS box is untouched by it, which is §4.1's rule: no DPR in a segment rectangle.
    expect(plan.css.w).toBe(CONTENT_WIDTH);
  });

  it('rasterises the page harder at a higher zoom, so the crop has pixels to draw', () => {
    const at100 = pageRenderScale(SLIDE, 1, CONTENT_WIDTH, backingRatio(2, 1));
    const at200 = pageRenderScale(SLIDE, 1, CONTENT_WIDTH, backingRatio(2, 2));
    expect(at200).toBeCloseTo(at100 * 2, 5);
  });

  it('keeps the point under the cursor under the cursor', () => {
    // Doubling the zoom about a point 300 px down a scroller that is 100 px scrolled: the
    // content under the cursor was at 400, is now at 800, so the scroller must be at 500.
    expect(zoomAnchorScroll(100, 300, 1, 2)).toBe(500);
    // Zooming out about the very top of the pane cannot push the scroller negative.
    expect(zoomAnchorScroll(10, 0, 2, 1)).toBe(5);
    expect(zoomAnchorScroll(0, 0, 2, 1)).toBe(0);
    expect(zoomAnchorScroll(100, 300, 0, 2)).toBe(100);
  });
});

describe('the zoom chip and the persisted level', () => {
  it('writes the percentage the way Preview does', () => {
    expect(zoomChipLabel(1)).toBe('100 %');
    expect(zoomChipLabel(1.15)).toBe('115 %');
    expect(zoomChipLabel(0.6)).toBe('60 %');
  });

  it('survives a missing, corrupt or out-of-range stored value', () => {
    expect(readZoom(1.3)).toBe(1.3);
    expect(readZoom('1.3')).toBe(1.3);
    expect(readZoom(null)).toBe(DEFAULT_ZOOM);
    expect(readZoom('nonsense')).toBe(DEFAULT_ZOOM);
    expect(readZoom(-4)).toBe(DEFAULT_ZOOM);
    expect(readZoom(99)).toBe(MAX_ZOOM);
  });
});
