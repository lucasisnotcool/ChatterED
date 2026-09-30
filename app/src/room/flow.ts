/**
 * The flow session — the unit between a snippet and a file (issue #33).
 *
 * Lucas's framing, verbatim: *"we need some way that is larger than per-snippet convo, but
 * smaller than whole file… the focus should be time based management and decay; a user is not
 * expected to remember a convo more than 6 hours old, so the focus is session should match
 * 'flow state'."*
 *
 * **This module is the only place the constants live**, which is the point of it: `#33` is a
 * live discussion and the mechanism must not be blocked on it (`flow-build-plan.md` §4.2). The
 * research brief is `docs/research/flow-session.md`; every constant below cites the section of
 * it that argues the number, and where the brief moved a number away from the issue's
 * placeholder, the comment says so.
 *
 * **Say it plainly, in the report and on camera: ChatterED does not measure flow.**
 * `flow-session.md` §5 is explicit — there is no Csikszentmihalyi-validated behavioural-log
 * proxy for flow, and `k` turns in `m` minutes is an *engagement heuristic borrowed from a
 * different research tradition*, named "flow" after the developer's framing. Calling it flow
 * detection would be an unearned claim.
 *
 * Everything here is **pure and clock-injected**: no `Date.now()`, no `setTimeout`, no store.
 * It follows `timer.ts`'s rule verbatim — *"the row is the timer"* — so a session boundary is an
 * absolute deadline compared against wall-clock, and therefore survives sleep, quit and
 * relaunch, which a `setTimeout` does not.
 */

import type { AgentProfile } from '../shared/types.js';
/**
 * The collab doc's shared vocabulary (#48). `src/shared/doc/types.ts` imports nothing but types,
 * so this stays inside the portability rule that keeps `src/room` free of Electron and SQLite.
 */
import type { QResolution, QuizVerdict3 } from '../shared/doc/types.js';
import type { QuestionForm } from '../core/pitch.js';
import { testerName } from './agents.js';

/** The tunable set. One object so a demo profile is a substitution, not a scatter of flags. */
export interface FlowProfile {
  /** Name, so an event log can say which profile produced a hand-off (§11 `config_hash`). */
  readonly name: 'default' | 'demo';
  /** Inactivity gap that closes a session. */
  readonly sessionGapMs: number;
  /**
   * A taught item younger than this may not be quizzed. **A UI guard, not a retrieval delay,
   * and it must never be raised** — see FLOW below and `flow-session.md` §3.2/§8.3.
   */
  readonly minAgeMs: number;
  /**
   * The **ranking** half-life. Orders candidates; never excludes one. Not a memory estimate.
   */
  readonly recencyHalfLifeMs: number;
  /**
   * How long after a session closes its taught items stay quizzable in the next one. A
   * conversational-context bound, not a decay constant.
   */
  readonly horizonMs: number;
  /** `k` — learner turns required inside the flow window. */
  readonly turnsK: number;
  /** `m` — the flow window. Must stay strictly inside `sessionGapMs` (§5). */
  readonly windowMs: number;
  /** R2 — how many quizzable elements before the Tester can relate two things. */
  readonly minTaught: number;
  /** R4 — the composer must have been idle this long (no keystroke) before a hand-off. */
  readonly composerIdleMs: number;
  /**
   * **How much of the reading-time silence threshold this profile waits** (`collab-doc.md` §4.3:
   * the cue fires at `clamp(2 × words / 238 wpm, 120 s, 300 s)`, "the Demo pacing profile
   * shortens it"). 1 is the brief's own number; the Demo profile is the only thing that moves
   * it, and only downwards. Applied in `timer.silenceStagesMs`.
   */
  readonly silenceScale: number;
  /** Declines in one session after which the Tester drops to reactive for the rest of it. */
  readonly declineLimit: number;
  /** Rowland 2014: feedback after every quiz answer is required, not optional. */
  readonly feedbackRequired: boolean;
}

/**
 * **`MIN_AGE` may never be raised above this.** `flow-session.md` §3.2, §8.3: for *prose*,
 * Karpicke & Roediger 2007 (pp. 717–718, VERIFIED) found an immediate free-recall test **beat**
 * a first test delayed by 10 minutes, because prose recall does not draw on primary memory.
 * ChatterED's task is prose-like. So the 3 minutes is a **UI guard** against quizzing a sentence
 * the learner is still reading — not a retrieval-practice delay — and an earlier draft of this
 * file that raised it to 10 minutes on Anki's `1m 10m` learning steps had the evidence backwards.
 */
