/**
 * The flow session, on a fake clock — the `timer.test.ts` pattern, for the same reason: no test
 * in this repo waits on real time, and a session boundary is only trustworthy if sleep, sudden
 * relaunch and a learner who types for two minutes are all covered by a test rather than by a
 * paragraph.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../test-support/clock.js';
import {
  CLOSE_EFFECTS,
  DEMO,
  FLOW,
  closeSession,
  declineHandOff,
  feedbackDue,
  insideHorizon,
  markFeedbackGiven,
  answerQuiz,
  openQuiz,
  expireQuizOnClose,
  recency,
  withThreshold,
  MIN_AGE_CAP_MS,
  handOffDue,
  noteHandOff,
  requiresTurnsSinceHandOff,
  flowProfileFor,
  handOffLine,
  latestByElement,
  noteActivity,
  openSession,
  pickTarget,
  quizzable,
  resumeOrOpen,
  sessionExpired,
  tickSession,
  type FlowProfile,
  type FlowSession,
  type HandOffInput,
  type HandOffVerdict,
  type TaughtItem,
} from './flow.js';
import { rosterFor } from './agents.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function taught(elementId: string, at: number, by: TaughtItem['by'] = 'teacher', label?: string): TaughtItem {
  return { elementId, taughtAt: at, by, label };
}

describe('the constants', () => {
  it('keeps the flow window strictly inside the session gap', () => {
    // flow-session.md §5: m must be strictly inside the gap, or the window could outlive the
    // session that contains it. This is the one structural constraint on (k, m).
    expect(FLOW.windowMs).toBeLessThan(FLOW.sessionGapMs);
    expect(DEMO.windowMs).toBeLessThan(DEMO.sessionGapMs);
  });

  it('matches flow-session.md §8.3 exactly', () => {
    expect(FLOW.sessionGapMs).toBe(20 * MINUTE);
    expect(FLOW.minAgeMs).toBe(3 * MINUTE);
    expect(FLOW.recencyHalfLifeMs).toBe(60 * MINUTE);
    expect(FLOW.horizonMs).toBe(6 * HOUR);
    expect(FLOW.turnsK).toBe(3);
    expect(FLOW.minTaught).toBe(2);
    expect(FLOW.feedbackRequired).toBe(true);
  });

  it('never raises MIN_AGE above the cap — the evidence runs the other way for prose', () => {
    // flow-session.md §3.2: Karpicke & Roediger 2007 found immediate testing BEAT a 10-min
    // delayed first test for prose. The 3 min is a UI guard against quizzing the sentence the
    // learner is still reading, and a future edit that "improves" it must fail here.
    expect(FLOW.minAgeMs).toBeLessThanOrEqual(MIN_AGE_CAP_MS);
    expect(DEMO.minAgeMs).toBeLessThanOrEqual(MIN_AGE_CAP_MS);
  });

  it('has a demo profile that moves k, m and the UI guard — downwards only', () => {
    expect(DEMO.turnsK).toBe(2);
    expect(DEMO.windowMs).toBe(3 * MINUTE);
    expect(DEMO.name).toBe('demo');
    // §2's storyboard reaches the hand-off ~35 s after the first Teacher turn, so the 3-minute
    // guard has to move for the take. §3.2 argues it in one direction only — never *raised* —
    // and this is the assertion that keeps the demo on the allowed side of that.
    expect(DEMO.minAgeMs).toBe(20_000);
    expect(DEMO.minAgeMs).toBeLessThan(FLOW.minAgeMs);
    // Everything else is the shipped profile. A demo is a pace, not a different mechanism.
    expect(DEMO.minTaught).toBe(FLOW.minTaught);
    expect(DEMO.feedbackRequired).toBe(FLOW.feedbackRequired);
    expect(DEMO.horizonMs).toBe(FLOW.horizonMs);
    expect(DEMO.composerIdleMs).toBe(FLOW.composerIdleMs);
  });

  it('falls back to the shipped profile for any stored name it does not know', () => {
    expect(flowProfileFor('demo')).toBe(DEMO);
    expect(flowProfileFor('study')).toBe(FLOW);
    expect(flowProfileFor(null)).toBe(FLOW);
    expect(flowProfileFor('something a later build wrote')).toBe(FLOW);
  });

  it('exposes Koala\u2019s actual control: a threshold, not a quiet/normal/eager slider', () => {
    expect(withThreshold(FLOW, 'medium').turnsK).toBe(FLOW.turnsK);
    expect(withThreshold(FLOW, 'high').turnsK).toBeGreaterThan(FLOW.turnsK);
    expect(withThreshold(FLOW, 'low').turnsK).toBeLessThan(FLOW.turnsK);
    expect(withThreshold(FLOW, 'high').minTaught).toBeGreaterThan(FLOW.minTaught);
  });
});

describe('session open and close', () => {
  let clock: FakeClock;
  let session: FlowSession;

  beforeEach(() => {
    clock = new FakeClock();
    session = openSession({ id: 'fs_1', documentId: 'doc_1', anchorId: 'seg_1' }, clock.now());
  });

  it('writes an absolute close deadline the moment it opens', () => {
    // timer.ts's rule inherited verbatim: "the row is the timer". Not "minutes remaining".
    expect(session.gapDeadlineTs).toBe(clock.now() + FLOW.sessionGapMs);
    expect(session.closedAt).toBeNull();
    expect(session.anchors).toEqual(['seg_1']);
  });

  it('closes on a 20 min gap with no learner activity', () => {
    clock.advance(19 * MINUTE);
    expect(sessionExpired(session, clock.now())).toBe(false);
    clock.advance(2 * MINUTE);
    expect(sessionExpired(session, clock.now())).toBe(true);
    const closed = tickSession(session, clock.now());
    expect(closed.closeReason).toBe('gap');
  });

  it('is paused by typing, the way the silence timer is', () => {
    // design-brief.md §D3: keystrokes, not messages, are activity. A learner typing a long
    // answer for 25 minutes has not left.
    for (let i = 0; i < 5; i += 1) {
      clock.advance(5 * MINUTE);
      session = noteActivity(session, { kind: 'keystroke' }, clock.now());
    }
    expect(sessionExpired(session, clock.now())).toBe(false); // 25 min since opening
    clock.advance(21 * MINUTE);
    expect(sessionExpired(session, clock.now())).toBe(true);
  });

  it('survives sleep: the deadline is compared against wall-clock, never counted down', () => {
    clock.sleep(45 * MINUTE); // time moves, no tick runs
    const closed = tickSession(session, clock.now());
    expect(closed.closeReason).toBe('gap');
    // The close time is the deadline, not the moment the late tick noticed it.
    expect(closed.closedAt).toBe(session.gapDeadlineTs);
  });

  it('is idempotent, so the recovery pass may run twice', () => {
    clock.sleep(45 * MINUTE);
    const once = tickSession(session, clock.now());
    const twice = tickSession(once, clock.now());
    expect(twice).toEqual(once);
  });

  it('takes an explicit End session at the moment it was pressed', () => {
    clock.advance(3 * MINUTE);
    const closed = closeSession(session, clock.now(), 'explicit');
    expect(closed.closedAt).toBe(clock.now());
    expect(closed.closeReason).toBe('explicit');
  });

  it('resumes inside the gap and opens a new session after it', () => {
    clock.advance(90_000); // the coffee break that must cost the learner nothing
    const back = resumeOrOpen(session, { id: 'fs_2', documentId: 'doc_1' }, clock.now());
    expect(back.resumed).toBe(true);
    expect(back.session.id).toBe('fs_1');

    clock.advance(25 * MINUTE);
    const fresh = resumeOrOpen(back.session, { id: 'fs_2', documentId: 'doc_1' }, clock.now());
    expect(fresh.resumed).toBe(false);
    expect(fresh.session.id).toBe('fs_2');
  });

  it('does not resume into a different document', () => {
    clock.advance(60_000);
    const other = resumeOrOpen(session, { id: 'fs_2', documentId: 'doc_2' }, clock.now());
    expect(other.resumed).toBe(false);
  });

  it('records the anchors touched, in order and without duplicates', () => {
    session = noteActivity(session, { kind: 'ask', anchorId: 'seg_2' }, clock.now());
    session = noteActivity(session, { kind: 'turn', anchorId: 'seg_1' }, clock.now());
    expect(session.anchors).toEqual(['seg_1', 'seg_2']);
  });

  it('closing never touches the ledger', () => {
    // progress-tracking.md §4.4: the ledger is cumulative and monotonic. Decay governs what may
    // be *asked*, never what has been *achieved*.
    expect(CLOSE_EFFECTS.touchesLedger).toBe(false);
    expect(CLOSE_EFFECTS.clearWhispers).toBe(true);
    expect(CLOSE_EFFECTS.expirePendingQuiz).toBe(true);
  });
});

describe('the taught set and its decay', () => {
  const t0 = Date.parse('2026-09-15T10:00:00.000Z');

  it('halves the recency weight every 60 min, and never reaches zero', () => {
    // §4: a ranking weight, not a memory estimate. It orders candidates; it excludes nobody.
    const item = taught('R1', t0);
    expect(recency(item, t0)).toBeCloseTo(1, 6);
    expect(recency(item, t0 + 60 * 60_000)).toBeCloseTo(0.5, 6);
    expect(recency(item, t0 + 3 * HOUR)).toBeCloseTo(0.125, 6);
    expect(recency(item, t0 + 5 * HOUR)).toBeGreaterThan(0);
  });

  it('the recency weight never excludes a candidate \u2014 only the horizon does', () => {
    // An item taught 5 h ago has a weight of ~0.03 and is still quizzable, because the horizon
    // is a conversational-context bound and decay is not allowed to be a gate (§8.3).
    const items = [taught('R1', t0), taught('R2', t0 + MINUTE)];
    const now = t0 + 5 * HOUR;
    expect(quizzable(items, now)).toHaveLength(2);
    expect(quizzable(items, now)[0]!.recency).toBeLessThan(0.05);
  });

  it('scopes the horizon to this session plus the previous one if it closed < 6 h ago', () => {
    const items = [
      { ...taught('R1', t0), sessionId: 'fs_prev' },
      { ...taught('R2', t0 + 4 * HOUR), sessionId: 'fs_now' },
    ];
    const now = t0 + 4 * HOUR + 30 * MINUTE;
    const recentlyClosed = { currentSessionId: 'fs_now', previousSession: { id: 'fs_prev', closedAt: now - 2 * HOUR } };
    expect(quizzable(items, now, FLOW, recentlyClosed).map((i) => i.elementId).sort()).toEqual(['R1', 'R2']);

    const longClosed = { currentSessionId: 'fs_now', previousSession: { id: 'fs_prev', closedAt: now - 7 * HOUR } };
    expect(quizzable(items, now, FLOW, longClosed).map((i) => i.elementId)).toEqual(['R2']);

    // A session two back is out however fresh its items look.
    expect(insideHorizon(items[0]!, now, { currentSessionId: 'fs_now', previousSession: null })).toBe(false);
  });

  it('excludes the sentence the learner is still reading, and nothing more', () => {
    const items = [taught('R1', t0), taught('R2', t0 + 2 * MINUTE)];
    const now = t0 + 4 * MINUTE; // R2 is 2 min old: inside the UI guard
    expect(quizzable(items, now).map((i) => i.elementId)).toEqual(['R1']);
  });

  it('a re-teach appends and the most recent one drives the window', () => {
    // §12 q. 7: append, and use the most recent. The cost is one row, and it keeps a real
    // spacing curve fittable in A2.
    const items = [taught('R1', t0), taught('R1', t0 + 3 * HOUR)];
    expect(latestByElement(items)).toHaveLength(1);
    expect(latestByElement(items)[0]!.taughtAt).toBe(t0 + 3 * HOUR);
    // Immediately after the re-teach R1 is too *young* to quiz, which is the point of MIN_AGE.
    expect(quizzable(items, t0 + 3 * HOUR)).toHaveLength(0);
    expect(quizzable(items, t0 + 3 * HOUR + 4 * MINUTE)).toHaveLength(1);
  });

  it('drops an element past the 6 h conversational-context bound', () => {
    const items = [taught('R1', t0), taught('R2', t0 + 5 * HOUR)];
    const now = t0 + 6 * HOUR + MINUTE;
    expect(quizzable(items, now).map((i) => i.elementId)).toEqual(['R2']);
  });

  it('prefers the freshest thing the learner has least demonstrated', () => {
    // §8.2: highest freshness x lowest ledger level.
    const now = t0 + 3 * HOUR;
    const items = quizzable([taught('R1', t0 + 2 * HOUR), taught('R2', t0 + 2 * HOUR + 30 * MINUTE)], now);
    expect(pickTarget(items)!.elementId).toBe('R2'); // fresher, both at level 0
    expect(pickTarget(items, { R2: 3 })!.elementId).toBe('R1'); // R2 already defended
  });
});

// ── the four-condition predicate ────────────────────────────────────────────

function ready(clock: FakeClock, overrides: Partial<HandOffInput> = {}): { input: HandOffInput; now: number } {
  const t0 = clock.now();
  let session = openSession({ id: 'fs_1', documentId: 'doc_1' }, t0);
  // Two things taught a quarter of an hour ago, then three learner turns in the last few minutes.
  const items = [taught('R1', t0, 'teacher', 'the PSD condition'), taught('R2', t0 + MINUTE, 'teacher', 'the domain')];
  clock.advance(15 * MINUTE);
  for (let i = 0; i < 3; i += 1) {
    clock.advance(MINUTE);
    session = noteActivity(session, { kind: 'turn' }, clock.now());
  }
  clock.advance(10_000); // composer idle past the 3 s floor
  return {
    now: clock.now(),
    input: {
      session,
      taught: items,
      pendingTeacherQuestion: false,
      silenceWindowOpen: false,
      whisperOpen: false,
      lastKeystrokeAt: clock.now() - 10_000,
      ...overrides,
    },
  };
}

describe('the pacing profile Settings offers', () => {
  /**
   * The demo profile's whole job, stated as a test: a filmed sitting reaches beat 10. §2's
   * storyboard is at the hand-off ~35 s after the first Teacher turn, and on the shipped
   * profile that cannot happen — a live run on 16 Sep waited out the 3-minute guard and the
   * hand-off came minutes later, on the fourth learner turn. Both runs below are the same
   * sitting on a fake clock; only the profile differs.
   */
  const sitting = (profile: FlowProfile): HandOffVerdict => {
    const clock = new FakeClock();
    const t0 = clock.now();
    let session = openSession({ id: 'fs_1', documentId: 'doc_1', profile }, t0);
    const items = [
      taught('C1', t0, 'teacher', 'what /btw can and cannot do'),
      taught('C2', t0 + 5_000, 'teacher', 'the forwarding gap'),
    ];
    clock.advance(20_000);
    session = noteActivity(session, { kind: 'turn' }, clock.now());
    clock.advance(12_000);
    session = noteActivity(session, { kind: 'turn' }, clock.now());
    clock.advance(23_000); // 55 s in, and the composer has been quiet for the last 23 s
    return handOffDue(
      {
        session,
        taught: items,
        pendingTeacherQuestion: false,
        silenceWindowOpen: false,
        whisperOpen: false,
        lastKeystrokeAt: clock.now() - 23_000,
      },
      clock.now(),
    );
  };

  it('hands off inside a minute of two taught concepts on Demo', () => {
    const v = sitting(DEMO);
    expect(v.due).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.target).not.toBeNull();
  });

  it('does not, on Study — and says which rules the minute failed', () => {
    const v = sitting(FLOW);
    expect(v.due).toBe(false);
    // Two learner turns is under k = 3, and 55 s is inside the 3-minute UI guard.
    expect(v.reasons).toContain('r1_engagement');
    expect(v.reasons).toContain('r3_maturity');
  });
});

