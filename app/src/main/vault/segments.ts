/**
 * The segmentation service: what the four `segments:*` IPC channels actually do (issue #25).
 *
 * It owns three things the pure package deliberately does not — the filesystem, pdf.js, and
 * SQLite — and nothing else. Every decision about *where* a cut may go is taken in
 * `src/shared/segment/`, so the rules are testable without a database and identical in the
 * renderer's own arithmetic.
 *
 * `pivot-spec.md` §A3: **SQLite is the source of truth.** The pipeline is a cache, keyed on
 * `content_sha`; once the learner has touched a document, its rows are authoritative and are
 * never recomputed, even across a pipeline-version bump.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { SqlDatabase } from '../db/driver.js';
import {
  PIPELINE_VERSION,
  segmentsRepo,
  type SegmentsRepo,
  type StoredSegment,
} from '../db/repos/segments.js';
import { extractPageGeometry } from './geometry.js';
import {
  mergeSegments,
  refusalMessage,
  reorderSegments,
  segmentDocument,
  splitSegment,
  type CutCandidate,
  type PageGeometry,
  type Segment,
  type SegmentDocumentView,
  type SegmentRefusal,
  type SegmentView,
} from '../../shared/segment/index.js';

/** How many documents' geometry to keep parsed. Two is "the one you are in, and the last one". */
const GEOMETRY_CACHE = 2;

export interface SegmentDeps {
  db: SqlDatabase;
  /** Absolute path for a vault file id. Throws if the file is gone or outside the vault. */
  sourcePath(fileId: string): string;
  now?: () => string;
  newId?: () => string;
}

export interface SplitInput {
  fileId: string;
  segmentId: string;
  /** Normalised: a `y` for a horizontal cut, an `x` for a vertical one. */
  at: number;
  axis?: 'horizontal' | 'vertical';
  /** The modifier is held: do not snap to a tick. */
  free?: boolean;
}

let counter = 0;

export class SegmentService {
  readonly #repo: SegmentsRepo;
  readonly #deps: SegmentDeps;
  readonly #now: () => string;
  readonly #newId: () => string;
  /** sha → parsed geometry. Bounded; a 200-page reading is tens of MB of boxes. */
  readonly #geometry = new Map<string, PageGeometry[]>();
  /** absolute path → the sha of the bytes at that (size, mtime). */
  readonly #shaCache = new Map<string, { sha: string; size: number; mtimeMs: number }>();