export const MIN_AGE_CAP_MS = 3 * 60_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The shipped constants. Source of truth: **`docs/research/flow-session.md` §8.3**, which gives
 * each one a citation and a confidence flag; the four corrections it makes to issue #33's
 * proposal are the four notes below.
 *
 *  - `sessionGapMs` **20 min** — §1, §8.3. Evidence-informed. The only published re-examination
 *    of the 30-minute convention puts the natural antimode at 15–20 min; the convention itself is
 *    Catledge & Pitkow's 9.3 min + 1.5 SD, later rounded. No learning-specific number exists.
 *    Nothing irreversible happens at a close, so ship 20 and tune it from `flow.idle.tick` (§11).
 *  - `minAgeMs` **3 min** — §3.2, §8.3, and **not to be raised** (see `MIN_AGE_CAP_MS`).
 *  - `recencyHalfLifeMs` **60 min** — §4, §8.3. #33's 2 h half-life **goes**: no evidence supports
 *    it for conceptual material, and even nonsense syllables retain 0.276 savings at 9 h
 *    (Murre & Dros 2015). It survives **demoted to a ranking weight** — used to order candidates,
 *    never to exclude one. Exponential-in-time with a fitted half-life is shipped practice
 *    (Settles & Meeder 2016), which is what licenses the shape, not the number.
 *  - `horizonMs` **6 h** — §4, §8.3. Kept, **re-justified**: it is a *conversational-context*
 *    bound, not a decay constant. It encodes Lucas's own framing — "a user is not expected to
 *    remember a **convo** more than 6 hours old" — which is episodic memory of the exchange, not
 *    retention of the concept. Memory would permit days, so ChatterED deliberately under-quizzes
 *    and the report should say so as a limitation. The window is *the open session, plus the
 *    immediately preceding one if it closed less than 6 h ago* — see `insideHorizon`.
 *  - `turnsK` **3** in `windowMs` **10 min** — §5, §8.3. A **designer's choice**, said out loud:
 *    no source gives a k-in-m rule for learning and flow has no validated log proxy. The defence
 *    is structural — m = gap/2 so the window cannot outlive its session, and 3 is the smallest
 *    count that distinguishes a conversation from a single question.
 *  - `minTaught` **2** — §8.2 R2. One element is a comprehension check, not retrieval practice.
 *  - `composerIdleMs` **3 s** — §8.2 R4, inheriting `design-brief.md` §D3's keystroke rule: a
 *    long pause is ambiguous (confusion or departure, D'Mello & Graesser), so never quiz
 *    mid-sentence.
 *  - `feedbackRequired` **true** — §3, §8.3, and **the best-evidenced constraint in the brief**:
 *    Rowland 2014's meta-analysis gives g = 0.73 for retrieval practice *with* feedback against
 *    0.39 without. A Tester that asks and moves on discards roughly half the effect. It is a
 *    rule, not a prompt hint — see `feedbackDue`.
 */
export const FLOW: FlowProfile = {
  name: 'default',
  sessionGapMs: 20 * MINUTE,
  minAgeMs: MIN_AGE_CAP_MS,
  recencyHalfLifeMs: 60 * MINUTE,
  horizonMs: 6 * HOUR,
  turnsK: 3,
  windowMs: 10 * MINUTE,
  minTaught: 2,
  composerIdleMs: 3_000,
  declineLimit: 3,
  feedbackRequired: true,
  silenceScale: 1,
};

/**
 * The **disclosed** demo profile, selectable in Settings as *Tester pacing ▸ Demo*
 * (`flow-build-plan.md` §4.2). Not a different mechanism: the same four rules, with the two
 * engagement constants and the UI guard set to what a walkthrough can actually reach. The
 * learner is told which profile is running — the flow's first-open pacing strip names it, and
 * so does Settings — because a demo that quizzes four times sooner than the shipped app without
 * saying so is exactly the overclaim that strip exists to rule out (§3.5).
 */
export const DEMO: FlowProfile = {
  ...FLOW,
  name: 'demo',
  turnsK: 2,
  windowMs: 3 * MINUTE,
  /**
   * **20 s — and lowering is the one direction the evidence allows.** `flow-session.md`
   * §3.2/§8.3 argues `minAgeMs` in one direction only: never *raised*, because for prose
   * Karpicke & Roediger 2007 (pp. 717–718) found an immediate free-recall test **beat** one
   * delayed by 10 minutes. See `MIN_AGE_CAP_MS`. What the 3 minutes buys is a UI guard against
   * quizzing the sentence still under the learner's eye, and 20 s still buys most of it: it is
   * longer than it takes to read a Teacher turn.
   *
   * It has to move for a **cold** walkthrough. From an empty sitting the earliest possible
   * hand-off is two Teacher turns plus the guard, so on the shipped profile nothing taught on
   * camera is quizzable for three minutes — a live run on 16 Sep waited the floor out and the
   * hand-off arrived on the fourth learner turn. §2's storyboard is at the hand-off about 35 s
   * after the first Teacher turn.
   *
   * **This conflicts with the filmed take, and the conflict is resolved in one place, not by
   * splitting the difference here.** §2 beat 10 says on camera *"minutes old, not seconds"*, and
   * `script.critique1.ts` seeds a warm-up sitting so the Tester lands on a concept taught four
   * minutes ago rather than on the one Ellie has just finished teaching. At 20 s the just-taught
   * one becomes eligible and, being fresher and less demonstrated, wins `pickTarget`. So the
   * take keeps the guard: `critique1Sitting()` pins its session to `CRITIQUE1_TAKE`, which is
   * this profile with `minAgeMs` back at the cap. Settings ▸ Demo is for a cold walkthrough;
   * the recorded take runs the warm-up. Flagged in the commit and in `docs/STATUS.md` — if
   * filming ends up cold, beat 10's narration is the line that has to change.
   */
  minAgeMs: 20_000,
  /**
   * **A sixth of the wait before Ellie's cue.** §4.3 gives the threshold as reading-time scaled
   * and says in the same sentence that "the Demo pacing profile shortens it"; until 20 Sep
   * nothing did, so the cue sat on the 120 s floor — two full minutes of an empty screen in the
   * middle of the beat that is being filmed, on both live runs.
   *
   * A sixth puts the floor at **20 s** and the ceiling at 50 s, which is the same relationship
   * the other Demo constants have to their shipped values (`windowMs` 10 min → 3 min,
   * `minAgeMs` 3 min → 20 s) and is still longer than it takes to read Max's question. The
   * shipped profile keeps the brief's numbers exactly.
   */
  silenceScale: 1 / 6,
};

/**
 * **R1b — the Demo profile also needs `k` learner turns since its *last* hand-off.**
 *
 * Measured on the 16 Sep storyboard gate (`app/docs/STATUS.md`, note 1): on a **warm** sitting —
 * a second walkthrough without quitting, or a relaunch that resumes the sitting, which is the
 * product behaviour — the next learner turn handed off in **13 ms**. Nothing was wrong with R1:
 * the previous run's taught set and its turn timestamps were both still inside the three-minute
 * Demo window, so k-in-m was satisfied before the learner had said anything this time round, and
 * Ellie went straight to *"Max, over to you."* without teaching a word.
 *
 * k-in-m is a **rate** and a rate is the right shape; what it cannot express is *"and not again
 * immediately"*. So the Demo profile adds one clause: turns counted from the last hand-off, not
 * only from the last `m` minutes. A second run in the same sitting therefore teaches again before
 * it quizzes, which is what the storyboard shows and what a walkthrough is for.
 *
 * **The shipped profile does not get this**, deliberately. Its window is 10 minutes against a
 * 20-minute gap, so the same pile-up needs `FLOW.turnsK` = 3 turns to survive a whole window and
 * still be in it — and it has `minAgeMs` at the 3-minute cap in front of it. Adding a rule to the
 * study profile to fix a *demo* pacing artefact would change what `flow.state.changed` logs mean
 * for A2 (`flow-session.md` §11), and the artefact is not reachable there. If §11's data later
 * shows back-to-back hand-offs on the shipped profile, this is the clause to promote — it is
 * written once, here, and gated on the profile name rather than duplicated.
 */
export function requiresTurnsSinceHandOff(profile: FlowProfile): boolean {
  return profile.name === 'demo';
}

/** The settings row the learner's choice lives in. Written by `AppService.saveSettings`. */
export const FLOW_PROFILE_SETTING = 'flow_profile';

/**
 * A stored profile name → the profile. Anything unrecognised — an empty row, a name from a
 * later build — is the shipped one: an install never falls into a demo pace.
 */
export function flowProfileFor(name: string | null | undefined): FlowProfile {
  return name === 'demo' ? DEMO : FLOW;
}

// ── the session ─────────────────────────────────────────────────────────────

export type CloseReason = 'gap' | 'explicit' | 'document_switch';

export interface FlowSession {
  id: string;
  documentId: string;
  /** 'document' for A1; the field keeps a folder-level session one line away (§12 q. 4). */
  scope: 'document';
  openedAt: number;
  /** The last learner *activity* — a turn, a split, an Ask, or a keystroke. */
  lastActivityAt: number;
  /**
   * The absolute close deadline, written before anything is armed. `timer.ts`: *"the row is the
   * timer"* — a session cannot be closed by a `setTimeout` that never fired, and this survives
   * sleep because it is compared against wall-clock, not counted down.
   */
  gapDeadlineTs: number;
  closedAt: number | null;
  closeReason: CloseReason | null;
  /** Ordered, de-duplicated list of anchors touched. The session's stored payload (§8.1). */
  anchors: string[];
  /** Learner-turn timestamps, for the rolling k-in-m count. Raw times, never a derived bool. */
  learnerTurns: number[];
  /**
   * When the Tester was last handed the floor in this session, or null if he never has. Read by
   * R1b on the Demo profile (see `requiresTurnsSinceHandOff`); recorded by `noteHandOff`.
   */
  lastHandOffAt: number | null;
  /** How many hand-offs the learner has declined this session (§8.2). */
  declines: number;
  /** A decline costs one full `m` window before R1 can hold again. */
  cooldownUntil: number | null;
  profile: FlowProfile;
}

/** What opened the session. Logged on `flow.session.open` (§11). */
export type OpenTrigger = 'turn' | 'split' | 'ask' | 'whisper' | 'resume';

/**
 * Opens on the first **learner-authored** action in a document. Opening the document is not
 * enough (§8.1): a reader who scrolls and leaves has not started a session, and sessions that
 * open on `document.open` corrupt the §11 gap distribution with one-action sessions.
 */
export function openSession(
  input: { id: string; documentId: string; anchorId?: string | null; profile?: FlowProfile },
  now: number,
): FlowSession {
  const profile = input.profile ?? FLOW;
  return {
    id: input.id,
    documentId: input.documentId,
    scope: 'document',
    openedAt: now,
    lastActivityAt: now,
    gapDeadlineTs: now + profile.sessionGapMs,
    closedAt: null,
    closeReason: null,
    anchors: input.anchorId ? [input.anchorId] : [],
    learnerTurns: [],
    lastHandOffAt: null,
    declines: 0,
    cooldownUntil: null,
    profile,
  };
}

export interface ActivityInput {
  /** A learner turn counts toward k; a keystroke, split or Ask only pushes the gap clock. */
  kind: 'turn' | 'keystroke' | 'split' | 'ask' | 'whisper' | 'scroll';
  anchorId?: string | null;
}

/**
 * Records learner activity and pushes the close deadline out.
 *
 * *Activity* is the `timer.ts` definition inherited verbatim (§8.1, `design-brief.md` §D3):
 * **keystrokes in any composer** as well as turns, splits and page changes. Typing pauses the
 * gap clock — which is the whole reason the silence timer treats keystrokes rather than
 * messages as activity, and the flow rule must inherit it or it will close a session on a
 * learner who is mid-sentence.
 *
 * Pure: returns a new session, never mutates.
 */
export function noteActivity(session: FlowSession, input: ActivityInput, now: number): FlowSession {
  if (session.closedAt !== null) return session;
  const anchors =
    input.anchorId && !session.anchors.includes(input.anchorId)
      ? [...session.anchors, input.anchorId]
      : session.anchors;
  const learnerTurns =
    input.kind === 'turn' ? prune([...session.learnerTurns, now], now, session.profile) : session.learnerTurns;
  return {
    ...session,
    lastActivityAt: now,
    gapDeadlineTs: now + session.profile.sessionGapMs,
    anchors,
    learnerTurns,
  };
}

/** Drop turn timestamps that can never matter again, so the array does not grow unbounded. */
function prune(turns: number[], now: number, profile: FlowProfile): number[] {
  const floor = now - profile.windowMs;
  return turns.filter((t) => t >= floor);
}

/** True when the gap has elapsed. Compared against wall-clock, so sleep is handled for free. */
export function sessionExpired(session: FlowSession, now: number): boolean {
  return session.closedAt === null && now >= session.gapDeadlineTs;
}

export function closeSession(session: FlowSession, now: number, reason: CloseReason): FlowSession {
  if (session.closedAt !== null) return session;
  // A gap close happened *at the deadline*, not when the tick noticed. After sleep or relaunch
  // the tick can be minutes late and the stored close time must still be the truth.
  const closedAt = reason === 'gap' ? Math.min(now, session.gapDeadlineTs) : now;
  return { ...session, closedAt, closeReason: reason };
}

/**
 * The 1 s tick, `timer.ts`-shaped: closes the session if the absolute deadline has passed.
 * Idempotent, so running the recovery pass twice is harmless.
 */
export function tickSession(session: FlowSession, now: number): FlowSession {
  return sessionExpired(session, now) ? closeSession(session, now, 'gap') : session;
}

/**
 * Returning **inside** the gap re-enters the open session — no greeting, no recap, nothing
 * changes. Returning **after** it opens a new one (§8.1). The asymmetry is the point: a
 * 90-second coffee break must cost the learner nothing.
 */
export function resumeOrOpen(
  session: FlowSession | null,
  input: { id: string; documentId: string; anchorId?: string | null; profile?: FlowProfile },
  now: number,
): { session: FlowSession; resumed: boolean } {
  if (
    session &&
    session.closedAt === null &&
    session.documentId === input.documentId &&
    !sessionExpired(session, now)
  ) {
    return { session: noteActivity(session, { kind: 'turn', anchorId: input.anchorId }, now), resumed: true };
  }
  return { session: openSession(input, now), resumed: false };
}

// ── the taught set and its decay ────────────────────────────────────────────

/**
 * One thing the Teacher explained, or the learner evidenced, at a moment in time.
 *
 * `taught_at` is **derivable, not a new column** (§10): the ledger already stores
 * `evidence_msg_id` per element and message rows carry timestamps. A re-teach **appends** a
 * second item rather than resetting the first (§12 q. 7 — the cost is one row, and it lets a
 * later analysis fit a real spacing curve); `quizzable` uses the most recent.
 */
export interface TaughtItem {
  elementId: string;
  taughtAt: number;
  /** Which flow session taught it. The horizon is session-scoped, not age-scoped (§8.3). */
  sessionId?: string;
  /** 'teacher' = Ellie explained it; 'learner' = the learner's own words evidenced it. */
  by: 'teacher' | 'learner';
  /** Short label for the hand-off line. */
  label?: string;
  /**
   * The objective's deck order (issue #38 §2), when this element came from a learning-objective
   * tree. Used only to break a tie in `pickTarget`; absent for a pack that has no tree behind it.
   */
  order?: number;
}

export function recordTaught(taught: readonly TaughtItem[], item: TaughtItem): TaughtItem[] {
  return [...taught, item];
}

/**
 * **A ranking weight, not a memory estimate** (`flow-session.md` §4, §8.3).
 *
 * Issue #33 proposed a 2-hour half-life and used it to *exclude* stale items. The brief kills
 * that: no evidence supports a 2 h half-life for conceptual material — even nonsense syllables
 * retain 0.276 savings at 9 h (Murre & Dros 2015), and meaningful prose has a half-life in days.
 * What survives is the *shape*: exponential-in-time with a fitted half-life is shipped practice
 * (Settles & Meeder 2016, half-life regression).
 *
 * So this returns a number in (0, 1] used **only to order candidates**. It never excludes one —
 * `quizzable` does not filter on it, and there is deliberately no freshness floor to tune.
 */
export function recency(item: TaughtItem, now: number, profile: FlowProfile = FLOW): number {
  const age = Math.max(0, now - item.taughtAt);
  return Math.pow(2, -age / profile.recencyHalfLifeMs);
}

/**
 * The quizzable window: **the open session, plus the immediately preceding session if it closed
 * less than `horizonMs` ago** (§8.3).
 *
 * This is a *conversational-context* bound, not a decay constant — it encodes "a user is not
 * expected to remember a **convo** more than 6 hours old". Memory would permit days, so
 * ChatterED deliberately under-quizzes; say so in the report as a limitation.
 *
 * When an item carries no `sessionId` (a historical row, or a caller that has not wired sessions
 * yet) the bound falls back to plain age, which is the same 6 h from the other side.
 */
export interface HorizonContext {
  currentSessionId: string | null;
  /** The session immediately before the open one, if there was one. */
  previousSession: { id: string; closedAt: number } | null;
}

export function insideHorizon(
  item: TaughtItem,
  now: number,
  ctx: HorizonContext,
  profile: FlowProfile = FLOW,
): boolean {
  if (item.sessionId === undefined) return now - item.taughtAt <= profile.horizonMs;
  if (ctx.currentSessionId !== null && item.sessionId === ctx.currentSessionId) return true;
  const prev = ctx.previousSession;
  if (prev && item.sessionId === prev.id) return now - prev.closedAt < profile.horizonMs;
  return false;
}

/** The most recent teaching of each element (§12 q. 7: append, use the latest for the window). */
export function latestByElement(taught: readonly TaughtItem[]): TaughtItem[] {
  const latest = new Map<string, TaughtItem>();
  for (const item of taught) {
    const seen = latest.get(item.elementId);
    if (!seen || item.taughtAt > seen.taughtAt) latest.set(item.elementId, item);
  }
  return [...latest.values()].sort((a, b) => b.taughtAt - a.taughtAt);
}

export interface QuizzableItem extends TaughtItem {
  ageMs: number;
  /** The ranking weight. Ordering only — nothing is excluded for being stale (§4). */
  recency: number;
}

/** Level 3 is `defended` — it survived a Tester probe (`ledger.ts`'s fifth gate). */
const DEFENDED_LEVEL = 3;

/**
 * The elements the Tester may ask about *now*: older than `minAgeMs` and inside the horizon.
 * Sorted by the recency weight, freshest first.
 *
 * Note what is **not** here: no freshness floor. The brief's correction is that decay may order
 * candidates and may never remove one (§8.3), so the only two gates are the UI guard and the
 * conversational-context window.
 */
export function quizzable(
  taught: readonly TaughtItem[],
  now: number,
  profile: FlowProfile = FLOW,
  ctx: HorizonContext = { currentSessionId: null, previousSession: null },
): QuizzableItem[] {
  return latestByElement(taught)
    .map((item) => ({ ...item, ageMs: now - item.taughtAt, recency: recency(item, now, profile) }))
    .filter((item) => item.ageMs >= profile.minAgeMs)
    .filter((item) => insideHorizon(item, now, ctx, profile))
    .sort((a, b) => b.recency - a.recency);
}

/**
 * Which element the Tester picks: **highest recency weight × lowest ledger level** (§8.2) — the thing
 * most recently taught that the learner has least demonstrated. This reuses the existing
 * target-selection idea (`progress-tracking.md` §5) rather than adding a second policy.
 *
 * Two clauses added with the learning-objective tree (issue #38 §4: the Tester quizzes objectives
 * that are "taught and not yet defended, preferring `order`"):
 *
 *  - **A defended objective is not quizzed while an undefended one is available.** The old score
 *    only *deprioritised* it — 1/(1+3) is small but not zero — so a freshly re-taught level-3
 *    node could still outrank an untouched one, and the learner would be asked again about the
 *    one thing they had already survived a probe on. It is still the fallback when everything
 *    quizzable is defended, because a Tester with nothing to ask is worse than a repeat.
 *  - **`order` breaks a tie**, so two nodes taught in the same breath are quizzed in the deck's
 *    own sequence rather than in map-iteration order.
 */
export function pickTarget(
  items: readonly QuizzableItem[],
  ledgerLevels: Readonly<Record<string, number>> = {},
): QuizzableItem | null {
  const level = (item: QuizzableItem): number => ledgerLevels[item.elementId] ?? 0;
  const undefended = items.filter((item) => level(item) < DEFENDED_LEVEL);
  const pool = undefended.length > 0 ? undefended : items;
  let best: QuizzableItem | null = null;
  let bestScore = -Infinity;
  for (const item of pool) {
    const score = item.recency * (1 / (1 + level(item)));
    if (score > bestScore) {
      bestScore = score;
      best = item;
      continue;
    }
    // A tie on the weight is common: two things taught in the same turn have the same age.
    if (score === bestScore && best !== null && (item.order ?? Infinity) < (best.order ?? Infinity)) {
      best = item;
    }
  }
  return best;
}

// ── "ready to be quizzed" ───────────────────────────────────────────────────

/**
 * The learner's control over the Tester, named for **what Koala actually shipped** (§7).
 *
 * #33 proposed a "quiet / normal / eager" slider. Houde et al. did not ship a slider: Koala II
 * scored each candidate reply 0–100 for its value as a contribution and posted only above a
 * **threshold**, exposed as high = 90 / medium = 75 / low = 50 (§5, Fig. 5b), **plus a separate
 * proactive/reactive toggle** where reactive *"only replied to users when directly addressed"*
 * (Fig. 5a). So ChatterED has the same two controls, and the names say so.
 */
export type TesterMode = 'proactive' | 'reactive';

/** The threshold's three exposed levels, Koala's own labels. */
export type HandOffThreshold = 'high' | 'medium' | 'low';

/**
 * The threshold is implemented as the **R1–R3 thresholds themselves, not as three prompts**
 * (§7). `medium` is `FLOW` unchanged; `high` demands more of the engagement and coverage rules
 * before the Tester may be offered the floor, `low` demands less.
 */
export const THRESHOLDS: Record<HandOffThreshold, Pick<FlowProfile, 'turnsK' | 'minTaught'>> = {
  high: { turnsK: 5, minTaught: 3 },
  medium: { turnsK: FLOW.turnsK, minTaught: FLOW.minTaught },
  low: { turnsK: 2, minTaught: 2 },
};

export function withThreshold(profile: FlowProfile, threshold: HandOffThreshold): FlowProfile {
  return { ...profile, ...THRESHOLDS[threshold] };
}

export interface HandOffInput {
  session: FlowSession | null;
  taught: readonly TaughtItem[];
  /** R4: an unanswered Teacher question is an open floor; quizzing into it is a dog-pile. */
  pendingTeacherQuestion: boolean;
  /** R4: a silence-timer window is open, i.e. the learner has already gone quiet. */
  silenceWindowOpen: boolean;
  /** R4: a whisper popover is open. */
  whisperOpen: boolean;
  /**
   * R4 (and Track C's property 4): a REFERENCE answer is on screen that the learner has not
   * pressed "Explain it back" on. Neither Ellie nor Max may post into that thread at all, so a
   * hand-off is doubly wrong there.
   */
  referenceLocked?: boolean;
  /** Last keystroke in any composer, or null if the composer has never been touched. */
  lastKeystrokeAt?: number | null;
  /** Ledger level per element, for `pickTarget`. */
  ledgerLevels?: Readonly<Record<string, number>>;
  /** Koala's proactive/reactive toggle. Reactive = the Tester speaks only when invoked. */
  mode?: TesterMode;
  /** Session horizon context. Omitted callers fall back to the plain 6 h age bound. */
  horizon?: HorizonContext;
}

export type HandOffReason =
  | 'no_session'
  | 'session_closed'
  | 'mode_reactive'
  | 'cooldown'
  | 'declines_exhausted'
  | 'r1_engagement'
  /** Demo only: k turns have passed in the window, but not since the last hand-off. */
  | 'r1_since_handoff'
  | 'r2_coverage'
  | 'r3_maturity'
  | 'r4_floor_not_clear';

export interface HandOffVerdict {
  due: boolean;
  /** Which conditions failed. Logged raw as §11's `flow.state.changed.reasons[]`. */
  reasons: HandOffReason[];
  /** Everything quizzable now, with raw ages and weights (§11 `tester.handoff.offered`). */
  candidates: QuizzableItem[];
  target: QuizzableItem | null;
  /** Raw inputs, logged so A2 can recompute any (k, m) pair offline (§11 rule 1). */
  learnerTurnsInWindow: number;
  /** Turns since the last hand-off, or since the session opened if there has not been one. */
  learnerTurnsSinceHandOff: number;
  youngestQuizzableAgeMs: number | null;
}

/**
 * **Ready to be quizzed** — a conjunction of four conditions, all evaluated on each learner
 * turn (`flow-session.md` §8.2), plus the learner's rate control (§7).
 *
 *   R1 engagement — ≥ k learner turns in the last m minutes, and — **on the Demo profile only**
 *                   (R1b, `requiresTurnsSinceHandOff`) — ≥ k of them since the last hand-off.
 *   R2 coverage   — ≥ 2 elements quizzable, so the Tester can ask the learner to *relate*
 *                   things, which is what the ledger's levels 2–4 score.
 *   R3 maturity   — the youngest quizzable element is older than MIN_AGE.
 *   R4 clear floor — no unanswered Teacher question, no silence window, no whisper open,
 *                   composer idle ≥ 3 s, and no locked REFERENCE thread.
 *
 * The verdict carries `reasons[]` and the raw counts, never just the boolean: §11 rule 1 is
 * that a log recording "ready = true" without its inputs cannot retune anything.
 */
export function handOffDue(input: HandOffInput, now: number): HandOffVerdict {
  const session = input.session;
  const profile = session?.profile ?? FLOW;
  const reasons: HandOffReason[] = [];

  const candidates = quizzable(
    input.taught,
    now,
    profile,
    input.horizon ?? { currentSessionId: session?.id ?? null, previousSession: null },
  );
  const youngest = candidates.length > 0 ? Math.min(...candidates.map((c) => c.ageMs)) : null;
  const turnsInWindow = session ? session.learnerTurns.filter((t) => t > now - profile.windowMs) : [];
  // Strictly after: the hand-off fires *on* a learner turn, and that turn is already recorded by
  // the time the verdict is taken, so counting it would give the next one a free ride.
  const since = session?.lastHandOffAt ?? null;
  const turnsSinceHandOff = since === null ? turnsInWindow.length : turnsInWindow.filter((t) => t > since).length;

  const verdict = (due: boolean): HandOffVerdict => ({
    due,
    reasons,
    candidates,
    target: due ? pickTarget(candidates, input.ledgerLevels) : null,
    learnerTurnsInWindow: turnsInWindow.length,
    learnerTurnsSinceHandOff: turnsSinceHandOff,
    youngestQuizzableAgeMs: youngest,
  });

  if (!session) {
    reasons.push('no_session');
    return verdict(false);
  }
  if (session.closedAt !== null || sessionExpired(session, now)) {
    reasons.push('session_closed');
    return verdict(false);
  }
  // Koala's proactive/reactive toggle (§7): reactive means the Tester speaks only when invoked.
  if (input.mode === 'reactive') reasons.push('mode_reactive');
  // Three declines in one session drop the Tester to reactive for the rest of it, and say so
  // once. The Koala control expressed as behaviour rather than as a settings panel (§8.2).
  if (session.declines >= profile.declineLimit) reasons.push('declines_exhausted');
  if (session.cooldownUntil !== null && now < session.cooldownUntil) reasons.push('cooldown');

  if (turnsInWindow.length < profile.turnsK) reasons.push('r1_engagement');
  // R1b. Separate reason, never folded into r1_engagement: §11 rule 1 is that the log must say
  // *which* condition was binding, and this one is the difference between a cold and a warm run.
  if (requiresTurnsSinceHandOff(profile) && turnsSinceHandOff < profile.turnsK) {
    reasons.push('r1_since_handoff');
  }
  if (candidates.length < profile.minTaught) reasons.push('r2_coverage');
  // R3 is implied by `quizzable`'s own minAge filter; it is checked separately so the log can
  // say *which* condition was binding rather than collapsing two failures into one.
  if (youngest === null || youngest < profile.minAgeMs) reasons.push('r3_maturity');

  const keystrokeFresh =
    input.lastKeystrokeAt !== null &&
    input.lastKeystrokeAt !== undefined &&
    now - input.lastKeystrokeAt < profile.composerIdleMs;
  if (
    input.pendingTeacherQuestion ||
    input.silenceWindowOpen ||
    input.whisperOpen ||
    input.referenceLocked === true ||
    keystrokeFresh
  ) {
    reasons.push('r4_floor_not_clear');
  }

  return verdict(reasons.length === 0);
}

/**
 * Records that the Tester has just been handed the floor. Called by the actor at the moment it
 * posts the Teacher's `handOffLine()`, so R1b counts from the line the learner actually saw.
 */
export function noteHandOff(session: FlowSession, now: number): FlowSession {
  return { ...session, lastHandOffAt: now };
}

/**
 * The hand-off is an **offer, not an event** (§8.2). Declining sets a cool-down of one full `m`
 * window before R1 can hold again, and is logged; the third decline drops the Tester to
 * reactive for the rest of the session.
 */
export function declineHandOff(session: FlowSession, now: number): FlowSession {
  return {
    ...session,
    declines: session.declines + 1,
    cooldownUntil: now + session.profile.windowMs,
  };
}

/**
 * The Teacher's hand-off line, **built by the rules and not by the model**
 * (`flow-build-plan.md` §4.2, video beat 10: *"that hand-off is a rule I can see and turn down,
 * not a model's whim"*). A model-authored hand-off could not be shown to fire on the rule.
 */
export function handOffLine(
  roster: readonly AgentProfile[],
  candidates: readonly QuizzableItem[],
  labelFor: (elementId: string) => string = (id) => id,
): string {
  // The **live** roster, not two name arguments a caller could hand over in the wrong order:
  // this line is spoken by the Teacher and names the Tester, and an install that got the
  // pairing backwards used to make Ellie say "Ellie, over to you" (#32, `agents.ts`).
  const names = candidates.slice(0, 2).map((c) => c.label ?? labelFor(c.elementId));
  const covered =
    names.length >= 2 ? `${names[0]} and ${names[1]}` : (names[0] ?? 'a couple of things');
  return `You've covered ${covered} — ${testerName(roster)}, over to you.`;
}

// ── feedback after every quiz answer (the brief's strongest constraint) ─────

/**
 * An outstanding Tester question and what has happened to it.
 *
 * This exists because **feedback after a quiz answer is mandatory, not optional**
 * (`flow-session.md` §3, §8.3): Rowland 2014's meta-analysis gives g = 0.73 for retrieval
 * practice with feedback against 0.39 without — the single best-evidenced number in the brief,
 * and one issue #33 does not mention. A Tester that asks a question, hears an answer and moves
 * on discards roughly half the effect it was built for.
 *
 * It is therefore encoded as a **rule** (`orchestrator.ts` consults `feedbackDue` before the
 * model is asked anything) rather than as a sentence in the Tester's prompt, for exactly the
 * reason `ledger.ts` gives about its own four rules: a prompt asking nicely will be violated.
 */
/**
 * **The state model, since the attempt loop** (issue #47, `attempt-first.md` §2.3–§2.4).
 *
 * The question does not close when it is answered, and that is the whole of the change. §2.4 gives
 * the learner three things to do *after* feedback — try another, ask a clarification, or ask for
 * the answer — and every one of them needs the question still to be here. So:
 *
 *  - `attempts` counts learner turns classified as an **attempt** (`core/attempt.ts`), and nothing
 *    else. It is what the answer lock reads: zero means the answer is withheld, one or more means
 *    "Show the answer" is available and an answer request is honoured.
 *  - `feedbackGiven` is **per latest attempt**. A second attempt clears it, so Rowland 2014's
 *    mandatory-feedback rule (`feedbackDue`) applies to every attempt rather than to the first.
 *  - `answerShown` is the one thing that closes the question (`quizOpen`). Otherwise it closes
 *    only when a new question opens over it, or when the sitting closes (`expireQuizOnClose`).
 *
 * `feedbackDue` is unchanged in meaning: true after an attempt, until the feedback turn lands.
 */
export interface PendingQuiz {
  /** The Tester message that asked it. */
  quizMessageId: string;
  elementId: string;
  askedAt: number;
  /** The learner message that answered it, once there is one. */
  answerMessageId: string | null;
  /**
   * **The text of that answer** (migration 022, `measurement.md` M3). Carried on the question so
   * the verdict turn can measure how much of the answer was the learner's own words without a
   * round trip to the message store mid-turn. Absent in rows persisted before 022.
   */
  answerText?: string | null;
  /** The text of the question itself, for the same measure's `question` share. */
  questionText?: string | null;
  /** Ellie's cue text, once one has been given, for the `cue` share. The echo guard. */
  cueText?: string | null;
  /** Set once the Tester's follow-up turn has actually delivered feedback. */
  feedbackGiven: boolean;
  /**
   * Learner turns classified as an attempt since this question was asked (§2.2). Absent in rows
   * persisted before #47, which `openQuiz` and the actor's restore both read as 0.
   *
   * **It no longer gates anything** (#48, `collab-doc.md` §4.4: the answer is released on any
   * give-up, with or without an attempt). It survives as *data*: the release turn says what the
   * attempt already had of the answer, and `pitchInputs` reads the verdicts it produced.
   */
  attempts: number;
  /** True once the model answer has been given (§2.3's `rule:answer_shown`). Closes the quiz. */
  answerShown: boolean;
  /**
   * **What the last feedback turn said about the last attempt** (§2.4, second cut). `complete` when
   * it opened *"Well done."*, `partial` otherwise — in which case the feedback ended on a follow-up
   * question and the composer is asking for the next attempt. `null` (or absent, in rows persisted
   * before this) until feedback has landed on the latest attempt.
   *
   * Two-valued for the composer, which only ever needed "done" or "try again". The three-valued
   * verdict the outcome ledger records is `verdict3` below — see `feedbackVerdict3`.
   */
  verdict?: QuizVerdict | null;
  /**
   * **The three-valued verdict** (#48, brief §4.2: `Well done.` / `Partly there.` / `Not yet.`).
   * `QuizVerdict` collapses the last two because the composer's copy is the same for both; the
   * progress bar cannot, because *Partly there* half-fills an objective and *Not yet* fills
   * nothing (brief §6). Written on every feedback turn, alongside `verdict`.
   */
  verdict3?: QuizVerdict3 | null;

  // ── the collab doc's additions (#48) ────────────────────────────────────

  /**
   * **The question's own id**, minted when it is asked. It is the `q_block`'s `questionId` in the
   * doc (brief §5.2) and the key the outcome rows are filed under — which is why it is stored
   * rather than derived from the message id: the Q block outlives the message row's thread, and
   * `resolve_q` has to be able to find it after a relaunch.
   */
  questionId?: string;
  /** The objective the question is about, when the pack came from a learning-objective tree. */
  objectiveId?: string | null;
  /**
   * The thread the question was asked in (`messages.anchor_id`). Read off the Tester's row by
   * `#anchorOfQuiz` as before; carried here too so a question can be resolved by `closeOpenQuestion`
   * after the row's thread has gone out of view.
   */
  anchorId?: string | null;
  /**
   * **Ellie's cue fires once per question** (brief §4.3). The timestamp it fired at, or null/absent
   * while it has not. `silenceDecision` reads it, which is what makes "once" a fact about the
   * question rather than about the timer's fire count.
   */
  cueGivenAt?: number | null;
  /**
   * **Did the cue contain a plausible student mistake, and what was the claim?** (brief §4.7's
   * second invariant, architect §E6.) The cue is a *structured* call, so these are facts the
   * closure rule can check rather than prose a model was asked to self-report in. The resolving
   * Max turn — feedback, release or closure — must correct `cueClaim` explicitly when
   * `cueHasMistake` is true.
   */
  cueHasMistake?: boolean;
  cueClaim?: string | null;
  /**
   * **How the answer came out**, once it has. `give_up` is a learner phrase (§4.4), `pass` is the
   * **Pass** control on the open question, `closure` is the flow session going idle or the file
   * closing with the question still open (§4.7). Null while the question is live or was resolved
   * by the learner's own correct answer.
   */
  releasedBy?: 'give_up' | 'pass' | 'closure' | null;
  /**
   * **Some attempt at it was marked *Partly there*** (#49). `verdict3` is only the *latest*
   * verdict, so a *Partly there* followed by a *Not yet* and a give-up would read as nothing of
   * theirs; brief §5.3's *partly yours* is about the question as a whole, so it is remembered here.
   */
  hadPartial?: boolean;
  /**
   * **The doc's Q block has been resolved** (#49). Set when the §5.3 edit is emitted, and kept
   * with the question so a feedback turn that lands after a release — or after a relaunch — does
   * not write a second resolution under it. The 2026-09-20 to 09-23 runs wrote 17 of them under 5
   * questions.
   */
  resolvedInDoc?: boolean;
  /**
   * **A fill-in-the-blank** (brief §4.5, amended 2026-10-01): the easier question after a release.
   * Read off the question Max actually wrote (`core/pitch.questionForm`). Its verdicts are
   * recorded with the form, so they fill no progress, and the ledger is not run on its one-word
   * answer. Absent on every question asked before this build, which were all `open`.
   */
  form?: QuestionForm;
}

/**
 * **The verdict, read off the feedback turn's first line** (§2.4, second cut).
 *
 * Lucas's 2026-09-19 run on the MDP deck: a fully correct answer got a paragraph that opened *"All
 * four properties correctly named"* and went on to *"What's missing: …"* about parts of the objective
 * the question had not asked for, and a hedged second answer got a clarification. After both he did
 * not know whether he had answered. So the feedback turn now **opens with one of three fixed
 * verdicts** (`VERDICT_OPENERS`, required by `prompts.quizBlock`), and — unless it is *Well done* —
 * **ends on one follow-up question** aimed at the gap, so a second attempt is invited rather than
 * left to be guessed at. The opener is the one thing code reads off the turn: it decides the
 * composer's placeholder and note, nothing about the ledger, and a turn that opens with none of the
 * three is read as `partial`, which is the safe side (it asks for another try rather than declaring
 * one done).
 */
export type QuizVerdict = 'complete' | 'partial';

/** The three openers, in the prompt's own words. `Well done.` is the only `complete`. */
export const VERDICT_OPENERS = ['Well done.', 'Partly there.', 'Not yet.'] as const;

/** The first line, normalised once: emphasis, a bold marker or a quote character all survive. */
function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.replace(/^[\s*_>“"'`]+/, '').toLowerCase() ?? '';
}

export function feedbackVerdict(text: string): QuizVerdict {
  return firstLine(text).startsWith('well done') ? 'complete' : 'partial';
}

/**
 * **The three-valued verdict** (#48, brief §4.2 and §6).
 *
 * `feedbackVerdict` answers the composer's question — try again, or done — and collapses *Partly
 * there* with *Not yet* because the copy is the same for both. The progress bar's question is
 * different: *Partly there* half-fills an objective and *Not yet* fills nothing, so it needs all
 * three. **A missing opener is `partial`**, unchanged and for the unchanged reason: it is the safe
 * side, because it asks for another try rather than declaring one done — and on the fill it is the
 * conservative half-mark rather than a completion the learner has not earned.
 */
export function feedbackVerdict3(text: string): QuizVerdict3 {
  const first = firstLine(text);
  if (first.startsWith('well done')) return 'complete';
  if (first.startsWith('not yet')) return 'not_yet';
  return 'partial';
}

/**
 * **The model's one non-verdict exit** (#49 fallback, `collab-doc.md` §4.2, 2026-09-25).
 *
 * `attempt.ts` decides in code what counts as an attempt, and it is a heuristic: the 2026-09-23
 * run's *"Can you give me example of how SAT instances are encoded… I am not familiar with SAT
 * format"* reached the feedback turn, and the model, which could see it was a request for
 * background, had no legal first line but a verdict — so it wrote *Not yet*. The feedback prompt
 * now allows one more opener, `Not marked.`, for a turn that asks for something and offers no
 * answer; Max gives the background and re-asks. Code reads it here and **un-counts the attempt**:
 * no outcome row, no progress, nothing to the notes, and the question stays open.
 */
export const UNMARKED_OPENER = 'Not marked.';

export function feedbackUnmarked(text: string): boolean {
  return firstLine(text).startsWith('not marked');
}

/**
 * The feedback turn said `Not marked.`: put the question back as it was before the turn that was
 * counted. `before` is what `answerQuiz` overwrote, when the caller kept it; without it the count
 * still comes down, and a question with no attempt left has no answer on it either.
 */
export function unmarkAttempt(
  quiz: PendingQuiz,
  before: Pick<PendingQuiz, 'answerMessageId' | 'answerText' | 'feedbackGiven' | 'verdict'> | null = null,
): PendingQuiz {
  const attempts = Math.max(0, attemptsOf(quiz) - 1);
  if (before !== null) return { ...quiz, ...before, attempts };
  const v3 = verdict3Of(quiz);
  return {
    ...quiz,
    attempts,
    answerMessageId: attempts > 0 ? quiz.answerMessageId : null,
    answerText: null,
    // Nothing is owed: the turn that was counted has had its reply.
    feedbackGiven: attempts > 0,
    // `verdict3` survives `answerQuiz`, so the previous attempt's mark is still there to restore.
    verdict: attempts > 0 && (v3 === 'partial' || v3 === 'not_yet') ? 'partial' : null,
  };
}

export function verdictOf(quiz: PendingQuiz | null): QuizVerdict | null {
  return quiz?.verdict === 'complete' || quiz?.verdict === 'partial' ? quiz.verdict : null;
}

export function verdict3Of(quiz: PendingQuiz | null): QuizVerdict3 | null {
  const v = quiz?.verdict3;
  return v === 'complete' || v === 'partial' || v === 'not_yet' ? v : null;
}

export function openQuiz(
  input: {
    quizMessageId: string;
    elementId: string;
    /** #48: minted by the caller so the doc's Q block and the outcome rows share one id. */
    questionId?: string;
    objectiveId?: string | null;
    anchorId?: string | null;
    /** The words Max asked it in, for M3's `question` share (migration 022). */
    questionText?: string | null;
    /** `cloze` for a fill-in-the-blank (§4.5). Left out for an open question. */
    form?: QuestionForm;
  },
  now: number,
): PendingQuiz {
  return {
    ...input,
    askedAt: now,
    answerMessageId: null,
    answerText: null,
    cueText: null,
    feedbackGiven: false,
    attempts: 0,
    answerShown: false,
    verdict: null,
    verdict3: null,
    cueGivenAt: null,
    cueHasMistake: false,
    cueClaim: null,
    releasedBy: null,
    hadPartial: false,
    resolvedInDoc: false,
  };
}

/**
 * A learner turn landed on the open question.
 *
 * **Only an attempt counts** (§2.3): an answer request, a clarification or an "ok" leaves the
 * count where it is, which is what makes "no answer before one attempt" a fact about the learner
 * having tried rather than about them having typed. An attempt also re-opens the feedback debt,
 * because a revision the Tester never answers is the half of retrieval practice Rowland measures.
 */
export function answerQuiz(
  quiz: PendingQuiz,
  answerMessageId: string,
  opts: { attempt: boolean; text?: string },
): PendingQuiz {
  if (!opts.attempt) return quiz;
  /**
   * **A closed question takes no further attempt** (#49; brief §5.3, *"a question resolves once"*).
   * After a release or a *Well done* the learner's next turn is a new turn, not a revision: it used
   * to re-open the feedback debt here, so Max marked the closed question again and the extra
   * verdicts filled an objective.
   */
  if (!quizOpen(quiz)) return quiz;
  return {
    ...quiz,
    answerMessageId,
    // The text of *this* attempt, replacing the previous one: the verdict about to land is about
    // what was just written, and a revision measured against the first attempt's words would
    // report the wrong overlap for the turn it is filed under.
    answerText: opts.text ?? null,
    feedbackGiven: false,
    attempts: attemptsOf(quiz) + 1,
    // A new attempt is unmarked until its own feedback lands.
    verdict: null,
  };
}

/**
 * The feedback turn landed. `verdict` is what its first line said (`feedbackVerdict`); a caller
 * without the text — the older tests, a restore — leaves it `null`, and the composer then treats
 * the question as answered but unmarked, offering *Try another* and nothing stronger.
 */
export function markFeedbackGiven(
  quiz: PendingQuiz,
  verdict: QuizVerdict | null = null,
  /** #48: the three-valued verdict, for the outcome row and the progress fill. */
  verdict3: QuizVerdict3 | null = null,
): PendingQuiz {
  return { ...quiz, feedbackGiven: true, verdict, verdict3, hadPartial: quiz.hadPartial === true || verdict3 === 'partial' };
}

/**
 * The answer has been given. The question is closed; nothing about it moves the ledger.
 *
 * `releasedBy` (#48, brief §4.4 and §4.7) says which of the three doors it came out of, and is
 * what `resolve_q` writes as the Q block's resolution tag. `null` is the pre-#48 caller and the
 * one case that is not a release at all — a question closed by a new one taking its place.
 */
export function markAnswerShown(
  quiz: PendingQuiz,
  releasedBy: 'give_up' | 'pass' | 'closure' | null = null,
): PendingQuiz {
  return { ...quiz, answerShown: true, releasedBy };
}

/**
 * **Ellie's cue fired** (brief §4.3), with what the structured call reported about it.
 *
 * Recorded on the question rather than on the timer, because "once per question" is the rule §4.3
 * states and a question outlives any one silence window — and because §4.7's second invariant
 * (*"no mistake Ellie made is left uncorrected"*) needs the claim to still be here when the
 * question is resolved, however long after.
 */
export function markCueGiven(
  quiz: PendingQuiz,
  input: { at: number; hasMistake: boolean; claim: string | null; text?: string },
): PendingQuiz {
  return {
    ...quiz,
    cueGivenAt: input.at,
    cueHasMistake: input.hasMistake,
    cueClaim: input.claim,
    // Kept for the echo guard (M3's `cue` share). The claim alone is not enough: a learner can
    // restate the whole of Ellie's take without repeating the one sentence she flagged.
    cueText: input.text ?? null,
  };
}

/** True once Ellie's peer cue has been given on this question. Tolerates a pre-#48 row. */
export function cueGiven(quiz: PendingQuiz | null): boolean {
  return typeof quiz?.cueGivenAt === 'number' && Number.isFinite(quiz.cueGivenAt);
}

/**
 * **An uncorrected Ellie mistake** (brief §4.7). True when the cue carried one and the question is
 * still open, which is the condition the resolving Max turn's directive has to carry. It is read
 * by the actor when it builds the directive, and asserted in a test — the invariant is "the
 * resolving turn corrects it", and the only thing code can enforce is that it was *asked to*.
 */
export function cueMistakeToCorrect(quiz: PendingQuiz | null): string | null {
  if (!quiz || quiz.cueHasMistake !== true) return null;
  const claim = quiz.cueClaim;
  return typeof claim === 'string' && claim.trim().length > 0 ? claim.trim() : null;
}

/**
 * How the question ended, as the doc's Q block tags it (brief §5.3). **Null while it is open.**
 *
 * It used to answer *partly yours* as soon as any feedback had landed — while `quizOpen` still
 * said the question was open and Max's feedback was ending on a follow-up for the next try (#49).
 * The Q block was marked resolved mid-exchange and every attempt wrote another resolution under
 * it. A question ends in one of two ways: the learner's own *Well done*, or a release; and a
 * release after a *Partly there* is *partly yours*, which is what the brief's *"closed while
 * partial"* means.
 */
export function qResolutionOf(quiz: PendingQuiz | null): QResolution | null {
  if (!quiz) return null;
  if (verdict3Of(quiz) === 'complete' && quiz.feedbackGiven) return 'you_got_this';
  if (quiz.releasedBy === 'give_up' || quiz.releasedBy === 'pass' || quiz.releasedBy === 'closure') {
    return quiz.hadPartial === true || verdict3Of(quiz) === 'partial' ? 'partly_yours' : 'released';
  }
  return null;
}

/**
 * **Closure: no question Max asked is left without its answer** (brief §4.7).
 *
 * Pure, so the rule is testable without a room: given the open question and whether the session
 * has gone idle, does Max owe a release? `expireQuizOnClose` used to *expire* the question here
 * and log it as a debt avoided; the brief inverts that — an unanswered question is the debt, and
 * the app pays it rather than dropping it.
 */
export function closureDue(quiz: PendingQuiz | null): boolean {
  return quizOpen(quiz);
}

/** Tolerates a row persisted before #47, where the field did not exist. */
export function attemptsOf(quiz: PendingQuiz | null): number {
  return typeof quiz?.attempts === 'number' && Number.isFinite(quiz.attempts) ? quiz.attempts : 0;
}

export function answerShownOf(quiz: PendingQuiz | null): boolean {
  return quiz?.answerShown === true;
}

/**
 * **Is the Tester's question still live?** The gate on every rule in §2.3, and the reason the
 * quiz survives its own feedback turn: after feedback the learner may still try again, ask a
 * clarification, or ask for the answer, and all three need this to be true.
 *
 * **Except after a *Well done*.** `collab-doc.md` §4.2 gives feedback "a follow-up on the same
 * question **unless *Well done***", and §5.3 has the Q block resolve as *you got this* on exactly
 * that verdict — so the document already treats the question as finished. Until 20 Sep this
 * predicate did not, and the live run found what that costs: the learner got a *Well done*, asked
 * something new, and drew `rule:quiz_clarify` — Max answering as though the new question were a
 * query about his old one. Worse, `rule:max_followup` is gated on *no* question being open
 * (§4.2's "one open Max question at a time"), so after the first *Well done* of a sitting Max
 * could never ask again, and `closureDue` would eventually have him release the answer to a
 * question the learner had already got right.
 *
 * *Partly there* and *Not yet* are unchanged: those questions stay open, which is what the
 * follow-up on the same question and the "Your next attempt…" composer are for.
 */
export function quizOpen(quiz: PendingQuiz | null): boolean {
  return quiz !== null && !answerShownOf(quiz) && verdict3Of(quiz) !== 'complete';
}

/**
 * True when the Tester **owes** the learner feedback: it asked, the learner answered, and no
 * feedback turn has been delivered yet. While this is true the Tester's next turn is not a
 * choice the orchestrator's model gets to make.
 */
export function feedbackDue(quiz: PendingQuiz | null, profile: FlowProfile = FLOW): boolean {
  if (!profile.feedbackRequired) return false;
  // Nothing is owed on a closed question (#49): a release answers any unmarked attempt, and a
  // *Well done* is the last mark a question gets.
  return quizOpen(quiz) && quiz!.answerMessageId !== null && !quiz!.feedbackGiven;
}

/**
 * A quiz left unanswered when the session closes **expires, and is logged** (§12 q. 6). An
 * unanswered quiz that greets the learner next session is a debt, and `design-brief.md` §E's
 * psychological-safety goal argues against debts.
 *
 * **Superseded by `rule:closure`** (#48, brief §4.7): the debt is paid rather than dropped — Max
 * releases the answer, the Q block in the doc is resolved as *released*, and only then is the
 * question closed. The brief's reason is the one this function could not give: *"a learner must
 * never see a question they never get the answer to"*. It stays exported so a caller that has not
 * moved yet still compiles, and the actor no longer calls it.
 */
export function expireQuizOnClose(quiz: PendingQuiz | null): { expired: PendingQuiz | null } {
  return { expired: quiz && quiz.answerMessageId === null ? quiz : null };
}

/**
 * What closing a session actually does — exactly three things (§8.1): clear stored whisper
 * turns, expire any unanswered Tester question, stop the flow window.
 *
 * **It does not touch the ledger.** The ledger is cumulative and monotonic
 * (`progress-tracking.md` §4.4); decay governs what may be *asked*, never what has been
 * *achieved*. Returned as data so the caller does the I/O and this file stays pure.
 */
export interface CloseEffects {
  clearWhispers: true;
  expirePendingQuiz: true;
  stopFlowWindow: true;
  touchesLedger: false;
}

export const CLOSE_EFFECTS: CloseEffects = {
  clearWhispers: true,
  expirePendingQuiz: true,
  stopFlowWindow: true,
  touchesLedger: false,
};
