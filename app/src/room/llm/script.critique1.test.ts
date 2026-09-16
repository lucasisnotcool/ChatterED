/**
 * **Beats 7–13 of the video, driven through the real actor on a fake clock.**
 *
 * `flow-build-plan.md` §3.3 Track C: the script is not a transcript player, so this test is not
 * a snapshot of one. Every beat below is produced by the machinery the demo claims is real —
 * `reference.ts`'s 120-word cap and its lock, `flow.handOffDue()` on the DEMO profile,
 * `orchestrator.ruleDecision`'s hand-off and feedback rules, `ledger.ts`'s verbatim-evidence
 * check and its `defended` gate, and the whisper scoping — with `ScriptedClient` supplying only
 * the words. If any of those stopped working, this test fails even though the script is intact,
 * which is the whole point of it.
 *
 * Six beats, in order, plus the three invariants the demo is making a claim about:
 *   1. "+ Ask here" on page 3's lower segment → a REFERENCE answer, ≤ 120 words, in the register;
 *   2. "Explain it back" → Ellie teaches from the slide, on the learner's own verbatim lines;
 *   3. the hand-off fires **by rule**, then Max asks exactly one question about C1;
 *   4. the ledger does not move at all until Max has been answered, and then moves two rows,
 *      because that answer contains the evidence verbatim;
 *   5. Max's next turn is feedback (`rule:quiz_feedback`);
 *   6. a whisper is answered privately, with the Critique 1 relay draft ready to insert.
 *
 * Invariants: the whisper never reaches the Tester's context (the canary), the REFERENCE card has
 * no floor / timer / ledger effect, and script selection lands on the right deck.
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
import { segmentContext, HAND_BACK_LINE, REFERENCE_WORD_CAP } from '../reference.js';
import { ScriptedClient } from './scripted.js';
import {
  CRITIQUE1_HANDOFFS,
  CRITIQUE1_LEARNER_LINES,
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
/** The anchor the demo's "+ Ask here" lands on: page 3, below the tick at y 0.535. */
const P3_LOWER = 'p3.lower';

const L1 = learnerLine('student:1')!;
const L2 = learnerLine('student:2')!;
const L3 = learnerLine('student:3')!;
const ASK = learnerLine('ask:1')!;
const WHISPER = learnerLine('whisper:1')!;

/**
 * The room as the take finds it: the Critique 1 deck, its own pack, and the flow session the
 * presenter's warm-up left behind (`critique1Sitting`) — two concepts taught four and twelve
 * minutes ago, and no learner turn inside the DEMO profile's three-minute window, so R1 is
 * satisfied by the take's own turns and the rule is seen to fire on camera.
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
    flowState: critique1Sitting(clock.now()),
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

/** Beats 7–9: ask, read, say it back. The state every later beat starts from. */
async function throughExplainBack(h: ReturnType<typeof build>) {
  const asked = await settle(
    h.clock,
    h.actor.askHere({ anchorId: P3_LOWER, question: ASK, context: segmentContext({ text: segmentText(3) }) }),
    6_000,
  );
  h.actor.explainBack(asked.answerId);
  await settle(h.clock, h.actor.sendMessage(L1));
  return asked;
}

