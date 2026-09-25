/**
 * The vault's SQLite layer (migration 005).
 *
 * Deliberately *not* part of `Store` in src/room/ports.ts. The room package must stay portable
 * (architecture-mac.md §B.1) and it has no business knowing that files exist: it receives plain
 * text. So this is a main-process-only repository, constructed from the same `SqlDatabase` and
 * handed to the vault service and nothing else.
 */
import { randomUUID } from 'node:crypto';
import type { SqlDatabase } from '../db/driver.js';
import { insert, plain, plainAll, updateById } from '../db/sql.js';
import type { FileKind } from './kinds.js';
import type { ScannedFile } from './scan.js';
import { adoptOrphanedFileRows } from './adopt.js';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../../shared/snippet.js';

export interface VaultRow {
  id: string;
  root_path: string;
  display_name: string;
  created_at: string;
  last_scan_at: string | null;
}

export interface TopicRow {
  id: string;
  vault_id: string;
  rel_path: string;
  name: string;
  module_code: string | null;
  colour: string;
  sort_order: number;
  promoted_at: string;
}

export interface FileRow {
  id: string;
  vault_id: string;
  topic_id: string | null;
  rel_path: string;
  name: string;
  ext: string;
  kind: FileKind;
  size: number;
  mtime_ms: number;
  sha256: string | null;
  page_count: number | null;
  indexed_at: string | null;
  indexed_size: number | null;
  indexed_mtime_ms: number | null;
  index_error: string | null;
}

/** One indexable unit: a PDF page, or a whole Markdown/text/code file with `page` null. */
export interface TextChunk {
  page: number | null;
  body: string;
}

export interface FtsHit {
  file_id: string;
  page: number | null;
  snippet: string;
}

export interface SyncCounts {
  added: number;
  updated: number;
  /** Renamed or moved on disk and recognised as the same file, so it kept its id (#39). */
  moved: number;
  removed: number;
  unchanged: number;
}

export { SNIPPET_CLOSE, SNIPPET_OPEN };

export function newVaultId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}


export interface VaultRepo {
  vaults: {
    get(id: string): VaultRow | undefined;
    byPath(rootPath: string): VaultRow | undefined;
    insert(row: VaultRow): void;
    touchScan(id: string, at: string): void;
  };
  topics: {
    forVault(vaultId: string): TopicRow[];
    byRelPath(vaultId: string, relPath: string): TopicRow | undefined;
    insert(row: TopicRow): void;
    remove(id: string): void;
    setModuleCode(id: string, code: string | null): void;
  };
  files: {
    forVault(vaultId: string): FileRow[];
    forTopic(topicId: string | null, vaultId: string): FileRow[];
    get(id: string): FileRow | undefined;
    byRelPath(vaultId: string, relPath: string): FileRow | undefined;
    /** Reconcile the scan against what is stored. Returns what actually changed. */
    sync(vaultId: string, scanned: ScannedFile[], topicFor: (relPath: string) => string | null, now: string): SyncCounts;
    /** Files that are indexable and whose (size, mtime) no longer match what was indexed. */
    stale(vaultId: string, limit: number): FileRow[];
    /**
     * Record a successful index. When it yields a sha, the same transaction lets this id adopt
     * whatever an orphaned predecessor with those bytes left behind (#39, `adopt.ts`).
     */
    markIndexed(id: string, patch: { at: string; size: number; mtimeMs: number; pageCount: number | null; sha256: string | null }): void;
    markFailed(id: string, at: string, error: string): void;
    countsByTopic(vaultId: string): Map<string | null, number>;
    indexProgress(vaultId: string): { total: number; done: number; failed: number };
  };
  text: {
    replace(fileId: string, name: string, chunks: TextChunk[]): void;
    remove(fileId: string): void;
    /** Extracted text for one PDF page range, joined. Empty string when nothing was indexed. */
    pages(fileId: string, from: number | null, to: number | null): TextChunk[];
    search(vaultId: string, query: string, limit: number): FtsHit[];
    /**
     * The best-matching **whole pages** of one file, in page order (issue #35 / whole-file
     * context §4). `search()` answers "which file", ranked across the vault and returning a
     * 14-token snippet; this answers "which pages of *this* deck bear on this question", and
     * returns the page bodies, because the fallback for a document too large to put in the
     * prefix whole is the outline plus those pages in full.
     */
    searchInFile(fileId: string, query: string, limit: number): TextChunk[];
  };
}

