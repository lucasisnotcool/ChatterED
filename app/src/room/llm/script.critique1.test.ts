/**
 * **The attempt loop of the video, driven through the real machinery.**
 *
 * `flow-build-plan.md` §2 (re-cut for #47) and `attempt-first.md` §6: the script is not a
 * transcript player, so this file is not a snapshot of one. Two kinds of test, and the split is
 * deliberate:
 *
 *  - **The beats, checked as data.** Every cue the take produces resolves; every `p. N: "…"` in a
 *    feedback or answer beat is a **verbatim substring of the deck's own page text**; every ledger
 *    proposal's evidence is a verbatim substring of the line the presenter actually types; the
 *    word budgets of `attempt-first.md` §4 hold. These are the guarantees the *script* owes, and
 *    they hold without the actor — which matters while the actor side of the loop is being built.
 *  - **The ledger, through `ledger.ts` itself.** `applyLedgerRules` scores the take's own
 *    proposals against the take's own typed lines, so rule 1 (verbatim evidence), rule 3
 *    (confidence) and the `defended` gate are exercised on the real code rather than asserted
 *    about it.
 *  - **The secondary door, through the real actor.** The time-based hand-off is unchanged and now
 *    secondary (`attempt-first.md` §2.4), so it is still driven end to end here: `handOffDue()` on
 *    the shipped `DEMO` pacing, `orchestrator.ruleDecision`, the latency band, the roster filling,
 *    and the whisper scoping with its canary.
 *
 *  - **The take itself, through the real actor.** `tryHere`, the answer lock, `showAnswer` and the
 *    four rules of §2.3 landed while this was being written, so beats 5–13 are driven end to end at
 *    the bottom of this file. Two of them do not arrive yet, and both are pinned there as tests
 *    with the fix named: the rail does not move on an attempt (the ledger call carries the learner
 *    cue, not the turn cue), and an Ask into a card with an open question is given to the Tester.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../../shared/types.js';
import type { LlmRequest } from './types.js';
import { groupView } from '../../main/db/store.js';
import { FakeClock } from '../../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../../test-support/db.js';
import { RoomActor } from '../actor.js';
import { fillAgentNames, rosterFor } from '../agents.js';
import { buildGroupContext } from '../context.group.js';
import { BTW_SIDE_CHANNEL_V1, CRITIQUE1_DECK_TEXT, CRITIQUE1_PAGE_TEXT } from '../concepts/btw-side-channel-v1.js';
import { DEMO } from '../flow.js';
import { applyLedgerRules, type LedgerProposal } from '../ledger.js';
import type { LedgerRow } from '../records.js';
import { segmentContext } from '../reference.js';
import { ScriptedClient, ledgerFor } from './scripted.js';
import {
  CRITIQUE1_ATTEMPT_CUES,
  CRITIQUE1_BEATS,
  CRITIQUE1_LEARNER_LINES,
  CRITIQUE1_QUESTIONS,
  CRITIQUE1_QUIZ_TURNS,
  CRITIQUE1_SCRIPT,
  CRITIQUE1_SEGMENTS,
  CRITIQUE1_SPLIT,
  CRITIQUE1_WHISPERS,
  beatFor,
  critique1Sitting,
  learnerLine,
} from './script.critique1.js';
import { CRITIQUE1_FIXTURE, pickScriptName, scriptNameForRequest, SCRIPTS } from './scripts.js';

const FIXTURE_FILE = 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf';
/** Where the attempt loop starts: page 3, below the tick at y 0.535. */
const P3_LOWER = 'p3.lower';
/** Where its second question, and the Ask that interrupts it, land. */
const P5 = 'p5';

const ATTEMPT_1 = learnerLine('attempt:1')!;
const ASK_ANSWER = learnerLine('askanswer:2')!;
const ATTEMPT_2 = learnerLine('attempt:2')!;
const ASK = learnerLine('ask:1')!;
const WHISPER = learnerLine('whisper:1')!;
const WARMUP_1 = learnerLine('warmup:1')!;

/** Content words, the way `ledger.ts`'s rule 4 counts them. */
const words = (text: string): number => text.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;

/** Every `p. N: "…"` in a beat, as the renderer would show it. */
function grounds(text: string): { page: number; quote: string }[] {
  return [...text.matchAll(/p\. (\d+): "([^"]*)"/g)].map((m) => ({ page: Number(m[1]), quote: m[2]! }));
}

const beat = (cue: string): { cue: string; text: string } => {
  const found = beatFor(cue);
  expect(found, `no beat for ${cue}`).toBeDefined();
  return { cue: found!.cue, text: found!.text ?? '' };
};

// ── the cue contract ────────────────────────────────────────────────────────

/**
 * The names the actor side is being built to (`attempt-first.md` §2.1–§2.4, issue #47). N counts
 * the Tester's questions over the actor's lifetime, across **both** doors, so `try:1` and
 * `handoff:1` are alternative first questions and share `feedback:1`.
 */
const TAKE_CUES = [
  'try:1',
  'feedback:1',
  'try:2',
  'hint:2',
  'student:3',
  'feedback:2',
  'answer:2',
  'whisper:1',
  'summary:1',
] as const;

