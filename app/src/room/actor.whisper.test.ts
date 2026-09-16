/**
 * THE WHISPER POPOVER, ON A SEGMENT (`flow-build-plan.md` §3.5, `pivot-spec.md` §B5).
 *
 * Four properties, each of which is the feature rather than a detail of it:
 *
 *   1. **Ephemerality is keyed on the segment sitting.** ⌘K on another card, or in another
 *      sitting, opens an empty thread — `design-brief.md` §D5's "clears at the end of the round"
 *      with *the round* replaced by the unit a document actually has.
 *   2. **The private exchange cannot move the ledger** (R5). Asserted with the learner's own
 *      verbatim words in the whisper, which is the only thing that *could* have moved a row.
 *   3. **The relay is the only path out**, and it creates a *new shared card* on the segment.
 *   4. **The whisper does not pause the silence timer** — the shipped rule (§C.4), re-asserted
 *      here because the popover is a second way in to `sendWhisper`.
 *
 * The leak assertion itself lives in `context.test.ts`, which is where the canary is.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor } from './actor.js';
import { DEMO } from './flow.js';
import { ScriptedClient } from './llm/scripted.js';

const SEGMENT_A = 'seg_p3_lower';
const SEGMENT_B = 'seg_p4';
const SEGMENT = { label: '/btw as a whisper', page: 3, text: 'PAGE-THREE-SEGMENT-TEXT about the side channel.' };

function build() {
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
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    flowProfile: DEMO,
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

describe('the whisper popover on a segment', () => {
  it('opens Ellie-only, anchored, with her limits statement', () => {
    const h = build();
    const view = h.actor.openSegmentWhisper(SEGMENT_A);
    expect(view.anchorId).toBe(SEGMENT_A);
    expect(view.agent.role).toBe('peer');
    expect(view.turns).toEqual([]);
    // Setlur & Tory's maxims of quality and relation — the fix for the developer's own T4.
    expect(view.limitsLine).toContain("won't answer");
  });

  it('gives the same sitting the same thread, and another segment a fresh one', async () => {
    const h = build();
    const a = h.actor.openSegmentWhisper(SEGMENT_A);
    await settle(
      h.clock,
      h.actor.sendSegmentWhisper({ threadId: a.threadId, anchorId: SEGMENT_A, text: 'is this a silly question', segment: SEGMENT }),
    );

    // Reopening the same card in the same sitting shows what was said.
    const again = h.actor.openSegmentWhisper(SEGMENT_A);
    expect(again.threadId).toBe(a.threadId);
    expect(again.turns.length).toBeGreaterThanOrEqual(2);

    // A different card is a different sitting of the whisper: nothing carries over.
    const b = h.actor.openSegmentWhisper(SEGMENT_B);
    expect(b.threadId).not.toBe(a.threadId);
    expect(b.turns).toEqual([]);
  });

  it('never writes a private turn into the messages table', async () => {
    const h = build();
    const w = h.actor.openSegmentWhisper(SEGMENT_A);
    await settle(
      h.clock,
      h.actor.sendSegmentWhisper({ threadId: w.threadId, anchorId: SEGMENT_A, text: 'PRIVATE-ONLY-TEXT', segment: SEGMENT }),
    );
    const bodies = h.store.messages.forRoom(h.roomId).map((m) => m.body).join('\n');
    expect(bodies).not.toContain('PRIVATE-ONLY-TEXT');
    // And the flow snapshot the app persists across a quit carries no thread id at all.
    expect(JSON.stringify(h.actor.flowSnapshot())).not.toContain(w.threadId);
  });

  it('cannot advance the ledger, even when the private text is verbatim evidence (R5)', async () => {
    const h = build();
    const w = h.actor.openSegmentWhisper(SEGMENT_A);
    const before = h.store.ledger.forSession(h.sessionId).map((r) => `${r.element_id}:${r.level}`);
    await settle(
      h.clock,
      h.actor.sendSegmentWhisper({
        threadId: w.threadId,
        anchorId: SEGMENT_A,
        // The R1 claim, said properly, in private. In the group this is what moves a row.
        text: 'zᵀHz ≥ 0 for every vector z, everywhere on S, not just at the stationary point.',
        segment: SEGMENT,
      }),
    );
    const after = h.store.ledger.forSession(h.sessionId).map((r) => `${r.element_id}:${r.level}`);
    expect(after).toEqual(before);
  });

  it('does not pause the silence timer', async () => {
    const h = build();
    await settle(h.clock, h.actor.open(), 12_000);
    const armed = h.actor.snapshot().timer.deadlineTs;
    const w = h.actor.openSegmentWhisper(SEGMENT_A);
    // Well inside the 50 s window, so the only thing that could have moved the deadline is the
    // whisper itself.
    await settle(
      h.clock,
      h.actor.sendSegmentWhisper({ threadId: w.threadId, anchorId: SEGMENT_A, text: 'quick one', segment: SEGMENT }),
      5_000,
    );
    // Whispering is not explaining to the group; if it bought silence the private channel
    // would be the efficient path (architecture-mac.md §C.4).
    expect(h.actor.snapshot().timer.deadlineTs).toBe(armed);
  });

  it('relays into the document as a new shared card on the segment, and moves no row', async () => {
    const h = build();
    const w = h.actor.openSegmentWhisper(SEGMENT_A);
    await settle(
      h.clock,
      h.actor.sendSegmentWhisper({ threadId: w.threadId, anchorId: SEGMENT_A, text: 'does asking here cost context', segment: SEGMENT }),
    );
    const reply = h.store.whispers.forThread(w.threadId).find((t) => t.sender === 'agent')!;
    const before = h.store.ledger.forSession(h.sessionId).map((r) => `${r.element_id}:${r.level}`);

    const approved = 'Can we put the page 6 claim on the record: the cost has moved, not disappeared.';
    const { messageId } = await settle(
      h.clock,
      h.actor.relay({ threadId: w.threadId, whisperId: reply.id, attribution: 'as_me', text: approved, anchorId: SEGMENT_A }),
    );

    const card = h.store.messages.forRoom(h.roomId).find((m) => m.id === messageId)!;
    expect(card.anchor_id).toBe(SEGMENT_A);
    expect(card.body).toBe(approved);
    expect(card.promoted_from_whisper).toBe(reply.id);
    // The private turn is not moved and not revealed: only the approved text crossed.
    expect(card.body).not.toContain('does asking here cost context');
    expect(h.store.whispers.forThread(w.threadId)).toHaveLength(2);
    // R5 again, on the relay path: an approved relay is not evidence either.
    expect(h.store.ledger.forSession(h.sessionId).map((r) => `${r.element_id}:${r.level}`)).toEqual(before);
  });

  it('holds the Tester off while the popover is open (R4)', async () => {
    const h = build();
    h.actor.openSegmentWhisper(SEGMENT_A);
    await settle(h.clock, h.actor.sendMessage('here is my explanation of the condition', SEGMENT_A));
    const handOff = h.events.find(
      (e) => e.type === 'notice' || (e.type === 'message.appended' && e.message.byRule === 'handoff'),
    );
    expect(handOff).toBeUndefined();
    h.actor.closeSegmentWhisper();
  });
});