/**
 * **A rename or a move keeps the file's id** (#39, fix B). A path that is new this scan is
 * paired with a row whose path vanished this scan when their size, mtime and extension agree —
 * and only when that match is one-to-one on both sides, so two identical new copies, or two
 * identical vanished rows, pair with nothing and fall through to add + remove. A rename keeps
 * mtime on macOS (Finder and `mv` both), which is what makes this cheap: no hashing in a scan.
 * It cannot see a vault reopened under a different root, or a file that was missing for one
 * scan; `adopt.ts` covers those, and this one only saves it the work.
 *
 * Returns new rel_path → the vanished row it continues.
 */
export function pairMoves(existing: Map<string, FileRow>, scanned: ScannedFile[]): Map<string, FileRow> {
  const present = new Set(scanned.map((f) => f.relPath));
  const key = (size: number, mtimeMs: number, ext: string): string => `${size}\u0000${mtimeMs}\u0000${ext}`;

  const vanished = new Map<string, FileRow[]>();
  for (const row of existing.values()) {
    if (present.has(row.rel_path)) continue;
    const k = key(row.size, row.mtime_ms, row.ext);
    vanished.set(k, [...(vanished.get(k) ?? []), row]);
  }
  if (vanished.size === 0) return new Map();

  const fresh = new Map<string, ScannedFile[]>();
  for (const f of scanned) {
    if (existing.has(f.relPath)) continue;
    const k = key(f.size, f.mtimeMs, f.ext);
    fresh.set(k, [...(fresh.get(k) ?? []), f]);
  }

  const out = new Map<string, FileRow>();
  for (const [k, rows] of vanished) {
    const news = fresh.get(k);
    if (rows.length === 1 && news?.length === 1) out.set(news[0]!.relPath, rows[0]!);
  }
  return out;
}

/** FTS5 MATCH takes a query language, and a learner types prose. Quote every bare term. */
export function toMatchQuery(raw: string): string {
  const terms = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => t.length > 0);
  if (terms.length === 0) return '';
  // The last term gets a prefix `*` so search feels live as the learner is still typing it.
  return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(' AND ');
}