describe('handOffDue', () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock();
  });

  it('is true when all four conditions hold', () => {
    const { input, now } = ready(clock);
    const v = handOffDue(input, now);
    expect(v.due).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.target).not.toBeNull();
    // The raw inputs are always carried, never just the boolean (§11 rule 1).
    expect(v.learnerTurnsInWindow).toBe(3);
    expect(v.youngestQuizzableAgeMs).toBeGreaterThanOrEqual(FLOW.minAgeMs);
  });

  it('R1 — fails on too few learner turns in the window', () => {
    const { input, now } = ready(clock);
    const thin = { ...input, session: { ...input.session!, learnerTurns: input.session!.learnerTurns.slice(0, 2) } };
    const v = handOffDue(thin, now);
    expect(v.due).toBe(false);
    expect(v.reasons).toContain('r1_engagement');
  });

  it('R1 — turns older than m do not count', () => {
    let session = openSession({ id: 'fs_1', documentId: 'doc_1' }, clock.now());
    for (let i = 0; i < 3; i += 1) {
      session = noteActivity(session, { kind: 'turn' }, clock.now());
      clock.advance(4 * MINUTE); // 12 min of turns: the first two fall out of a 10 min window
    }
    const v = handOffDue(
      { session, taught: [], pendingTeacherQuestion: false, silenceWindowOpen: false, whisperOpen: false },
      clock.now(),
    );
    expect(v.learnerTurnsInWindow).toBeLessThan(FLOW.turnsK);
    expect(v.reasons).toContain('r1_engagement');
  });

  it('R2 — one quizzable element is a comprehension check, not retrieval practice', () => {
    const { input, now } = ready(clock);
    const v = handOffDue({ ...input, taught: [input.taught[0]!] }, now);
    expect(v.due).toBe(false);
    expect(v.reasons).toContain('r2_coverage');
  });

  it('R3 — nothing may be quizzed in the sentence it was taught in', () => {
    const { input, now } = ready(clock);
    const justTaught = [taught('R1', now - 30_000), taught('R2', now - 20_000)];
    const v = handOffDue({ ...input, taught: justTaught }, now);
    expect(v.due).toBe(false);
    expect(v.reasons).toContain('r3_maturity');
  });

  it('R4 — never into an impasse, a whisper, a silence window or a keystroke', () => {
    for (const [field, value] of [
      ['pendingTeacherQuestion', true],
      ['silenceWindowOpen', true],
      ['whisperOpen', true],
      ['referenceLocked', true],
    ] as const) {
      const { input, now } = ready(new FakeClock());
      const v = handOffDue({ ...input, [field]: value }, now);
      expect(v.due, field).toBe(false);
      expect(v.reasons, field).toContain('r4_floor_not_clear');
    }
    const { input, now } = ready(new FakeClock());
    // Mid-keystroke: design-brief.md §D3's rule, inherited.
    const v = handOffDue({ ...input, lastKeystrokeAt: now - 500 }, now);
    expect(v.due).toBe(false);
    expect(v.reasons).toContain('r4_floor_not_clear');
  });

  it('is false with no session, and after the session has closed', () => {
    expect(handOffDue({ session: null, taught: [], pendingTeacherQuestion: false, silenceWindowOpen: false, whisperOpen: false }, clock.now()).reasons).toContain('no_session');
    const { input, now } = ready(clock);
    const closed = closeSession(input.session!, now, 'explicit');
    expect(handOffDue({ ...input, session: closed }, now).reasons).toContain('session_closed');
  });

  it('honours the proactive/reactive toggle \u2014 Koala\u2019s actual control', () => {
    const { input, now } = ready(clock);
    expect(handOffDue({ ...input, mode: 'proactive' }, now).due).toBe(true);
    expect(handOffDue({ ...input, mode: 'reactive' }, now).due).toBe(false);
    expect(handOffDue({ ...input, mode: 'reactive' }, now).reasons).toContain('mode_reactive');
  });

  it('a raised threshold withholds the same hand-off a lowered one allows', () => {
    const { input, now } = ready(clock);
    const strict = { ...input, session: { ...input.session!, profile: withThreshold(FLOW, 'high') } };
    expect(handOffDue(strict, now).due).toBe(false);
    expect(handOffDue(strict, now).reasons).toContain('r1_engagement');
  });

  it('a decline costs one full m window, and three declines end it for the session', () => {
    const { input, now } = ready(clock);
    const declined = declineHandOff(input.session!, now);
    expect(handOffDue({ ...input, session: declined }, now).reasons).toContain('cooldown');
    // One full window later the cool-down is spent.
    const later = now + FLOW.windowMs + 1_000;
    const stillEngaged = {
      ...declined,
      learnerTurns: [later - 60_000, later - 40_000, later - 20_000],
      gapDeadlineTs: later + FLOW.sessionGapMs,
    };
    expect(handOffDue({ ...input, session: stillEngaged, lastKeystrokeAt: later - 30_000 }, later).due).toBe(true);

    const exhausted = { ...stillEngaged, declines: 3, cooldownUntil: null };
    expect(handOffDue({ ...input, session: exhausted }, later).reasons).toContain('declines_exhausted');
  });

  it('fires sooner on the demo profile, which is why it must be disclosed', () => {
    const t0 = clock.now();
    let session = openSession({ id: 'fs_d', documentId: 'doc_1', profile: DEMO }, t0);
    const items = [taught('R1', t0), taught('R2', t0 + 10_000)];
    clock.advance(4 * MINUTE); // both items are now past the 3 min UI guard
    for (let i = 0; i < 2; i += 1) {
      session = noteActivity(session, { kind: 'turn' }, clock.now());
      clock.advance(30_000);
    }
    clock.advance(10_000);
    const input: HandOffInput = {
      session,
      taught: items,
      pendingTeacherQuestion: false,
      silenceWindowOpen: false,
      whisperOpen: false,
      lastKeystrokeAt: clock.now() - 10_000,
    };
    expect(handOffDue(input, clock.now()).due).toBe(true);
    // Two turns is one short of the shipped k, so the same state is not ready on `FLOW`.
    const shipped = handOffDue({ ...input, session: { ...session, profile: FLOW } }, clock.now());
    expect(shipped.due).toBe(false);
    expect(shipped.reasons).toContain('r1_engagement');
  });

  /**
   * **R1b, and the measurement that bought it** (`app/docs/STATUS.md`, storyboard gate note 1).
   * A warm sitting — a second walkthrough without quitting, or a relaunch that resumes the
   * session, which is the product behaviour — handed off again on the **very next learner turn,
   * in 13 ms**, because the previous run's taught set and its turn timestamps were both still
   * inside the Demo profile's three-minute window. Ellie never taught; she went straight to
   * *"Max, over to you."*
   */
  it('will not hand off twice in a row on Demo: k turns must pass since the last one', () => {
    const t0 = clock.now();
    let session = openSession({ id: 'fs_warm', documentId: 'doc_1', profile: DEMO }, t0);
    const items = [taught('R1', t0), taught('R2', t0 + 10_000)];
    clock.advance(4 * MINUTE);
    for (let i = 0; i < 2; i += 1) {
      session = noteActivity(session, { kind: 'turn' }, clock.now());
      clock.advance(30_000);
    }
    clock.advance(10_000);
    const input = (): HandOffInput => ({
      session,
      taught: items,
      pendingTeacherQuestion: false,
      silenceWindowOpen: false,
      whisperOpen: false,
      lastKeystrokeAt: clock.now() - 10_000,
    });

    // Run 1 of the walkthrough: the hand-off fires, exactly as the test above.
    const first = handOffDue(input(), clock.now());
    expect(first.due).toBe(true);
    expect(first.learnerTurnsSinceHandOff).toBe(2);
    session = noteHandOff(session, clock.now());

    // Max holds 9–12 s and asks; the learner answers. One turn since the hand-off — not two, so
    // R1b holds the floor even though k-in-m is still satisfied by the turns that produced it.
    clock.advance(30_000);
    session = noteActivity(session, { kind: 'turn' }, clock.now());
    clock.advance(10_000);
    const answered = handOffDue(input(), clock.now());
    expect(answered.due).toBe(false);
    expect(answered.reasons).toEqual(['r1_since_handoff']);
    expect(answered.learnerTurnsInWindow).toBeGreaterThanOrEqual(DEMO.turnsK);
    expect(answered.learnerTurnsSinceHandOff).toBe(1);

    // Ellie teaches, the learner replies again: two turns since, and the Tester may be offered
    // the floor a second time. The walkthrough teaches before it quizzes, which is the point.
    clock.advance(20_000);
    session = noteActivity(session, { kind: 'turn' }, clock.now());
    clock.advance(10_000);
    const second = handOffDue(input(), clock.now());
    expect(second.due).toBe(true);
    expect(second.learnerTurnsSinceHandOff).toBe(2);
  });

  it('leaves the study profile alone — R1b is a Demo clause only', () => {
    expect(requiresTurnsSinceHandOff(DEMO)).toBe(true);
    expect(requiresTurnsSinceHandOff(FLOW)).toBe(false);

    const { input, now } = ready(clock);
    // The same warm state that stops a Demo sitting: three turns in the window, all of them
    // before the last hand-off. On `FLOW` the verdict is unchanged, and the raw count is still
    // logged so §11 can recompute the clause offline before deciding to promote it.
    const warm = { ...input, session: { ...input.session!, lastHandOffAt: now - 1_000 } };
    const v = handOffDue(warm, now);
    expect(v.due).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.learnerTurnsSinceHandOff).toBe(0);
    expect(handOffDue({ ...warm, session: { ...warm.session, profile: DEMO } }, now).reasons).toContain(
      'r1_since_handoff',
    );
  });

  it('is vacuous until there has been a hand-off, so a cold sitting is untouched', () => {
    const { input, now } = ready(clock);
    const demo = { ...input, session: { ...input.session!, profile: DEMO } };
    expect(demo.session.lastHandOffAt).toBeNull();
    const v = handOffDue(demo, now);
    expect(v.due).toBe(true);
    expect(v.learnerTurnsSinceHandOff).toBe(v.learnerTurnsInWindow);
  });
});

