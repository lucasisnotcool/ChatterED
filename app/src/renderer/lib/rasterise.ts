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
 *     redraw") is *this*: one `drawImage` out of a real pdf.js canvas, with `sourceRect()` below
 *     doing the clamped arithmetic so a sub-pixel overhang cannot draw a hairline of transparent
 *     edge.
 *
 * **`PdfViewer.svelte` is read-only for every track** (the build contract), and it would be the
 * wrong thing to borrow anyway: it releases any page more than ±3 away from the one being read,
 * and a crop drawn off a released canvas is a blank card — the trap the retired flow canvas
 * already documented and avoided by owning its own render path. So this module owns its own
 * pdf.js document and its own small LRU, and reuses the *pure* parts (`pdfview.ts`) rather than
 * the stateful ones.
 *
 * **pdf.js is imported lazily**, inside the functions that need it, so the pure arithmetic below
 * can be unit-tested in vitest's node environment without dragging a browser worker in.
 */

import type { PageImage, Rect } from '../../shared/doc/types.js';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  citationLabel,
  locatePage,
  pageRanges,
  pagesOfSource,
  shortSourceName,
  virtualPageCount,
  type NotebookSourceView,
  type SourceKind,
} from '../../shared/notebook.js';

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

// ── the clamped crop arithmetic ─────────────────────────────────────────────────────────────

/** A canvas's backing-store size in device pixels. */
export interface CanvasPx {
  width: number;
  height: number;
}

/** A source rectangle in a page canvas's own device pixels, ready for `drawImage`. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The crop's rectangle, in the page canvas's device pixels.
 *
 * Clamped to the canvas rather than trusted: `drawImage` with a source rectangle that overhangs
 * the source canvas by a sub-pixel silently draws transparent edges, which on a slide reads as
 * a hairline of missing pixels along the bottom of every figure. Written for the retired crop
 * flow and kept here, unchanged, because §3's inline figures are the same `drawImage`.
 */
export function sourceRect(rect: Rect, canvas: CanvasPx): SourceRect {
  const sx = clamp(Math.round(rect.x0 * canvas.width), 0, Math.max(0, canvas.width - 1));
  const sy = clamp(Math.round(rect.y0 * canvas.height), 0, Math.max(0, canvas.height - 1));
  const sw = clamp(Math.round((rect.x1 - rect.x0) * canvas.width), 1, canvas.width - sx);
  const sh = clamp(Math.round((rect.y1 - rect.y0) * canvas.height), 1, canvas.height - sy);
  return { sx, sy, sw, sh };
}

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
 * The aspect ratio is taken in **points** and not in normalised units: a region that is half
 * the width and half the height of a 16:9 page is itself 16:9, and normalised numbers alone
 * cannot say that.
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

/**
 * The pdf.js viewport scale at which a page `pageWidthPt` points wide is laid out `cssWidth`
 * CSS px wide: the text layer's `--total-scale-factor` (`textLayer` below).
 *
 * **Not** `rasterSize`'s scale. That one is a raster's, in device pixels, and it refuses to
 * upscale past ×4; a text layer is laid out in CSS px and has to sit exactly over the canvas
 * whatever the canvas was rendered at, so it takes the width it is asked for and nothing else.
 */
export function textLayerScale(pageWidthPt: number, cssWidth: number): number {
  if (!(pageWidthPt > 0) || !(cssWidth > 0)) return 1;
  return cssWidth / pageWidthPt;
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
  /**
   * The page's text runs and their geometry: what the text layer lays out (`PdfSlides.textLayer`).
   * Optional only so a test's stub page need not invent one.
   */
  getTextContent?(): Promise<unknown>;
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
    // The same bundled same-origin asset as `PdfViewer.svelte`.
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
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
  return rasterPages({ pages: pageNumbers(total), render: (page, width) => renderPage(doc, page, width) }, options);
}

/**
 * Pages to rasterise for the ingest, under the numbers main files them by. For one PDF those are
 * its own pages; for a notebook they are **notebook pages** (contract C1), and `render` is the
 * composite's, which finds the source and its local page.
 */
export interface PageRaster {
  pages: readonly number[];
  render: (page: number, width: number) => Promise<HTMLCanvasElement | null>;
}

