/**
 * The room actor, driven end to end on a fake clock against the scripted client.
 * No network, no real time: the whole eleven-turn session in ~200 ms of test.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { CONTENT_FREE_NUDGES, RoomActor } from './actor.js';
import { DEMO, openSession, type TaughtItem } from './flow.js';
import { ScriptedClient } from './llm/scripted.js';
import { buildGroupContext } from './context.group.js';
import type { RoomActorDeps } from './actor.js';
import type { LLMClient, LlmRequest, LlmResult, LlmScope } from './llm/types.js';

/**
 * A sitting that satisfies flow-session.md §8.2: two concepts taught comfortably past the 3 min
 * UI guard, and three learner turns inside the 10 min window.
 */
function readySitting(clock: FakeClock): RoomActorDeps['flowState'] {
  const now = clock.now();
  let session = openSession({ id: 'fs_ready', documentId: 'room_test' }, now - 8 * 60_000);
  session = {
    ...session,
    lastActivityAt: now,
    gapDeadlineTs: now + session.profile.sessionGapMs,
    learnerTurns: [now - 180_000, now - 120_000, now - 60_000],
  };
  const taught: TaughtItem[] = [
    { elementId: 'R1', taughtAt: now - 7 * 60_000, by: 'teacher', sessionId: 'fs_ready', label: 'the PSD condition' },
    { elementId: 'R2', taughtAt: now - 6 * 60_000, by: 'teacher', sessionId: 'fs_ready', label: 'the domain' },
  ];
  return { session, taught };
}

const TURN_2 =
  'Basically if the Hessian is positive semidefinite then the function is convex. That is the second-order condition, so you compute the Hessian, check it is PSD, and you are done.';
const TURN_4 =
  'At the point you are checking, I guess. Like at the minimum — you check the Hessian at the stationary point and if it is PSD it is a min, so it is convex there.';
const TURN_7 =
  "Right — it's zᵀHz ≥ 0 for every vector z, not the entries. It has to be PSD everywhere on S, not just at the stationary point. I was mixing this up with the second-order condition for a local min.";

/**
 * `flowState` primes the flow session the way a relaunch would (`actor.flowSnapshot()` is what
 * the app persists). It is how a test reaches the hand-off: since #32/#33 the Tester is eligible
 * **only** when `handOffDue()` says the sitting is ready, so a room with an empty taught set can
 * never put Max on the floor, whatever the orchestrator's model asks for.
 */
function build(mode: 'scripted' = 'scripted', flowState?: RoomActorDeps['flowState'], llm?: RoomActorDeps['llm']) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm: llm ?? new ScriptedClient(),
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    config: { ...DEFAULT_ROOM_CONFIG, mode },
    appVersion: '0.1.0-test',
    flowProfile: DEMO,
    flowState,
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

