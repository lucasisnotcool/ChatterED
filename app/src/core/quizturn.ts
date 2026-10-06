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

// ── 6 Oct afternoon (items 1, 4, 5, 13, 17; `notebooks.md` §11.10) ──────────────────────────

/**
 * The text with maths (`$…$`, `$$…$$`) and quotations blanked to `x`, **at the same length**, so a
 * check can read the prose and cut the original at the same offsets. A `?` or an *and* inside a
 * formula or a quoted page is not Max's.
 */
function maskQuoted(text: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, 'x');
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, blank)
    .replace(/\$[^$\n]*\$/g, blank)
    .replace(/“[^”\n]*”/g, blank)
    .replace(/"[^"\n]*"/g, blank);
}

interface ProseSegment {
  start: number;
  end: number;
  /** The sentence as written. */
  text: string;
  /** The same sentence with its maths and quotes blanked: what the checks read. */
  masked: string;
}

function proseSegments(text: string): ProseSegment[] {
  const masked = maskQuoted(text);
  return segments(masked).map((s) => {
    // A sentence's closing emphasis ("**Partly there.**") belongs to it, not to the gap after it.
    let end = s.start + s.text.length;
    while (/[*_]/.test(text[end] ?? '')) end += 1;
    return { start: s.start, end, text: text.slice(s.start, end), masked: masked.slice(s.start, end) };
  });
}

