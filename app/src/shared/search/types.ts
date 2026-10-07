/**
 * **What the semantic index embeds** (`docs/research/search.md` §2–§3).
 *
 * Types only. The chunker that produces these is `chunk.ts` (pure); the embedder and the index
 * service in `src/main/search/` consume them.
 */

/**
 * `note`: a group of notes blocks, or one row or card of a composite block. `page`: one slide or
 * page. `explain`: a block's stored explain comment (migration 033), embedded on its own and
 * resolving to that block (mode `separate`).
 */
export type ChunkKind = 'note' | 'page' | 'explain';

/**
 * **How search reads the blocks' stored explain comments** (2026-10-07). One switch, so the modes
 * can be measured against each other (`scripts/search-eval.mjs`):
 * - `off`: comments are shown on hits but never matched (search as before 033).
 * - `append`: each note chunk's (and each block unit's) embedded text gets its blocks' explains
 *   appended. The snippet still shows the notes text.
 * - `separate`: each explain is a chunk of its own (`explain:<notebook>:<block>`) that resolves
 *   to its block; the note chunks are unchanged.
 */
export type ExplainMode = 'off' | 'append' | 'separate';
export const EXPLAIN_MODES: readonly ExplainMode[] = ['off', 'append', 'separate'];
/** What ships. Overridden by the setting `search_explain_mode` or `CHATTERED_SEARCH_EXPLAIN`. */
export const DEFAULT_EXPLAIN_MODE: ExplainMode = 'append';
/** The `settings` key that overrides the default (`off`, `append` or `separate`). */
export const SEARCH_EXPLAIN_SETTING = 'search_explain_mode';

export function parseExplainMode(raw: unknown, fallback: ExplainMode = DEFAULT_EXPLAIN_MODE): ExplainMode {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (EXPLAIN_MODES as readonly string[]).includes(v) ? (v as ExplainMode) : fallback;
}

export interface SearchChunk {
  /**
   * Stable across re-chunking while the blocks it starts at are unchanged:
   * - `note:<notebookId>:<firstBlockId>` for a block group,
   * - `tut:<notebookId>:<fileId>:<firstBlockId>` for a group of a tutorial sheet's doc (kind
   *   `note`; `tutorialFileOfKey` reads the sheet back from the key),
   * - `explain:<notebookId>:<blockId>` for a block's explain comment,
   * - `note:<notebookId>:<blockId>#<unitIndex>` for one row of a table or one card of a set,
   * - `page:<notebookId>:<page>` for a page.
   */
  key: string;
  kind: ChunkKind;
  notebookId: string;
  /**
   * Notes: the member top-level block ids, in doc order. Pages: `[]`. Explain: the commented
   * block, then the group member that holds it when that is another block (a list's item).
   */
  blockIds: string[];
  /** Pages: the **notebook** page number given in the input. Notes: `null`. */
  page: number | null;
  /**
   * Provenance, sorted and unique. Notes: the union of the members' pages, where a member with
   * none contributes its section heading's. Pages: `[page]`.
   */
  pages: number[];
  /** The heading path below the doc title, plus the learner's label when one applies (rule 4). */
  section: string[];
  /** The normalised body text: the source of the hit's snippet. Explain: the commented block's own text. */
  text: string;
  /** `header + '\n' + text`: exactly what is embedded (rule 2). */
  embedText: string;
  /** `hashText(embedText)`: an unchanged chunk keeps its vector across a re-index. */
  hash: string;
}

/**
 * One member block of a note group, embedded on its own so the index can highlight the best block
 * inside the top group (rule 7, small-to-big). `embedText` carries the group's header.
 */
export interface BlockUnit {
  notebookId: string;
  blockId: string;
  /** The block's own text, without the header or any appended explain: the snippet's source. */
  text: string;
  embedText: string;
  hash: string;
}

// ── What a search returns (`main/search/index.ts`, channel `search:query`) ─────────────────────

export interface SearchHit {
  /** The chunk's key: stable while its text is. */
  key: string;
  kind: 'note' | 'page';
  notebookId: string;
  notebookName: string;
  /** The notes doc's title, or the deck's file name for a slide. */
  title: string;
  /** Notes: the heading path (and the learner's label). Slides: the deck's name. */
  section: string[];
  /** Notes: the section it is under. Slides: the slide's first line, its title. */
  heading: string;
  /** Two lines' worth of the hit's text: the highlighted block's, for a note. */
  snippet: string;
  /** Cosine similarity (semantic) or BM25 (keyword). Comparable only within one result. */
  score: number;
  /**
   * The notebook page for the slides column. A slide hit: its own page. A note hit: of the pages
   * it came from, the one the query matches best; null when it cites none.
   */
  page: number | null;
  /**
   * The block for the notes column to scroll to and highlight. A note hit: the best-matching block
   * of the group. A slide hit: the best block of the notes that cite that page; null if none do.
   */
  blockId: string | null;
  blockIds: string[];
  /** The pages the hit stands for: a slide's own, a note's provenance. What the eval scores. */
  pages: number[];
  /** The same slide in another notebook of the scope, folded into this hit. */
  alsoIn: { notebookId: string; notebookName: string; page: number }[];
  /**
   * `explain` when the hit came from the block's stored explain comment rather than the notes
   * text: an explain chunk (mode `separate`), or, in mode `append`, a block whose query words are
   * in its explain and not in its text.
   */
  via: 'text' | 'explain';
  /** The stored explain comment of `blockId` (markup, `$tex$`), or null when it has none. */
  explain: string | null;
  /**
   * **A hit in a tutorial sheet's doc** (2026-10-07): which sheet, so the list can label it
   * ("Tutorial 3 · P1b") and the notes column opens that doc rather than the notebook's notes.
   * Null for the notebook's notes and for a slide whose citing notes are the notebook's.
   */
  tutorial: SearchHitTutorial | null;
}

export interface SearchHitTutorial {
  /** The tutorial source's file id (`tutorialContentKey(notebookId, fileId)` is its doc). */
  fileId: string;
  /** The sheet's doc title ("Tutorial 3 Week 5: …"). */
  title: string;
  /** The part's label ("Problem 1 Part B"), or the problem's heading for its stem; null if neither. */
  label: string | null;
}

/** The tutorial sheet a `tut:` chunk key belongs to (`tut:<notebookId>:<fileId>:<block>`), or null. */
export function tutorialFileOfKey(key: string): string | null {
  const m = /^tut:[^:]+:([^:]+):/.exec(key);
  return m ? m[1]! : null;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  /** `keyword` when the embedding model is unavailable: the hits are word matches only. */
  mode: 'semantic' | 'keyword';
  /** Chunks in scope still waiting for their vector (matched by keyword meanwhile). */
  pending: number;
  ms: number;
}

export interface SearchStatus {
  notebooks: number;
  chunks: number;
  pending: number;
  semantic: boolean;
}
