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
