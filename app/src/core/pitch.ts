/**
 * **The pitch this learner has asked for, on this file** (issue #41,
 * `conversation-refinement.md` §3 item 4).
 *
 * All three of Lucas's #41 transcripts contain the learner correcting the level of an answer —
 * *"hmm can you explain it simpler"*, *"you are justing reading the slides back to me"*, *"too
 * complicated, can you explain stochastic as a concept… then the rigorous version"*. Each time the
 * next turn was better, and each time the system forgot. On the third transcript he had to write
 * the explanation's *shape* himself, having already twice said the same thing about its level.
 *
 * So the signal is caught and kept. Deliberately a **word list and not a model**, the same
 * argument `shared/scope.ts` makes for `guessScope`: it runs on every learner turn, it has to be
 * instant, it is advisory — it tilts one line of a prompt — and a classifier that is wrong
 * sometimes in front of a learner who can say "simpler" again is a better product than a
 * twenty-second call behind a wait.
 *
 * Three levels and no more. `-1` is the state the #41 transcripts kept asking for and never got
 * twice; `0` is the default; `+1` is the learner who wants the derivation. It is clamped, so ten
 * "simpler"s do not produce an explanation for a five-year-old and one "actually be rigorous"
 * takes it straight back to `0`.
 */

/** −1 plain · 0 default · +1 rigorous. Clamped; there is no level 2 in either direction. */
export type PitchLevel = -1 | 0 | 1;

export interface PitchState {
  level: PitchLevel;
  /**
   * What the learner actually said to move it, most recent first, capped at three. Quoted back
   * into the prompt, because *"they asked for it simpler"* is weaker than the phrase they used —
   * and because a learner who reads the log should be able to see why the app decided this.
   */
  signals: string[];
  /** When the level last moved. Zero when it never has. */
  updatedAt: number;
}

export const DEFAULT_PITCH: PitchState = { level: 0, signals: [], updatedAt: 0 };

/** How many remembered phrases the prompt carries. Three is enough to show a pattern. */
const MAX_SIGNALS = 3;

/**
 * **Lower the pitch.** Read `conversation-refinement.md` §1: every one of these is a phrase a
 * learner used in #36, #37 or #41 to say the answer was above them. "No idea" is here as well as
 * in the Teacher's no-question rule (#36) — it means both things at once.
 *
 * **Only the form of a request counts** (#49). A bare `simplify`, `basic`, `from scratch` or
 * `too much` is as often the content of an answer as a request about the explanation — *"Oh it can
 * simplify the reduce degrees of freedom of CNF formula"* was an answer to Max, and it lowered the
 * pitch for the rest of the file. So the words that double as content only count in a request
 * shape: a verb asking for it (*"explain it simpler"*, *"can you simplify"*), a short message that
 * is nothing else (*"simpler please"*), or a clause that ends on it (*"slow down."*). The match is
 * the word the learner used, so the prompt still quotes *"simpler"*, not the sentence around it.
 */
