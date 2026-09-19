import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG } from '../test-support/db.js';
import {
  LATE_FIRE_CUTOFF_MS,
  READING_WPM,
  STAGE_ONE_CEILING_MS,
  STAGE_ONE_FLOOR_MS,
  STAGE_TWO_GAP_MS,
  SilenceTimer,
  isIdle,
  lastActivityTs,
  silenceStagesMs,
  wordCount,
  type TimerFire,
} from './timer.js';

function makeTimer(overrides: Partial<typeof DEFAULT_ROOM_CONFIG> = {}) {
  const clock = new FakeClock();
  const fires: TimerFire[] = [];
  const persisted: Record<string, unknown>[] = [];
  let resumeCards = 0;
  const timer = new SilenceTimer({
    clock,
    config: { ...DEFAULT_ROOM_CONFIG, ...overrides },
    hooks: {
      persist: (patch) => persisted.push(patch as Record<string, unknown>),
      fire: (f) => fires.push(f),
      changed: () => {},
      resumeCard: () => {
        resumeCards += 1;
      },
    },
  });
  timer.start();
  return { clock, timer, fires, persisted, resumeCards: () => resumeCards };
}

describe('the silence timer', () => {
  let h: ReturnType<typeof makeTimer>;
  beforeEach(() => {
    h = makeTimer();
  });

  it('fires stage 1 at 45 s of quiet', () => {
    h.timer.arm();
    h.clock.advance(44_000);
    expect(h.fires).toHaveLength(0);
    h.clock.advance(2_000);
    expect(h.fires).toHaveLength(1);
    expect(h.fires[0]!.stage).toBe(1);
  });

  it('persists the deadline before the window is armed', () => {
    h.timer.arm();
    const write = h.persisted.at(-1)!;
    expect(typeof write.deadline_ts).toBe('string');
    expect(write.timer_epoch).toBe(1);
    // The row carries an absolute timestamp, never "seconds remaining".
    expect(Date.parse(write.deadline_ts as string)).toBe(h.clock.now() + 45_000);
  });

  it('is paused by typing, and by nothing else', () => {
    h.timer.arm();
    h.clock.advance(40_000);
    h.timer.typing();
    h.clock.advance(40_000); // 80 s since arming, but only 40 s since the last keystroke
    expect(h.fires).toHaveLength(0);
    h.clock.advance(6_000);
    expect(h.fires).toHaveLength(1);
  });

  it('caps a single window at 120 s of typing extension', () => {
    h.timer.arm();
    for (let i = 0; i < 60; i += 1) {
      h.clock.advance(3_000);
      h.timer.typing();
    }
    // 180 s of steady typing: the deadline may only have moved by the 120 s cap.
    expect(h.timer.snapshot.windowExtensionMs).toBe(120_000);
  });

  it('reaches stage 2 on schedule even though typing keeps pausing it', () => {
    h.timer.arm();
    // Type every 30 s for two minutes: cumulative idle passes 90 s while the deadline moves.
    for (let i = 0; i < 4; i += 1) {
      h.clock.advance(30_000);
      h.timer.typing();
    }
    h.clock.advance(46_000);
    expect(h.fires).toHaveLength(1);
    expect(h.fires[0]!.stage).toBe(2);
  });

  it('fires at most twice per round, then says nothing at all', () => {
    for (let round = 0; round < 3; round += 1) {
      h.timer.arm();
      h.clock.advance(46_000);
    }
    expect(h.fires).toHaveLength(2);
  });

  it('adds 60 s for Hold and posts nothing', () => {
    h.timer.arm();
    h.clock.advance(40_000);
    h.timer.hold();
    h.clock.advance(50_000);
    expect(h.fires).toHaveLength(0);
    h.clock.advance(16_000);
    expect(h.fires).toHaveLength(1);
  });

  it('never fires while nudges are paused', () => {
    h.timer.arm();
    h.timer.setNudgesPaused(true);
    h.clock.advance(120_000);
    expect(h.fires).toHaveLength(0);
  });

  it('fences stale fires with the epoch', () => {
    h.timer.arm();
    const staleEpoch = h.timer.snapshot.epoch;
    h.timer.cancel(); // the student spoke
    h.timer.arm();
    expect(h.timer.isCurrentEpoch(staleEpoch)).toBe(false);
    expect(h.timer.isCurrentEpoch(h.timer.snapshot.epoch)).toBe(true);
  });

  it('fires immediately on wake when the deadline passed during sleep', () => {
    h.timer.arm();
    h.clock.sleep(60_000); // lid closed; no tick ran
    h.timer.recover();
    expect(h.fires).toHaveLength(1);
    expect(h.fires[0]!.cause).toBe('sleep_or_relaunch');
    expect(h.fires[0]!.lateByMs).toBeGreaterThan(10_000);
  });

  it('re-arms and shows a resume card instead of firing a stale nudge', () => {
    h.timer.arm();
    h.clock.sleep(45_000 + LATE_FIRE_CUTOFF_MS + 10_000);
    h.timer.recover();
    expect(h.fires).toHaveLength(0);
    expect(h.resumeCards()).toBe(1);
    expect(h.timer.snapshot.deadlineTs).not.toBeNull();
  });

  it('is idempotent if the recovery pass runs twice', () => {
    h.timer.arm();
    h.clock.sleep(60_000);
    h.timer.recover();
    h.timer.recover();
    expect(h.fires).toHaveLength(1);
  });

  it('coalesces writes while typing nudges the deadline by small amounts', () => {
    h.timer.arm();
    const writesAfterArm = h.persisted.length;
    h.clock.advance(1_000);
    h.timer.typing(); // moves the deadline by 1 s — below the 5 s coalescing threshold
    expect(h.persisted.length).toBe(writesAfterArm);
    h.clock.advance(10_000);
    h.timer.typing(); // moves it by 10 s — worth a write
    expect(h.persisted.length).toBeGreaterThan(writesAfterArm);
  });
});

