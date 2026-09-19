/**
 * Pass 1 against the real fixture deck (#48).
 *
 * The fixture is the one the rest of the repo uses:
 * `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf` — 7 pages,
 * 16:9, PowerPoint, tagged, committed. No network, no fixture generation.
 *
 * These are **measurements**, as `geometry.test.ts` says of its own: pass 1 is the deterministic
 * half of the ingest, and if a threshold moves, this says which page moved with it.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { extractPageGeometry } from '../vault/geometry.js';
import { segmentDocument } from '../../shared/segment/index.js';
import type { PageGeometry } from '../../shared/segment/types.js';
import { extractNotesPages, pageLines, pagePrompt, windowPrompt, MIN_FIGURE_AREA } from './extract.js';

const FIXTURE = resolve(
  __dirname,
  '../../../../Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf',
);

let cached: PageGeometry[] | null = null;
async function fixturePages(): Promise<PageGeometry[]> {
  if (!cached) cached = segmentDocument(await extractPageGeometry(FIXTURE)).pages;
  return cached;
}

describe('pass 1 on the fixture deck', () => {
  it('gives every slide its own page number, its title and its lines', async () => {
    const pages = extractNotesPages(await fixturePages());
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // The lecture's own structure: these are the deck's titles, not anything generated.
    expect(pages[0]!.title).toBe('/btw');
    expect(pages[2]!.title).toBe('/btw as a whisper');
    expect(pages[6]!.title).toBe('From silent whispering to speaking up at meeting');
    for (const p of pages) {
      expect(p.lines.length).toBeGreaterThan(0);
      expect(p.words).toBeGreaterThan(0);
      expect(p.lines.every((l) => l.text.trim().length > 0)).toBe(true);
    }
  }, 60_000);

  it('rebuilds lines from style runs, so a title is one line and not five items', async () => {
    const pages = await fixturePages();
    const lines = pageLines(pages.find((p) => p.page === 5)!);
    expect(lines.some((l) => l.text === 'Limit Tests of /btw show it adheres to Claude Code’s specs')).toBe(true);
    // pdf.js emitted that title as several runs; a line never holds a raw fragment of one.
    expect(lines.every((l) => l.text === l.text.trim())).toBe(true);
  }, 60_000);

  it('is deterministic — the same bytes give byte-identical prompt text', async () => {
    const pages = await fixturePages();
    expect(windowPrompt(extractNotesPages(pages))).toBe(windowPrompt(extractNotesPages(pages)));
  }, 60_000);

  it('reports figure regions and never a panel background', async () => {
    const pages = extractNotesPages(await fixturePages());
    // Page 4's screenshot is an image XObject — a figure, and the thing no cut may cross.
    const four = pages.find((p) => p.page === 4)!;
    expect(four.figures.some((f) => f.kind === 'image')).toBe(true);
    // Page 5's single path holds all 61 text runs: `classifyInk` calls it a container, so it is
    // not offered as a figure and the notes will not crop a card background into themselves.
    expect(pages.find((p) => p.page === 5)!.figures).toHaveLength(0);
    for (const p of pages) {
      for (const f of p.figures) {
        expect(f.area).toBeGreaterThanOrEqual(MIN_FIGURE_AREA);
        expect(f.rect.x1).toBeGreaterThan(f.rect.x0);
        expect(f.rect.y1).toBeGreaterThan(f.rect.y0);
        // Normalised, y down, inside the page — the convention the crop arithmetic assumes.
        expect(f.rect.x0).toBeGreaterThanOrEqual(0);
        expect(f.rect.y1).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);

  it('writes a prompt page a model can read: the title once, the lines, the regions', async () => {
    const pages = extractNotesPages(await fixturePages());
    const text = pagePrompt(pages[0]!);
    expect(text.split('\n')[0]).toBe('[p. 1] /btw');
    expect(text).toContain('Whispering with your agent');
    expect(text).toContain('FIGURE REGIONS ON THIS SLIDE:');
    expect(text).toContain('rect=[');
    // The title is the header; it is never repeated as a body line.
    expect(text.split('\n').filter((l) => l.trim() === '/btw')).toHaveLength(0);
  }, 60_000);
});

describe('pass 1 on synthetic geometry', () => {
  /** One page, built by hand, so the line rules can be asserted without a PDF. */
  function page(boxes: { text: string; x0: number; y0: number; x1: number; y1: number; fontPt?: number }[]): PageGeometry {
    return {
      page: 1,
      width: 960,
      height: 540,
      textBoxes: boxes.map((b) => ({ ...b, fontPt: b.fontPt ?? 12, fontName: 'f1' })),
      inkBoxes: [],
      chrome: boxes.map(() => false),
      imageCount: 0,
    };
  }

  it('joins two runs of one word without inventing a space', () => {
    const lines = pageLines(page([
      { text: 'f', x0: 0.1, y0: 0.2, x1: 0.12, y1: 0.24 },
      { text: '(x)', x0: 0.12, y0: 0.2, x1: 0.18, y1: 0.24 },
    ]));
    expect(lines.map((l) => l.text)).toEqual(['f(x)']);
  });

  it('puts a space where the gap is a word wide', () => {
    const lines = pageLines(page([
      { text: 'convex', x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.24 },
      { text: 'function', x0: 0.24, y0: 0.2, x1: 0.36, y1: 0.24 },
    ]));
    expect(lines.map((l) => l.text)).toEqual(['convex function']);
  });

  it('breaks a line when the baseline moves', () => {
    const lines = pageLines(page([
      { text: 'first', x0: 0.1, y0: 0.20, x1: 0.2, y1: 0.24 },
      { text: 'second', x0: 0.1, y0: 0.30, x1: 0.2, y1: 0.34 },
    ]));
    expect(lines.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('drops the repeating chrome the pipeline marked, so a slide number is never content', () => {
    const p = page([
      { text: 'Real content', x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.24 },
      { text: '17', x0: 0.93, y0: 0.94, x1: 0.96, y1: 0.97 },
    ]);
    p.chrome = [false, true];
    expect(pageLines(p).map((l) => l.text)).toEqual(['Real content']);
  });
});
