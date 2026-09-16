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
import { EMPTY_USAGE, LlmAbortedError, type LLMClient, type LlmRequest, type LlmResult } from './llm/types.js';

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

describe('Stop (audit P1, Lucas 16 Sep: only after the floor)', () => {
  /** A client that streams two sentences and then hangs, which is the case Stop exists for. */
  function hangingClient(pieces: string[]): { client: LLMClient; delivered: () => number } {
    let delivered = 0;
    return {
      delivered: () => delivered,
      client: {
        kind: 'claude-cli',
        async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal) {
          if (request.meta.scope !== 'group') {
            return { text: '{}', model: 'sonnet', usage: { ...EMPTY_USAGE }, ttftMs: 0 };
          }
          for (const piece of pieces) {
            onDelta?.(piece);
            delivered += 1;
          }
          await new Promise<void>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new LlmAbortedError());
              return;
            }
            signal?.addEventListener('abort', () => reject(new LlmAbortedError()), { once: true });
          });
          throw new Error('unreachable');
        },
      },
    };
  }

  it('refuses a stop while the floor is still running', async () => {
    const { client } = hangingClient(['One. ', 'Two. ']);
    const h = build(client);
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    await h.clock.run(1);
    const turnId = h.events.find((e) => e.type === 'turn.received')!;
    const id = turnId.type === 'turn.received' ? turnId.received.turnId : '';
    // Inside the deliberate wait: the retrieval practice cannot be skipped.
    expect(h.actor.stopTurn(id)).toEqual({ stopped: false, refused: 'floor' });
    // And nothing is visible yet either, so the button has nothing to be next to.
    expect(h.events.some((e) => e.type === 'turn.delta')).toBe(false);

    await h.clock.run(12_000);
    expect(h.actor.stopTurn(id)).toEqual({ stopped: true, turnId: id });
    await settle(h.clock, sending);
  });

  it('keeps the partial as the message, flagged, and calls it neither a failure nor a reason to nudge', async () => {
    const pieces = ['A heuristic is admissible ', 'when it never overestimates. '];
    const { client } = hangingClient(pieces);
    const h = build(client);
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    await h.clock.run(12_000);
    const received = h.events.find((e) => e.type === 'turn.received')!;
    const id = received.type === 'turn.received' ? received.received.turnId : '';
    expect(h.actor.stopTurn(id)).toEqual({ stopped: true, turnId: id });
    await settle(h.clock, sending);

    const reply = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(reply.body).toBe(pieces.join('').trim());
    expect(reply.stopped).toBe(1);
    // Not a failure: no card, nothing to retry.
    expect(h.events.some((e) => e.type === 'turn.failed')).toBe(false);
    // Released once, naming the partial, and saying it was stopped.
    const released = h.events.filter((e) => e.type === 'turn.released');
    expect(released).toHaveLength(1);
    expect(released[0]!.type === 'turn.released' && released[0]!.stopped).toBe(true);
    expect(released[0]!.type === 'turn.released' && released[0]!.messageId).toBe(reply.id);
    // The floor is released — the room is open, with no turn pending against it.
    const room = h.store.rooms.get(h.roomId)!;
    expect(room.state).toBe('open');
    expect(room.pending_turn_id).toBeNull();
  });

  it('does not nudge on top of a turn the learner stopped', async () => {
    const { client } = hangingClient(['Half a thought. ']);
    const h = build(client);
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    await h.clock.run(12_000);
    const received = h.events.find((e) => e.type === 'turn.received')!;
    h.actor.stopTurn(received.type === 'turn.received' ? received.received.turnId : '');
    await settle(h.clock, sending);

    const before = h.store.messages.forRoom(h.roomId).length;
    // Well past two silence windows: the room stays quiet until the learner acts.
    await h.clock.run(150_000);
    expect(h.store.messages.forRoom(h.roomId)).toHaveLength(before);
  });

  it('aborts the client call rather than letting it run on', async () => {
    const { client } = hangingClient(['One. ']);
    const h = build(client);
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    await h.clock.run(12_000);
    const received = h.events.find((e) => e.type === 'turn.received')!;
    h.actor.stopTurn(received.type === 'turn.received' ? received.received.turnId : '');
    // The call only ever settles because the signal fired; without the abort this never resolves.
    await settle(h.clock, sending);
    expect(h.store.messages.forRoom(h.roomId).at(-1)!.stopped).toBe(1);
  });

  it('refuses a stop for a turn that is not running', async () => {
    const h = build();
    expect(h.actor.stopTurn('turn_nope')).toEqual({ stopped: false, refused: 'unknown' });
  });
});

