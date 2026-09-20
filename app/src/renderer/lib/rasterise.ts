/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SLIDES → PIXELS, IN THE RENDERER (`docs/research/collab-doc.md` §2, §3)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two jobs, one pdf.js document, because they are the same job at two sizes:
 *
 *  1. **`pageImages()`** — every page as a ~1024 px JPEG, handed to `notes:pageImages` *before*
 *     the ingest so the refine pass can be shown the slides (§2 pass 2). Main cannot do this:
 *     `src/main/vault/pdf.ts` loads pdf.js with no canvas and nothing in `src/main` rasterises,
 *     which is exactly why `PageImage` exists in the contract.
 *  2. **`SlideSource`** — the carousel's thumbnails, the modal's zoomable page and the inline
 *     `slide_figure` crops. §3's fidelity claim ("a crop of the rendered page: pixels, not a
 *     redraw") is *this*: one `drawImage` out of a real pdf.js canvas, the same mechanism
 *     `SegmentCard.svelte:198` uses, with `flowview.ts`'s `sourceRect` doing the clamped
 *     arithmetic so a sub-pixel overhang cannot draw a hairline of transparent edge.
 *
 * **`PdfViewer.svelte` is read-only for every track** (the build contract), and it would be the
 * wrong thing to borrow anyway: it releases any page more than ±3 away from the one being read,
 * and a crop drawn off a released canvas is a blank card — the trap `FlowCanvas` already
 * documented and avoided by owning its own render path. So this module owns its own pdf.js
 * document and its own small LRU, and reuses the *pure* parts (`flowview.ts`, `pdfview.ts`)
 * rather than the stateful ones.
 *
 * **pdf.js is imported lazily**, inside the functions that need it, so the pure arithmetic below
 * can be unit-tested in vitest's node environment without dragging a browser worker in.
 */

import { sourceRect } from './flowview.js';
import type { PageImage, Rect } from '../../shared/doc/types.js';

// ── the numbers ─────────────────────────────────────────────────────────────────────────────

/**
 * The width a page is rasterised to for the model. ~1024 px is the width at which slide body
 * text is legible to a vision model and a 66-page deck is still a few megabytes rather than a
 * few dozen; the ingest is allowed to run with no images at all, so this is a quality knob, not
 * a correctness one.
 */
export const PAGE_IMAGE_WIDTH = 1024;

/** JPEG, not PNG: a rendered slide is a photograph of type, and 0.7 is invisible on one. */
export const PAGE_IMAGE_QUALITY = 0.7;

/** Pages per `notes:pageImages` call. Eight ~120 KB JPEGs is a ~1 MB structured-clone hop. */
export const PAGE_IMAGE_BATCH = 8;

/** The widest a thumbnail is ever rendered. Above this the carousel is paying for nothing. */
export const THUMB_WIDTH = 320;

/** How many page canvases the slide source keeps. The carousel scrolls; the modal pages. */
export const SLIDE_CACHE = 10;

// ── pure arithmetic ─────────────────────────────────────────────────────────────────────────

export interface RasterSize {
  width: number;
  height: number;
  scale: number;
}

/**
 * The backing size for a page rendered to `targetPx` CSS-independent pixels wide.
 *
 * Rounded to integers **from the scale**, so the two dimensions cannot disagree about a rounding
 * the way they do when each is rounded independently — the failure that leaves a one-pixel
 * transparent strip along the bottom of a crop.
 *
 * A page that is already narrower than the target is **not upscaled**: rasterising a 200 pt-wide
 * page to 1024 px produces a blurry five-times-magnified bitmap and five times the bytes.
 */
export function rasterSize(pageWidthPt: number, pageHeightPt: number, targetPx: number): RasterSize {
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0) || !(targetPx > 0)) {
    return { width: 1, height: 1, scale: 1 };
  }
  const scale = Math.min(targetPx / pageWidthPt, 4);
  const width = Math.max(1, Math.round(pageWidthPt * scale));
  const height = Math.max(1, Math.round(pageHeightPt * scale));
  return { width, height, scale };
}

/** `[1…n]` in batches of `size`. The ingest's page images go over IPC one batch at a time. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/** The pages of a document, 1-based. */
export function pageNumbers(pageCount: number): number[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1);
}

