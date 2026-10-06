/**
 * **Is the learner ready to be checked on this section?** (Lucas's decision of 2026-10-06, D2;
 * `collab-doc.md` §6 and `notebooks.md` §5.2, amended 2026-10-06.)
 *
 * The evidence behind it (Lucas's own runs of 2026-10-03 to 10-05, audited on 10-06): all 30
 * recent quizzes opened from a lesson Start, with Max asking within 15 s, and Quiz me was pressed
 * 0 times. The cold openers, asked as a room opened, were the unready ones: the learner's next
 * message asked what the term meant. A question that followed the learner's own Explain or
 * questions on that section was answered. So readiness is decided **in code, from
 * what the learner did**, and the app only ever *offers* the check ("Ready to check this?"); the
 * learner presses it, and it goes through Quiz me. Max never asks unprompted.
 *
 * The signals, all counted **since the last question on this objective closed** (so a release does
 * not leave the section "ready" for an immediate re-ask, which is how three lesson Starts re-fired
 * on one objective 34–48 s after a release):
 *
 *  - **help**: Explain or Example pressed on the section's lines, or a question to Ellie about
 *    the section, which is the learner asking to be taught. Questions count since 6 Oct afternoon
 *    (decision 8 on #67; `notebooks.md` §11.10.4): in the Lecture-sdm session five questions to
 *    Ellie about one section counted nothing, while one Explain press would have;
 *  - **own words**: what the learner has written in the section themselves (author mark `user`),
 *    outside any question;
 *  - **depth opened**: a fold opened under a line (a concept card's depth, the section's slides);
 *  - **time on the section**: how long it has been the one being read.
 *
 * **Time alone is never enough.** A learner can leave a section on screen and walk away; a check
 * offered then is the cold opener again. **One act alone is not enough either**: a single Explain
 * pressed and then left was followed, in those runs, by a give-up. Ready is *time on the
 * section* and *one act of engagement*. An objective already earned is never offered again, in
 * this conversation or after New Conversation, because the caller reads `done` from the outcome
 * rows, which outlive a room.
 *
 * Pure: no clock (the caller measures `dwellMs`), no I/O, nothing outside `core/`.
 */

/** What the caller measured about one section, since the last question on its objective closed. */
export interface ReadinessSignals {
  /** The objective is earned: an own-words *Well done* is on record (`progressFill` is 1). */
  done: boolean;
  /** Max has a question open on it right now. */
  questionOpen: boolean;
  /** Explain presses on the section's lines. */
  explains: number;
  /** Example presses on the section's lines. */
  examples: number;
  /**
   * Questions the learner asked Ellie about the section and she answered (decision 8). Optional
   * so a caller built before it reads as none.
   */
  questions?: number;
  /** Words the learner wrote in the section themselves, outside any question block. */
  ownWords: number;
  /** Folds opened under the section's lines: a card's depth, the section's slides. */
  depthOpened: number;
  /** Time the section has been the one being read, in milliseconds. */
  dwellMs: number;
}

/**
 * **One minute on the section.** At the 238 wpm the rest of the app reads at (`attempt-first.md`
 * §5), that is about 240 words: a concept card's core line and one opened depth item, or Ellie's
 * walk-through of it. The cold openers were asked within 15 s of the section appearing; a minute
 * is four times that and still shorter than the 2–5 min Ellie waits before her cue (§4.3).
 */
export const READY_DWELL_MS = 60_000;

/**
 * **One sentence of the learner's own.** `collab-doc.md` §6 counted the learner's doc text from
 * "at least one sentence"; twelve words is a short one. Fewer is a heading or a note to self
 * ("see p. 4"), which says nothing about understanding.
 */
export const READY_OWN_WORDS = 12;

/**
 * **Two folds opened.** Opening depth is reading, which is weaker than asking (help) or writing
 * (own words): one fold is curiosity about one line, two is working through the section.
 */
export const READY_DEPTH_OPENED = 2;

/** The engagement that counted, in the order the offer names them. */
export type ReadinessReason = 'help' | 'own_words' | 'depth';

export type Readiness =
  /** Earned: never offered again. */
  | { state: 'done' }
  /** A question on it is open now: the open question is the check. */
  | { state: 'asking' }
  /** Offer "Ready to check this?". `because` is never empty. */
  | { state: 'ready'; because: ReadinessReason[] }
  /** Not yet. `needs` says what is missing: time on the section, an act of engagement, or both. */
  | { state: 'not_yet'; needs: Array<'time' | 'engagement'> };

/** Counts arrive from storage and the DOM; a negative or non-finite one is read as none. */
function count(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function readiness(signals: ReadinessSignals): Readiness {
  if (signals.done) return { state: 'done' };
  if (signals.questionOpen) return { state: 'asking' };
  const because: ReadinessReason[] = [];
  if (count(signals.explains) + count(signals.examples) + count(signals.questions ?? 0) >= 1) because.push('help');
  if (count(signals.ownWords) >= READY_OWN_WORDS) because.push('own_words');
  if (count(signals.depthOpened) >= READY_DEPTH_OPENED) because.push('depth');
  const timeOk = count(signals.dwellMs) >= READY_DWELL_MS;
  if (timeOk && because.length > 0) return { state: 'ready', because };
  const needs: Array<'time' | 'engagement'> = [];
  if (!timeOk) needs.push('time');
  if (because.length === 0) needs.push('engagement');
  return { state: 'not_yet', needs };
}

/** Shorthand for the renderer: whether to show the offer at all. */
export function offerCheck(signals: ReadinessSignals): boolean {
  return readiness(signals).state === 'ready';
}