/**
 * §B8's idle predicate, and the selection change that feeds it.
 *
 * The machine is not re-tested here — it is the same machine, and the tests above are its
 * tests. What is asserted is exactly the substitution: **selection change is the document's
 * analogue of a keystroke**, it lives under the same cap, and scroll is not in the predicate at
 * all, which is why there is no way to pass one in.
 */
describe('the idle predicate for a document (pivot-spec.md §B8)', () => {
  it('is idle when nothing has ever happened', () => {
    expect(isIdle({ lastKeystrokeTs: null, lastSelectionTs: null }, 10_000, 45_000)).toBe(true);
    expect(lastActivityTs({ lastKeystrokeTs: null, lastSelectionTs: null })).toBeNull();
  });

  it('takes the most recent of the two, whichever it is', () => {
    expect(lastActivityTs({ lastKeystrokeTs: 100, lastSelectionTs: 900 })).toBe(900);
    expect(lastActivityTs({ lastKeystrokeTs: 900, lastSelectionTs: 100 })).toBe(900);
    // A selection at 40 s keeps a 45 s window alive even though the last keystroke was at 1 s.
    expect(isIdle({ lastKeystrokeTs: 1_000, lastSelectionTs: 40_000 }, 60_000, 45_000)).toBe(false);
    expect(isIdle({ lastKeystrokeTs: 1_000, lastSelectionTs: 40_000 }, 90_000, 45_000)).toBe(true);
  });

  it('pushes the silence deadline exactly as a keystroke does', () => {
    const h = makeTimer();
    h.timer.arm();
    h.clock.advance(40_000);
    h.timer.onSelectionChange(); // the learner focused another card — still working the deck
    h.clock.advance(40_000); // 80 s since arming, 40 s since the selection
    expect(h.fires).toHaveLength(0);
    h.clock.advance(6_000);
    expect(h.fires).toHaveLength(1);
  });

  it('is capped by the same 120 s window extension, and is not a way around it', () => {
    const h = makeTimer();
    h.timer.arm();
    // Five selections 30 s apart would buy 150 s if the cap did not bind.
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(30_000);
      h.timer.onSelectionChange();
    }
    expect(h.timer.snapshot.windowExtensionMs).toBe(DEFAULT_ROOM_CONFIG.window_extension_cap_ms);
    // The window can be stretched to 45 s + the 120 s cap and not one second further, however
    // many cards are focused: at 166 s it has fired.
    expect(h.fires).toHaveLength(0);
    h.clock.advance(20_000);
    h.timer.onSelectionChange();
    expect(h.fires).toHaveLength(1);
  });

  it('does not touch cumulativeIdleMs, so stage 2 still arrives on schedule', () => {
    const h = makeTimer();
    h.timer.arm();
    h.clock.advance(30_000);
    h.timer.onSelectionChange();
    h.clock.advance(30_000);
    h.timer.onSelectionChange();
    // 60 s of wall clock since arming, and the timer agrees it has been quiet that long.
    expect(h.timer.snapshot.cumulativeIdleMs).toBeGreaterThanOrEqual(59_000);
  });

  it('reports idle off its own clocks, and a selection clears it', () => {
    const h = makeTimer();
    h.timer.arm();
    h.clock.advance(50_000);
    expect(h.timer.isIdle()).toBe(true);
    h.timer.onSelectionChange();
    expect(h.timer.isIdle()).toBe(false);
    h.clock.advance(46_000);
    expect(h.timer.isIdle()).toBe(true);
    // And a keystroke in any composer — including the whisper's — does the same.
    h.timer.typing();
    expect(h.timer.isIdle()).toBe(false);
  });

  it('leaves the epoch fence alone: a selection is not a new window', () => {
    const h = makeTimer();
    h.timer.arm();
    const epoch = h.timer.snapshot.epoch;
    h.clock.advance(10_000);
    h.timer.onSelectionChange();
    expect(h.timer.snapshot.epoch).toBe(epoch);
  });
});

