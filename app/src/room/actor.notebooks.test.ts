/**
 * **The notebooks loop, through the actor** (`docs/research/notebooks.md` §4–§5, contract C7, C8).
 *
 * `actor.collabdoc.test.ts` pins the #48 loop with `maxOnlyOnRequest: false`; this pins what a
 * room does by default from 1 Oct 2026:
 *
 *  - **Max asks only when asked** (§5.2): Ellie's doc-chat answer stands on its own, with no
 *    `rule:max_followup` after it, and the flag is on every `turn.start` log line;
 *  - **every block action gives two outputs** (§4.2): Explain and Example put Ellie's full answer
 *    in the block's span thread and one line of at most 25 words under the block, with
 *    provenance, and the chat reply then says so; Quiz me puts Max's question in that thread and a
 *    Q block under the block, one open question at a time;
 *  - the refusals (`no_doc`, `busy`, `question_open`) and Freeze.
 *
 * Runs on `script.notes.ts` through the real `ScriptedClient`, including its generic block-action
 * replies and its scripted doc line, so the dev mock's path is the one under test. No network.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { BLOCK_LINE_MAX_WORDS, type AgentDocOpBatch, type OutlineEntry, type QuizOutcome } from '../shared/doc/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { BLOCK_ACTION_REQUEST, RoomActor, blockActionLine, cardNoteLine, editNoteLine, type RoomActorDeps } from './actor.js';
import type { DocPort } from './docport.js';
import { ScriptedClient } from './llm/scripted.js';
import { NOTES_SCRIPT } from './llm/script.notes.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';
import type { TurnLog } from './ports.js';
import { wordCount } from './timer.js';
import { segmentContext } from './reference.js';
import { LEAK_CHECK_AGENT_KEY, OPEN_QUESTION_DEFER_LINE, QUESTION_CHECK_AGENT_KEY } from './leakcheck.js';

const DOC = 'doc';
const SPAN = 'span_b0000000001';
const ELEMENT = PSD_HESSIAN_CONVEXITY_V1.elements[0]!.id;
const BULLET_TEXT = 'A side channel is a private turn with one agent that never reaches the shared context.';

function docPort(over: Partial<DocPort> = {}) {
  const edits: { batch: AgentDocOpBatch; objectiveId: string | null }[] = [];
  const outcomes: Omit<QuizOutcome, 'id' | 'contentSha' | 'createdAt'>[] = [];
  const outline: OutlineEntry[] = [
    { blockId: 'b_head', kind: 'heading', path: [], text: 'The side channel', pages: [3], learnerText: false, questionId: null },
    { blockId: 'b_idea', kind: 'bullet_list', path: ['The side channel'], text: BULLET_TEXT, pages: [3, 4], learnerText: false, questionId: null },
    { blockId: 'b_bare', kind: 'paragraph', path: ['The side channel'], text: 'A bridging sentence the ingest wrote.', pages: [], learnerText: false, questionId: null },
  ];
  const port: DocPort = {
    docId: () => 'doc_1',
    frozen: () => false,
    outlineNear: () => outline,
    blocksForPages: () => ['b_idea'],
    hasQuestion: () => false,
    recordEdit: (input) => edits.push({ batch: input.batch, objectiveId: input.objectiveId }),
    recordOutcome: (o) => outcomes.push(o),
    ...over,
  };
  return { port, edits, outcomes, outline };
}

/** The scripted client for everything but the ledger, which gets an empty proposal. */
function client(reply: (request: LlmRequest) => string | null = () => null): LLMClient & { requests: LlmRequest[] } {
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const requests: LlmRequest[] = [];
  return {
    kind: 'scripted',
    requests,
    async complete(request, onDelta, signal) {
      requests.push(request);
      const own = reply(request);
      if (own !== null) {
        onDelta?.(own);
        return { text: own, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      return scripted.complete(request, onDelta, signal);
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}, reply?: (request: LlmRequest) => string | null) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const logged: { name: string; fields: Record<string, unknown> }[] = [];
  const log: TurnLog = {
    event: (_level, name, fields = {}) => logged.push({ name, fields }),
    child: () => log,
  };
  const llm = client(reply);
  const doc = docPort();
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
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    docPort: doc.port,
    log,
    ...over,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm, doc, logged };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 120_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

/** Start a block action and run the clock until its turn and its doc line have both landed. */
async function act(h: ReturnType<typeof build>, input: Partial<Parameters<RoomActor['blockAction']>[0]> = {}) {
  const started = await h.actor.blockAction({
    kind: 'explain',
    blockId: 'b_idea',
    anchorId: SPAN,
    quote: BULLET_TEXT,
    context: segmentContext({ text: 'The slide text of pages 3 and 4.', page: 3, outline: '', label: null }),
    objectiveId: ELEMENT,
    passage: 'The slide text of pages 3 and 4.',
    ...input,
  });
  await settle(h.clock, started.turn);
  return started;
}

const rules = (h: ReturnType<typeof build>) => h.store.turnDecisions.forRoom(h.roomId).map((d) => d.decided_by);
const rows = (h: ReturnType<typeof build>) => h.store.messages.forRoom(h.roomId).slice().sort((a, b) => a.seq - b.seq);
const editLine = (batch: AgentDocOpBatch) => (batch.ops[0] as { blocks: { text: string; prov: unknown }[] }).blocks[0]!;

// ── §5.2: Max asks only when asked ────────────────────────────────────────

describe('maxOnlyOnRequest, on by default', () => {
  it('lets Ellie’s doc-chat answer stand: no follow-up from Max', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(rules(h)).toEqual(['rule:ellie_answers']);
    expect(h.store.messages.forRoom(h.roomId).filter((m) => m.decided_by === 'rule:max_followup')).toEqual([]);
    // She is not told that Max asks the next one, because nobody does.
    const ellie = h.llm.requests.find((r) => r.meta.scope === 'group')!.messages.at(-1)!.content;
    expect(ellie).not.toContain('Max asks the next one');
    expect(ellie).toContain('Do not end on a question.');
  });

  it('logs the flag on every turn.start', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const starts = h.logged.filter((l) => l.name === 'turn.start');
    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) expect(s.fields.max_only_on_request).toBe(true);
  });

  it('still reaches Max by @Max', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('@Max what is the side channel?', DOC));
    expect(rules(h)).toEqual(['rule:mention']);
    expect(h.store.turnDecisions.forRoom(h.roomId)[0]!.move_type).toBe('mention_reply');
  });

  it('can be turned off, which is the #48 loop with its follow-up', async () => {
    const h = build({ maxOnlyOnRequest: false });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
  });
});

