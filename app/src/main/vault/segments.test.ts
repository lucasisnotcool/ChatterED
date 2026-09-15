/**
 * The segmentation service end to end: pdf.js → stages 0–3 → SQLite → the view the flow gets.
 *
 * Runs against the real fixture deck and a real migrated in-memory database, because the two
 * things worth testing here are exactly the two the pure package cannot check — that the cache
 * is keyed on the bytes and survives a reopen, and that a learner edit is never recomputed away
 * (`pivot-spec.md` §A3: SQLite is the source of truth).
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { openTestDb } from '../../test-support/db.js';
import { SegmentService } from './segments.js';
import { segmentsRepo } from '../db/repos/segments.js';
import { checkPartition } from '../../shared/segment/index.js';

const FIXTURE = resolve(
  __dirname,
  '../../../../Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf',
);

function service() {
  const { db } = openTestDb();
  let n = 0;
  return {
    db,
    svc: new SegmentService({
      db,
      sourcePath: () => FIXTURE,
      now: () => '2026-09-15T12:00:00.000Z',
      newId: () => `seg_${(n += 1).toString().padStart(3, '0')}`,
    }),
  };
}

const pagesOf = (view: { segments: Array<{ page: number }> }): number[] => [
  ...new Set(view.segments.map((s) => s.page)),
];

describe('SegmentService', () => {
  it('opens the deck as seven whole-page segments with ticks in the gutter', async () => {
    const { svc } = service();
    const view = await svc.document('file_1');
    expect(view.genre).toBe('slides');
    expect(view.notice).toBeNull();
    expect(view.pageCount).toBe(7);
    expect(view.pageSizes).toHaveLength(7);
    expect(view.pageSizes[0]!.width).toBeCloseTo(959.76, 1);
    expect(view.segments).toHaveLength(7);
    expect(view.segments.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(view.segments.every((s) => s.x1 - s.x0 === 1 && s.y1 - s.y0 === 1)).toBe(true);
    expect(view.builds).toEqual([]);
    expect(view.refused).toBeNull();
    // Every tick a card draws is inside that card and on its page.
    for (const s of view.segments) {
      expect(s.candidates.every((c) => c.page === s.page)).toBe(true);
    }
    expect(view.segments[0]!.candidates.filter((c) => c.blockedBy === null)).toHaveLength(4);
    expect(view.segments[3]!.candidates.filter((c) => c.blockedBy === null)).toHaveLength(0);
    expect(checkPartition(view.segments, pagesOf(view))).toEqual([]);
  }, 60_000);

  it('caches the pipeline against content_sha and reads SQLite on reopen', async () => {
    const { db, svc } = service();
    const first = await svc.document('file_1');
    const repo = segmentsRepo(db);
    expect(repo.get(first.contentSha)?.pageCount).toBe(7);
    expect(repo.touched(first.contentSha)).toBe(false);

    // A second call must return the same ids — a recomputed flow would mint new ones and every
    // anchor into it would dangle.
    const second = await svc.document('file_1');
    expect(second.segments.map((s) => s.id)).toEqual(first.segments.map((s) => s.id));
  }, 60_000);

  it('splits at a tick, marks the document touched, and survives a reopen', async () => {
    const { db, svc } = service();
    const view = await svc.document('file_1');
    const first = view.segments[0]!;
    const tick = first.candidates.find((c) => c.blockedBy === null)!;

    const after = await svc.split({ fileId: 'file_1', segmentId: first.id, at: tick.at });
    expect(after.refused).toBeNull();
    expect(after.segments).toHaveLength(8);
    // The cut segment keeps its identity; the lower half is new.
    expect(after.segments[0]!.id).toBe(first.id);
    expect(after.segments[0]!.y1).toBeCloseTo(tick.at, 6);
    expect(after.segments[1]!.y0).toBeCloseTo(tick.at, 6);
    expect(after.segments[1]!.source).toBe('geometry');
    expect(checkPartition(after.segments, pagesOf(after))).toEqual([]);

    expect(segmentsRepo(db).touched(after.contentSha)).toBe(true);
    const reopened = await svc.document('file_1');
    expect(reopened.segments).toHaveLength(8);
    expect(reopened.segments.map((s) => s.id)).toEqual(after.segments.map((s) => s.id));
  }, 60_000);

  it('records a free cut as the learner’s, and refuses one through a figure', async () => {
    const { svc } = service();
    const view = await svc.document('file_1');
    const page4 = view.segments.find((s) => s.page === 4)!;

    // Page 4 is the full-height screenshot; any horizontal cut across it slices the figure.
    const refused = await svc.split({ fileId: 'file_1', segmentId: page4.id, at: 0.6, free: true });
    expect(refused.refused?.reason).toBe('figure');
    expect(refused.refused?.message).toMatch(/slice a figure/);
    expect(refused.segments).toHaveLength(7);

    const page1 = view.segments[0]!;
    const free = await svc.split({ fileId: 'file_1', segmentId: page1.id, at: 0.6, free: true });
    expect(free.refused).toBeNull();
    expect(free.segments[0]!.source).toBe('learner');
  }, 60_000);

  it('merges a split back, reorders, and renames', async () => {
    const { svc } = service();
    const view = await svc.document('file_1');
    const first = view.segments[0]!;
    const tick = first.candidates.find((c) => c.blockedBy === null)!;
    const split = await svc.split({ fileId: 'file_1', segmentId: first.id, at: tick.at });

    const merged = await svc.merge({
      fileId: 'file_1',
      segmentIds: [split.segments[0]!.id, split.segments[1]!.id],
    });
    expect(merged.refused).toBeNull();
    expect(merged.segments).toHaveLength(7);
    expect(merged.segments[0]).toMatchObject({ y0: 0, y1: 1, source: 'learner' });
    expect(checkPartition(merged.segments, pagesOf(merged))).toEqual([]);

    const moved = await svc.reorder({ fileId: 'file_1', segmentId: merged.segments[6]!.id, toIndex: 0 });
    expect(moved.segments.map((s) => s.page)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(moved.segments.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const renamed = await svc.rename({
      fileId: 'file_1',
      segmentId: moved.segments[0]!.id,
      label: 'Speaking up',
    });
    expect(renamed.segments[0]!.label).toBe('Speaking up');
  }, 60_000);

  it('refuses a cross-page merge and a merge of two non-neighbours', async () => {
    const { svc } = service();
    const view = await svc.document('file_1');
    const across = await svc.merge({
      fileId: 'file_1',
      segmentIds: [view.segments[0]!.id, view.segments[1]!.id],
    });
    expect(across.refused?.reason).toBe('different-pages');
    expect(across.segments).toHaveLength(7);

    const missing = await svc.merge({ fileId: 'file_1', segmentIds: ['nope', 'also-nope'] });
    expect(missing.refused?.reason).toBe('no-segment');
  }, 60_000);
});