const TAIL = String.raw`(?=(?: (?:please|pls|for me|a bit|a little))?\W*(?:$|[.,!?;]))`;
const LOWER: RegExp[] = [
  // "explain it simpler", "say that a bit more simply": asked of the explanation, by verb.
  /(?<=\b(?:explain|say|describe|word|phrase)(?: (?:it|that|this|them))?(?: (?:a bit|a little|much|way|even))?(?: more)? )simpl(?:er|y)\b(?! (?:to|than)\b)/i,
  // "make it simpler", "put it more simply": only with the object and at the end of a clause.
  new RegExp(String.raw`(?<=\b(?:put|make|keep) (?:it|that|this|them)(?: (?:a bit|a little|much|way|even))?(?: more)? )simpl(?:er|y)\b${TAIL}`, 'i'),
  // "simpler", "hmm, simpler?", "simpler please": a message that is nothing but the request.
  /(?<=^\W*(?:[\w']+\W+){0,2})simpl(?:er|y)(?=\W*(?:please|pls)?\W*$)/i,
  /\bsimpler(?= (?:please|pls|terms|words|explanation|language)\b)/i,
  // "can you simplify that", "simplify please".
  /(?<=\b(?:can|could|would|will) you (?:please |pls |just )?)simplify\b/i,
  /(?<=^\W*(?:please |pls )?)simplify\b/i,
  /\beli ?5\b/i,
  /\bexplain (it )?like (i'?m|i am) (5|five)\b/i,
  /\bno idea\b/i,
  /(?:^|\bi (?:still |really |just )?)(?:don'?t|do not|didn'?t|did not) (?:get|understand|follow)\b/i,
  /\btoo (complicated|complex|technical|abstract)\b/i,
  new RegExp(String.raw`\btoo (?:much|fast)${TAIL}`, 'i'),
  /\breading the slides? back\b/i,
  /\brepeating the slides?\b/i,
  /\bjust reading\b/i,
  /\blost me\b/i,
  /\bwhat does that (even )?mean\b/i,
  /\b(in )?plain (english|terms|words)\b/i,
  /\bdumb(ed)? (it )?down\b/i,
  /\blay ?man'?s?\b/i,
  /\b(?:explain|teach|go through|walk (?:me|us) through)(?: (?:it|that|this|them))? from scratch\b/i,
  // Plural only: "the basic idea" is content; "back to basics", "the basics first" is a request.
  /\bbasics\b/i,
  new RegExp(String.raw`\bslow(?:er)? down${TAIL}`, 'i'),
  /\b(?:give|show)(?: me| us)?(?: (?:a|an|one|some|another))? concrete examples?\b|\bconcrete examples? (?:please|pls)\b/i,
];

/** **Raise it.** The learner who wants the derivation, and says so. */
const RAISE: RegExp[] = [
  /\brigor(ous|ously|our)\b/i,
  /\bformal(ly|ise|ize)?\b/i,
  /\bprov(e|es|ed|ing)\b|\bproof\b/i,
  /\bderiv(e|es|ed|ation)\b/i,
  /\bprecise(ly)?\b/i,
  /\bmathematical(ly)?\b/i,
  /\btechnical(ly)? (detail|version|definition)\b/i,
  /\bfull(y)? general\b/i,
  /\bi (already )?know (that|this)\b/i,
];

export interface PitchSignal {
  direction: -1 | 1;
  /** The matched phrase, as the learner wrote it. Quoted into the prompt. */
  phrase: string;
}

/**
 * The first signal in one learner message, or null.
 *
 * **Lower wins over raise when both appear**, and that is not arbitrary: the one message in #41
 * that contains both is *"too complicated, can you explain stochastic as a concept, what it means,
 * then the rigorous version"*. The learner is asking to be taken from the bottom **up** — the
 * complaint is about where the answer started, not where it ended — and `conversation-refinement.md`
 * §4's explanation shape delivers both halves anyway.
 */
export function pitchSignal(text: string): PitchSignal | null {
  const body = text.trim();
  if (body.length === 0) return null;
  for (const pattern of LOWER) {
    const hit = pattern.exec(body);
    if (hit) return { direction: -1, phrase: hit[0] };
  }
  for (const pattern of RAISE) {
    const hit = pattern.exec(body);
    if (hit) return { direction: 1, phrase: hit[0] };
  }
  return null;
}

const clamp = (n: number): PitchLevel => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Fold one learner message into the file's pitch. Returns the same object when nothing fired. */
export function notePitch(state: PitchState, text: string, now: number): PitchState {
  const signal = pitchSignal(text);
  if (!signal) return state;
  const level = clamp(state.level + signal.direction);
  const signals = [signal.phrase, ...state.signals.filter((s) => s !== signal.phrase)].slice(0, MAX_SIGNALS);
  return { level, signals, updatedAt: now };
}

// ── how hard the next question is (#48, collab-doc.md §4.5) ────────────────

/**
 * **No fixed rungs.** `collab-doc.md` §4.5, verbatim: *"Max is given the learner's recent results
 * on this file (the last few verdicts and releases, and the objective's current fill) and pitches
 * freely, with two hard instructions: after a `give_up`, the next question on that objective is
 * **easier** (recall, or one part of the idea); after a *Well done*, the next may be harder
 * (explain why, apply to a case)."*
 *
 * The evidence is R6, twice over: L20 lowered the difficulty in the same message that set
 * attempt-first, and L34 read *"this query seems too complex"* (`convergence.md`). A give-up is a
 * statement about the question, not about the learner, and the app's answer to it is a smaller
 * question rather than a refused answer.
 *
 * So this file gets a second pure function beside `pitchSignal`: the *level* stays the learner's
 * stated preference about **how an explanation is written**, and this is about **how hard the next
 * question is**. They are deliberately not merged — a learner who asks for the rigorous version
 * has not asked for a harder quiz, and one who gives up on a question has not asked for simpler
 * prose. The wording of the question is the model's; the two instructions are not.
 */
export type QuestionPitch = 'easier' | 'level' | 'harder';

/**
 * **The shape of a question** (`collab-doc.md` §4.5, amended 2026-10-01). `open` is every question
 * until now: answered in the learner's own words. `cloze` is a fill-in-the-blank, which is what
 * *"easier"* means after a release: one sentence from the page with one key term blanked.
 *
 * A cloze is a way back into the objective, not a demonstration of it. One recalled word is not
 * the learner's own words about anything, so a cloze verdict **fills no progress** and never
 * licenses a harder question; both are decided where the outcome is read, from this field.
 */
export type QuestionForm = 'open' | 'cloze';

/** How the blank is written, and the only thing code reads off a cloze question. */
export const CLOZE_BLANK = '____';
const BLANK = /_{3,}/;

/** True when a question carries a blank. Three underscores or more, so a model's five still count. */
export function hasBlank(text: string): boolean {
  return BLANK.test(text);
}

// ── The blank that gives its answer away (2026-10-06 decision, D3) ──────────────────────────

/**
 * **A fill-in-the-blank whose answer is already on screen** (2026-10-06 decision, the
 * `notebooks.md` / `collab-doc.md` amendment, D3). A blank is a sentence from the page with one
 * term taken out (§4.5), and Max is also asked to ground every correction by quoting the page, so
 * the two meet: in the live runs of 2026-10-03 to 10-05, 6 of the 8 blanks that ended a run had
 * their answer quoted whole in the same message or the one before. The learner reads it back, and
 * the blank is marked *Well done*.
 *
 * Three ways it is given away, checked in this order:
 *
 * - `sentence`: the blank's sentence, unblanked, is elsewhere on screen, so the term can be read
 *   off it (`p. 43: "Final utilities solve the Bellman equations…" Fill in the blank: p. 43:
 *   "Final utilities solve the ____ equations…"`).
 * - `term`: the term itself, recovered from the page, is elsewhere on screen.
 * - `mirror`: an on-screen sentence shares the word beside the blank and fills the slot with
 *   another word (`"Fewer iterations, but each iteration is more computationally intensive." …
 *   Fill in the blank: "Simpler update, but ____ iterations needed."`). The learner wrote "fewer",
 *   the wrong word, read off the other row of the slide's table.
 *
 * "On screen" is the rest of the turn (any sentence without a blank in it) and the messages the
 * caller passes as `earlier`, the message just before. Words are compared case-folded, under
 * Unicode compatibility folding (so the deck's 𝑃 is P), with a plural `s` folded away. A word
 * list of function words is never a term and never a neighbour, so "the" beside a blank says
 * nothing. A false hit costs one regeneration, which is why the mirror check is allowed to be loose.
 */
export type BlankGiveawayKind = 'sentence' | 'term' | 'mirror';

export interface BlankGiveaway {
  kind: BlankGiveawayKind;
  /** The words a learner could read off the screen: the blank's own term, or the mirror's word. */
  term: string | null;
  /** The on-screen sentence that gives it away, as written there. */
  quoted: string;
  /** In the turn itself, or in one of the `earlier` messages. */
  where: 'turn' | 'earlier';
}

export interface BlankGiveawayInput {
  /** The whole turn that carries the blank. */
  turn: string;
  /** What is on screen just before it: the message before this one. */
  earlier?: readonly string[];
  /** The text of the page (or the deck) the sentence is from, to recover the blanked term. */
  pageText?: string | null;
}

/** Words that are never a term, never a neighbour worth aligning on, and never a mirror's word. */
const FUNCTION_WORDS = new Set(
  (
    'a an the of to in on at by for from with into onto as and or but nor if then so than that this these those ' +
    'it its is are was were be been being has have had do does did not no yes can could may might must shall should ' +
    'will would there here which who whom whose what when where why how each every any all some one ' +
    'p pp page slide e g i ie eg s t'
  ).split(' '),
);

const SEGMENT_BREAK = /["“”«»…\n]+|(?<=[.!?])\s+/u;
const FILL_IN = /^.*fill[\s-]+in[\s-]+the[\s-]+blanks?\s*:?/isu;

interface Words {
  raw: string[];
  stem: string[];
}

function fold(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function wordsOf(text: string): Words {
  const raw = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  return { raw, stem: raw.map(fold) };
}

/** The same list folded, so a folded word (`this` is `thi`) is still recognised. */
const FUNCTION_STEMS = new Set([...FUNCTION_WORDS].map(fold));

function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(word) || FUNCTION_STEMS.has(word);
}

function segmentsOf(text: string): string[] {
  return text
    .split(SEGMENT_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function same(a: readonly string[], from: number, b: readonly string[]): boolean {
  if (from < 0 || from + b.length > a.length) return false;
  for (let i = 0; i < b.length; i += 1) if (a[from + i] !== b[i]) return false;
  return true;
}

/** The words either side of the blank, in the blank's own segment. */
interface Slot {
  left: Words;
  right: Words;
  sentence: string;
}

function slotOf(text: string): Slot | null {
  const segment = segmentsOf(text).find((s) => hasBlank(s));
  if (segment === undefined) return null;
  const match = /_{3,}/.exec(segment)!;
  const before = segment.slice(0, match.index).replace(FILL_IN, '');
  const after = segment.slice(match.index + match[0].length);
  // A second blank in the same sentence is not one this check can read; its side stops there.
  const left = wordsOf(before.split(/_{3,}/).at(-1) ?? '');
  const right = wordsOf(after.split(/_{3,}/)[0] ?? '');
  const sentence = `${before}${CLOZE_BLANK}${after.split(/_{3,}/)[0]!}`.trim();
  return { left, right, sentence };
}

/**
 * Every way `words` fills the slot between the last `a` words of `left` and the first `b` of
 * `right`, as raw words. With no right side the fill is one word; with no left side, one word.
 */
function fills(slot: Slot, words: Words, a: number, b: number, maxTerm = 4): string[][] {
  const left = slot.left.stem.slice(slot.left.stem.length - a);
  const right = slot.right.stem.slice(0, b);
  const found: string[][] = [];
  if (a === 0 && b === 0) return found;
  for (let start = 0; start < words.stem.length; start += 1) {
    if (a > 0 && !same(words.stem, start, left)) continue;
    const t = start + a;
    if (b === 0) {
      if (t < words.raw.length) found.push(words.raw.slice(t, t + 1));
      continue;
    }
    if (a === 0) {
      // Right side only: the word before it fills the slot.
      if (same(words.stem, t, right) && t > 0) found.push(words.raw.slice(t - 1, t));
      continue;
    }
    for (let len = 1; len <= maxTerm; len += 1) {
      if (same(words.stem, t + len, right)) {
        found.push(words.raw.slice(t, t + len));
        break;
      }
    }
  }
  return found;
}

/**
 * **The sentence with the blank in it**, without a leading "Fill in the blank:", or `null` when
 * the text has no blank. The blank is written as `CLOZE_BLANK` whatever length Max typed.
 */
export function blankSentence(text: string): string | null {
  return slotOf(text)?.sentence ?? null;
}

/**
 * **The blanked term, recovered from the page.** The words either side of the blank are found in
 * `pageText` (four a side, then two) and what sits between them is the term, up to four words.
 * `null` when the sentence is not on the page in those words, or the page fills it two ways.
 */
export function blankTerm(sentenceOrTurn: string, pageText: string | null | undefined): string | null {
  const slot = slotOf(sentenceOrTurn);
  if (slot === null || !pageText) return null;
  const page = wordsOf(pageText);
  for (const size of [4, 2]) {
    const a = Math.min(slot.left.stem.length, size);
    const b = Math.min(slot.right.stem.length, size);
    if (a + b < 2) continue;
    const terms = new Set(fills(slot, page, a, b).map((w) => w.join(' ')));
    if (terms.size === 1) return [...terms][0]!;
    if (terms.size > 1) return null;
  }
  return null;
}

/**
 * **Does this turn's blank give its answer away?** `null` when it does not, or when the turn has
 * no blank. See `BlankGiveaway` for the three ways and what counts as on screen.
 */
export function blankGiveaway(input: BlankGiveawayInput): BlankGiveaway | null {
  const slot = slotOf(input.turn);
  if (slot === null) return null;
  const onScreen: { text: string; words: Words; where: 'turn' | 'earlier' }[] = [];
  const add = (text: string, where: 'turn' | 'earlier'): void => {
    for (const s of segmentsOf(text)) if (!hasBlank(s)) onScreen.push({ text: s, words: wordsOf(s), where });
  };
  add(input.turn, 'turn');
  for (const e of input.earlier ?? []) add(e, 'earlier');
  if (onScreen.length === 0) return null;

  // The sentence, unblanked: enough of it either side that it is the same sentence.
  const a = Math.min(slot.left.stem.length, 4);
  const b = Math.min(slot.right.stem.length, 4);
  const context = [...slot.left.stem.slice(slot.left.stem.length - a), ...slot.right.stem.slice(0, b)];
  if (a + b >= Math.min(3, slot.left.stem.length + slot.right.stem.length) && context.some((w) => !isFunctionWord(w))) {
    for (const s of onScreen) {
      const filled = fills(slot, s.words, a, b).find((w) => w.some((x) => !isFunctionWord(x)));
      if (filled) return { kind: 'sentence', term: filled.join(' '), quoted: s.text, where: s.where };
    }
  }

  // The term itself, when the page says what it is.
  const term = blankTerm(slot.sentence, input.pageText);
  const termWords = term === null ? null : wordsOf(term);
  if (termWords !== null && termWords.raw.some((w) => !isFunctionWord(w) && w.length > 2)) {
    for (const s of onScreen) {
      for (let i = 0; i < s.words.stem.length; i += 1) {
        if (same(s.words.stem, i, termWords.stem)) return { kind: 'term', term, quoted: s.text, where: s.where };
      }
    }
  }

  // The mirror: a sentence that shares the blank's neighbour and fills the slot with its own word.
  const inBlank = new Set([...slot.left.stem, ...slot.right.stem]);
  const rightWord = slot.right.stem[0];
  const leftWord = slot.left.stem.at(-1);
  const candidate = (w: string | undefined): w is string =>
    w !== undefined && !isFunctionWord(w) && !inBlank.has(fold(w)) && /\p{L}/u.test(w);
  for (const s of onScreen) {
    for (let k = 0; k < s.words.stem.length; k += 1) {
      const word = s.words.stem[k];
      if (rightWord !== undefined && !isFunctionWord(rightWord) && word === rightWord && candidate(s.words.raw[k - 1])) {
        return { kind: 'mirror', term: s.words.raw[k - 1]!, quoted: s.text, where: s.where };
      }
      if (leftWord !== undefined && !isFunctionWord(leftWord) && word === leftWord && candidate(s.words.raw[k + 1])) {
        return { kind: 'mirror', term: s.words.raw[k + 1]!, quoted: s.text, where: s.where };
      }
    }
  }
  return null;
}

/**
 * The form of the question that was actually asked. The pitch asks for a cloze; whether Max wrote
 * one is read off his words, because a question with no blank in it is an open question whatever
 * it was asked to be, and marking it as a cloze would withhold a fill the learner earned.
 */
export function questionForm(asked: QuestionForm, text: string): QuestionForm {
  return asked === 'cloze' && hasBlank(text) ? 'cloze' : 'open';
}

/**
 * **Marked answers on one question before Max offers *Show me*** (Lucas's decision of 2026-10-06,
 * D3; `collab-doc.md` §4.2 and §4.5, amended 2026-10-06, which reverses the 2026-10-03 "two open
 * follow-ups, then a blank").
 *
 * The 2026-10-03 rule ended a run of *Partly there* on a fill-in-the-blank. In the runs that
 * followed, every chain that reached a third partial verdict ended on one, 8 of 8; in 6 of them
 * the blanked term was on screen, quoted by Max in that message or the one before, and all 8 were
 * scored complete, one of them on the wrong word. A blank shrinks the question until a guess
 * passes. So after the second answer that is not *Well done*, Max asks nothing smaller: he says
 * what landed and offers **Show me** (the release, `collab-doc.md` §4.4), and the learner may
 * still write another attempt in their own words instead.
 */
export const PARTIALS_BEFORE_SHOW_ME = 2;

/** Up to this many words, ending in a question mark, is a guess rather than an answer. */
const GUESS_MAX_WORDS = 4;

/**
 * **A guess at what Max wants** (2026-10-03): a few words ending in a question mark, such as
 * `:action ?`. It is an attempt (`attempt.ts`: a hedged answer is not a clarification), but it
 * says the learner cannot tell what the question is after, and another open question in reply
 * asks them to guess again.
 */
export function isGuess(answer: string | null | undefined): boolean {
  const text = (answer ?? '').trim();
  if (!text.endsWith('?')) return false;
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  return words.length > 0 && words.length <= GUESS_MAX_WORDS;
}

export interface FollowUpPlan {
  /**
   * How a feedback turn that is not *Well done* ends: `open`, one follow-up question on the gap in
   * the learner's own words; `show_me`, no question at all, and the offer of **Show me**.
   */
  next: 'open' | 'show_me';
  /**
   * True from the second try on: the answers are marked **together** against the question Max
   * first asked. Marked one at a time, each answer covers only the part its follow-up asked for,
   * so no single answer is ever a complete answer to the first question.
   */
  together: boolean;
  /** The answer being marked is a guess (`isGuess`). */
  guess: boolean;
}

/**
 * The feedback turn's plan. `attempts` counts the try being marked, so it is 1 on the first
 * answer. *Show me* is offered from the `PARTIALS_BEFORE_SHOW_ME`th try, or after a guess: a
 * guess says the learner cannot tell what the question is after, and another question in reply
 * asks them to guess again. Never a blank (2026-10-06).
 */
export function followUpPlan(input: { attempts: number; answer: string | null | undefined }): FollowUpPlan {
  const guess = isGuess(input.answer);
  return {
    next: input.attempts >= PARTIALS_BEFORE_SHOW_ME || guess ? 'show_me' : 'open',
    together: input.attempts >= 2,
    guess,
  };
}

/** One resolved question on this file, newest last. The only history the pitch reads. */
export interface PitchOutcome {
  objectiveId: string | null;
  /** `verdict` is the learner's own answer being marked; `released` is a give-up, pass or closure. */
  kind: 'verdict' | 'released';
  verdict: 'complete' | 'partial' | 'not_yet' | null;
  releasedBy: 'give_up' | 'pass' | 'closure' | null;
  /** Absent on anything recorded before 2026-10-01, which was all `open`. */
  form?: QuestionForm | null;
}

export interface PitchInputsRequest {
  /** The objective the *next* question is about. The two hard rules are scoped to it. */
  objectiveId: string | null;
  /** Every resolved question on this file, oldest first. Only the tail is read. */
  outcomes: readonly PitchOutcome[];
  /** The objective's current fill (brief §6): 0, 0.5 or 1. */
  fill: 0 | 0.5 | 1;
}

export interface PitchInputs {
  pitch: QuestionPitch;
  /** Why, in one clause, for the prompt and for the log. Never the model's guess. */
  reason: string;
  /** The last few results on this file, newest first, capped — what §4.5 hands Max. */
  recent: PitchOutcome[];
  fill: 0 | 0.5 | 1;
  /** True when the most recent result **on this objective** was a release. Drives `easier`. */
  lastWasRelease: boolean;
  /** True when the most recent result on this objective was a *Well done*. Permits `harder`. */
  lastWasComplete: boolean;
  /** True when nothing has been asked on this objective yet (#49): the question is the easy end. */
  firstOnObjective: boolean;
  /**
   * The form the next question is asked in. `cloze` exactly when the pitch is `easier`: the
   * smaller question after a release is a fill-in-the-blank.
   */
  form: QuestionForm;
  /** True when the most recent result on this objective was a *Well done* on a cloze. */
  lastWasCloze: boolean;
}

/** How much history the block carries. Three is enough to show a direction without a wall. */
const MAX_RECENT = 4;

/**
 * Pure, and unit-tested against fixed inputs — which is what §4.5 asks for in as many words
 * (*"The pitch inputs are a pure function (`room/pitch.ts`), unit-tested; the wording is the
 * model's"*).
 *
 * **Precedence: a release beats a completion.** Both can be true of the same objective — a
 * learner who gave up on question 2 after a *Well done* on question 1 — and the most recent one
 * wins, because the pitch is about the question being asked *now*. That is the one ordering
 * decision in here and it is the one §4.5's own evidence is about: R6's give-up is the signal the
 * next question has to answer.
 */
export function pitchInputs(input: PitchInputsRequest): PitchInputs {
  const recent = [...input.outcomes].reverse().slice(0, MAX_RECENT);
  // Scoped to the objective: a give-up on *another* objective says nothing about this one.
  const onObjective = recent.filter(
    (o) => input.objectiveId === null || o.objectiveId === null || o.objectiveId === input.objectiveId,
  );
  const last = onObjective[0] ?? null;
  const lastWasRelease = last?.kind === 'released';
  /**
   * **A filled blank is not a *Well done* the pitch may build on** (2026-10-01). The learner who
   * gave up and then recalled one term is back at the start of the objective, so the next
   * question is the own-words one a first question would have been, not a harder one.
   */
  const lastWasCloze = last?.kind === 'verdict' && last.verdict === 'complete' && last.form === 'cloze';
  const lastWasComplete = last?.kind === 'verdict' && last.verdict === 'complete' && !lastWasCloze;

  const pitch: QuestionPitch = lastWasRelease ? 'easier' : lastWasComplete ? 'harder' : 'level';
  const reason = lastWasRelease
    ? `the last question on this objective ended in ${last?.releasedBy === 'pass' ? 'a pass' : last?.releasedBy === 'closure' ? 'a release at closure' : 'a give-up'}`
    : lastWasComplete
      ? 'the last answer on this objective was marked Well done'
      : last === null
        ? 'nothing has been asked on this objective yet'
        : lastWasCloze
          ? 'the last answer on this objective filled a blank correctly'
          : `the last answer on this objective was marked ${last.verdict === 'not_yet' ? 'Not yet' : 'Partly there'}`;

  return {
    pitch,
    reason,
    recent,
    fill: input.fill,
    lastWasRelease,
    lastWasComplete,
    firstOnObjective: last === null,
    form: pitch === 'easier' ? 'cloze' : 'open',
    lastWasCloze,
  };
}

/**
 * **What Max is told**, rendered from `pitchInputs`. Facts first, then the one instruction they
 * add up to — the same shape `pitchLine` uses, and for the same reason.
 *
 * The two hard instructions are stated as rules of the app rather than as suggestions, because
 * §4.5 makes them rules: *"two hard instructions"*. Everything else about the question — its
 * wording, its angle, whether it uses the objective's seed — stays the model's.
 */
export function pitchBlock(inputs: PitchInputs): string {
  const lines = ['HOW HARD THIS QUESTION SHOULD BE'];
  if (inputs.recent.length === 0) {
    lines.push('Nothing has been asked on this file yet. Pitch it where the slide pitches it.');
  } else {
    lines.push('Recent results on this file, most recent first:');
    for (const o of inputs.recent) {
      lines.push(
        o.kind === 'released'
          ? `- answer released (${o.releasedBy ?? 'released'}) — fills nothing`
          : `- marked ${o.verdict === 'complete' ? 'Well done' : o.verdict === 'not_yet' ? 'Not yet' : 'Partly there'}${
              o.form === 'cloze' ? ' on a fill-in-the-blank — fills nothing' : ''
            }`,
      );
    }
  }
  lines.push(
    `This objective is ${inputs.fill === 1 ? 'complete' : inputs.fill === 0.5 ? 'half filled' : 'not filled yet'}.`,
  );
  if (inputs.pitch === 'easier') {
    /**
     * **The easier question is a fill-in-the-blank** (2026-10-01). "Ask for recall" was left to the
     * model, and a recall question in prose is still a question to compose an answer to. A blank
     * in a sentence the page already says is the smallest thing that can be asked: one term.
     */
    lines.push(
      `**Ask an easier question than the last one** — ${inputs.reason}. Ask for recall of one`,
      'part of the idea, as a **fill-in-the-blank**: take one sentence from the page, word for word',
      `or nearly, and replace one key term with ${CLOZE_BLANK} (four underscores). One blank only, and`,
      'the missing term is a concept this objective names, never a number, a name or a filler word.',
      'Say "Fill in the blank:" and then the sentence, and nothing after it. Do not reuse the',
      'sentence or the wording of the question they just gave up on, and do not say it is easier.',
    );
  } else if (inputs.pitch === 'harder') {
    lines.push(
      `**You may go harder than the last one** — ${inputs.reason}. Ask them to explain why, or to`,
      'apply it to another case — but one the deck’s own examples or Ellie’s answer equip them',
      'for: no method, notation or format the deck only names. Still one question.',
      /**
       * **Harder is a new angle, not the last question again** (sim harness, 2026-10-01). "Apply
       * it to another case" read literally is the settled question on a different symbol.
       */
      'Take a different angle from the last question: the same distinction asked again about',
      'another symbol or example is not harder, it is the same question.',
    );
  } else if (inputs.lastWasCloze) {
    lines.push(
      `Now ask for it in their own words — ${inputs.reason}, which is recall and not yet an`,
      'explanation. Ask them to say what it means or to tell it apart from what the page sets beside',
      'it. Not another blank, and not a construction, a derivation or a case the page does not work',
      'through.',
    );
  } else if (inputs.firstOnObjective) {
    /**
     * **The first question on an objective is not a construction** (#49). The 2026-09-23 run's
     * first question on p. 7's objective asked the learner to build a CNF encoding the deck only
     * names, and "pitch it where the slide pitches it" did nothing to stop it. The slide pitches
     * p. 7 as a list to distinguish, and the question should ask for that.
     */
    lines.push(
      /**
       * **Use it, on the page's own case** (sim harness, 2026-10-01). "Say it in their own words,
       * or name or tell apart" produced recall: "what is the termination test?", "what are the
       * two conditions?", answered by reading the line back. Using the idea on an example the page
       * already works through is still not a construction, and it is what shows understanding.
       */
      `This is the first question on this objective — ${inputs.reason}. Ask them to use it: apply`,
      'it to a case the page itself works through (its own example), or say in their own words why',
      'it holds. Not a construction, a derivation, or a case the page does not work through: that is',
      'for after they have got this one.',
    );
  } else {
    lines.push(`Pitch it at the same level as the last one — ${inputs.reason}.`);
  }
  lines.push('There are no fixed difficulty rungs: the wording and the angle are yours.');
  return lines.join('\n');
}

/**
 * The sentence the Teacher reads. One line, in the imperative, because the surrounding block is
 * facts and this is the instruction they add up to.
 */
export function pitchLine(state: PitchState): string {
  const said = state.signals.length > 0 ? ` They said: ${state.signals.map((s) => `“${s}”`).join(', ')}.` : '';
  if (state.level < 0) {
    return (
      'PITCH: **lower than the slide’s.** This learner has asked you to come down a level on this' +
      ` file, and it is remembered across turns — do not drift back up.${said}` +
      ' Everyday words first, notation only after the idea has landed, and one concrete example every time.'
    );
  }
  if (state.level > 0) {
    return (
      'PITCH: **rigorous.** This learner has asked for the formal version on this file, so give the' +
      ` statement, the conditions and the properties, not only the intuition.${said}` +
      ' Keep one plain sentence at the top anyway; it costs a line and it is what they come back to.'
    );
  }
  return 'PITCH: ordinary. Nothing on this file says they want it simpler or more formal yet.';
}
