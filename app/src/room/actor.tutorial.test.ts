/**
 * **A tutorial part's help, through the actor** (`tutorials.md` §4, `TUTORIAL-CONTRACT.md` S5).
 *
 * `tutorialTurn` posts the learner's request in the part's span thread, runs one code-decided turn
 * (Max for a hint, a check and a release; Ellie for a refresher), and writes one line under the
 * part in the **tutorial's** document through `docPortFor`, never the notes. No ledger, no
 * outcome. Runs on the real `ScriptedClient` (its generic tutorial replies), no network.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import { docOutline } from '../shared/doc/schema.js';
import { tutorialDoc } from '../shared/doc/tutorialdoc.js';
import { FIXTURE_KEYS, FIXTURE_SHEET } from '../shared/doc/tutorial.fixture.test-support.js';
import { tutorialContentKey } from '../shared/tutorial.js';
import type { AgentDocOpBatch, OutlineEntry } from '../shared/doc/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor, type RoomActorDeps, type TutorialTurnInput } from './actor.js';
import type { DocPort } from './docport.js';
import { ScriptedClient } from './llm/scripted.js';
import { NOTES_SCRIPT } from './llm/script.notes.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';
import { TUTOR_ANSWER_HEADER, TUTOR_KEY_GUARD_HEADER } from './prompts.tutor.js';
import { TUTORIAL_REQUEST, TUTOR_HINT_REASON } from './tutor.js';
import { wordCount } from './timer.js';

const SPAN = 'span_c0000000001';
const CONTENT_KEY = tutorialContentKey('nb_1', 'file_tut');
const KEY = FIXTURE_KEYS[0]!; // P1b

let ids = 0;
const TUT_DOC = tutorialDoc(FIXTURE_SHEET, { pageBase: 20, newId: () => `b_t${(ids += 1)}`, at: 0 });
const TUT_OUTLINE = docOutline(TUT_DOC);
const P1B = TUT_OUTLINE.filter((e) => e.kind === 'tut_part')[1]!.blockId;
const P1B_SLOT = TUT_OUTLINE[TUT_OUTLINE.findIndex((e) => e.blockId === P1B) + 2]!.blockId;

function port(docId: string | null, outline: OutlineEntry[], over: Partial<DocPort> = {}) {
  const edits: { batch: AgentDocOpBatch; objectiveId: string | null }[] = [];
  const p: DocPort = {
    docId: () => docId,
    frozen: () => false,
    outlineNear: () => outline,
    blocksForPages: () => [],
    hasQuestion: () => false,
    recordEdit: (input) => edits.push({ batch: input.batch, objectiveId: input.objectiveId }),
    recordOutcome: () => {
      throw new Error('a tutorial turn records no outcome');
    },
    ...over,
  };
  return { port: p, edits };
}

function client(): LLMClient & { requests: LlmRequest[] } {
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const requests: LlmRequest[] = [];
  return {
    kind: 'scripted',
    requests,
    async complete(request, onDelta, signal) {
      requests.push(request);
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      return scripted.complete(request, onDelta, signal);
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}, tutorial = port('doc_tut', TUT_OUTLINE)) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client();
  const notes = port('doc_notes', []);
  const asked: string[] = [];
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
    docPort: notes.port,
    docPortFor: (key) => {
      asked.push(key);
      return tutorial.port;
    },
    ...over,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm, notes, tutorial, asked };
}

function turnInput(over: Partial<TutorialTurnInput> = {}): TutorialTurnInput {
  return {
    kind: 'hint',
    level: 1,
    docId: 'doc_tut',
    contentKey: CONTENT_KEY,
    partId: 'P1b',
    partBlockId: P1B,
    label: 'Problem 1 b.',
    anchorId: SPAN,
    prompt: 'Give a valid plan.',
    answer: '',
    key: KEY,
    notes: [{ blockId: 'b_strips', heading: 'STRIPS actions', text: 'An action has a precondition and an effect.' }],
    slides: [{ page: 5, label: 'Lecture 4 p. 5', text: 'Action(Move(b, x, y), PRECOND: On(b, x) ∧ Clear(b) ∧ Clear(y))' }],
    objectiveId: null,
    ...over,
  };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 120_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

async function run(h: ReturnType<typeof build>, over: Partial<TutorialTurnInput> = {}) {
  const started = await h.actor.tutorialTurn(turnInput(over));
  await settle(h.clock, started.turn);
  return started;
}

const rows = (h: ReturnType<typeof build>) => h.store.messages.forRoom(h.roomId).slice().sort((a, b) => a.seq - b.seq);
const agentOf = (h: ReturnType<typeof build>, participantId: string) =>
  h.store.participants.forRoom(h.roomId).find((p) => p.id === participantId)?.agent_key ?? null;
const groupPrompt = (h: ReturnType<typeof build>) => h.llm.requests.find((r) => r.meta.scope === 'group')!.messages.at(-1)!.content;

describe('tutorialTurn: a hint', () => {
  it('posts the request, then Max’s reply in the part’s thread, decided in code', async () => {
    const h = build();
    const started = await run(h);
    expect(started).toMatchObject({ accepted: true, reason: null, threadId: SPAN });
    const thread = rows(h).filter((m) => m.anchor_id === SPAN);
    expect(thread).toHaveLength(2);
    expect(thread[0]!.body).toBe('Hint, please: Problem 1 b. (point)');
    expect(thread[0]!.decided_by).toBe(TUTORIAL_REQUEST);
    expect(thread[1]!.decided_by).toBe('rule:tutor_hint');
    expect(agentOf(h, thread[1]!.participant_id)).toMatch(/^challenger/);
    expect(thread[1]!.body).toContain('p. 5');
    expect(h.store.turnDecisions.forRoom(h.roomId).map((d) => [d.decided_by, d.move_type])).toEqual([['rule:tutor_hint', 'tutor_hint']]);
    // The thread is the part's, so the chat can focus it.
    expect(h.actor.docThreads().find((t) => t.threadId === SPAN)).toMatchObject({ kind: 'span', blockId: P1B });
  });

  it('prompts with the part, the guard and the grounding, never the key’s answer, and runs no ledger', async () => {
    const h = build();
    await run(h, { answer: 'Move(Y, Table, X)' });
    const prompt = groupPrompt(h);
    expect(prompt).toContain('THE LEARNER IS WORKING ON A TUTORIAL PART: Problem 1 b.');
    expect(prompt).toContain('Move(Y, Table, X)');
    expect(prompt).toContain(TUTOR_KEY_GUARD_HEADER);
    expect(prompt).toContain('THIS IS HINT 1 OF 3: POINT');
    expect(prompt).toContain('Lecture p. 5');
    expect(prompt).not.toContain(KEY.answer);
    expect(h.llm.requests.some((r) => r.meta.scope === 'ledger')).toBe(false);
    expect(h.llm.requests.find((r) => r.meta.scope === 'group')!.meta.scriptCue).toBe('tutor_hint:1');
  });

  it('writes one line under the part’s slot in the tutorial doc, by Max, pending like any agent line', async () => {
    const h = build();
    await run(h);
    expect(h.asked).toEqual([CONTENT_KEY]);
    expect(h.notes.edits).toEqual([]);
    expect(h.tutorial.edits).toHaveLength(1);
    const { batch } = h.tutorial.edits[0]!;
    expect(batch).toMatchObject({ author: 'max', cause: 'block_action', focusBlockId: P1B });
    expect(batch.ops).toHaveLength(1);
    const op = batch.ops[0] as { op: string; anchorBlockId: string; blocks: { kind: string; text: string; prov: { pages: number[]; reason: string } }[] };
    expect(op).toMatchObject({ op: 'insert_after', anchorBlockId: P1B_SLOT });
    expect(op.blocks).toHaveLength(1);
    expect(op.blocks[0]!.text).toBe('Hint 1: look at “STRIPS actions” in the notes and p. 5.');
    expect(op.blocks[0]!.prov).toEqual({ pages: [5], reason: TUTOR_HINT_REASON });
    expect(wordCount(op.blocks[0]!.text)).toBeLessThanOrEqual(25);
    // Emitted on the tutorial's docId, so the renderer applies it to that document.
    const edit = h.events.find((e) => e.type === 'doc.edit') as Extract<RoomEvent, { type: 'doc.edit' }>;
    expect(edit.docId).toBe('doc_tut');
  });

  it('refuses while a turn is running, and takes the next once it is done', async () => {
    const h = build();
    const first = await h.actor.tutorialTurn(turnInput());
    expect(await h.actor.tutorialTurn(turnInput({ kind: 'refresher' }))).toMatchObject({ accepted: false, reason: 'busy', threadId: SPAN });
    // A block action shares the lock.
    expect(await h.actor.blockAction({ kind: 'explain', blockId: 'b_x', anchorId: 'span_d0000000001', quote: 'x', objectiveId: null })).toMatchObject({
      reason: 'busy',
    });
    await settle(h.clock, first.turn);
    const second = await h.actor.tutorialTurn(turnInput({ level: 2 }));
    expect(second.accepted).toBe(true);
    await settle(h.clock, second.turn);
    expect(rows(h).filter((m) => m.decided_by === 'rule:tutor_hint')).toHaveLength(2);
  });

  it('refuses with no_doc when the tutorial has no document or the part no block', async () => {
    const h = build({}, port(null, []));
    expect(await h.actor.tutorialTurn(turnInput())).toMatchObject({ accepted: false, reason: 'no_doc' });
    const g = build();
    expect(await g.actor.tutorialTurn(turnInput({ partBlockId: '' }))).toMatchObject({ accepted: false, reason: 'no_doc' });
    expect(rows(g)).toEqual([]);
  });

  it('still answers in the chat while the tutorial is frozen, and writes nothing', async () => {
    const frozen = port('doc_tut', TUT_OUTLINE, { frozen: () => true });
    const h = build({}, frozen);
    await run(h);
    expect(rows(h).filter((m) => m.decided_by === 'rule:tutor_hint')).toHaveLength(1);
    expect(frozen.edits).toEqual([]);
  });

  it('answers without a line when the host gives no docPortFor', async () => {
    const h = build({ docPortFor: undefined });
    const started = await run(h);
    expect(started.accepted).toBe(true);
    expect(rows(h).filter((m) => m.decided_by === 'rule:tutor_hint')).toHaveLength(1);
    expect(h.tutorial.edits).toEqual([]);
  });
});

describe('tutorialTurn: refresher, check and reveal', () => {
  it('a refresher is Ellie’s, from the prerequisites, and her line is under the part', async () => {
    const h = build();
    await run(h, { kind: 'refresher' });
    const reply = rows(h).find((m) => m.decided_by === 'rule:tutor_refresher')!;
    expect(agentOf(h, reply.participant_id)).not.toMatch(/^challenger/);
    expect(rows(h).find((m) => m.decided_by === TUTORIAL_REQUEST)!.body).toBe('A refresher for Problem 1 b.');
    expect(groupPrompt(h)).toContain('Preconditions must hold before an action');
    expect(h.tutorial.edits[0]!.batch.author).toBe('ellie');
  });

  it('a check voices the given verdict, says code ran it, and records it in the line', async () => {
    const h = build();
    await run(h, {
      kind: 'feedback',
      answer: 'Move(Y, Table, X)',
      verdict: { verdict: 'not_yet', checkedBy: 'simulation', detail: 'Step 1 fails: Y is not clear.' },
    });
    const prompt = groupPrompt(h);
    expect(prompt).toContain('Your first line is exactly **Not yet.**');
    expect(prompt).toContain('I ran your');
    const reply = rows(h).find((m) => m.decided_by === 'rule:tutor_feedback')!;
    expect(reply.body.startsWith('Not yet.')).toBe(true);
    const op = h.tutorial.edits[0]!.batch.ops[0] as { blocks: { text: string }[] };
    expect(op.blocks[0]!.text).toBe('Checked (run by the app): not yet. Step 1 fails: Y is not clear.');
  });

  /** 2026-10-06 (D3): the check's verdict is code's, so a reply that says another is corrected to it. */
  it('settles a check reply that states another verdict to the one code holds', async () => {
    const base = client();
    const llm: LLMClient = {
      kind: 'scripted',
      async complete(request, onDelta, signal) {
        if (request.meta.scope !== 'group') return base.complete(request, onDelta, signal);
        const text = 'Well done. The plan reaches the goal.';
        onDelta?.(text);
        return { text, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      },
    };
    const h = build({ llm });
    await run(h, {
      kind: 'feedback',
      answer: 'Move(Y, Table, X)',
      verdict: { verdict: 'not_yet', checkedBy: 'simulation', detail: 'Step 1 fails: Y is not clear.' },
    });
    const reply = rows(h).find((m) => m.decided_by === 'rule:tutor_feedback')!;
    expect(reply.body).toBe('**Not yet.** The plan reaches the goal.');
  });

  it('a reveal gives the key’s answer and asks for one line on why; the line says only that it was shown', async () => {
    const h = build();
    await run(h, { kind: 'reveal' });
    const prompt = groupPrompt(h);
    expect(prompt).toContain(TUTOR_ANSWER_HEADER);
    expect(prompt).toContain(KEY.answer);
    const reply = rows(h).find((m) => m.decided_by === 'rule:tutor_reveal')!;
    expect(reply.body).toContain(KEY.answer);
    expect(reply.body).toMatch(/why/i);
    const op = h.tutorial.edits[0]!.batch.ops[0] as { blocks: { text: string; prov: { pages: number[] } }[] };
    expect(op.blocks[0]!.text).toBe('Answer shown in the chat.');
    expect(op.blocks[0]!.text).not.toContain(KEY.answer);
  });
});

