/**
 * Stage 1 — page geometry, from pdf.js (`pdf-fidelity-segmentation.md` §B1.1, §B1.3, §B1.4).
 *
 * This is the **only** module in the segmentation path that knows pdf.js exists. It turns a
 * PDF into `PageGeometry[]` — normalised boxes and nothing else — and everything downstream
 * (`src/shared/segment/`) is pure arithmetic over that. It lives in `src/main` for the same
 * reason `vault/pdf.ts` does: the portable half of the app must not import a PDF parser.
 *
 * Three things here are load-bearing and were each worth a debugging hour in §B1:
 *
 *  - **`TextItem.height` is the font size, not the glyph height**, so the box is
 *    `[f - 0.25·h, f + h]` around the baseline. Crude on purpose — we are cutting *between*
 *    lines, not tracing glyphs.
 *  - **Zero-width items with `hasEOL: true` exist** and must be skipped, not given a box.
 *  - **`constructPath`'s min/max box is a `Float32Array(4)`**, so `Array.isArray()` is `false`
 *    on it. Read it by index.
 *
 * Every number that leaves here is normalised 0–1 with **y down from the page top**, through
 * `viewport.convertToViewportPoint`, which also absorbs `/Rotate`. `convertToViewportRectangle`
 * was removed in pdf.js v6 (§B1.2) — convert two corners and take the min/max.
 */
import { readFile } from 'node:fs/promises';
import {
  CONTAINER_TEXT_SHARE,
  type InkBox,
  type PageGeometry,
  type StructRole,
  type TextBox,
} from '../../shared/segment/types.js';
import { docOptions, loadPdfjs, type PdfjsModule } from './pdf.js';

/** Ink smaller than this in either dimension is a rule or a fraction bar, not a figure (§B1.3). */
const MIN_INK_PT = 3;
/** Ink covering more than this share of the page is a background or a clip rect. */
const MAX_INK_AREA = 0.95;
/** Ink boxes closer than this are one figure (§B1.3's own 8 pt merge). */
const INK_MERGE_PT = 2;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

interface Viewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): [number, number];
}

interface TextContentItem {
  str?: string;
  width?: number;
  height?: number;
  fontName?: string;
  transform?: number[];
  hasEOL?: boolean;
  type?: string;
  id?: string;
}

interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

interface StructNode {
  role?: string;
  type?: string;
  id?: string;
  children?: StructNode[];
}

interface GeometryPage {
  getViewport(opts: { scale: number }): Viewport;
  getTextContent(opts?: Record<string, unknown>): Promise<{ items: TextContentItem[] }>;
  getOperatorList(opts?: Record<string, unknown>): Promise<OperatorList>;
  getStructTree?(): Promise<StructNode | null>;
  cleanup(): void;
}

interface GeometryDocument {
  numPages: number;
  getPage(n: number): Promise<GeometryPage>;
  cleanup(): Promise<void>;
}

interface GeometryModule extends PdfjsModule {
  OPS: Record<string, number>;
  getDocument(src: Record<string, unknown>): {
    promise: Promise<GeometryDocument>;
    destroy(): Promise<void>;
  };
}

/** Both corners through the viewport, then normalised — §B1.2's replacement for the removed API. */
function normalise(vp: Viewport, x0: number, y0: number, x1: number, y1: number) {
  const a = vp.convertToViewportPoint(x0, y0);
  const b = vp.convertToViewportPoint(x1, y1);
  return {
    x0: Math.min(a[0], b[0]) / vp.width,
    y0: Math.min(a[1], b[1]) / vp.height,
    x1: Math.max(a[0], b[0]) / vp.width,
    y1: Math.max(a[1], b[1]) / vp.height,
  };
}

function clipBox<T extends { x0: number; y0: number; x1: number; y1: number }>(b: T): T {
  return {
    ...b,
    x0: Math.max(0, Math.min(1, b.x0)),
    y0: Math.max(0, Math.min(1, b.y0)),
    x1: Math.max(0, Math.min(1, b.x1)),
    y1: Math.max(0, Math.min(1, b.y1)),
  };
}

/** Marked-content id → the text boxes emitted while it was open (§B1.4's correlation step). */
interface TextResult {
  boxes: TextBox[];
  byMcid: Map<string, number[]>;
}