describe('the hand-off line', () => {
  it('names what was covered and hands the floor over, from the rules', () => {
    const t0 = Date.parse('2026-09-15T10:00:00.000Z');
    const items = quizzable(
      [taught('R1', t0, 'teacher', 'the PSD condition'), taught('R2', t0 + MINUTE, 'teacher', 'the domain')],
      t0 + 30 * MINUTE,
    );
    expect(handOffLine(rosterFor(), items)).toBe(
      "You've covered the domain and the PSD condition — Max, over to you.",
    );
  });

  it('names the Tester off the roster, whichever way round it is', () => {
    const t0 = Date.parse('2026-09-15T10:00:00.000Z');
    const items = quizzable(
      [taught('R1', t0, 'teacher', 'the domain'), taught('R2', t0 + MINUTE, 'teacher', 'the PSD condition')],
      t0 + 30 * MINUTE,
    );
    // The line is the Teacher's and names the Tester. Pinned (#32) that is Max; handed the
    // pairing #16 could draw, it is Ellie — and never the speaker's own name either way.
    expect(handOffLine(rosterFor('ellie_peer'), items)).toContain('Max, over to you.');
    expect(handOffLine(rosterFor('ellie_challenger'), items)).toContain('Ellie, over to you.');
  });

  it('falls back to a label lookup when the taught item carries no label', () => {
    const t0 = Date.parse('2026-09-15T10:00:00.000Z');
    const items = quizzable([taught('R1', t0), taught('R2', t0)], t0 + 30 * MINUTE);
    const line = handOffLine(rosterFor(), items, (id) => (id === 'R1' ? 'convexity' : 'the Hessian'));
    expect(line).toContain('Max, over to you.');
    expect(line).toMatch(/convexity|the Hessian/);
  });
});

