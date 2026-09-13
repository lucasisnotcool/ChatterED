/**
 * The silence timer.
 *
 * The invariant, carried verbatim from architecture-firebase.md §B.2 and restated in
 * architecture-mac.md §B.4:
 *
 *   > **The row is the timer. The tick is only a low-latency executor for it.**
 *
 * So: the deadline is an absolute timestamp, written to SQLite *before* anything is armed, and
 * a 1 s wall-clock tick compares `now` against it. That survives system sleep, renderer
 * throttling, quit and relaunch, none of which a `setTimeout` survives (§C.3).
 *
 * Semantics (design-brief.md §D3, product-design.md §C4/§C5 — these are the hand-owned parts):
 * - stage 1 at 45 s with no keystrokes in any composer; stage 2 at 90 s *cumulative* idle;
 * - typing pauses the timer, and nothing else does. Whispering does not (§C.4): whispering is
 *   not explaining to the group;
 * - `cumulativeIdleMs` is NOT reset by typing — it is what drives stage 2 on schedule;
 * - a single window may be extended by typing for at most 120 s;
 * - the timer fires at most twice per round. A third silence produces nothing at all;
 * - `Hold` adds 60 s and posts nothing; `Wait for me` pauses nudges for the round;
 * - `timerEpoch` is a monotonic fence: any fire carrying a stale epoch is discarded, which is
 *   what makes extension, cancellation and re-arming safe without locking.
 */
import type { Clock } from './ports.js';
import type { RoomConfig } from './records.js';

export interface TimerSnapshot {
  deadlineTs: number | null;
  epoch: number;
  cumulativeIdleMs: number;
  windowExtensionMs: number;
  firesThisRound: number;
  nudgesPaused: boolean;
  /** When the current silence window started (the last group activity). */
  windowStartTs: number | null;
}

export interface TimerFire {
  epoch: number;
  stage: 1 | 2;
  /** How late the tick was to notice, in ms. Non-zero after sleep, quit or relaunch. */
  lateByMs: number;
  cause: 'live' | 'sleep_or_relaunch';
}

export interface TimerHooks {
  /** Persist the durable fields. Called BEFORE the in-memory state is used to fire anything. */
  persist(patch: Partial<{
    deadline_ts: string | null;
    timer_epoch: number;
    cumulative_idle_ms: number;
    window_extension_ms: number;
    nudge_fires_this_round: number;
    nudges_paused: number;
    last_activity_ts: string | null;
  }>): void;
  fire(fire: TimerFire): void;
  /** Emitted whenever the renderer's view of the deadline changes. */
  changed(snapshot: TimerSnapshot): void;
  /** The deadline passed by more than the late cut-off: re-arm and show a resume card. */
  resumeCard?(lateByMs: number): void;
}

export const HOLD_MS = 60_000;
/** Beyond two minutes the *social* premise of the nudge has expired (architecture-mac.md §B.4). */
export const LATE_FIRE_CUTOFF_MS = 120_000;
/** Persist a moved deadline only when it moved by more than this (write coalescing, §C.2). */
const PERSIST_EPSILON_MS = 5_000;
const MAX_FIRES_PER_ROUND = 2;

export class SilenceTimer {
  #clock: Clock;
  #config: RoomConfig;
  #hooks: TimerHooks;
  #state: TimerSnapshot;
  #stopTick: (() => void) | null = null;
  /** The deadline as last written to the store, for write coalescing. */
  #persistedDeadline: number | null;