describe('maxFollowsUp: the follow-up after Ellie, the on-request rules otherwise', () => {
  it('chains Max’s question after her answer, and tells her he asks next', async () => {
    const h = build({ maxFollowsUp: true });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
    const ellie = h.llm.requests.find((r) => r.meta.scope === 'group')!.messages.at(-1)!.content;
    expect(ellie).toContain('Max asks the next one');
    const starts = h.logged.filter((l) => l.name === 'turn.start');
    for (const s of starts) expect(s.fields).toMatchObject({ max_only_on_request: true, max_follows_up: true });
  });

  it('writes her line into the notes before Max asks', async () => {
    const h = build({ maxFollowsUp: true }, (r) =>
      r.meta.scope === 'docedit' ? JSON.stringify({ note_kind: 'point', line: 'A side channel is a private turn with one agent.', why: 'x' }) : null,
    );
    // Her line takes longer to plan than his question takes to start: the race of a live run.
    const complete = h.llm.complete.bind(h.llm);
    h.llm.complete = async (request, onDelta, signal) => {
      if (request.meta.scope === 'docedit') await new Promise<void>((r) => h.clock.setTimeout(r, 30_000));
      return complete(request, onDelta, signal);
    };
    h.actor.noteSpanThread({ threadId: SPAN, blockId: 'b_idea', quote: BULLET_TEXT });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', SPAN));
    await h.clock.run(60_000);
    const max = rows(h).find((m) => m.decided_by === 'rule:max_followup')!;
    const order = h.events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => (e.type === 'doc.edit' && (e as { batch: AgentDocOpBatch }).batch.author === 'ellie') || (e.type === 'message.appended' && e.message.id === max.id));
    expect(order.length).toBeGreaterThanOrEqual(2);
    expect(order[0]!.e.type).toBe('doc.edit');
  });

  it('asks once while his question is open: a second question draws no second follow-up', async () => {
    const h = build({ maxFollowsUp: true });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('and why is it private?', DOC));
    expect(rules(h).filter((r) => r === 'rule:max_followup')).toHaveLength(1);
  });
});

// ── §4: Explain and Example ──────────────────────────────────────────────