const docEditText = (h: ReturnType<typeof build>, index: number) => {
  const r = h.llm.requests.filter((q) => q.meta.scope === 'docedit')[index]!;
  return [...r.system.map((b) => b.text), ...r.messages.map((m) => m.content)].join('\n');
};

describe('blockAction on a tutorial sheet’s line (contentKey)', () => {
  const P1B_PROMPT = TUT_OUTLINE[TUT_OUTLINE.findIndex((e) => e.blockId === P1B) + 1]!;
  const SHEET_SPAN = 'span_e0000000001';

  it('Explain answers in the chat and writes its line into the tutorial, never the notes', async () => {
    const h = build();
    const started = await h.actor.blockAction({
      kind: 'explain',
      blockId: P1B_PROMPT.blockId,
      anchorId: SHEET_SPAN,
      quote: P1B_PROMPT.text,
      objectiveId: null,
      contentKey: CONTENT_KEY,
    });
    expect(started).toMatchObject({ accepted: true, threadId: SHEET_SPAN });
    await settle(h.clock, started.turn);
    expect(rows(h).filter((m) => m.decided_by === 'rule:block_action')).toHaveLength(1);
    expect(h.asked).toEqual([CONTENT_KEY]);
    expect(h.notes.edits).toEqual([]);
    expect(h.tutorial.edits).toHaveLength(1);
    expect(h.tutorial.edits[0]!.batch).toMatchObject({ author: 'ellie', cause: 'block_action' });
    expect(h.tutorial.edits[0]!.batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: P1B_PROMPT.blockId });
    const edit = h.events.find((e) => e.type === 'doc.edit') as Extract<RoomEvent, { type: 'doc.edit' }>;
    expect(edit.docId).toBe('doc_tut');
  });

  it('keeps later turns in that thread on the sheet too', async () => {
    const h = build();
    const started = await h.actor.blockAction({ kind: 'explain', blockId: P1B_PROMPT.blockId, anchorId: SHEET_SPAN, quote: P1B_PROMPT.text, objectiveId: null, contentKey: CONTENT_KEY });
    await settle(h.clock, started.turn);
    await settle(h.clock, h.actor.sendMessage('why does the table need to be clear?', SHEET_SPAN));
    expect(rows(h).filter((m) => m.decided_by === 'rule:ellie_answers')).toHaveLength(1);
    expect(h.notes.edits).toEqual([]);
    // Her answer's line was planned against the sheet's outline (the notes port's is empty).
    expect(docEditText(h, 1)).toContain('Give a valid plan.');
  });

  it('routes an Ask… thread noted with a content key to the sheet as well', async () => {
    const h = build();
    h.actor.noteSpanThread({ threadId: SHEET_SPAN, blockId: P1B_PROMPT.blockId, quote: P1B_PROMPT.text, contentKey: CONTENT_KEY });
    await settle(h.clock, h.actor.sendMessage('what is a valid plan here?', SHEET_SPAN));
    expect(rows(h).filter((m) => m.decided_by === 'rule:ellie_answers')).toHaveLength(1);
    expect(h.notes.edits).toEqual([]);
    expect(docEditText(h, 0)).toContain('Give a valid plan.');
    // Without the key, the same thread plans against the notes.
    const g = build();
    g.actor.noteSpanThread({ threadId: SHEET_SPAN, blockId: P1B_PROMPT.blockId, quote: P1B_PROMPT.text });
    await settle(g.clock, g.actor.sendMessage('what is a valid plan here?', SHEET_SPAN));
    expect(docEditText(g, 0)).not.toContain('Give a valid plan.');
  });

  it('refuses Quiz me on a sheet line: Max’s questions there are the part’s own buttons', async () => {
    const h = build();
    const started = await h.actor.blockAction({ kind: 'quiz', blockId: P1B_PROMPT.blockId, anchorId: SHEET_SPAN, quote: 'x', objectiveId: null, contentKey: CONTENT_KEY });
    expect(started).toMatchObject({ accepted: false, reason: 'no_doc' });
    expect(rows(h)).toEqual([]);
  });

  it('refuses with no_doc when the sheet has no document, or the host no docPortFor', async () => {
    const h = build({}, port(null, []));
    expect(await h.actor.blockAction({ kind: 'explain', blockId: 'b_x', anchorId: SHEET_SPAN, quote: 'x', objectiveId: null, contentKey: CONTENT_KEY })).toMatchObject({
      reason: 'no_doc',
    });
    const g = build({ docPortFor: undefined });
    expect(await g.actor.blockAction({ kind: 'explain', blockId: 'b_x', anchorId: SHEET_SPAN, quote: 'x', objectiveId: null, contentKey: CONTENT_KEY })).toMatchObject({
      reason: 'no_doc',
    });
  });
});

