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
 * - **the thresholds scale to the last agent turn** (#47, `attempt-first.md` §5, `silenceStagesMs`):
 *   stage 1 at `clamp(2 × words / 238 wpm, 120 s, 300 s)` of **idle**, where idle is
 *   `pivot-spec.md` §B8's predicate — no keystroke in any composer *and* no selection change;
 *   stage 2 at stage 1 + 90 s *cumulative* idle. The #8 constants (45 s / 90 s) are what
 *   `RoomConfig` still carries and what an un-armed or recovered window falls back to;
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
  /**
   * **This window's thresholds** (#47 §5), from `silenceStagesMs` on the last agent turn's word
   * count. They are in memory only: the *deadline* is what survives a relaunch (the row is the
   * timer), and a recovered window falls back to the room config's constants for its stage-2
   * comparison, which is the same conservative direction the late-fire cut-off already takes.
   */
  stageOneMs: number;
  stageTwoMs: number;
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

/**
 * **The idle predicate, redefined for a document** (`pivot-spec.md` §B8).
 *
 * In a chat, *idle* meant "no keystroke in the composer" — the property that distinguishes
 * thinking from disengaging (`design-brief.md` §D3). A document has no single composer, so §B8
 * substitutes one gesture for it:
 *
 *   > **idle** = (no keystroke in *any* open composer, including the whisper composer)
 *   > **AND** (no selection change — no anchor focused, no thread activated) for 45 s.
 *
 * **Scroll is deliberately excluded**, and so are zoom and page navigation: re-reading a slide
 * by scrolling is exactly the behaviour the timer must not punish, and including it would make
 * the timer un-fireable on a long page and trigger-happy on a short one. The enforcement is that
 * there is no field for them here — a future caller cannot pass a scroll in by mistake.
 *
 * The whisper composer counts as a keystroke and the whisper *turn* does not reset anything:
 * both halves of that are §C.4's rule, which says whispering is not explaining to the group.
 * Typing is evidence the learner is present; a whisper reply is not evidence they have explained.
 *
 * **The machine and its constants are untouched.** This is the predicate only — the deadline,
 * the epoch fence, the 120 s extension cap, stage 2 at 90 s cumulative and two fires per round
 * are all exactly as they shipped.
 */
export interface IdleInput {
  /** Last keystroke in any composer — thread, "+ Ask here", or the whisper popover. */
  lastKeystrokeTs: number | null;
  /** Last selection change: a segment card focused, a thread activated. §B8's substitution. */
  lastSelectionTs: number | null;
}

/** The most recent thing that counts, or null when nothing ever has. */
export function lastActivityTs(input: IdleInput): number | null {
  const seen = [input.lastKeystrokeTs, input.lastSelectionTs].filter((t): t is number => t !== null);
  return seen.length === 0 ? null : Math.max(...seen);
}

/** §B8, to implement literally. Never seen is idle: nothing has said "I am still working this". */
export function isIdle(input: IdleInput, now: number, idleMs: number): boolean {
  const last = lastActivityTs(input);
  return last === null || now - last >= idleMs;
}

/**
 * **How long the quiet has to last before it counts** (issue #47, `attempt-first.md` §5).
 *
 * The 45 s / 90 s constants (#8) were written for a chat where a turn was a sentence. In the six
 * studied sessions the AI wrote 246–1,190 words per turn and the median gap before the next learner
 * turn was **3–6 minutes** (`findings.md` RQ5) — so 45 s of quiet was not a learner disengaging, it
 * was a learner on line four of what they had been given, and the nudge arrived as an interruption.
 *
 * So the threshold scales to what there was to read:
 *
 *   stage 1 = clamp(2 × words / 238 wpm, 120 s, 300 s),  stage 2 = stage 1 + 90 s
 *
 * 238 wpm is Brysbaert 2019's mean silent reading rate for English prose. **The ×2 is a designer's
 * margin**, not a finding: reading a dense slide with notation in it is slower than reading prose,
 * and the cost of nudging too early (an interruption, and one of the two fires per round spent) is
 * higher than the cost of nudging late. The floor keeps a one-line check-in from firing at 5 s; the
 * ceiling keeps a 1,200-word wall of text from switching the timer off altogether.
 *
 * Stage 2's +90 s is unchanged from #8 — it is a *second* wait on top of the first, not a total.
 */
export const READING_WPM = 238;
export const READING_MARGIN = 2;
export const STAGE_ONE_FLOOR_MS = 120_000;
export const STAGE_ONE_CEILING_MS = 300_000;
export const STAGE_TWO_GAP_MS = 90_000;

export interface SilenceStages {
  stageOneMs: number;
  stageTwoMs: number;
}

/**
 * `scale` is the pacing profile's `silenceScale` (`flow.ts`): 1 on the shipped profile, which is
 * the brief's own formula untouched, and a sixth on Demo, where §4.3 says the threshold is
 * shortened. It scales the floor and the ceiling as well as the reading time — scaling only the
 * middle term would leave the 120 s floor in charge, which is exactly what made the cue take two
 * minutes on camera.
 */
export function silenceStagesMs(words: number, scale = 1): SilenceStages {
  const safe = Number.isFinite(words) && words > 0 ? words : 0;
  const factor = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
  const readMs = (READING_MARGIN * safe * 60_000) / READING_WPM;
  const floor = STAGE_ONE_FLOOR_MS * factor;
  const ceiling = STAGE_ONE_CEILING_MS * factor;
  const stageOneMs = Math.round(Math.min(ceiling, Math.max(floor, readMs * factor)));
  return { stageOneMs, stageTwoMs: stageOneMs + Math.round(STAGE_TWO_GAP_MS * factor) };
}

/** Words, the way the threshold counts them: whitespace-separated tokens with a letter or digit. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
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
  /** §B8's two activity clocks. In memory: they only ever decide the *current* window. */
  #lastKeystrokeTs: number | null = null;
  #lastSelectionTs: number | null = null;
  /**
   * Idle carried into the current window from the one before it (#37).
   *
   * `tick()` **overwrites** `cumulativeIdleMs` with `now - windowStartTs`, so "cumulative" was
   * only ever this window's elapsed time and the 90 s stage-2 threshold could not be crossed:
   * `arm()` runs after a fill and starts a new window, and the next tick threw the first 45 s
   * away. This is the base the tick adds to. Restored as whatever was persisted, which is right
   * for a relaunch mid-window and never makes stage 2 arrive earlier than it should.
   */
  #carriedIdleMs: number;

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
      // The room's own constants until the first `arm()` says what was actually said.
      stageOneMs: opts.config.silence_ms,
      stageTwoMs: opts.config.stage_two_ms,
      ...opts.initial,
    };
    this.#persistedDeadline = this.#state.deadlineTs;
    this.#carriedIdleMs = this.#state.windowStartTs === null ? this.#state.cumulativeIdleMs : 0;
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

  /**
   * Arm a fresh window. Called after every agent turn and at room open.
   *
   * **`keepCumulativeIdle` is how stage 2 is reachable at all** (#37). The header promises
   * *"stage 2 at 90 s cumulative idle"* and *"`cumulativeIdleMs` is NOT reset by typing — it is
   * what drives stage 2 on schedule"*, but `arm()` runs after **every** agent turn, and a
   * stage-1 fill is an agent turn: it zeroed the counter, so the next fire was stage 1 again and
   * `incomplete_scaffold` could never happen. The learner's quiet did not end because an agent
   * spoke into it, so a fill re-arms the window without clearing what the learner has been
   * quiet for. Every other caller — a real turn, room open — still resets, because those
   * follow something the learner actually did or was answered by.
   */
  arm(opts: { keepCumulativeIdle?: boolean; stages?: SilenceStages } = {}): void {
    const now = this.#clock.now();
    this.#state.epoch += 1;
    /**
     * **The caller says how long the quiet has to be** (#47 §5). The actor passes
     * `silenceStagesMs(words of the turn it just dispatched)`; a caller that passes nothing keeps
     * whatever the last window used, which is what a fill wants — an agent speaking into a silence
     * does not change what the learner was given to read.
     */
    if (opts.stages) {
      this.#state.stageOneMs = opts.stages.stageOneMs;
      this.#state.stageTwoMs = opts.stages.stageTwoMs;
    }
    this.#state.windowStartTs = now;
    this.#carriedIdleMs = opts.keepCumulativeIdle === true ? this.#state.cumulativeIdleMs : 0;
    this.#state.cumulativeIdleMs = this.#carriedIdleMs;
    /**
     * **The window is however much quiet is still owed to the next stage** (#47 §5).
     *
     * Stage 2 is *"stage 1 + 90 s"*, so the window after a fill is the 90 s gap and not another
     * whole stage-1 wait. With #8's constants the two were the same length by coincidence
     * (45 + 45 = 90), which is why this arithmetic was never needed before and why it changes
     * nothing for a room still running on them.
     */
    /**
     * **Nothing is owed after stage 2.** A fill made *at* stage 2 used to re-arm a window of the
     * 1 s floor, because the quiet already carried was past stage 2: it fired again at once, and
     * only the two-fires cap stopped a third. Live (1 Oct 2026) that cap had been spent the other
     * way: reopened after the app was closed mid-window, the room's recovered window fell back to
     * the config's stage-2 threshold, the first late fire was already stage 2, and Ellie posted
     * two near-identical stage-2 restatements eleven seconds apart, the second taking the floor
     * from the learner's Quiz me. Stage 2 is the last nudge of a silence, so a fill at it arms
     * no window; the next one is armed by whatever the learner or an agent does next.
     */
    const pastStageTwo = opts.keepCumulativeIdle === true && this.#carriedIdleMs >= this.#state.stageTwoMs;
    this.#state.deadlineTs = pastStageTwo
      ? null
      : this.#carriedIdleMs > 0
        ? now + Math.max(1_000, this.#state.stageTwoMs - this.#carriedIdleMs)
        : now + this.#state.stageOneMs;
    if (pastStageTwo) this.#state.windowStartTs = null;
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
    this.#carriedIdleMs = 0;
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
    this.#lastKeystrokeTs = this.#clock.now();
    this.#extendWindow();
  }

  /**
   * **A selection change** — a segment card focused, a thread activated (`pivot-spec.md` §B8).
   *
   * It does exactly what a keystroke does, which is the whole of the substitution: selection
   * change is the document's analogue of typing, the gesture that says *I am still working this
   * passage*. Same 120 s cap, same untouched `cumulativeIdleMs`, same epoch — this method adds
   * a caller to the existing machine and changes nothing inside it.
   */
  onSelectionChange(): void {
    this.#lastSelectionTs = this.#clock.now();
    this.#extendWindow();
  }

  /** §B8's predicate over this timer's own clocks, for callers that need the answer directly. */
  isIdle(now = this.#clock.now()): boolean {
    return isIdle(
      { lastKeystrokeTs: this.#lastKeystrokeTs, lastSelectionTs: this.#lastSelectionTs },
      now,
      this.#state.stageOneMs,
    );
  }

  /**
   * Push the deadline out, but never past the 120 s extension cap for this window, and never
   * touching `cumulativeIdleMs` — stage 2 still arrives on schedule. Verbatim what `typing()`
   * was before §B8 gave it a second caller.
   */
  #extendWindow(): void {
    const now = this.#clock.now();
    if (this.#state.deadlineTs === null) return;
    const proposed = now + this.#state.stageOneMs;
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
      this.#state.cumulativeIdleMs = this.#carriedIdleMs + (now - this.#state.windowStartTs);
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
    const stage: 1 | 2 = this.#state.cumulativeIdleMs >= this.#state.stageTwoMs ? 2 : 1;

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