describe('blockAction: Explain and Example', () => {
  it('answers Explain in the block’s span thread, behind a learner row that says what was asked', async () => {
    const h = build();
    const started = await act(h);
    expect(started).toMatchObject({ accepted: true, threadId: SPAN, reason: null });

    const thread = rows(h).filter((m) => m.anchor_id === SPAN);
    expect(thread).toHaveLength(2);
    expect(thread[0]!.body).toBe(blockActionLine('explain', BULLET_TEXT));
    expect(thread[0]!.body.startsWith('Explain: «')).toBe(true);
    expect(thread[1]!.decided_by).toBe('rule:block_action');
    expect(h.store.turnDecisions.forRoom(h.roomId).map((d) => d.move_type)).toEqual(['block_explain']);
    // The thread is the block's, so the chat can focus it and the doc line knows where to go.
    expect(h.actor.docThreads().find((t) => t.threadId === SPAN)).toMatchObject({ kind: 'span', blockId: 'b_idea' });
    // The scripted reply is built from the line itself, and the prompt was given the line and the slide.
    const prompt = h.llm.requests.find((r) => r.meta.scope === 'group')!.messages.at(-1)!.content;
    expect(prompt).toContain('THE LEARNER PRESSED EXPLAIN ON THIS LINE OF THEIR NOTES');
    expect(prompt).toContain(BULLET_TEXT);
    expect(prompt).toContain('The slide text of pages 3 and 4.');
    expect(prompt).toContain('Do not end on a question');
  });

  it('runs no ledger and no follow-up on an action: actions fill nothing (§4.3)', async () => {
    const h = build({ maxOnlyOnRequest: false });
    await act(h);
    expect(h.llm.requests.some((r) => r.meta.scope === 'ledger')).toBe(false);
    expect(rules(h)).toEqual(['rule:block_action']);
    expect(rows(h)[0]!.decided_by).toBe(BLOCK_ACTION_REQUEST);
  });

  it('never lets a later ledger run judge the action’s row as the learner’s words', async () => {
    const h = build();
    await act(h);
    // Quiz me runs the ledger with no new learner message: there is nothing of theirs to judge.
    await act(h, { kind: 'quiz' });
    expect(h.llm.requests.filter((r) => r.meta.scope === 'ledger')).toEqual([]);

    // With a real message before it, that message is the one judged, never the action's row.
    const g = build();
    await settle(g.clock, g.actor.sendMessage('the side channel hides the turn from the other agent', DOC));
    await act(g);
    const action = rows(g).find((m) => m.decided_by === BLOCK_ACTION_REQUEST)!;
    await act(g, { kind: 'quiz' });
    const judged = g.llm.requests.filter((r) => r.meta.scope === 'ledger').map((r) => r.messages.at(-1)!.content);
    expect(judged.length).toBeGreaterThan(0);
    for (const directive of judged) expect(directive).not.toContain(action.id);
  });

  it('writes one line under the block, by Ellie, at most 25 words, with the block’s pages', async () => {
    const h = build();
    await act(h);
    const lines = h.doc.edits.filter((e) => e.batch.cause === 'block_action');
    expect(lines).toHaveLength(1);
    const { batch } = lines[0]!;
    expect(batch).toMatchObject({ author: 'ellie', focusBlockId: 'b_idea' });
    expect(batch.ops).toHaveLength(1);
    expect(batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_idea' });
    const block = editLine(batch);
    expect(wordCount(block.text)).toBeLessThanOrEqual(BLOCK_LINE_MAX_WORDS);
    expect(block.prov).toEqual({ pages: [3, 4], reason: null });
    // Billed as the document's own cost, and cued so the scripted backend can answer it.
    const call = h.llm.requests.find((r) => r.meta.scope === 'docedit')!;
    expect(call.meta.costScope).toBe('docedit');
    expect(call.meta.scriptCue).toBe('block_note:explain');
  });

  it('ends the chat reply with a code-written line naming the edit, once the edit landed', async () => {
    const h = build();
    await act(h);
    const ellie = rows(h).find((m) => m.decided_by === 'rule:block_action')!;
    expect(ellie.anchor_id).toBe(SPAN);
    expect(ellie.body.endsWith(editNoteLine('bullet_list', 'The side channel'))).toBe(true);
    expect(editNoteLine('bullet_list', 'The side channel')).toBe('Added one line under that bullet in “The side channel”.');
    // notebooks.md §4.2, amended 2026-10-02: the note is named for what it is.
    expect(editNoteLine('bullet_list', 'The side channel', 'background')).toBe('Added a background note under that bullet in “The side channel”.');
    expect(editNoteLine('paragraph', null, 'detail')).toBe('Added the details under that paragraph.');
    // Decision 11 (6 Oct afternoon): an answer that revised her earlier note says so.
    expect(editNoteLine('paragraph', 'Reinforcement learning set-up', 'point', true)).toBe(
      'Updated my note under that paragraph in “Reinforcement learning set-up”.',
    );
    // §11.2 (amended 2026-10-06): a note that went into a concept card names the card and the item.
    expect(cardNoteLine('Policy iteration', 'example', 'detail')).toBe('Added the details to the “Policy iteration” card, under Example.');
    expect(cardNoteLine(null, 'note')).toBe('Added a note to that card.');
    // Re-emitted under the same id, after the doc edit.
    const order = h.events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => (e.type === 'message.appended' && e.message.id === ellie.id) || e.type === 'doc.edit');
    expect(order.map(({ e }) => e.type)).toEqual(['message.appended', 'doc.edit', 'message.appended']);
  });

  it('answers Example with one worked example, and its line is the example in brief', async () => {
    const h = build();
    await act(h, { kind: 'example' });
    const thread = rows(h).filter((m) => m.anchor_id === SPAN);
    expect(thread[0]!.body.startsWith('Give me an example: «')).toBe(true);
    expect(h.store.turnDecisions.forRoom(h.roomId).map((d) => d.move_type)).toEqual(['block_example']);
    const prompt = h.llm.requests.find((r) => r.meta.scope === 'group')!.messages.at(-1)!.content;
    expect(prompt).toContain('THE LEARNER PRESSED EXAMPLE');
    expect(prompt).toContain('Work **one** example');
    const call = h.llm.requests.find((r) => r.meta.scope === 'docedit')!;
    expect(call.meta.scriptCue).toBe('block_note:example');
    expect(h.doc.edits.filter((e) => e.batch.cause === 'block_action')).toHaveLength(1);
  });

  it('falls back to a reason for provenance when the block has no pages and nothing is cited', async () => {
    const h = build();
    await act(h, { blockId: 'b_bare', quote: 'A bridging sentence the ingest wrote.' });
    const block = editLine(h.doc.edits.find((e) => e.batch.cause === 'block_action')!.batch);
    expect(block.prov).toEqual({ pages: [], reason: 'a point Ellie added from her answer' });
  });

  it('always writes a line on an action, even when the line call fails', async () => {
    const h = build({}, (r) => (r.meta.scope === 'docedit' ? 'not json at all' : null));
    await act(h);
    expect(h.doc.edits.filter((e) => e.batch.cause === 'block_action')).toHaveLength(1);
  });

  it('still answers in the chat while frozen, and writes and announces nothing', async () => {
    const frozen = docPort({ frozen: () => true });
    const h = build({ docPort: frozen.port });
    const started = await act(h);
    expect(started.accepted).toBe(true);
    expect(rows(h).filter((m) => m.decided_by === 'rule:block_action')).toHaveLength(1);
    expect(frozen.edits).toEqual([]);
    expect(h.llm.requests.some((r) => r.meta.scope === 'docedit')).toBe(false);
    expect(rows(h).some((m) => m.body.includes('Added one line'))).toBe(false);
  });

  /** 2026-10-06 (D2): the press is filed against the line's objective once Ellie's answer lands. */
  it('records Explain and Example against the line’s objective, and nothing when it has none', async () => {
    const pressed: { objectiveId: string | null; kind: string; blockId: string | null; roomId: string }[] = [];
    const port = docPort({ recordActivity: (a) => pressed.push(a) });
    const h = build({ docPort: port.port });
    const explain = await h.actor.blockAction({ kind: 'explain', blockId: 'b_idea', anchorId: SPAN, quote: BULLET_TEXT, objectiveId: ELEMENT });
    await settle(h.clock, explain.turn);
    const example = await h.actor.blockAction({ kind: 'example', blockId: 'b_idea', anchorId: SPAN, quote: BULLET_TEXT, objectiveId: ELEMENT });
    await settle(h.clock, example.turn);
    const unmapped = await h.actor.blockAction({ kind: 'explain', blockId: 'b_bare', anchorId: 'span_b0000000002', quote: 'x', objectiveId: null });
    await settle(h.clock, unmapped.turn);
    expect(pressed.map((p) => [p.objectiveId, p.kind, p.blockId])).toEqual([
      [ELEMENT, 'explain', 'b_idea'],
      [ELEMENT, 'example', 'b_idea'],
    ]);
    expect(pressed.every((p) => p.roomId === h.roomId)).toBe(true);
    // Actions still fill nothing (§4.3).
    expect(port.outcomes).toEqual([]);
  });

  /**
   * Decision 8 (6 Oct afternoon, #67): in the Lecture-sdm session five questions to Ellie about
   * one section counted nothing toward "Ready to check this?". They are filed now, with their
   * block, for main to find the block's objective.
   */
  it('files a question to Ellie in a span thread under the thread’s block', async () => {
    const pressed: { objectiveId: string | null; kind: string; blockId: string | null }[] = [];
    const port = docPort({ recordActivity: (a) => pressed.push(a) });
    const h = build({ docPort: port.port });
    h.actor.noteSpanThread({ threadId: 'span_c0000000001', blockId: 'b_idea', quote: BULLET_TEXT });
    await settle(h.clock, h.actor.sendMessage('how does the side channel stay private?', 'span_c0000000001'));
    expect(rules(h)).toEqual(['rule:ellie_answers']);
    expect(pressed).toEqual([{ roomId: h.roomId, objectiveId: null, kind: 'question', blockId: 'b_idea' }]);
    expect(port.outcomes).toEqual([]);
  });

  it('files a question in the doc chat under the block her line went to, and nothing when no line went in', async () => {
    const pressed: { kind: string; blockId: string | null }[] = [];
    const reply = (line: string | null) => (r: LlmRequest) =>
      r.meta.scope === 'docedit' ? (line === null ? JSON.stringify({ line: '', anchor_block_id: null, why: 'nothing fits' }) : JSON.stringify({ line, anchor_block_id: 'b_idea', why: 'the point' })) : null;
    const port = docPort({ recordActivity: (a) => pressed.push(a) });
    const h = build({ docPort: port.port }, reply('A side channel never reaches the shared context.'));
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(pressed.map((p) => [p.kind, p.blockId])).toEqual([['question', 'b_idea']]);

    const quiet: { kind: string }[] = [];
    const none = build({ docPort: docPort({ recordActivity: (a) => quiet.push(a) }).port }, reply(null));
    await settle(none.clock, none.actor.sendMessage('what is the side channel?', DOC));
    expect(quiet).toEqual([]);
  });

  it('files nothing for a question to Max', async () => {
    const pressed: unknown[] = [];
    const h = build({ docPort: docPort({ recordActivity: (a) => pressed.push(a) }).port });
    await settle(h.clock, h.actor.sendMessage('@Max what is the side channel?', DOC));
    expect(pressed).toEqual([]);
  });

  it('refuses a second action while one is being answered, and takes the next once it is done', async () => {
    const h = build();
    const first = await h.actor.blockAction({ kind: 'explain', blockId: 'b_idea', anchorId: SPAN, quote: BULLET_TEXT, objectiveId: null });
    const second = await h.actor.blockAction({ kind: 'example', blockId: 'b_idea', anchorId: SPAN, quote: BULLET_TEXT, objectiveId: null });
    expect(second).toMatchObject({ accepted: false, reason: 'busy' });
    // `generateBlock` shares the lock: one Ellie cursor at a time.
    expect(await h.actor.generateBlock({ blockId: 'b_idea', kind: 'table', instruction: null })).toMatchObject({ reason: 'in_flight' });
    await settle(h.clock, first.turn);
    const third = await h.actor.blockAction({ kind: 'example', blockId: 'b_idea', anchorId: SPAN, quote: BULLET_TEXT, objectiveId: null });
    expect(third.accepted).toBe(true);
    await settle(h.clock, third.turn);
  });

  it('refuses with no_doc when the room has no doc or the block has no id', async () => {
    const h = build();
    expect(await h.actor.blockAction({ kind: 'explain', blockId: '', anchorId: SPAN, quote: 'x', objectiveId: null })).toMatchObject({
      accepted: false,
      reason: 'no_doc',
    });
    const none = build({ docPort: undefined });
    expect(await none.actor.blockAction({ kind: 'explain', blockId: 'b_idea', anchorId: SPAN, quote: 'x', objectiveId: null })).toMatchObject({
      accepted: false,
      reason: 'no_doc',
    });
  });
});

