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
  feedbackVerdict,
  feedbackUnmarked,
  unmarkAttempt,
  UNMARKED_OPENER,
  verdictOf,
  verdict3Of,
  VERDICT_OPENERS,
  answerQuiz,
  answersBlank,
  answerShownOf,
  attemptsOf,
  closureDue,
  cueMistakeToCorrect,
  markAnswerShown,
  markCueGiven,
  pointsAllCovered,
  qResolutionOf,
  quizOpen,
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
  type PendingQuiz,
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

  it('is due the moment the learner attempts, and stays due until it is delivered', () => {
    let quiz = openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0);
    quiz = answerQuiz(quiz, 'm_10', { attempt: true });
    expect(feedbackDue(quiz)).toBe(true);
    expect(feedbackDue(markFeedbackGiven(quiz))).toBe(false);
  });

  /**
   * **Superseded by `attempt-first.md` §2.3** (issue #47). The old test here asserted that only
   * the *first* answer counted, so a second answer could not re-open the debt. The attempt loop
   * invites a revision after feedback — §2.4's "Try another" and the learner's own second go — and
   * Rowland 2014's number is about feedback on *an attempt*, not on the first one. So each attempt
   * re-opens it, and only an attempt does.
   */
  it('re-opens the debt on a second attempt, and on nothing else', () => {
    let quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });
    quiz = markFeedbackGiven(quiz);
    expect(feedbackDue(quiz)).toBe(false);

    const asked = answerQuiz(quiz, 'm_11', { attempt: false });
    expect(asked.answerMessageId).toBe('m_10');
    expect(asked.attempts).toBe(1);
    expect(feedbackDue(asked)).toBe(false);

    const again = answerQuiz(quiz, 'm_12', { attempt: true });
    expect(again.attempts).toBe(2);
    expect(feedbackDue(again)).toBe(true);
  });

  it('counts attempts, and only attempts', () => {
    let quiz = openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0);
    expect(attemptsOf(quiz)).toBe(0);
    quiz = answerQuiz(quiz, 'm_10', { attempt: false });
    expect(attemptsOf(quiz)).toBe(0);
    expect(quiz.answerMessageId).toBeNull();
    quiz = answerQuiz(quiz, 'm_11', { attempt: true });
    expect(attemptsOf(quiz)).toBe(1);
  });

  /**
   * A row written before #47 has neither field. It has to read as "nobody has tried yet", which is
   * the safe end of the lock: the answer stays withheld until the learner does something.
   */
  it('reads a pre-#47 persisted quiz as no attempts and no answer shown', () => {
    const old = { quizMessageId: 'm_9', elementId: 'R1', askedAt: t0, answerMessageId: null, feedbackGiven: false } as PendingQuiz;
    expect(attemptsOf(old)).toBe(0);
    expect(answerShownOf(old)).toBe(false);
    expect(quizOpen(old)).toBe(true);
    expect(answerQuiz(old, 'm_10', { attempt: true }).attempts).toBe(1);
  });

  /**
   * §2.4: the question survives its own feedback, because *"Show the answer"* and *"Try another"*
   * both act on it afterwards. Only the shown answer closes it.
   */
  it('stays open through feedback and closes on the shown answer', () => {
    let quiz = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });
    quiz = markFeedbackGiven(quiz);
    expect(quizOpen(quiz)).toBe(true);
    quiz = markAnswerShown(quiz);
    expect(quizOpen(quiz)).toBe(false);
    expect(answerShownOf(quiz)).toBe(true);
    expect(quizOpen(null)).toBe(false);
  });

  /**
   * §4.2 of `collab-doc.md`: feedback carries "a follow-up on the same question **unless *Well
   * done***", and §5.3 resolves the Q block as *you got this* on that verdict. The live run of
   * 20 Sep found the other half missing: the question stayed open after a *Well done*, so the
   * learner's next question drew `rule:quiz_clarify`, no new follow-up could ever fire (it is
   * gated on nothing being open) and closure would have released an answer they already gave.
   */
  it('closes on a Well done, and stays open on the other two verdicts', () => {
    const asked = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });

    const done = markFeedbackGiven(asked, 'complete', 'complete');
    expect(quizOpen(done)).toBe(false);
    expect(closureDue(done)).toBe(false);
    // Not a release: the Q block still resolves as the learner's own win, not as *released*.
    expect(answerShownOf(done)).toBe(false);
    expect(qResolutionOf(done)).toBe('you_got_this');

    // `QuizVerdict` is the two-valued one the composer reads; `QuizVerdict3` is the outcome's.
    for (const verdict of ['partial', 'not_yet'] as const) {
      const open = markFeedbackGiven(asked, 'partial', verdict);
      expect(quizOpen(open)).toBe(true);
      expect(closureDue(open)).toBe(true);
      // #49: an open question has no resolution. It used to say *partly yours* here, and the
      // doc resolved the Q block while Max's feedback was asking for another try.
      expect(qResolutionOf(open)).toBeNull();
    }
  });

  /**
   * **#49: a question resolves once** (brief §5.3). A turn after a release or a *Well done* used to
   * re-open the feedback debt on the closed question, so Max marked it again and the verdict filled
   * progress. A closed question takes no further attempt, and owes no feedback.
   */
  it('takes no attempt and owes no feedback once it is closed', () => {
    const asked = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });

    const released = markAnswerShown(asked, 'give_up');
    expect(answerQuiz(released, 'm_11', { attempt: true })).toBe(released);
    expect(feedbackDue(answerQuiz(released, 'm_11', { attempt: true }))).toBe(false);

    const done = markFeedbackGiven(asked, 'complete', 'complete');
    expect(answerQuiz(done, 'm_11', { attempt: true })).toBe(done);
    expect(feedbackDue(answerQuiz(done, 'm_11', { attempt: true }))).toBe(false);

    // A release that lands while an attempt is still unmarked closes the debt with it.
    expect(feedbackDue(markAnswerShown(asked, 'pass'))).toBe(false);
  });

  /** Brief §5.3: *partly yours* is a question that closed while partial — at any attempt. */
  it('resolves a release as partly yours when any attempt was Partly there', () => {
    const asked = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });
    expect(qResolutionOf(markAnswerShown(asked, 'give_up'))).toBe('released');

    const partly = markFeedbackGiven(asked, 'partial', 'partial');
    const thenWrong = markFeedbackGiven(answerQuiz(partly, 'm_12', { attempt: true }), 'partial', 'not_yet');
    expect(qResolutionOf(markAnswerShown(thenWrong, 'give_up'))).toBe('partly_yours');
    expect(qResolutionOf(markAnswerShown(thenWrong, 'closure'))).toBe('partly_yours');
  });

  /**
   * 2026-10-06 (D4): one recalled term is not an earned answer, so its chip is never you got this.
   * 6 Oct afternoon (item 14): it is recall, never revisit.
   */
  it('resolves a question closed by a correct blank as recall, never you got this or revisit', () => {
    const cloze = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1', form: 'cloze' }, t0), 'm_10', { attempt: true });
    expect(qResolutionOf(markFeedbackGiven(cloze, 'complete', 'complete'))).toBe('recall');

    // A blank follow-up restored from before 2026-10-06 closes the same way.
    const open = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });
    const blankOwed = { ...markFeedbackGiven(open, 'partial', 'partial'), followUpBlank: true };
    const filled = markFeedbackGiven(answerQuiz(blankOwed, 'm_11', { attempt: true }), 'complete', 'complete');
    expect(qResolutionOf(filled)).toBe('recall');
  });

  /**
   * 6 Oct afternoon (item 17): a release after answers that stated every essential point of Max's
   * hidden model answer is the learner's, not *partly yours*. The points are stored with the
   * question and carried, taken together, by `markFeedbackGiven`.
   */
  it('resolves a release as the learner’s when their answers stated every point', () => {
    const asked = openQuiz({ quizMessageId: 'm_9', elementId: 'R1', modelAnswer: 'A.', keyPoints: ['one', 'two'] }, t0);
    expect(asked.pointsCovered).toEqual([]);
    const once = markFeedbackGiven(answerQuiz(asked, 'm_10', { attempt: true }), 'partial', 'partial', { pointsCovered: [2] });
    expect(pointsAllCovered(once)).toBe(false);
    expect(qResolutionOf(markAnswerShown(once, 'give_up'))).toBe('partly_yours');
    const twice = markFeedbackGiven(answerQuiz(once, 'm_11', { attempt: true }), 'partial', 'partial', { pointsCovered: [1, 2] });
    expect(pointsAllCovered(twice)).toBe(true);
    expect(qResolutionOf(markAnswerShown(twice, 'give_up'))).toBe('you_got_this');
    // A question with no points (asked before this build) is unchanged.
    expect(pointsAllCovered(openQuiz({ quizMessageId: 'm_1', elementId: 'R1' }, t0))).toBe(false);
  });

  /** Item 2: the three-try close is a release at closure, marked as the cap's. */
  it('marks a question closed by the three-try cap', () => {
    const asked = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });
    const closed = markAnswerShown(markFeedbackGiven(asked, 'partial', 'partial'), 'closure', { afterTries: true });
    expect(closed.closedAfterTries).toBe(true);
    expect(quizOpen(closed)).toBe(false);
    expect(qResolutionOf(closed)).toBe('partly_yours');
    expect(markAnswerShown(asked, 'give_up').closedAfterTries).toBe(false);
  });

  /** 2026-10-06 (D3): Show me, once offered, stays offered until the question closes. */
  it('keeps Show me offered once it has been, and drops it on a Well done', () => {
    const asked = answerQuiz(openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0), 'm_10', { attempt: true });
    const offered = markFeedbackGiven(asked, 'partial', 'partial', { showMe: true });
    expect(offered.showMeOffered).toBe(true);
    const again = markFeedbackGiven(answerQuiz(offered, 'm_11', { attempt: true }), 'partial', 'not_yet');
    expect(again.showMeOffered).toBe(true);
    const done = markFeedbackGiven(answerQuiz(offered, 'm_12', { attempt: true }), 'complete', 'complete', { showMe: true });
    expect(done.showMeOffered).toBe(false);
  });

  it('an unanswered quiz expires at session close rather than becoming a debt', () => {
    // §12 q. 6: a quiz that greets you next session is a debt, and design-brief.md §E argues
    // against debts.
    const unanswered = openQuiz({ quizMessageId: 'm_9', elementId: 'R1' }, t0);
    expect(expireQuizOnClose(unanswered).expired).toBe(unanswered);
    expect(expireQuizOnClose(answerQuiz(unanswered, 'm_10', { attempt: true })).expired).toBeNull();
  });
});

