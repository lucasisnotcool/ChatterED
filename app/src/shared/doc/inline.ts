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
import { normaliseTexDelimiters } from './tex.js';
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
/**
 * `$$x$$` inside a line is inline maths too (2026-10-03): matched first, or `$x$` inside it left a
 * stray `$` on each side. A line that is *only* a display formula becomes a `math_block` instead
 * (`ops.ts`, `tex.displayMathOf`).
 */
const DISPLAY = /\$\$([^$\n]+?)\$\$/;
/**
 * No space just inside either `$`, and no digit after the closing one, so "$5 and $6" is money
 * and not a formula (the chat's rule, `markdown.ts`).
 */
const MATH = /\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/;
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
    { re: DISPLAY, make: (inner) => [{ text: inner.trim(), ...wearing, tex: inner.trim() }] },
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
  const tokens = tokenise(normaliseTexDelimiters(text), { strong: false, em: false, code: false });
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

/** One marked leaf, on the way back out. `author` and the suggestion marks are not markup. */
function leaf(token: Token): string {
  if (token.tex !== null) return `$${token.tex}$`;
  if (token.code) return `\`${token.text}\``;
  return token.text;
}

/**
 * Tokens → the subset, **one marker per run rather than one per text node**.
 *
 * The difference matters because a text node is split by every mark it does not share — two
 * authors, an edit id, a suggestion — so a single bold phrase written by Ellie and then half
 * kept would come back as `**a****b**` if each node emitted its own markers. Grouping by the
 * formatting mark and nesting outward (`strong`, then `em`, then the leaf) makes
 * `nodesToInline(inlineToNodes(x)) === x` for everything the subset can express, which is what
 * a suggestion's `quote` and a prompt's block text both rely on.
 */
function emphasised(tokens: readonly Token[]): string {
  let out = '';
  let i = 0;
  while (i < tokens.length) {
    const em = tokens[i]!.em;
    let j = i;
    while (j < tokens.length && tokens[j]!.em === em) j++;
    const inner = tokens.slice(i, j).map(leaf).join('');
    out += em ? `*${inner}*` : inner;
    i = j;
  }
  return out;
}

function serialise(tokens: readonly Token[]): string {
  let out = '';
  let i = 0;
  while (i < tokens.length) {
    const strong = tokens[i]!.strong;
    let j = i;
    while (j < tokens.length && tokens[j]!.strong === strong) j++;
    const inner = emphasised(tokens.slice(i, j));
    out += strong ? `**${inner}**` : inner;
    i = j;
  }
  return out;
}

/**
 * ProseMirror inline content → the closed subset. A nested block (a list item's paragraph, a
 * q_block's children, a diagram's nodes) is flattened onto its own line, and a table's row onto
 * one line with its cells: this is text for a prompt or a quote, not a serialisation format, and
 * the document itself is always the JSON.
 */
export function nodesToInline(fragment: Fragment): string {
  const lines: string[] = [];
  let tokens: Token[] = [];
  const flush = (): void => {
    if (tokens.length === 0) return;
    lines.push(serialise(tokens));
    tokens = [];
  };

  /** The `math_inline` mark of the last token pushed, so a formula split across text nodes is one. */
  let lastMath: Mark | null = null;
  fragment.forEach((node) => {
    if (node.isText) {
      const math = has(node.marks, 'math_inline');
      /**
       * **The text is the formula's source, not the mark's `tex`** (2026-10-03). The text is what
       * the learner sees and edits; the attr is what it was written as and goes stale on the first
       * keystroke. And one formula is often several text nodes (a learner edit inside Ellie's
       * formula splits it by author), each of which used to emit the whole `tex` again.
       */
      const previous = tokens.at(-1);
      if (math !== null && lastMath !== null && math.eq(lastMath) && previous?.tex !== null && previous !== undefined) {
        previous.text += node.text ?? '';
        previous.tex = previous.text;
        return;
      }
      lastMath = math;
      tokens.push({
        text: node.text ?? '',
        strong: has(node.marks, 'strong') !== null,
        em: has(node.marks, 'em') !== null,
        code: has(node.marks, 'code') !== null,
        tex: math ? (node.text ?? '') : null,
      });
      return;
    }
    lastMath = null;
    if (node.type.name === 'math_block') {
      tokens.push({ text: '', strong: false, em: false, code: false, tex: node.attrs.tex as string });
      return;
    }
    if (node.type.name === 'table_row') {
      // One line per row, cells in the same ` | ` the outline uses; an empty cell keeps its place.
      flush();
      const cells: string[] = [];
      node.forEach((cell) => cells.push(nodesToInline(cell.content)));
      lines.push(cells.join(' | '));
      return;
    }
    if (node.isBlock) {
      flush();
      const inner = nodesToInline(node.content);
      if (inner.length > 0) lines.push(inner);
    }
  });
  flush();
  return lines.join('\n');
}

/** A block's text as the subset, for a prompt's `quote` or a suggestion's search. */
export function blockToInline(node: Node): string {
  return nodesToInline(node.content);
}
