/**
 * The shared geometry cache (#48). No pdf.js here: the extractor is injected, because what is
 * worth testing is the sharing, not the parsing — `geometry.test.ts` owns the parsing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PageGeometry } from '../../shared/segment/types.js';
import { clearPageCache, pageCacheKeys, pageGeometry, primePageGeometry, PAGE_CACHE_SIZE } from './pagecache.js';

function onePage(page: number): PageGeometry {
  return {
    page,
    width: 960,
    height: 540,
    textBoxes: [{ text: `page ${page}`, x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.14, fontPt: 20, fontName: 'f1' }],
    inkBoxes: [],
    chrome: [false],
    imageCount: 0,
  };
}

beforeEach(() => clearPageCache());

describe('one pdf.js pass per deck', () => {
  it('parses once and serves the second caller from the cache', async () => {
    let calls = 0;
    const extractor = async () => {
      calls += 1;
      return [onePage(1)];
    };
    await pageGeometry({ filePath: '/a.pdf', contentSha: 'sha1' }, extractor);
    await pageGeometry({ filePath: '/a.pdf', contentSha: 'sha1' }, extractor);
    expect(calls).toBe(1);
  });

  it('shares an in-flight parse, because both ingests are fired by one click', async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const extractor = async () => {
      calls += 1;
      await new Promise<void>((r) => (release = r));
      return [onePage(1)];
    };
    const a = pageGeometry({ filePath: '/a.pdf', contentSha: 'sha1' }, extractor);
    const b = pageGeometry({ filePath: '/a.pdf', contentSha: 'sha1' }, extractor);
    expect(calls).toBe(1);
    release!();
    expect(await a).toBe(await b);
  });

  it('is keyed on the bytes, so the same deck in two folders is one entry (#39)', async () => {
    let calls = 0;
    const extractor = async () => {
      calls += 1;
      return [onePage(1)];
    };
    await pageGeometry({ filePath: '/one/a.pdf', contentSha: 'sha1' }, extractor);
    await pageGeometry({ filePath: '/two/copy.pdf', contentSha: 'sha1' }, extractor);
    expect(calls).toBe(1);
  });

  it('evicts the least recently used deck', async () => {
    for (let i = 0; i < PAGE_CACHE_SIZE + 2; i += 1) {
      primePageGeometry(`sha${i}`, [onePage(1)]);
    }
    expect(pageCacheKeys()).toHaveLength(PAGE_CACHE_SIZE);
    expect(pageCacheKeys()).not.toContain('sha0');
  });

  it('takes donated geometry rather than parsing again', async () => {
    let calls = 0;
    primePageGeometry('sha1', [onePage(3)]);
    const pages = await pageGeometry({ filePath: '/a.pdf', contentSha: 'sha1' }, async () => {
      calls += 1;
      return [];
    });
    expect(calls).toBe(0);
    expect(pages[0]!.page).toBe(3);
  });
});
