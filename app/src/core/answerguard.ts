/**
 * **Explain, never solve: the check in code** (2026-10-06 afternoon, decision 6; the tutorial
 * sheet's rule of 2026-10-04, `tutorials.md` §4, now for an open notebook question).
 *
 * While Max's question is open, Ellie may explain the ideas it uses but must not answer it. The
 * prompt says so (`prompts.tutor.openQuestionGuardBlock`); this is the half that does not rely on
 * the model listening. When the question has a hidden key (Max's model answer and its one to
 * three essential points, decision 3), a reply that **states one of those points** is caught here
 * before it is stored: the actor asks once more, and on a second hit takes the stating sentences
 * out.
 *
 * "States a point" is lexical, like `ownwords.ts`: a sentence (or two adjacent sentences) of the
 * reply that holds at least `LEAK_SHARE` of the point's content words. A point of fewer than
 * `MIN_POINT_WORDS` content words (one term, a number) is never checked on its own: the term is
 * the vocabulary Ellie has to use to explain anything at all, and a check that fired on it would
 * stop her explaining. It errs towards letting an explanation through; the prompt carries the rest.
 *
 * Pure, DOM-free, no model call.
 */

/** A point counts as stated when this share of its content words is in one place in the reply. */
export const LEAK_SHARE = 0.75;

/** Points shorter than this, in content words, are not checked (see above). */
export const MIN_POINT_WORDS = 3;

const STOPWORDS = new Set(
  (
    'a an and are as at be been being but by can could do does each every for from had has have how i if in ' +
    'into is it its itself just may might more most must no not of on one only or our over same so some such ' +
    'than that the their them then there these they this those through to too under up us very was we were ' +
    'what when where which while who why will with would you your'
  ).split(' '),
);

/** Content words, lower-cased, crudely stemmed so "states" meets "state" and "summing" meets "sum". */
export function contentWords(text: string): string[] {
  const plain = text
    .toLowerCase()
    // TeX commands keep their name: `\max` is the word "max", `\gamma` is "gamma".
    .replace(/\\([a-z]+)/g, ' $1 ')
    .replace(/[^a-z0-9]+/g, ' ');
  const out: string[] = [];
  for (const raw of plain.split(' ')) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The reply's sentences, display maths kept with the sentence before it. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s*\$\$([\s\S]*?)\$\$\s*/g, (_m, tex: string) => ` $${tex.replace(/\s+/g, ' ').trim()}$ `)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9*$("“])|\n{2,}|\n(?=\s*(?:[-*•]|\d+\.)\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface Leak {
  /** The key point the reply stated. */
  point: string;
  /** The reply's sentence (or two) that stated it. */
  where: string;
  /** Indices into `sentencesOf(reply)` of the stating sentences. */
  sentences: number[];
  /** The share of the point's content words found there. */
  share: number;
}

/**
 * The key points a reply states, each with where. Empty when there is no key, or nothing checkable
 * in it, or the reply keeps to explaining.
 */
export function answerLeaks(reply: string, keyPoints: readonly string[]): Leak[] {
  const sentences = sentencesOf(reply);
  const bags = sentences.map((s) => new Set(contentWords(s)));
  const leaks: Leak[] = [];
  for (const point of keyPoints) {
    const words = [...new Set(contentWords(point))];
    if (words.length < MIN_POINT_WORDS) continue;
    let best: { share: number; at: number[] } | null = null;
    for (let i = 0; i < bags.length; i += 1) {
      const windows = i + 1 < bags.length ? [[i], [i, i + 1]] : [[i]];
      for (const at of windows) {
        const share = words.filter((w) => at.some((j) => bags[j]!.has(w))).length / words.length;
        // A single sentence wins a tie: it is the tighter place to have said it.
        if (best === null || share > best.share) best = { share, at };
      }
    }
    if (best !== null && best.share >= LEAK_SHARE) {
      leaks.push({ point, where: best.at.map((j) => sentences[j]!).join(' '), sentences: best.at, share: best.share });
    }
  }
  return leaks;
}

/**
 * The reply with every stating sentence taken out. What is left keeps its order and its paragraph
 * breaks as sentences; the caller decides what to do when little is left.
 */
export function withoutLeaks(reply: string, keyPoints: readonly string[]): string {
  const leaks = answerLeaks(reply, keyPoints);
  if (leaks.length === 0) return reply;
  const drop = new Set(leaks.flatMap((l) => l.sentences));
  return sentencesOf(reply)
    .filter((_s, i) => !drop.has(i))
    .join(' ')
    .trim();
}