function textBoxes(items: TextContentItem[], vp: Viewport): TextResult {
  const boxes: TextBox[] = [];
  const byMcid = new Map<string, number[]>();
  const stack: string[] = [];

  for (const item of items) {
    if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') {
      stack.push(typeof item.id === 'string' ? item.id : '');
      continue;
    }
    if (item.type === 'endMarkedContent') {
      stack.pop();
      continue;
    }
    if (typeof item.str !== 'string') continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const w = item.width ?? 0;
    // §B1.1 warning 2: zero-width `hasEOL` items carry no ink and must not become boxes.
    if (!(w > 0) || item.str.trim() === '') continue;

    const fontPt = item.height && item.height > 0 ? item.height : Math.abs(t[3] ?? 0);
    const e = t[4] ?? 0;
    const f = t[5] ?? 0;
    const box = clipBox({
      ...normalise(vp, e, f - fontPt * 0.25, e + w, f + fontPt),
      text: item.str,
      fontPt,
      fontName: typeof item.fontName === 'string' ? item.fontName : '',
    });
    const index = boxes.push(box) - 1;
    const mcid = stack[stack.length - 1];
    if (mcid) {
      const list = byMcid.get(mcid);
      if (list) list.push(index);
      else byMcid.set(mcid, [index]);
    }
  }
  return { boxes, byMcid };
}

/**
 * §B1.3 Method 1 — walk the operator list, maintaining a CTM stack, and take a box from each
 * painted path and image XObject. Method 2 (`recordOperations` on `page.render()`) is strictly
 * better but needs a real canvas, so it belongs in the renderer; this runs anywhere.
 */
function inkBoxes(ops: OperatorList, OPS: Record<string, number>, vp: Viewport) {
  const raw: InkBox[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let imageCount = 0;

  const push = (kind: InkBox['kind'], x0: number, y0: number, x1: number, y1: number): void => {
    const c0 = apply(ctm, x0, y0);
    const c1 = apply(ctm, x1, y1);
    const c2 = apply(ctm, x0, y1);
    const c3 = apply(ctm, x1, y0);
    const ux0 = Math.min(c0[0], c1[0], c2[0], c3[0]);
    const ux1 = Math.max(c0[0], c1[0], c2[0], c3[0]);
    const uy0 = Math.min(c0[1], c1[1], c2[1], c3[1]);
    const uy1 = Math.max(c0[1], c1[1], c2[1], c3[1]);
    raw.push(clipBox({ kind, ...normalise(vp, ux0, uy0, ux1, uy1) }));
  };

  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, args as unknown as Matrix);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = (args as unknown[])[0];
      if (Array.isArray(m) && m.length === 6) ctm = mul(ctm, m as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.constructPath) {
      // §B1.3: in v6 the third argument is a Float32Array(4) min/max box in path space.
      // `Array.isArray()` on it is false, which is the debugging cycle the brief warns about.
      const minMax = (args as unknown[])[2] as ArrayLike<number> | undefined;
      if (minMax && minMax.length >= 4) push('path', minMax[0]!, minMax[1]!, minMax[2]!, minMax[3]!);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintJpegXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      imageCount += 1;
      // An image is always painted into the unit square, transformed by the CTM.
      push('image', 0, 0, 1, 1);
    }
  }
  return { raw, imageCount };
}

/** Drop rules, backgrounds and duplicates; union-merge what is left within 8 pt (§B1.3). */
function mergeInk(raw: InkBox[], widthPt: number, heightPt: number): InkBox[] {
  const gx = INK_MERGE_PT / widthPt;
  const gy = INK_MERGE_PT / heightPt;
  const kept = raw.filter((b) => {
    const w = (b.x1 - b.x0) * widthPt;
    const h = (b.y1 - b.y0) * heightPt;
    if (w < MIN_INK_PT || h < MIN_INK_PT) return false;
    return (b.x1 - b.x0) * (b.y1 - b.y0) < MAX_INK_AREA;
  });

  const out: InkBox[] = [];
  for (const b of kept) {
    let merged = false;
    for (let i = 0; i < out.length; i += 1) {
      const o = out[i]!;
      const near =
        b.x0 < o.x1 + gx && o.x0 < b.x1 + gx && b.y0 < o.y1 + gy && o.y0 < b.y1 + gy;
      if (near) {
        out[i] = {
          kind: o.kind === 'image' || b.kind === 'image' ? 'image' : 'path',
          x0: Math.min(o.x0, b.x0),
          y0: Math.min(o.y0, b.y0),
          x1: Math.max(o.x1, b.x1),
          y1: Math.max(o.y1, b.y1),
        };
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...b });
  }
  // One pass is not a fixed point: merging A into B can bring B within reach of C.
  return out.length === kept.length ? out : mergeInk(out, widthPt, heightPt);
}

