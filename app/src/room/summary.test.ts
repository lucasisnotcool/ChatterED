/**
 * **The artefact** (issue #41, `conversation-refinement.md` §5), through the real actor on a fake
 * clock: the card, the cap in code, the thread behind it, and Regenerate.
 *
 * `rule:offer_summary` — the Teacher's one-line offer — is **retired** (#48 cleanup). It only
 * ever fired in a room with no notes doc, and the button it advertised went with the crop flow,
 * so what was left was a Teacher turn promising a control the app no longer has.
 *
 * Lucas's #41 workflow is what is asserted here, in his order: *"for artefact creation and
 * generation, this should be provided as a button, which will create a slide / segment that
 * basically summarises what was taught in that conversational chain"*, and *"the conversation
 * summarised to create that artefact should be retrievable, continuable by the user."*
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
import { segmentContext } from './reference.js';
import { SUMMARY_WORD_CAP, composeSummaryBody, renderThread } from './summary.js';

const TEACH = 'Positive semidefinite means zᵀHz ≥ 0 for every vector z, not that every entry of H is ≥ 0.';
const SUMMARY = 'Positive semidefinite is a statement about the quadratic form zᵀHz, not about the entries of H.';
/** Longer than the cap, so the code-side truncation has something to do. */
const LONG_SUMMARY = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');