/**
 * The CSS box a crop of `rect` wants at `width` px across.
 *
 * The aspect ratio is taken in **points** and not in normalised units, for the reason
 * `flowview.ts` gives: a region that is half the width and half the height of a 16:9 page is
 * itself 16:9, and normalised numbers alone cannot say that.
 */
export function cropBox(
  rect: Rect | null,
  page: { width: number; height: number },
  width: number,
): { w: number; h: number } {
  const box = rect ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const wPt = Math.max(0, box.x1 - box.x0) * page.width;
  const hPt = Math.max(0, box.y1 - box.y0) * page.height;
  const w = Math.max(1, Math.round(width));
  if (wPt <= 0 || hPt <= 0) return { w, h: 1 };
  return { w, h: Math.max(1, Math.round((w * hPt) / wPt)) };
}

// ── pdf.js ──────────────────────────────────────────────────────────────────────────────────

/**
 * The bits of `PDFDocumentProxy` this module uses. Named so the pure side stays import-free.
 *
 * **Teardown is not `destroy()`.** A `PDFDocumentProxy` in pdfjs-dist 6 offers `cleanup()` and a
 * `loadingTask`; `destroy()` is the *loading task's*. This interface used to promise `destroy()`
 * on the document itself, which the `as unknown as PdfDoc` in `openPdf` let through — see
 * `releaseDocument` for what that cost.
 */
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  loadingTask?: { destroy?: () => Promise<void> | void };
  destroy?: () => Promise<void> | void;
  cleanup?: () => Promise<unknown>;
}

interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }): {
    promise: Promise<void>;
    cancel(): void;
  };
}

/**
 * **Let a pdf.js document go, whatever this version of pdf.js calls that.**
 *
 * Exported and defensive for one reason, which the live run of 20 Sep paid for: the teardown path
 * is the *only* path nothing exercises until a learner opens a **second** deck, and when it threw
 * it took the open with it. `SlideSource.destroy()` called `#doc.destroy()`, pdfjs-dist 6 has no
 * such method on the document, the `TypeError` came out of `DocStore.#reset()` — the first line
 * of `open()` — and so the second deck never loaded at all: no ingest, no error on screen, the
 * first deck still on the page. A release is best-effort by nature; nothing above it may fail
 * because a worker did not shut down tidily.
 *
 * Prefers the loading task (which really does free the worker), falls back to a document-level
 * `destroy` for older builds, then to `cleanup`, and swallows everything.
 */
export function releaseDocument(doc: unknown): void {
  const it = doc as PdfDoc | null;
  if (!it) return;
  const attempt = (fn: (() => Promise<unknown> | unknown) | undefined, on: unknown): boolean => {
    if (typeof fn !== 'function') return false;
    try {
      const out = (fn as () => Promise<unknown> | unknown).call(on);
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        void (out as Promise<unknown>).catch(() => undefined);
      }
      return true;
    } catch {
      return true; // it was the right method; it simply failed, and that is not ours to fix
    }
  };
  if (attempt(it.loadingTask?.destroy, it.loadingTask)) return;
  if (attempt(it.destroy, it)) return;
  attempt(it.cleanup, it);
}

let workerConfigured = false;

/**
 * Open a copy of the bytes.
 *
 * **A copy, deliberately.** pdf.js transfers the buffer it is given to its worker, which detaches
 * it; `DocumentView.bytes` is held by the store and read by `PdfViewer` as well, and a detached
 * `Uint8Array` there is a blank viewer with no error message.
 */
export async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    // The same line `PdfViewer.svelte` uses: bundled by Vite as a same-origin asset, and a
    // module worker from `file://` works in Electron (verified against the packaged renderer).
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
    workerConfigured = true;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  return (await task.promise) as unknown as PdfDoc;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Render one page into a fresh canvas at `targetPx` wide. Rejects only on a pdf.js failure. */
export async function renderPage(doc: PdfDoc, page: number, targetPx: number): Promise<HTMLCanvasElement> {
  const proxy = await doc.getPage(page);
  const unit = proxy.getViewport({ scale: 1 });
  const { width, height, scale } = rasterSize(unit.width, unit.height, targetPx);
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  const viewport = proxy.getViewport({ scale });
  await proxy.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas;
}

