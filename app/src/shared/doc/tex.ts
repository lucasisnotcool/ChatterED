/**
 * **One notation for maths, whoever wrote it** (2026-10-03).
 *
 * The notes and the chat read `$…$` (inline) and `$$…$$` (display), the closed subset's own
 * notation (`inline.ts`, `aitext.ts`). Models and pasted text also use the LaTeX delimiters
 * `\(…\)` and `\[…\]`, which reached the learner as raw source. They are rewritten here, once, so
 * every reader downstream sees one notation. Pure, and shared by main and the renderer.
 */

const DISPLAY_BRACKETS = /\\\[([\s\S]+?)\\\]/g;
const INLINE_PARENS = /\\\(([\s\S]+?)\\\)/g;

/** `\(x\)` → `$x$` and `\[x\]` → `$$x$$`. Everything else, including `$` itself, is untouched. */
export function normaliseTexDelimiters(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text;
  return text
    .replace(DISPLAY_BRACKETS, (_whole, inner: string) => `$$${inner.trim()}$$`)
    .replace(INLINE_PARENS, (_whole, inner: string) => `$${inner.trim()}$`);
}

/**
 * The TeX of a text that is **one display formula and nothing else** (`$$x$$` or `\[x\]`), or
 * null. A paragraph like that is a formula block, not a sentence with a formula in it.
 */
export function displayMathOf(text: string): string | null {
  const match = /^\$\$([\s\S]+?)\$\$$/.exec(normaliseTexDelimiters(text.trim()));
  const tex = match?.[1]?.trim() ?? '';
  return tex.length > 0 ? tex : null;
}

/** One piece of a line: plain text, or a formula's TeX (`display` when it was written `$$…$$`). */
export interface MathSegment {
  text: string;
  tex: string | null;
  display: boolean;
}

const SEGMENT = /\$\$([^$\n]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

/**
 * A line split into text and formulas, with nothing else parsed: what a paste needs, where `**`
 * and `*` are the source's own characters. Same rules as `inline.ts` (`$$x$$`, `$x$` with no space
 * just inside, no digit after, so "$5 and $6" is money); `\(…\)` and `\[…\]` are read too.
 */
export function mathSegments(line: string): MathSegment[] {
  const text = normaliseTexDelimiters(line);
  const out: MathSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(SEGMENT)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), tex: null, display: false });
    const tex = (match[1] ?? match[2] ?? '').trim();
    out.push({ text: tex, tex, display: match[1] !== undefined });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), tex: null, display: false });
  return out;
}

/** True when a text has anything `mathSegments` would turn into a formula. */
export function hasMathDelimiters(text: string): boolean {
  return /\$|\\\(|\\\[/.test(text) && mathSegments(text).some((s) => s.tex !== null);
}