describe('feedback after a quiz answer is a rule, not a prompt hint', () => {
  // flow-session.md §3/§8.3, Rowland 2014: g = 0.73 with feedback against 0.39 without. This is
  // the strongest-evidenced constraint in the brief and the one #33 does not mention.
  const t0 = Date.parse('2026-09-15T10:00:00.000Z');

  it('is not due while the question is still unanswered', () => {
    const quiz = openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0);
    expect(feedbackDue(quiz)).toBe(false);
    expect(feedbackDue(null)).toBe(false);
  });

  it('is due the moment the learner answers, and stays due until it is delivered', () => {
    let quiz = openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0);
    quiz = answerQuiz(quiz, 'm_10');
    expect(feedbackDue(quiz)).toBe(true);
    expect(feedbackDue(markFeedbackGiven(quiz))).toBe(false);
  });

  it('only the first answer counts, so a follow-up does not re-open the debt', () => {
    let quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10');
    quiz = markFeedbackGiven(quiz);
    expect(answerQuiz(quiz, 'm_11').answerMessageId).toBe('m_10');
    expect(feedbackDue(quiz)).toBe(false);
  });

  it('an unanswered quiz expires at session close rather than becoming a debt', () => {
    // §12 q. 6: a quiz that greets you next session is a debt, and design-brief.md §E argues
    // against debts.
    const unanswered = openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0);
    expect(expireQuizOnClose(unanswered).expired).toBe(unanswered);
    expect(expireQuizOnClose(answerQuiz(unanswered, 'm_10')).expired).toBeNull();
  });
});