describe('a typed reply in a part’s thread, and the sheet’s guard (2026-10-04)', () => {
  const P1B_PROMPT = TUT_OUTLINE[TUT_OUTLINE.findIndex((e) => e.blockId === P1B) + 1]!;
  const SHEET_SPAN = 'span_e0000000002';
  const parts = (solved: boolean) => () => [{ contentKey: CONTENT_KEY, label: 'Problem 1 b.', solved, blockIds: [P1B, P1B_PROMPT.blockId, P1B_SLOT] }];

  it('is Max’s, with their words as the row, their answer slot read, the guard, and nothing written', async () => {
    const h = build();
    await run(h, { kind: 'reply', learnerText: 'these go in the domain, not the problem', answer: '(define (problem p) ...)' });
    const thread = rows(h).filter((m) => m.anchor_id === SPAN);
    expect(thread.map((m) => [m.body, m.decided_by])).toEqual([
      ['these go in the domain, not the problem', null],
      [thread[1]!.body, 'rule:tutor_reply'],
    ]);
    expect(agentOf(h, thread[1]!.participant_id)).toMatch(/^challenger/);
    const prompt = groupPrompt(h);
    expect(prompt).toContain('THE LEARNER REPLIED TO YOU IN THIS PART’S THREAD');
    expect(prompt).toContain('(define (problem p) ...)');
    expect(prompt).toContain(TUTOR_KEY_GUARD_HEADER);
    expect(prompt).toContain('every other part of the sheet');
    expect(prompt).not.toContain(KEY.answer);
    expect(h.tutorial.edits).toEqual([]);
    expect(h.notes.edits).toEqual([]);
  });

  it('may discuss the answer once the part was shown', async () => {
    const h = build();
    await run(h, { kind: 'reply', learnerText: 'why is that the plan?', revealed: true });
    expect(groupPrompt(h)).toContain(TUTOR_ANSWER_HEADER);
  });

  it('refuses a reply with no words', async () => {
    const h = build();
    expect(await h.actor.tutorialTurn(turnInput({ kind: 'reply', learnerText: '   ' }))).toMatchObject({ accepted: false, reason: 'no_doc' });
  });

  it('puts the guard on every other turn while a part is unsolved, and drops it once it is', async () => {
    const open = build({ tutorialParts: parts(false) });
    await settle(open.clock, open.actor.sendMessage('what is a valid plan for the blocks world?'));
    expect(groupPrompt(open)).toContain('TUTORIAL PARTS THE LEARNER HAS NOT SOLVED YET');
    expect(groupPrompt(open)).toContain('Still theirs to solve: Problem 1 b.');
    const done = build({ tutorialParts: parts(true) });
    await settle(done.clock, done.actor.sendMessage('what is a valid plan for the blocks world?'));
    expect(groupPrompt(done)).not.toContain('TUTORIAL PARTS THE LEARNER HAS NOT SOLVED YET');
  });

  it('writes nothing into a part the learner is still solving, and writes as before once it is solved', async () => {
    const open = build({ tutorialParts: parts(false) });
    open.actor.noteSpanThread({ threadId: SHEET_SPAN, blockId: P1B_PROMPT.blockId, quote: P1B_PROMPT.text, contentKey: CONTENT_KEY });
    await settle(open.clock, open.actor.sendMessage('what is a valid plan here?', SHEET_SPAN));
    expect(rows(open).filter((m) => m.decided_by === 'rule:ellie_answers')).toHaveLength(1);
    expect(open.tutorial.edits).toEqual([]);
    expect(open.notes.edits).toEqual([]);
    const solved = build({ tutorialParts: parts(true) });
    solved.actor.noteSpanThread({ threadId: SHEET_SPAN, blockId: P1B_PROMPT.blockId, quote: P1B_PROMPT.text, contentKey: CONTENT_KEY });
    await settle(solved.clock, solved.actor.sendMessage('what is a valid plan here?', SHEET_SPAN));
    expect(docEditText(solved, 0)).toContain('Give a valid plan.');
  });
});

