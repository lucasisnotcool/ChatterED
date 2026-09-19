/**
 * **One pdf.js pass per deck, shared** (#48).
 *
 * `extractPageGeometry` is the expensive half of every path that reads a PDF: the segmentation
 * pipeline wants it, and so does the notes ingest's pass 1. On the 66-page demo deck it is
 * several seconds of parsing, and paying for it twice because two callers asked separately is
 * the kind of cost nobody sees until the app is on a projector.
 *
 * So: a module-level cache keyed on **`content_sha`**, not on a file id or a path. The bytes are
 * what the geometry is a property of (`file_segmentations`, migration 009, says the same thing
 * about a segmentation), so a rescan that re-mints `files.id` (#39), a file moved between
 * folders and the same deck opened from two topics all hit one entry.
 *
 * Two details that are load-bearing:
 *
 *  - **In-flight calls are shared, not repeated.** The notes ingest and the objective ingest are
 *    fired from the same click. Without the promise cache they would both be inside pdf.js at
 *    once, which is two parses *and* two copies of a 66-page deck in memory.
 *  - **The cached pages are the kept, chrome-marked ones** — `segmentDocument().pages`, exactly
 *    what `vault/segments.ts` caches — not the raw extractor output. Stage 0 (build groups) and
 *    Stage 2 (chrome) are part of "what a page is" in this app: a deck that animates one slide
 *    in four steps is one slide, and a footer that repeats on every page is not content. The
 *    notes ingest wants that judgement, not a fourth copy of it.
 *
 * `PageGeometry.page` survives the build-group merge, so the page numbers in here are always the
 * source PDF's own — which is what block provenance and a figure's `page` mean.
 */
import type { PageGeometry } from '../../shared/segment/types.js';
import { segmentDocument } from '../../shared/segment/pipeline.js';
import { extractPageGeometry } from './geometry.js';

/**
 * How many decks are held. Small on purpose: this is tens of megabytes per entry on a long deck,
 * and a learner works through one document at a time. `vault/segments.ts` holds 4 for the same
 * reason; this is the same number for the same reason.
 */
export const PAGE_CACHE_SIZE = 4;

const cache = new Map<string, PageGeometry[]>();
const inFlight = new Map<string, Promise<PageGeometry[]>>();

/** Injectable for tests: nothing in this repo's tests runs pdf.js over a real deck. */
export type GeometryExtractor = (filePath: string) => Promise<PageGeometry[]>;

const realExtractor: GeometryExtractor = (filePath) => extractPageGeometry(filePath);

/**
 * The geometry for one deck, parsed at most once.
 *
 * `filePath` is only used on a miss — two callers with the same `contentSha` and different paths
 * (the same bytes in two folders) share the entry, which is the point of keying on the bytes.
 */
export async function pageGeometry(
  input: { filePath: string; contentSha: string },
  extractor: GeometryExtractor = realExtractor,
): Promise<PageGeometry[]> {
  const hit = cache.get(input.contentSha);
  if (hit) {
    // Re-insert so the LRU order reflects use, not first parse.
    cache.delete(input.contentSha);
    cache.set(input.contentSha, hit);
    return hit;
  }
  const pending = inFlight.get(input.contentSha);
  if (pending) return pending;

  const run = (async () => {
    const raw = await extractor(input.filePath);
    // The kept, chrome-marked pages — see the header.
    const pages = segmentDocument(raw).pages;
    cache.set(input.contentSha, pages);
    while (cache.size > PAGE_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return pages;
  })();

  inFlight.set(input.contentSha, run);
  try {
    return await run;
  } finally {
    inFlight.delete(input.contentSha);
  }
}

/**
 * Put geometry a caller already has into the cache — `vault/segments.ts` parses the same deck on
 * its own path and this is how that work is donated rather than repeated. Tests use it to avoid
 * pdf.js entirely.
 */
export function primePageGeometry(contentSha: string, pages: PageGeometry[]): void {
  cache.set(contentSha, pages);
  while (cache.size > PAGE_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Tests only. The app has exactly one cache for its whole life. */
export function clearPageCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Tests and the debug drawer: which decks are held, in LRU order. */
export function pageCacheKeys(): string[] {
  return [...cache.keys()];
}
