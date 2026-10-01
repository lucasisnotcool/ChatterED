/**
 * **A text source's "pages"** (`docs/research/notebooks.md` §1, `NOTEBOOK-CONTRACT.md` C3).
 *
 * A PDF has pages and an image is one; a Markdown file, a `.txt` or a Word document converted to
 * text has neither. But the whole notebook doc path is page-keyed (provenance, citation chips,
 * `[p. N]` markers, `notes:pageLines`), so a text source is cut into runs of paragraphs of about
 * `TEXT_PAGE_WORDS` words, and each run is one of its pages. A citation to a long file then
 * points at a place in it rather than at "the whole file".
 *
 * **One function, imported by main and by the renderer.** Main uses it to count a source's pages
 * and to write its `[p. N]` deck text and its FTS rows; the renderer uses it to show page N of
 * a text source. If the two ever cut differently, a chip would open the wrong passage, so the
 * rules are deterministic and the input is the same on both sides: the file's whole text as it
 * decodes from UTF-8 (`vault/extract.ts` stores exactly that; `vault:document` returns it).
 *
 * The rules:
 *
 *  1. Paragraphs are runs of lines separated by a blank line (CRLF and CR read as LF). A
 *     paragraph is never split across pages, unless it alone is over `HUGE_PARAGRAPH_WORDS`.
 *  2. A huge paragraph is split at sentence ends into pieces of at most `TEXT_PAGE_WORDS` words;
 *     a single sentence over that (a pasted table, a minified line) is split by words.
 *  3. Pieces are laid onto pages greedily: the next piece starts a new page when the current
 *     page already holds `TEXT_PAGE_WORDS` words, or when adding it would take the page over
 *     `PAGE_CEILING_WORDS`. So a page is usually 200–500 words and never splits a paragraph.
 *  4. A page is its paragraphs joined by one blank line, each trimmed. Whitespace-only input is
 *     no pages at all, which is what an empty source should count as.
 *
 * Changing any of these re-numbers every text source already in a notebook, whose pages are
 * stored on blocks and objectives; `TEXT_PAGE_WORDS` says so too ("never re-paginated").
 *
 * Pure: no Node, no DOM.
 */
import { TEXT_PAGE_WORDS } from './notebook.js';

/** A page may run this far past `TEXT_PAGE_WORDS` to keep a paragraph whole. */
export const PAGE_CEILING_WORDS = Math.round(TEXT_PAGE_WORDS * 1.25);
/** A paragraph longer than this is split at sentence ends rather than kept whole. */
export const HUGE_PARAGRAPH_WORDS = PAGE_CEILING_WORDS;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Rule 2: a huge paragraph as pieces of at most `TEXT_PAGE_WORDS` words, cut at sentence ends. */
function splitHuge(paragraph: string): string[] {
  // A sentence ends at . ! or ? (optionally closed by a quote or bracket) followed by space.
  const sentences = paragraph.split(/(?<=[.!?]["'”’)\]]?)\s+/).filter((s) => s.length > 0);
  const pieces: string[] = [];
  let current: string[] = [];
  let words = 0;
  const flush = () => {
    if (current.length > 0) pieces.push(current.join(' '));
    current = [];
    words = 0;
  };
  for (const sentence of sentences) {
    const n = wordCount(sentence);
    if (n > TEXT_PAGE_WORDS) {
      // One sentence longer than a page: cut it by words, as evenly as the page size allows.
      flush();
      const tokens = sentence.split(/\s+/).filter((t) => t.length > 0);
      for (let i = 0; i < tokens.length; i += TEXT_PAGE_WORDS) {
        pieces.push(tokens.slice(i, i + TEXT_PAGE_WORDS).join(' '));
      }
      continue;
    }
    if (words > 0 && words + n > TEXT_PAGE_WORDS) flush();
    current.push(sentence);
    words += n;
  }
  flush();
  return pieces;
}

/**
 * Split a text source into its pages. Page `i` of the result is the source's page `i + 1`.
 * Deterministic: the same text always gives the same pages.
 */
export function paginateText(text: string): string[] {
  const normalised = text.replace(/\r\n?/g, '\n');
  const paragraphs = normalised
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pieces: { body: string; words: number }[] = [];
  for (const paragraph of paragraphs) {
    const n = wordCount(paragraph);
    if (n > HUGE_PARAGRAPH_WORDS) {
      for (const piece of splitHuge(paragraph)) pieces.push({ body: piece, words: wordCount(piece) });
    } else {
      pieces.push({ body: paragraph, words: n });
    }
  }

  const pages: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const piece of pieces) {
    if (current.length > 0 && (words >= TEXT_PAGE_WORDS || words + piece.words > PAGE_CEILING_WORDS)) {
      pages.push(current.join('\n\n'));
      current = [];
      words = 0;
    }
    current.push(piece.body);
    words += piece.words;
  }
  if (current.length > 0) pages.push(current.join('\n\n'));
  return pages;
}