function client(summaryText = SUMMARY): LLMClient & { requests: LlmRequest[] } {
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
      if (request.meta.scope === 'reference') {
        return { text: summaryText, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
      }
      onDelta?.(TEACH);
      return { text: TEACH, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}, summaryText?: string) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client(summaryText);
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

const SEG = 'seg_3';

/** One Ask and one follow-up: a thread with two Teacher turns in it. */
async function thread(h: ReturnType<typeof build>) {
  await settle(
    h.clock,
    h.actor.askHere({
      anchorId: SEG,
      question: 'what is positive semidefinite?',
      context: segmentContext({ text: 'Theorem 3.2.', page: 4, label: 'Convexity' }),
    }),
  );
  await settle(h.clock, h.actor.sendMessage('so it is about the quadratic form?', SEG));
}

describe('composeSummaryBody', () => {
  it('caps in code at 150 words, and appends no hand-back line', () => {
    const { body, truncated } = composeSummaryBody(LONG_SUMMARY);
    expect(truncated).toBe(true);
    expect(body.split(/\s+/).length).toBeLessThanOrEqual(SUMMARY_WORD_CAP + 1);
    expect(body).not.toContain('say it back');
  });

  it('leaves a short summary exactly as written', () => {
    expect(composeSummaryBody(SUMMARY)).toEqual({ body: SUMMARY, truncated: false });
  });
});

describe('renderThread', () => {
  it('labels the learner and the agent, and leaves a summary card out of its own source', () => {
    const participants = new Map([
      ['p1', { id: 'p1', kind: 'student', display_name: 'You' }],
      ['p2', { id: 'p2', kind: 'agent', display_name: 'Ellie' }],
    ] as unknown as [string, never][]);
    const rows = [
      { participant_id: 'p1', body: 'what is PSD?', kind: 'turn' },
      { participant_id: 'p2', body: 'It is about zᵀHz.', kind: 'turn' },
      { participant_id: 'p2', body: 'An old card.', kind: 'summary' },
    ] as never[];
    const out = renderThread(rows, participants);
    expect(out).toContain('Learner: what is PSD?');
    expect(out).toContain('Ellie: It is about zᵀHz.');
    expect(out).not.toContain('An old card.');
  });
});

describe('flow:summarise, through the real actor', () => {
  it('writes a summary card under the segment, from the thread and not from the deck', async () => {
    const h = build();
    await thread(h);

    const out = await h.actor.summarise(SEG);

    const card = h.store.messages.get(out.messageId)!;
    expect(card.kind).toBe('summary');
    expect(card.anchor_id).toBe(SEG);
    expect(card.source_thread_id).toBe(SEG);
    expect(card.body).toBe(SUMMARY);
    expect(out.regenerated).toBe(false);

    // Authored by the voice that is not in the roster: a durable block in the learner's own
    // document is not Ellie speaking (`pivot-spec.md` §B1's surviving argument).
    const author = h.store.participants.get(card.participant_id)!;
    expect(author.agent_key).toBeNull();
    expect(author.display_name).toBe('REFERENCE');

    // The request saw the conversation and **not** the deck — the whole point of the feature.
    const request = h.llm.requests.filter((r) => r.meta.scope === 'reference').at(-1)!;
    expect(request.messages[0]!.content).toContain('what is positive semidefinite?');
    expect(request.messages[0]!.content).toContain(TEACH);
    expect(request.system[0]!.text).toContain('Summarise the conversation, not the slide');
    expect(request.system[0]!.text).toContain('p. 4');
    // Billed as its own thing, so "what did this deck cost me" can separate cards from answers.
    expect(request.meta.costScope).toBe('summary');
    expect(request.meta.anchorId).toBe(SEG);
  });

  /**
   * It resolves without running the clock at all, which is itself the assertion: there is no hold
   * on it. The learner pressed a button on their own document; nobody took the floor to answer.
   */
  it('is not an agent turn: no floor, no timer, no ledger', async () => {
    const h = build();
    await thread(h);
    const room = () => h.store.rooms.get(h.roomId)!;
    const before = {
      floor: room().consecutive_agent_turns,
      epoch: room().timer_epoch,
      deadline: room().deadline_ts,
      ledger: h.store.ledger.forSession(h.sessionId).map((r) => r.level),
    };

    await h.actor.summarise(SEG);

    expect(room().consecutive_agent_turns).toBe(before.floor);
    expect(room().timer_epoch).toBe(before.epoch);
    expect(room().deadline_ts).toBe(before.deadline);
    expect(h.store.ledger.forSession(h.sessionId).map((r) => r.level)).toEqual(before.ledger);
  });

  it('caps a long card in code, not in the prompt', async () => {
    const h = build({}, LONG_SUMMARY);
    await thread(h);
    const out = await h.actor.summarise(SEG);
    expect(out.truncated).toBe(true);
    expect(h.store.messages.get(out.messageId)!.body.split(/\s+/).length).toBeLessThanOrEqual(SUMMARY_WORD_CAP + 1);
  });

  it('regenerates in place, so the card keeps its position in the document', async () => {
    const h = build();
    await thread(h);
    const first = await h.actor.summarise(SEG);
    const seq = h.store.messages.get(first.messageId)!.seq;

    const again = await h.actor.summarise(SEG);
    expect(again.messageId).toBe(first.messageId);
    expect(again.regenerated).toBe(true);
    expect(h.store.messages.get(again.messageId)!.seq).toBe(seq);
    expect(h.store.messages.forRoom(h.roomId).filter((m) => m.kind === 'summary')).toHaveLength(1);
  });

  it('refuses a thread that has nothing in it, rather than writing an empty card', async () => {
    const h = build();
    await expect(h.actor.summarise('seg_nothing')).rejects.toThrow(/no conversation/);
  });
});

describe('flow:threadOf — the card is a handle on the conversation', () => {
  it('gives back the source thread, without the card itself', async () => {
    const h = build();
    await thread(h);
    const out = await h.actor.summarise(SEG);

    const found = h.actor.threadOf(out.messageId)!;
    expect(found.threadId).toBe(SEG);
    expect(found.messageIds).not.toContain(out.messageId);
    expect(found.messageIds.length).toBeGreaterThanOrEqual(3);
    // The learner's first question is the first thing in it.
    expect(h.store.messages.get(found.messageIds[0]!)!.body).toBe('what is positive semidefinite?');
  });

  it('is continuable: a turn sent to that thread lands beside the conversation it summarised', async () => {
    const h = build();
    await thread(h);
    const out = await h.actor.summarise(SEG);
    const before = h.actor.threadOf(out.messageId)!;
    const threadId = before.threadId;

    await settle(h.clock, h.actor.sendMessage('and what about a Hessian that is not symmetric?', threadId));

    const after = h.actor.threadOf(out.messageId)!;
    expect(after.messageIds.length).toBeGreaterThan(before.messageIds.length);
    expect(after.threadId).toBe(SEG);
    expect(
      h.store.messages.forAnchor(h.roomId, SEG).some((m) => m.body.includes('not symmetric')),
    ).toBe(true);
  });

  it('is null for anything that is not a summary card', async () => {
    const h = build();
    await thread(h);
    const turn = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(h.actor.threadOf(turn.id)).toBeNull();
    expect(h.actor.threadOf('m_nope')).toBeNull();
  });
});
