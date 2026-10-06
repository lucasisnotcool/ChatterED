/**
 * **What a Max turn may say, decided in code** (Lucas's decision of 2026-10-06, D3 and D4;
 * `collab-doc.md` §4.2, §5.2 and §5.3, amended 2026-10-06).
 *
 * "The model proposes, code decides." The model writes the words of a feedback turn and a question;
 * code reads them, and where the words and the record would disagree, the record wins and the
 * words are corrected before the turn is stored:
 *
 *  - **One verdict per message, matching the logged outcome** (`settleVerdict`). In the 2026-10-05
 *    run a feedback turn opened *Well done.*, quoted the page, noticed the page said the opposite,
 *    and ended *Not yet.*; the outcome was read off the first line, so the wrong word "fewer" was
 *    stored as *you got this*. A message with two verdicts now keeps the more cautious one, and a
 *    message with none says the one code will log.
 *  - **No question tail after *Well done* or a released answer** (`dropQuestionTail`). Twelve
 *    "Why…?" tails followed a check in those runs; none was answered, and seven asked for a reason
 *    the same message had just given.
 *  - **The question alone goes into the notes** (`questionText`, `questionLine`). 26 of 30
 *    questions written into the notes carried the chat's preamble ("Max here. This one tests the
 *    statement, not you, and a rough answer is fine.").
 *
 * Pure: strings in, strings out, nothing outside `core/`.
 */

/** The three verdicts, in the words the feedback turn opens with (`room/flow.ts` reads the same). */
export type TurnVerdict = 'complete' | 'partial' | 'not_yet';

export const VERDICT_PHRASE: Record<TurnVerdict, string> = {
  complete: 'Well done.',
  partial: 'Partly there.',
  not_yet: 'Not yet.',
};

/** Most cautious first: on a conflict the lower mark is the one the learner can still act on. */
const CAUTION: readonly TurnVerdict[] = ['not_yet', 'partial', 'complete'];

