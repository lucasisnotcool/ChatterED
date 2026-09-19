/**
 * **How a deck is cut into refine windows** (#48, `collab-doc.md` §2: "long decks are ingested in
 * page windows with a running outline so the notes stay cohesive").
 *
 * Pure arithmetic over the page numbers pass 1 produced, so the plan is deterministic and can be
 * stored on the row (`ingest_state.windows`) rather than recomputed — a run resumed after a
 * killed window or an app quit must produce the *same* windows as the run it is resuming, even
 * if these numbers are tuned in between.
 *
 * **Why 8–12 pages and not 3–4.** Each window is one serialised call on the CLI's single lane
 * (`claude-cli.ts` `CLI_SINGLE_LANE`), so the deck's wall-clock is roughly *windows × call*.
 * Halving the window size doubles the number of calls, doubles the fixed cost of the system
 * prompt and the running outline, and makes the notes *less* cohesive, not more — a four-slide
 * window cannot see that slides 3–9 are one argument. Twelve is the other end: past that the
 * model starts summarising the window instead of writing it out.
 *
 * **Why even, rather than greedy.** A greedy 12-12-12-12-12-6 leaves a last window half the size
 * of the others, and the last window is the one that writes the deck's conclusion. Six windows
 * of eleven is the same number of calls and none of them is a runt.
 */

/** The most pages one window may carry. Past this the model summarises instead of writing. */
export const WINDOW_MAX_PAGES = 12;

/** One window of the plan: 1-based, inclusive, in the source deck's own page numbers. */
export interface PageWindow {
  from: number;
  to: number;
}

/**
 * Cut a deck's pages into windows.
 *
 * `pages` are the page numbers pass 1 actually produced, ascending — which is not always
 * `1..n`: Stage 0 folds a slide animated in four steps into one page, so a 70-page file can
 * yield 62 pages with gaps. The windows are ranges over the *source* numbering, so selecting a
 * window's pages is `page >= from && page <= to` and a gap costs nothing.
 */
export function planWindows(pages: readonly number[]): PageWindow[] {
  const sorted = [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 1).sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const count = Math.max(1, Math.ceil(sorted.length / WINDOW_MAX_PAGES));
  const base = Math.floor(sorted.length / count);
  // The first `extra` windows take one page more, so the sizes differ by at most one.
  const extra = sorted.length % count;

  const windows: PageWindow[] = [];
  let i = 0;
  for (let w = 0; w < count; w += 1) {
    const size = base + (w < extra ? 1 : 0);
    windows.push({ from: sorted[i]!, to: sorted[i + size - 1]! });
    i += size;
  }
  return windows;
}

/** The items of one window, for any per-page collection keyed by page number. */
export function inWindow<T extends { page: number }>(items: readonly T[], window: PageWindow): T[] {
  return items.filter((item) => item.page >= window.from && item.page <= window.to);
}