/**
 * Reclassify the ink that is *behind* text as a container rather than a figure.
 *
 * See `InkBox` in `shared/segment/types.ts` for the measurement this threshold comes from. It
 * is done here, not in Stage 3, because it needs both box sets at once and the answer is a
 * property of the page, not of a cut.
 */
function classifyInk(boxes: InkBox[], text: TextBox[]): InkBox[] {
  if (text.length === 0) return boxes;
  return boxes.map((b) => {
    const inside = text.filter(
      (t) =>
        (t.x0 + t.x1) / 2 >= b.x0 &&
        (t.x0 + t.x1) / 2 <= b.x1 &&
        (t.y0 + t.y1) / 2 >= b.y0 &&
        (t.y0 + t.y1) / 2 <= b.y1,
    ).length;
    return inside / text.length >= CONTAINER_TEXT_SHARE ? { ...b, kind: 'container' as const } : b;
  });
}

/** §B1.4 — roles for free on tagged (PowerPoint/Keynote) exports, absent on Beamer. */
function structRoles(tree: StructNode | null, byMcid: Map<string, number[]>): StructRole[] {
  if (!tree) return [];
  const out: StructRole[] = [];
  const walk = (node: StructNode, role: string | undefined): void => {
    const here = typeof node.role === 'string' ? node.role : role;
    if (node.type === 'content' && typeof node.id === 'string' && here) {
      for (const box of byMcid.get(node.id) ?? []) out.push({ box, role: here });
    }
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(tree, undefined);
  return out;
}

export interface GeometryOptions {
  /** 1-indexed inclusive. Omit for the whole document. */
  range?: { from: number; to: number };
}

/**
 * Read one PDF into `PageGeometry[]`. `chrome` comes back all-`false`: it is a document-level
 * judgement and Stage 2 (`shared/segment/chrome.ts`) fills it in.
 *
 * A page that throws — a damaged stream, a font pdf.js will not touch — yields an *empty*
 * geometry rather than failing the document, exactly as `extractPdfText` does. A deck must open.
 */
export async function extractPageGeometry(
  filePath: string,
  opts: GeometryOptions = {},
): Promise<PageGeometry[]> {
  const pdfjs = (await loadPdfjs()) as GeometryModule;
  const bytes = new Uint8Array(await readFile(filePath));
  const task = pdfjs.getDocument(docOptions(bytes, pdfjs));

  let doc: GeometryDocument | undefined;
  try {
    doc = await task.promise;
    const from = Math.max(1, opts.range?.from ?? 1);
    const to = Math.min(doc.numPages, opts.range?.to ?? doc.numPages);
    const pages: PageGeometry[] = [];

    for (let n = from; n <= to; n += 1) {
      let page: GeometryPage | undefined;
      try {
        const p = (page = await doc.getPage(n));
        const vp = p.getViewport({ scale: 1 });
        const content = await p.getTextContent({
          includeMarkedContent: true,
          disableNormalization: false,
        });
        const { boxes, byMcid } = textBoxes(content.items, vp);
        const ops = await p.getOperatorList().catch(() => ({ fnArray: [], argsArray: [] }));
        const { raw, imageCount } = inkBoxes(ops, pdfjs.OPS, vp);
        const tree = p.getStructTree ? await p.getStructTree().catch(() => null) : null;

        pages.push({
          page: n,
          width: vp.width,
          height: vp.height,
          textBoxes: boxes,
          inkBoxes: classifyInk(mergeInk(raw, vp.width, vp.height), boxes),
          chrome: boxes.map(() => false),
          struct: structRoles(tree, byMcid),
          imageCount,
        });
      } catch {
        pages.push({
          page: n,
          width: 0,
          height: 0,
          textBoxes: [],
          inkBoxes: [],
          chrome: [],
          imageCount: 0,
        });
      } finally {
        page?.cleanup();
      }
    }
    return pages;
  } finally {
    if (doc) await doc.cleanup().catch(() => undefined);
    await task.destroy().catch(() => undefined);
  }
}
