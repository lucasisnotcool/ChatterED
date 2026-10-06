/**
 * **Stored comments on notes blocks** (migration 033, 2026-10-07).
 *
 * A block can carry a comment written ahead of time. The one kind is `explain`: what Ellie would
 * answer if the learner pressed Explain on that line, so it can be read with no network (an
 * open-book exam). Comments live beside the doc (`block_comments`), never in `doc_json`.
 *
 * Pure: the types, the plain-text form search embeds, and the walk that finds a doc's block ids.
 */

export type BlockCommentKind = 'explain';

/** One comment as the renderer reads it (`notes:comments`). */
export interface BlockCommentView {
  blockId: string;
  kind: BlockCommentKind;
  /** The inline markup subset (**bold**, *italic*, `code`, $tex$), paragraphs and lists. */
  body: string;
  model: string;
  updatedAt: string;
}

/** One line of the importer's JSONL (`scripts/import-comments.mjs`). Extra fields are ignored. */
export interface BlockCommentInput {
  doc_id: string;
  block_id: string;
  /** A hash of the block text the comment explains, as its writer computed it. Opaque here. */
  text_sha: string;
  body: string;
  model: string;
}

/** The longest body the importer accepts. An explanation, not a chapter. */
export const COMMENT_MAX_CHARS = 8000;

/**
 * The body as plain text, for embedding and keyword matching: markers off, TeX kept as its source
 * (`$h(s) \le h^*(s)$` → `h(s) \le h^*(s)`), list markers off, lines kept.
 */
export function explainPlainText(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/\$\$([\s\S]+?)\$\$/g, ' $1 ')
    .replace(/\\\(([\s\S]+?)\\\)/g, ' $1 ')
    .replace(/\\\[([\s\S]+?)\\\]/g, ' $1 ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*/g, '$1')
    .replace(/(^|[^*\\])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1$2')
    .replace(/^ {0,3}([-*•]|\d{1,3}[.)])\s+/gm, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Every `blockId` anywhere in a ProseMirror JSON doc (or its `doc_json` string). */
export function blockIdsInDoc(doc: unknown): Set<string> {
  const out = new Set<string>();
  let root: unknown = doc;
  if (typeof doc === 'string') {
    try {
      root = JSON.parse(doc) as unknown;
    } catch {
      return out;
    }
  }
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const n = node as { attrs?: { blockId?: unknown }; content?: unknown };
    if (typeof n.attrs?.blockId === 'string' && n.attrs.blockId.length > 0) out.add(n.attrs.blockId);
    if (Array.isArray(n.content)) for (const child of n.content as unknown[]) walk(child);
  };
  walk(root);
  return out;
}
