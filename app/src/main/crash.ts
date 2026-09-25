/**
 * **How often a crashed window is brought back by itself** (release review P1-13).
 *
 * A renderer that dies (pdf.js out of memory on a big deck, a GPU fault) is reloaded, because
 * every piece of state that matters is in the main process and the page re-bootstraps from it.
 * But a page that crashes *because* of what it loads would crash again on every reload, so the
 * reloads are budgeted: more than `limit` crashes inside `windowMs` and the window is left alone
 * and the learner is told instead.
 */
export class CrashBudget {
  readonly #limit: number;
  readonly #windowMs: number;
  #times: number[] = [];

  constructor(limit = 3, windowMs = 60_000) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Records a crash at `now`; true when an automatic reload is still within budget. */
  record(now: number): boolean {
    this.#times = this.#times.filter((t) => now - t < this.#windowMs);
    this.#times.push(now);
    return this.#times.length <= this.#limit;
  }
}

/**
 * The `render-process-gone` reasons that are not a crash: the renderer was closed on purpose
 * (window closed, app quitting). Anything else is reloaded, within the budget.
 */
export function isCrash(reason: string): boolean {
  return reason !== 'clean-exit';
}
