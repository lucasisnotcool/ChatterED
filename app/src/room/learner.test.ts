/**
 * **The learner model the Teacher reads every turn** (issue #41,
 * `conversation-refinement.md` §3), asserted on the prompt the **real actor** actually builds,
 * through the real `buildGroupContext`, on a fake clock.
 *
 * Lucas's diagnosis of the third #41 transcript is the specification: *"the original reference was
 * essentially useless, by pitching content at the same level of expected understanding without
 * establishing what a student grasps."* Three things are checked here, and all three are things
 * the app already knew and never said: what is online, what the deck assumes and the learner has
 * not met, and what they have twice asked for.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor, type RoomActorDeps } from './actor.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';
import { DEFAULT_PITCH, notePitch, pitchLine, pitchSignal } from '../core/pitch.js';
import { learnerBlock } from './prompts.js';

const REPLY = 'Positive semidefinite means zᵀHz ≥ 0 for every vector z.';

function client(): LLMClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    kind: 'claude-cli',
    requests,
    async complete(request, onDelta) {
      requests.push(request);
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
      }
      onDelta?.(REPLY);
      return { text: REPLY, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client();
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm,
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    models: API_PLAN,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'live' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    ...over,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 30_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

/** The last Teacher turn's directive — the text after every cache breakpoint. */
function directive(llm: { requests: LlmRequest[] }): string {
  const group = llm.requests.filter((r) => r.meta.scope === 'group');
  const last = group.at(-1)!;
  return last.messages.at(-1)!.content;
}

describe('the pitch, per file', () => {
  it('reads the three corrections from #41 and moves the level once each', () => {
    expect(pitchSignal('hmm can you explain it simpler')).toEqual({ direction: -1, phrase: 'simpler' });
    expect(pitchSignal('but what does it actually mean? you are justing reading the slides back to me')?.direction).toBe(-1);
    expect(pitchSignal('What are the traits of an MDP? ELI5')?.direction).toBe(-1);
    expect(pitchSignal('give me the rigorous version and the mathematical properties')?.direction).toBe(1);
    expect(pitchSignal('what is stochastic?')).toBeNull();
  });

  /**
   * The one #41 message that contains both directions: *"too complicated, can you explain
   * stochastic as a concept, what it means, then the rigorous version"*. It is a complaint about
   * where the answer **started**, so it lowers.
   */
  it('lowers when a message asks for both, because that is what "too complicated, then rigorous" means', () => {
    const signal = pitchSignal(
      'too complicated, can you explain stochastic as a concept, what it means, then the rigourous version, mathematical properties etc.',
    );
    expect(signal?.direction).toBe(-1);
  });

  it('clamps at one level in each direction and takes a raise straight back', () => {
    let state = DEFAULT_PITCH;
    for (const said of ['simpler', 'ELI5 please', 'no idea', 'too complicated']) {
      state = notePitch(state, said, 1_000);
    }
    expect(state.level).toBe(-1);
    expect(state.signals).toHaveLength(3);
    state = notePitch(state, 'actually give me the rigorous statement', 2_000);
    expect(state.level).toBe(0);
  });

  it('says "ordinary" until something is said, and quotes what was said after', () => {
    expect(pitchLine(DEFAULT_PITCH)).toContain('ordinary');
    const lowered = notePitch(DEFAULT_PITCH, 'can you explain it simpler', 1_000);
    expect(pitchLine(lowered)).toContain('lower than the slide');
    expect(pitchLine(lowered)).toContain('“simpler”');
  });
});

