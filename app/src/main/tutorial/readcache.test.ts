/** The windows of an unfinished read, kept for a resume (`readcache.ts`). */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WindowCache } from './readcache.js';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-readcache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the read cache', () => {
  const w = { from: 6, to: 10, ahead: 11, depth: 0 };

  it('keeps a window for the same sheet, not for another', () => {
    new WindowCache(dir, ['1', 'sheet', 'page one']).put(w, { title: 'T', blocks: [], parts: [] });
    expect(new WindowCache(dir, ['1', 'sheet', 'page one']).get(w)).toEqual({ title: 'T', blocks: [], parts: [] });
    expect(new WindowCache(dir, ['1', 'sheet', 'page one, edited']).get(w)).toBeNull();
    expect(new WindowCache(dir, ['1', 'sheet', 'page one']).get({ ...w, ahead: null })).toBeNull();
  });

  it('is readable by this user only, and goes when cleared', () => {
    const cache = new WindowCache(dir, ['1', 'sheet']);
    cache.put(w, { blocks: [], parts: [] });
    const folder = join(dir, 'tutorial-reads');
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const [file] = readdirSync(folder);
    expect(statSync(join(folder, file!)).mode & 0o777).toBe(0o600);
    cache.clear();
    expect(new WindowCache(dir, ['1', 'sheet']).get(w)).toBeNull();
  });

  it('clears every kept read of a sheet, whatever its words were, and only that sheet\'s', () => {
    new WindowCache(dir, ['1', 'sheet', 'old words']).put(w, { blocks: [{}], parts: [] });
    new WindowCache(dir, ['1', 'other', 'words']).put(w, { blocks: [{}], parts: [] });
    new WindowCache(dir, ['1', 'sheet', 'new words']).clear();
    expect(new WindowCache(dir, ['1', 'sheet', 'old words']).get(w)).toBeNull();
    expect(new WindowCache(dir, ['1', 'other', 'words']).get(w)).not.toBeNull();
    expect(readdirSync(join(dir, 'tutorial-reads')).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('lets a week-old read go', () => {
    new WindowCache(dir, ['1', 'sheet']).put(w, { blocks: [{}], parts: [] });
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    expect(new WindowCache(dir, ['1', 'sheet'], () => later).get(w)).toBeNull();
  });
});