/** Markup a model puts in front of a verdict: emphasis, a quote mark, a blockquote. */
const LEAD = /^[\s*_>“"'`]+/;

/**
 * A verdict phrase standing as its own opener: "Well done." / "**Not yet.**" / "Partly there!" /
 * "Not yet, but…". The punctuation is what tells it from prose ("not yet known").
 */
const VERDICT_AT_START = /^(well done|partly there|not yet)[\s*_]*[.!,:;\u2014\u2013]/i;

function verdictOfPhrase(phrase: string): TurnVerdict {
  const p = phrase.toLowerCase();
  if (p === 'well done') return 'complete';
  if (p === 'not yet') return 'not_yet';
  return 'partial';
}

/**
 * Sentences and lines, each with where it starts. A verdict is read only at the start of one, so
 * "the cost is not yet known." is prose and "Not yet." is a verdict.
 */
function segments(text: string): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = [];
  // After a full stop, ! or ?, past a closing quote or bracket and any closing emphasis; never
  // after "p." or "pp.", which open a page citation rather than end a sentence.
  const boundary = /(?<=[.!?][\u201d"')\]]*)(?<!\bpp?\.)[*_]*[ \t]+|\s*\n+\s*/g;
  let at = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index ?? 0;
    if (end > at) out.push({ start: at, text: text.slice(at, end) });
    at = end + match[0].length;
  }
  if (at < text.length) out.push({ start: at, text: text.slice(at) });
  return out;
}

interface Found {
  verdict: TurnVerdict;
  /** The span of the phrase, its markup and the space after it. */
  from: number;
  to: number;
}

function findVerdicts(text: string): Found[] {
  const found: Found[] = [];
  for (const seg of segments(text)) {
    const lead = LEAD.exec(seg.text)?.[0].length ?? 0;
    const match = VERDICT_AT_START.exec(seg.text.slice(lead));
    if (!match) continue;
    // Past the closing emphasis and the space after it, so taking the phrase out leaves no "** ".
    let to = seg.start + lead + match[0].length;
    while (/[*_]/.test(text[to] ?? '')) to += 1;
    while (/[ \t]/.test(text[to] ?? '')) to += 1;
    found.push({ verdict: verdictOfPhrase(match[1]!), from: seg.start, to });
  }
  return found;
}

/** Every verdict the message states, in order. */
export function verdictsIn(text: string): TurnVerdict[] {
  return findVerdicts(text).map((f) => f.verdict);
}

export interface SettledVerdict {
  /** The text to store: exactly one verdict, first, and it is `verdict`. */
  text: string;
  verdict: TurnVerdict;
  /**
   * What was done to the words: `none` (one verdict, first, matching), `added` (none was stated, so
   * the logged one was put first), `corrected` (two or more, or the wrong one, or not first).
   */
  change: 'none' | 'added' | 'corrected';
}

/**
 * **One verdict, first, and the one that is logged.**
 *
 * `logged` is the verdict code already holds when it has one of its own (a tutorial check run by
 * the app). Without it, the verdict is read off the words: one stated verdict is that verdict; two
 * or more disagreeing is the most cautious of them; none is *Partly there*, the same safe side
 * `flow.feedbackVerdict3` falls to. Either way the stored text then says exactly that verdict once,
 * at the start, so the message, the outcome row and the progress bar cannot disagree.
 */
export function settleVerdict(text: string, logged: TurnVerdict | null = null): SettledVerdict {
  const found = findVerdicts(text);
  const stated = found.map((f) => f.verdict);
  const verdict: TurnVerdict =
    logged ?? (stated.length === 0 ? 'partial' : CAUTION.find((v) => stated.includes(v)) ?? 'partial');
  const firstSpan = found[0];
  const opensWithIt =
    found.length === 1 &&
    firstSpan !== undefined &&
    firstSpan.verdict === verdict &&
    text.slice(0, firstSpan.from).trim().replace(LEAD, '').length === 0;
  if (opensWithIt) return { text, verdict, change: 'none' };

  // Take every stated verdict out, back to front so the spans stay valid, then put one in front.
  let rest = text;
  for (const f of [...found].reverse()) rest = rest.slice(0, f.from) + rest.slice(f.to);
  rest = rest
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const opener = `**${VERDICT_PHRASE[verdict]}**`;
  return {
    text: rest.length > 0 ? `${opener} ${rest}` : opener,
    verdict,
    change: found.length === 0 ? 'added' : 'corrected',
  };
}

/** A sentence that asks: it ends on a question mark, past any closing markup or quote. */
function asks(sentence: string): boolean {
  return /\?[\s*_”"')\]]*$/.test(sentence.trim());
}

/**
 * **No question at the end of a closing turn.** Trailing sentences that ask are dropped: after
 * *Well done* or a released answer the next question is the learner's to ask for (`collab-doc.md`
 * §4.2: "after Well done it asks nothing"). Only the tail goes; a question quoted mid-turn stays.
 * A turn that would be left empty is returned as it was, because a turn that only asks is not one
 * this rule is about.
 */
export function dropQuestionTail(text: string): string {
  const segs = segments(text);
  let keep = segs.length;
  while (keep > 0 && asks(segs[keep - 1]!.text)) keep -= 1;
  if (keep === segs.length || keep === 0) return text;
  const last = segs[keep - 1]!;
  return text.slice(0, last.start + last.text.length).trimEnd();
}

/**
 * Sentences that are about the exchange rather than the question: the S6 framing ("it's the
 * statement I'm testing, not you"), a greeting, an announcement that a question is coming. They
 * are right for the chat and wrong for the notes.
 */
const PREAMBLE: readonly RegExp[] = [
  /\bnot (?:you|the person)\b/i,
  /\b(?:a )?rough answer is fine\b/i,
  /\btests? the (?:statement|claim|idea)\b/i,
  /\bi(?:'|’)?m testing\b/i,
  /^(?:max|ellie) here\b/i,
  /^here(?:'|’)?s (?:one|a question|another|a quick one)\b/i,
  /^(?:let(?:'|’)?s|time to) (?:check|test|try)\b/i,
];

/**
 * **The question as it goes into the notes**: Max's question turn less its preamble. A sentence
 * that asks is always kept, even when it also carries framing, because the question is the point;
 * a framing sentence that asks nothing is dropped. Markdown emphasis is kept (the notes render it).
 */
export function questionText(turn: string): string {
  const kept = segments(turn.trim())
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0)
    .filter((s) => asks(s) || !PREAMBLE.some((re) => re.test(s.replace(LEAD, ''))));
  const out = kept.join(' ').trim();
  return out.length > 0 ? out : turn.trim();
}

/**
 * **The question in one line**, for the self-check chip: the last sentence that asks, with its
 * emphasis taken off, or the first sentence when none asks (a fill-in-the-blank ends on `____.`).
 */
export function questionLine(turn: string): string {
  const sentences = segments(questionText(turn))
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0);
  const pick = [...sentences].reverse().find(asks) ?? sentences.find((s) => s.includes('____')) ?? sentences[0] ?? '';
  return pick.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}