describe('the tutorial as the main view: the focus a thread’s turns read (2026-10-04)', () => {
  const FOCUS = [
    'THE LEARNER IS WORKING ON A TUTORIAL SHEET: Tutorial 1',
    'ITS PARTS',
    '- Problem 1 b. (still theirs to solve): "Give a valid plan."',
    'THE LECTURE NOTES THE SHEET DRAWS ON',
    '- under “STRIPS actions”: An action has a precondition and an effect.',
  ].join('\n');
  const unsolved = () => [{ contentKey: CONTENT_KEY, label: 'Problem 1 b.', solved: false, blockIds: [P1B, P1B_SLOT] }];
  const lastGroup = (h: ReturnType<typeof build>) =>
    h.llm.requests.filter((r) => r.meta.scope === 'group').at(-1)!.messages.at(-1)!.content;

  it('goes in front of the notebook chat’s turn, with the lecture notes, and the sheet’s guard still after it', async () => {
    const h = build({ tutorialParts: unsolved });
    h.actor.noteTutorialFocus({ threadId: 'doc', block: FOCUS });
    await settle(h.clock, h.actor.sendMessage('what does this sheet want from me?', 'doc'));
    const prompt = lastGroup(h);
    expect(prompt).toContain('THE LEARNER IS WORKING ON A TUTORIAL SHEET: Tutorial 1');
    expect(prompt).toContain('under “STRIPS actions”');
    expect(prompt).toContain('TUTORIAL PARTS THE LEARNER HAS NOT SOLVED YET');
    expect(prompt.indexOf('THE LEARNER IS WORKING ON')).toBeLessThan(prompt.indexOf('TUTORIAL PARTS THE LEARNER HAS NOT SOLVED YET'));
    expect(prompt).not.toContain(KEY.answer);
  });

  it('is read only in its own thread, and is gone once main clears it (the swap turned off)', async () => {
    const h = build();
    h.actor.noteTutorialFocus({ threadId: 'doc', block: FOCUS });
    await settle(h.clock, h.actor.sendMessage('a question elsewhere', 'span_other'));
    expect(lastGroup(h)).not.toContain('THE LEARNER IS WORKING ON A TUTORIAL SHEET');
    h.actor.noteTutorialFocus({ threadId: 'doc', block: null });
    await settle(h.clock, h.actor.sendMessage('and in the notebook chat?', 'doc'));
    expect(lastGroup(h)).not.toContain('THE LEARNER IS WORKING ON A TUTORIAL SHEET');
  });

  it('reaches Explain on a line of the sheet too', async () => {
    const P1B_PROMPT = TUT_OUTLINE[TUT_OUTLINE.findIndex((e) => e.blockId === P1B) + 1]!;
    const h = build();
    h.actor.noteTutorialFocus({ threadId: 'span_e0000000009', block: FOCUS });
    const started = await h.actor.blockAction({
      kind: 'explain',
      blockId: P1B_PROMPT.blockId,
      anchorId: 'span_e0000000009',
      quote: P1B_PROMPT.text,
      objectiveId: null,
      contentKey: CONTENT_KEY,
    });
    await settle(h.clock, started.turn);
    expect(lastGroup(h)).toContain('THE LEARNER IS WORKING ON A TUTORIAL SHEET: Tutorial 1');
  });

  it('leaves a tutor turn as it was: Max’s help on a part reads the part’s own block', async () => {
    const h = build();
    h.actor.noteTutorialFocus({ threadId: SPAN, block: FOCUS });
    await run(h);
    expect(groupPrompt(h)).not.toContain('THE LEARNER IS WORKING ON A TUTORIAL SHEET');
    expect(groupPrompt(h)).toContain(TUTOR_KEY_GUARD_HEADER);
  });
});

