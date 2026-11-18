/**
 * **What the stage-0 bootstrap hands the app**: the build, the update note, the health marks,
 * repair mode, smoke mode and the test variant's faults. Imports nothing, so `index.ts` can read
 * it without pulling the updater in, and a broken updater can never break the app's imports.
 * Every function is safe to call when the bootstrap set nothing (a unit test, a dev run).
 */

export type Fault =
  | 'crash-at-launch'
  | 'crash-at-launch-live'
  | 'fail-migration'
  | 'fail-migration-live'
  | 'hang-boot'
  | 'hang-boot-live'
  | 'never-healthy-live';

export interface UpdateRuntime {
  build: number;
  sha: string;
  channel: string | null;
  /** Why updates are off, or null when they are on. */
  disabledReason: string | null;
  /** Set when this process is a smoke launch of a staged build (`--chattered-smoke`). */
  smoke: boolean;
  /** Test variant only: the fault this build was compiled with. */
  fault: Fault | null;
  /** "Updated to build N", once. */
  takeNote(): { from: number; to: number } | null;
  /** DB open and the window's bridge up: called by index.ts after `renderer.ready`. */
  rendererReady(): void;
  /**
   * The app could not start (`failBoot`): roll back now (`exiting`: the app is exiting), or start
   * the search for a fix in its own process (`repairing`), or neither (`none`: updates are off).
   */
  repair(cause: string): 'exiting' | 'repairing' | 'none';
  /** The `update` section of the debug report. */
  debugInfo(): Record<string, unknown>;
  /** A minimal report for when even the app's own debug report cannot load. */
  bootstrapReport(error: string): string;
}

const NONE: UpdateRuntime = {
  build: 0,
  sha: 'unknown',
  channel: null,
  disabledReason: 'no_bootstrap',
  smoke: false,
  fault: null,
  takeNote: () => null,
  rendererReady: () => undefined,
  repair: () => 'none',
  debugInfo: () => ({ enabled: false, reason: 'no_bootstrap' }),
  bootstrapReport: (error) => `ChatterED (no bootstrap)\nerror: ${error}\n`,
};

let current: UpdateRuntime = NONE;

export function setRuntime(rt: UpdateRuntime): void {
  current = rt;
}

export function runtime(): UpdateRuntime {
  return current;
}

/** The fault is live in this process: `-live` faults skip the smoke launch, so the build gets staged. */
export function faultActive(name: 'crash-at-launch' | 'fail-migration' | 'hang-boot' | 'never-healthy'): boolean {
  const f = current.fault;
  if (!f) return false;
  if (f === name) return true;
  return f === `${name}-live` && !current.smoke;
}

// ── busy: work an idle relaunch must not cut short (review #5) ──────────────

let inFlight = 0;

/**
 * Mark work that an idle or locked-screen relaunch must wait for: an LLM call, an IPC request
 * (a tutorial read is one long request), a notebook being read. Returns the function that ends it;
 * calling that twice is harmless.
 */
export function workStarted(): () => void {
  inFlight += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight = Math.max(0, inFlight - 1);
  };
}

/** True while any marked work is in flight. */
export function isBusy(): boolean {
  return inFlight > 0;
}