/**
 * Issue #38 §4: the Tester quizzes objectives that are taught and **not yet defended**,
 * preferring `order`. The two clauses `pickTarget` gained with the objective tree.
 */
describe('pickTarget and the objective tree', () => {
  const item = (elementId: string, taughtAt: number, order?: number): TaughtItem =>
    order === undefined ? { elementId, taughtAt, by: 'teacher' } : { elementId, taughtAt, by: 'teacher', order };

  const quizzableAt = (items: TaughtItem[], now: number) => quizzable(items, now, FLOW);

  it('will not re-quiz a defended objective while an undefended one is available', () => {
    const now = 10 * 60_000;
    // The defended one is *fresher*, so on the old score it would have won.
    const items = quizzableAt([item('defended', now - 4 * 60_000), item('untouched', now - 9 * 60_000)], now);
    expect(pickTarget(items, { defended: 3, untouched: 0 })!.elementId).toBe('untouched');
  });

  it('falls back to a defended one when everything quizzable is defended', () => {
    const now = 10 * 60_000;
    const items = quizzableAt([item('a', now - 4 * 60_000), item('b', now - 9 * 60_000)], now);
    expect(pickTarget(items, { a: 3, b: 3 })!.elementId).toBe('a');
  });

  it('breaks a tie on deck order', () => {
    const now = 10 * 60_000;
    const taughtAt = now - 5 * 60_000;
    const items = quizzableAt([item('later', taughtAt, 7), item('earlier', taughtAt, 2)], now);
    expect(pickTarget(items, {})!.elementId).toBe('earlier');
  });

  it('still prefers the least demonstrated over the merely earlier', () => {
    const now = 10 * 60_000;
    const taughtAt = now - 5 * 60_000;
    const items = quizzableAt([item('earlier', taughtAt, 1), item('later', taughtAt, 9)], now);
    expect(pickTarget(items, { earlier: 2, later: 0 })!.elementId).toBe('later');
  });
});