// ── §4: Quiz me ──────────────────────────────────────────────────────────

describe('blockAction: Quiz me', () => {
  it('asks Max’s question in the block’s thread and writes it in as a Q block under the block', async () => {
    const h = build();
    const started = await act(h, { kind: 'quiz' });
    expect(started).toMatchObject({ accepted: true, threadId: SPAN });
    expect(rules(h)).toEqual(['rule:try_here']);
    const asked = rows(h).find((m) => m.decided_by === 'rule:try_here')!;
    expect(asked.anchor_id).toBe(SPAN);
    const q = h.doc.edits.find((e) => e.batch.cause === 'q_block')!;
    expect(q.batch.author).toBe('max');
    expect(q.batch.ops[0]).toMatchObject({ op: 'insert_q', anchorBlockId: 'b_idea', objectiveId: ELEMENT });
    expect(h.actor.docThreads().find((t) => t.threadId === SPAN)!.quiz?.open).toBe(true);
  });

  /**
   * **Max is told which line, and marks the question he asked** (sim harness, 2026-10-01). The
   * line reached him only as the *where* label, and the marking turn saw the objective's checklist
   * instead of the question; both showed up as off-line questions and correct answers marked down.
   */
  it('gives Max the pressed line on the question, and the question itself on the marking turn', async () => {
    const QUESTION = 'Why does a side channel never reach the shared context?';
    const h = build({}, (r) =>
      r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger') && r.meta.scriptCue?.startsWith('try') ? QUESTION : null,
    );
    await act(h, { kind: 'quiz' });
    const asking = h.llm.requests.find((r) => r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger'))!;
    const directive = asking.messages.at(-1)!.content;
    expect(directive).toContain('THE LINE THEY PRESSED QUIZ ME ON:');
    expect(directive).toContain(`"${BULLET_TEXT}"`);
    expect(directive).not.toContain(`Aim it at ${ELEMENT}`);

    const asked = rows(h).find((m) => m.decided_by === 'rule:try_here')!;
    await settle(h.clock, h.actor.sendMessage('the side channel keeps the turn out of the shared context', SPAN));
    const marking = h.llm.requests.filter((r) => r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger')).at(-1)!;
    const note = marking.messages.at(-1)!.content;
    expect(note).toContain('THE QUESTION YOU ASKED, WHICH IS WHAT YOU MARK:');
    expect(asked.body).toBe(QUESTION);
    expect(note).toContain(`"${QUESTION}"`);
    expect(note).not.toContain('A correct demonstration contains');
  });

  /**
   * **A question typed in a highlight or Ask… thread** (`notebooks.md` §4.2, amended 2026-10-02).
   * Main creates those threads; once it has told the actor the block, Ellie's doc edit is planned
   * against that block and filed under it, as a block action's is.
   */
  it('files the doc edit for a question in a main-made span thread under that thread\'s block', async () => {
    const h = build({}, (r) =>
      r.meta.scope === 'docedit'
        ? JSON.stringify({ line: 'A side channel never reaches the shared context.', anchor_block_id: 'b_head', why: 'the point' })
        : null,
    );
    h.actor.noteSpanThread({ threadId: 'span_c0000000001', blockId: 'b_idea', quote: BULLET_TEXT });
    await settle(h.clock, h.actor.sendMessage('how does the side channel stay private?', 'span_c0000000001'));
    const plan = h.llm.requests.find((r) => r.meta.scope === 'docedit')!.system.map((b) => b.text).join('\n');
    expect(plan).toContain('THE BLOCK IT GOES DIRECTLY UNDER (b_idea)');
    const edit = h.doc.edits.find((e) => e.batch.author === 'ellie')!;
    expect(edit.batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_idea' });
  });

  it('refuses a second Quiz me while Max’s question is open, and names that question’s thread', async () => {
    const h = build();
    await act(h, { kind: 'quiz' });
    const again = await h.actor.blockAction({ kind: 'quiz', blockId: 'b_bare', anchorId: 'span_other', quote: 'x', objectiveId: ELEMENT });
    expect(again).toMatchObject({ accepted: false, reason: 'question_open', threadId: SPAN });
  });

  it('picks an objective itself when the block maps to none', async () => {
    const h = build();
    await act(h, { kind: 'quiz', objectiveId: null });
    const decision = h.store.turnDecisions.forRoom(h.roomId)[0]!;
    expect(decision.decided_by).toBe('rule:try_here');
    expect(PSD_HESSIAN_CONVEXITY_V1.elements.map((e) => e.id)).toContain(decision.target_element_id);
  });

  it('leaves Explain open to the learner while Max’s question is open: Ellie answers, the question stays', async () => {
    const h = build();
    await act(h, { kind: 'quiz' });
    await act(h, { kind: 'explain', blockId: 'b_bare', anchorId: 'span_other', quote: 'A bridging sentence the ingest wrote.' });
    expect(rules(h)).toEqual(['rule:try_here', 'rule:block_action']);
    expect(h.actor.docThreads().find((t) => t.threadId === SPAN)!.quiz?.open).toBe(true);
  });
});

// ── Decision 7 (6 Oct afternoon, `notebooks.md` §11.10): no interruptions, and Hint on request ──

describe('quiet on an open question, and Hint', () => {
  const HINT = 'One hint: the side channel is a private thread, so think about which context it is kept out of.';
  const hinting = (r: LlmRequest) =>
    r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger') && r.meta.scriptCue?.startsWith('hint') ? HINT : null;

  /** The MDP run's #4 and #5: Ellie's planted guess, then Max asking about it. Neither fires now. */
  it('leaves the quiet on an open notebook question alone, however long', async () => {
    const h = build();
    await act(h, { kind: 'quiz' });
    const before = rows(h).length;
    // Thirteen minutes: past both silence stages, short of the sitting's 20-minute closure.
    await h.clock.run(400_000);
    await h.clock.run(400_000);
    expect(rows(h)).toHaveLength(before);
    // The timer still fires; the rule it reaches says nothing.
    expect(rules(h)[0]).toBe('rule:try_here');
    expect(rules(h).slice(1).length).toBeGreaterThan(0);
    for (const r of rules(h).slice(1)) expect(r).toBe('rule:question_quiet');
    expect(h.actor.docThreads().find((t) => t.threadId === SPAN)!.quiz?.open).toBe(true);
  });

  it('gives one hint from Max in the question’s thread, and leaves the question open and untried', async () => {
    const h = build({}, hinting);
    await act(h, { kind: 'quiz' });
    const out = await settle(h.clock, h.actor.hint(SPAN));
    expect(out).toEqual({ hinted: true, refused: null });
    expect(rules(h).filter((r) => r !== 'rule:question_quiet')).toEqual(['rule:try_here', 'rule:hint_requested']);
    const hint = rows(h).find((m) => m.decided_by === 'rule:hint_requested')!;
    expect(hint.anchor_id).toBe(SPAN);
    expect(hint.body).toBe(HINT);
    // The directive asks for one plain hint and forbids the page riddle.
    const asked = h.llm.requests.filter((r) => r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger')).at(-1)!;
    const directive = asked.messages.at(-1)!.content;
    expect(directive).toContain('They pressed **Hint**');
    expect(directive).toContain('A page reference is never the');
    // Not an attempt, nothing judged, still open.
    const quiz = h.actor.flowSnapshot().pendingQuiz!;
    expect(quiz.attempts).toBe(0);
    expect(quiz.answerShown).toBe(false);
    expect(h.llm.requests.some((r) => r.meta.scope === 'ledger')).toBe(false);
    expect(h.doc.outcomes).toEqual([]);
  });

  it('refuses a Hint where no question is open', async () => {
    const h = build({}, hinting);
    expect(await h.actor.hint(SPAN)).toEqual({ hinted: false, refused: 'There is no open question here.' });
    await act(h, { kind: 'quiz' });
    expect(await h.actor.hint('span_elsewhere')).toEqual({ hinted: false, refused: 'There is no open question here.' });
  });

  /** Decision 1's "no riddles", for the hint the learner pressed: "p. 6 settles it" is not a hint. */
  it('aims the hint at a point not yet stated, and never lets a page be the hint', async () => {
    let drafts = 0;
    const h = build(
      {
        flowState: {
          pendingQuiz: {
            quizMessageId: 'm_q',
            elementId: ELEMENT,
            askedAt: 0,
            answerMessageId: null,
            feedbackGiven: false,
            attempts: 0,
            answerShown: false,
            keyPoints: ['A side channel is private to one agent.', 'It never enters the shared context.'],
            pointsCovered: [1],
          },
        },
      },
      (r) => {
        if (r.meta.scope !== 'group' || !r.meta.agentKey?.startsWith('challenger')) return null;
        drafts += 1;
        return 'Look at what the other agents read. p. 3 settles it.';
      },
    );
    // The question was asked in the doc chat in this restored sitting.
    h.store.messages.insert({
      id: 'm_q',
      room_id: h.roomId,
      participant_id: h.store.participants.forRoom(h.roomId).find((p) => p.agent_key?.startsWith('challenger'))!.id,
      seq: 1,
      body: 'Why does a side channel never reach the shared context?',
      turn_decision_id: null,
      model: null,
      backend: null,
      usage: null,
      latency_target_ms: null,
      ttft_actual_ms: null,
      released_at: null,
      promoted_from_whisper: null,
      divider_cause: null,
      disagreement: null,
      anchor_id: DOC,
      created_at: new Date(0).toISOString(),
    });
    await settle(h.clock, h.actor.hint(DOC));
    expect(drafts).toBe(2);
    const asks = h.llm.requests.filter((r) => r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger'));
    const note = asks[0]!.messages.at(-1)!.content;
    expect(note).toContain('WHAT THEIR ANSWERS HAVE NOT STATED YET');
    expect(note).toContain('2. It never enters the shared context.');
    expect(note).not.toContain('1. A side channel is private');
    expect(asks[1]!.messages.at(-1)!.content).toContain('YOUR LAST HINT POINTED AT A PAGE');
    const hint = rows(h).find((m) => m.decided_by === 'rule:hint_requested')!;
    expect(hint.body).not.toContain('settles');
    expect(hint.body).toContain('Look at what the other agents read.');
  });
});

// ── Decision 6 (6 Oct afternoon): Ellie explains but does not answer Max's open question ──────

describe('Ellie and Max’s open question', () => {
  const QUESTION = 'Why does a side channel never reach the shared context?';
  const KEY = ['A side channel is a private turn with one agent, kept out of the shared context the others read.'];
  const LEAKS = 'Because a side channel is a private turn with one agent, and it is kept out of the shared context the others read.';
  const CLEAN =
    'Think of passing a note to one classmate during a group discussion: the others never see it. ' +
    'That is the idea of a private channel on p. 3, and the rest is yours to work out.';
  /** An open question with a hidden key, as decision 3 has Max write it, restored into the sitting. */
  const keyed = (): Partial<RoomActorDeps> => ({
    flowState: {
      pendingQuiz: {
        quizMessageId: 'm_asked_elsewhere',
        elementId: ELEMENT,
        askedAt: 0,
        answerMessageId: null,
        feedbackGiven: false,
        attempts: 0,
        answerShown: false,
        questionId: 'q_open',
        objectiveId: ELEMENT,
        questionText: QUESTION,
        modelAnswer: KEY[0]!,
        keyPoints: KEY,
      },
    },
  });
  const ellieGroup = (h: ReturnType<typeof build>) =>
    h.llm.requests.filter((r) => r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer'));

  it('tells Ellie the question is the learner’s to answer, in another thread, and not when none is open', async () => {
    const h = build();
    await act(h, { kind: 'quiz' });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(rules(h)).toEqual(['rule:try_here', 'rule:ellie_answers']);
    const prompt = ellieGroup(h).at(-1)!.messages.at(-1)!.content;
    expect(prompt).toContain('MAX’S OPEN QUESTION IS THE LEARNER’S TO ANSWER');
    expect(prompt).toContain('**Never**');

    const g = build();
    await settle(g.clock, g.actor.sendMessage('what is the side channel?', DOC));
    expect(ellieGroup(g).at(-1)!.messages.at(-1)!.content).not.toContain('MAX’S OPEN QUESTION');
  });

  it('asks again when her draft states the hidden key, and stores the second draft', async () => {
    let drafts = 0;
    const h = build(keyed(), (r) => {
      if (r.meta.scope !== 'group' || !r.meta.agentKey?.startsWith('peer')) return null;
      drafts += 1;
      return drafts === 1 ? LEAKS : CLEAN;
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(drafts).toBe(2);
    expect(ellieGroup(h)[1]!.messages.at(-1)!.content).toContain('YOUR LAST DRAFT ANSWERED MAX’S OPEN QUESTION');
    const ellie = rows(h).find((m) => m.decided_by === 'rule:ellie_answers')!;
    expect(ellie.body.startsWith(CLEAN)).toBe(true);
    expect(h.logged.filter((l) => l.name === 'answer_guard.hit')).toHaveLength(1);
  });

  it('takes the answer out when the second draft states it too, and says why', async () => {
    const h = build(keyed(), (r) => (r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? LEAKS : null));
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const ellie = rows(h).find((m) => m.decided_by === 'rule:ellie_answers')!;
    expect(ellie.body).not.toContain('kept out of the shared context');
    expect(ellie.body.startsWith('That part is what Max’s open question asks you for')).toBe(true);
  });

  /** A paraphrase the lexical check cannot see: the key point in other words. */
  const PARAPHRASE =
    'Picture whispering to just one friend while the class talks: only that friend hears, and nothing of it ' +
    'lands in what everyone else is reading. That is why the channel stays out of what the group shares.';
  const isLeakCheck = (r: LlmRequest) => r.meta.agentKey === LEAK_CHECK_AGENT_KEY;

  it('with the semantic guard, asks again when a paraphrase states the key, and keeps the clean draft', async () => {
    let drafts = 0;
    const h = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isLeakCheck(r)) return JSON.stringify({ stated: r.messages[0]!.content.includes(PARAPHRASE) ? [1] : [], why: 'x' });
      if (r.meta.scope !== 'group' || !r.meta.agentKey?.startsWith('peer')) return null;
      drafts += 1;
      return drafts === 1 ? PARAPHRASE : CLEAN;
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(drafts).toBe(2);
    const checks = h.llm.requests.filter(isLeakCheck);
    expect(checks).toHaveLength(2);
    // The checker is given the question, the hidden key and the draft, and nothing else of the turn.
    expect(checks[0]!.messages[0]!.content).toContain(QUESTION);
    expect(checks[0]!.messages[0]!.content).toContain(KEY[0]!);
    expect(checks[0]!.jsonSchema).toBeDefined();
    expect(ellieGroup(h)[1]!.messages.at(-1)!.content).toContain(KEY[0]!);
    const ellie = rows(h).find((m) => m.decided_by === 'rule:ellie_answers')!;
    expect(ellie.body.startsWith(CLEAN)).toBe(true);
    expect(h.logged.filter((l) => l.name === 'answer_guard.hit')[0]!.fields).toMatchObject({ semantic: 1 });
  });

  it('with the semantic guard, withholds a second draft that still states the key in other words', async () => {
    const h = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isLeakCheck(r)) return JSON.stringify({ stated: [1], why: 'x' });
      return r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? PARAPHRASE : null;
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const ellie = rows(h).find((m) => m.decided_by === 'rule:ellie_answers')!;
    expect(ellie.body).not.toContain('whispering');
    expect(ellie.body.startsWith('That part is what Max’s open question asks you for')).toBe(true);
  });

  it('lets the draft through when the check fails, and without the flag never calls it', async () => {
    const failing = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isLeakCheck(r)) throw new Error('the check could not run');
      return r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? PARAPHRASE : null;
    });
    await settle(failing.clock, failing.actor.sendMessage('what is the side channel?', DOC));
    expect(rows(failing).find((m) => m.decided_by === 'rule:ellie_answers')!.body.startsWith(PARAPHRASE)).toBe(true);
    expect(failing.logged.some((l) => l.name === 'answer_guard.semantic_failed')).toBe(true);

    const off = build(keyed(), (r) => (r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? PARAPHRASE : null));
    await settle(off.clock, off.actor.sendMessage('what is the side channel?', DOC));
    expect(off.llm.requests.filter(isLeakCheck)).toHaveLength(0);
  });

  it('with the semantic guard, does not write a notes line that states the open question’s key', async () => {
    const h = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isLeakCheck(r)) return JSON.stringify({ stated: r.messages[0]!.content.includes('passing a note') ? [] : [1], why: 'x' });
      return r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? CLEAN : null;
    });
    await act(h);
    // Her chat reply stands; the line for the notes is checked as it lands, and not written.
    expect(rows(h).find((m) => m.decided_by === 'rule:block_action')!.body.startsWith(CLEAN)).toBe(true);
    expect(h.doc.edits.filter((e) => e.batch.cause === 'block_action')).toHaveLength(0);
    expect(h.logged.some((l) => l.name === 'doc.block_note.withheld')).toBe(true);
  });

  const isQuestionCheck = (r: LlmRequest) => r.meta.agentKey === QUESTION_CHECK_AGENT_KEY;

  it('defers a neighbouring question while Max’s question has had no attempt, and logs it', async () => {
    const h = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isQuestionCheck(r)) return JSON.stringify({ stated: [1], why: 'answering it gives point 1 away' });
      return r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? LEAKS : null;
    });
    await settle(h.clock, h.actor.sendMessage('so what happens to a private turn, does the group ever see it?', DOC));
    const ellie = rows(h).find((m) => m.decided_by === 'rule:ellie_answers')!;
    expect(ellie.body).toBe(OPEN_QUESTION_DEFER_LINE);
    // The line is code-written: no draft of hers was asked for, and nothing went into the notes.
    expect(ellieGroup(h)).toHaveLength(0);
    expect(h.doc.edits.filter((e) => e.batch.author === 'ellie')).toHaveLength(0);
    // The check was given the learner's words, the question and its key.
    const check = h.llm.requests.find(isQuestionCheck)!;
    expect(check.messages[0]!.content).toContain('does the group ever see it');
    expect(check.messages[0]!.content).toContain(KEY[0]!);
    expect(h.logged.find((l) => l.name === 'ellie.deferred')!.fields).toMatchObject({ question_id: 'q_open', points: 1 });
  });

  it('answers a question that gives nothing away, and answers normally once Max’s question has been tried', async () => {
    const clean = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isQuestionCheck(r)) return JSON.stringify({ stated: [], why: 'a definition' });
      return r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? CLEAN : null;
    });
    await settle(clean.clock, clean.actor.sendMessage('what does “agent” mean here?', DOC));
    expect(rows(clean).find((m) => m.decided_by === 'rule:ellie_answers')!.body.startsWith(CLEAN)).toBe(true);

    const tried = keyed();
    tried.flowState!.pendingQuiz!.attempts = 1;
    const after = build({ ...tried, semanticGuard: true }, (r) => {
      if (isQuestionCheck(r)) return JSON.stringify({ stated: [1], why: 'x' });
      return r.meta.scope === 'group' && r.meta.agentKey?.startsWith('peer') ? CLEAN : null;
    });
    await settle(after.clock, after.actor.sendMessage('so does the group ever see it?', DOC));
    expect(after.llm.requests.filter(isQuestionCheck)).toHaveLength(0);
    expect(rows(after).find((m) => m.decided_by === 'rule:ellie_answers')!.body.startsWith(CLEAN)).toBe(true);
  });

  it('defers in a private thread too', async () => {
    const h = build({ ...keyed(), semanticGuard: true }, (r) => {
      if (isQuestionCheck(r)) return JSON.stringify({ stated: [1], why: 'x' });
      return r.meta.scope === 'whisper' ? LEAKS : null;
    });
    const ellie = h.actor.openPrivate('ellie');
    await settle(h.clock, h.actor.sendPrivate(ellie.threadId, 'does the group ever see a private turn?'));
    const reply = h.store.whispers.forThread(ellie.threadId).find((w) => w.sender === 'agent')!;
    expect(reply.body).toBe(OPEN_QUESTION_DEFER_LINE);
  });

  it('guards her private replies too', async () => {
    const h = build(keyed(), (r) => (r.meta.scope === 'whisper' ? LEAKS : null));
    const ellie = h.actor.openPrivate('ellie');
    await settle(h.clock, h.actor.sendPrivate(ellie.threadId, 'just tell me why'));
    const whisper = h.llm.requests.find((r) => r.meta.scope === 'whisper')!;
    expect(whisper.system.at(-1)!.text).toContain('MAX’S OPEN QUESTION IS THE LEARNER’S TO ANSWER');
    expect(whisper.system.at(-1)!.text).toContain(QUESTION);
    const reply = h.store.whispers.forThread(ellie.threadId).find((w) => w.sender === 'agent')!;
    expect(reply.body).not.toContain('kept out of the shared context');
  });
});

