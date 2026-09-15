/**
 * The body of an AI card, as HTML.
 *
 * Deliberately **not** `renderMarkdown()`. A card written by Ellie, Max or the REFERENCE voice is
 * a few sentences of prose that may contain notation; it is not a document, and running it
 * through marked would let a stray `#` or `>` restyle a turn, and a stray `<img>` reach the DOM.
 * So: escape everything, then put back exactly two things — paragraph breaks, and maths.
 *
 * **Maths is typeset with KaTeX in the app's own style, never in the slide's**
 * (`pdf-fidelity-segmentation.md` §C4): "Matching Beamer's typeface would make agent-written
 * maths visually indistinguishable from the lecturer's — which is the exact confusion S5 exists
 * to prevent, and in a maths module it is the confusion with the highest cost." KaTeX's own
 * Computer Modern faces are overridden in `AiSegment.svelte` for the same reason.
 *
 * `$…$` is inline, `$$…$$` is display. A lone `$` is a dollar sign and is left alone — the delimiter
 * has to close on the same line for it to be read as maths at all.
 */
import katex from 'katex';
import { escapeHtml } from './markdown.js';

/** The rule `reference.ts` draws between the answer and the hand-back line. */
export const RULE_LINE = '───';

function tex(expression: string, display: boolean): string {
  try {
    return katex.renderToString(expression, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    // A broken formula shows as what was written. Never an error card: the rest of the turn is
    // still worth reading, and the learner can see the source.
    return `<code class="math-error">${escapeHtml(display ? `$$${expression}$$` : `$${expression}$`)}</code>`;
  }
}

/**
 * One paragraph's inline content: escaped text with `$…$` and `$$…$$` typeset.
 *
 * The escape happens **before** the maths is put back, so a `<` inside a formula reaches KaTeX
 * as `&lt;` — which KaTeX renders as `<` — while a `<` outside one can never reach the DOM as a
 * tag. Nothing in this file writes raw learner or model text into HTML.
 */
function inline(text: string): string {
  const parts: string[] = [];
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index;
    parts.push(escapeHtml(text.slice(last, at)));
    parts.push(match[1] !== undefined ? tex(match[1], true) : tex(match[2]!, false));
    last = at + match[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join('');
}

export interface AiBody {
  /** The answer itself, as HTML. */
  html: string;
  /**
   * The hand-back line, split off when the body carries one. `reference.ts` composes a REFERENCE
   * card as `answer ␤␤ ─── ␤ hand-back`, and §B1's sketch draws the rule and the line as chrome
   * below the answer rather than as part of it — so the card renders them as chrome.
   */
  handBack: string | null;
}

/**
 * Split an agent or reference body into its answer and its hand-back line, and typeset both.
 *
 * The split is on the rule `reference.ts` writes, and only when it is on a line of its own, so a
 * turn that happens to contain a horizontal-bar character mid-sentence is untouched.
 */
export function aiBody(body: string): AiBody {
  const lines = body.split('\n');
  const ruleAt = lines.findIndex((l) => l.trim() === RULE_LINE);
  const answer = ruleAt >= 0 ? lines.slice(0, ruleAt).join('\n') : body;
  const handBack = ruleAt >= 0 ? lines.slice(ruleAt + 1).join('\n').trim() : null;
  return { html: paragraphs(answer), handBack: handBack && handBack.length > 0 ? handBack : null };
}

/** Blank-line-separated paragraphs. A single newline inside one is a line break, not a paragraph. */
export function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${inline(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** The one-line form a collapsed answer card shows (`pivot-spec.md` §C4: "author line + ~40 chars"). */
export function collapsedLine(body: string, cap = 72): string {
  const first = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  return first.length <= cap ? first : `${first.slice(0, cap).replace(/[\s,;:]+$/, '')}…`;
}
