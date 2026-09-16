/**
 * The turn's **status surfaces**, driven end to end on a fake clock (audit §2, issue #34).
 *
 * `actor.test.ts` proves the turn produces the right *content*; this file proves it says what it
 * is doing while it produces it — the acknowledgement in the floor-yield window, the deltas that
 * are never emitted before the floor, and the Stop that is refused until the floor has passed.
 * Same harness, same fake clock, same scripted client: no network and no real time.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { FLOOR_YIELD_MS, RoomActor, type RoomActorDeps } from './actor.js';
import { DEMO } from './flow.js';
import { ScriptedClient } from './llm/scripted.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest, type LlmResult } from './llm/types.js';

const TURN = 'So the Hessian being PSD everywhere on the domain is what makes it convex, not just at the minimum.';
const ANCHOR = 'seg_1';

function build(llm?: LLMClient) {
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
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    flowProfile: DEMO,
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
  } satisfies RoomActorDeps);
  actor.start();
  return { ...seeded, clock, events, actor };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 40_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

describe('the acknowledgement in the floor-yield window (audit P0 #3)', () => {
  it('says the room has the message before it says anything about an agent', async () => {
    const h = build();
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    // One real tick: the mailbox has written the row and the turn has started.
    await h.clock.run(1);

    const received = h.events.filter((e) => e.type === 'turn.received');
    expect(received.length).toBeGreaterThanOrEqual(1);
    const first = received[0]!;
    expect(first.type === 'turn.received' && first.received.anchorId).toBe(ANCHOR);
    // It names the learner's own row, so an optimistic block can be reconciled with it.
    const mine = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(first.type === 'turn.received' && first.received.messageId).toBe(mine.id);
    expect(first.type === 'turn.received' && first.received.yieldMs).toBe(FLOOR_YIELD_MS);
    // ...and it arrives *before* the learner's own message has even been drawn by a slow
    // renderer: what matters is that no agent chrome went out with it.
    expect(h.events.some((e) => e.type === 'agent.thinking')).toBe(false);
    await settle(h.clock, sending);
  });

  it('keeps agent chrome out of the yield window, and then lets it in', async () => {
    const h = build();
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    // The yield is `min(FLOOR_YIELD_MS, target − 1 s)`: for the Teacher's 4–6 s band that is the
    // shorter of the two, which is exactly the 3–8 s dead window the audit measured.
    await h.clock.run(2_000);
    // §C3: nothing agent-shaped in it. The acknowledgement is not agent-shaped.
    expect(h.events.some((e) => e.type === 'agent.thinking')).toBe(false);
    expect(h.events.some((e) => e.type === 'turn.received')).toBe(true);
    await settle(h.clock, sending);
    expect(h.events.some((e) => e.type === 'agent.thinking')).toBe(true);
  });

  it('names the responder and the floor target once a rule has fixed them', async () => {
    const h = build();
    // An anchored learner turn is the Teacher's by `rule:teacher_answers` — decided with no
    // model call, so the reserved slot can be sized before the yield is over.
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    await h.clock.run(1);
    const received = h.events.filter((e) => e.type === 'turn.received');
    expect(received.length).toBeGreaterThanOrEqual(2);
    const last = received.at(-1)!;
    expect(last.type === 'turn.received' && last.received.responder?.role).toBe('peer');
    expect(last.type === 'turn.received' && (last.received.etaMs ?? 0)).toBeGreaterThan(0);
    await settle(h.clock, sending);
  });

  it('closes the acknowledgement exactly once, naming the message that landed', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const released = h.events.filter((e) => e.type === 'turn.released');
    expect(released).toHaveLength(1);
    const ev = released[0]!;
    expect(ev.type === 'turn.released' && ev.stopped).toBe(false);
    const reply = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(ev.type === 'turn.released' && ev.messageId).toBe(reply.id);
    // The turn id is the log's correlation id, so one `jq` reads the whole chain back.
    const receivedId = h.events.find((e) => e.type === 'turn.received')!;
    expect(ev.type === 'turn.released' && receivedId.type === 'turn.received' && ev.turnId).toBe(
      receivedId.received.turnId,
    );
  });

  it('closes it with no message when the turn fails, so nothing is left saying "Sent…"', async () => {
    const broken: LLMClient = {
      kind: 'claude-cli',
      complete: (request: LlmRequest): Promise<LlmResult> => {
        // The orchestrator is answered by a rule on an anchored thread; only the agent's own
        // generation is reached, and that is what breaks.
        if (request.meta.scope === 'group') return Promise.reject(new Error('The Claude CLI exited 1: boom'));
        return Promise.resolve({ text: '{}', model: 'x', usage: { ...EMPTY_USAGE }, ttftMs: 0 });
      },
    };
    const h = build(broken);
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const released = h.events.filter((e) => e.type === 'turn.released');
    expect(released).toHaveLength(1);
    expect(released[0]!.type === 'turn.released' && released[0]!.messageId).toBeNull();
    // The failure card is the other agent's work and is still there — this is only about the ack.
    expect(h.events.some((e) => e.type === 'turn.failed')).toBe(true);
  });
});

/**
 * A client that streams a known body in known pieces, so a test can say exactly which of them
 * crossed the floor. The orchestrator is answered by `rule:teacher_answers` on an anchored
 * thread, so only the agent's own generation reaches this.
 */