describe('the room actor', () => {
  it('opens with the Peer and then hands the floor to the learner', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const messages = h.store.messages.forRoom(h.roomId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain("I'm curious how you'd set this one up");
    const peerParticipant = h.store.participants.byAgentKey(h.roomId, 'peer.ellie');
    expect(messages[0]!.participant_id).toBe(peerParticipant!.id);
    // The timer is armed as soon as the room is the learner's.
    expect(h.store.rooms.get(h.roomId)!.deadline_ts).not.toBeNull();
  });

  it('holds the Tester for its latency floor and shows nothing for the first 8 s', async () => {
    // Max only ever reaches the floor through the hand-off now (#33), so the sitting is primed
    // to satisfy the flow rule. The latency band itself is unchanged and is a report paragraph.
    const clock = new FakeClock();
    const h = build('scripted', readySitting(clock));
    await settle(h.clock, h.actor.open());
    const before = h.clock.now();
    const events: RoomEvent[] = [];
    h.events.length = 0;

    const sending = h.actor.sendMessage(TURN_2);
    // Floor-yield window: no indicator at all in the first 8 s.
    await h.clock.run(7_000);
    events.push(...h.events);
    expect(events.some((e) => e.type === 'agent.thinking')).toBe(false);
    await settle(h.clock, sending);

    const messages = h.store.messages.forRoom(h.roomId);
    // Two rows, in this order: Ellie's hand-off line, written by `flow.handOffLine()` and not by
    // the model, then Max's one question. The line is what makes the rule visible on camera.
    const line = messages.at(-2)!;
    expect(line.model).toBe('rule:handoff');
    expect(line.body).toMatch(/^You've covered .* — Max, over to you\.$/);

    const challenge = messages.at(-1)!;
    expect(challenge.body).toContain('give me a matrix');
    expect(challenge.latency_target_ms).toBeGreaterThanOrEqual(9_000);
    expect(challenge.latency_target_ms).toBeLessThanOrEqual(12_000);
    expect(Date.parse(challenge.created_at) - before).toBeGreaterThanOrEqual(9_000);

    const thinking = h.events.find((e) => e.type === 'agent.thinking');
    expect(thinking && thinking.type === 'agent.thinking' && thinking.thinking.showCounter).toBe(true);
    // §B9: the Tester's hold names an act — `Max is reading…` — not a mental state.
    expect(thinking && thinking.type === 'agent.thinking' && thinking.thinking.verb).toBe('reading');
  });

  it('moves the ledger inside the hold, quoting the learner verbatim', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    h.events.length = 0;
    await settle(h.clock, h.actor.sendMessage(TURN_2));

    const ledgerEvent = h.events.find((e) => e.type === 'ledger.updated');
    const messageEvent = h.events.findIndex((e) => e.type === 'message.appended' && e.message.speaker.kind === 'agent');
    expect(ledgerEvent).toBeDefined();
    // The rail moves BEFORE the challenge lands — acknowledged, then pressed.
    expect(h.events.indexOf(ledgerEvent!)).toBeLessThan(messageEvent);

    const r1 = h.store.ledger.forSession(h.sessionId).find((r) => r.element_id === 'R1')!;
    expect(r1.level).toBe(1);
    expect(r1.evidence_text).toBeTruthy();
    expect(TURN_2).toContain(r1.evidence_text!);
  });

  it('says nothing when the script yields, then lets the silence timer step in', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    await settle(h.clock, h.actor.sendMessage(TURN_4));
    const countBefore = h.store.messages.forRoom(h.roomId).length;

    // 45 s of no keystrokes.
    await h.clock.run(50_000);
    const messages = h.store.messages.forRoom(h.roomId);
    expect(messages.length).toBe(countBefore + 1);
    const nudge = messages.at(-1)!;
    expect(nudge.divider_cause).toBe('45s quiet · Ellie stepped in');
    // Stage 1 is content-free: it is drawn from the pool, never generated against the concept.
    expect(nudge.body).not.toMatch(/Hessian|PSD|convex/i);
    expect(nudge.model).toBe('pool:content_free');
  });

  it('does not nudge while the learner is typing', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const count = h.store.messages.forRoom(h.roomId).length;
    for (let i = 0; i < 12; i += 1) {
      await h.clock.run(3_000);
      h.actor.typing();
    }
    expect(h.store.messages.forRoom(h.roomId).length).toBe(count);
  });

  it('cancels a held reply when the learner speaks again, and never posts it', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const first = h.actor.sendMessage(TURN_2);
    await h.clock.run(5_000); // the Challenger is mid-hold
    const second = h.actor.sendMessage(TURN_4);
    await settle(h.clock, Promise.all([first, second]));

    const bodies = h.store.messages.forRoom(h.roomId).map((m) => m.body);
    expect(bodies.filter((b) => b.includes('PSD **where**?'))).toHaveLength(0);
    const errors = h.store.events
      .forSession(h.sessionId)
      .filter((e) => e.type === 'agent.turn.error')
      .map((e) => JSON.parse(e.payload) as { cause: string });
    expect(errors.some((e) => e.cause === 'cancelled_by_student')).toBe(true);
  });

  it('runs a whisper without touching the group transcript, the timer or the ledger', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    const ledgerBefore = h.store.ledger.forSession(h.sessionId).map((r) => r.level);
    const groupBefore = h.store.messages.forRoom(h.roomId).length;

    const thread = h.actor.openWhisper('peer.ellie');
    expect(thread.limitsLine).toContain("won't answer");
    // 8 s, not 30: a whisper is held 1–2 s, and a longer window would let the *silence timer*
    // add a group message, which would be the timer working correctly and this test failing for
    // the wrong reason. Whispers deliberately do not pause that clock (architecture-mac.md §C.4).
    await settle(h.clock, h.actor.sendWhisper(thread.threadId, 'does PSD just mean all the entries are ≥ 0?'), 8_000);

    const turns = h.store.whispers.forThread(thread.threadId);
    expect(turns).toHaveLength(2);
    expect(turns[1]!.body).toContain('entrywise-positive');
    expect(turns[1]!.relay_offer).toBeTruthy();
    // Group transcript untouched, ledger untouched.
    expect(h.store.messages.forRoom(h.roomId).length).toBe(groupBefore);
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.level)).toEqual(ledgerBefore);
    // And no whisper body is anywhere in the group transcript.
    const groupText = h.store.messages.forRoom(h.roomId).map((m) => m.body).join('\n');
    expect(groupText).not.toContain('entrywise-positive');
  });

  it('relays an approved whisper into the group as the agent, with provenance but no badge text', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    const thread = h.actor.openWhisper('peer.ellie');
    await settle(h.clock, h.actor.sendWhisper(thread.threadId, 'does PSD just mean all the entries are ≥ 0?'));
    const offerTurn = h.store.whispers.forThread(thread.threadId).at(-1)!;
    const offer = JSON.parse(offerTurn.relay_offer!) as { draftText: string };

    await settle(
      h.clock,
      h.actor.relay({
        threadId: thread.threadId,
        whisperId: offerTurn.id,
        attribution: 'as_agent',
        text: offer.draftText,
      }),
    );

    const relayed = h.store.messages.forRoom(h.roomId).find((m) => m.promoted_from_whisper !== null)!;
    expect(relayed.body).toContain('Can we pin the definition down');
    const peer = h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!;
    expect(relayed.participant_id).toBe(peer.id);
    // The provenance is in the row for the research export; the body carries no marker.
    expect(relayed.body).not.toMatch(/whisper|promoted/i);
  });

  it('composes a recap from what actually happened', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    await settle(h.clock, h.actor.sendMessage(TURN_4));
    await settle(h.clock, h.actor.sendMessage(TURN_7));
    const recap = await settle(h.clock, h.actor.wrapUp());

    expect(recap.conceptTitle).toBe('Convexity and the Hessian');
    expect(recap.before.every((r) => r.state === 'not_yet')).toBe(true);
    expect(recap.after.some((r) => r.state !== 'not_yet')).toBe(true);
    expect(h.store.rooms.get(h.roomId)!.state).toBe('closed');
  });

  /**
   * The recap, after ui-review-ux.md M9. Three things it used to get wrong on the one screen
   * the whole design points at: it printed "0 claims established · 0 defended under challenge ·
   * 0 revisited" (a score, P5), it offered Theo with a completely empty ledger (§B6: an
   * unavailable reward is a punishment), and "what stayed open" came out as `What about <the
   * whole claim>.?`.
   */
  it('describes what the learner did, and never scores it', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    await settle(h.clock, h.actor.sendMessage(TURN_4));
    await settle(h.clock, h.actor.sendMessage(TURN_7));
    const recap = await settle(h.clock, h.actor.wrapUp());

    const labels = recap.actProfile.map((a) => a.label);
    expect(labels).toContain('turns you took');
    expect(recap.actProfile.find((a) => a.label === 'turns you took')!.count).toBe(3);
    // Nothing that reads as a mark out of five.
    expect(labels).not.toContain('claims established');
    expect(labels).not.toContain('defended under challenge');
    // A count of zero is never printed: the block is dropped, not filled with zeroes.
    expect(recap.actProfile.every((a) => a.count > 0)).toBe(true);
  });

  it('offers no act profile at all when the learner said nothing', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const recap = await settle(h.clock, h.actor.wrapUp());
    expect(recap.actProfile).toEqual([]);
  });

  /**
   * Theo has left the standing roster (#32): a teach-back *is* a quiz, so it folded into the
   * Tester's question. `acceptTeachback` and `teachbackOffer` still compile — the shared types,
   * the IPC surface and `RecapCard.svelte` are untouched — but there is no tutee in the roster
   * any more, so the offer is structurally unreachable rather than merely unbuilt. That is the
   * §B6 rule satisfied by construction: an unavailable reward is never shown.
   */
  it('never offers the teach-back, because Theo is no longer in the roster', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    const recap = await settle(h.clock, h.actor.wrapUp());
    expect(h.actor.snapshot().agents.map((a) => a.role)).toEqual(['peer', 'challenger']);
    expect(recap.teachbackOffer).toBeNull();
  });

  it('states what is still open instead of asking a mangled question', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    const recap = await settle(h.clock, h.actor.wrapUp());
    for (const q of recap.openQuestions) {
      expect(q).toMatch(/^Nothing yet on /);
      expect(q).not.toContain('.?');
      expect(q.endsWith('.')).toBe(true);
    }
  });

  it('turns down a teach-back invitation for an agent who is not in the room', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const result = h.actor.acceptTeachback('tutee.theo');
    expect(result.available).toBe(false);
    expect(result.note).toContain('not in this room');
  });

  it('opens the room with a round card built from this session\'s own pack', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    // `build()` runs in scripted mode, where the fixed pack *is* the session, so the assertion
    // that matters is the wiring: the card comes from the pack, not from a constant.
    expect(h.actor.snapshot().roundCard.body).toContain('convexity and the Hessian');
  });

  it('writes an event stream with no message bodies in it', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.sendMessage(TURN_2));
    const events = h.store.events.forSession(h.sessionId);
    const types = events.map((e) => e.type);
    expect(types).toContain('session.start');
    expect(types).toContain('message.send');
    expect(types).toContain('agent.turn.plan');
    expect(types).toContain('agent.turn.dispatched');
    expect(types).toContain('progress.update');
    // evaluation-plan.md §7.2: the event stream never contains message bodies.
    const payloads = events.map((e) => e.payload).join('\n');
    expect(payloads).not.toContain(TURN_2.slice(0, 40));
  });
});

