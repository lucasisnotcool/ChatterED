/**
 * Reading the notes document from the chat side (#48). **Track T6.**
 *
 * The chats need three things from the document T1 owns: which pages a block came from (the
 * *where* of a span thread, in place of the segment the flow used), which objective a block
 * carries (the doc-text attempt gate, and the span thread's `objectiveId`), and which blocks an
 * objective's lesson card should scroll to.
 *
 * All three are reads of `notes_docs.doc_json` through T2's pure helpers, so there is exactly one
 * definition of "the blocks for these pages" in the app. Nothing here writes.
 *
 * **Keyed on the bytes.** `notes_docs.content_sha` is the unique key (migration 020, following
 * 009 and 017); `file_id` is provenance and is only consulted when the caller could not resolve a
 * sha, because a rescan re-mints it (#39).
 */

import type { Node } from 'prosemirror-model';
import { blockAttrs, blockPos, blocksForPages, docFromJson } from '../../shared/doc/schema.js';
import type { LearningObjective, LearningTree } from '../../shared/objectives.js';
import type { SqlDatabase } from '../db/driver.js';
import { plain, plainAll } from '../db/sql.js';

export interface NotesDocRow {
  docId: string;
  contentSha: string;
  fileId: string | null;
  title: string;
  pageCount: number;
  version: number;
  frozen: boolean;
}

interface DocRow {
  id: string;
  content_sha: string;
  file_id: string | null;
  title: string;
  page_count: number;
  version: number;
  doc_json: string;
  frozen: number;
}

/**
 * The parsed document, memoised on `(docId, version)`.
 *
 * `notes:save` bumps the version on every accepted save, so a stale entry is impossible: the
 * cache either matches the row it was parsed from or it is not used. One entry, because the app
 * has one document open at a time; a second file simply replaces it.
 */
let memo: { docId: string; version: number; doc: Node } | null = null;

function parse(row: DocRow): Node | null {
  if (memo && memo.docId === row.id && memo.version === row.version) return memo.doc;
  try {
    const doc = docFromJson(JSON.parse(row.doc_json) as unknown);
    memo = { docId: row.id, version: row.version, doc };
    return doc;
  } catch {
    // A document whose JSON will not parse is one the learner has to re-ingest, not a crash on
    // the way to answering their question: the thread still opens, it just has no page context.
    return null;
  }
}

/** Test seam: drop the parsed-document cache. */
export function resetDocCache(): void {
  memo = null;
}

function toRow(row: DocRow): NotesDocRow {
  return {
    docId: row.id,
    contentSha: row.content_sha,
    fileId: row.file_id,
    title: row.title,
    pageCount: row.page_count,
    version: row.version,
    frozen: row.frozen !== 0,
  };
}

function readRow(db: SqlDatabase, key: { contentSha?: string | null; fileId?: string | null }): DocRow | undefined {
  if (key.contentSha) {
    const row = plain(
      db.prepare('SELECT * FROM notes_docs WHERE content_sha = @sha').get<DocRow>({ sha: key.contentSha }),
    );
    if (row) return row;
  }
  if (key.fileId) {
    return plain(
      db
        .prepare('SELECT * FROM notes_docs WHERE file_id = @f ORDER BY updated_at DESC LIMIT 1')
        .get<DocRow>({ f: key.fileId }),
    );
  }
  return undefined;
}

/** The document row for these bytes (or, failing that, this file), without parsing it. */
export function notesDocRow(
  db: SqlDatabase,
  key: { contentSha?: string | null; fileId?: string | null },
): NotesDocRow | null {
  const row = readRow(db, key);
  return row ? toRow(row) : null;
}

/** The row **and** the parsed document. `doc` is null when the row's JSON is unreadable. */
export function openNotesDoc(
  db: SqlDatabase,
  key: { contentSha?: string | null; fileId?: string | null },
): { row: NotesDocRow; doc: Node | null } | null {
  const row = readRow(db, key);
  if (!row) return null;
  return { row: toRow(row), doc: parse(row) };
}

/** The pages a block came from, in the order the ingest recorded them. Empty when unknown. */
export function pagesForBlock(doc: Node | null, blockId: string): number[] {
  if (!doc) return [];
  const at = blockPos(doc, blockId);
  if (!at) return [];
  const attrs = blockAttrs(at.node);
  // A `slide_figure` is an atom whose page lives on its own attr rather than in `pages`.
  if (at.node.type.name === 'slide_figure' && typeof at.node.attrs.page === 'number') {
    return attrs.pages.length > 0 ? attrs.pages : [at.node.attrs.page as number];
  }
  return attrs.pages;
}