describe('beat 7–8 — "+ Ask here" on the lower half of page 3', () => {
  it('answers in the deck’s register, under the cap, and says nothing the deck does not', async () => {
    const h = build();
    const out = await settle(
      h.clock,
      h.actor.askHere({ anchorId: P3_LOWER, question: ASK, context: segmentContext({ text: segmentText(3) }) }),
      6_000,
    );

    const answer = h.store.messages.get(out.answerId)!;
    expect(out.truncated).toBe(false);
    const words = answer.body.replace(HAND_BACK_LINE, '').trim().split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(REFERENCE_WORD_CAP);
    // The deck's own comparison, not a general answer about side channels.
    expect(answer.body).toContain('read-only view of the session');
    expect(answer.body).toContain('this will expose data');
    // Register, not disguise: no persona, no first person, no question of its own.
    expect(answer.body).not.toMatch(/\bEllie\b|\bMax\b/);
    expect(answer.body.replace(HAND_BACK_LINE, '')).not.toMatch(/\bI\b|\bI'm\b/);
    expect(answer.body.replace(HAND_BACK_LINE, '')).not.toContain('?');
    // Written by the voice that is not in the roster.
    expect(h.store.participants.get(answer.participant_id)!.agent_key).toBeNull();
    expect(answer.anchor_id).toBe(P3_LOWER);
  });

  it('has no floor, no timer and no ledger effect — reading an answer is not explaining one', async () => {
    const h = build();
    const room = () => h.store.rooms.get(h.roomId)!;
    const before = {
      floor: room().consecutive_agent_turns,
      deadline: room().deadline_ts,
      epoch: room().timer_epoch,
      fires: room().nudge_fires_this_round,
      ledger: h.store.ledger.forSession(h.sessionId).map((r) => r.level),
    };

    await settle(
      h.clock,
      h.actor.askHere({ anchorId: P3_LOWER, question: ASK, context: segmentContext({ text: segmentText(3) }) }),
      6_000,
    );

    expect(room().consecutive_agent_turns).toBe(before.floor);
    expect(room().pending_turn_id).toBeNull();
    expect(room().deadline_ts).toBe(before.deadline);
    expect(room().timer_epoch).toBe(before.epoch);
    expect(room().nudge_fires_this_round).toBe(before.fires);
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.level)).toEqual(before.ledger);
  });

  it('locks Ellie and Max out of the segment until "Explain it back"', async () => {
    const h = build();
    const out = await settle(
      h.clock,
      h.actor.askHere({ anchorId: P3_LOWER, question: ASK, context: segmentContext({ text: segmentText(3) }) }),
      6_000,
    );
    await settle(h.clock, h.actor.sendMessage(L1));
    expect(h.store.turnDecisions.forRoom(h.roomId).at(-1)!.decided_by).toBe('rule:reference_locked');

    h.actor.explainBack(out.answerId);
    await settle(h.clock, h.actor.sendMessage(L2));
    expect(h.store.turnDecisions.forRoom(h.roomId).at(-1)!.decided_by).not.toBe('rule:reference_locked');
  });
});

describe('beat 9 — the Teacher’s thread', () => {
  it('opens with Ellie explaining from the slide, on the learner’s own words', async () => {
    const h = build();
    await throughExplainBack(h);

    const teacher = h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!;
    const hers = h.store.messages.forRoom(h.roomId).filter((m) => m.participant_id === teacher.id);
    expect(hers.length).toBeGreaterThanOrEqual(1);
    const turn = hers.at(-1)!;
    // She teaches *from the page*: the deck's own sentence, quoted, and the page it is on.
    expect(turn.body).toContain('page 6');
    expect(turn.body).toContain('cannot be forwarded');
    // And the learner's line is in the transcript exactly as typed.
    expect(h.store.messages.forRoom(h.roomId).some((m) => m.body === L1)).toBe(true);
  });

  it('writes down at least three learner turns for the presenter to type verbatim', () => {
    const studentLines = CRITIQUE1_LEARNER_LINES.filter((l) => l.cue.startsWith('student:'));
    expect(studentLines.length).toBeGreaterThanOrEqual(3);
    for (const line of studentLines) {
      // Rule 4 refuses anything under eight content words as agreement, and it should.
      expect(line.text.trim().split(/\s+/).length).toBeGreaterThan(8);
    }
  });
});

describe('beats 10–11 — the hand-off, and one question', () => {
  it('fires by rule on the DEMO profile, and Max asks exactly one question about C1', async () => {
    const h = build();
    await throughExplainBack(h);
    await settle(h.clock, h.actor.sendMessage(L2));

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
    // The concept taught minutes earlier — not the one Ellie taught seconds ago.
    expect(decision.target_element_id).toBe('C1');
    expect(quiz.body).toContain('page 5');
    expect(quiz.body.split('?').length - 1).toBe(1);
    // Tan et al.'s considered band, unchanged by any of this.
    expect(quiz.latency_target_ms).toBeGreaterThanOrEqual(9_000);
    expect(quiz.latency_target_ms).toBeLessThanOrEqual(12_000);
  });

  /**
   * The bug this pins down was live on 16 Sep: the pairing was drawn at install (#16), this
   * install drew the swap, and the flow rendered `MAX · TEACHER` over *"Ellie, over to you"*
   * while the Tester's own question said *"Ellie had you on page 6"* — the Teacher quoting
   * herself as somebody else. The pairing is pinned now (`agents.ts`) **and** neither sentence
   * spells a name any more: the line takes the roster, the script writes `{teacher}`/`{tester}`.
   */
  it('names the Tester in the hand-off and the Teacher in the quiz, off the live roster (#32)', async () => {
    const h = build();
    await throughExplainBack(h);
    await settle(h.clock, h.actor.sendMessage(L2));

    const messages = h.store.messages.forRoom(h.roomId);
    const i = messages.findIndex((m) => m.model === 'rule:handoff');
    const line = messages[i]!;
    const quiz = messages[i + 1]!;

    const teacher = h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!;
    const tester = h.store.participants.byAgentKey(h.roomId, 'challenger.max')!;

    // The Teacher speaks the hand-off, and it names the Tester — never herself.
    expect(line.participant_id).toBe(teacher.id);
    expect(line.body).toContain('Max, over to you.');
    expect(line.body).not.toContain('Ellie');

    // The Tester speaks the quiz, and it names the Teacher — never himself.
    expect(quiz.participant_id).toBe(tester.id);
    expect(quiz.body).toContain('Ellie had you on page 6');
    expect(quiz.body).not.toContain('Max');
  });

  it('will not quiz the thing that was just taught — C3 is minutes too young', async () => {
    const h = build();
    await throughExplainBack(h);
    await settle(h.clock, h.actor.sendMessage(L2));
    const decision = h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
    expect(decision.target_element_id).not.toBe('C3');
  });
});

