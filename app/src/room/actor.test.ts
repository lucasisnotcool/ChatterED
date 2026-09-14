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
import { RoomActor } from './actor.js';
import { ScriptedClient } from './llm/scripted.js';
import { buildGroupContext } from './context.group.js';

const TURN_2 =
  'Basically if the Hessian is positive semidefinite then the function is convex. That is the second-order condition, so you compute the Hessian, check it is PSD, and you are done.';
const TURN_4 =
  'At the point you are checking, I guess. Like at the minimum — you check the Hessian at the stationary point and if it is PSD it is a min, so it is convex there.';
const TURN_7 =
  "Right — it's zᵀHz ≥ 0 for every vector z, not the entries. It has to be PSD everywhere on S, not just at the stationary point. I was mixing this up with the second-order condition for a local min.";

function build(mode: 'scripted' = 'scripted') {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm: new ScriptedClient(),
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    config: { ...DEFAULT_ROOM_CONFIG, mode },
    appVersion: '0.1.0-test',
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

  it('holds the Challenger for its latency floor and shows nothing for the first 8 s', async () => {
    const h = build();
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

    const challenge = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(challenge.body).toContain('PSD **where**?');
    expect(challenge.latency_target_ms).toBeGreaterThanOrEqual(9_000);
    expect(challenge.latency_target_ms).toBeLessThanOrEqual(12_000);
    expect(Date.parse(challenge.created_at) - before).toBeGreaterThanOrEqual(9_000);

    const thinking = h.events.find((e) => e.type === 'agent.thinking');
    expect(thinking && thinking.type === 'agent.thinking' && thinking.thinking.showCounter).toBe(true);
    expect(thinking && thinking.type === 'agent.thinking' && thinking.thinking.verb).toBe('thinking');
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
    await settle(h.clock, h.actor.sendWhisper(thread.threadId, 'does PSD just mean all the entries are ≥ 0?'));

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
    expect(recap.teachbackOffer?.displayName).toBe('Theo');
    expect(h.store.rooms.get(h.roomId)!.state).toBe('closed');
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
