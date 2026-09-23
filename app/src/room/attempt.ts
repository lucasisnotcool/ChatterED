/**
 * **What the learner's turn is, while a Tester question is open** (issue #47,
 * `docs/research/attempt-first.md` §2.2).
 *
 * The brief's evidence is the whole reason this file exists. In five of the six study sessions
 * (`ai-use-transcripts/analysis/findings.md` §3.0) the learner never produced an attempt, the AI
 * never asked for one, and every offer to quiz was declined; the one productive session became
 * productive only after the learner typed *"I will attempt the question"* and *"do not send the
 * answer"*. Both of R6's hints were followed by a bare `answer?`.
 *
 * So the app owes the learner that protocol by default, and it owes it as **code**: the rules in
 * `orchestrator.ts` that withhold the answer read this classification, and the model is never
 * asked whether it should answer its own question (§2.3: *"All are code; the model is never asked
 * whether to answer its own question"*).
 *
 * Four kinds, and the order they are decided in:
 *
 *  - **`other`** — nothing was said, or the turn is agreement only. The same predicate ledger
 *    rule 4 uses (`isAgreementPhrase`), because "ok" is the reply R6 gave to eleven wrong
 *    verdicts and it is exactly as much an attempt here as it is evidence there.
 *  - **`answer_request`** — R6's own phrasings, at most 25 words. The list is a constant so the
 *    tests can quote the transcript rather than paraphrase it.
 *  - **`question`** — one short interrogative sentence: a clarification of the question, not an
 *    answer to it. It does not lift the answer lock and it is not an attempt. **A hedged answer is
 *    not a question**: *"is it an action, or a series of actions that lead to the goal?"* opens
 *    like a question and carries the learner's candidate answer, and Lucas's 2026-09-19 run showed
 *    what treating it as a clarification does — Max clarified, nothing was marked, and the learner
 *    did not know whether he had answered. So a sentence that opens *is it / could it be / is the
 *    answer …* or that offers alternatives (*A, or B?*) is an **attempt**.
 *  - **`attempt`** — everything else. **A two-word answer is an attempt.** It may not move the
 *    ledger (rule 4's eight-word floor stands, untouched) but it lifts the answer lock: the lock
 *    is about having tried, and the ledger is about having explained.
 */
import { isAgreementPhrase } from './ledger.js';

/**
 * **`give_up` replaces `answer_request`** (#48, `collab-doc.md` §4.4).
 *
 * `attempt-first.md` §2.3 had two outcomes for an ask: withheld before one attempt, shown after.
 * The collab-doc brief deletes the first — *"a learner must never see a question they never get
 * the answer to, and a refused answer teaches less than a lowered question"* — so the class that
 * used to mean *"they asked for the answer"* now means *"they are done trying"*, and it absorbs
 * the don't-know and frustration phrasings the brief lists alongside R6's own asks. One class,
 * because the rule it feeds is one rule: Max releases the answer, and the next question on that
 * objective is pitched lower (`pitch.ts`).
 */
export type LearnerTurnKind = 'attempt' | 'give_up' | 'question' | 'other';

/** Above this a turn is too long to be a bare request or a one-line clarification. */
export const SHORT_TURN_WORDS = 25;

export interface AnswerRequestPhrase {
  phrase: string;
  /**
   * `whole` matches the entire message (punctuation stripped), `contains` matches anywhere.
   *
   * The distinction is load-bearing, not tidiness: R6's request is the single word `answer?`, and
   * a `contains` match on "answer" would classify *"my answer is that the Hessian is PSD"* as a
   * request for the answer — the exact turn the loop exists to reward.
   */
  match: 'whole' | 'contains';
}

/**
 * **R6's own lines** (`findings.md` §3.0, RQ5), plus the near-neighbours of each. Extend it here
 * and nowhere else: `classifyLearnerTurn` is the only reader, and the rules that withhold the
 * answer are the only readers of *that*.
 */
