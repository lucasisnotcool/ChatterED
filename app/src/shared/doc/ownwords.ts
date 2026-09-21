/**
 * **How much of an answer is the learner's own** (`docs/research/measurement.md` M3).
 *
 * The brief's §6 counterweight for an AI-written document is that the bar moves only on the
 * learner's words. That guarantee is empty unless *"their words"* is checked, and after the pivot
 * it is cheap to satisfy without meaning it: the notes are on screen directly above the Q block,
 * and Ellie's cue is *designed* to be restated. A learner who paraphrases the paragraph two inches
 * up earns the same fill as one who explains.
 *
 * So every verdict carries three overlap shares, against three different sources, reported
 * separately because they mean different things:
 *
 *   - **block** — reading the notes back.
 *   - **cue** — echoing the peer (`collab-doc.md` §4.3), the one DG1 exists to prevent.
 *   - **question** — restating Max's prompt.
 *
 * **This is a flag, not a gate.** It is lexical, not semantic: a good paraphrase reads as the
 * learner's own, and correct technical vocabulary will always overlap, which is why
 * `progressFill` never sees these numbers and no fill is ever withheld on them. High cue overlap
 * on a question is a reason to look at the turn, not grounds to mark it down. The semantic version
 * (embeddings) is a later refinement and A2 does not need it.
 *
 * Pure, DOM-free, no model call, so it runs inside the verdict path without a round trip.
 */

/**
 * Words too common to be evidence of anything. Kept deliberately short and domain-free: a longer
 * list would start removing the connectives that carry a *causal* explanation ("because", "so",
 * "therefore"), and those are exactly the words that distinguish an explanation from a restatement.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'of',
  'ok',
  'okay',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'which',
  'will',
  'with',
  'would',
  'yeah',
  'yes',
  'you',
  'your',
]);

/**
 * A crude suffix strip, not a lemmatiser. It exists so "marginalise" and "marginalising" count as
 * the same word; it is wrong on irregular forms and we accept that, because the measure is a flag
 * and a systematic under-count of overlap errs in the learner's favour.
 */
function stem(word: string): string {
  for (const suffix of ['ising', 'izing', 'ing', 'ise', 'ize', 'ises', 'izes', 'ied', 'ies', 'ed', 'es', 's']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** The content words of a text, stemmed, in order, with duplicates kept. */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * The share of the answer's content words that also appear in `source`, rounded to two places.
 *
 * `null` when either side has no content words at all: an answer of "ok" and a question with no
 * source text are both *unmeasured*, and a zero there would read as "entirely the learner's own",
 * which is the opposite of what an empty answer shows.
 */
export function overlapShare(answer: string, source: string | null | undefined): number | null {
  if (source === null || source === undefined) return null;
  const answerWords = contentWords(answer);
  if (answerWords.length === 0) return null;
  const sourceWords = new Set(contentWords(source));
  if (sourceWords.size === 0) return null;
  const shared = answerWords.filter((w) => sourceWords.has(w)).length;
  return Math.round((shared / answerWords.length) * 100) / 100;
}

/** The three shares of M3, each `null` where its source was not available on this question. */
export interface OwnWordsShares {
  /** Against the notes block the question is anchored to. */
  block: number | null;
  /** Against Ellie's cue, when one fired on this question. */
  cue: number | null;
  /** Against Max's question. */
  question: number | null;
}

/**
 * Compute all three. Every source is optional, because a question can resolve without a cue, and
 * a verdict on a chat answer has no anchored block.
 */
export function ownWordsOf(input: {
  answer: string | null | undefined;
  block?: string | null;
  cue?: string | null;
  question?: string | null;
}): OwnWordsShares | null {
  const answer = input.answer ?? null;
  if (answer === null || contentWords(answer).length === 0) return null;
  return {
    block: overlapShare(answer, input.block),
    cue: overlapShare(answer, input.cue),
    question: overlapShare(answer, input.question),
  };
}
