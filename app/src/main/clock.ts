import type { Clock } from '../room/ports.js';

/**
 * The production clock: wall time, and a 1 s tick that runs in the MAIN process, which is not
 * subject to Chromium's renderer throttling (architecture-mac.md §C.3).
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  setInterval(fn, ms) {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