  constructor(deps: SegmentDeps) {
    this.#repo = segmentsRepo(deps.db);
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#newId =
      deps.newId ??
      (() => `seg_${Date.now().toString(36)}${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  }

  /** The flow for one file: cached if it exists, computed and cached if it does not. */
  async document(fileId: string): Promise<SegmentDocumentView> {
    const { sha } = await this.#ensure(fileId);
    return this.#view(fileId, sha, null);
  }

  async split(input: SplitInput): Promise<SegmentDocumentView> {
    const { sha } = await this.#ensure(input.fileId);
    const stored = this.#repo.list(sha);
    const index = stored.findIndex((s) => s.id === input.segmentId);
    if (index < 0) return this.#refuse(input.fileId, sha, 'no-segment');

    const target = stored[index]!;
    const geometry = await this.#geometryFor(input.fileId, sha);
    const page = geometry.find((p) => p.page === target.page);
    if (!page) return this.#refuse(input.fileId, sha, 'no-segment');

    const record = this.#repo.get(sha);
    const candidates = (record?.candidates ?? []).filter((c) => c.page === target.page);
    const result = splitSegment(
      stored.map(toSegment),
      page,
      { page: target.page, at: input.at, axis: input.axis, index, free: input.free },
      { candidates },
    );
    if (result.refused !== null) return this.#refuse(input.fileId, sha, result.refused);

    // The first half keeps the segment's identity; the second is new. That matters for the
    // renderer's scroll position and for anything anchored to the segment the learner cut.
    const ids = stored.map((s) => s.id);
    ids.splice(index, 1, target.id, this.#newId());
    this.#write(sha, result.segments, ids);
    return this.#view(input.fileId, sha, null);
  }

  async merge(input: { fileId: string; segmentIds: [string, string] }): Promise<SegmentDocumentView> {
    const { sha } = await this.#ensure(input.fileId);
    const stored = this.#repo.list(sha);
    const a = stored.findIndex((s) => s.id === input.segmentIds[0]);
    const b = stored.findIndex((s) => s.id === input.segmentIds[1]);
    if (a < 0 || b < 0) return this.#refuse(input.fileId, sha, 'no-segment');

    const result = mergeSegments(stored.map(toSegment), a, b);
    if (result.refused !== null) return this.#refuse(input.fileId, sha, result.refused);

    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const ids = stored.map((s) => s.id);
    ids.splice(hi, 1);
    ids.splice(lo, 1, stored[lo]!.id);
    this.#write(sha, result.segments, ids);
    return this.#view(input.fileId, sha, null);
  }

  async reorder(input: { fileId: string; segmentId: string; toIndex: number }): Promise<SegmentDocumentView> {
    const { sha } = await this.#ensure(input.fileId);
    const stored = this.#repo.list(sha);
    const from = stored.findIndex((s) => s.id === input.segmentId);
    if (from < 0) return this.#refuse(input.fileId, sha, 'no-segment');

    const moved = reorderSegments(stored.map(toSegment), from, input.toIndex);
    const ids = stored.map((s) => s.id);
    const [id] = ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(ids.length, input.toIndex)), 0, id!);
    this.#write(sha, moved, ids);
    return this.#view(input.fileId, sha, null);
  }

  /** Rename one segment. Editing a label is a learner edit like any other. */
  async rename(input: { fileId: string; segmentId: string; label: string }): Promise<SegmentDocumentView> {
    const { sha } = await this.#ensure(input.fileId);
    const stored = this.#repo.list(sha);
    const index = stored.findIndex((s) => s.id === input.segmentId);
    if (index < 0) return this.#refuse(input.fileId, sha, 'no-segment');
    const next = stored.map(toSegment);
    next[index] = { ...next[index]!, label: input.label.trim().slice(0, 120) };
    this.#write(sha, next, stored.map((s) => s.id));
    return this.#view(input.fileId, sha, null);
  }

  // ── internals ────────────────────────────────────────────────────────────

  #write(sha: string, segments: Segment[], ids: string[]): void {
    const rows: StoredSegment[] = segments.map((s, i) => ({
      ...s,
      id: ids[i] ?? this.#newId(),
      order: i,
    }));
    this.#repo.replaceSegments(sha, rows, this.#now());
  }

  #refuse(fileId: string, sha: string, reason: SegmentRefusal['reason']): SegmentDocumentView {
    return this.#view(fileId, sha, { reason, message: refusalMessage(reason) });
  }

  #view(fileId: string, sha: string, refused: SegmentRefusal | null): SegmentDocumentView {
    const record = this.#repo.get(sha);
    const stored = this.#repo.list(sha);
    const builds = record?.builds ?? [];
    const candidates = record?.candidates ?? [];

    const segments: SegmentView[] = stored.map((s, i) => ({
      ...toSegment(s),
      id: s.id,
      order: i,
      buildSteps: builds.find((b) => b.page === s.page)?.steps ?? [],
      candidates: ticksInside(candidates, s),
    }));

    return {
      fileId,
      contentSha: sha,
      genre: record?.genre ?? 'prose',
      notice: record?.notice ?? null,
      pageCount: record?.pageCount ?? 0,
      pageSizes: record?.pageSizes ?? [],
      builds,
      segments,
      refused,
    };
  }

  /** Make sure a segmentation exists for this file's bytes. Returns its `content_sha`. */
  async #ensure(fileId: string): Promise<{ sha: string }> {
    const absPath = this.#deps.sourcePath(fileId);
    const sha = await this.#shaOf(absPath);

    const record = this.#repo.get(sha);
    const touched = this.#repo.touched(sha);
    const usable =
      record !== undefined &&
      this.#repo.list(sha).length > 0 &&
      (touched || record.pipelineVersion === PIPELINE_VERSION);
    if (usable) {
      if (record.fileId !== fileId) this.#repo.noteFile(sha, fileId);
      return { sha };
    }

    const geometry = await this.#parse(absPath, sha);
    const out = segmentDocument(geometry);
    const now = this.#now();
    this.#repo.save(
      {
        contentSha: sha,
        fileId,
        pageCount: out.pages.length,
        genre: out.genre,
        notice: out.notice,
        signals: out.signals,
        builds: out.builds,
        candidates: out.candidates,
        pageSizes: out.pages.map((p) => ({ page: p.page, width: p.width, height: p.height })),
        pipelineVersion: PIPELINE_VERSION,
        createdAt: now,
      },
      out.segments.map((s, i) => ({ ...s, id: this.#newId(), order: i })),
      now,
    );
    return { sha };
  }

  async #geometryFor(fileId: string, sha: string): Promise<PageGeometry[]> {
    const cached = this.#geometry.get(sha);
    if (cached) return cached;
    return this.#parse(this.#deps.sourcePath(fileId), sha);
  }

  async #parse(absPath: string, sha: string): Promise<PageGeometry[]> {
    const raw = await extractPageGeometry(absPath);
    // Stage 0 and Stage 2 are part of "what a page is", so the cached geometry is the *kept*,
    // chrome-marked one — otherwise a split would look up a build step that is not in the flow.
    const pages = segmentDocument(raw).pages;
    this.#geometry.set(sha, pages);
    while (this.#geometry.size > GEOMETRY_CACHE) {
      const oldest = this.#geometry.keys().next().value;
      if (oldest === undefined) break;
      this.#geometry.delete(oldest);
    }
    return pages;
  }

  async #shaOf(absPath: string): Promise<string> {
    const info = await stat(absPath);
    const hit = this.#shaCache.get(absPath);
    if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return hit.sha;
    const sha = createHash('sha256').update(await readFile(absPath)).digest('hex');
    this.#shaCache.set(absPath, { sha, size: info.size, mtimeMs: info.mtimeMs });
    return sha;
  }
}

function toSegment(s: StoredSegment): Segment {
  return {
    page: s.page,
    x0: s.x0,
    y0: s.y0,
    x1: s.x1,
    y1: s.y1,
    label: s.label,
    source: s.source,
  };
}

/**
 * The ticks one card draws: candidates strictly inside the segment, on the axis that can cut
 * it. A tick on the segment's own edge is not a tick — it is the edge.
 */
function ticksInside(candidates: CutCandidate[], s: { page: number; x0: number; y0: number; x1: number; y1: number }): CutCandidate[] {
  return candidates.filter((c) => {
    if (c.page !== s.page) return false;
    return c.axis === 'horizontal'
      ? c.at > s.y0 + 1e-6 && c.at < s.y1 - 1e-6
      : c.at > s.x0 + 1e-6 && c.at < s.x1 - 1e-6;
  });
}