describe('the cue contract', () => {
  it('resolves every cue the take produces, and every cue the actor can run past', () => {
    for (const cue of ['try:1', 'try:2', 'handoff:1', 'handoff:2']) {
      expect(beatFor(cue)!.cue, cue).toBe(cue);
      expect(beatFor(cue)!.text!.length).toBeGreaterThan(40);
    }
    for (const cue of ['feedback:1', 'feedback:2', 'hint:1', 'hint:2', 'clarify:1', 'clarify:2', 'answer:1', 'answer:2']) {
      expect(beatFor(cue)!.cue, cue).toBe(cue);
      expect(beatFor(cue)!.text!.length).toBeGreaterThan(40);
    }
    // The actor's counters outlive the script: a second walkthrough in one process reaches these.
    expect(beat('try:3').cue).toBe('try:2');
    expect(beat('handoff:7').cue).toBe('handoff:2');
    expect(beat('feedback:9').cue).toBe('feedback:2');
    expect(beat('hint:4').cue).toBe('hint:2');
    expect(beat('clarify:4').cue).toBe('clarify:2');
    expect(beat('answer:4').cue).toBe('answer:2');
    // §5: the only silence the app fills is the one where the learner owes an answer, and the
    // turn that fills it is the Tester's hint. Stage 1 never reaches the script at all.
    expect(beat('silence:2').cue).toBe('hint:2');
    // And a cue from nowhere is still nothing — the room stays quiet rather than improvising.
    expect(beatFor('nonsense:1')).toBeUndefined();
    expect(beatFor('try:one')).toBeUndefined();
  });

  it('answers every `student:N` with the one explain beat, whatever ordinal the loop leaves it on', () => {
    // The Ask sits between `hint:2` and `attempt:2`, so its ordinal depends on how many learner
    // turns the attempt loop has taken — which is why there is exactly one beat to land on.
    const texts = new Set([1, 2, 3, 4, 9, 17].map((n) => beat(`student:${n}`).text));
    expect(texts.size).toBe(1);
    const explain = beatFor('student:3')!;
    expect(explain.segment).toBe(P5);
    expect(explain.text).toContain('strict subset');
    // Structural safety, not a convention: the beat any ordinal can reach proposes nothing, so an
    // unexpected ordinal can never score a turn the script was not written for.
    for (const n of [1, 2, 3, 4, 9, 17]) expect(beatFor(`student:${n}`)!.ledger?.elements ?? []).toHaveLength(0);
    // It must not answer the question on the floor, either: that is `rule:answer_withheld`'s job.
    expect(explain.text).not.toMatch(/todo|bug/i);
  });

  it('carries a beat for every cue in the take, in order', () => {
    for (const cue of TAKE_CUES) {
      if (cue === 'whisper:1' || cue === 'summary:1') continue;
      expect(beatFor(cue), cue).toBeDefined();
    }
    expect(CRITIQUE1_SCRIPT.whisperBeatFor('whisper:1')?.text).toBeTruthy();
    expect(CRITIQUE1_SCRIPT.referenceBeatFor('summary:1')?.text).toBeTruthy();
  });

  /**
   * The rules of §2.3 decide all four of these before any model or script is consulted, so the
   * `decision` on the beat is nominal — but it still has to name the move the rule will produce,
   * because `decisionFor` is what answers a run where the rule did *not* fire.
   */
  it('names the move each rule produces, and says in the beat that the decision is nominal', () => {
    const move = (cue: string): string => beatFor(cue)!.decision.move;
    expect(move('try:1')).toBe('quiz');
    expect(move('try:2')).toBe('quiz');
    expect(move('feedback:1')).toBe('quiz_feedback');
    expect(move('hint:2')).toBe('quiz_hint');
    expect(move('clarify:1')).toBe('quiz_clarify');
    expect(move('answer:2')).toBe('quiz_answer');
    for (const cue of ['try:1', 'try:2', 'feedback:1', 'feedback:2', 'hint:1', 'hint:2', 'answer:1', 'answer:2']) {
      expect(beatFor(cue)!.decision.rationale, cue).toMatch(/^Nominal: /);
      expect(beatFor(cue)!.decision.role, cue).toBe('challenger');
    }
  });
});

// ── the beats, as the camera will read them ─────────────────────────────────

describe('the questions', () => {
  it('asks exactly one question, on the objective the card teaches', () => {
    // `try:1` is on the objective `p3.lower` teaches — the whisper analogy, refs pages 3–4, pack
    // element C2 — and is built from that objective's two `quizSeeds`.
    const one = beatFor('try:1')!;
    expect(one.segment).toBe(P3_LOWER);
    expect(one.decision.targetElementId).toBe('C2');
    expect(one.text).toContain('page 3');
    expect(one.text).toContain('page 4');
    // `try:2` is on the objective still at ○ after `feedback:1`: page 5's three limit tests, C1.
    const two = beatFor('try:2')!;
    expect(two.segment).toBe(P5);
    expect(two.decision.targetElementId).toBe('C1');
    expect(two.text).toContain('Page 5');

    for (const q of CRITIQUE1_QUESTIONS) {
      expect(q.text!.split('?').length - 1, q.cue).toBe(1);
      // A question never proposes a ledger row, which is what makes repeating one safe.
      expect(q.ledger, q.cue).toBeUndefined();
    }
  });

  it('asks in the same order at both doors, so `feedback:N` fits either', () => {
    const at = (prefix: string, n: number) => beatFor(`${prefix}:${n}`)!.decision.targetElementId;
    expect([at('try', 1), at('handoff', 1)]).toEqual(['C2', 'C2']);
    expect([at('try', 2), at('handoff', 2)]).toEqual(['C1', 'C1']);
    expect(beatFor('feedback:1')!.decision.targetElementId).toBe('C2');
    expect(beatFor('feedback:2')!.decision.targetElementId).toBe('C1');
  });
});