describe('"Show the room" (issue #22 decision 4)', () => {
  const REF = {
    fileId: 'f_xu',
    fileName: 'who-you-explain-to-matters.pdf',
    relPath: 'Sources/who-you-explain-to-matters.pdf',
    kind: 'pdf',
    pageFrom: 3,
    pageTo: 3,
    selection: 'learning by explaining to conversational agents',
    pageText: 'PAGE-THREE-BODY about pedagogical roles and the Challenger agent',
  };

  it('posts the reference as a learner message with a card, and not as the page text', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.showDocument(REF));

    const student = h.store.participants.student(h.roomId)!;
    const mine = h.store.messages.forRoom(h.roomId).filter((m) => m.participant_id === student.id);
    expect(mine).toHaveLength(1);
    const row = mine[0]!;

    // The visible line names the file and the page, and carries none of the document.
    expect(row.body).toContain('who-you-explain-to-matters.pdf');
    expect(row.body).toContain('p. 3');
    expect(row.body).not.toContain('PAGE-THREE-BODY');
    expect(row.body).not.toContain(REF.selection);

    // The ledger can only ever quote a learner message verbatim, so keeping the document text
    // out of `body` is what stops a slide becoming "evidence the learner explained it".
    const ref = h.store.messageRefs.forMessage(row.id)!;
    expect(ref.page_text).toContain('PAGE-THREE-BODY');
    expect(ref.page_from).toBe(3);

    // The emitted view carries the card, on the first emission — not after a refresh.
    const appended = h.events.filter((e) => e.type === 'message.appended');
    const emitted = appended.find((e) => e.type === 'message.appended' && e.message.id === row.id);
    expect(emitted && emitted.type === 'message.appended' && emitted.message.reference).toMatchObject({
      fileName: 'who-you-explain-to-matters.pdf',
      pageFrom: 3,
      pageTo: 3,
    });
    // …and the snapshot rebuilds it from the row, not from the event that was emitted.
    const inSnapshot = h.actor.snapshot().messages.find((m) => m.id === row.id);
    expect(inSnapshot?.reference?.fileName).toBe('who-you-explain-to-matters.pdf');
    expect(inSnapshot?.reference?.selection).toBe(REF.selection);
  });

  it('reaches the agents through the message stream, and never through system[0]', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.showDocument(REF));

    const request = buildGroupContext(groupView(h.store), {
      roomId: h.roomId,
      speaker: rosterFor('ellie_peer')[0]!,
      roster: rosterFor('ellie_peer'),
      pack: PSD_HESSIAN_CONVEXITY_V1,
      directive: { agentRole: 'peer', move: 'ask what they make of it' },
    });

    expect(JSON.stringify(request.messages)).toContain('PAGE-THREE-BODY');
    expect(JSON.stringify(request.messages)).toContain(REF.selection);
    // architecture-mac.md §E.3 L1119: the prefix is frozen at pack confirmation. A document
    // brought in mid-session must not touch it.
    expect(JSON.stringify(request.system)).not.toContain('PAGE-THREE-BODY');
  });

  it('is a learner turn: it cancels a held reply and resets the silence timer', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    const before = h.actor.snapshot().timer.epoch;
    await settle(h.clock, h.actor.showDocument(REF));
    const after = h.actor.snapshot();
    // §C3 L731: a held reply is cancelled, not queued, when the learner uses the floor.
    expect(after.timer.epoch).toBeGreaterThan(before);
    expect(after.state).not.toBe('agent_speaking');
  });

  it('says "the whole file" when there is no page range', async () => {
    const h = build();
    await settle(h.clock, h.actor.open());
    await settle(h.clock, h.actor.showDocument({ ...REF, pageFrom: null, pageTo: null, selection: null }));
    const student = h.store.participants.student(h.roomId)!;
    const row = h.store.messages.forRoom(h.roomId).find((m) => m.participant_id === student.id)!;
    expect(row.body).not.toContain('p. ');

    const request = buildGroupContext(groupView(h.store), {
      roomId: h.roomId,
      speaker: rosterFor('ellie_peer')[0]!,
      roster: rosterFor('ellie_peer'),
      pack: PSD_HESSIAN_CONVEXITY_V1,
      directive: { agentRole: 'peer', move: 'ask' },
    });
    expect(JSON.stringify(request.messages)).toContain('the whole file');
  });
});

