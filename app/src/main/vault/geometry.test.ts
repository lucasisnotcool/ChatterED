/**
 * Stage 1 against a real deck, and the whole pipeline end to end.
 *
 * The fixture is the deck this project's own critique was written on:
 * `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`
 * — 7 pages, 16:9 (959.76 × 540 pt), PowerPoint, tagged. It is in the repository, so this test
 * needs no network and no fixture generation, and the numbers it pins are the ones quoted in
 * `app/docs/SEGMENTS.md`.
 *
 * These assertions are deliberately *measurements*, not aspirations: if a threshold changes,
 * this test tells you exactly which page moved.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { extractPageGeometry } from './geometry.js';
import {
  acceptedCuts,
  candidatesForPage,
  segmentDocument,
  slideTitle,
} from '../../shared/segment/index.js';

const FIXTURE = resolve(
  __dirname,
  '../../../../Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf',
);

describe('extractPageGeometry, on the fixture deck', () => {
  it('reads seven 16:9 pages with text, ink and tagged roles', async () => {
    const pages = await extractPageGeometry(FIXTURE);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const p of pages) {
      expect(p.width).toBeCloseTo(959.76, 1);
      expect(p.height).toBeCloseTo(540, 1);
      expect(p.textBoxes.length).toBeGreaterThan(0);
      // §B1.1 warning 2: zero-width `hasEOL` items must never become boxes.
      expect(p.textBoxes.every((b) => b.x1 > b.x0)).toBe(true);
      // Normalised, y down, inside the page box.
      expect(p.textBoxes.every((b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 1 && b.y1 <= 1)).toBe(true);
      // §B1.4: `pdfinfo` says this deck is Tagged: yes, so every text box has a role.
      expect(p.struct?.length).toBe(p.textBoxes.length);
    }
    // §B1.3's table: the screenshot on page 4 is an image XObject; page 1 carries one too.
    expect(pages.filter((p) => p.imageCount > 0).map((p) => p.page)).toEqual([1, 4]);
  }, 60_000);

  it('honours a page range', async () => {
    const pages = await extractPageGeometry(FIXTURE, { range: { from: 3, to: 4 } });
    expect(pages.map((p) => p.page)).toEqual([3, 4]);
  }, 60_000);

  it('separates a figure from a container by the text it holds', async () => {
    const pages = await extractPageGeometry(FIXTURE);
    // Page 5's single path holds all 61 text runs — a card background, not a figure.
    const five = pages.find((p) => p.page === 5)!;
    expect(five.inkBoxes).toHaveLength(1);
    expect(five.inkBoxes[0]!.kind).toBe('container');
    // Page 4's screenshot holds none — a figure, and the thing no cut may cross.
    const four = pages.find((p) => p.page === 4)!;
    expect(four.inkBoxes.some((b) => b.kind === 'image')).toBe(true);
    expect(four.inkBoxes.every((b) => b.kind !== 'container')).toBe(true);
  }, 60_000);
});

describe('the pipeline, on the fixture deck', () => {
  it('routes it to slides, finds no builds and no chrome, and titles every page', async () => {
    const out = segmentDocument(await extractPageGeometry(FIXTURE));
    expect(out.genre).toBe('slides');
    expect(out.notice).toBeNull();
    expect(out.signals.landscape).toBe(true);
    expect(out.signals.wordsPerPage).toBeLessThan(150);
    expect(out.signals.textCoverage).toBeLessThan(0.4);

    // No progressive-reveal builds in this deck, and no repeating footline: it is a seven-page
    // PowerPoint with no master furniture. Both stages correctly find nothing.
    expect(out.builds).toEqual([]);
    expect(out.pages.every((p) => p.chrome.every((c) => !c))).toBe(true);

    expect(out.segments).toHaveLength(7);
    expect(out.segments.every((s) => s.x0 === 0 && s.y0 === 0 && s.x1 === 1 && s.y1 === 1)).toBe(true);
    expect(out.segments.map((s) => s.label)).toEqual([
      '/btw',
      '“Use /btw to ask a question about your current work',
      '/btw as a whisper',
      '/btw vs. texting in a meeting (or, students chatting with lecturer is talking)',
      'Limit Tests of /btw show it adheres to Claude Code’s specs',
      '/btw removes context penalty, encourages user participation',
      'From silent whispering to speaking up at meeting',
    ]);
    expect(out.pages.map(slideTitle)).toEqual(out.segments.map((s) => s.label));
  }, 60_000);

  it('offers the measured number of candidate cuts per page', async () => {
    const pages = await extractPageGeometry(FIXTURE);
    const marked = segmentDocument(pages).pages;
    const perPage = marked.map((p) => {
      const all = candidatesForPage(p);
      return {
        page: p.page,
        accepted: acceptedCuts(all).length,
        blocked: all.length - acceptedCuts(all).length,
      };
    });
    // Measured 2026-09-15. §D1 expects 1–5 full-width candidates per slide page with 0–20 % of
    // pages empty; this deck gives 0–4 with one empty page (14 %), which is inside that range.
    // Page 4 is the §C6 case: a full-height screenshot beside a bullet list, so every
    // horizontal cut is refused and the only proposal is a *vertical* one, itself refused
    // because the gutter falls over the screenshot.
    expect(perPage).toEqual([
      { page: 1, accepted: 4, blocked: 0 },
      { page: 2, accepted: 2, blocked: 2 },
      { page: 3, accepted: 3, blocked: 3 },
      { page: 4, accepted: 0, blocked: 13 },
      { page: 5, accepted: 2, blocked: 0 },
      { page: 6, accepted: 3, blocked: 1 },
      { page: 7, accepted: 4, blocked: 3 },
    ]);
    const total = perPage.reduce((n, p) => n + p.accepted, 0);
    expect(total).toBe(18);
  }, 60_000);

  it('proposes a vertical cut where a column gutter exists (§C6)', async () => {
    const marked = segmentDocument(await extractPageGeometry(FIXTURE)).pages;
    const vertical = marked.flatMap((p) => candidatesForPage(p).filter((c) => c.axis === 'vertical'));
    expect(vertical.map((c) => c.page)).toEqual([4, 6, 7]);
    expect(vertical.find((c) => c.page === 4)!.blockedBy).toBe('figure');
    expect(vertical.find((c) => c.page === 6)!.blockedBy).toBeNull();
  }, 60_000);
});
