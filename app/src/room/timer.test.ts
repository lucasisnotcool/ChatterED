import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG } from '../test-support/db.js';
import { LATE_FIRE_CUTOFF_MS, SilenceTimer, type TimerFire } from './timer.js';

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