describe('beat 12 — two rows move, on the learner’s own words', () => {
  /**
   * The gate run of 16 Sep had `C1` **defended** and `C3` **justified** before Max had asked
   * anything — the blocks were keyed to the learner-turn ordinal and the take needed a spare
   * turn — so beat 12's *"that moved because **I** wrote it"* pointed at the wrong turn. Beats 9
   * and 10 are questions now and propose no element at all, which is what this pins: not that a
   * gate refused an advance, but that nothing was ever proposed.
   */
  it('does not move before the hand-off — the read-back and the question score nothing', async () => {
    const h = build();
    const levels = () =>
      h.store.ledger.forSession(h.sessionId).map((r) => `${r.element_id}:${r.level}`);
    const atRest = levels();
    expect(atRest).toEqual(['C1:0', 'C2:0', 'C3:0']);

    // Beat 9 — "Explain it back", then the card said back and a question asked.
    await throughExplainBack(h);
    expect(levels()).toEqual(atRest);

    // Beat 10 — the turn the hand-off fires on. Still nothing.
    await settle(h.clock, h.actor.sendMessage(L2));
    expect(h.store.messages.forRoom(h.roomId).some((m) => m.model === 'rule:handoff')).toBe(true);
    expect(levels()).toEqual(atRest);

    // And no gate was involved: an empty proposal leaves no history row to explain away.
    expect(h.store.ledger.historyForSession(h.sessionId)).toEqual([]);

    // Beat 12 — the answer to Max is the first thing in the sitting that moves anything.
    await settle(h.clock, h.actor.sendMessage(L3));
    expect(levels()).toEqual(['C1:3', 'C2:0', 'C3:2']);
    expect(h.store.ledger.historyForSession(h.sessionId).map((r) => r.element_id).sort()).toEqual(['C1', 'C3']);
  });

  it('moves C1 to defended and C3 to justified, quoting what was actually typed', async () => {
    const h = build();
    await throughExplainBack(h);
    await settle(h.clock, h.actor.sendMessage(L2));
    const before = new Map(h.store.ledger.forSession(h.sessionId).map((r) => [r.element_id, r.level]));
    // Both rows start the take at `not_yet`, so what the camera sees is ○ → ● and ○ → ◐.
    expect([...before.values()]).toEqual([0, 0, 0]);

    await settle(h.clock, h.actor.sendMessage(L3));

    const after = new Map(h.store.ledger.forSession(h.sessionId).map((r) => [r.element_id, r]));
    const moved = [...after.values()].filter((r) => r.level > (before.get(r.element_id) ?? 0));
    expect(moved.map((r) => r.element_id).sort()).toEqual(['C1', 'C3']);

    // `defended` is unreachable without a Tester probe; C1 was the quiz target, so it is the one
    // that can get there. C3 stops at justified because nobody has challenged it.
    expect(after.get('C1')!.level).toBe(3);
    expect(after.get('C3')!.level).toBe(2);
    expect(after.get('C1')!.defended_against).toBeTruthy();

    // Rule 1, the only one that matters on camera: the evidence is a verbatim substring of the
    // learner's message, not of the script's.
    for (const row of moved) {
      expect(row.evidence_text).toBeTruthy();
      expect(L3).toContain(row.evidence_text!);
    }
  });
});

describe('beat 12b — the feedback Max owes', () => {
  it('is decided by rule, not by the model, and names what was missing', async () => {
    const h = build();
    await throughExplainBack(h);
    await settle(h.clock, h.actor.sendMessage(L2));
    await settle(h.clock, h.actor.sendMessage(L3));

    const decision = h.store.turnDecisions.forRoom(h.roomId).at(-1)!;
    expect(decision.decided_by).toBe('rule:quiz_feedback');
    expect(decision.move_type).toBe('quiz_feedback');

    const tester = h.store.participants.byAgentKey(h.roomId, 'challenger.max')!;
    const last = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(last.participant_id).toBe(tester.id);
    expect(last.body).toContain('memory being protected is the correct behaviour');
  });
});