/** How many slides a §5.7 table or diagram is drawn from at most. A section, not a chapter. */
export const SECTION_PAGES_CAP = 10;

/**
 * **The pages of the section a block sits in** (brief §5.7): from the heading above it down to the
 * next heading of that level or higher, every page those top-level blocks came from, ascending.
 * A block above the first heading gets the blocks up to it. Capped, nearest the block's own pages
 * first, because a section of a long deck can run to a chapter and the call is shown one passage.
 */
export function sectionPagesForBlock(doc: Node | null, blockId: string): number[] {
  if (!doc) return [];
  const at = blockPos(doc, blockId);
  if (!at) return [];
  const index = doc.resolve(at.pos).index(0);
  const level = (node: Node): number | null =>
    node.type.name === 'heading' ? ((node.attrs.level as number | undefined) ?? 1) : null;

  let start = 0;
  let sectionLevel: number | null = null;
  for (let i = index; i >= 0; i -= 1) {
    const l = level(doc.child(i));
    if (l !== null) {
      start = i;
      sectionLevel = l;
      break;
    }
  }
  let end = doc.childCount;
  for (let i = Math.max(index, start) + 1; i < doc.childCount; i += 1) {
    const l = level(doc.child(i));
    if (l !== null && (sectionLevel === null || l <= sectionLevel)) {
      end = i;
      break;
    }
  }

  const pages = new Set<number>();
  for (let i = start; i < end; i += 1) {
    doc.child(i).descendants((node) => {
      for (const page of blockAttrs(node).pages) pages.add(page);
      if (node.type.name === 'slide_figure' && typeof node.attrs.page === 'number') pages.add(node.attrs.page as number);
      return true;
    });
    for (const page of blockAttrs(doc.child(i)).pages) pages.add(page);
  }
  const all = [...pages].sort((x, y) => x - y);
  if (all.length <= SECTION_PAGES_CAP) return all;
  const own = pagesForBlock(doc, blockId);
  const centre = own.length > 0 ? own[0]! : all[0]!;
  return all
    .sort((x, y) => Math.abs(x - centre) - Math.abs(y - centre) || x - y)
    .slice(0, SECTION_PAGES_CAP)
    .sort((x, y) => x - y);
}

/** The objective ids the ingest stamped on a block — a hint, never the whole answer (§3). */
export function objectiveHintsOnBlock(doc: Node | null, blockId: string): string[] {
  if (!doc) return [];
  const at = blockPos(doc, blockId);
  return at ? blockAttrs(at.node).objectiveIds : [];
}

