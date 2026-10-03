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
