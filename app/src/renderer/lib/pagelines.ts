/**
 * The renderer's read of `notes:pageLines`: one slide's text with its boxes, asked for once.
 *
 * Main caches per file and page already; this keeps the *promise*, so a learner sweeping the
 * pointer down a column of chips that all cite p. 12 makes one IPC call and not twelve. A failed
 * call is forgotten rather than kept, so the next hover asks again.
 */
import type { PageLinesView } from '../../shared/doc/cite.js';
import { bridge } from './bridge.js';

const cache = new Map<string, Promise<PageLinesView | null>>();

export function pageLinesFor(fileId: string | null, page: number): Promise<PageLinesView | null> {
  if (!fileId || !Number.isInteger(page) || page < 1) return Promise.resolve(null);
  const key = `${fileId}:${String(page)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (async (): Promise<PageLinesView | null> => {
    try {
      const api = bridge();
      // An older preload (a dev build mid-reload) has no such channel: no region, not an error.
      if (typeof api.notesPageLines !== 'function') return null;
      return await api.notesPageLines({ fileId, page });
    } catch {
      cache.delete(key);
      return null;
    }
  })();
  cache.set(key, job);
  return job;
}