describe('beat 13 — the whisper', () => {
  it('answers privately, offers the Critique 1 relay draft, and inserts it on approval', async () => {
    const h = build();
    await throughExplainBack(h);
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
    await throughExplainBack(h);
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
    // A later request with no marker in it — one segment's reference call — does not undo it.
    const answer = await client.complete({
      ...request('a page of nothing in particular'),
      meta: { scope: 'reference', scriptCue: 'reference:1' },
    });
    expect(client.script).toBe(SCRIPTS.critique1);
    expect(answer.text).toContain('read-only view of the session');
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

  it('answers a hand-off the script has run out of, so Max is never silent after the line', async () => {
    // A flow actor lives for the life of the process, so a second walkthrough in one session
    // cues `handoff:3`. Ellie's line comes from `flow.handOffLine()` and is posted either way;
    // without a beat behind it the camera sees "Max, over to you" and then nothing.
    const client = new ScriptedClient({ script: CRITIQUE1_SCRIPT });
    const out = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'handoff:3' },
    });
    expect(out.text.length).toBeGreaterThan(40);
    expect(out.text).toBe(fillAgentNames(CRITIQUE1_HANDOFFS.find((b) => b.cue === 'handoff:2')!.text!, rosterFor()));

    const fb = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'feedback:7' },
    });
    expect(fb.text).toContain('ephemerality');

    // Repeating a question is safe only because no hand-off beat carries a ledger block.
    for (const beat of CRITIQUE1_HANDOFFS) expect(beat.ledger).toBeUndefined();
    expect(beatFor('silence:9')).toBeUndefined();
  });

  it('answers a learner cue the script has run out of, so beat 9 is never a silence nudge', async () => {
    // The same actor-lifetime argument as the hand-off cues: `student:N` counts the *process's*
    // learner turns, so a second walkthrough reaches `student:6` and Ellie used to generate
    // empty — the learner typed, nothing came back, and 45 s later the silence timer spoke.
    const client = new ScriptedClient({ script: CRITIQUE1_SCRIPT });
    for (const cue of ['student:6', 'student:7', 'student:8', 'student:9']) {
      const out = await client.complete({
        ...request(CRITIQUE1_DECK_TEXT),
        meta: { scope: 'group', scriptCue: cue },
      });
      expect(out.text.length).toBeGreaterThan(40);
    }
    // It cycles rather than pinning one line: three teaching beats, so 6 and 9 differ.
    const at = async (cue: string) =>
      (await client.complete({ ...request(CRITIQUE1_DECK_TEXT), meta: { scope: 'group', scriptCue: cue } })).text;
    expect(await at('student:6')).not.toBe(await at('student:7'));
    expect(await at('student:6')).toBe(await at('student:9'));

    // The safety property, structural rather than conventional: every beat the cycle can reach
    // proposes no ledger element, so a repeat can never move a row a second time.
    for (const n of [6, 7, 8, 9, 10, 11]) {
      expect(beatFor(`student:${n}`)!.ledger?.elements ?? []).toHaveLength(0);
    }
    // And a ledger call on a recycled cue proposes nothing, through the client the app uses.
    const proposal = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'ledger', scriptCue: 'student:7' },
    });
    expect(JSON.parse(proposal.text).elements).toEqual([]);
  });

  it('fills the agents\u2019 names from the roster it was given, never from the script', async () => {
    // Belt and braces on the pin: even handed the pairing #16 used to be able to draw, the
    // Tester\u2019s question names whoever is actually teaching. No literal survives in the file.
    expect(CRITIQUE1_HANDOFFS.some((b) => (b.text ?? '').includes('{teacher}'))).toBe(true);
    for (const beat of [...CRITIQUE1_HANDOFFS, ...CRITIQUE1_WHISPERS]) {
      expect(beat.text ?? '').not.toMatch(/\bEllie\b|\bMax\b/);
    }

    const swapped = new ScriptedClient({ script: CRITIQUE1_SCRIPT, roster: rosterFor('ellie_challenger') });
    const out = await swapped.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'handoff:1' },
    });
    expect(out.text).toContain('Max had you on page 6');

    const pinned = new ScriptedClient({ script: CRITIQUE1_SCRIPT });
    const out2 = await pinned.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'group', scriptCue: 'handoff:1' },
    });
    expect(out2.text).toContain('Ellie had you on page 6');
  });

  it('files its ledger rows under its own concept pack', async () => {
    const client = new ScriptedClient({ material: { fileName: FIXTURE_FILE } });
    const out = await client.complete({
      ...request(CRITIQUE1_DECK_TEXT),
      meta: { scope: 'ledger', scriptCue: 'student:1' },
    });
    expect(JSON.parse(out.text).concept_id).toBe('btw-side-channel-v1');
  });
});
