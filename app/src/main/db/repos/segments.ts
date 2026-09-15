/**
 * The segments repository (issue #25, migration 009).
 *
 * SQLite is the source of truth (`pivot-spec.md` §A3): the pipeline may be re-run at any time,
 * but what the learner sees is whatever these two tables say. Everything here is synchronous
 * and transactional — a split that wrote three rows and failed on the fourth would leave a page
 * with a hole in it, and `checkPartition` would then be right to complain.
 */
import type { SqlDatabase } from '../driver.js';
import { plain, plainAll } from '../sql.js';
import type {
  CutCandidate,
  BuildGroup,
  Genre,
  GenreSignals,
  Segment,
} from '../../../shared/segment/types.js';

/** Bump when the pipeline's output would change for the same bytes. */
export const PIPELINE_VERSION = 1;

export interface PageSize {
  page: number;
  width: number;
  height: number;
}

export interface SegmentationRecord {
  contentSha: string;
  fileId: string | null;
  pageCount: number;
  genre: Genre;
  notice: string | null;
  signals: GenreSignals;
  builds: BuildGroup[];
  candidates: CutCandidate[];
  pageSizes: PageSize[];
  pipelineVersion: number;
  createdAt: string;
}

export interface StoredSegment extends Segment {
  id: string;
  order: number;
}

interface SegmentationRow {
  content_sha: string;
  file_id: string | null;
  page_count: number;
  genre: Genre;
  notice: string | null;
  signals: string;
  builds: string;
  candidates: string;
  page_sizes: string;
  pipeline_version: number;
  created_at: string;
}

interface SegmentRow {
  id: string;
  content_sha: string;
  ord: number;
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
  source: Segment['source'];
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export interface SegmentsRepo {
  /** The cached segmentation for these bytes, or undefined if the pipeline has never run. */
  get(contentSha: string): SegmentationRecord | undefined;
  /** The segments, in flow order. */
  list(contentSha: string): StoredSegment[];
  /** True once the learner has split, merged, reordered or renamed anything. */
  touched(contentSha: string): boolean;
  /** First write of a pipeline result. Replaces any previous *untouched* cache atomically. */
  save(record: SegmentationRecord, segments: StoredSegment[], now: string): void;
  /** Replace the flow after an operation, and record that the learner touched it. */
  replaceSegments(contentSha: string, segments: StoredSegment[], now: string): void;
  /** Provenance only: remember which vault file id these bytes were last seen at. */
  noteFile(contentSha: string, fileId: string): void;
}

export function segmentsRepo(db: SqlDatabase): SegmentsRepo {
  const writeSegments = (contentSha: string, segments: StoredSegment[], now: string): void => {
    db.prepare('DELETE FROM segments WHERE content_sha = @sha').run({ sha: contentSha });
    const stmt = db.prepare(
      `INSERT INTO segments (id, content_sha, ord, page, x0, y0, x1, y1, label, source, created_at, updated_at)
       VALUES (@id, @sha, @ord, @page, @x0, @y0, @x1, @y1, @label, @source, @now, @now)`,
    );
    segments.forEach((s, i) => {
      stmt.run({
        id: s.id,
        sha: contentSha,
        ord: i,
        page: s.page,
        x0: s.x0,
        y0: s.y0,
        x1: s.x1,
        y1: s.y1,
        label: s.label,
        source: s.source,
        now,
      });
    });
  };

  const tx = (fn: () => void): void => {
    db.exec('BEGIN');
    try {
      fn();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  return {
    get(contentSha) {
      const row = plain(
        db
          .prepare('SELECT * FROM file_segmentations WHERE content_sha = @sha')
          .get<SegmentationRow>({ sha: contentSha }),
      );
      if (!row) return undefined;
      return {
        contentSha: row.content_sha,
        fileId: row.file_id,
        pageCount: row.page_count,
        genre: row.genre,
        notice: row.notice,
        signals: parse<GenreSignals>(row.signals, {
          wordsPerPage: 0,
          textCoverage: 0,
          columns: 0,
          landscape: false,
          images: 0,
        }),
        builds: parse<BuildGroup[]>(row.builds, []),
        candidates: parse<CutCandidate[]>(row.candidates, []),
        pageSizes: parse<PageSize[]>(row.page_sizes, []),
        pipelineVersion: row.pipeline_version,
        createdAt: row.created_at,
      };
    },

    list(contentSha) {
      return plainAll(
        db
          .prepare('SELECT * FROM segments WHERE content_sha = @sha ORDER BY ord')
          .all<SegmentRow>({ sha: contentSha }),
      ).map((r) => ({
        id: r.id,
        order: r.ord,
        page: r.page,
        x0: r.x0,
        y0: r.y0,
        x1: r.x1,
        y1: r.y1,
        label: r.label,
        source: r.source,
      }));
    },

    touched(contentSha) {
      return (
        db
          .prepare('SELECT content_sha FROM segments_touched WHERE content_sha = @sha')
          .get<{ content_sha: string }>({ sha: contentSha }) !== undefined
      );
    },

    save(record, segments, now) {
      tx(() => {
        db.prepare('DELETE FROM file_segmentations WHERE content_sha = @sha').run({
          sha: record.contentSha,
        });
        db.prepare(
          `INSERT INTO file_segmentations
             (content_sha, file_id, page_count, genre, notice, signals, builds, candidates,
              page_sizes, pipeline_version, created_at)
           VALUES (@sha, @fileId, @pageCount, @genre, @notice, @signals, @builds, @candidates,
                   @pageSizes, @version, @now)`,
        ).run({
          sha: record.contentSha,
          fileId: record.fileId,
          pageCount: record.pageCount,
          genre: record.genre,
          notice: record.notice,
          signals: JSON.stringify(record.signals),
          builds: JSON.stringify(record.builds),
          candidates: JSON.stringify(record.candidates),
          pageSizes: JSON.stringify(record.pageSizes),
          version: record.pipelineVersion,
          now,
        });
        writeSegments(record.contentSha, segments, now);
      });
    },

    replaceSegments(contentSha, segments, now) {
      tx(() => {
        writeSegments(contentSha, segments, now);
        db.prepare(
          `INSERT INTO segments_touched (content_sha, touched_at) VALUES (@sha, @now)
           ON CONFLICT (content_sha) DO UPDATE SET touched_at = @now`,
        ).run({ sha: contentSha, now });
      });
    },

    noteFile(contentSha, fileId) {
      db.prepare('UPDATE file_segmentations SET file_id = @fileId WHERE content_sha = @sha').run({
        fileId,
        sha: contentSha,
      });
    },
  };
}
