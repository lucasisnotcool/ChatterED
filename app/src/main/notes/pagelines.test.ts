/**
 * `notes:pageLines` against the committed fixture deck, and the cache in front of it.
 *
 * Same fixture as `extract.test.ts`, and the point is the same one: what the chip outlines is
 * pass 1's own lines, not a second reading of the PDF.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { extractPageGeometry } from '../vault/geometry.js';
import { clearPageCache, primePageGeometry } from '../vault/pagecache.js';
import { segmentDocument } from '../../shared/segment/index.js';
import type { PageGeometry } from '../../shared/segment/types.js';
import { bestRegion, hotspotsIn } from '../../shared/doc/cite.js';
import { pageLines } from './extract.js';
import { clearPageLinesCache, pageLinesFor, pageLinesView } from './pagelines.js';

const FIXTURE = resolve(
  __dirname,
  '../../../../Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf',
);

let cached: PageGeometry[] | null = null;
async function fixturePages(): Promise<PageGeometry[]> {
  if (!cached) cached = segmentDocument(await extractPageGeometry(FIXTURE)).pages;
  return cached;
}

beforeEach(() => {
  clearPageCache();
  clearPageLinesCache();
});

describe('pageLinesView', () => {
  it('is pass 1\'s lines, with boxes normalised to the page', async () => {
    const pages = await fixturePages();
    const view = pageLinesView(pages, 4);
    expect(view.page).toBe(4);
    expect(view.width).toBeGreaterThan(0);
    expect(view.height).toBeGreaterThan(0);
    expect(view.lines.map((l) => l.text)).toEqual(pageLines(pages.find((p) => p.page === 4)!).map((l) => l.text));
    for (const { rect } of [...view.lines, ...view.items]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1.0001);
      expect(rect.y + rect.h).toBeLessThanOrEqual(1.0001);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  }, 60_000);

  it('gives an empty page for a page that is not in the deck', async () => {
    expect(pageLinesView(await fixturePages(), 99)).toEqual({ page: 99, width: 0, height: 0, lines: [], items: [] });
  }, 60_000);

  it('feeds the matcher: a paraphrase of the slide finds its lines, on the right of the page', async () => {
    const view = pageLinesView(await fixturePages(), 4);
    const region = bestRegion(
      'Silent whispering is interactive, so anyone can engage at any moment, polychronic, holding a ' +
        'conversation in parallel, and ephemeral: remarks are tentative.',
      view.lines,
    );
    expect(region?.quote).toContain('Polychronic');
    // That list is the slide's right-hand column, in its upper half.
    expect(region!.rect.x).toBeGreaterThan(0.5);
    expect(region!.rect.y + region!.rect.h).toBeLessThan(0.55);
  }, 60_000);

  it('feeds the hotspots: the items keep a diagram\'s labels apart where the lines run them together', async () => {
    const view = pageLinesView(await fixturePages(), 3);
    // Two speech bubbles share a baseline, so pass 1's line holds both.
    expect(view.lines.some((l) => l.text.includes('I think“Is there'))).toBe(true);
    const labels = hotspotsIn(view.items, null, view.width / view.height).map((h) => h.label);
    expect(labels).toContain('HUMAN-HUMAN COLLABORATION');
    expect(labels).toContain('“Sorry, I think');
    expect(labels).toContain('“Is there something');
  }, 60_000);
});

describe('pageLinesFor', () => {
  it('reads the shared page cache and parses nothing when the deck is already there', async () => {
    primePageGeometry('sha-a', await fixturePages());
    let parses = 0;
    const extractor = async (): Promise<PageGeometry[]> => {
      parses++;
      return [];
    };
    const view = await pageLinesFor({ filePath: '/nowhere.pdf', contentSha: 'sha-a', page: 5 }, extractor);
    expect(view.lines[0]!.text).toBe('Limit Tests of /btw show it adheres to Claude Code’s specs');
    expect(parses).toBe(0);
  }, 60_000);

  it('caches per bytes and page', async () => {
    const pages = await fixturePages();
    let parses = 0;
    const extractor = async (): Promise<PageGeometry[]> => {
      parses++;
      return pages;
    };
    const first = await pageLinesFor({ filePath: FIXTURE, contentSha: 'sha-b', page: 2 }, extractor);
    clearPageCache(); // the geometry is gone; the page's lines are still held
    const again = await pageLinesFor({ filePath: FIXTURE, contentSha: 'sha-b', page: 2 }, extractor);
    expect(again).toBe(first);
    expect(parses).toBe(1);
  }, 60_000);
});