export function createVaultRepo(db: SqlDatabase): VaultRepo {
  const fileRow = (r: FileRow | undefined) => plain(r);

  return {
    vaults: {
      get: (id) => plain(db.prepare('SELECT * FROM vaults WHERE id = @id').get<VaultRow>({ id })),
      byPath: (rootPath) =>
        plain(db.prepare('SELECT * FROM vaults WHERE root_path = @p').get<VaultRow>({ p: rootPath })),
      insert: (row) => insert(db, 'vaults', row as unknown as Record<string, unknown>),
      touchScan: (id, at) => updateById(db, 'vaults', id, { last_scan_at: at }),
    },

    topics: {
      forVault: (vaultId) =>
        plainAll(
          db
            .prepare('SELECT * FROM topics WHERE vault_id = @v ORDER BY sort_order, name')
            .all<TopicRow>({ v: vaultId }),
        ),
      byRelPath: (vaultId, relPath) =>
        plain(
          db
            .prepare('SELECT * FROM topics WHERE vault_id = @v AND rel_path = @p')
            .get<TopicRow>({ v: vaultId, p: relPath }),
        ),
      insert: (row) => insert(db, 'topics', row as unknown as Record<string, unknown>),
      remove: (id) => void db.prepare('DELETE FROM topics WHERE id = @id').run({ id }),
      setModuleCode: (id, code) => updateById(db, 'topics', id, { module_code: code }),
    },

    files: {
      forVault: (vaultId) =>
        plainAll(db.prepare('SELECT * FROM files WHERE vault_id = @v ORDER BY rel_path').all<FileRow>({ v: vaultId })),
      forTopic: (topicId, vaultId) =>
        plainAll(
          topicId === null
            ? db
                .prepare('SELECT * FROM files WHERE vault_id = @v AND topic_id IS NULL ORDER BY rel_path')
                .all<FileRow>({ v: vaultId })
            : db
                .prepare('SELECT * FROM files WHERE vault_id = @v AND topic_id = @t ORDER BY rel_path')
                .all<FileRow>({ v: vaultId, t: topicId }),
        ),
      get: (id) => fileRow(db.prepare('SELECT * FROM files WHERE id = @id').get<FileRow>({ id })),
      byRelPath: (vaultId, relPath) =>
        fileRow(
          db.prepare('SELECT * FROM files WHERE vault_id = @v AND rel_path = @p').get<FileRow>({ v: vaultId, p: relPath }),
        ),

      /**
       * The incremental part. A file is "unchanged" when its size and mtime both match, which is
       * what makes a re-scan on app focus cheap: only changed rows are written, and only changed
       * rows lose their `indexed_*` stamp and therefore come back round to the indexer.
       *
       * A file whose *topic* changed (the learner promoted a folder) keeps its index: the bytes
       * did not move, only the label did. A file renamed or moved on disk keeps its id when
       * `pairMoves` can recognise it (#39); when it cannot, the new id adopts the old one's rows
       * once its bytes are known (`adopt.ts`).
       */
      sync(vaultId, scanned, topicFor, now) {
        const existing = new Map(
          plainAll(db.prepare('SELECT * FROM files WHERE vault_id = @v').all<FileRow>({ v: vaultId })).map((r) => [
            r.rel_path,
            r,
          ]),
        );
        const counts: SyncCounts = { added: 0, updated: 0, moved: 0, removed: 0, unchanged: 0 };
        const moves = pairMoves(existing, scanned);

        for (const f of scanned) {
          const topicId = topicFor(f.relPath);
          const prev = existing.get(f.relPath);
          const from = prev ? undefined : moves.get(f.relPath);
          if (from) {
            // The same file under a new path: keep its id, and with it its index, its room and
            // its progress. The bytes did not change, so the `indexed_*` stamp stays valid.
            updateById(db, 'files', from.id, { rel_path: f.relPath, name: f.name, topic_id: topicId });
            if (from.name !== f.name) {
              db.prepare('UPDATE file_text SET name = @n WHERE file_id = @f').run({ n: f.name, f: from.id });
            }
            existing.delete(from.rel_path);
            counts.moved += 1;
            continue;
          }
          if (!prev) {
            insert(db, 'files', {
              id: newVaultId('f'),
              vault_id: vaultId,
              topic_id: topicId,
              rel_path: f.relPath,
              name: f.name,
              ext: f.ext,
              kind: f.kind,
              size: f.size,
              mtime_ms: f.mtimeMs,
              sha256: null,
              page_count: null,
              indexed_at: null,
              indexed_size: null,
              indexed_mtime_ms: null,
              index_error: null,
            });
            counts.added += 1;
            existing.delete(f.relPath);
            continue;
          }
          existing.delete(f.relPath);
          const moved = prev.topic_id !== topicId;
          const changed = prev.size !== f.size || prev.mtime_ms !== f.mtimeMs;
          if (!moved && !changed) {
            counts.unchanged += 1;
            continue;
          }
          updateById(db, 'files', prev.id, {
            topic_id: topicId,
            size: f.size,
            mtime_ms: f.mtimeMs,
            ...(changed ? { index_error: null, indexed_at: null, sha256: null, page_count: null } : {}),
          });
          if (changed) counts.updated += 1;
          else counts.unchanged += 1;
        }

        // Whatever is left in `existing` was on disk last time and is not now.
        for (const gone of existing.values()) {
          db.prepare('DELETE FROM file_text WHERE file_id = @f').run({ f: gone.id });
          db.prepare('DELETE FROM files WHERE id = @id').run({ id: gone.id });
          counts.removed += 1;
        }
        db.prepare('UPDATE vaults SET last_scan_at = @t WHERE id = @v').run({ t: now, v: vaultId });
        return counts;
      },

      stale: (vaultId, limit) =>
        plainAll(
          db
            .prepare(
              `SELECT * FROM files
                WHERE vault_id = @v
                  AND kind IN ('pdf','markdown','text','code')
                  AND index_error IS NULL
                  AND (indexed_at IS NULL OR indexed_size IS NOT size OR indexed_mtime_ms IS NOT mtime_ms)
                ORDER BY kind = 'pdf', rel_path
                LIMIT @n`,
            )
            .all<FileRow>({ v: vaultId, n: limit }),
        ),

      markIndexed(id, patch) {
        // A savepoint rather than BEGIN, so this still nests inside a caller's transaction.
        db.exec('SAVEPOINT mark_indexed');
        try {
          updateById(db, 'files', id, {
            indexed_at: patch.at,
            indexed_size: patch.size,
            indexed_mtime_ms: patch.mtimeMs,
            page_count: patch.pageCount,
            sha256: patch.sha256,
            index_error: null,
          });
          if (patch.sha256 !== null) adoptOrphanedFileRows(db, id, patch.sha256);
          db.exec('RELEASE mark_indexed');
        } catch (err) {
          db.exec('ROLLBACK TO mark_indexed');
          db.exec('RELEASE mark_indexed');
          throw err;
        }
      },

      markFailed: (id, at, error) =>
        updateById(db, 'files', id, { indexed_at: at, index_error: error.slice(0, 400) }),

      countsByTopic(vaultId) {
        const rows = db
          .prepare('SELECT topic_id AS t, COUNT(*) AS n FROM files WHERE vault_id = @v GROUP BY topic_id')
          .all<{ t: string | null; n: number }>({ v: vaultId });
        return new Map(rows.map((r) => [r.t, r.n]));
      },

      indexProgress(vaultId) {
        const row = db
          .prepare(
            `SELECT
               SUM(CASE WHEN kind IN ('pdf','markdown','text','code') THEN 1 ELSE 0 END) AS total,
               SUM(CASE WHEN indexed_at IS NOT NULL AND index_error IS NULL THEN 1 ELSE 0 END) AS done,
               SUM(CASE WHEN index_error IS NOT NULL THEN 1 ELSE 0 END) AS failed
             FROM files WHERE vault_id = @v`,
          )
          .get<{ total: number | null; done: number | null; failed: number | null }>({ v: vaultId });
        return { total: row?.total ?? 0, done: row?.done ?? 0, failed: row?.failed ?? 0 };
      },
    },

    text: {
      replace(fileId, name, chunks) {
        db.prepare('DELETE FROM file_text WHERE file_id = @f').run({ f: fileId });
        const stmt = db.prepare(
          'INSERT INTO file_text (body, name, file_id, page) VALUES (@body, @name, @file_id, @page)',
        );
        for (const c of chunks) {
          if (c.body.trim().length === 0) continue;
          stmt.run({ body: c.body, name, file_id: fileId, page: c.page });
        }
      },
      remove: (fileId) => void db.prepare('DELETE FROM file_text WHERE file_id = @f').run({ f: fileId }),
      pages(fileId, from, to) {
        const rows =
          from === null || to === null
            ? db
                .prepare('SELECT page, body FROM file_text WHERE file_id = @f ORDER BY page')
                .all<{ page: number | null; body: string }>({ f: fileId })
            : db
                .prepare(
                  'SELECT page, body FROM file_text WHERE file_id = @f AND page >= @a AND page <= @b ORDER BY page',
                )
                .all<{ page: number | null; body: string }>({ f: fileId, a: from, b: to });
        return rows.map((r) => ({ page: r.page, body: r.body }));
      },
      search(vaultId, query, limit) {
        const match = toMatchQuery(query);
        if (match.length === 0) return [];
        return db
          .prepare(
            `SELECT t.file_id AS file_id, t.page AS page,
                    snippet(file_text, 0, @open, @close, '…', 14) AS snippet
               FROM file_text t
               JOIN files f ON f.id = t.file_id
              WHERE file_text MATCH @q AND f.vault_id = @v
              ORDER BY bm25(file_text, 1.0, 4.0, 0.0, 0.0)
              LIMIT @n`,
          )
          .all<FtsHit>({ q: match, v: vaultId, n: limit, open: SNIPPET_OPEN, close: SNIPPET_CLOSE });
      },
      searchInFile(fileId, query, limit) {
        const match = toMatchQuery(query);
        if (match.length === 0) return [];
        const rows = db
          .prepare(
            `SELECT t.page AS page, t.body AS body
               FROM file_text t
              WHERE file_text MATCH @q AND t.file_id = @f
              ORDER BY bm25(file_text, 1.0, 4.0, 0.0, 0.0)
              LIMIT @n`,
          )
          .all<{ page: number | null; body: string }>({ q: match, f: fileId, n: limit });
        // Ranked by relevance for the cut, then re-ordered by page: a model reading three
        // scattered pages out of order reads them as a contradiction.
        return rows.map((r) => ({ page: r.page, body: r.body })).sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
      },
    },
  };
}
