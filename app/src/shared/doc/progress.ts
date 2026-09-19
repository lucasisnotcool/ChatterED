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