describe('learnerBlock', () => {
  const pitch = pitchLine(DEFAULT_PITCH);

  it('with no evidence at all, says assume less — not "unknown, carry on"', () => {
    const block = learnerBlock({ objectives: [], evidence: [], pitchLine: pitch });
    expect(block).toContain('no evidence');
    expect(block).toContain('assume less');
    // And it forbids the turn #36 is about spending: asking what they already know.
    expect(block).toContain('do not open by asking what they already know');
  });

  it('lists an online objective as known, and a stated one as not yet explained', () => {
    const block = learnerBlock({
      objectives: [
        { title: 'Define positive semidefinite', level: 2, assumedByDeck: false },
        { title: 'State the convexity theorem', level: 1, assumedByDeck: false },
        { title: 'Apply it to a Hessian', level: 0, assumedByDeck: false },
      ],
      evidence: [{ label: 'PSD', quote: 'it is about z transpose H z being at least zero' }],
      pitchLine: pitch,
    });
    expect(block).toContain('explained these in their own words');
    expect(block).toContain('- Define positive semidefinite');
    expect(block).toContain('not explained them');
    expect(block).toContain('- State the convexity theorem');
    expect(block).toContain('Not yet touched: Apply it to a Hessian.');
    expect(block).toContain('“it is about z transpose H z being at least zero”');
    // The default is gone once there is anything at all.
    expect(block).not.toContain('no evidence');
  });

  it('names an untouched prerequisite the deck assumes, and says to teach it first', () => {
    const block = learnerBlock({
      objectives: [
        { title: 'Eigenvalues of a symmetric matrix', level: 0, assumedByDeck: true },
        { title: 'Define positive semidefinite', level: 2, assumedByDeck: false },
      ],
      evidence: [],
      pitchLine: pitch,
    });
    expect(block).toContain('assumes');
    expect(block).toContain('- Eigenvalues of a symmetric matrix');
    expect(block).toContain('before');
  });
});

describe('through the real actor', () => {
  it('puts the learner block in the Teacher’s directive, with assume-less by default', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is positive semidefinite?', 'seg_3'));

    const text = directive(h.llm);
    expect(text).toContain('WHAT THIS LEARNER HAS SHOWN YOU, ON THIS FILE');
    expect(text).toContain('assume less');
    expect(text).toContain('PITCH: ordinary');
  });

  it('lowers the pitch when the learner says "simpler", and the next turn’s prompt says so', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is positive semidefinite?', 'seg_3'));
    expect(directive(h.llm)).toContain('PITCH: ordinary');

    await settle(h.clock, h.actor.sendMessage('hmm can you explain it simpler', 'seg_3'));

    const text = directive(h.llm);
    expect(text).toContain('PITCH: **lower than the slide’s.**');
    expect(text).toContain('“simpler”');
    expect(text).toContain('do not drift back up');
    // It is on the record as a decision the app made, not a mood it caught.
    expect(h.store.events.forSession(h.sessionId).some((e) => e.type === 'flow.pitch')).toBe(true);
  });

  it('carries the pitch across a quit, and drops it on Reset', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('no idea, can you say that simpler', 'seg_3'));
    const saved = h.actor.flowSnapshot();
    expect(saved.pitch.level).toBe(-1);

    // Reopened on the stored state: the same learner, the same file, the same request.
    const reopened = build({ flowState: saved });
    await settle(reopened.clock, reopened.actor.sendMessage('and what about the Hessian?', 'seg_3'));
    expect(directive(reopened.llm)).toContain('lower than the slide');

    // Reset is the learner saying "forget what you think you know about me on this file".
    reopened.actor.resetTaught();
    await settle(reopened.clock, reopened.actor.sendMessage('and the eigenvalues?', 'seg_3'));
    expect(directive(reopened.llm)).toContain('PITCH: ordinary');
  });

  it('lists an online objective as known, from the callback the main process supplies', async () => {
    const h = build({
      learnerObjectives: () => [
        { title: 'Define positive semidefinite', level: 2, assumedByDeck: false },
        { title: 'Eigenvalues of a symmetric matrix', level: 0, assumedByDeck: true },
      ],
    });
    await settle(h.clock, h.actor.sendMessage('so what does convexity add?', 'seg_3'));

    const text = directive(h.llm);
    expect(text).toContain('explained these in their own words');
    expect(text).toContain('- Define positive semidefinite');
    expect(text).toContain('- Eigenvalues of a symmetric matrix');
    expect(text).not.toContain('no evidence');
  });

  /** The Tester's turn is not the place for it: he quizzes from `quizSeeds`, not from a model. */
  it('does not put it in the Tester’s directive', async () => {
    const h = build({ learnerObjectives: () => [{ title: 'Define PSD', level: 2, assumedByDeck: false }] });
    await settle(h.clock, h.actor.sendMessage('what is positive semidefinite?', 'seg_3'));
    const group = h.llm.requests.filter((r) => r.meta.scope === 'group');
    for (const request of group) {
      if (request.meta.agentKey?.startsWith('challenger')) {
        expect(request.messages.at(-1)!.content).not.toContain('WHAT THIS LEARNER HAS SHOWN YOU');
      }
    }
  });
});
