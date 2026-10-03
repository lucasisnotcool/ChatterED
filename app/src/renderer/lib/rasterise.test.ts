import { describe, expect, it } from 'vitest';
import {
  PAGE_IMAGE_BATCH,
  SlideSource,
  batches,
  cropBox,
  ingestPages,
  pageNumbers,
  pageTitle,
  partPages,
  rasterSize,
  releaseDocument,
  sourceRect,
  stepPage,
  textLayerScale,
  wrapWords,
  type SlidePart,
} from './rasterise.js';

describe('rasterSize', () => {
  it('hits the target width and keeps the aspect ratio', () => {
    // A 16:9 slide in points (Beamer's 96 × 54 mm at 72 dpi is close to this).
    const size = rasterSize(720, 405, 1024);
    expect(size.width).toBe(1024);
    expect(size.height).toBe(576);
  });

  it('derives both dimensions from one scale, so they cannot disagree about a rounding', () => {
    const size = rasterSize(613.7, 341.2, 1024);
    expect(size.height).toBe(Math.round(341.2 * size.scale));
  });

  it('does not upscale a page that is already narrower than the target beyond 4x', () => {
    const size = rasterSize(100, 100, 1024);
    expect(size.scale).toBe(4);
    expect(size.width).toBe(400);
  });

  it('degrades to a 1x1 rather than throwing on a degenerate page', () => {
    expect(rasterSize(0, 0, 1024)).toEqual({ width: 1, height: 1, scale: 1 });
    expect(rasterSize(720, 405, 0).width).toBe(1);
  });
});