describe('the feedback cites its grounds, and the grounds are the deck’s', () => {
  /**
   * `attempt-first.md` §3 asks the live backend for `p. N: "…"` and does **not** verify it —
   * "feedback grounds are asked for, not verified" is the stated limitation of the video. The
   * scripted path has no such excuse: if a beat misquotes the deck, the demo is telling exactly
   * the lie it is about (`findings.md` RQ4: 11 of 21 verdicts wrong, and the learner said "ok").
   */
  it('quotes the page verbatim, everywhere it claims to', () => {
    let checked = 0;
    for (const b of [...CRITIQUE1_BEATS, ...CRITIQUE1_QUESTIONS, ...CRITIQUE1_QUIZ_TURNS]) {
      for (const g of grounds(b.text ?? '')) {
        const page = CRITIQUE1_PAGE_TEXT[g.page];
        expect(page, `${b.cue} cites a page the deck does not have`).toBeDefined();
        expect(page, `${b.cue}: ${JSON.stringify(g.quote)} is not on page ${g.page}`).toContain(g.quote);
        checked += 1;
      }
    }
    // Not a vacuous pass: the four grounded beats carry ten quotes between them.
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('grounds both feedback turns and both answers, and only those', () => {
    for (const cue of ['feedback:1', 'feedback:2', 'answer:1', 'answer:2']) {
      expect(grounds(beat(cue).text).length, cue).toBeGreaterThanOrEqual(2);
    }
    // A hint that quotes the page's own sentence at the learner is half an answer, so it does not.
    for (const cue of ['hint:1', 'hint:2', 'clarify:1', 'clarify:2']) {
      expect(grounds(beat(cue).text), cue).toEqual([]);
    }
  });

  it('answers on the page the question is about', () => {
    expect(grounds(beat('feedback:1').text).map((g) => g.page)).toContain(3);
    expect(new Set(grounds(beat('feedback:2').text).map((g) => g.page))).toEqual(new Set([5]));
    expect(new Set(grounds(beat('answer:2').text).map((g) => g.page))).toEqual(new Set([5]));
  });

  it('says where the deck does not settle a point instead of settling it', () => {
    expect(beat('feedback:1').text).toMatch(/does not settle/);
  });

  it('never asks a new question in feedback, and never gives the answer in a hint', () => {
    // Rowland's constraint, unchanged: the next question is a click ("Try another"), not a clause.
    for (const cue of ['feedback:1', 'feedback:2']) expect(beat(cue).text, cue).not.toContain('?');
    // `rule:answer_withheld`: one hint that narrows, one clause that says a try unlocks the
    // answer, and no answer. The word the answer turns on must not be in it.
    expect(beat('hint:2').text).not.toMatch(/\bmemory\b/);
    expect(beat('hint:1').text).not.toMatch(/polychronic/i);
    for (const cue of ['hint:1', 'hint:2']) expect(beat(cue).text, cue).toMatch(/Not yet/);
  });

  it('keeps to §4’s word budgets, which are the point of §4', () => {
    // Tester feedback under 100 words; a shown answer under 150. Xu et al. ran every agent reply
    // near 80 words; the sessions studied ran 246–1,190 and were not read in full.
    for (const cue of ['feedback:1', 'feedback:2']) expect(words(beat(cue).text), cue).toBeLessThan(100);
    for (const cue of ['answer:1', 'answer:2']) expect(words(beat(cue).text), cue).toBeLessThan(150);
    // House rule 3 as revised: teaching a concept from the ground up aims at 120, ceiling 180.
    expect(words(beat('student:1').text)).toBeLessThan(180);
    // A question is one or two sentences, and a hint is shorter than the answer it withholds.
    for (const q of CRITIQUE1_QUESTIONS) expect(words(q.text ?? ''), q.cue).toBeLessThan(70);
    expect(words(beat('hint:2').text)).toBeLessThan(words(beat('answer:2').text));
  });

  it('spells no agent’s name, at either door', () => {
    expect(CRITIQUE1_QUESTIONS.some((b) => (b.text ?? '').includes('{teacher}'))).toBe(true);
    for (const b of [...CRITIQUE1_BEATS, ...CRITIQUE1_QUESTIONS, ...CRITIQUE1_QUIZ_TURNS, ...CRITIQUE1_WHISPERS]) {
      expect(b.text ?? '', b.cue).not.toMatch(/\bEllie\b|\bMax\b/);
    }
  });
});

// ── the learner's side ──────────────────────────────────────────────────────

describe('the lines the presenter types', () => {
  it('writes down every line the take needs, and no cue twice', () => {
    const cues = CRITIQUE1_LEARNER_LINES.map((l) => l.cue);
    expect(new Set(cues).size).toBe(cues.length);
    for (const cue of ['attempt:1', 'askanswer:2', 'ask:1', 'attempt:2', 'whisper:1']) {
      expect(learnerLine(cue), cue).toBeTruthy();
    }
    expect(learnerLine('nothing:1')).toBeUndefined();
  });

  it('gives both attempts more than rule 4’s eight content words', () => {
    // Rule 4 refuses anything under eight content words as agreement, and it should. An attempt
    // that trips it lifts the answer lock and moves nothing, which is correct but unfilmable.
    for (const cue of CRITIQUE1_ATTEMPT_CUES) {
      expect(words(learnerLine(cue)!), cue).toBeGreaterThanOrEqual(8);
    }
    // The spares are for the secondary door, and they have to clear the same floor.
    for (const cue of ['warmup:1', 'warmup:2']) expect(words(learnerLine(cue)!), cue).toBeGreaterThan(8);
  });

  it('asks for the answer in R6’s own words, short enough to be classified as one', () => {
    // `attempt-first.md` §2.2: an `answer_request` is at most 25 words and matches one of the R6
    // phrasings. This line is one of the phrasings, verbatim from the session.
    expect(ASK_ANSWER.toLowerCase()).toContain("what's the answer");
    expect(words(ASK_ANSWER)).toBeLessThanOrEqual(25);
  });

  it('keeps both attempts partly right, so the feedback has something to correct', () => {
    // The first reaches for politeness (M2a) but gets the partner and the interruption cost.
    expect(ATTEMPT_1).toMatch(/politeness/i);
    expect(ATTEMPT_1).toMatch(/the agent itself/);
    // The second gets the row and the falsehood but reads the protected memory as the failure.
    expect(ATTEMPT_2).toMatch(/third one/);
    expect(ATTEMPT_2).not.toMatch(/protected/);
  });
});

// ── the ledger, through ledger.ts ───────────────────────────────────────────

/** The rail at the start of the take: three rows, all at ○. */
function rail(): LedgerRow[] {
  return BTW_SIDE_CHANNEL_V1.elements.map((e) => ({
    id: `led_${e.id}`,
    session_id: 's1',
    element_id: e.id,
    level: 0 as const,
    level_proposed: 0 as const,
    confidence: null,
    evidence_text: null,
    evidence_msg_id: null,
    evidence_seq: null,
    defended_against: null,
    revisit: 0,
    contested: 0,
    misconceptions_open: '[]',
    misconceptions_resolved: '[]',
    updated_at: '1970-01-01T00:00:00.000Z',
  }));
}

function score(cue: string, typed: string, current: LedgerRow[], challenged: string[]) {
  const proposal = ledgerFor(cue, typed, CRITIQUE1_SCRIPT) as unknown as LedgerProposal;
  return applyLedgerRules({
    proposal,
    current,
    triggerMessage: { id: 'm1', seq: 1, body: typed },
    studentMessages: [{ id: 'm1', seq: 1, body: typed }],
    challengedElementIds: new Set(challenged),
    now: '1970-01-01T00:00:01.000Z',
  });
}

describe('the rail moves on the learner’s own words, through the real gates', () => {
  it('quotes the attempt verbatim — rule 1 passes because the evidence is really the learner’s', () => {
    for (const [cue, typed] of [
      ['feedback:1', ATTEMPT_1],
      ['feedback:2', ATTEMPT_2],
    ] as const) {
      const proposal = ledgerFor(cue, typed, CRITIQUE1_SCRIPT) as { elements: { evidence: string | null }[] };
      const quoted = proposal.elements.filter((e) => e.evidence !== null);
      expect(quoted.length, cue).toBeGreaterThanOrEqual(1);
      for (const e of quoted) expect(typed, cue).toContain(e.evidence);
    }
  });

  it('moves the whisper analogy to ◐ on the first attempt, and leaves the limit tests at ○', () => {
    const out = score('feedback:1', ATTEMPT_1, rail(), ['C2']);
    expect(out.skipped).toBeNull();
    expect(out.rows.map((r) => `${r.element_id}:${r.level}`).sort()).toEqual(['C1:0', 'C2:2', 'C3:0']);
    expect(out.changed).toEqual(['C2']);
    // The row named at 0 is a no-op through the rules: no advance, no gate, no history row.
    expect(out.history.map((h) => h.element_id)).toEqual(['C2']);
    // The misconception rides along with the advance rather than being quietly dropped.
    expect(JSON.parse(out.rows.find((r) => r.element_id === 'C2')!.misconceptions_open)).toEqual(['M2a']);
    // And the reason "Try another" has somewhere to go: the lowest row is still the limit tests.
    expect(out.rows.find((r) => r.element_id === 'C1')!.level).toBe(0);
  });

  it('moves the limit tests to ◐ on the second attempt, and no further', () => {
    const after1 = score('feedback:1', ATTEMPT_1, rail(), ['C2']).rows;
    const out = score('feedback:2', ATTEMPT_2, after1, ['C1']);
    expect(out.rows.map((r) => `${r.element_id}:${r.level}`).sort()).toEqual(['C1:2', 'C2:2', 'C3:0']);
    expect(JSON.parse(out.rows.find((r) => r.element_id === 'C1')!.misconceptions_resolved)).toEqual(['M1a']);
    // ● is not claimed: the attempt has the row and the falsehood but not why the refusal is the
    // feature, and `answer:2` is what supplies that — which is exactly why it moves nothing.
    expect(out.rows.find((r) => r.element_id === 'C1')!.level).toBeLessThan(3);
  });

  it('proposes nothing at all on a shown answer, a hint, a clarification or a question', () => {
    // §2.3: the ledger is not run on `rule:answer_shown` and never moves on a shown answer. The
    // script belts it: there is no proposal to run even if it were.
    for (const cue of ['answer:1', 'answer:2', 'hint:1', 'hint:2', 'clarify:1', 'clarify:2', 'try:1', 'try:2']) {
      expect(beatFor(cue)!.ledger, cue).toBeUndefined();
      const proposal = ledgerFor(cue, ATTEMPT_2, CRITIQUE1_SCRIPT) as { elements: unknown[] };
      expect(proposal.elements, cue).toEqual([]);
    }
    // And the explain path proposes nothing either: a question is not a claim.
    expect((ledgerFor('student:3', ASK, CRITIQUE1_SCRIPT) as { elements: unknown[] }).elements).toEqual([]);
  });

  it('refuses the same proposal on a line that is only agreement', () => {
    // Rule 4, over the take's own beat: the feedback block is written for an attempt, and it moves
    // nothing when what was typed is not one.
    const out = score('feedback:1', 'ok makes sense', rail(), ['C2']);
    expect(out.skipped).toBe('agreement_not_evidence');
    expect(out.rows.every((r) => r.level === 0)).toBe(true);
  });

  it('files its rows under its own concept pack', () => {
    expect((ledgerFor('feedback:1', ATTEMPT_1, CRITIQUE1_SCRIPT) as { concept_id: string }).concept_id).toBe(
      'btw-side-channel-v1',
    );
  });
});

// ── the secondary door, end to end ──────────────────────────────────────────

/**
 * The room as a *rehearsal of the secondary door* finds it: the Critique 1 deck, its own pack, and
 * the sitting `critique1Sitting` describes, driven on the **shipped** `DEMO` pacing — `k = 2`, so
 * the hand-off is reachable. The take itself cannot reach it (`CRITIQUE1_TAKE` raises `k` above
 * the take's four learner turns on purpose), which is what keeps the time-based door from
 * interrupting the attempt loop on camera.
 */
function build() {
  const seeded = seedRoom(undefined, [], {
    pack: BTW_SIDE_CHANNEL_V1,
    materialText: CRITIQUE1_DECK_TEXT,
    fileName: FIXTURE_FILE,
    title: BTW_SIDE_CHANNEL_V1.title,
  });
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    // Deliberately *not* pinned to the script: the client has to recognise the deck from the
    // requests it is handed, which is what happens in the app (flow-build-plan.md §4.4).
    llm: new ScriptedClient(),
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: BTW_SIDE_CHANNEL_V1,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    flowProfile: DEMO,
    flowState: critique1Sitting(clock.now(), DEMO),
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
  });
  actor.start();
  return { ...seeded, clock, events, actor };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 30_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const segmentText = (page: number) => CRITIQUE1_PAGE_TEXT[page]!;

/** The Ask, answered by the Teacher. The state the rest of the rehearsal starts from. */
async function throughAsk(h: ReturnType<typeof build>) {
  return settle(
    h.clock,
    h.actor.askHere({ anchorId: P5, question: ASK, context: segmentContext({ text: segmentText(5) }) }),
    30_000,
  );
}

describe('the explain path — "+ Ask here", answered by the Teacher', () => {
  it('answers in the thread, from the page, on the prerequisite the deck assumes', async () => {
    const h = build();
    await throughAsk(h);

    const messages = h.store.messages.forRoom(h.roomId);
    const question = messages.find((m) => m.body === ASK)!;
    expect(question.anchor_id).toBe(P5);

    const teacher = h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!;
    const answer = messages.at(-1)!;
    expect(answer.participant_id).toBe(teacher.id);
    expect(answer.anchor_id).toBe(P5);
    // Decided by rule, not by a 20-second model call (orchestrator.ts `rule:teacher_answers`).
    expect(h.store.turnDecisions.forRoom(h.roomId).at(-1)!.decided_by).toBe('rule:teacher_answers');
    // ANSWER FIRST (#36): the thing asked about is settled in the opening sentence.
    expect(answer.body.split('.')[0]).toContain('session');
    expect(answer.body).toContain('strict subset');
    // And she says out loud that she will not answer the question on the floor for the learner.
    expect(answer.body).toMatch(/not going to answer it for you/);
  });

  it('takes the floor and the timer, and moves no ledger row', async () => {
    const h = build();
    const room = () => h.store.rooms.get(h.roomId)!;
    const before = room().timer_epoch;

    await throughAsk(h);

    expect(room().consecutive_agent_turns).toBe(1);
    expect(room().pending_turn_id).toBeNull();
    expect(room().timer_epoch).toBeGreaterThan(before);
    // Reading an answer moves nothing. Rule 1 is why — evidence must be a verbatim substring of a
    // *learner* message — and asking a question leaves nothing of the learner's to quote.
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.level)).toEqual([0, 0, 0]);
  });
});