/**
 * §2.4, second cut (Lucas's 2026-09-19 run): the feedback turn's first line is one of three fixed
 * verdicts, and code reads it once to decide what the composer asks for next.
 */
describe('feedbackVerdict', () => {
  it('reads only "Well done." as complete', () => {
    expect(feedbackVerdict('Well done. All four named — p. 5: "Discrete…"')).toBe('complete');
    expect(feedbackVerdict('**Well done.** All four named.')).toBe('complete');
    expect(feedbackVerdict('  well done — all four.')).toBe('complete');
    expect(feedbackVerdict('Partly there. Three of four.')).toBe('partial');
    expect(feedbackVerdict('Not yet. p. 5 says otherwise.')).toBe('partial');
  });

  it('reads a turn that forgot the opener as partial, the side that asks for another try', () => {
    expect(feedbackVerdict('All four properties correctly named — p. 5: "Discrete…". What is missing:')).toBe('partial');
    expect(feedbackVerdict('')).toBe('partial');
  });

  it('is only ever the first line', () => {
    expect(feedbackVerdict('Not yet.\nWell done on the first half, though.')).toBe('partial');
  });

  it('keeps the three openers the prompt names', () => {
    expect(VERDICT_OPENERS).toEqual(['Well done.', 'Partly there.', 'Not yet.']);
  });

  it('is stored on the quiz by markFeedbackGiven and cleared by the next attempt', () => {
    let quiz = openQuiz({ quizMessageId: 'm1', elementId: 'R1' }, 0);
    expect(verdictOf(quiz)).toBeNull();
    quiz = answerQuiz(quiz, 'm2', { attempt: true });
    quiz = markFeedbackGiven(quiz, 'partial');
    expect(verdictOf(quiz)).toBe('partial');
    quiz = answerQuiz(quiz, 'm3', { attempt: true });
    expect(verdictOf(quiz)).toBeNull();
    expect(feedbackDue(quiz)).toBe(true);
    quiz = markFeedbackGiven(quiz, 'complete');
    expect(verdictOf(quiz)).toBe('complete');
    // A caller without the text leaves it unmarked, never "complete".
    expect(verdictOf(markFeedbackGiven(quiz))).toBeNull();
    // A row from before the field is read as unmarked.
    expect(verdictOf({ ...quiz, verdict: 'done' as never })).toBeNull();
  });});