export const ANSWER_REQUEST_PHRASES: readonly AnswerRequestPhrase[] = [
  // R6, twice, each straight after a hint: "answer?"
  { phrase: 'answer', match: 'whole' },
  { phrase: 'the answer', match: 'whole' },
  { phrase: 'whats the answer', match: 'contains' },
  { phrase: 'what is the answer', match: 'contains' },
  { phrase: 'tell me the answer', match: 'contains' },
  { phrase: 'give me the answer', match: 'contains' },
  { phrase: 'send me the answer', match: 'contains' },
  { phrase: 'show me the answer', match: 'contains' },
  { phrase: 'just tell me', match: 'contains' },
  // R6: "please solve the question"
  { phrase: 'please solve', match: 'contains' },
  { phrase: 'solve the question', match: 'contains' },
  { phrase: 'solve it', match: 'whole' },
  // R6: "how would you do it?"
  { phrase: 'how would you do it', match: 'contains' },
  { phrase: 'how do you do it', match: 'contains' },
  { phrase: 'i give up', match: 'contains' },
  { phrase: 'give up', match: 'whole' },
  { phrase: 'skip', match: 'whole' },
  { phrase: 'skip it', match: 'whole' },
];

/**
 * **The give-up phrasings the collab-doc brief adds** (`collab-doc.md` §4.4, verbatim: *"I don't
 * know"*, *"idk"*, *"no idea"*, *"I give up"*, *"just tell me"*, *"what's the answer"*, *"this is
 * too hard"*, *"I'm lost"* — the last four already sit in `ANSWER_REQUEST_PHRASES`).
 *
 * The line this list draws against `HINT_REQUEST_PHRASES` is deliberate and is the one thing to
 * argue with here. *"I'm stuck"*, *"hint?"*, *"where do I start"* stay a **hint request** (`other`
 * → `rule:quiz_nudge`): they are a learner still inside the question asking for a way in. *"I'm
 * lost"*, *"I don't know"*, *"this is too hard"* are a learner saying the question is beyond them,
 * which is §4.4's own reading of a give-up (*"a give-up is read as 'too hard': the next question
 * is pitched lower"*, §4.5) — and the cost of getting it wrong is asymmetric, because a released
 * answer fills nothing and an easier next question costs the learner nothing either.
 */
export const GIVE_UP_PHRASES: readonly AnswerRequestPhrase[] = [
  ...ANSWER_REQUEST_PHRASES,
  // §4.4's own list, in its own words.
  { phrase: 'i dont know', match: 'contains' },
  { phrase: 'i do not know', match: 'contains' },
  { phrase: 'dont know', match: 'whole' },
  { phrase: 'idk', match: 'whole' },
  { phrase: 'idk sorry', match: 'whole' },
  { phrase: 'no idea', match: 'contains' },
  { phrase: 'i have no idea', match: 'contains' },
  { phrase: 'this is too hard', match: 'contains' },
  { phrase: 'too hard', match: 'whole' },
  { phrase: 'thats too hard', match: 'contains' },
  { phrase: 'im lost', match: 'contains' },
  { phrase: 'i am lost', match: 'contains' },
  { phrase: 'i cant do this', match: 'contains' },
  { phrase: 'i cannot do this', match: 'contains' },
];

/**
 * Openers that make a sentence a question about the question. A turn that ends in `?` without one
 * of these is a learner thinking aloud, which is an attempt.
 */
const INTERROGATIVE =
  /^(what|why|how|when|which|where|who|whose|whom|does|do|did|is|are|was|were|can|could|should|would|will|shall|may|might|have|has|am)\b/;

/**
 * A hedge, not a question: *"…, is that right?"* is an answer with its uncertainty disclosed,
 * and treating it as a clarification would withhold the feedback the answer has earned.
 */