/** A canvas → JPEG bytes. `toBlob` rather than `toDataURL`: no base64 round trip, no string. */
async function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export interface PageImagesOptions {
  width?: number;
  quality?: number;
  batchSize?: number;
  /** Called once per finished batch, in page order. Return `false` to stop early. */
  onBatch: (images: PageImage[], done: boolean) => Promise<boolean | void> | boolean | void;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Every page of the deck as a JPEG, sent on in batches.
 *
 * **Sequential, and it yields between pages.** Rasterising 66 pages is seconds of main-thread
 * canvas work; doing it in a `Promise.all` freezes the window, and the window is where the
 * learner is being told "Ellie is reading the slides". One page at a time with a macrotask
 * between them keeps the pane painting.
 *
 * **A page that fails is skipped, not fatal.** §2's images are optional — the ingest runs on
 * structured text and geometry without them — so a single broken page must never be the reason
 * a deck cannot be opened. The count of what actually made it is the return value.
 */
export async function pageImages(doc: PdfDoc, options: PageImagesOptions): Promise<number> {
  const width = options.width ?? PAGE_IMAGE_WIDTH;
  const quality = options.quality ?? PAGE_IMAGE_QUALITY;
  const batchSize = options.batchSize ?? PAGE_IMAGE_BATCH;
  const total = doc.numPages;
  /**
   * **A deck with no page count is a wiring bug, not an empty deck.**
   *
   * Every failure below this line is swallowed on purpose (images are optional). That charity is
   * wrong here: `numPages: undefined` walks through `pageNumbers` as `Array.from({length: NaN})`
   * and produces *zero* pages with no error at all — which is exactly how the first live ingest
   * ran text-only against §2's "with the slide images" and said so only in one log field. Handed
   * the wrong object, this now says so.
   */
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`pageImages: the document reports no pages (numPages=${String(total)})`);
  }
  const groups = batches(pageNumbers(total), batchSize);

  let sent = 0;
  let done = 0;
  for (let g = 0; g < groups.length; g++) {
    const images: PageImage[] = [];
    for (const page of groups[g]!) {
      try {
        const canvas = await renderPage(doc, page, width);
        const bytes = await encodeJpeg(canvas, quality);
        if (bytes) {
          images.push({ page, mime: 'image/jpeg', width: canvas.width, height: canvas.height, bytes });
        }
        // Give the backing store back straight away: 66 pages of 1024 px bitmaps held at once
        // is the 901 MB failure the UI review measured on the viewer.
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        // Skipped. See the doc comment: images are optional, the ingest is not.
      }
      done++;
      options.onProgress?.(done, total);
      // Yield, so the "reading the slides" pane keeps animating.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const isLast = g === groups.length - 1;
    const keepGoing = await options.onBatch(images, isLast);
    sent += images.length;
    if (keepGoing === false) break;
  }
  return sent;
}

// ── the slide source: cached canvases for the carousel, the modal and inline figures ────────

interface CachedPage {
  canvas: HTMLCanvasElement;
  width: number;
}

/**
 * One open PDF, with a small LRU of rendered pages.
 *
 * Kept deliberately simple: pages are rendered at the width they are asked for, and a page
 * already rendered at least that wide is reused and scaled down by `drawImage` (which is what
 * makes a thumbnail free once the modal has shown the page). A page rendered *narrower* than the
 * request is re-rendered, because upscaling a thumbnail into the modal is the one place the
 * "pixels, not a redraw" claim would visibly break.
 */
export class SlideSource {
  #doc: PdfDoc;
  #cache = new Map<number, CachedPage>();
  #inFlight = new Map<string, Promise<HTMLCanvasElement | null>>();
  #sizes = new Map<number, { width: number; height: number }>();
  #destroyed = false;

  readonly pageCount: number;

  private constructor(doc: PdfDoc) {
    this.#doc = doc;
    this.pageCount = doc.numPages;
  }

  static async open(bytes: Uint8Array): Promise<SlideSource> {
    return new SlideSource(await openPdf(bytes));
  }

