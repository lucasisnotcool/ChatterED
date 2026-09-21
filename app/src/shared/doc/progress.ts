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
    if (outcome.verdict === 'complete') return 1;
    if (outcome.verdict === 'partial') best = 0.5;
    // `not_yet` is the third verdict (§4.2's "Not yet."): feedback, and no fill.
  }
  return best;
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