describe('the secondary door — the time-based hand-off, unchanged', () => {
  it('fires by rule on the shipped Demo pacing, and asks one question about C2', async () => {
    const h = build();
    await throughAsk(h);
    await settle(h.clock, h.actor.sendMessage(WARMUP_1));

    const messages = h.store.messages.forRoom(h.roomId);
    const lineIndex = messages.findIndex((m) => m.model === 'rule:handoff');
    expect(lineIndex).toBeGreaterThan(-1);

    // Ellie's line is written by `flow.handOffLine()`, from the taught set, not by the script.
    const line = messages[lineIndex]!;
    expect(line.body).toMatch(/^You've covered .* — Max, over to you\.$/);
    expect(line.body).toContain('what /btw can and cannot do');
    expect(line.body).toContain('why whispering helps');

    const quiz = messages[lineIndex + 1]!;
    const decision = h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
    expect(decision.decided_by).toBe('rule:handoff');
    expect(decision.move_type).toBe('quiz');
    // The fresher of the two taught concepts, and the order `try:1` asks in.
    expect(decision.target_element_id).toBe('C2');
    expect(quiz.body).toContain('page 4');
    expect(quiz.body.split('?').length - 1).toBe(1);
    // Tan et al.'s considered band, unchanged by any of this.
    expect(quiz.latency_target_ms).toBeGreaterThanOrEqual(9_000);
    expect(quiz.latency_target_ms).toBeLessThanOrEqual(12_000);
  });

  /**
   * The bug this pins down was live on 16 Sep: the pairing was drawn at install (#16), this
   * install drew the swap, and the flow rendered `MAX · TEACHER` over *"Ellie, over to you"*
   * while the Tester's own question named the Teacher as somebody else. The pairing is pinned now
   * (`agents.ts`) **and** neither sentence spells a name: the line takes the roster, the script
   * writes `{teacher}` / `{tester}`.
   */
  it('names the Tester in the hand-off and the Teacher in the question, off the live roster (#32)', async () => {
    const h = build();
    await throughAsk(h);
    await settle(h.clock, h.actor.sendMessage(WARMUP_1));

    const messages = h.store.messages.forRoom(h.roomId);
    const i = messages.findIndex((m) => m.model === 'rule:handoff');
    const line = messages[i]!;
    const quiz = messages[i + 1]!;

    const teacher = h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!;
    const tester = h.store.participants.byAgentKey(h.roomId, 'challenger.max')!;

    expect(line.participant_id).toBe(teacher.id);
    expect(line.body).toContain('Max, over to you.');
    expect(line.body).not.toContain('Ellie');

    expect(quiz.participant_id).toBe(tester.id);
    expect(quiz.body).toContain('Ellie has done the teaching');
    expect(quiz.body).not.toContain('Max');
  });

  it('will not quiz the thing that was just taught', async () => {
    const h = build();
    await throughAsk(h);
    await settle(h.clock, h.actor.sendMessage(WARMUP_1));
    const decision = h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
    expect(decision.target_element_id).not.toBe('C3');
  });

  it('owes feedback after the answer, by rule, and grounds it', async () => {
    const h = build();
    await throughAsk(h);
    await settle(h.clock, h.actor.sendMessage(WARMUP_1));
    await settle(h.clock, h.actor.sendMessage(ATTEMPT_1));

    const decision = h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
    expect(decision.decided_by).toBe('rule:quiz_feedback');
    expect(decision.move_type).toBe('quiz_feedback');

    const tester = h.store.participants.byAgentKey(h.roomId, 'challenger.max')!;
    const last = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(last.participant_id).toBe(tester.id);
    // The same grounded feedback the Try-this door draws: one counter, two doors, one beat.
    expect(last.body).toContain('p. 3:');
    expect(last.body).toContain('Polychronic');
  });
});

describe('the whisper', () => {
  it('answers privately, offers the Critique 1 relay draft, and inserts it on approval', async () => {
    const h = build();
    await throughAsk(h);
    const groupBefore = h.store.messages.forRoom(h.roomId).length;

    const thread = h.actor.openWhisper('peer.ellie');
    await settle(h.clock, h.actor.sendWhisper(thread.threadId, WHISPER), 8_000);

    const turns = h.store.whispers.forThread(thread.threadId);
    expect(turns).toHaveLength(2);
    // The deck's own answer to the embarrassing question — page 6, not a general one.
    expect(turns[1]!.body).toContain('Nevermind');
    expect(turns[1]!.body).toContain("won't answer Max's question for you");
    // Nothing reached the document.
    expect(h.store.messages.forRoom(h.roomId).length).toBe(groupBefore);

    // The draft comes from *this* script, not from the PSD/Hessian one the actor used to import.
    const offer = JSON.parse(turns[1]!.relay_offer!) as { draftText: string; defaultAttribution: string };
    expect(offer.draftText).toContain('forwarding problem');
    expect(offer.draftText).not.toContain('PSD');

    await settle(
      h.clock,
      h.actor.relay({
        threadId: thread.threadId,
        whisperId: turns[1]!.id,
        attribution: 'as_me',
        text: offer.draftText,
      }),
    );
    const inserted = h.store.messages.forRoom(h.roomId).find((m) => m.promoted_from_whisper !== null)!;
    expect(inserted.body).toContain('forwarding problem');
    // Insertion is the only path from private to shared, and it carries no badge text.
    expect(inserted.body).not.toMatch(/whisper|private/i);
  });

  it('never reaches the Tester’s context — the canary, over this deck', async () => {
    const CANARY = 'ZZQX-CANARY-4412-critique1-whisper-only';
    const h = build();
    await throughAsk(h);
    const thread = h.actor.openWhisper('peer.ellie');
    await settle(h.clock, h.actor.sendWhisper(thread.threadId, `${WHISPER} ${CANARY}`), 8_000);

    const roster = rosterFor('ellie_peer');
    for (const speaker of roster) {
      const request = buildGroupContext(groupView(h.store), {
        roomId: h.roomId,
        speaker,
        roster,
        pack: BTW_SIDE_CHANNEL_V1,
        directive: { agentRole: speaker.role, move: 'quiz' },
      });
      expect(JSON.stringify(request)).not.toContain(CANARY);
    }
    // And not into the document, the ledger's evidence, or the event log either.
    expect(h.store.messages.forRoom(h.roomId).map((m) => m.body).join('\n')).not.toContain(CANARY);
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.evidence_text ?? '').join('\n')).not.toContain(CANARY);
    expect(h.store.events.forSession(h.sessionId).map((e) => e.payload).join('\n')).not.toContain(CANARY);
  });
});

