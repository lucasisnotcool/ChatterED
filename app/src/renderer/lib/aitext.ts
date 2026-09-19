/**
 * The body of an AI card, as HTML.
 *
 * Deliberately **not** `renderMarkdown()`. A card written by Ellie, Max or the REFERENCE voice is
 * a few sentences of prose that may contain notation; it is not a document, and running it
 * through marked would let a stray `#` or `>` restyle a turn, and a stray `<img>` reach the DOM.
 * So: escape everything, then put back a **closed subset** and nothing else.
 *
 * ## The subset (issue #41)
 *
 * The agents have always written markdown — the prompts ask for it — and this renderer showed
 * it raw, so Lucas's transcripts are full of literal `**Classical planning**` and numbered lists
 * flattened into one paragraph. The fix is not "run a markdown parser"; it is to name the five
 * things an agent turn is allowed to be and escape the rest:
 *
 *   1. paragraphs (blank-line separated; a single newline is a break)
 *   2. `**bold**`
 *   3. `*italics*`
 *   4. numbered lists (`1.`, and the number it actually starts at is kept)
 *   5. bulleted lists (`-`, `*`, `•`)
 *
 * plus inline `$…$` and display `$$…$$` maths, which predate this and are unchanged.
 *
 * Everything outside that list stays literal text: `# heading`, `> quote`, `[link](url)`,
 * `` `code` ``, a table, and above all raw HTML. There is no configuration and no escape hatch,
 * because the security property this file is here to hold — *no model-written string ever
 * becomes a tag* — is only checkable if the set of tags this file can emit is finite and short.
 * It is: `<p> <br> <strong> <em> <ul> <ol> <li>`, one `<button>` (below), and KaTeX's own output.
 *
 * ## The one added tag: a `p. N` that the deck actually has (issue #47, §3)
 *
 * `attempt-first.md` §3 asks the Tester to ground every point in its feedback as `p. N: "…"`,
 * quoting the page's own words. §3 then says that a `p. N` which matches a card's page **may be
 * made clickable** — a citation the learner can check in one gesture rather than by scrolling and
 * counting, which is the whole argument of DG2 (R6's 11-of-21 wrong verdicts went unchallenged).
 *
 * The rules that keep this from being a hole:
 *
 *   1. It is a `<button>`, never an `<a href>`: there is no URL, nothing navigates, and a model
 *      cannot influence where it goes. The only model-derived part is **an integer** parsed out of
 *      the text, and it is re-emitted as `String(number)`.
 *   2. It runs on **already-escaped** text, after emphasis, so nothing new can become a tag.
 *   3. It fires only for a page in `pages` — the deck's own page numbers, from the caller. A
 *      citation to a page this document does not have is left as plain text, because a dead link
 *      to a slide that is not there is worse than no link.
 *   4. No `pages` means no buttons, so every other caller of this module is unchanged.
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
 * `**bold**` and `*italics*`, applied to text that has **already been escaped**.
 *
 * That order is the whole safety argument. By the time this runs there is no `<` left in the
 * string that came from the model — it is `&lt;` — so the only angle brackets in the result are
 * the four tags written here. A `*` inside a formula never reaches this function at all, because
 * `inline()` hands it the non-maths spans only.
 *
 * Bold is taken before italics so `**x**` is one strong and not two nested ems. Both require a
 * non-space next to the marker (`* 3 * 4` is multiplication, not emphasis) and neither may cross
 * a blank line, which is a block boundary and has already split the text before we get here.
 */
function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
}

/**
 * `p. 3`, `p.3`, `pp. 3` or `page 3` → a button, when the deck has that page.
 *
 * Applied to text that has **already been escaped and emphasised**, for the reason `emphasis()`
 * gives: there is no `<` left from the model, so the only markup in the result is what this
 * function writes. The page number is re-emitted from a parsed integer and never from the matched
 * substring, which is what makes the attribute injection-proof rather than merely escaped.
 *
 * The word is kept as the learner wrote it — `p. 3` stays `p. 3` and `page 3` stays `page 3` —
 * because a citation the app has silently reworded is a citation the learner cannot match against
 * what the Tester actually said.
 */
const PAGE_REF = /\b(pp?\.\s?|page\s)(\d{1,4})\b/gi;

function pageRefs(escaped: string, pages: readonly number[]): string {
  if (pages.length === 0) return escaped;
  return escaped.replace(PAGE_REF, (whole, word: string, digits: string) => {
    const page = Number.parseInt(digits, 10);
    if (!Number.isInteger(page) || !pages.includes(page)) return whole;
    return (
      `<button type="button" class="pageref" data-page="${String(page)}"` +
      ` title="Go to page ${String(page)} in this document">${escapeHtml(word)}${String(page)}</button>`
    );
  });
}