  constructor(opts: { clock: Clock; config: RoomConfig; hooks: TimerHooks; initial?: Partial<TimerSnapshot> }) {
    this.#clock = opts.clock;
    this.#config = opts.config;
    this.#hooks = opts.hooks;
    this.#state = {
      deadlineTs: null,
      epoch: 0,
      cumulativeIdleMs: 0,
      windowExtensionMs: 0,
      firesThisRound: 0,
      nudgesPaused: false,
      windowStartTs: null,
      ...opts.initial,
    };
    this.#persistedDeadline = this.#state.deadlineTs;
  }

  get snapshot(): TimerSnapshot {
    return { ...this.#state };
  }

  start(): void {
    if (this.#stopTick) return;
    this.#stopTick = this.#clock.setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    this.#stopTick?.();
    this.#stopTick = null;
  }

  /** Arm a fresh window. Called after every agent turn and at room open. */
  arm(): void {
    const now = this.#clock.now();
    this.#state.epoch += 1;
    this.#state.deadlineTs = now + this.#config.silence_ms;
    this.#state.windowStartTs = now;
    this.#state.cumulativeIdleMs = 0;
    this.#state.windowExtensionMs = 0;
    this.#persist(now, true);
    this.#hooks.changed(this.snapshot);
  }

  /** The student spoke: cancel the window and bump the fence. */
  cancel(): void {
    const now = this.#clock.now();
    this.#state.epoch += 1;
    this.#state.deadlineTs = null;
    this.#state.windowStartTs = null;
    this.#state.cumulativeIdleMs = 0;
    this.#state.windowExtensionMs = 0;
    this.#persist(now, true);
    this.#hooks.changed(this.snapshot);
  }

  /** A new round: the nudge budget resets. */
  resetRound(): void {
    this.#state.firesThisRound = 0;
    this.#hooks.persist({ nudge_fires_this_round: 0 });
    this.#hooks.changed(this.snapshot);
  }

  /**
   * Typing heartbeat (≤1 per 3 s from the renderer, composer focused and non-empty).
   * Pushes the deadline out, but never past the 120 s extension cap for this window, and
   * never touches `cumulativeIdleMs` — stage 2 still arrives on schedule.
   */
  typing(): void {
    const now = this.#clock.now();
    if (this.#state.deadlineTs === null) return;
    const proposed = now + this.#config.silence_ms;
    if (proposed <= this.#state.deadlineTs) return;

    const added = proposed - this.#state.deadlineTs;
    const room = Math.max(0, this.#config.window_extension_cap_ms - this.#state.windowExtensionMs);
    const granted = Math.min(added, room);
    if (granted <= 0) return;

    this.#state.deadlineTs += granted;
    this.#state.windowExtensionMs += granted;
    this.#persist(now, false);
    this.#hooks.changed(this.snapshot);
  }

  /** The composer's `Hold` control: +60 s, posts nothing, not subject to the typing cap. */
  hold(): void {
    const now = this.#clock.now();
    if (this.#state.deadlineTs === null) return;
    this.#state.deadlineTs += HOLD_MS;
    this.#persist(now, true);
    this.#hooks.changed(this.snapshot);
  }

  /** `Wait for me` / its undo. */
  setNudgesPaused(paused: boolean): void {
    this.#state.nudgesPaused = paused;
    this.#hooks.persist({ nudges_paused: paused ? 1 : 0 });
    this.#hooks.changed(this.snapshot);
  }

  /** One tick of the wall clock. Safe to call at any frequency. */
  tick(): void {
    const now = this.#clock.now();
    const deadline = this.#state.deadlineTs;
    if (deadline === null) return;
    if (this.#state.windowStartTs !== null) {
      this.#state.cumulativeIdleMs = now - this.#state.windowStartTs;
    }
    if (now < deadline) return;

    const lateBy = now - deadline;
    if (lateBy > LATE_FIRE_CUTOFF_MS) {
      // The conversation has moved on in the student's head. A nudge about a 20-minute-old
      // question reads as a broken app, not a patient group.
      this.arm();
      this.#hooks.resumeCard?.(lateBy);
      return;
    }
    this.#fireNow(lateBy, lateBy > 2_000 ? 'sleep_or_relaunch' : 'live');
  }

  /**
   * The recovery pass (architecture-mac.md §B.4): run on launch and on `powerMonitor` resume.
   * Idempotent — `timerEpoch` discards a stale fire, so running it twice is harmless.
   */
  recover(): void {
    this.tick();
  }

  #fireNow(lateByMs: number, cause: TimerFire['cause']): void {
    const stage: 1 | 2 = this.#state.cumulativeIdleMs >= this.#config.stage_two_ms ? 2 : 1;

    // Stop the window whatever happens next, so a paused or exhausted timer cannot spin.
    this.#state.deadlineTs = null;
    this.#state.windowStartTs = null;

    if (this.#state.nudgesPaused || this.#state.firesThisRound >= MAX_FIRES_PER_ROUND) {
      this.#persist(this.#clock.now(), true);
      this.#hooks.changed(this.snapshot);
      return;
    }

    this.#state.firesThisRound += 1;
    this.#persist(this.#clock.now(), true);
    this.#hooks.persist({ nudge_fires_this_round: this.#state.firesThisRound });
    this.#hooks.changed(this.snapshot);
    this.#hooks.fire({ epoch: this.#state.epoch, stage, lateByMs, cause });
  }

  /** True when a fire carrying this epoch is still the current window. */
  isCurrentEpoch(epoch: number): boolean {
    return epoch === this.#state.epoch;
  }

  #persist(now: number, force: boolean): void {
    const moved =
      this.#persistedDeadline === null ||
      this.#state.deadlineTs === null ||
      Math.abs(this.#state.deadlineTs - this.#persistedDeadline) > PERSIST_EPSILON_MS;
    if (!force && !moved) return;
    this.#persistedDeadline = this.#state.deadlineTs;
    this.#hooks.persist({
      deadline_ts: this.#state.deadlineTs === null ? null : new Date(this.#state.deadlineTs).toISOString(),
      timer_epoch: this.#state.epoch,
      cumulative_idle_ms: this.#state.cumulativeIdleMs,
      window_extension_ms: this.#state.windowExtensionMs,
      last_activity_ts: new Date(now).toISOString(),
    });
  }
}