const CONFIRMATION_TAG = /\b(is that (right|correct)|right|correct|isn'?t it|no|yes|yeah|ok(ay)?|true)\s*\?\s*$/i;

/**
 * **A guess phrased as a question is an attempt.** *"is it X?"*, *"could it be X?"*, *"is the answer
 * X?"* — the learner is putting a candidate up, not asking what the question means. The subject is
 * deliberately narrow: *"is that the same as the gradient?"* (`is that …`) stays a clarification,
 * because there the learner is asking about a term rather than offering an answer.
 */
const HEDGED_ANSWER = /^(is|isn't|could|would|might|can|should|does|will) (it|the answer|this one)\b/;

/**
 * **Alternatives are an attempt too.** *"is it an action, or a series of actions?"*,
 * *"deterministic, or fully observable?"* narrow the answer to candidates the learner has produced;
 * Max can mark that. It takes a comma before the *or*, or an article after it, so *"what does the
 * or in step 3 mean?"* is not caught.
 */
const OFFERS_ALTERNATIVES = /,\s*or\s+\w|\bor\s+(a|an|the|that|just|only)\s/;

/** Lower case, straight apostrophes, collapsed whitespace. Punctuation survives. */
function normalise(body: string): string {
  return body.trim().toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ');
}

function contentWords(body: string): string[] {
  return body.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
}

/** Sentences, for the "one sentence" half of the `question` rule. */
function sentences(body: string): string[] {
  return body
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * **A request for help is a request for a hint, not an attempt** — Lucas, 2026-09-19, mid-quiz:
 * *"can you help me out here"*. It carries no candidate answer, so marking it (`attempt`) is
 * marking nothing, and it is not a request for the answer either. It classifies as `other`, which
 * `rule:quiz_nudge` turns into one hint and no answer — the same turn a silence draws.
 */
export const HINT_REQUEST_PHRASES: readonly AnswerRequestPhrase[] = [
  { phrase: 'hint', match: 'whole' },
  { phrase: 'a hint', match: 'whole' },
  { phrase: 'give me a hint', match: 'contains' },
  { phrase: 'any hint', match: 'contains' },
  { phrase: 'help me out', match: 'contains' },
  { phrase: 'help me', match: 'whole' },
  { phrase: 'help', match: 'whole' },
  { phrase: 'can you help', match: 'contains' },
  { phrase: 'im stuck', match: 'contains' },
  { phrase: 'i am stuck', match: 'contains' },
  { phrase: 'not sure where to start', match: 'contains' },
  { phrase: 'where do i start', match: 'contains' },
];

function bareWords(body: string): string {
  return normalise(body).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchesAny(body: string, phrases: readonly AnswerRequestPhrase[]): boolean {
  const normalised = normalise(body);
  if (normalised.length === 0) return false;
  if (contentWords(normalised).length > SHORT_TURN_WORDS) return false;
  const bare = bareWords(normalised);
  return phrases.some((p) => (p.match === 'whole' ? bare === p.phrase : bare.includes(p.phrase)));
}

/**
 * **A request for background is a question, however many sentences it runs to** (#49).
 *
 * Lucas's 2026-09-23 run, with Max's question on the CNF encoding open: *"Can you give me example
 * of how SAT instances are encoded, format for CNF vars and clauses? I am not familiar with SAT
 * format"*. Two sentences, so the one-sentence `question` rule missed it and it fell through to
 * `attempt` — Max marked it **Not yet**, said it was "a request for background, not an attempt",
 * and the learner, who had asked for exactly what they needed to try, was refused it. The same
 * learner's *"what is a sat based planner?"*, one sentence, drew `rule:quiz_clarify` and the
 * background they wanted.
 *
 * So a turn that **asks to be told something** — *can you explain / give me an example / show me*,
 * or *I'm not familiar with / I don't know what X is* — and carries no candidate answer is a
 * `question`, up to `BACKGROUND_TURN_WORDS`. It is decided before the give-up list, because *"I
 * don't know what CNF means, can you explain it?"* is a learner asking for a way in, not one saying
 * they are done; a bare *"I don't know"* still matches neither pattern here and is still a give-up.
 */
const BACKGROUND_TURN_WORDS = 45;

/** An opener that asks to be told or shown something. Anchored to a sentence start. */
const TELL_ME =
  /^(please |so |ok(ay)? |hmm |sorry |but )?(can|could|would|will) you (please )?(give|show|explain|tell|walk|define|remind|go over|describe|clarify)\b|^(please )?(explain|define|remind me|show me|walk me through|give me an? (example|explanation))\b/;

/** Saying which term they are missing. Anywhere in the turn. */
const NOT_FAMILIAR =
  /\b(i'?m|i am) (not familiar|unfamiliar|not sure what)\b|\bi (don'?t|do not) (know|understand) what\b|\bnever (heard|seen|learn(ed|t)) (of |about )?\b|\bwhat (is|are|does) (a |an |the )?[\w-]+( [\w-]+)?( mean)?\s*\?/;

/**
 * Words that mark a candidate answer rather than a request: the learner is putting something up
 * to be marked, and that is an attempt however it is phrased.
 */
const CANDIDATE = /\b(i think|i guess|i'd say|i would say|my answer|maybe it'?s|probably|because|so it'?s|it'?s like)\b/;

export function isBackgroundRequest(body: string): boolean {
  const normalised = normalise(body);
  if (normalised.length === 0) return false;
  if (contentWords(normalised).length > BACKGROUND_TURN_WORDS) return false;
  // "show me the answer" asks to be shown something too, and it is still R6's give-up.
  if (isAnswerRequest(normalised)) return false;
  if (CANDIDATE.test(normalised) || HEDGED_ANSWER.test(normalised) || OFFERS_ALTERNATIVES.test(normalised)) return false;
  const opensWithAsk = sentences(normalised).some((sentence) => TELL_ME.test(sentence));
  return opensWithAsk || NOT_FAMILIAR.test(normalised);
}

export function isHintRequest(body: string): boolean {
  return matchesAny(body, HINT_REQUEST_PHRASES);
}

/** Apostrophes are dropped too (`bareWords`), so "what's the answer" and "whats the answer" are one phrase. */
export function isAnswerRequest(body: string): boolean {
  return matchesAny(body, ANSWER_REQUEST_PHRASES);
}

/** §4.4: R6's asks plus the don't-know and frustration phrasings. The superset of the above. */
export function isGiveUp(body: string): boolean {
  return matchesAny(body, GIVE_UP_PHRASES);
}

/**
 * §2.2, to implement literally. Pure, so the rules that read it are testable without a room.
 */
export function classifyLearnerTurn(body: string): LearnerTurnKind {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'other';
  // Ledger rule 4's own predicate. "ok" is not an attempt, and it is the reply R6 actually gave.
  if (isAgreementPhrase(trimmed)) return 'other';
  // #49: asking to be told something is not an answer to mark, however many sentences it takes.
  if (isBackgroundRequest(trimmed)) return 'question';
  // §4.4, and it is checked **before** the hint list: a turn that reads both ways ("I don't know,
  // any hint?") is a learner who has said they cannot answer, and the release is the safe side —
  // it fills nothing and it lowers the next question rather than refusing anything.
  if (isGiveUp(trimmed)) return 'give_up';
  // A request for help carries nothing to mark; one hint, no answer (`rule:quiz_nudge`).
  if (isHintRequest(trimmed)) return 'other';

  const words = contentWords(trimmed);
  const endsInQuestion = /\?\s*$/.test(trimmed);
  const normalised = normalise(trimmed);
  if (
    endsInQuestion &&
    words.length <= SHORT_TURN_WORDS &&
    sentences(trimmed).length === 1 &&
    !CONFIRMATION_TAG.test(trimmed) &&
    INTERROGATIVE.test(normalised) &&
    !HEDGED_ANSWER.test(normalised) &&
    !OFFERS_ALTERNATIVES.test(normalised)
  ) {
    return 'question';
  }
  return 'attempt';
}

/**
 * **The script cue for a Tester turn** (issue #47; the same pattern as `handoff:N`).
 *
 * `n` counts Tester *questions* in the actor's lifetime across both doors — the time-based
 * hand-off and "+ Try this" — so every turn that belongs to question 3 carries a `:3`. The
 * scripted backend's beats are written against exactly these names, which is why they are one
 * pure function rather than six template literals at the call site.
 */
export type QuizCueKind =
  | 'handoff'
  | 'try'
  | 'feedback'
  | 'hint'
  | 'clarify'
  | 'answer'
  /**
   * The collab-doc loop's own beats (#48). Same rule: every turn that belongs to question *N*
   * carries `:N`, so `script.notes.ts` can hold the whole loop — answer, follow-up, attempt,
   * feedback, cue, prompt, give-up, release — as named beats that cannot play out of order.
   */
  | 'followup'
  | 'cue'
  | 'prompt'
  | 'release'
  | 'closure'
  | 'doctext';

export function quizCue(kind: QuizCueKind, n: number): string {
  return `${kind}:${n}`;
}
