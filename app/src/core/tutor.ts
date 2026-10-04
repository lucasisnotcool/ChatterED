/**
 * **The help ladder and a tutorial part's status** (2026-10-03, `docs/research/tutorials.md` §4,
 * §6).
 *
 * A part's **Hint** button climbs one rung per press, Koedinger & Aleven's assistance dilemma
 * resolved the way the Andes and Cognitive Tutor hint sequences resolve it: point at where the
 * material is, then break the part into sub-steps, then do one step on an analogous case. There
 * is no fourth rung; past the third the learner's choices are to try, ask for a refresher, or
 * give up with **Show answer**. Hints are not timer-gated.
 *
 * Credit is full whatever help was used (Lucas, 3 Oct 2026): the rung is recorded for the research
 * log, and it never discounts the fill. A revealed part fills nothing, as a release never has.
 *
 * Pure: no clock, no I/O, nothing outside `core/`. The types mirror `shared/tutorial.ts`'s
 * `HintLevel` and `TutorialPartStatus`, which the core cannot import.
 */
import type { CoreVerdict } from './planning.js';

/** The rungs of help: 0 none taken, then point · break it down · a worked step. */
export type HintLevel = 0 | 1 | 2 | 3;

/** The same values as `shared/tutorial`'s `TutorialPartStatus`. */
export type PartStatus = 'untried' | 'working' | 'correct' | 'partial' | 'incorrect' | 'revealed';

/** The top rung. */
export const TOP_HINT_LEVEL = 3;

/** The rung the next **Hint** gives, or `top` when the learner has had all three. */
export function nextHintLevel(current: HintLevel): { level: 1 | 2 | 3 } | { top: true } {
  switch (current) {
    case 0:
      return { level: 1 };
    case 1:
      return { level: 2 };
    case 2:
      return { level: 3 };
    case 3:
      return { top: true };
  }
}

/** What each rung is called on the part's chrome and in the chat's request line. */
export function hintRungName(level: 1 | 2 | 3): 'Point' | 'Break it down' | 'A worked step' {
  switch (level) {
    case 1:
      return 'Point';
    case 2:
      return 'Break it down';
    case 3:
      return 'A worked step';
  }
}

/**
 * The status a check leaves: `complete` → correct, `partial` → partial, `not_yet` → incorrect.
 *
 * A part already **revealed** stays revealed: once the answer has been shown, an answer that
 * matches it is a copy, and it must not turn a release into a fill. Pass `prev` for that.
 */
export function statusAfterCheck(verdict: CoreVerdict, prev?: PartStatus): PartStatus {
  if (prev === 'revealed') return 'revealed';
  switch (verdict) {
    case 'complete':
      return 'correct';
    case 'partial':
      return 'partial';
    case 'not_yet':
      return 'incorrect';
  }
}

/**
 * The status after the learner edits a part's answer, given whether it is now `empty`.
 *
 * - **revealed** stays revealed, whatever is written (see `statusAfterCheck`).
 * - An emptied answer is **untried** again: a ✓ beside nothing would be a lie.
 * - Otherwise `untried` becomes **working**, and a checked status (`correct`, `partial`,
 *   `incorrect`) **stays until the next check**. The pill is "the last check's verdict"
 *   (`shared/tutorial.ts`); dropping it on every keystroke would make *Parts 4 / 9* flicker as a
 *   learner tidies a correct answer, and a fresh check is one press away.
 */
export function statusAfterEdit(prev: PartStatus, empty: boolean): PartStatus {
  if (prev === 'revealed') return 'revealed';
  if (empty) return 'untried';
  return prev === 'untried' ? 'working' : prev;
}

/**
 * How much a part fills its objectives: correct 1, partial ½, anything else nothing. A revealed
 * part fills nothing; hints never discount (full credit, Lucas 3 Oct 2026).
 */
export function fillFor(status: PartStatus): 1 | 0.5 | 0 {
  if (status === 'correct') return 1;
  if (status === 'partial') return 0.5;
  return 0;
}
