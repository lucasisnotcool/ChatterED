import { describe, expect, it } from 'vitest';
import { HUGE_PARAGRAPH_WORDS, PAGE_CEILING_WORDS, paginateText } from './paginate.js';
import { TEXT_PAGE_WORDS } from './notebook.js';

/** A paragraph of `n` words, each word distinct so a test can see where a cut fell. */
function para(n: number, tag = 'w'): string {
  return Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');
}

function words(page: string): number {
  return page.trim().split(/\s+/).length;
}

describe('paginateText', () => {
  it('reads empty and whitespace-only text as no pages', () => {
    expect(paginateText('')).toEqual([]);
    expect(paginateText('  \n\n \t\n')).toEqual([]);
  });

  it('keeps a short text as one page, paragraphs joined by one blank line', () => {
    expect(paginateText('# Title\n\nFirst para.\nstill first.\n\n\n\nSecond para.')).toEqual([
      '# Title\n\nFirst para.\nstill first.\n\nSecond para.',
    ]);
  });

  it('reads CRLF and CR line ends as LF', () => {
    expect(paginateText('a\r\n\r\nb')).toEqual(paginateText('a\n\nb'));
    expect(paginateText('a\r\rb')).toEqual(['a\n\nb']);
  });

  it('cuts at paragraph boundaries into pages of about TEXT_PAGE_WORDS words', () => {
    const text = Array.from({ length: 10 }, (_, i) => para(100, `p${i}_`)).join('\n\n');
    const pages = paginateText(text);
    expect(pages.length).toBe(3);
    expect(pages.map(words)).toEqual([400, 400, 200]);
    // No paragraph is split: every page starts at a paragraph's first word.
    for (const page of pages) expect(page.split('\n\n').every((p) => /^p\d+_0 /.test(p))).toBe(true);
  });

  it('lets a page run past TEXT_PAGE_WORDS to keep a paragraph whole, up to the ceiling', () => {
    const pages = paginateText([para(350, 'a'), para(100, 'b')].join('\n\n'));
    expect(pages).toHaveLength(1);
    expect(words(pages[0]!)).toBe(450);
    expect(450).toBeLessThanOrEqual(PAGE_CEILING_WORDS);
    // …but not past the ceiling.
    expect(paginateText([para(350, 'a'), para(200, 'b')].join('\n\n'))).toHaveLength(2);
  });

  it('splits only a huge paragraph, and then at sentence ends', () => {
    const sentence = (i: number) => `${para(49, `s${i}_`)} end.`; // 50 words
    const huge = Array.from({ length: 20 }, (_, i) => sentence(i)).join(' '); // 1,000 words
    expect(words(huge)).toBeGreaterThan(HUGE_PARAGRAPH_WORDS);
    const pages = paginateText(huge);
    expect(pages.map(words)).toEqual([400, 400, 200]);
    for (const page of pages) expect(page.endsWith('end.')).toBe(true);
  });

  it('splits a single over-long sentence by words', () => {
    const pages = paginateText(para(TEXT_PAGE_WORDS * 2 + 10));
    expect(pages.map(words)).toEqual([TEXT_PAGE_WORDS, TEXT_PAGE_WORDS, 10]);
  });

  it('is deterministic', () => {
    const text = Array.from({ length: 30 }, (_, i) => para(37 + ((i * 53) % 140), `x${i}_`)).join('\n\n');
    expect(paginateText(text)).toEqual(paginateText(text));
  });
});
