/**
 * Stages 0–3 and the segment algebra, on hand-written pages.
 *
 * The three invariants `pdf-fidelity-segmentation.md` §C5 asks for are asserted through
 * `checkPartition` after every operation, in the spirit of the existing whisper-leak canary:
 * a rule that must not drift is checked by a test, not by a convention.
 */
import { describe, expect, it } from 'vitest';
import { page, threeBlockSlide, SLIDE } from '../../test-support/pages.js';
import {
  DEFAULTS,
  acceptedCuts,
  buildGroups,
  candidatesForPage,
  checkPartition,
  containment,
  firstLineIn,
  genreSignals,
  horizontalCandidates,
  markChrome,
  mergeSegments,
  noticeFor,
  reorderSegments,
  routeGenre,
  segmentDocument,
  slideTitle,
  snapTo,
  splitSegment,
  verticalCandidates,
  wholePageSegments,
  type GenreSignals,
} from './index.js';

describe('Stage 0 — build groups', () => {
  it('counts containment with multiplicity', () => {
    expect(containment(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
    expect(containment(['a', 'a'], ['a', 'b'])).toBe(0.5);
    expect(containment([], ['a'])).toBe(1);
  });

  it('collapses a progressive reveal onto its last, complete page', () => {
    const one = page({ page: 1, lines: [{ top: 30, text: 'Kinds of evidence' }] });
    const two = page({
      page: 2,
      lines: [
        { top: 30, text: 'Kinds of evidence' },
        { top: 90, text: 'measured on this machine' },
      ],
    });
    const three = page({
      page: 3,
      lines: [
        { top: 30, text: 'Kinds of evidence' },
        { top: 90, text: 'measured on this machine' },
        { top: 150, text: 'and reproduced' },
      ],
    });
    const { kept, builds } = buildGroups([one, two, three]);
    expect(kept.map((p) => p.page)).toEqual([3]);
    expect(builds).toEqual([{ page: 3, steps: [1, 2] }]);
  });

  it('does not merge a page whose words disappear on the next one', () => {
    const one = page({ page: 1, lines: [{ top: 30, text: 'alpha beta gamma' }] });
    const two = page({ page: 2, lines: [{ top: 30, text: 'delta epsilon zeta' }] });
    const { kept, builds } = buildGroups([one, two]);
    expect(kept.map((p) => p.page)).toEqual([1, 2]);
    expect(builds).toEqual([]);
  });

  it('does not merge across a page-size change', () => {
    const portrait = page({ page: 1, width: 540, height: 960, lines: [{ top: 30, text: 'title' }] });
    const landscape = page({ page: 2, lines: [{ top: 30, text: 'title and more' }] });
    expect(buildGroups([portrait, landscape]).kept).toHaveLength(2);
  });
});

describe('Stage 2 — chrome', () => {
  const footline = { top: 505, x: 40, width: 200, text: 'CS3249 · Lecture 5', fontPt: 9 };
  const deck = [1, 2, 3, 4, 5].map((n) =>
    page({ page: n, lines: [{ top: 30, text: `Slide ${n}` }, footline] }),
  );

  it('marks text repeating verbatim at the same position on 60 % of pages', () => {
    const marked = markChrome(deck);
    for (const p of marked) {
      expect(p.chrome).toEqual([false, true]);
    }
  });

  it('leaves a line that repeats on only two of five pages alone', () => {
    const pages = deck.map((p, i) =>
      i < 2 ? p : page({ page: p.page, lines: [{ top: 30, text: `Slide ${p.page}` }] }),
    );
    const marked = markChrome(pages);
    expect(marked[0]!.chrome).toEqual([false, false]);
  });

  it('never calls anything on a one-page document chrome', () => {
    expect(markChrome([deck[0]!])[0]!.chrome).toEqual([false, false]);
  });
});

describe('Stage 3 — candidate cuts', () => {
  it('finds one candidate per whitespace gap on a three-block slide', () => {
    const cuts = acceptedCuts(candidatesForPage(threeBlockSlide()));
    expect(cuts).toHaveLength(3);
    expect(cuts.every((c) => c.axis === 'horizontal')).toBe(true);
    expect(cuts.map((c) => Math.round(c.at * 540))).toEqual([102, 222, 352]);
    expect(cuts.every((c) => c.gapPt >= DEFAULTS.gapPt)).toBe(true);
  });

  it('refuses a cut that would cross a figure, and says why', () => {
    const withFigure = page({
      ...{ page: 1 },
      lines: [
        { top: 30, height: 34, text: 'One figure, two ideas', fontPt: 34, width: 600 },
        { top: 140, text: 'Transition model' },
        { top: 400, text: 'Markovian assumption' },
      ],
      ink: [{ x: 60, top: 165, w: 500, h: 230 }],
    });
    const all = candidatesForPage(withFigure);
    const blocked = all.filter((c) => c.blockedBy === 'figure');
    expect(blocked).toHaveLength(1);
    // Reported at the y the learner was aiming at — the middle of the gap they can see.
    expect(blocked[0]!.at * 540).toBeCloseTo(280, 0);
    // …and nothing is offered anywhere inside the figure's span.
    for (const c of acceptedCuts(all)) {
      expect(c.at * 540 > 165 && c.at * 540 < 395).toBe(false);
    }
  });

  it('cuts in the whitespace beside a figure rather than refusing the whole gap', () => {
    const withFigure = page({
      lines: [
        { top: 30, height: 34, text: 'One figure, then a bullet', fontPt: 34, width: 600 },
        { top: 140, text: 'Transition model' },
        { top: 440, text: 'Markovian assumption' },
      ],
      ink: [{ x: 60, top: 175, w: 500, h: 195 }],
    });
    const accepted = acceptedCuts(candidatesForPage(withFigure));
    // One under the title, one under the figure — and none through it.
    expect(accepted).toHaveLength(2);
    const last = accepted[1]!.at * 540;
    expect(last).toBeGreaterThan(370); // the figure's bottom edge
    expect(last).toBeLessThan(440); // the next block
  });

  it('will not cut inside the title band', () => {
    const tight = page({
      lines: [
        { top: 10, height: 24, text: 'Title', fontPt: 24 },
        { top: 55, text: 'First bullet, very close under the title' },
        { top: 300, text: 'Second bullet' },
      ],
    });
    const blocked = horizontalCandidates(tight, DEFAULTS).filter((c) => c.blockedBy === 'title-band');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.at).toBeLessThan(DEFAULTS.titleBand);
  });

  it('keeps a sub-G gap as a near-miss so a free cut can still snap to it', () => {
    const near = page({
      lines: [
        { top: 30, height: 34, text: 'Title', fontPt: 34 },
        { top: 200, text: 'one' },
        { top: 232, text: 'two' },
      ],
    });
    const gapTooSmall = horizontalCandidates(near, DEFAULTS).filter(
      (c) => c.blockedBy === 'gap-too-small',
    );
    expect(gapTooSmall).toHaveLength(1);
    expect(gapTooSmall[0]!.gapPt).toBeCloseTo(12, 1);
  });

  it('proposes a vertical cut in a two-column gutter (§C6)', () => {
    const twoCol = page({
      lines: [
        { top: 30, height: 34, text: 'Two columns', fontPt: 34, width: 600 },
        { top: 140, x: 60, width: 340, text: 'left one' },
        { top: 180, x: 60, width: 340, text: 'left two' },
        { top: 140, x: 540, width: 340, text: 'right one' },
        { top: 180, x: 540, width: 340, text: 'right two' },
      ],
    });
    const v = verticalCandidates(twoCol, DEFAULTS);
    expect(v).toHaveLength(1);
    expect(v[0]!.at * SLIDE.width).toBeCloseTo(470, 0);
    expect(v[0]!.blockedBy).toBeNull();
  });

  it('proposes nothing on a page with one block — zero is a correct answer (§D1)', () => {
    const single = page({ lines: [{ top: 200, text: 'One idea, stated once' }] });
    expect(candidatesForPage(single)).toEqual([]);
  });
});

describe('labels', () => {
  it('takes the slide title from the largest font, topmost', () => {
    expect(slideTitle(threeBlockSlide())).toBe('Markov decision processes');
  });

  it('prefers a tagged heading when the PDF is tagged (§B1.4)', () => {
    const tagged = { ...threeBlockSlide(), struct: [{ box: 3, role: 'H2' }] };
    expect(slideTitle(tagged)).toBe('Markovian assumption');
  });

  it('labels a sub-segment with its first text line', () => {
    const p = threeBlockSlide();
    expect(firstLineIn(p, { x0: 0, y0: 0.4, x1: 1, y1: 0.7 })).toBe('Markovian assumption');
    expect(firstLineIn(p, { x0: 0, y0: 0.95, x1: 1, y1: 1 })).toBe('');
  });
});

describe('the genre router (§H, issue #31)', () => {
  const base: GenreSignals = {
    wordsPerPage: 40,
    textCoverage: 0.2,
    columns: 1,
    landscape: true,
    images: 0,
  };
  it('routes slides', () => {
    expect(routeGenre(base)).toBe('slides');
  });
  it('routes a 2-column paper', () => {
    expect(routeGenre({ ...base, wordsPerPage: 900, textCoverage: 0.5, columns: 2, landscape: false })).toBe(
      'paper-2col',
    );
  });
  it('routes 1-column prose', () => {
    expect(routeGenre({ ...base, wordsPerPage: 400, textCoverage: 0.45, landscape: false })).toBe('prose');
  });
  it('separates an image-only scan from an ink-only sketch by the image XObjects', () => {
    expect(routeGenre({ ...base, wordsPerPage: 0, textCoverage: 0, images: 2 })).toBe('image-only');
    expect(routeGenre({ ...base, wordsPerPage: 0, textCoverage: 0, images: 0 })).toBe('ink-only');
  });
  it('falls back to prose, the genre whose failure costs only a notice', () => {
    expect(routeGenre({ ...base, wordsPerPage: 200, textCoverage: 0.5, landscape: false })).toBe('prose');
  });
  it('has a notice for every genre but slides', () => {
    expect(noticeFor('slides')).toBeNull();
    expect(noticeFor('prose')).toMatch(/not a slide deck/);
    expect(noticeFor('ink-only')).toMatch(/no text layer/);
  });
  it('measures a slide deck as one', () => {
    const signals = genreSignals([threeBlockSlide(1), threeBlockSlide(2)]);
    expect(signals.landscape).toBe(true);
    expect(signals.columns).toBe(1);
    expect(signals.wordsPerPage).toBeLessThan(150);
    expect(signals.textCoverage).toBeLessThan(0.4);
  });
});

describe('segment operations (§C5)', () => {
  const p = threeBlockSlide();
  const candidates = candidatesForPage(p);

  it('opens as one whole-page segment per page, labelled with the slide title', () => {
    const segments = wholePageSegments([p]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ page: 1, x0: 0, y0: 0, x1: 1, y1: 1, source: 'geometry' });
    expect(segments[0]!.label).toBe('Markov decision processes');
    expect(checkPartition(segments, [1])).toEqual([]);
  });

  it('snaps a free drag to the nearest candidate within 8 pt, and not beyond', () => {
    const target = candidates[1]!.at;
    const near = snapTo(target + 6 / 540, 'horizontal', candidates, 540, DEFAULTS.snapPt);
    expect(near?.at).toBe(target);
    expect(snapTo(target + 30 / 540, 'horizontal', candidates, 540, DEFAULTS.snapPt)).toBeNull();
  });

  it('splits at a tick, keeps the page covered, and labels both halves', () => {
    const start = wholePageSegments([p]);
    const r = splitSegment(start, p, { page: 1, at: candidates[1]!.at }, { candidates });
    expect(r.refused).toBeNull();
    expect(r.segments).toHaveLength(2);
    expect(r.snappedTo?.at).toBe(candidates[1]!.at);
    expect(r.segments[0]!.label).toBe('Markov decision processes');
    expect(r.segments[1]!.label).toBe('Markovian assumption');
    expect(checkPartition(r.segments, [1])).toEqual([]);
  });

  it('records a snapped cut as geometry and a released one as the learner’s', () => {
    const start = wholePageSegments([p]);
    const snapped = splitSegment(start, p, { page: 1, at: candidates[0]!.at }, { candidates });
    expect(snapped.segments.every((s) => s.source === 'geometry')).toBe(true);
    const free = splitSegment(start, p, { page: 1, at: 0.5, free: true }, { candidates });
    expect(free.segments.every((s) => s.source === 'learner')).toBe(true);
  });

  it('refuses a free cut through a figure', () => {
    const withFigure = page({
      lines: [
        { top: 30, height: 34, text: 'Title', fontPt: 34 },
        { top: 140, text: 'above' },
        { top: 420, text: 'below' },
      ],
      ink: [{ x: 60, top: 200, w: 500, h: 180 }],
    });
    const start = wholePageSegments([withFigure]);
    const r = splitSegment(start, withFigure, { page: 1, at: 290 / 540, free: true });
    expect(r.refused).toBe('figure');
    expect(r.segments).toBe(start);
  });

  it('refuses a degenerate cut on an existing edge', () => {
    const start = wholePageSegments([p]);
    expect(splitSegment(start, p, { page: 1, at: 0, free: true }).refused).toBe('degenerate');
    expect(splitSegment(start, p, { page: 1, at: 1, free: true }).refused).toBe('degenerate');
  });

  it('splits vertically and still partitions the page', () => {
    const twoCol = page({
      lines: [
        { top: 140, x: 60, width: 340, text: 'left' },
        { top: 140, x: 540, width: 340, text: 'right' },
      ],
    });
    const start = wholePageSegments([twoCol]);
    const r = splitSegment(start, twoCol, { page: 1, at: 0.49, axis: 'vertical', free: true });
    expect(r.refused).toBeNull();
    expect(r.segments.map((s) => [s.x0, s.x1])).toEqual([
      [0, 0.49],
      [0.49, 1],
    ]);
    expect(checkPartition(r.segments, [1])).toEqual([]);
  });

  it('merge is the inverse of split', () => {
    const start = wholePageSegments([p]);
    for (const c of acceptedCuts(candidates)) {
      const split = splitSegment(start, p, { page: 1, at: c.at }, { candidates });
      const merged = mergeSegments(split.segments, 0, 1);
      expect(merged.refused).toBeNull();
      expect(merged.segments).toHaveLength(1);
      expect(merged.segments[0]).toMatchObject({ page: 1, x0: 0, y0: 0, x1: 1, y1: 1 });
      expect(checkPartition(merged.segments, [1])).toEqual([]);
    }
  });

  it('refuses a merge across pages and a merge of two non-adjacent segments', () => {
    const two = wholePageSegments([threeBlockSlide(1), threeBlockSlide(2)]);
    expect(mergeSegments(two, 0, 1).refused).toBe('different-pages');

    const start = wholePageSegments([p]);
    const first = splitSegment(start, p, { page: 1, at: candidates[0]!.at }, { candidates });
    const second = splitSegment(first.segments, p, { page: 1, at: candidates[2]!.at }, { candidates });
    expect(second.segments).toHaveLength(3);
    expect(mergeSegments(second.segments, 0, 2).refused).toBe('not-adjacent');
  });

  it('keeps every page covered through a run of splits and merges', () => {
    let segments = wholePageSegments([p]);
    for (const c of acceptedCuts(candidates)) {
      const r = splitSegment(segments, p, { page: 1, at: c.at }, { candidates });
      expect(r.refused).toBeNull();
      segments = r.segments;
      expect(checkPartition(segments, [1])).toEqual([]);
    }
    expect(segments).toHaveLength(4);
    while (segments.length > 1) {
      const m = mergeSegments(segments, 0, 1);
      expect(m.refused).toBeNull();
      segments = m.segments;
      expect(checkPartition(segments, [1])).toEqual([]);
    }
  });

  it('reorder moves a card and never changes the partition', () => {
    const segments = wholePageSegments([threeBlockSlide(1), threeBlockSlide(2), threeBlockSlide(3)]);
    const moved = reorderSegments(segments, 2, 0);
    expect(moved.map((s) => s.page)).toEqual([3, 1, 2]);
    expect(checkPartition(moved, [1, 2, 3])).toEqual([]);
  });

  it('checkPartition notices a hole and an overlap', () => {
    const base = { page: 1, label: '', source: 'geometry' as const };
    expect(checkPartition([{ ...base, x0: 0, y0: 0, x1: 1, y1: 0.5 }], [1]).length).toBeGreaterThan(0);
    expect(
      checkPartition(
        [
          { ...base, x0: 0, y0: 0, x1: 1, y1: 0.6 },
          { ...base, x0: 0, y0: 0.4, x1: 1, y1: 1 },
        ],
        [1],
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('the pipeline', () => {
  it('runs stages 0–3 and opens every kept page whole', () => {
    const out = segmentDocument([threeBlockSlide(1), threeBlockSlide(2)]);
    // Two identical pages *are* a build group by the §C2 rule: page 1's tokens are contained
    // in page 2's. That is the intended behaviour, and the reason the fixture test below runs
    // on a deck whose pages differ.
    expect(out.genre).toBe('slides');
    expect(out.notice).toBeNull();
    expect(out.segments.every((s) => s.x1 - s.x0 === 1 && s.y1 - s.y0 === 1)).toBe(true);
    expect(checkPartition(out.segments, out.pages.map((p) => p.page))).toEqual([]);
  });

  it('emits no candidates, and a notice, off slides (issue #25 decision 5)', () => {
    const prose = page({
      width: 595,
      height: 842,
      lines: Array.from({ length: 40 }, (_, i) => ({
        top: 60 + i * 18,
        x: 60,
        width: 470,
        text: `line ${i} with enough words on it to count as running prose on a page of a paper`,
        fontPt: 10,
      })),
    });
    const out = segmentDocument([prose, { ...prose, page: 2 }]);
    expect(out.genre).toBe('prose');
    expect(out.candidates).toEqual([]);
    expect(out.notice).toMatch(/not a slide deck/);
  });
});