/**
 * **A turn always ends in something the learner can see.**
 *
 * The regression these guard is room_6a9609d5c6fb, 2026-09-16 02:30:33–02:32:33: a learner
 * message, a 20 s orchestrator call, a decision with a move and no speaker, no dispatch, no card,
 * no notice — and then the silence timer nudging the learner twice, with the same line, for
 * being quiet about a question the app had failed to answer.
 */
class FailingClient implements LLMClient {
  readonly kind = 'scripted' as const;
  #inner = new ScriptedClient();
  constructor(private readonly failScopes: LlmScope[]) {}
  async complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult> {
    if (this.failScopes.includes(request.meta.scope)) throw new Error('The Claude CLI exited 1: boom');
    return this.#inner.complete(request, onDelta);
  }
}

describe('a failed turn', () => {
  it('puts a card in the thread instead of nothing, and names what broke', async () => {
    const h = build('scripted', undefined, new FailingClient(['group']));
    await settle(h.clock, h.actor.sendMessage(TURN_2, 'seg_1'));

    const failed = h.events.filter((e) => e.type === 'turn.failed');
    expect(failed).toHaveLength(1);
    const view = (failed[0] as Extract<RoomEvent, { type: 'turn.failed' }>).failure;
    expect(view.kind).toBe('turn');
    expect(view.anchorId).toBe('seg_1');
    expect(view.displayName).toBe('Ellie');
    // The class of the error, not its text: no prompt, no body, no key ever reaches the card.
    expect(view.reason).toBe('the Claude CLI exited 1');
    expect(h.actor.snapshot().failures).toHaveLength(1);
  });

  it('does not nudge on top of itself — the timer is held until the learner acts', async () => {
    const h = build('scripted', undefined, new FailingClient(['group']));
    await settle(h.clock, h.actor.sendMessage(TURN_2, 'seg_1'));
    // Well past stage 1 (45 s) and stage 2 (90 s). Before this fix, two nudges landed here.
    await h.clock.run(200_000);
    expect(h.events.some((e) => e.type === 'message.appended')).toBe(true);
    expect(h.store.rooms.get(h.roomId)!.deadline_ts).toBeNull();
    const agentTurns = h.store.messages
      .forRoom(h.roomId)
      .filter((m) => m.model === 'pool:content_free');
    expect(agentTurns).toHaveLength(0);
  });

  it('re-arms the timer once the learner speaks again', async () => {
    const h = build('scripted', undefined, new FailingClient(['group']));
    await settle(h.clock, h.actor.sendMessage(TURN_2, 'seg_1'));
    expect(h.store.rooms.get(h.roomId)!.deadline_ts).toBeNull();
    h.events.length = 0;
    await settle(h.clock, h.actor.sendMessage(TURN_4, 'seg_1'));
    // The card for that thread is withdrawn: the learner has moved past the turn that failed.
    expect(h.events.some((e) => e.type === 'turn.failed.cleared')).toBe(true);
  });

  it('replays the same turn on Retry, and the card goes away', async () => {
    const client = new FailingClient(['group']);
    const h = build('scripted', undefined, client);
    await settle(h.clock, h.actor.sendMessage(TURN_2, 'seg_1'));
    const view = (h.events.find((e) => e.type === 'turn.failed') as Extract<RoomEvent, { type: 'turn.failed' }>).failure;

    // The backend comes back.
    (client as unknown as { failScopes: LlmScope[] }).failScopes = [];
    h.events.length = 0;
    await settle(h.clock, h.actor.retryTurn(view.id));

    expect(h.events.some((e) => e.type === 'turn.failed.cleared')).toBe(true);
    expect(h.actor.snapshot().failures).toHaveLength(0);
    // A real agent message landed this time, in the same thread.
    const last = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(last.anchor_id).toBe('seg_1');
    expect(last.participant_id).toBe(h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!.id);
  });

  it('surfaces a ledger failure without pretending nobody replied', async () => {
    const h = build('scripted', undefined, new FailingClient(['ledger']));
    await settle(h.clock, h.actor.sendMessage(TURN_2, 'seg_1'));
    const view = (h.events.find((e) => e.type === 'turn.failed') as Extract<RoomEvent, { type: 'turn.failed' }>).failure;
    expect(view.kind).toBe('ledger');
    expect(view.displayName).toBeNull();
    // Ellie still spoke, and the timer is still running: the reply arrived, only the rail did not.
    expect(h.store.messages.forRoom(h.roomId).at(-1)!.model).not.toBe('pool:content_free');
    expect(h.store.rooms.get(h.roomId)!.deadline_ts).not.toBeNull();
  });
});

describe('the stage-1 nudge pool', () => {
  it('rotates, so the same line never lands twice running', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage(TURN_2, 'seg_1'));
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await h.clock.run(50_000);
      const nudges = h.store.messages.forRoom(h.roomId).filter((m) => m.model === 'pool:content_free');
      const last = nudges.at(-1);
      if (last && seen.at(-1) !== last.body) seen.push(last.body);
      // A new round so the two-fires-per-round budget does not run out mid-test.
      await settle(h.clock, h.actor.sendMessage(TURN_4, 'seg_1'));
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1]);
    for (const line of seen) expect(CONTENT_FREE_NUDGES).toContain(line);
  });
});