// ── Decision 15 (6 Oct afternoon): Start again picks up where the learner left off ────────────

describe('Start again', () => {
  const lessonPrompts = (h: ReturnType<typeof build>) =>
    h.llm.requests.filter((r) => r.meta.scope === 'group' && r.meta.scriptCue?.startsWith('lesson')).map((r) => r.messages.at(-1)!.content);

  it('walks through on the first Start, and on the second gives a recap and only what is left', async () => {
    const h = build({}, (r) => (r.meta.scope === 'group' && r.meta.scriptCue?.startsWith('lesson') ? 'A walkthrough of the side channel, p. 3.' : null));
    await settle(h.clock, h.actor.startLesson({ objectiveId: ELEMENT, anchorId: DOC, blockId: 'b_idea' }));
    await act(h, { kind: 'quiz' });
    await settle(h.clock, h.actor.pass(SPAN));
    await settle(h.clock, h.actor.startLesson({ objectiveId: ELEMENT, anchorId: DOC, blockId: 'b_idea' }));

    const [first, second] = lessonPrompts(h);
    expect(first).not.toContain('THEY HAVE PRESSED START ON THIS BEFORE');
    expect(first).toContain('Walk them through this part of the notes');
    expect(second).toContain('THEY HAVE PRESSED START ON THIS BEFORE');
    expect(second).toContain('A walkthrough of the side channel');
    expect(second).toContain('they gave up and were shown the answer');
    expect(second).toContain('They have started this before.');
    expect(second).not.toContain('Walk them through this part of the notes');
  });
});
