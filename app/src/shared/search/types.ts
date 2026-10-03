/**
 * **What the semantic index embeds** (`docs/research/search.md` §2–§3).
 *
 * Types only. The chunker that produces these is `chunk.ts` (pure); the embedder and the index
 * service in `src/main/search/` consume them.
 */

/** `note`: a group of notes blocks, or one row or card of a composite block. `page`: one slide or page. */
export type ChunkKind = 'note' | 'page';

export interface SearchChunk {
  /**
   * Stable across re-chunking while the blocks it starts at are unchanged:
   * - `note:<notebookId>:<firstBlockId>` for a block group,
   * - `note:<notebookId>:<blockId>#<unitIndex>` for one row of a table or one card of a set,
   * - `page:<notebookId>:<page>` for a page.
   */
  key: string;
  kind: ChunkKind;
  notebookId: string;
  /** Notes: the member top-level block ids, in doc order. Pages: `[]`. */
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
  /** The normalised body text: the source of the hit's snippet. */
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
  /** The same slide in another notebook of the scope, folded into this hit. */
  alsoIn: { notebookId: string; notebookName: string; page: number }[];
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
