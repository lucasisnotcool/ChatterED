/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * HELP ON AN OPEN QUESTION, WHEN THE LEARNER ASKS FOR IT (decision 7, 6 Oct 2026 afternoon)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Until 6 Oct the quiet on Max's open question was filled for the learner: two minutes drew
 * Ellie's planted guess, ninety seconds more drew Max asking whether she was right (the MDP run's
 * #4 and #5). Lucas: no interruptions when the learner goes quiet. The actor now leaves that quiet
 * alone (`orchestrator.silenceDecision`, `rule:question_quiet`), and the help moves onto the
 * question itself: after `QUIET_HELP_MS` of quiet, **Hint** and **Show me** appear on it in the
 * rail (`nodeviews.ts`), and the learner presses one or neither.
 *
 * "Quiet" does not count **time the composer has text**: a learner writing an answer, in the chat
 * or under the question, is working, not stuck. Nor does it count a gap between ticks longer than
 * `MAX_TICK_MS` (a sleeping laptop, a hidden window): that is time away, not time stuck on the
 * question. Once offered, the buttons stay until the question closes; they never flicker away
 * because the learner started typing.
 *
 * Pure, apart from the small drafting registry at the bottom, which is module state on purpose:
 * the chat's composers and the notes' node views are in different component trees, and the clock
 * only needs to ask "is anything being written right now?".
 */

/** How long a question waits, quiet, before Hint and Show me are offered on it. */
export const QUIET_HELP_MS = 3 * 60_000;

/** The longest gap one tick may count. A longer one was the app asleep or out of sight. */
export const MAX_TICK_MS = 5_000;

/** How often a view ticks its clock. */
export const QUIET_TICK_MS = 1_000;

export interface QuietClock {
  /** Quiet time counted so far, in ms. */
  quietMs: number;
  /** When the clock last ticked, or null before the first tick. */
  lastTickAt: number | null;
  /** True once `quietMs` has reached `QUIET_HELP_MS`. Never goes back. */
  offered: boolean;
}

export function startQuiet(now: number): QuietClock {
  return { quietMs: 0, lastTickAt: now, offered: false };
}

/**
 * One tick. `drafting` is "the learner has text in a composer, or under this question": that
 * time is not quiet. A gap over `MAX_TICK_MS` counts as `MAX_TICK_MS` at most.
 */
export function tickQuiet(clock: QuietClock, now: number, input: { drafting: boolean }): QuietClock {
  const last = clock.lastTickAt ?? now;
  const gap = Math.max(0, Math.min(now - last, MAX_TICK_MS));
  const quietMs = input.drafting ? clock.quietMs : clock.quietMs + gap;
  return { quietMs, lastTickAt: now, offered: clock.offered || quietMs >= QUIET_HELP_MS };
}

// ── the clocks, one per open question, for the length of the session ─────────────────────────

/**
 * Kept per question id rather than per view: ProseMirror may redraw a node view (an edit above it,
 * the rail moving inline on a narrow window), and a redraw must not restart the learner's clock.
 */
const clocks = new Map<string, QuietClock>();

/** The question's clock, ticked to `now`. Starts it on first sight. */
export function quietFor(questionId: string, now: number, drafting: boolean): QuietClock {
  const clock = clocks.get(questionId);
  const next = clock === undefined ? startQuiet(now) : tickQuiet(clock, now, { drafting });
  clocks.set(questionId, next);
  return next;
}

/** A question that closed: its clock goes. */
export function forgetQuiet(questionId: string): void {
  clocks.delete(questionId);
}

// ── is anything being written? ──────────────────────────────────────────────────────────────

const drafts = new Set<string>();

/** A composer reports whether it has text. `source` is any id unique to that composer. */
export function noteDraft(source: string, hasText: boolean): void {
  if (hasText) drafts.add(source);
  else drafts.delete(source);
}

/** True while any composer has text in it. */
export function drafting(): boolean {
  return drafts.size > 0;
}

/** For tests: every clock and draft forgotten. */
export function resetQuietHelp(): void {
  clocks.clear();
  drafts.clear();
}