describe('the segments the demo plays on', () => {
  it('names page 3’s measured tick as the split, and both halves of it', () => {
    // docs/SEGMENTS.md §7: page 3 offers three candidates and the middle one divides the rows.
    expect(CRITIQUE1_SPLIT).toEqual({ page: 3, axis: 'horizontal', at: 0.535 });
    const lower = CRITIQUE1_SEGMENTS.find((s) => s.key === P3_LOWER)!;
    expect(lower.page).toBe(3);
    expect(lower.y0).toBe(CRITIQUE1_SPLIT.at);
    expect(lower.y1).toBe(1);
    // The attempt loop's two cards are both in the list, and every beat names a card that exists.
    for (const b of [...CRITIQUE1_BEATS, ...CRITIQUE1_QUESTIONS]) {
      if (b.segment) expect(CRITIQUE1_SEGMENTS.map((s) => s.key), b.cue).toContain(b.segment);
    }
  });

  it('pins the warm-up to the order the script asks in', () => {
    const { session, taught } = critique1Sitting(1_000_000);
    expect(session.anchors).toEqual([P3_LOWER]);
    // C2 is the fresher of the two, so `pickTarget` reaches it first — matching `try:1`.
    const byId = new Map(taught.map((t) => [t.elementId, t.taughtAt]));
    expect(byId.get('C2')!).toBeGreaterThan(byId.get('C1')!);
    // The take's own turns are the only ones inside the window.
    expect(session.learnerTurns.every((t) => t < 1_000_000 - session.profile.windowMs)).toBe(true);
    // And the take cannot reach the secondary door: k is above the take's four learner turns.
    expect(session.profile.turnsK).toBeGreaterThan(4);
    expect(critique1Sitting(1_000_000, DEMO).session.profile.turnsK).toBe(DEMO.turnsK);
  });
});