/** The text without the sentences `drop` picks, the gaps tidied. */
function withoutSegments(text: string, drop: (seg: ProseSegment) => boolean): string {
  let out = '';
  let at = 0;
  for (const seg of proseSegments(text)) {
    if (!drop(seg)) continue;
    out += text.slice(at, seg.start);
    at = seg.end;
  }
  out += text.slice(at);
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * **A second ask inside one sentence** (item 4): *"…, and what would go wrong…?"* (#34), *"…, and how
 * is it different from…?"* (#53), *"what … and how is …"*. A comma before *and* plus any question
 * word, or a bare *and* plus a question word and its verb, so *"what A does and what B does"* is one
 * ask about a difference rather than two.
 */
const SECOND_ASK =
  /,\s*and\s+(?:then\s+)?(?:what|how|why|which|where|when|whether|who|does|do|did|is|are|can|could|would|will|should)\b|\band\s+(?:then\s+)?(?:what|how|why|which|where|when|whether|who)(?:'s|\s+(?:is|are|was|were|does|do|did|would|will|can|could|should|might|happens|changes|goes|makes))\b/i;

/** A sentence that asks without a question mark: *"Then tell me whether…"*, *"Explain why…"*. */
const IMPERATIVE_ASK =
  /^[\s*_]*(?:(?:now|then|and|also|next|so|finally),?\s+)?(?:in your own words,?\s+)?(?:explain|say|tell me|describe|state|predict|compare|work out|write down)\b/i;

/** A sentence that opens as a question, for closing a cut-down ask with `?` rather than `.`. */
const OPENS_AS_QUESTION = /^[\s*_]*(?:(?:in your own words|so|then|now),?\s+)?(?:what|why|how|which|where|when|who|does|do|did|is|are|can|could|would|should)\b/i;

function isAsk(masked: string): boolean {
  return asks(masked) || IMPERATIVE_ASK.test(masked.replace(LEAD, ''));
}

/**
 * **A question that asks two things** (6 Oct afternoon, item 4). Two sentences that ask, or one that
 * asks a second thing after *and*. Both of Max's opening questions in the 6 Oct sessions were two
 * (#34, #53), and each half became its own *Partly there*.
 */
export function asksTwoThings(text: string): boolean {
  const asking = proseSegments(text).filter((s) => isAsk(s.masked));
  if (asking.length >= 2) return true;
  return asking.some((s) => SECOND_ASK.test(s.masked));
}

/**
 * **Only the first ask** (item 4), when a regenerated question still asks two things: the text up to
 * the end of the first sentence that asks, cut before its second ask and closed with a question
 * mark. The second part can be a later question. A text that asks one thing comes back unchanged.
 */
export function firstAsk(text: string): string {
  if (!asksTwoThings(text)) return text;
  const segs = proseSegments(text);
  const seg = segs.find((s) => isAsk(s.masked));
  if (seg === undefined) return text;
  const second = SECOND_ASK.exec(seg.masked);
  if (second !== null) {
    const head = text.slice(seg.start, seg.start + second.index).replace(/[\s,;:]+$/, '');
    const close = asks(seg.masked) || OPENS_AS_QUESTION.test(seg.masked) ? '?' : '.';
    return `${text.slice(0, seg.start)}${head}${close}`.trim();
  }
  return text.slice(0, seg.end).trim();
}

/**
 * **A feedback turn's closing question asks two things** (item 4, on a follow-up): #36 ended *"…what
 * happens to its computed expected utility relative to the other actions, and which way does that
 * push the agent's choice?"*. Only the last sentence is read: the body of a feedback turn may
 * quote or restate the question it marks.
 */
export function endsOnTwoAsks(text: string): boolean {
  const last = proseSegments(text).at(-1);
  return last !== undefined && asks(last.masked) && SECOND_ASK.test(last.masked);
}

/** The feedback with its closing question cut to its first ask; unchanged when it asks one thing. */
export function oneAskAtEnd(text: string): string {
  const last = proseSegments(text).at(-1);
  if (last === undefined || !endsOnTwoAsks(text)) return text;
  return `${text.slice(0, last.start)}${firstAsk(last.text)}`.trim();
}

/**
 * **"I'm testing the statement, not you"** (item 5): safeguard S6's framing, which opened both of
 * Max's questions on 6 Oct (#34, #53) and 190 words of the notes before that. The safeguard is gone
 * from the prompt; this takes it out of the words too. A sentence that is only the framing is
 * dropped; framing in front of the question itself is cut back to the question.
 */
const TESTING_FRAME =
  /\b(?:i(?:'|’)?m|i am|this is|it(?:'|’)?s|we(?:'|’)?re) (?:only |just )?testing the (?:statement|claim|idea)\b|\bnot (?:testing )?you\b|\btake this as a probe\b|\bthis (?:one )?tests the (?:statement|claim|idea)\b/i;

export function dropTestingFrame(text: string): string {
  let out = '';
  let at = 0;
  for (const seg of proseSegments(text)) {
    if (!TESTING_FRAME.test(seg.masked)) continue;
    if (!asks(seg.masked)) {
      out += text.slice(at, seg.start);
      at = seg.end;
      continue;
    }
    // The framing is a clause in front of the question: cut to the clause the question starts in.
    let cut = 0;
    for (const clause of seg.masked.split(/(?<=[,;:])\s+/)) {
      if (!TESTING_FRAME.test(clause)) break;
      cut += clause.length + 1;
    }
    if (cut > 0 && cut < seg.masked.length) {
      const rest = text
        .slice(seg.start + cut, seg.end)
        .trim()
        .replace(/^(?:so|and|but)\s+/i, '');
      out += `${text.slice(at, seg.start)}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
      at = seg.end;
    }
  }
  out += text.slice(at);
  return out.replace(/^[ \t]+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** A page, a slide or "the page". */
const PAGE_REF = /\b(?:pp?\.\s*\d+|pages?\s+\d+|slides?\s+\d+|(?:the|that|this) (?:page|slide)s?|the deck)\b/i;

/** Pointing at it as the place the answer is, rather than quoting what it says. */
const POINTS_THERE =
  /\b(?:settles?|settled|settling|is where|are where|(?:is|are) the pages?|covers? (?:it|this|that)|has (?:it|the answer|this)|shows? (?:it|this|that|what|how|where|why|which)|answers? (?:it|this|that)|tells? you|spells? (?:it|this|that) out|look(?:s|ing)? (?:at|to|again)|see p\b|check p\b|re-?read|go back to)\b/i;

/** *"the deck does not settle this"* is the grounds rule's own clause, an honest limit, not a pointer. */
const DOES_NOT_SETTLE = /(?:\bnot|\bnever|n['’]t)\s+(?:settle|cover|show|answer|say|tell)/i;

function pointsAtPage(seg: ProseSegment): boolean {
  return PAGE_REF.test(seg.masked) && POINTS_THERE.test(seg.masked) && !DOES_NOT_SETTLE.test(seg.masked);
}

/**
 * **A page as the hint** (6 Oct afternoon, item 1, "no riddles"). Max's feedback on 6 Oct ended its
 * paragraph on what was missing with *"p. 6 settles it"* (#40), *"p. 7 settles it, in how the
 * grid's 0.8, 0.1 and 0.1 are described"* (#42), *"p. 14 settles it"* (#61): the learner was sent
 * to find the answer, four times, and asked *"so what on earth were you trying to tell me??"*.
 * Returns the sentences that point at a page or slide as where the missing part is. A grounding
 * quote (*p. 10: "…"*) is not one.
 */
export function pagePointers(text: string): string[] {
  return proseSegments(text)
    .filter(pointsAtPage)
    .map((s) => s.text.trim());
}

/** The feedback with its page-pointer sentences taken out: item 1's last resort, after one regeneration. */
export function dropPagePointers(text: string): string {
  return withoutSegments(text, pointsAtPage);
}

/**
 * **Feedback after a try: only what is new** (6 Oct afternoon, item 13). Two or three sentences:
 * what changed since the last try and what is still needed. The 6 Oct feedback turns ran to 80–110
 * words, most of it restating what the learner had already got (#40, #44, #57, #61, #63 and #67 each
 * open *"Taken together, you have…"*). The cap is in code; formulas are not counted.
 */
export const FEEDBACK_MAX_WORDS = 60;

/** Words of prose, maths left out: `$…$` and `$$…$$` count as nothing. */
export function feedbackWords(text: string): number {
  const prose = text.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]*\$/g, ' ');
  return prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * **The feedback cut to the cap**, by whole sentences: the verdict line first, the closing question
 * last, and the sentences between in order while they fit. Used only when a regenerated turn is
 * still over; a turn that fits comes back unchanged.
 */
export function capFeedback(text: string, max: number = FEEDBACK_MAX_WORDS): string {
  if (feedbackWords(text) <= max) return text;
  const segs = proseSegments(text);
  if (segs.length <= 2) return text;
  const lastIndex = segs.length - 1;
  const keepLast = asks(segs[lastIndex]!.masked);
  const keep = new Set<number>([0]);
  if (keepLast) keep.add(lastIndex);
  let used = [...keep].reduce((n, i) => n + feedbackWords(segs[i]!.text), 0);
  for (let i = 1; i < (keepLast ? lastIndex : segs.length); i += 1) {
    const words = feedbackWords(segs[i]!.text);
    if (used + words > max) break;
    used += words;
    keep.add(i);
  }
  let out = '';
  let prevEnd: number | null = null;
  segs.forEach((s, i) => {
    if (!keep.has(i)) return;
    if (prevEnd !== null) out += /\n/.test(text.slice(prevEnd, s.start)) ? '\n\n' : ' ';
    out += s.text.trim();
    prevEnd = s.end;
  });
  return out.trim();
}

/** What is wrong with a feedback draft, for the one regeneration (items 1, 4 and 13). */
export type FeedbackFault = 'page_pointer' | 'too_long' | 'two_asks';

/**
 * **Everything code checks on a feedback turn that keeps the question open**: a page given as the
 * hint (item 1), over `FEEDBACK_MAX_WORDS` (item 13), a closing question that asks two things
 * (item 4). Empty when the draft may go out as written.
 */
export function feedbackFaults(text: string): FeedbackFault[] {
  const faults: FeedbackFault[] = [];
  if (pagePointers(text).length > 0) faults.push('page_pointer');
  if (feedbackWords(text) > FEEDBACK_MAX_WORDS) faults.push('too_long');
  if (endsOnTwoAsks(text)) faults.push('two_asks');
  return faults;
}

/** The last resort after one regeneration: the pointer out, one ask at the end, cut to the cap. */
export function fixFeedback(text: string): string {
  return capFeedback(oneAskAtEnd(dropPagePointers(text)));
}

/**
 * **Credit the release cannot give** (6 Oct afternoon, item 17). Both releases of 6 Oct ended
 * *"Your attempt already had the core idea…"* (#46) or *"Your attempt already had the optimal
 * side"* (#69) about answers marked *Partly there* four and five times: the learner had just been
 * told, every turn, that it was not there.
 */
const CREDIT_OVERCLAIM =
  /\b(?:already )?(?:had|has|got|captured|contained|caught|nailed) (?:the |its )?(?:core|key|main|central|whole|essential|full) (?:idea|point|answer)\b|\bhad (?:it|the answer) (?:right|all along)\b|\byou (?:basically |essentially )?(?:had|got) it\b/i;

function overclaims(seg: ProseSegment): boolean {
  return CREDIT_OVERCLAIM.test(seg.masked);
}

/** True when a sentence of the text says the learner already had the core or whole idea. */
export function overclaimsCredit(text: string): boolean {
  return proseSegments(text).some(overclaims);
}

/** The text without the sentences that claim the learner had the core idea (item 17). */
export function dropCreditOverclaim(text: string): string {
  return withoutSegments(text, overclaims);
}
