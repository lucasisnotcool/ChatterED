/**
 * Synthetic `PageGeometry` for the segmentation tests.
 *
 * Every stage from `src/shared/segment/` is pure arithmetic over boxes, so most of it is tested
 * against pages written by hand here — a page stated in points reads as a slide layout, and a
 * failing assertion points at a coordinate rather than at pdf.js. The real fixture deck is
 * exercised separately in `src/main/vault/geometry.test.ts`.
 */
import type { InkBox, PageGeometry, TextBox } from '../shared/segment/types.js';

/** A 16:9 slide, in points, matching the fixture deck's 959.76 × 540. */
export const SLIDE = { width: 960, height: 540 };

export interface LineSpec {
  /** Baseline-ish top and bottom, in points from the page top. */
  top: number;
  height?: number;
  x?: number;
  width?: number;
  text: string;
  fontPt?: number;
}

export interface PageSpec {
  page?: number;
  width?: number;
  height?: number;
  lines?: LineSpec[];
  /** Ink, in points from the page top. */
  ink?: Array<{ x: number; top: number; w: number; h: number; kind?: InkBox['kind'] }>;
}

export function page(spec: PageSpec): PageGeometry {
  const width = spec.width ?? SLIDE.width;
  const height = spec.height ?? SLIDE.height;
  const textBoxes: TextBox[] = (spec.lines ?? []).map((l) => {
    const h = l.height ?? l.fontPt ?? 20;
    return {
      x0: (l.x ?? 60) / width,
      x1: ((l.x ?? 60) + (l.width ?? 400)) / width,
      y0: l.top / height,
      y1: (l.top + h) / height,
      text: l.text,
      fontPt: l.fontPt ?? h,
      fontName: 'g_d0_f1',
    };
  });
  const inkBoxes: InkBox[] = (spec.ink ?? []).map((i) => ({
    kind: i.kind ?? 'path',
    x0: i.x / width,
    x1: (i.x + i.w) / width,
    y0: i.top / height,
    y1: (i.top + i.h) / height,
  }));
  return {
    page: spec.page ?? 1,
    width,
    height,
    textBoxes,
    inkBoxes,
    chrome: textBoxes.map(() => false),
    imageCount: inkBoxes.filter((b) => b.kind === 'image').length,
  };
}

/** A slide with a title band and three well-separated bullet blocks. Four gaps, three usable. */
export function threeBlockSlide(n = 1): PageGeometry {
  return page({
    page: n,
    lines: [
      { top: 30, height: 34, text: 'Markov decision processes', fontPt: 34, width: 600 },
      { top: 140, text: 'Transition model' },
      { top: 164, text: 'P(s prime given s and a)' },
      { top: 260, text: 'Markovian assumption' },
      { top: 284, text: 'The next state depends only on the current one' },
      { top: 400, text: 'Reward' },
      { top: 424, text: 'R(s, a, s prime)' },
    ],
  });
}