/** The deck pages an objective is taught on: `refs[].page`, deduplicated, ascending. */
export function pagesOfObjective(objective: LearningObjective): number[] {
  const pages = new Set<number>();
  for (const ref of objective.refs) {
    if (typeof ref.page === 'number' && Number.isFinite(ref.page)) pages.add(ref.page);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * The objective a block is about, or null.
 *
 * **Exactly one, or none** (the contract's rule). A block whose pages are taught by two
 * objectives is genuinely ambiguous, and guessing one of them would attribute the learner's
 * sentence to something they were not writing about — which is the ledger's verbatim-evidence
 * rule broken at the other end. The ingest's own `objectiveIds` hint wins when it names exactly
 * one objective that is actually in the tree, because it was produced with the block's text in
 * front of it; otherwise the page intersection decides.
 */
export function objectiveForBlock(
  tree: LearningTree | null,
  doc: Node | null,
  blockId: string,
): string | null {
  if (!tree || tree.objectives.length === 0) return null;
  const byId = new Map(tree.objectives.map((o) => [o.id, o]));

  const hinted = [...new Set(objectiveHintsOnBlock(doc, blockId))].filter((id) => byId.has(id));
  if (hinted.length === 1) return hinted[0]!;

  const pages = new Set(pagesForBlock(doc, blockId));
  if (pages.size === 0) return null;
  const hits = tree.objectives.filter((o) => pagesOfObjective(o).some((p) => pages.has(p)));
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * The doc blocks that carry an objective, in document order. The first is where **Start** scrolls.
 *
 * `notes_objective_blocks` is a cache of the page intersection (migration 020), written by
 * whoever computed it last; when it is empty — a fresh ingest, or an objective tree that landed
 * after the doc — the intersection is recomputed here rather than reported as "no blocks", which
 * would make a lesson card's Start do nothing on the first run.
 */
export function blockIdsForObjective(
  db: SqlDatabase,
  doc: Node | null,
  docId: string | null,
  objective: LearningObjective,
): string[] {
  if (docId) {
    const cached = plainAll(
      db
        .prepare(
          `SELECT block_id FROM notes_objective_blocks
            WHERE doc_id = @d AND objective_id = @o ORDER BY ord, block_id`,
        )
        .all<{ block_id: string }>({ d: docId, o: objective.id }),
    ).map((r) => r.block_id);
    if (cached.length > 0) return cached;
  }
  if (!doc) return [];
  const pages = pagesOfObjective(objective);
  return pages.length === 0 ? [] : blocksForPages(doc, pages);
}

/**
 * **Where a lesson starts** (live run, 3 Oct 2026): the objective's first section heading, which
 * Start scrolls to, and the block the lesson's question is filed under and the doc chat is pinned
 * to.
 *
 * It used to be the objective's first block, whatever it was. That was the objectives list, cited
 * to every objective's pages, so all three lessons' Q blocks went in at the top of the notes; and a
 * block an agent added there inherited those pages, so it too became "the first block" of every
 * objective. A section heading carries its section's pages and nothing else.
 *
 * The anchor is the block under the heading, never the heading itself: a Q block between a heading
 * and its takeaway reads as the section's first line (the rule `docedit.underHeading` keeps for
 * Ellie's lines). With no heading among the blocks, both are the first block, as before.
 */
export function lessonBlocks(doc: Node | null, blockIds: readonly string[]): { scrollTo: string | null; anchor: string | null } {
  const first = blockIds[0] ?? null;
  if (doc === null || first === null) return { scrollTo: first, anchor: first };
  const heading = blockIds.find((id) => blockPos(doc, id)?.node.type.name === 'heading') ?? null;
  if (heading === null) return { scrollTo: first, anchor: first };
  let seen = false;
  let done = false;
  let under: string | null = null;
  doc.forEach((node) => {
    if (done) return;
    const { blockId } = blockAttrs(node);
    if (!seen) {
      seen = blockId === heading;
      return;
    }
    // A Q block under the heading is an earlier question, not the section's text: look past it.
    if (node.type.name === 'q_block') return;
    done = true;
    if (node.type.name !== 'heading' && blockId) under = blockId;
  });
  return { scrollTo: heading, anchor: under ?? heading };
}

/** How much of a section Ellie is shown to walk through on a lesson's Start. */
export const LESSON_SECTION_CHARS = 4_000;

/**
 * **The section a lesson is, as text** (2026-10-06, D2; `collab-doc.md` §6 amended): what Ellie
 * walks the learner through on Start. The objective's first section heading, then every top-level
 * block under it up to the next heading of the same or a higher level; without a heading, the
 * objective's own blocks. Questions are left out: an earlier question is not the section's text.
 */
export function lessonSectionText(doc: Node | null, blockIds: readonly string[]): string {
  if (doc === null || blockIds.length === 0) return '';
  const heading = blockIds.find((id) => blockPos(doc, id)?.node.type.name === 'heading') ?? null;
  const parts: string[] = [];
  if (heading === null) {
    for (const id of blockIds) {
      const node = blockPos(doc, id)?.node;
      if (node && node.type.name !== 'q_block') parts.push(node.textContent.trim());
    }
  } else {
    let level: number | null = null;
    let done = false;
    doc.forEach((node) => {
      if (done) return;
      const { blockId } = blockAttrs(node);
      if (level === null) {
        if (blockId === heading) {
          level = (node.attrs.level as number) ?? 2;
          parts.push(node.textContent.trim());
        }
        return;
      }
      if (node.type.name === 'heading' && ((node.attrs.level as number) ?? 2) <= level) {
        done = true;
        return;
      }
      if (node.type.name === 'q_block') return;
      parts.push(node.textContent.trim());
    });
  }
  return parts.filter((p) => p.length > 0).join('\n').slice(0, LESSON_SECTION_CHARS);
}