describe('timings on the wire (audit §6 and §10)', () => {
  it('puts the ETA on the hold, so the renderer can show it on hover and not advertise it', async () => {
    const h = build();
    const sending = h.actor.sendMessage(TURN, ANCHOR);
    await settle(h.clock, sending);
    const thinking = h.events.find((e) => e.type === 'agent.thinking');
    expect(thinking).toBeDefined();
    expect(thinking!.type === 'agent.thinking' && thinking!.thinking.etaMs).toBeGreaterThan(0);
    // Plain dots for the Teacher, the climbing counter only for the Tester (§C3, Lucas 16 Sep).
    expect(thinking!.type === 'agent.thinking' && thinking!.thinking.showCounter).toBe(false);
  });

  it('carries the provenance every card needs on the message itself', async () => {
    const h = build(streamingClient(['Because the domain matters.']));
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const appended = h.events.filter((e) => e.type === 'message.appended');
    const reply = appended.at(-1)!;
    const view = reply.type === 'message.appended' ? reply.message : null;
    expect(view?.model).toBe('claude-haiku-4-5');
    expect(view?.backend).toBe('anthropic');
    expect(view?.decidedBy).toBe('rule:teacher_answers');
    expect(view?.ttftActualMs).toBeGreaterThan(0);
    expect(view?.totalMs).toBeGreaterThanOrEqual(view!.ttftActualMs!);
    expect(view?.stopped).toBe(false);
  });

  it('keeps a per-turn trace for the debug drawer, with no bodies in it', async () => {
    const h = build(streamingClient(['One sentence only.']));
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const received = h.events.find((e) => e.type === 'turn.received')!;
    const turnId = received.type === 'turn.received' ? received.received.turnId : '';

    const [trace] = h.actor.turnTrace(turnId);
    expect(trace).toBeDefined();
    expect(trace!.anchorId).toBe(ANCHOR);
    expect(trace!.trigger).toBe('student_message');
    expect(trace!.decidedBy).toBe('rule:teacher_answers');
    expect(trace!.role).toBe('peer');
    expect(trace!.backend).toBe('anthropic');
    expect(trace!.decisionMs).not.toBeNull();
    expect(trace!.generationMs).not.toBeNull();
    expect(trace!.latencyTargetMs).toBeGreaterThan(0);
    expect(trace!.totalMs).toBeGreaterThanOrEqual(trace!.ttftActualMs!);
    expect(trace!.failed).toBeNull();

    // The whole rule, asserted the way actor.test.ts asserts it of the event stream: nothing in
    // a trace may be, or contain, what anybody said.
    const serialised = JSON.stringify(h.actor.turnTrace());
    expect(serialised).not.toContain(TURN.slice(0, 20));
    expect(serialised).not.toContain('One sentence only');

    // And the whole ring comes back when no turn is named.
    expect(h.actor.turnTrace()).toHaveLength(1);
  });

  it('records a failed turn in the trace instead of dropping it', async () => {
    const broken: LLMClient = {
      kind: 'claude-cli',
      complete: (request: LlmRequest): Promise<LlmResult> =>
        request.meta.scope === 'group'
          ? Promise.reject(new Error('The Claude CLI exited 1: boom'))
          : Promise.resolve({ text: '{}', model: 'x', usage: { ...EMPTY_USAGE }, ttftMs: 0 }),
    };
    const h = build(broken);
    await settle(h.clock, h.actor.sendMessage(TURN, ANCHOR));
    const [trace] = h.actor.turnTrace();
    expect(trace!.failed).toBe('the Claude CLI exited 1');
    expect(trace!.totalMs).not.toBeNull();
  });
});
