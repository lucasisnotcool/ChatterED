/**
 * **The notes prompt's word budget** (2026-09-23). v2 asked for "60–90 words per content slide"
 * and got about 150; v3 hands each window a ceiling computed here, so the arithmetic is pinned
 * without a model.
 */
import { describe, expect, it } from 'vitest';
import {
  NOTES_SYSTEM,
  PAGE_BUDGET_FIGURE_ONLY,
  PAGE_BUDGET_MAX,
  draftWords,
  pageWordBudget,
  windowMessage,
  windowWordBudget,
} from './prompts.js';
import type { NotesPageExtract } from './extract.js';

const FIG: NotesPageExtract['figures'][number] = { rect: { x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.6 }, kind: 'path', area: 0.25 };

function page(n: number, words: number, figures = 0): NotesPageExtract {
  return { page: n, title: `Slide ${n}`, lines: [], figures: Array.from({ length: figures }, () => FIG), imageCount: 0, words };
}

describe('pageWordBudget', () => {
  it('gives a title or divider slide nothing', () => {
    expect(pageWordBudget(page(1, 4))).toBe(0);
  });

  it('gives a near-wordless diagram slide room for a caption and a sentence', () => {
    expect(pageWordBudget(page(1, 5, 1))).toBe(PAGE_BUDGET_FIGURE_ONLY);
  });

  it('lets a terse slide be explained, and caps a dense one', () => {
    expect(pageWordBudget(page(1, 40))).toBe(48);
    expect(pageWordBudget(page(1, 300))).toBe(PAGE_BUDGET_MAX);
  });
});

describe('windowWordBudget', () => {
  it('sums the pages, rounded to ten, never below one paragraph', () => {
    expect(windowWordBudget([page(1, 3), page(2, 40), page(3, 60)])).toBe(120);
    expect(windowWordBudget([page(1, 3), page(2, 2)])).toBe(60);
  });

  it('keeps Lecture 4’s shape near the slides’ own length, not 2.6× it', () => {
    // 66 pages at Lecture 4's mean of 56 words a page.
    const pages = Array.from({ length: 66 }, (_, i) => page(i + 1, 56));
    const slideWords = 66 * 56;
    expect(windowWordBudget(pages) / slideWords).toBeLessThan(1.3);
  });
});

describe('the window message and the system prompt', () => {
  const pages = [page(4, 50), page(5, 30), page(6, 2)];

  it('states the slides’ words and the ceiling', () => {
    const msg = windowMessage({
      title: 'L4',
      window: { from: 4, to: 6 },
      index: 1,
      total: 3,
      pages,
      outlineSoFar: '# Earlier',
      withImages: false,
    });
    expect(msg).toContain('These slides say about 82 words');
    expect(msg).toContain(`at most ${windowWordBudget(pages)} words`);
    expect(msg).toContain('One heading per idea, not per slide');
    expect(msg).not.toContain('same level of detail');
  });

  it('asks for what the slides teach, organised by idea', () => {
    expect(NOTES_SYSTEM).toContain('ORGANISE BY IDEA, IN THE DECK\'S ORDER.');
    expect(NOTES_SYSTEM).toContain('**ceiling, not a target**');
    expect(NOTES_SYSTEM).not.toContain('Aim at 60–90 words');
  });
});

describe('draftWords', () => {
  it('counts every kind of block the log reports on', () => {
    const prov = { pages: [1], reason: null };
    expect(
      draftWords([
        { kind: 'heading', level: 2, text: 'Two words', prov },
        { kind: 'paragraph', text: 'Three words here', prov },
        { kind: 'bullets', items: ['one', 'two more'], prov },
        { kind: 'figure', page: 1, rect: null, caption: 'A caption', prov },
        { kind: 'math', tex: 'x^2', prov },
      ]),
    ).toBe(10);
  });
});