describe('which script replays', () => {
  const request = (text: string): LlmRequest => ({
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    system: [{ type: 'text', text }],
    messages: [{ role: 'user', content: 'go on then' }],
    meta: { scope: 'group' },
  });

  it('picks the fixture deck by file name, by content hash, or by an override', () => {
    expect(pickScriptName({ fileName: FIXTURE_FILE })).toBe('critique1');
    expect(pickScriptName({ fileName: 'renamed copy.pdf', contentSha: [...CRITIQUE1_FIXTURE.contentShas][0] })).toBe(
      'critique1',
    );
    expect(pickScriptName({ fileName: 'MA3236 lecture 4.pdf' })).toBe('psd-hessian');
    expect(pickScriptName({})).toBe('psd-hessian');
    // The override wins over both signals, and an unknown name is ignored rather than fatal.
    expect(pickScriptName({ fileName: FIXTURE_FILE, override: 'psd-hessian' })).toBe('psd-hessian');
    expect(pickScriptName({ override: 'critique1' })).toBe('critique1');
    expect(pickScriptName({ fileName: FIXTURE_FILE, override: 'nonsense' })).toBe('critique1');
  });

  it('recognises the deck from a request when nobody told the client', () => {
    expect(scriptNameForRequest(request(CRITIQUE1_DECK_TEXT))).toBe('critique1');
    expect(scriptNameForRequest(request('Second-order condition for convexity. The Hessian is PSD.'))).toBeNull();
    // One marker is not enough: `/btw` alone appears in this repo's own research notes.
    expect(scriptNameForRequest(request('the /btw command, in passing'))).toBeNull();
  });

  it('latches on the first recognised request and stays there', async () => {
    const client = new ScriptedClient();
    expect(client.script).toBe(SCRIPTS['psd-hessian']);
    await client.complete({ ...request(CRITIQUE1_DECK_TEXT), meta: { scope: 'group', scriptCue: 'open' } });
    expect(client.script).toBe(SCRIPTS.critique1);
    // A later request with no marker in it — one segment's summary call — does not undo it.
    const summary = await client.complete({
      ...request('a page of nothing in particular'),
      meta: { scope: 'reference', scriptCue: 'summary:1' },
    });
    expect(client.script).toBe(SCRIPTS.critique1);
    expect(summary.text).toContain('read-only view of the session');
  });

  it('is pinned when the caller already knows, and answers that script only', async () => {
    const client = new ScriptedClient({ script: CRITIQUE1_SCRIPT });
    const out = await client.complete({
      ...request('Second-order condition for convexity. The Hessian is PSD.'),
      meta: { scope: 'group', scriptCue: 'open' },
    });
    expect(out.text).toContain('Pick a card');
    expect(client.script.conceptId).toBe('btw-side-channel-v1');
  });

  it('answers a question the script has run out of, so the Tester is never silent', async () => {
    // A flow actor lives for the life of the process, so a second walkthrough in one session cues
    // `try:3`. At the secondary door Ellie's line is posted either way, and without a beat behind
    // it the camera sees "Max, over to you" and then nothing.
    const client = new ScriptedClient({ script: CRITIQUE1_SCRIPT });
    const out = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'handoff:3' },
    });
    expect(out.text).toBe(fillAgentNames(beatFor('handoff:2')!.text!, rosterFor()));

    const again = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'try:9' },
    });
    expect(again.text).toBe(beatFor('try:2')!.text);

    const fb = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'feedback:7' },
    });
    expect(fb.text).toContain('memory protected');

    // Repeating a question is safe because no question beat carries a ledger block; repeating a
    // feedback is safe because rule 2 is monotonic and an equal level is not an advance.
    for (const q of CRITIQUE1_QUESTIONS) expect(q.ledger).toBeUndefined();
    const after = score('feedback:1', ATTEMPT_1, rail(), ['C2']).rows;
    expect(score('feedback:1', ATTEMPT_1, after, ['C2']).changed).toEqual([]);
    expect(beatFor('nothing:9')).toBeUndefined();
  });

  it('fills the agents’ names from the roster it was given, never from the script', async () => {
    // Belt and braces on the pin: even handed the pairing #16 used to be able to draw, the
    // Tester's question names whoever is actually teaching. No literal survives in the file.
    const swapped = new ScriptedClient({ script: CRITIQUE1_SCRIPT, roster: rosterFor('ellie_challenger') });
    const out = await swapped.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'handoff:2' },
    });
    expect(out.text).toContain('Max had you on page 6');

    const pinned = new ScriptedClient({ script: CRITIQUE1_SCRIPT });
    const out2 = await pinned.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'handoff:2' },
    });
    expect(out2.text).toContain('Ellie had you on page 6');
  });
});