describe('batches', () => {
  it('splits the pages of a 66-page deck into batches of eight, last one short', () => {
    const groups = batches(pageNumbers(66), PAGE_IMAGE_BATCH);
    expect(groups.length).toBe(9);
    expect(groups[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(groups.at(-1)).toEqual([65, 66]);
  });

  it('is empty for an empty deck, so `done` never fires on nothing', () => {
    expect(batches(pageNumbers(0), 8)).toEqual([]);
  });

  it('never loops forever on a zero batch size', () => {
    expect(batches([1, 2, 3], 0).length).toBe(3);
  });
});

describe('cropBox', () => {
  it('takes the aspect ratio in points, not in normalised units', () => {
    // Half the width and half the height of a 16:9 page is itself 16:9.
    const box = cropBox({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, { width: 720, height: 405 }, 360);
    expect(box).toEqual({ w: 360, h: 203 });
  });

  it('treats a null rect as the whole page', () => {
    expect(cropBox(null, { width: 720, height: 405 }, 720)).toEqual({ w: 720, h: 405 });
  });

  it('survives a collapsed rect', () => {
    expect(cropBox({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, { width: 720, height: 405 }, 360)).toEqual({
      w: 360,
      h: 1,
    });
  });
});

describe('textLayerScale: the text layer sits exactly over the canvas', () => {
  it('is CSS px per point, upscaling as freely as it downscales', () => {
    expect(textLayerScale(720, 520)).toBeCloseTo(520 / 720);
    // A small page shown large: unlike `rasterSize`, no ×4 cap, or the words would drift.
    expect(textLayerScale(100, 760)).toBeCloseTo(7.6);
  });

  it('falls back to 1 for a page or width it cannot use', () => {
    expect(textLayerScale(0, 520)).toBe(1);
    expect(textLayerScale(720, 0)).toBe(1);
    expect(textLayerScale(Number.NaN, 520)).toBe(1);
  });
});

/**
 * The teardown path, which nothing exercises until a learner opens a **second** deck — and which,
 * when it threw, stopped that deck opening at all (live run, 20 Sep).
 */
describe('releaseDocument', () => {
  it('prefers the loading task, which is what actually frees the worker', () => {
    const calls: string[] = [];
    const doc = {
      numPages: 3,
      loadingTask: { destroy: () => { calls.push('task'); return Promise.resolve(); } },
      destroy: () => { calls.push('doc'); return Promise.resolve(); },
      cleanup: () => { calls.push('cleanup'); return Promise.resolve(); },
    };
    releaseDocument(doc);
    expect(calls).toEqual(['task']);
  });

  it('falls back to a document-level destroy, then to cleanup', () => {
    const older: string[] = [];
    releaseDocument({ numPages: 1, destroy: () => { older.push('doc'); return Promise.resolve(); } });
    expect(older).toEqual(['doc']);

    const newer: string[] = [];
    releaseDocument({ numPages: 1, cleanup: () => { newer.push('cleanup'); return Promise.resolve(); } });
    expect(newer).toEqual(['cleanup']);
  });

  /** pdfjs-dist 6: `PDFDocumentProxy` has `cleanup()` and `loadingTask`, and no `destroy()`. */
  it('does not throw on a document that offers none of them, or on nothing at all', () => {
    expect(() => releaseDocument({ numPages: 1 })).not.toThrow();
    expect(() => releaseDocument(null)).not.toThrow();
    expect(() => releaseDocument(undefined)).not.toThrow();
  });

  it('swallows a teardown that throws, because the caller is about to open another deck', () => {
    const doc = { numPages: 1, loadingTask: { destroy: () => { throw new Error('worker gone'); } } };
    expect(() => releaseDocument(doc)).not.toThrow();
  });

  it('swallows a rejected teardown promise rather than leaving it unhandled', async () => {
    releaseDocument({ numPages: 1, loadingTask: { destroy: () => Promise.reject(new Error('late')) } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(true).toBe(true);
  });
});

/**
 * Moved here with the function when the crop flow was removed (#48): the inline slide figures
 * are the one caller left, and these two cases are the whole of what `crop()` relies on.
 */
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

// ── the notebook's slides (contract C1) ─────────────────────────────────────────────────────

function part(fileId: string, kind: SlidePart['kind'], pageBase: number, pageCount: number, name = `${fileId}.pdf`): SlidePart {
  return { fileId, name, kind, pageBase, pageCount, enabled: true, status: 'ready' };
}

/** A lecture (1–5), a removed source's gap (6–7), Markdown notes (8–9) and a photo (10). */
const PARTS: SlidePart[] = [
  part('lecture', 'pdf', 0, 5, 'Lecture 4.pdf'),
  part('notes', 'text', 7, 2, 'Week 2 notes.md'),
  part('photo', 'image', 9, 1, 'Whiteboard.jpg'),
];

describe('partPages and stepPage: the modal pages across sources, over the gaps', () => {
  it('lists every page still there, the gap left out', () => {
    expect(partPages(PARTS)).toEqual([1, 2, 3, 4, 5, 8, 9, 10]);
  });

  it('steps across a source boundary and over a removed source', () => {
    expect(stepPage(PARTS, 4, 1)).toBe(5);
    expect(stepPage(PARTS, 5, 1)).toBe(8);
    expect(stepPage(PARTS, 8, -1)).toBe(5);
  });

  it('stops at either end', () => {
    expect(stepPage(PARTS, 10, 1)).toBeNull();
    expect(stepPage(PARTS, 1, -1)).toBeNull();
    expect(stepPage([], 1, 1)).toBeNull();
  });

  it('leaves a gap for the nearest page in the direction asked', () => {
    expect(stepPage(PARTS, 6, 1)).toBe(8);
    expect(stepPage(PARTS, 6, -1)).toBe(5);
  });
});

describe('pageTitle: a whole page, named', () => {
  it('names the source and its own page in a notebook of several', () => {
    expect(pageTitle(PARTS, 3)).toBe('Lecture 4 p. 3');
    expect(pageTitle(PARTS, 9)).toBe('Week 2 notes §2');
    expect(pageTitle(PARTS, 10)).toBe('Whiteboard');
  });

  it('reads Slide N in a notebook of one PDF, as the modal always did', () => {
    expect(pageTitle(PARTS.slice(0, 1), 3)).toBe('Slide 3');
  });

  it('says a removed source is gone', () => {
    expect(pageTitle(PARTS, 6)).toBe('A removed source');
  });
});

describe('ingestPages: what the ingest is shown as images', () => {
  it('is the ticked, ready PDF and image pages, under notebook numbers', () => {
    expect(ingestPages(PARTS)).toEqual([1, 2, 3, 4, 5, 10]);
  });

  it('leaves out an unticked source and one still being read', () => {
    const parts = [{ ...PARTS[0]!, enabled: false }, PARTS[1]!, { ...PARTS[2]!, status: 'reading' as const }];
    expect(ingestPages(parts)).toEqual([]);
  });

  it('can be limited to the sources an Update has not seen', () => {
    expect(ingestPages(PARTS, (p) => p.fileId === 'photo')).toEqual([10]);
  });
});

describe('wrapWords: a text page as a card', () => {
  const byChars = (s: string): number => s.length;

  it('fills each line up to the width', () => {
    expect(wrapWords('one two three four', 9, byChars)).toEqual(['one two', 'three', 'four']);
  });

  it('keeps paragraphs apart with a blank line, and none at the end', () => {
    expect(wrapWords('a b\n\nc', 10, byChars)).toEqual(['a b', '', 'c']);
  });

  it('gives a word longer than a line a line of its own', () => {
    expect(wrapWords('a extraordinarily b', 5, byChars)).toEqual(['a', 'extraordinarily', 'b']);
  });
});

describe('SlideSource over a notebook, without pixels', () => {
  const opened: string[] = [];
  const source = new SlideSource(PARTS, {
    open: (fileId) => {
      opened.push(fileId);
      return Promise.resolve(fileId === 'notes' ? { bytes: null, text: 'First part.\n\nSecond part.' } : null);
    },
    paginate: (text) => text.split('\n\n'),
  });

  it('reports the notebook page count, gaps included', () => {
    expect(source.pageCount).toBe(10);
  });

  it('reads a text source page by its own page, and opens the source once', async () => {
    expect(await source.text(8)).toBe('First part.');
    expect(await source.text(9)).toBe('Second part.');
    expect(opened).toEqual(['notes']);
    expect(await source.text(3)).toBeNull();
  });

  it('labels chips through the notebook', () => {
    expect(source.citation([3, 4, 9])).toBe('Lecture 4 p. 3–4 · Week 2 notes §2');
    expect(source.kindOf(10)).toBe('image');
    expect(source.kindOf(6)).toBeNull();
  });

  it('gives no page for a gap', async () => {
    expect(await source.canvas(6, 100)).toBeNull();
  });

  it('labels as before with no sources yet, rather than calling every page removed', () => {
    expect(new SlideSource([], null).citation([3, 4])).toBe('p. 3–4');
  });

  it('gives no text layer for a text page or a gap, and leaves the container alone', async () => {
    // Never touched on these paths, so a bare object stands in for the element.
    const container = {} as HTMLElement;
    expect(await source.textLayer(8, container, 520)).toBe(false);
    expect(await source.textLayer(6, container, 520)).toBe(false);
  });

  it('forgets a source that was removed, and keeps the rest', async () => {
    source.setSources(PARTS.slice(0, 2));
    expect(source.pageCount).toBe(9);
    expect(await source.text(8)).toBe('First part.');
    expect(opened).toEqual(['notes']);
  });
});
