/**
 * **The closed inline subset, both ways** (`types.ts`: "`text` and `items[]` use the closed
 * inline subset of `renderer/lib/aitext.ts`: `**bold**`, `*em*`, `` `code` `` and `$tex$`.
 * Nothing else is markup.")
 *
 * A model never writes ProseMirror JSON — it writes `DocBlockDraft`s whose text is this subset —
 * and a model is never shown ProseMirror JSON either: `nodesToInline` is how a block comes back
 * out for a prompt or for a suggestion's `quote`. So this file is the one place the two
 * representations meet, and the round trip has to hold.
 *
 * **The subset is `aitext.ts`'s, deliberately narrowed by one.** `aitext.ts` renders bold,
 * italics, maths, paragraphs and lists; paragraphs and lists are *blocks* here (a draft's `kind`
 * decides them), so what is left inline is bold, em, code and inline maths. The two emphasis
 * regexes below are `aitext.ts`'s verbatim, for the reason that file gives: bold before italics
 * so `**x**` is one `strong`, and a non-space next to the marker so `3 * 4 * 5` is arithmetic.
 *
 * `` `code` `` is *in* this subset and out of `aitext.ts`'s — a chat turn showing a literal
 * backtick is a stray character, a lecture note about `argmax` is a code span. `aitext.ts` is
 * unchanged; nothing here renders HTML.
 *
 * **Every text node produced here carries an `author` mark**, because the guard reads nothing
 * else (`schema.ts`) and a span with no author is a span the guard cannot protect or attribute.
 */

import type { Fragment, Mark, Node, Schema } from 'prosemirror-model';
import { authorMark } from './schema.js';
import type { DocAuthor } from './types.js';

/**
 * One inline token: text, the marks it wears, and the TeX source when it is maths.
 *
 * Maths and code are *leaves* — no emphasis is parsed inside them, because a `*` in a formula is
 * a multiplication and a `*` in code is a pointer.
 */
interface Token {
  text: string;
  strong: boolean;
  em: boolean;
  code: boolean;
  tex: string | null;
}

const CODE = /`([^`\n]+)`/;
const MATH = /\$([^$\n]+)\$/;
const STRONG = /\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*/;
const EM = /(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/;

/**
 * Tokenise by **the earliest marker in the string**, ties broken code → maths → bold → em.
 *
 * "Earliest, not by precedence" is the fix for the two cases that a fixed order gets wrong in
 * opposite directions: with maths taken first, `**$x$**` loses its bold and leaves two literal
 * asterisks; with bold taken first, `$a*b*c$` grows an `<em>` inside a formula. Whichever marker
 * *opens* first is the one that encloses the other, which is what both cases want.
 *
 * Code and maths are leaves (their contents are returned as one token, unparsed); bold and em
 * recurse on their contents so `**a `b` c**` is three tokens all wearing `strong`.
 */
function tokenise(text: string, wearing: Omit<Token, 'text' | 'tex'>): Token[] {
  if (text.length === 0) return [];

  const attempts: { re: RegExp; make: (inner: string) => Token[] }[] = [
    { re: CODE, make: (inner) => [{ text: inner, ...wearing, code: true, tex: null }] },
    { re: MATH, make: (inner) => [{ text: inner, ...wearing, tex: inner }] },
    { re: STRONG, make: (inner) => tokenise(inner, { ...wearing, strong: true }) },
    { re: EM, make: (inner) => tokenise(inner, { ...wearing, em: true }) },
  ];

  let best: { at: number; whole: string; inner: string; make: (inner: string) => Token[] } | null = null;
  for (const { re, make } of attempts) {
    const match = re.exec(text);
    if (!match) continue;
    if (best === null || match.index < best.at) {
      best = { at: match.index, whole: match[0], inner: match[1] ?? '', make };
    }
  }
  if (best === null) return [{ text, ...wearing, tex: null }];

  const before = text.slice(0, best.at);
  const after = text.slice(best.at + best.whole.length);
  return [...tokenise(before, wearing), ...best.make(best.inner), ...tokenise(after, wearing)];
}

/**
 * The closed subset → ProseMirror inline content, every span authored.
 *
 * `at` is not in the cross-track signature (the contract writes four parameters); it is optional
 * and defaults to now, so a test can pin the timestamp and `ops.ts` can stamp a whole batch with
 * the batch's own `now` instead of four milliseconds of drift.
 */
export function inlineToNodes(
  schema: Schema,
  text: string,
  author: DocAuthor,
  editId: string | null,
  at?: number,
): Node[] {
  const base = at === undefined ? authorMark(author, editId) : authorMark(author, editId, at);
  return inlineToNodesWith(schema, text, [base]);
}

/**
 * The same, with the marks handed in — how `suggest.ts` gets `suggest_ins` onto the replacement
 * and how an agent's inserted text keeps the author mark the batch already minted.
 */
export function inlineToNodesWith(schema: Schema, text: string, marks: readonly Mark[]): Node[] {
  const tokens = tokenise(text, { strong: false, em: false, code: false });
  const nodes: Node[] = [];
  for (const token of tokens) {
    if (token.text.length === 0) continue;
    const applied: Mark[] = [...marks];
    if (token.tex !== null && schema.marks.math_inline) {
      applied.push(schema.marks.math_inline.create({ tex: token.tex }));
    }
    if (token.code && schema.marks.code) applied.push(schema.marks.code.create());
    if (token.strong && schema.marks.strong) applied.push(schema.marks.strong.create());
    if (token.em && schema.marks.em) applied.push(schema.marks.em.create());
    nodes.push(schema.text(token.text, applied));
  }
  return nodes;
}

function has(marks: readonly Mark[], name: string): Mark | null {
  return marks.find((mark) => mark.type.name === name) ?? null;
}

/**
 * ProseMirror inline content → the closed subset.
 *
 * The markers are re-emitted per text node rather than per run, which can produce `**a****b**`
 * for two adjacent bold spans with different authors — harmless in a prompt, and the round trip
 * still parses back to the same marks. Markers are written outermost-first in the same order
 * `inlineToNodes` reads them, so `nodesToInline(inlineToNodes(x))` is `x` for anything the
 * subset can express.
 */
export function nodesToInline(fragment: Fragment): string {
  let out = '';
  fragment.forEach((node) => {
    if (node.isText) {
      const text = node.text ?? '';
      const math = has(node.marks, 'math_inline');
      if (math) {
        out += `$${(math.attrs.tex as string) || text}$`;
        return;
      }
      let piece = text;
      if (has(node.marks, 'code')) piece = `\`${piece}\``;
      if (has(node.marks, 'em')) piece = `*${piece}*`;
      if (has(node.marks, 'strong')) piece = `**${piece}**`;
      out += piece;
      return;
    }
    if (node.type.name === 'math_block') {
      out += `$${node.attrs.tex as string}$`;
      return;
    }
    // A nested block (a list item's paragraph, a q_block's children): its text, flattened.
    if (node.isBlock) {
      const inner = nodesToInline(node.content);
      if (inner.length > 0) out += out.length > 0 ? `\n${inner}` : inner;
    }
  });
  return out;
}

/** A block's text as the subset, for a prompt's `quote` or a suggestion's search. */
export function blockToInline(node: Node): string {
  return nodesToInline(node.content);
}
