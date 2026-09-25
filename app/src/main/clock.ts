import type { Clock } from '../room/ports.js';

/**
 * Called with `true` when the first interval is armed and `false` when the last one is cleared.
 * `index.ts` holds App Nap off exactly while this is `true` (release review P2-4): a room's 1 s
 * silence tick and its closure tick are the only intervals, and a napping process does not tick.
 */
type ActivityListener = (active: boolean) => void;

let armed = 0;
let listener: ActivityListener | null = null;

export function onIntervalActivity(fn: ActivityListener | null): void {
  listener = fn;
  fn?.(armed > 0);
}

/** Tests: how many intervals are armed right now. */
export function armedIntervals(): number {
  return armed;
}

/**
 * The production clock: wall time, and a 1 s tick that runs in the MAIN process, which is not
 * subject to Chromium's renderer throttling (architecture-mac.md §C.3).
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  setInterval(fn, ms) {
    const handle = setInterval(fn, ms);
    armed += 1;
    if (armed === 1) listener?.(true);
    let cleared = false;
    return () => {
      clearInterval(handle);
      if (cleared) return;
      cleared = true;
      armed -= 1;
      if (armed === 0) listener?.(false);
    };
  },
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