/**
 * **#49's fallback.** A request for background that the classifier counted as an attempt gets a
 * feedback turn opening `Not marked.`; code reads it and puts the question back as it was.
 */
describe('Not marked.', () => {
  it('is read off the first line only, however it is emphasised', () => {
    expect(UNMARKED_OPENER).toBe('Not marked.');
    expect(feedbackUnmarked('Not marked. A CNF clause is an OR of literals…')).toBe(true);
    expect(feedbackUnmarked('**Not marked.**\nA clause is…')).toBe(true);
    expect(feedbackUnmarked('  not marked — here is the format.')).toBe(true);
    expect(feedbackUnmarked('Not yet. p. 7 says otherwise.')).toBe(false);
    expect(feedbackUnmarked('Partly there.\nNot marked as complete yet.')).toBe(false);
    expect(feedbackUnmarked('')).toBe(false);
    // Not one of the verdicts: it is not a mark at all.
    expect(VERDICT_OPENERS).not.toContain(UNMARKED_OPENER);
  });

  it('un-counts a first attempt: nothing owed, nothing marked, the question still open', () => {
    const asked = openQuiz({ quizMessageId: 'm1', elementId: 'R1' }, 0);
    const counted = answerQuiz(asked, 'm2', { attempt: true, text: 'what is CNF? we never covered it' });
    expect(feedbackDue(counted)).toBe(true);
    const quiz = unmarkAttempt(counted);
    expect(attemptsOf(quiz)).toBe(0);
    expect(quiz.answerMessageId).toBeNull();
    expect(quiz.answerText).toBeNull();
    expect(feedbackDue(quiz)).toBe(false);
    expect(verdictOf(quiz)).toBeNull();
    expect(verdict3Of(quiz)).toBeNull();
    expect(quizOpen(quiz)).toBe(true);
    expect(qResolutionOf(quiz)).toBeNull();
  });

  it('puts back what the counted turn overwrote, when the caller kept it', () => {
    let quiz = openQuiz({ quizMessageId: 'm1', elementId: 'R1' }, 0);
    quiz = answerQuiz(quiz, 'm2', { attempt: true, text: 'the learner pays it' });
    quiz = markFeedbackGiven(quiz, 'partial', 'partial');
    const before = { answerMessageId: quiz.answerMessageId, answerText: quiz.answerText, feedbackGiven: quiz.feedbackGiven, verdict: quiz.verdict };
    quiz = answerQuiz(quiz, 'm3', { attempt: true, text: 'can you show me the format' });
    quiz = unmarkAttempt(quiz, before);
    expect(attemptsOf(quiz)).toBe(1);
    expect(quiz.answerMessageId).toBe('m2');
    expect(quiz.answerText).toBe('the learner pays it');
    expect(feedbackDue(quiz)).toBe(false);
    // The composer is back on "your next attempt", as it was after the Partly there.
    expect(verdictOf(quiz)).toBe('partial');
    expect(verdict3Of(quiz)).toBe('partial');
    expect(quizOpen(quiz)).toBe(true);
  });

  it('restores the earlier verdict from verdict3 when there is no snapshot, and never goes below zero', () => {
    let quiz = openQuiz({ quizMessageId: 'm1', elementId: 'R1' }, 0);
    quiz = answerQuiz(quiz, 'm2', { attempt: true });
    quiz = markFeedbackGiven(quiz, 'partial', 'not_yet');
    quiz = answerQuiz(quiz, 'm3', { attempt: true });
    quiz = unmarkAttempt(quiz);
    expect(attemptsOf(quiz)).toBe(1);
    expect(verdictOf(quiz)).toBe('partial');
    expect(feedbackDue(quiz)).toBe(false);
    expect(attemptsOf(unmarkAttempt(openQuiz({ quizMessageId: 'm1', elementId: 'R1' }, 0)))).toBe(0);
  });
});