function streamingClient(pieces: string[], opts: { ttftMs?: number } = {}): LLMClient {
  return {
    kind: 'anthropic',
    async complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult> {
      if (request.meta.scope !== 'group') {
        return { text: '{}', model: 'sonnet', usage: { ...EMPTY_USAGE }, ttftMs: 0 };
      }
      for (const piece of pieces) onDelta?.(piece);
      return {
        text: pieces.join(''),
        model: 'claude-haiku-4-5',
        usage: { ...EMPTY_USAGE },
        ttftMs: opts.ttftMs ?? 120,
        backend: 'anthropic',
      };
    },
  };
}

describe('incremental streaming behind the floor (audit P1)', () => {
  it('emits nothing before the floor, then the flush and the rest, in order', async () => {
    const pieces = ['The Hessian ', 'has to be PSD ', 'everywhere on the domain, ', 'not only at the minimum.'];
    const h = build(streamingClient(pieces));
    const sending = h.actor.sendMessage(TURN, ANCHOR);

    // The client has produced the whole reply within the first tick. Nothing may be visible.
    await h.clock.run(2_000);
    expect(h.events.some((e) => e.type === 'turn.delta')).toBe(false);

    await settle(h.clock, sending);
    const deltas = h.events.filter((e) => e.type === 'turn.delta');
    expect(deltas.length).toBeGreaterThan(0);
    // The body is exactly the concatenation of what was emitted — no piece dropped, none doubled.
    const streamed = deltas.map((e) => (e.type === 'turn.delta' ? e.text : '')).join('');
    expect(streamed).toBe(pieces.join(''));
    const reply = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(reply.body).toBe(pieces.join(''));
    // Every delta is attributed and anchored, so a renderer can place the provisional block.
    for (const d of deltas) {
      expect(d.type === 'turn.delta' && d.anchorId).toBe(ANCHOR);
      expect(d.type === 'turn.delta' && d.participant.role).toBe('peer');
    }
  });

  it('flushes what the hold accumulated as one delta, then streams the rest live', async () => {
    /** Two pieces before the floor, two after it — the flush must not swallow the tail. */
    const early = ['Right — ', 'the condition is on every z, '];
    const late = ['not on the entries, ', 'and it has to hold on all of S.'];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: LLMClient = {
      kind: 'anthropic',
      async complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult> {
        if (request.meta.scope !== 'group') {
          return { text: '{}', model: 'sonnet', usage: { ...EMPTY_USAGE }, ttftMs: 0 };
        }
        for (const piece of early) onDelta?.(piece);
        await gate;
        for (const piece of late) onDelta?.(piece);
        return { text: [...early, ...late].join(''), model: 'm', usage: { ...EMPTY_USAGE }, ttftMs: 5 };
      },
    };
    const h = build(client);
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    // Past the floor with the call still open: the buffer is flushed, the call is not waited on.
    await h.clock.run(12_000);
    const flushed = h.events.filter((e) => e.type === 'turn.delta');
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.type === 'turn.delta' && flushed[0]!.text).toBe(early.join(''));

    release!();
    await settle(h.clock, sending);
    const deltas = h.events.filter((e) => e.type === 'turn.delta');
    // One flush plus one per late piece — the tail is live, not re-buffered.
    expect(deltas).toHaveLength(1 + late.length);
    expect(deltas.map((e) => (e.type === 'turn.delta' ? e.text : '')).join('')).toBe([...early, ...late].join(''));
  });

  it('records ttft_actual_ms as the first visible token, not the model one', async () => {
    // The model answered in 120 ms; the learner saw nothing until the floor.
    const h = build(streamingClient(['Because the domain matters.'], { ttftMs: 120 }));
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const reply = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(reply.ttft_actual_ms).toBeGreaterThanOrEqual(reply.latency_target_ms!);
    expect(reply.ttft_actual_ms).not.toBe(120);
  });

  it('streams a scripted turn too, so scripted mode looks the same', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const deltas = h.events.filter((e) => e.type === 'turn.delta');
    expect(deltas.length).toBeGreaterThan(0);
    const reply = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(deltas.map((e) => (e.type === 'turn.delta' ? e.text : '')).join('')).toBe(reply.body);
    // With `chunkMs: 0` (the test default) every chunk lands inside the hold, so the learner sees
    // exactly one flush — which is the buffering rule working, not the chunking failing. The
    // chunking itself is asserted against the client in `scripted.stream.test.ts`.
    expect(deltas).toHaveLength(1);
  });
});
