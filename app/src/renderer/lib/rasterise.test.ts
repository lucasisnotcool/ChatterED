import { describe, expect, it } from 'vitest';
import { PAGE_IMAGE_BATCH, batches, cropBox, pageNumbers, rasterSize, releaseDocument } from './rasterise.js';

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
