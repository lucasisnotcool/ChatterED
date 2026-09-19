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
 *    answer to it. It does not lift the answer lock and it is not an attempt.
 *  - **`attempt`** — everything else. **A two-word answer is an attempt.** It may not move the
 *    ledger (rule 4's eight-word floor stands, untouched) but it lifts the answer lock: the lock
 *    is about having tried, and the ledger is about having explained.
 */
import { isAgreementPhrase } from './ledger.js';

export type LearnerTurnKind = 'attempt' | 'answer_request' | 'question' | 'other';

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

export function isAnswerRequest(body: string): boolean {
  const normalised = normalise(body);
  if (normalised.length === 0) return false;
  if (contentWords(normalised).length > SHORT_TURN_WORDS) return false;
  // Apostrophes are dropped too, so "what's the answer" and "whats the answer" are one phrase.
  const bare = normalised.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  return ANSWER_REQUEST_PHRASES.some((p) =>
    p.match === 'whole' ? bare === p.phrase : bare.includes(p.phrase),
  );
}

/**
 * §2.2, to implement literally. Pure, so the rules that read it are testable without a room.
 */
export function classifyLearnerTurn(body: string): LearnerTurnKind {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'other';
  // Ledger rule 4's own predicate. "ok" is not an attempt, and it is the reply R6 actually gave.
  if (isAgreementPhrase(trimmed)) return 'other';
  if (isAnswerRequest(trimmed)) return 'answer_request';

  const words = contentWords(trimmed);
  const endsInQuestion = /\?\s*$/.test(trimmed);
  if (
    endsInQuestion &&
    words.length <= SHORT_TURN_WORDS &&
    sentences(trimmed).length === 1 &&
    !CONFIRMATION_TAG.test(trimmed) &&
    INTERROGATIVE.test(normalise(trimmed))
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
export type QuizCueKind = 'handoff' | 'try' | 'feedback' | 'hint' | 'clarify' | 'answer';

export function quizCue(kind: QuizCueKind, n: number): string {
  return `${kind}:${n}`;
}
