/**
 * **`notes:pageLines`: one slide's own text, with its boxes** (#48, §3).
 *
 * The provenance chip's preview and an inline figure's hotspots both need to know *where on the
 * page* the words are. That is exactly what pass 1 of the ingest already computes, so this is
 * pass 1 read again and not a second extractor: the geometry comes from the shared page cache
 * (`vault/pagecache.ts`, one pdf.js parse per deck) and the lines from `extract.ts`'s
 * `pageLines`, the same function the refine prompt was built from. What the chip outlines is
 * therefore the text the notes were written from, chrome already dropped.
 *
 * Nothing here is stored. The geometry is not persisted by the ingest either (it lives in the
 * page cache, keyed on the bytes), so on a cold start the first call for a deck re-parses it
 * once and every later page is a lookup.
 */
import type { PageGeometry, Box } from '../../shared/segment/types.js';
import type { LineRect, PageLinesView } from '../../shared/doc/cite.js';
import { IPC } from '../../shared/ipc.js';
import type { DocHost, IpcHandle } from '../dochost.js';
import { pageGeometry, type GeometryExtractor } from '../vault/pagecache.js';
import { pageLines } from './extract.js';

/** Pages held, across decks. One entry is a few kilobytes; a learner hovers a handful per sitting. */
export const PAGE_LINES_CACHE = 256;

const cache = new Map<string, PageLinesView>();

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function rectOf(box: Box): LineRect {
  return { x: round4(box.x0), y: round4(box.y0), w: round4(box.x1 - box.x0), h: round4(box.y1 - box.y0) };
}

/**
 * One page of a deck's geometry, as the renderer reads it. Pure.
 *
 * A page that is not in the geometry (a build step merged into its slide, or a number past the
 * end) comes back empty rather than throwing: the preview then shows the whole page with no
 * outline, which is the same thing it does when nothing matches.
 */
export function pageLinesView(pages: readonly PageGeometry[], page: number): PageLinesView {
  const geometry = pages.find((p) => p.page === page);
  if (!geometry) return { page, width: 0, height: 0, lines: [], items: [] };
  return {
    page,
    width: geometry.width,
    height: geometry.height,
    lines: pageLines(geometry).map((line) => ({ text: line.text, rect: rectOf(line.box) })),
    // The raw items, chrome dropped as `pageLines` drops it. The text is verbatim: a trailing
    // space is how `hotspotsIn` knows two touching runs are two words.
    items: geometry.textBoxes
      .filter((box, i) => geometry.chrome[i] !== true && box.text.trim() !== '')
      .map((box) => ({ text: box.text, rect: rectOf(box) })),
  };
}

/** The lines of one page of one deck, cached per bytes and page. */
export async function pageLinesFor(
  input: { filePath: string; contentSha: string; page: number },
  extractor?: GeometryExtractor,
): Promise<PageLinesView> {
  const key = `${input.contentSha}:${String(input.page)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const view = pageLinesView(await pageGeometry(input, extractor), input.page);
  cache.set(key, view);
  while (cache.size > PAGE_LINES_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return view;
}

/** Tests only. */
export function clearPageLinesCache(): void {
  cache.clear();
}

export function registerPageLinesIpc(host: DocHost, handle: IpcHandle): void {
  handle<{ fileId: string; page: number }>(IPC.notesPageLines, async ({ fileId, page }) => {
    const { contentSha } = await host.fileBytesKey(fileId);
    return pageLinesFor({ filePath: host.vault.sourcePath(fileId), contentSha, page });
  });
}