/** `pageImages` over any page list: the same batching, yielding and skip-on-failure. */
export async function rasterPages(raster: PageRaster, options: PageImagesOptions): Promise<number> {
  const width = options.width ?? PAGE_IMAGE_WIDTH;
  const quality = options.quality ?? PAGE_IMAGE_QUALITY;
  const batchSize = options.batchSize ?? PAGE_IMAGE_BATCH;
  const total = raster.pages.length;
  const groups = batches(raster.pages, batchSize);

  let sent = 0;
  let done = 0;
  for (let g = 0; g < groups.length; g++) {
    const images: PageImage[] = [];
    for (const page of groups[g]!) {
      try {
        const canvas = await raster.render(page, width);
        const bytes = canvas ? await encodeJpeg(canvas, quality) : null;
        if (canvas && bytes) {
          images.push({ page, mime: 'image/jpeg', width: canvas.width, height: canvas.height, bytes });
        }
        // Give the backing store back straight away: 66 pages of 1024 px bitmaps held at once
        // is the 901 MB failure the UI review measured on the viewer.
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
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

// ── one PDF: cached canvases for the carousel, the modal and inline figures ─────────────────

interface CachedPage {
  canvas: HTMLCanvasElement;
  width: number;
}

/**
 * One open PDF, with a small LRU of rendered pages. Its page numbers are **the PDF's own**; the
 * notebook's composite `SlideSource` below translates to them, and nothing else should hold one.
 *
 * Kept deliberately simple: pages are rendered at the width they are asked for, and a page
 * already rendered at least that wide is reused and scaled down by `drawImage` (which is what
 * makes a thumbnail free once the modal has shown the page). A page rendered *narrower* than the
 * request is re-rendered, because upscaling a thumbnail into the modal is the one place the
 * "pixels, not a redraw" claim would visibly break.
 */
export class PdfSlides {
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

  static async open(bytes: Uint8Array): Promise<PdfSlides> {
    return new PdfSlides(await openPdf(bytes));
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
   * `Rect` define it — the same convention `sourceRect()` expects.
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

  /**
   * **The page's words, selectable, over its pixels** (the slide windows, `pm/slidewindow.ts`).
   *
   * pdf.js's own `TextLayer`: one transparent, absolutely placed span per text run, sized so a
   * selection drawn across them lands on the words the canvas shows, which is what lets a learner
   * copy a definition off a slide instead of retyping it. `container` is emptied and filled, and
   * given the CSS variables pdf.js's layout reads (`--total-scale-factor`, the `--scale-round-*`
   * steps its `round()` sizing uses); the rules that make the spans transparent and positioned
   * are the caller's stylesheet (`slidewindow.css`, copied from `pdf_viewer.css`).
   *
   * Resolves false — and leaves the container empty — when the page has no text layer to give:
   * out of range, destroyed, or a pdf.js failure. A slide with no selectable text is still a
   * slide, so nothing above this may fail for want of one.
   */
  async textLayer(page: number, container: HTMLElement, cssWidth: number): Promise<boolean> {
    if (this.#destroyed || page < 1 || page > this.pageCount) return false;
    try {
      const pdfjs = await import('pdfjs-dist');
      const proxy = await this.#doc.getPage(page);
      if (!proxy.getTextContent) return false;
      const unit = proxy.getViewport({ scale: 1 });
      const scale = textLayerScale(unit.width, cssWidth);
      // Typed loosely in `PdfPage`; it is pdf.js's own `PageViewport`, which is what `TextLayer`
      // checks for before it sizes the container.
      const viewport = proxy.getViewport({ scale }) as unknown as ConstructorParameters<
        typeof pdfjs.TextLayer
      >[0]['viewport'];
      const content = (await proxy.getTextContent()) as ConstructorParameters<
        typeof pdfjs.TextLayer
      >[0]['textContentSource'];
      if (this.#destroyed) return false;
      container.replaceChildren();
      container.style.setProperty('--scale-factor', String(scale));
      container.style.setProperty('--total-scale-factor', String(scale));
      container.style.setProperty('--scale-round-x', '1px');
      container.style.setProperty('--scale-round-y', '1px');
      await new pdfjs.TextLayer({ textContentSource: content, container, viewport }).render();
      return true;
    } catch {
      container.replaceChildren();
      return false;
    }
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

// ── the notebook's slides: one virtual deck over several sources (`notebooks.md`, C1) ───────

/**
 * What the composite needs to know of a source. `NotebookSourceView` satisfies it; the legacy
 * one-PDF path makes one up (`SlideSource.open`).
 */
export type SlidePart = Pick<
  NotebookSourceView,
  'fileId' | 'name' | 'kind' | 'pageBase' | 'pageCount' | 'enabled' | 'status'
> & {
  /** Absent on a source from before tutorials (and the one-PDF path): a lecture. */
  role?: NotebookSourceView['role'];
};

/** A source's bytes as `openDocument({ fileId })` hands them over: a PDF's or image's, or text. */
export interface SourceContent {
  bytes: Uint8Array | null;
  text: string | null;
}

export interface SlideSourceDeps {
  /** A source's content, by its file id. The renderer's is `bridge().openDocument`. */
  open: (fileId: string) => Promise<SourceContent | null>;
  /**
   * A text source's pages: `shared/paginate.ts` `paginateText`, the same function main cuts the
   * notebook pages with (contract C3), so a citation to `§2` shows the second page main read.
   */
  paginate: (text: string) => string[];
}

/** A text page's card, in the same units `size()` reports a PDF page in: a portrait sheet. */
export const TEXT_CARD = { width: 600, height: 800 } as const;

/** One source, once its content has arrived. */
type Loaded =
  | { kind: 'pdf'; pdf: PdfSlides }
  | { kind: 'text'; pages: string[] }
  | { kind: 'image'; image: CanvasImageSource; width: number; height: number }
  | { kind: 'none' };

/** The notebook page's source and its own page, or null for a gap. `locatePage`, typed for parts. */
export function locatePart(parts: readonly SlidePart[], page: number): { part: SlidePart; localPage: number } | null {
  const hit = locatePage(parts, page);
  return hit ? { part: hit.source, localPage: hit.localPage } : null;
}

/** Every notebook page that names a slide still there, ascending: the gaps left out. */
export function partPages(parts: readonly SlidePart[]): number[] {
  return parts.flatMap((part) => pagesOfSource(part)).sort((a, b) => a - b);
}

/**
 * The next page `delta` away that is not in a gap, or null at either end. The modal's Next and
 * Previous: a removed source's pages are skipped rather than shown as a blank sheet.
 */
export function stepPage(parts: readonly SlidePart[], page: number, delta: number): number | null {
  const all = partPages(parts);
  if (all.length === 0) return null;
  const at = all.indexOf(page);
  if (at < 0) {
    // From a gap: the nearest page in the direction asked.
    const next = delta > 0 ? all.find((p) => p > page) : [...all].reverse().find((p) => p < page);
    return next ?? null;
  }
  return all[at + delta] ?? null;
}

/**
 * The words for one page, where a whole slide is named (the modal's bar, the preview's head, a
 * thumbnail's label). One source: `Slide 3`, as it always read. Several: `Lecture-complex p. 3`,
 * `Notes §2`, or an image's name. A page in a gap is `A removed source`.
 */
export function pageTitle(parts: readonly SlidePart[], page: number): string {
  const hit = locatePart(parts, page);
  if (!hit) return 'A removed source';
  const { part, localPage } = hit;
  if (parts.length <= 1) {
    if (part.kind === 'text') return `Part ${String(localPage)}`;
    if (part.kind === 'image') return shortSourceName(part.name, 40);
    return `Slide ${String(localPage)}`;
  }
  const name = shortSourceName(part.name, 28);
  if (part.kind === 'image') return name;
  return part.kind === 'text' ? `${name} §${String(localPage)}` : `${name} p. ${String(localPage)}`;
}

/**
 * The pages the ingest is shown as images: ticked, ready PDF and image sources (text it reads),
 * and **lecture** ones only (tutorials S1): a tutorial's pages are sent when the sheet is read,
 * and a solutions source's never.
 */
export function ingestPages(parts: readonly SlidePart[], only?: (part: SlidePart) => boolean): number[] {
  return parts
    .filter((p) => p.enabled && p.status === 'ready' && p.kind !== 'text' && (p.role ?? 'lecture') === 'lecture' && (!only || only(p)))
    .flatMap((part) => pagesOfSource(part))
    .sort((a, b) => a - b);
}

/**
 * Lay words into lines no wider than `maxWidth`, by a measuring function (a canvas's
 * `measureText` in the app, a character count in the tests). A word wider than a line gets a
 * line to itself rather than being cut.
 */
export function wrapWords(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * A text page drawn as a card, for the places that can only show a picture of a page: the
 * carousel's thumbnails, an inline figure, the page images. The modal and the preview show the
 * text itself (`SlideSource.text`), which can be read and selected.
 */
function drawTextCard(title: string, body: string, width: number): HTMLCanvasElement {
  const w = Math.max(60, Math.round(width));
  const scale = w / TEXT_CARD.width;
  const h = Math.round(TEXT_CARD.height * scale);
  const canvas = makeCanvas(w, h);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, w, h);
  const pad = 40 * scale;
  context.fillStyle = '#6b6b80';
  context.font = `600 ${String(18 * scale)}px -apple-system, system-ui, sans-serif`;
  context.fillText(title, pad, pad + 14 * scale, w - pad * 2);
  context.fillStyle = '#1d1d2c';
  const size = 17 * scale;
  context.font = `${String(size)}px -apple-system, system-ui, sans-serif`;
  const lineHeight = size * 1.45;
  const lines = wrapWords(body, w - pad * 2, (s) => context.measureText(s).width);
  let y = pad + 56 * scale;
  for (const line of lines) {
    if (y > h - pad) break;
    context.fillText(line, pad, y);
    y += lineHeight;
  }
  return canvas;
}

/** An image's bytes as something `drawImage` takes. Null when the bytes are not an image. */
async function decodeImage(bytes: Uint8Array): Promise<{ image: CanvasImageSource; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

/**
 * **The notebook's slides, as one deck** (contract C1). Everything that shows a page — the chip's
 * preview, the slide modal, the carousel, the inline figures, and the page images for the ingest —
 * asks this for a **notebook page**, and only this translates: `locatePage` finds the source and
 * its local page, and the source's own content is opened the first time one of its pages is
 * asked for (a PDF's pages through `PdfSlides`, a text source's page as a card, an image as
 * itself). The surface is the one the single-PDF `SlideSource` had, so the code that draws pages
 * did not change when the deck became several files.
 *
 * Sources are swapped in with `setSources` as the notebook changes (a source added, ticked,
 * removed); what was already opened is kept for the sources still there. A removed source's
 * pages are a gap: `canvas` gives null, and `pageTitle` says the source is gone.
 */
export class SlideSource {
  #parts: SlidePart[] = [];
  #deps: SlideSourceDeps | null;
  #loading = new Map<string, Promise<Loaded>>();
  #loaded = new Map<string, Loaded>();
  /** Text cards and image renders, keyed `page:width`. A handful, so no LRU beyond a cap. */
  #drawn = new Map<string, HTMLCanvasElement>();
  #destroyed = false;

  constructor(parts: readonly SlidePart[], deps: SlideSourceDeps | null) {
    this.#parts = [...parts];
    this.#deps = deps;
  }

  /**
   * **One PDF, as a deck of one source.** The path for a file that is not in a notebook (the dev
   * harness, a pre-notebook build) and the shape everything was written against: the notebook
   * page is the PDF page, and the labels read `Slide 3` / `p. 3` as they always did.
   */
  static async open(bytes: Uint8Array): Promise<SlideSource> {
    const pdf = await PdfSlides.open(bytes);
    const part: SlidePart = {
      fileId: '',
      name: 'Slides.pdf',
      kind: 'pdf',
      pageBase: 0,
      pageCount: pdf.pageCount,
      enabled: true,
      status: 'ready',
    };
    const source = new SlideSource([part], null);
    source.#loaded.set('', { kind: 'pdf', pdf });
    return source;
  }

  /** The notebook pages in use, gaps included: the highest page any source still has. */
  get pageCount(): number {
    return virtualPageCount(this.#parts);
  }

  get parts(): readonly SlidePart[] {
    return this.#parts;
  }

  /** The notebook changed. Content already opened is kept for every source still in it. */
  setSources(parts: readonly SlidePart[]): void {
    this.#parts = [...parts];
    const keep = new Set(parts.map((p) => p.fileId));
    for (const [fileId, loaded] of this.#loaded) {
      if (keep.has(fileId)) continue;
      if (loaded.kind === 'pdf') loaded.pdf.destroy();
      this.#loaded.delete(fileId);
      this.#loading.delete(fileId);
    }
    this.#drawn.clear();
  }

  pages(): number[] {
    return partPages(this.#parts);
  }

  locate(page: number): { part: SlidePart; localPage: number } | null {
    return locatePart(this.#parts, page);
  }

  title(page: number): string {
    return pageTitle(this.#parts, page);
  }

  /**
   * A chip's words for these notebook pages (`citationLabel`). With no sources known yet (the
   * notebook view has not arrived) the plain `p. 3–4`, rather than calling every page removed.
   */
  citation(pages: readonly number[]): string {
    if (this.#parts.length === 0) return pages.length > 0 ? `p. ${pageRanges(pages)}` : '';
    return citationLabel(this.#parts, pages);
  }

  step(page: number, delta: number): number | null {
    return stepPage(this.#parts, page, delta);
  }

  kindOf(page: number): SourceKind | null {
    return this.locate(page)?.part.kind ?? null;
  }

  /** A text source's page, as text. Null for a page of any other kind, or a text not readable. */
  async text(page: number): Promise<string | null> {
    const hit = this.locate(page);
    if (!hit || hit.part.kind !== 'text') return null;
    const loaded = await this.#load(hit.part);
    return loaded.kind === 'text' ? (loaded.pages[hit.localPage - 1] ?? null) : null;
  }

  /** The page's box in points (a PDF), pixels (an image) or the card's units. Null until measured. */
  size(page: number): { width: number; height: number } | null {
    const hit = this.locate(page);
    if (!hit) return null;
    if (hit.part.kind === 'text') return { ...TEXT_CARD };
    const loaded = this.#loaded.get(hit.part.fileId);
    if (!loaded) return null;
    if (loaded.kind === 'pdf') return loaded.pdf.size(hit.localPage);
    if (loaded.kind === 'image') return { width: loaded.width, height: loaded.height };
    return null;
  }

  async measure(page: number): Promise<{ width: number; height: number }> {
    const hit = this.locate(page);
    if (!hit) return { ...TEXT_CARD };
    const loaded = await this.#load(hit.part);
    if (loaded.kind === 'pdf') return loaded.pdf.measure(hit.localPage);
    if (loaded.kind === 'image') return { width: loaded.width, height: loaded.height };
    return { ...TEXT_CARD };
  }

  /** The page at (at least) `width` px across, or null (a gap, or a source that would not open). */
  async canvas(page: number, width: number): Promise<HTMLCanvasElement | null> {
    if (this.#destroyed) return null;
    const hit = this.locate(page);
    if (!hit) return null;
    const loaded = await this.#load(hit.part);
    if (this.#destroyed) return null;
    if (loaded.kind === 'pdf') return loaded.pdf.canvas(hit.localPage, width);
    const key = `${String(page)}:${String(Math.round(width))}`;
    const cached = this.#drawn.get(key);
    if (cached) return cached;
    let drawn: HTMLCanvasElement | null = null;
    if (loaded.kind === 'text') {
      drawn = drawTextCard(this.title(page), loaded.pages[hit.localPage - 1] ?? '', width);
    } else if (loaded.kind === 'image') {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round((w * loaded.height) / Math.max(1, loaded.width)));
      drawn = makeCanvas(w, h);
      drawn.getContext('2d')?.drawImage(loaded.image, 0, 0, w, h);
    }
    if (!drawn) return null;
    if (this.#drawn.size >= SLIDE_CACHE) {
      const oldest = this.#drawn.keys().next();
      if (!oldest.done) this.#drawn.delete(oldest.value);
    }
    this.#drawn.set(key, drawn);
    return drawn;
  }

  /** A crop of the page, as its own canvas. See `PdfSlides.crop`; the same arithmetic over any kind. */
  async crop(page: number, rect: Rect | null, width: number, dpr = 1): Promise<HTMLCanvasElement | null> {
    const hit = this.locate(page);
    if (!hit) return null;
    const loaded = await this.#load(hit.part);
    if (loaded.kind === 'pdf') return loaded.pdf.crop(hit.localPage, rect, width, dpr);
    const box = rect ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    const span = Math.max(0.02, box.x1 - box.x0);
    const source = await this.canvas(page, Math.min(4096, Math.ceil((width * dpr) / span)));
    if (!source) return null;
    const css = cropBox(rect, await this.measure(page), width);
    const out = makeCanvas(Math.round(css.w * dpr), Math.round(css.h * dpr));
    const context = out.getContext('2d');
    if (!context) return null;
    const src = sourceRect(box, { width: source.width, height: source.height });
    context.drawImage(source, src.sx, src.sy, src.sw, src.sh, 0, 0, out.width, out.height);
    out.style.width = `${String(css.w)}px`;
    out.style.height = `${String(css.h)}px`;
    return out;
  }

  /**
   * The page's selectable text layer, laid out `cssWidth` CSS px wide into `container`. See
   * `PdfSlides.textLayer`; the notebook page is translated here, as `canvas()` does. False for
   * any page that is not a PDF's: a text source's page is shown as its words already, and an
   * image has no words to select.
   */
  async textLayer(page: number, container: HTMLElement, cssWidth: number): Promise<boolean> {
    if (this.#destroyed) return false;
    const hit = this.locate(page);
    if (!hit) return false;
    const loaded = await this.#load(hit.part);
    if (this.#destroyed || loaded.kind !== 'pdf') return false;
    return loaded.pdf.textLayer(hit.localPage, container, cssWidth);
  }

  /**
   * The page images the ingest is shown (contract C1: under **notebook** page numbers): every
   * page of the ticked, ready PDF and image sources, or of those `only` lets through (the sources
   * an Update overview has not seen). Text sources are left out: main reads their text.
   */
  ingestRaster(only?: (part: SlidePart) => boolean): PageRaster {
    return {
      pages: ingestPages(this.#parts, only),
      render: async (page, width) => {
        const hit = this.locate(page);
        if (!hit) return null;
        const loaded = await this.#load(hit.part);
        if (loaded.kind === 'pdf') return renderPage(loaded.pdf.pdfDoc, hit.localPage, width);
        if (loaded.kind !== 'image') return null;
        // A fresh canvas, never the cached one: `rasterPages` zeroes what it is given.
        const w = Math.max(1, Math.min(Math.round(width), loaded.width));
        const h = Math.max(1, Math.round((w * loaded.height) / Math.max(1, loaded.width)));
        const out = makeCanvas(w, h);
        out.getContext('2d')?.drawImage(loaded.image, 0, 0, w, h);
        return out;
      },
    };
  }

  destroy(): void {
    this.#destroyed = true;
    for (const loaded of this.#loaded.values()) {
      if (loaded.kind === 'pdf') loaded.pdf.destroy();
      if (loaded.kind === 'image' && 'close' in loaded.image) (loaded.image as ImageBitmap).close();
    }
    this.#loaded.clear();
    this.#loading.clear();
    this.#drawn.clear();
  }

  /** Open a source's content once. A failure is remembered as `none`: a degraded page, not an error. */
  #load(part: SlidePart): Promise<Loaded> {
    const done = this.#loaded.get(part.fileId);
    if (done) return Promise.resolve(done);
    const pending = this.#loading.get(part.fileId);
    if (pending) return pending;
    const deps = this.#deps;
    const job = (async (): Promise<Loaded> => {
      let loaded: Loaded = { kind: 'none' };
      try {
        const content = deps ? await deps.open(part.fileId) : null;
        if (content && part.kind === 'pdf' && content.bytes) {
          loaded = { kind: 'pdf', pdf: await PdfSlides.open(content.bytes) };
        } else if (content && part.kind === 'text' && content.text !== null && deps) {
          loaded = { kind: 'text', pages: deps.paginate(content.text) };
        } else if (content && part.kind === 'image' && content.bytes) {
          const image = await decodeImage(content.bytes);
          if (image) loaded = { kind: 'image', ...image };
        }
      } catch {
        loaded = { kind: 'none' };
      }
      if (this.#destroyed) {
        if (loaded.kind === 'pdf') loaded.pdf.destroy();
        return { kind: 'none' };
      }
      // Only kept if the source is still in the notebook: `setSources` may have dropped it.
      if (this.#parts.some((p) => p.fileId === part.fileId)) this.#loaded.set(part.fileId, loaded);
      this.#loading.delete(part.fileId);
      return loaded;
    })();
    this.#loading.set(part.fileId, job);
    return job;
  }
}