/**
 * **Reading time, not a constant** (issue #47, `attempt-first.md` §5).
 *
 * The number this replaces is #8's 45 s, and the evidence against it is the median 3–6 minute gap
 * before the next learner turn in the six studied sessions (`findings.md` RQ5) against AI turns of
 * 246–1,190 words. A 45 s nudge was interrupting someone who was still reading line four.
 */
describe('the silence thresholds scale to what there was to read', () => {
  it('floors a short check-in at two minutes', () => {
    // 12 words is ~6 s of reading even doubled; the floor is what stops the timer firing then.
    expect(silenceStagesMs(12).stageOneMs).toBe(STAGE_ONE_FLOOR_MS);
    expect(silenceStagesMs(0).stageOneMs).toBe(STAGE_ONE_FLOOR_MS);
  });

  it('scales in the middle: 2 × words / 238 wpm', () => {
    // 600 words: 2 × 600 / 238 = 5.04 min, above the ceiling. 400 words is inside the band.
    const stages = silenceStagesMs(400);
    expect(stages.stageOneMs).toBe(Math.round((2 * 400 * 60_000) / READING_WPM));
    expect(stages.stageOneMs).toBeGreaterThan(STAGE_ONE_FLOOR_MS);
    expect(stages.stageOneMs).toBeLessThan(STAGE_ONE_CEILING_MS);
  });

  it('caps a wall of text at five minutes, so the timer never switches itself off', () => {
    expect(silenceStagesMs(1_190).stageOneMs).toBe(STAGE_ONE_CEILING_MS);
  });

  it('puts stage 2 a further 90 s out, which is #8’s number and is unchanged', () => {
    const stages = silenceStagesMs(400);
    expect(stages.stageTwoMs).toBe(stages.stageOneMs + STAGE_TWO_GAP_MS);
  });

  it('counts words the way the formula means them', () => {
    expect(wordCount('  two   words ')).toBe(2);
    expect(wordCount('$f(x)$ is convex — 3 of them')).toBe(6);
    expect(wordCount('')).toBe(0);
  });

  it('arms the window on the stages it is given, and keeps them across a fill', () => {
    const h = makeTimer();
    const stages = silenceStagesMs(400);
    h.timer.arm({ stages });
    expect(h.timer.snapshot.deadlineTs).toBe(h.clock.now() + stages.stageOneMs);

    // The fill re-arms without saying anything new: an agent speaking into a silence does not
    // change what the learner was given to read.
    h.timer.arm({ keepCumulativeIdle: true });
    expect(h.timer.snapshot.deadlineTs).toBe(h.clock.now() + stages.stageOneMs);
  });

  it('decides the stage on this window’s own stage-2 threshold', async () => {
    const h = makeTimer();
    const stages = silenceStagesMs(400);
    h.timer.arm({ stages });
    await h.clock.run(stages.stageOneMs + 1_000);
    expect(h.fires.map((f) => f.stage)).toEqual([1]);

    // Stage 2 is stage 1 **+ 90 s**, so the second window is the gap, not another stage-1 wait.
    h.timer.arm({ keepCumulativeIdle: true, stages });
    // The window is what is still owed to stage 2, so the *total* quiet is stage 1 + 90 s.
    const carried = h.timer.snapshot.cumulativeIdleMs;
    expect(h.timer.snapshot.deadlineTs).toBe(h.clock.now() + (stages.stageTwoMs - carried));
    expect(carried + (stages.stageTwoMs - carried)).toBe(stages.stageOneMs + STAGE_TWO_GAP_MS);
    await h.clock.run(STAGE_TWO_GAP_MS + 2_000);
    expect(h.fires.map((f) => f.stage)).toEqual([1, 2]);
  });

  it('falls back to the room config when nothing has said otherwise', () => {
    const h = makeTimer();
    h.timer.arm();
    expect(h.timer.snapshot.stageOneMs).toBe(DEFAULT_ROOM_CONFIG.silence_ms);
    expect(h.timer.snapshot.stageTwoMs).toBe(DEFAULT_ROOM_CONFIG.stage_two_ms);
  });
});