  /**
   * The open pdf.js document, in the shape `pageImages()` reads.
   *
   * The two jobs at the top of this file share one parsed deck rather than opening the bytes
   * twice, but `pageImages` is written against pdf.js's own document so it can be driven by a
   * stub in a test. This getter is the one seam between them. It exists because the call site in
   * `docstore.svelte.ts` used to bridge the gap with `as unknown as`, and a `SlideSource` has
   * `pageCount`, not `numPages`: the cast type-checked, `numPages` came out `undefined`, and the
   * ingest silently ran with no slide images at all.
   */
  get pdfDoc(): PdfDoc {
    return this.#doc;
  }

  /** The page's own box in points. Null until the page has been measured once. */
  size(page: number): { width: number; height: number } | null {
    return this.#sizes.get(page) ?? null;
  }

  async measure(page: number): Promise<{ width: number; height: number }> {
    const known = this.#sizes.get(page);
    if (known) return known;
    const proxy = await this.#doc.getPage(page);
    const unit = proxy.getViewport({ scale: 1 });
    const size = { width: unit.width, height: unit.height };
    this.#sizes.set(page, size);
    return size;
  }

  /** The page at (at least) `width` px across, or null if it could not be rendered. */
  async canvas(page: number, width: number): Promise<HTMLCanvasElement | null> {
    if (this.#destroyed || page < 1 || page > this.pageCount) return null;
    const hit = this.#cache.get(page);
    if (hit && hit.width >= width - 1) {
      this.#touch(page, hit);
      return hit.canvas;
    }
    const key = `${page}:${Math.round(width)}`;
    const existing = this.#inFlight.get(key);
    if (existing) return existing;
    const job = (async (): Promise<HTMLCanvasElement | null> => {
      try {
        await this.measure(page);
        const canvas = await renderPage(this.#doc, page, width);
        if (this.#destroyed) return null;
        this.#put(page, { canvas, width });
        return canvas;
      } catch {
        return null;
      } finally {
        this.#inFlight.delete(key);
      }
    })();
    this.#inFlight.set(key, job);
    return job;
  }

  /**
   * A crop of the rendered page, as its own canvas: one `drawImage` with a clamped source rect.
   *
   * `rect` is normalised, y **down** from the page top, as `vault/geometry.ts` and the contract's
   * `Rect` define it — the same convention `flowview.sourceRect` expects, which is why it can be
   * reused here unchanged.
   */
  async crop(page: number, rect: Rect | null, width: number, dpr = 1): Promise<HTMLCanvasElement | null> {
    const box = rect ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    const span = Math.max(0.02, box.x1 - box.x0);
    // Render the *page* wide enough that the crop itself lands at `width` device pixels.
    const source = await this.canvas(page, Math.min(4096, Math.ceil((width * dpr) / span)));
    if (!source) return null;
    const pt = this.size(page) ?? { width: 1, height: 1 };
    const css = cropBox(rect, pt, width);
    const out = makeCanvas(Math.round(css.w * dpr), Math.round(css.h * dpr));
    const context = out.getContext('2d');
    if (!context) return null;
    const src = sourceRect(box, { width: source.width, height: source.height });
    context.drawImage(source, src.sx, src.sy, src.sw, src.sh, 0, 0, out.width, out.height);
    out.style.width = `${css.w}px`;
    out.style.height = `${css.h}px`;
    return out;
  }

  destroy(): void {
    this.#destroyed = true;
    for (const [, entry] of this.#cache) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    this.#cache.clear();
    releaseDocument(this.#doc);
  }

  #touch(page: number, entry: CachedPage): void {
    this.#cache.delete(page);
    this.#cache.set(page, entry);
  }

  #put(page: number, entry: CachedPage): void {
    this.#cache.delete(page);
    this.#cache.set(page, entry);
    while (this.#cache.size > SLIDE_CACHE) {
      const oldest = this.#cache.keys().next();
      if (oldest.done) break;
      const gone = this.#cache.get(oldest.value);
      if (gone) {
        gone.canvas.width = 0;
        gone.canvas.height = 0;
      }
      this.#cache.delete(oldest.value);
    }
  }
}