// ── the take itself, through the real actor ─────────────────────────────────

/**
 * **The hero interaction, end to end.** The actor side of #47 (`tryHere`, `showAnswer`,
 * `classifyLearnerTurn`, the four rules and `quizCue`) landed while this was being written, so the
 * whole of `flow-build-plan.md` §2's beats 5–13 can be driven here rather than asserted about: the
 * cues this script answers are the cues the actor really emits, and the answer lock is really the
 * thing that refuses.
 */
describe('the attempt loop — beats 5–13, on the real actor', () => {
  const lastBody = (h: ReturnType<typeof build>) => h.store.messages.forRoom(h.roomId).at(-1)!.body;
  const lastDecision = (h: ReturnType<typeof build>) => h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
  const levels = (h: ReturnType<typeof build>) =>
    Object.fromEntries(h.store.ledger.forSession(h.sessionId).map((r) => [r.element_id, r.level]));

  it('runs the whole loop, and the answer is refused until one attempt is on the record', async () => {
    const h = build();

    // Beat 5 — "+ Try this" under page 3's lower card. One question, by rule, on C2.
    await settle(
      h.clock,
      h.actor.tryHere({ anchorId: P3_LOWER, objectiveId: 'C2', context: segmentContext({ text: segmentText(3) }) }),
    );
    expect(lastDecision(h).decided_by).toBe('rule:try_here');
    expect(lastBody(h)).toBe(beatFor('try:1')!.text);

    // Beat 13's control, asked for too early: refused in the composer's own words, no turn taken.
    const before = h.store.messages.forRoom(h.roomId).length;
    expect(await h.actor.showAnswer(P3_LOWER)).toEqual({
      shown: false,
      refused: "Max won't give the answer until you've tried once.",
    });
    expect(h.store.messages.forRoom(h.roomId).length).toBe(before);

    // Beats 6–7 — the attempt, typed, and the feedback it is owed. Grounded on page 3.
    await settle(h.clock, h.actor.sendMessage(ATTEMPT_1));
    expect(lastDecision(h).decided_by).toBe('rule:quiz_feedback');
    expect(lastBody(h)).toContain('p. 3: "Oops, this will expose data.."');

    // Beat 9 — "+ Try this" again, on the card whose objective is still at ○.
    await settle(
      h.clock,
      h.actor.tryHere({ anchorId: P5, objectiveId: 'C1', context: segmentContext({ text: segmentText(5) }) }),
    );
    expect(lastBody(h)).toBe(beatFor('try:2')!.text);

    // Beat 10 — "what's the answer?" with nothing tried on *this* question. Withheld.
    await settle(h.clock, h.actor.sendMessage(ASK_ANSWER));
    expect(lastDecision(h).decided_by).toBe('rule:answer_withheld');
    expect(lastBody(h)).toBe(beatFor('hint:2')!.text);
    expect(lastBody(h)).not.toMatch(/\bmemory\b/);

    // Beat 11 — the explain path — now works mid-question (`origin: 'ask'`, #47 §6) and is asserted
    // in the test below rather than here, so this chain stays the attempt loop's own.

    // Beat 12 — the second attempt, and feedback grounded on page 5.
    await settle(h.clock, h.actor.sendMessage(ATTEMPT_2));
    expect(lastDecision(h).decided_by).toBe('rule:quiz_feedback');
    expect(lastBody(h)).toContain('p. 5: "did not actually do so, memory protected"');

    // Beat 13 — and now the answer is available, because one attempt is on the record.
    /**
     * **Beat 8 of §2 — "the ledger moves, on the learner's own words".**
     *
     * The seam this pinned: the ledger call carried the *learner* cue, so a block written against
     * `feedback:2` — where it belongs, because it is a judgement of the attempt that feedback
     * answers — was never reached, and the rail stayed ○ ○ ○ after two attempts and two feedback
     * turns. Fixed in `actor.ts` by cueing the ledger call `feedback:N` on a feedback turn **with
     * the learner cue behind it** (`meta.scriptCueFallback`, resolved in `scripted.ledgerFor`), so
     * `script.psd-hessian.ts`'s `student:N` blocks keep working. C1 and C2 now move to 2 — exactly
     * what `applyLedgerRules` returns for these two proposals and these two typed lines, three
     * tests above — and C3 stays at ○, because nothing the learner wrote is about it.
     */
    expect(levels(h)).toEqual({ C1: 2, C2: 2, C3: 0 });

    const railBefore = levels(h);
    const shown = await settle(h.clock, h.actor.showAnswer(P5));
    expect(shown).toEqual({ shown: true, refused: null });
    expect(lastDecision(h).decided_by).toBe('rule:answer_shown');
    expect(lastBody(h)).toBe(beatFor('answer:2')!.text);
    // §2.3's last row: the ledger is not run on a shown answer and never moves on one.
    expect(levels(h)).toEqual(railBefore);
  });

  /**
   * **Beat 11: the explain path runs while a question is open** (`flow-build-plan.md` §2 beat 11,
   * `attempt-first.md` §6 — *"Ellie's '+ Ask here' appears once, as the explain path, when the second
   * question needs a prerequisite"*).
   *
   * This test was written as a pinned bug and is now the assertion of the fix. An Ask used to be
   * classified like any other learner turn, and the Ask the take types is 39 words — over the
   * 25-word ceiling on `question`, so it read as an **attempt**: Max answered instead of Ellie, the
   * Ask counted as the try that unlocks the answer, and the ledger was scored against a question.
   * Shortening it would not have helped (under 25 words it draws `rule:quiz_clarify`, still Max).
   * `actor.sendMessage` now carries the turn's origin, and an Ask skips the answer lock and never
   * touches `pendingQuiz`.
   */
  it('gives an Ask mid-quiz to the Teacher, and it is not the attempt that unlocks the answer', async () => {
    const h = build();
    await settle(
      h.clock,
      h.actor.tryHere({ anchorId: P5, objectiveId: 'C1', context: segmentContext({ text: segmentText(5) }) }),
    );
    await settle(h.clock, h.actor.askHere({ anchorId: P5, question: ASK, context: segmentContext({ text: segmentText(5) }) }));

    // The Teacher answers the thread she was asked in, mid-question.
    expect(lastDecision(h).decided_by).toBe('rule:teacher_answers');
    // And the lock is still shut, because nothing has been attempted.
    expect(await h.actor.showAnswer(P5)).toEqual({
      shown: false,
      refused: "Max won't give the answer until you've tried once.",
    });
  });
});
