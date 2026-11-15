/**
 * **Active time, for the field study** (`docs/group/field-study.md`, "What must be added", item 6).
 *
 * `app.start` and `app.quit` give sittings, not time in use: an app left open over lunch is not a
 * learner working. So a minute counts as active when the learner typed, clicked, scrolled or moved
 * the pointer in the window at least once during it, and the renderer reports the count every few
 * minutes as `app.active` (`shared/studylog.ts`), and again when the window is hidden or closed.
 *
 * The counting is here and pure (a clock is passed in), so it is tested without a window.
 */

const MINUTE_MS = 60_000;

export class ActiveClock {
  /** Minutes (since the epoch) with any input, not yet reported. */
  readonly #pending = new Set<number>();
  /** The latest minute already reported: input later in that same minute is not counted twice. */
  #reportedThrough = -Infinity;

  /** The learner did something at `now` (ms). */
  mark(now: number): void {
    const minute = Math.floor(now / MINUTE_MS);
    if (minute > this.#reportedThrough) this.#pending.add(minute);
  }

  /** The active minutes since the last call, and forget them. 0 when there were none. */
  take(): number {
    const n = this.#pending.size;
    if (n > 0) this.#reportedThrough = Math.max(this.#reportedThrough, ...this.#pending);
    this.#pending.clear();
    return n;
  }
}

/** How often the renderer reports, at most: every five minutes keeps the log small. */
export const REPORT_EVERY_MS = 5 * MINUTE_MS;

/**
 * Start counting in this window and reporting through `send`. The listeners are passive and on
 * the capture phase, so no component can stop them and none is slowed. Returns a stop function.
 */
export function startActiveClock(send: (minutes: number) => void, target: Window = window): () => void {
  const clock = new ActiveClock();
  const mark = (): void => clock.mark(Date.now());
  const flush = (): void => {
    const minutes = clock.take();
    // A report covers at most an hour (the channel's cap); a longer one is split.
    for (let left = minutes; left > 0; left -= 60) send(Math.min(left, 60));
  };
  const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
  for (const e of events) target.addEventListener(e, mark, { capture: true, passive: true });
  const onHidden = (): void => {
    if (target.document.visibilityState === 'hidden') flush();
  };
  target.document.addEventListener('visibilitychange', onHidden);
  target.addEventListener('pagehide', flush);
  const timer = setInterval(flush, REPORT_EVERY_MS);
  return () => {
    clearInterval(timer);
    for (const e of events) target.removeEventListener(e, mark, { capture: true });
    target.document.removeEventListener('visibilitychange', onHidden);
    target.removeEventListener('pagehide', flush);
    flush();
  };
}