/**
 * One block's inline content: escaped text with `$…$` and `$$…$$` typeset and emphasis applied.
 *
 * The escape happens **before** the maths is put back, so a `<` inside a formula reaches KaTeX
 * as `&lt;` — which KaTeX renders as `<` — while a `<` outside one can never reach the DOM as a
 * tag. Nothing in this file writes raw learner or model text into HTML.
 *
 * `pages` never reaches the maths spans: a `p` inside a formula is a variable, and `p.3` in TeX
 * is not a citation.
 */
function inline(text: string, pages: readonly number[]): string {
  const parts: string[] = [];
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index;
    parts.push(pageRefs(emphasis(escapeHtml(text.slice(last, at))), pages));
    parts.push(match[1] !== undefined ? tex(match[1], true) : tex(match[2]!, false));
    last = at + match[0].length;
  }
  parts.push(pageRefs(emphasis(escapeHtml(text.slice(last))), pages));
  return parts.join('');
}

/** A bullet: `-`, `*` or `•`, up to three spaces in. `*` is a bullet only with a space after it. */
const BULLET = /^ {0,3}([-*•])\s+(.*)$/;
/** `1.` or `1)`, up to three spaces in. The number it starts at is kept, so 3. is not renumbered. */
const NUMBER = /^ {0,3}(\d{1,3})[.)]\s+(.*)$/;

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; start: number; items: string[] };

/**
 * Lines → blocks.
 *
 * A blank line closes whatever is open. A marker line opens (or extends) a list. Anything else
 * is prose — appended to the open paragraph, or, when a list is open, to that list's last item,
 * which is how a model's wrapped list item stays one item instead of becoming a stray paragraph
 * between two `<ol>`s.
 */
function blockify(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null;
  const close = (): void => {
    if (open) blocks.push(open);
    open = null;
  };
  for (const line of lines) {
    if (line.trim().length === 0) {
      close();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (open?.kind !== 'ul') {
        close();
        open = { kind: 'ul', items: [] };
      }
      open.items.push(bullet[2] ?? '');
      continue;
    }
    const numbered = NUMBER.exec(line);
    if (numbered) {
      if (open?.kind !== 'ol') {
        close();
        open = { kind: 'ol', start: Number(numbered[1]), items: [] };
      }
      open.items.push(numbered[2] ?? '');
      continue;
    }
    if (open?.kind === 'ul' || open?.kind === 'ol') {
      // A continuation of the item above, not a new paragraph wedged between list items.
      open.items[open.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    if (open?.kind !== 'p') {
      close();
      open = { kind: 'p', lines: [] };
    }
    open.lines.push(line);
  }
  close();
  return blocks;
}

/** A block's text, with single newlines kept as breaks. */
function flowed(text: string, pages: readonly number[]): string {
  return inline(text, pages).replace(/\n/g, '<br>');
}

function renderBlock(block: Block, pages: readonly number[]): string {
  if (block.kind === 'p') return `<p>${flowed(block.lines.join('\n'), pages)}</p>`;
  const items = block.items.map((item) => `<li>${flowed(item, pages)}</li>`).join('');
  if (block.kind === 'ul') return `<ul>${items}</ul>`;
  return `<ol${block.start === 1 ? '' : ` start="${block.start}"`}>${items}</ol>`;
}

/**
 * The pages this document has, so a `p. N` in a Tester's grounds can be made clickable (§3).
 * Omit it — as every caller but the flow's own card does — and no button is written at all.
 */
export interface AiTextOptions {
  pages?: readonly number[];
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
export function aiBody(body: string, options: AiTextOptions = {}): AiBody {
  const lines = body.split('\n');
  const ruleAt = lines.findIndex((l) => l.trim() === RULE_LINE);
  const answer = ruleAt >= 0 ? lines.slice(0, ruleAt).join('\n') : body;
  const handBack = ruleAt >= 0 ? lines.slice(ruleAt + 1).join('\n').trim() : null;
  return {
    html: paragraphs(answer, options),
    handBack: handBack && handBack.length > 0 ? handBack : null,
  };
}

/**
 * The subset, rendered. Blank-line-separated paragraphs, numbered and bulleted lists, emphasis
 * and maths — and every other character of the model's turn as literal escaped text.
 */
export function paragraphs(text: string, options: AiTextOptions = {}): string {
  const pages = options.pages ?? [];
  return blockify(text.trim().split('\n')).map((b) => renderBlock(b, pages)).join('');
}

/**
 * The turn with its markers taken off, for the places that need a string rather than HTML — the
 * collapsed one-liner, an `aria-label`, a tooltip. Not a security boundary: the callers put this
 * in a text node. It exists so a collapsed card does not read `**Classical planning** handles…`.
 */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1$2')
    .replace(/^ {0,3}([-*•]|\d{1,3}[.)])\s+/gm, '');
}

/** The one-line form a collapsed answer card shows (`pivot-spec.md` §C4: "author line + ~40 chars"). */
export function collapsedLine(body: string, cap = 72): string {
  const first = plainText(body).split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  return first.length <= cap ? first : `${first.slice(0, cap).replace(/[\s,;:]+$/, '')}…`;
}
