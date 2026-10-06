/**
 * **Stored comments on notes blocks** (migration 033; `shared/doc/comments.ts`).
 *
 * Read by the notes editor (the badge) and by search (`main/search/index.ts`); written only by
 * the headless importer (`scripts/import-comments.mjs`, through `importComments`), with the app
 * quit. No policy here beyond checking that a line names a real doc and a block in it.
 */
import type { SqlDatabase } from '../driver.js';
import { plainAll } from '../sql.js';
import {
  COMMENT_MAX_CHARS,
  blockIdsInDoc,
  type BlockCommentKind,
  type BlockCommentView,
} from '../../../shared/doc/comments.js';

interface CommentRow {
  doc_id: string;
  block_id: string;
  kind: BlockCommentKind;
  body: string;
  text_sha: string;
  model: string;
  created_at: string;
  updated_at: string;
}

function toView(row: CommentRow): BlockCommentView {
  return { blockId: row.block_id, kind: row.kind, body: row.body, model: row.model, updatedAt: row.updated_at };
}

export interface CommentsRepo {
  /** A doc's comments, in block-id order. */
  forDoc(docId: string, kind?: BlockCommentKind): BlockCommentView[];
  /** A notebook's doc's comments (`notes_docs.content_sha = 'nb:<id>'`). */
  forNotebook(notebookId: string, kind?: BlockCommentKind): BlockCommentView[];
  /** Changes whenever a notebook's comments do: count and newest write. For search's freshness. */
  signature(notebookId: string): string;
}

const BY_NOTEBOOK = `SELECT c.* FROM block_comments c JOIN notes_docs d ON d.id = c.doc_id
  WHERE d.content_sha = @k AND c.kind = @kind ORDER BY c.block_id`;

export function commentsRepo(db: SqlDatabase): CommentsRepo {
  return {
    forDoc(docId, kind = 'explain') {
      return plainAll(
        db
          .prepare('SELECT * FROM block_comments WHERE doc_id = @d AND kind = @kind ORDER BY block_id')
          .all<CommentRow>({ d: docId, kind }),
      ).map(toView);
    },
    forNotebook(notebookId, kind = 'explain') {
      return plainAll(db.prepare(BY_NOTEBOOK).all<CommentRow>({ k: `nb:${notebookId}`, kind })).map(toView);
    },
    signature(notebookId) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n, MAX(c.updated_at) AS at FROM block_comments c JOIN notes_docs d ON d.id = c.doc_id
           WHERE d.content_sha = @k`,
        )
        .get<{ n: number; at: string | null }>({ k: `nb:${notebookId}` });
      return `${String(row?.n ?? 0)}@${row?.at ?? ''}`;
    },
  };
}

// ── the importer ────────────────────────────────────────────────────────────────────────────

export interface ImportReport {
  /** Lines read (non-blank). */
  lines: number;
  inserted: number;
  updated: number;
  /** The same body, sha and model as stored: nothing written. */
  unchanged: number;
  skipped: { line: number; reason: string }[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Upsert `explain` comments from parsed JSONL lines (`{doc_id, block_id, text_sha, body, model}`;
 * other fields ignored). One transaction: all of it or none. A line is skipped, with its reason,
 * when a field is missing, its doc does not exist, or its block is not in that doc. The newest
 * line wins when one block appears twice. `dryRun` checks and counts without writing.
 */
export function importComments(
  db: SqlDatabase,
  lines: readonly unknown[],
  o: { now: string; dryRun?: boolean },
): ImportReport {
  const report: ImportReport = { lines: lines.length, inserted: 0, updated: 0, unchanged: 0, skipped: [] };
  const docs = new Map<string, Set<string> | null>();
  const blocksOf = (docId: string): Set<string> | null => {
    if (!docs.has(docId)) {
      const row = db.prepare('SELECT doc_json FROM notes_docs WHERE id = @d').get<{ doc_json: string }>({ d: docId });
      docs.set(docId, row ? blockIdsInDoc(row.doc_json) : null);
    }
    return docs.get(docId) ?? null;
  };

  const wanted = new Map<string, { line: number; doc: string; block: string; body: string; sha: string; model: string }>();
  lines.forEach((raw, i) => {
    const line = i + 1;
    const o2 = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const doc = str(o2?.doc_id)?.trim() ?? '';
    const block = str(o2?.block_id)?.trim() ?? '';
    const body = (str(o2?.body) ?? '').trim();
    const sha = str(o2?.text_sha)?.trim() ?? '';
    const model = str(o2?.model)?.trim() ?? '';
    if (!o2) return void report.skipped.push({ line, reason: 'not a JSON object' });
    if (!doc || !block) return void report.skipped.push({ line, reason: 'doc_id and block_id are required' });
    if (!body) return void report.skipped.push({ line, reason: 'empty body' });
    if (body.length > COMMENT_MAX_CHARS) return void report.skipped.push({ line, reason: `body over ${String(COMMENT_MAX_CHARS)} characters` });
    const blocks = blocksOf(doc);
    if (!blocks) return void report.skipped.push({ line, reason: `no notes doc ${doc}` });
    if (!blocks.has(block)) return void report.skipped.push({ line, reason: `block ${block} is not in ${doc}` });
    wanted.set(`${doc}\u0000${block}`, { line, doc, block, body, sha, model });
  });

  const existing = db.prepare(
    "SELECT body, text_sha, model FROM block_comments WHERE doc_id = @d AND block_id = @b AND kind = 'explain'",
  );
  const upsert = db.prepare(
    `INSERT INTO block_comments (doc_id, block_id, kind, body, text_sha, model, created_at, updated_at)
     VALUES (@d, @b, 'explain', @body, @sha, @model, @now, @now)
     ON CONFLICT (doc_id, block_id, kind) DO UPDATE SET body = @body, text_sha = @sha, model = @model, updated_at = @now`,
  );
  if (!o.dryRun) db.exec('SAVEPOINT import_comments');
  try {
    for (const w of wanted.values()) {
      const had = existing.get<{ body: string; text_sha: string; model: string }>({ d: w.doc, b: w.block });
      if (had && had.body === w.body && had.text_sha === w.sha && had.model === w.model) {
        report.unchanged += 1;
        continue;
      }
      if (had) report.updated += 1;
      else report.inserted += 1;
      if (!o.dryRun) upsert.run({ d: w.doc, b: w.block, body: w.body, sha: w.sha, model: w.model, now: o.now });
    }
    if (!o.dryRun) db.exec('RELEASE import_comments');
  } catch (err) {
    if (!o.dryRun) {
      db.exec('ROLLBACK TO import_comments');
      db.exec('RELEASE import_comments');
    }
    throw err;
  }
  return report;
}

/** JSONL text → one parsed value per non-blank line; a line that is not JSON becomes `null`. */
export function parseJsonl(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return null;
      }
    });
}
