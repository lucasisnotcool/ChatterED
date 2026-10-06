/**
 * **What an objective has earned** (§6, and `progress-tracking.md` §4.4's hard rules, unchanged).
 *
 * > An objective completes on the learner's own correct answer: Max's verdict *Well done* on the
 * > learner's words completes it; *Partly there* half-fills it. **A released answer, Ellie's cue
 * > and agreement fill nothing.** The ledger's hard rules are unchanged: only the learner's
 * > verbatim words are evidence.
 *
 * Twelve lines, and they are the counterweight the whole brief rests on. §1 admits the departure
 * this design makes — "the doc is AI-written, so the durable artefact is mostly the agents'
 * words" — and names this as what balances it: the bar only ever moves on something the learner
 * said. So `released` fills nothing *by construction here*, not by a caller remembering to
 * filter, and there is no path in this function from an agent's turn to a fill.
 *
 * Best verdict, not last: a learner who earns *Well done* and then fumbles a follow-up has still
 * demonstrated the objective. The ledger keeps the whole history; this is the bar's one number.
 */

import type { ProgressFill, QuizOutcome } from './types.js';

export function progressFill(outcomes: readonly QuizOutcome[]): ProgressFill {
  let best: ProgressFill = 0;
  for (const outcome of outcomes) {
    // `released` — give-up, Pass, or the closure rule (§4.4, §4.7) — is a full answer the learner
    // read, not one they gave.
    if (outcome.kind !== 'verdict') continue;
    // A fill-in-the-blank (§4.5, 2026-10-01) is one recalled term, not the learner's own words
    // about the objective. Its verdict is kept as a row and fills nothing, by construction here.
    if (outcome.form === 'cloze') continue;
    if (outcome.verdict === 'complete') return 1;
    if (outcome.verdict === 'partial') best = 0.5;
    // `not_yet` is the third verdict (§4.2's "Not yet."): feedback, and no fill.
  }
  return best;
}

/**
 * **The `questionId` prefix of a tutorial part's outcome rows** (`main/tutorial/check.ts`,
 * `tutorialQuestionId`). A part is checked against its own hidden key, not against a card of the
 * notes, so its rows keep filling the bar exactly as before decision 9.
 */
export const TUTORIAL_QUESTION_PREFIX = 'tut:';

export function isTutorialOutcome(outcome: Pick<QuizOutcome, 'questionId'>): boolean {
  return outcome.questionId.startsWith(TUTORIAL_QUESTION_PREFIX);
}

/** An own-words *Well done*: a `complete` verdict on an open question (a blank's fills nothing). */
function earnedVerdict(outcome: QuizOutcome): boolean {
  return outcome.kind === 'verdict' && outcome.verdict === 'complete' && outcome.form !== 'cloze';
}

/**
 * **The concept cards that have a *Well done*** (6 Oct afternoon, decision 9 on #67): the card of
 * every own-words *Well done*. `cardOf` reads a row's card (`QuizOutcome.cardId`, or the caller's
 * fallback for a row written before migration 031); a row about no card earns no card.
 */
export function cardsEarned(
  outcomes: readonly QuizOutcome[],
  cardOf: (outcome: QuizOutcome) => string | null = (o) => o.cardId ?? null,
): Set<string> {
  const done = new Set<string>();
  for (const outcome of outcomes) {
    if (!earnedVerdict(outcome)) continue;
    const card = cardOf(outcome);
    if (card) done.add(card);
  }
  return done;
}

/**
 * **What a topic has earned, card by card** (6 Oct afternoon, decision 9 on #67;
 * `notebooks.md` §11.10.4).
 *
 * > A topic is done only when every concept card it covers has a *Well done*. Until then it is
 * > partly done.
 *
 * The Lecture-sdm evidence: one *Well done* on value iteration made a topic "1 of 6 complete"
 * though the same topic covers policy iteration, whose question had ended in a give-up.
 *
 *  - **No cards** (a prose source, an older doc, an objective whose blocks hold none): exactly
 *    `progressFill(outcomes)`, unchanged.
 *  - **Cards**: complete (1) only when every covered card is in `earned`, the cards with an
 *    own-words *Well done* (`cardsEarned`, by default over these outcomes; the caller may pass the
 *    file's, since a card is the same idea whichever objective its question was filed under).
 *    Otherwise partly done (0.5) when anything of the learner's is on record: a fill from these
 *    outcomes, or one of the cards earned. A release and a blank still fill nothing.
 *  - **A tutorial part's *Well done*** completes the objective as it always has (Lucas, 3 Oct:
 *    full credit whatever help was used). Decision 9 leaves tutorial parts' behaviour unchanged.
 */
export function topicFill(
  outcomes: readonly QuizOutcome[],
  cards: readonly string[],
  earned: ReadonlySet<string> = cardsEarned(outcomes),
): ProgressFill {
  const best = progressFill(outcomes);
  if (cards.length === 0) return best;
  if (outcomes.some((o) => isTutorialOutcome(o) && earnedVerdict(o))) return 1;
  if (cards.every((card) => earned.has(card))) return 1;
  return best > 0 || cards.some((card) => earned.has(card)) ? 0.5 : 0;
}

/**
 * **Revision: the second clause of the learning goal** (`docs/research/measurement.md` M2).
 *
 * The goal is *"answer a question about the lecture in their own words, **and revise that answer
 * after feedback**."* `progressFill` above answers the first clause and cannot answer the second:
 * it keeps the best verdict, so a learner who is right first try and a learner who recovers from
 * *Partly there* read identically. Recovery is the behaviour the design exists to produce and the
 * one the observed sessions never showed — 0 of 17 attempts was a second try at the same question,
 * and 17 of 21 feedback turns carried the next question in the same message.
 *
 * So it is counted separately, and not folded into the fill:
 *
 *  - **eligible** — verdicts that left something to revise (`partial` or `not_yet`). A *Well done*
 *    is not a missed revision; there was nothing to revise.
 *  - **revised** — of those, the questions that went on to receive a verdict on a *later* attempt.
 *    Counted per question, not per verdict, so a learner who tries four times on one question is
 *    one recovery and not three.
 *
 * `rate` is `null` when nothing was eligible. A learner who was right every time has no revision
 * rate, and reporting 0 for them would read as a failure to revise.
 */
export interface RevisionStats {
  eligible: number;
  revised: number;
  rate: number | null;
}

export function revisionStats(outcomes: readonly QuizOutcome[]): RevisionStats {
  const firstEligibleAttempt = new Map<string, number>();
  const bestLaterAttempt = new Map<string, number>();
  for (const o of outcomes) {
    if (o.kind !== 'verdict' || o.attemptIndex === null) continue;
    const at = o.attemptIndex;
    if (o.verdict === 'partial' || o.verdict === 'not_yet') {
      const seen = firstEligibleAttempt.get(o.questionId);
      if (seen === undefined || at < seen) firstEligibleAttempt.set(o.questionId, at);
    }
    const best = bestLaterAttempt.get(o.questionId);
    if (best === undefined || at > best) bestLaterAttempt.set(o.questionId, at);
  }
  let revised = 0;
  for (const [questionId, at] of firstEligibleAttempt) {
    if ((bestLaterAttempt.get(questionId) ?? at) > at) revised += 1;
  }
  const eligible = firstEligibleAttempt.size;
  return { eligible, revised, rate: eligible === 0 ? null : Math.round((revised / eligible) * 100) / 100 };
}