/** Live run, 2026-10-03: a blank follow-up on an open question, and Ellie corrected once. */
describe('a blank follow-up, and the correction of Ellie’s guess', () => {
  const t = 1_000;
  const asked = () => answerQuiz(openQuiz({ quizMessageId: 'm_1', elementId: 'R1' }, t), 'm_2', { attempt: true });

  it('records a blank follow-up only when the verdict leaves the question open', () => {
    expect(answersBlank(asked())).toBe(false);
    const partly = markFeedbackGiven(asked(), 'partial', 'partial', { followUpBlank: true });
    expect(partly.followUpBlank).toBe(true);
    expect(answersBlank(partly)).toBe(true);
    expect(markFeedbackGiven(asked(), 'complete', 'complete', { followUpBlank: true }).followUpBlank).toBe(false);
    // A turn that wrote no blank opens an open follow-up, whatever the turn before it asked.
    expect(markFeedbackGiven(partly, 'partial', 'partial').followUpBlank).toBe(false);
  });

  it('a cloze question is a blank to answer, with or without the flag', () => {
    expect(answersBlank({ ...asked(), form: 'cloze' })).toBe(true);
    expect(answersBlank(null)).toBe(false);
  });

  it('stops asking for the correction once a feedback turn has carried it', () => {
    const cued = markCueGiven(asked(), { at: t, hasMistake: true, claim: 'it comes from :init' });
    expect(cueMistakeToCorrect(cued)).toBe('it comes from :init');
    const corrected = markFeedbackGiven(cued, 'partial', 'partial', { cueCorrected: true });
    expect(cueMistakeToCorrect(corrected)).toBeNull();
    // And it stays corrected through the next mark.
    expect(cueMistakeToCorrect(markFeedbackGiven(corrected, 'partial', 'partial'))).toBeNull();
  });
});
