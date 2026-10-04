import { beforeEach, describe, expect, it } from 'vitest';
import { docOf, para } from '../../shared/doc/fixture.test-support.js';
import type { ChatView } from '../../shared/doc/types.js';
import type { DocHost } from '../dochost.js';
import { fakeHost, handlerTable, objective, type FakeHost } from './fakehost.test-support.js';
import { resetDocCache } from './doc.js';
import { closeFileQuestions, registerDocRoomIpc, resetDocTextState } from './ipc.js';
import { loadFlowState } from '../flowroom.js';

const CLAIM = 'A matrix is positive semidefinite when every eigenvalue is at least zero.';

function deck() {
  return docOf(
    para('b_1', 'Convexity is about the shape of the set.', 'ingest', null, [1]),
    para('b_2', 'The Hessian test decides it on the interior.', 'ingest', null, [2]),
    para('b_3', 'A bridging note with no slide behind it.', 'ingest', null, []),
  );
}

function wire(fx: FakeHost) {
  const table = handlerTable();
  registerDocRoomIpc(fx.host, table.handle);
  return table;
}

beforeEach(() => {
  resetDocCache();
  resetDocTextState();
});

describe('chat:threads', () => {
  it('returns a null room and no threads for a file nobody has spoken to — and creates nothing', async () => {
    const fx = fakeHost({ doc: deck() });
    const view = await wire(fx).call<ChatView>('chat:threads', { fileId: 'f_deck' });
    expect(view).toEqual({ roomId: null, fileId: 'f_deck', threads: [] });
    expect(fx.opened).toEqual([]);
  });

  it('merges the registry with the actor: the registry owns what a thread is, the actor what was said', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    await table.call('chat:openSpan', { fileId: 'f_deck', blockId: 'b_2', quote: 'the Hessian test', question: 'Why?' });

    const spanId = fx.db
      .prepare("SELECT thread_id FROM notes_threads WHERE kind = 'span'")
      .get<{ thread_id: string }>({})!.thread_id;
    fx.actor.threads = [
      {
        threadId: spanId,
        kind: 'span',
        blockId: null,
        quote: null,
        agentKey: null,
        messageIds: ['m_1', 'm_2'],
        lastSeenSeq: 4,
        quiz: null,
        createdAt: 'whenever',
      },
    ];

    const view = await table.call<ChatView>('chat:threads', { fileId: 'f_deck' });
    const thread = view.threads.find((t) => t.threadId === spanId)!;
    expect(thread.blockId).toBe('b_2');
    expect(thread.quote).toBe('the Hessian test');
    expect(thread.messageIds).toEqual(['m_1', 'm_2']);
    expect(thread.lastSeenSeq).toBe(4);
  });

  it('still lists threads when the actor has no docThreads yet, reading the anchors from messages', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.actor.omit('docThreads');
    const table = wire(fx);
    await table.call('chat:send', { fileId: 'f_deck', text: 'What is convexity?' });
    fx.store.messages.insert({
      id: 'm_1',
      room_id: fx.roomId,
      participant_id: 'p_student',
      seq: 50,
      body: 'What is convexity?',
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
      anchor_id: 'doc',
      created_at: '2026-09-19T10:00:00.000Z',
    });

    const view = await table.call<ChatView>('chat:threads', { fileId: 'f_deck' });
    expect(view.threads.map((t) => t.threadId)).toEqual(['doc']);
    expect(view.threads[0]!.messageIds).toEqual(['m_1']);
  });

  it('puts the doc chat first', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    await table.call('chat:openSpan', { fileId: 'f_deck', blockId: 'b_2', quote: 'q', question: 'Why?' });
    await table.call('chat:send', { fileId: 'f_deck', text: 'What is convexity?' });

    const view = await table.call<ChatView>('chat:threads', { fileId: 'f_deck' });
    expect(view.threads[0]!.threadId).toBe('doc');
  });
});

describe('chat:send', () => {
  it('creates the room on the first message and ensures the doc thread', async () => {
    const fx = fakeHost({ doc: deck() });
    const out = await wire(fx).call<{ roomId: string; threadId: string }>('chat:send', {
      fileId: 'f_deck',
      text: 'What is convexity?',
    });

    expect(out).toEqual({ roomId: fx.roomId, threadId: 'doc' });
    expect(fx.opened).toEqual(['f_deck']);
    expect(fx.db.prepare("SELECT kind FROM notes_threads WHERE thread_id = 'doc'").get<{ kind: string }>({})).toEqual({
      kind: 'doc',
    });
  });

  it('answers the doc chat from the whole deck', async () => {
    const fx = fakeHost({ doc: deck() });
    await wire(fx).call('chat:send', { fileId: 'f_deck', text: 'Summarise the deck.' });
    const [text, anchorId, context] = fx.actor.last('sendMessage')!.args as [string, string, { scope: string }];
    expect(text).toBe('Summarise the deck.');
    expect(anchorId).toBe('doc');
    expect(context.scope).toBe('deck');
  });

  it('answers a span thread from the pages its block came from', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.pageText = 'p.2: the Hessian test.';
    const table = wire(fx);
    const { threadId } = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'the Hessian test decides it',
      question: 'What does that mean?',
    });

    await table.call('chat:send', { fileId: 'f_deck', threadId, text: 'And on the boundary?' });
    const [, anchorId, context] = fx.actor.last('sendMessage')!.args as [
      string,
      string,
      { scope: string; page: number; label: string; passageText: string },
    ];
    expect(anchorId).toBe(threadId);
    expect(context).toMatchObject({ scope: 'segment', page: 2, label: 'the Hessian test decides it' });
    expect(context.passageText).toBe('p.2: the Hessian test.');
  });

  it('hands a span thread to the tutorial’s tutor first, and sends nothing itself when it takes it (2026-10-04)', async () => {
    const fx = fakeHost({ doc: deck() });
    const seen: { threadId: string; blockId: string | null; text: string }[] = [];
    let take = true;
    (fx.host as { tutorialReply?: DocHost['tutorialReply'] }).tutorialReply = async (input: Parameters<NonNullable<DocHost['tutorialReply']>>[0]) => {
      seen.push({ threadId: input.threadId, blockId: input.blockId, text: input.text });
      return take;
    };
    const table = wire(fx);
    const { threadId } = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'the Hessian test decides it',
      question: 'What does that mean?',
    });
    const sentBefore = fx.actor.calls.filter((c) => c.method === 'sendMessage').length;
    await table.call('chat:send', { fileId: 'f_deck', threadId, text: 'my answer' });
    expect(seen).toEqual([{ threadId, blockId: 'b_2', text: 'my answer' }]);
    expect(fx.actor.calls.filter((c) => c.method === 'sendMessage').length).toBe(sentBefore);
    // Not a part's thread: the tutor declines and the message goes to the room as before.
    take = false;
    await table.call('chat:send', { fileId: 'f_deck', threadId, text: 'and again' });
    expect(fx.actor.last('sendMessage')!.args[0]).toBe('and again');
    // The doc chat is never offered to it.
    await table.call('chat:send', { fileId: 'f_deck', text: 'Summarise.' });
    expect(seen).toHaveLength(2);
  });

  it('falls back to the deck for a block the ingest wrote with no slide behind it', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    const { threadId } = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_3',
      quote: 'a bridging note',
      question: 'Why is this here?',
    });
    await table.call('chat:send', { fileId: 'f_deck', threadId, text: 'Still curious.' });
    const [, , context] = fx.actor.last('sendMessage')!.args as [string, string, { scope: string }];
    expect(context.scope).toBe('deck');
  });
});

describe('chat:openSpan', () => {
  it('mints a span_ thread carrying the block and the verbatim quote', async () => {
    const fx = fakeHost({ doc: deck() });
    const out = await wire(fx).call<{ roomId: string; threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'the Hessian test decides it',
      question: 'What does that mean?',
    });

    expect(out.threadId).toMatch(/^span_[0-9a-f]{12}$/);
    const row = fx.db
      .prepare('SELECT * FROM notes_threads WHERE thread_id = @t')
      .get<{ block_id: string; span_quote: string; kind: string }>({ t: out.threadId })!;
    expect(row).toMatchObject({ kind: 'span', block_id: 'b_2', span_quote: 'the Hessian test decides it' });
    expect(fx.actor.last('sendMessage')!.args[0]).toBe('What does that mean?');
  });

  /**
   * `notebooks.md` §4.2, amended 2026-10-02: the actor is told the thread's block before the
   * turn, so Ellie's doc edit is filed under the line asked about, not where a planner guessed.
   */
  it('tells the actor the span thread\'s block and quote before the turn, and again on a later message', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    const { threadId } = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'the Hessian test decides it',
      question: 'What does that mean?',
    });
    const methods = fx.actor.calls.map((c) => c.method);
    expect(methods.indexOf('noteSpanThread')).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf('noteSpanThread')).toBeLessThan(methods.indexOf('sendMessage'));
    expect(fx.actor.last('noteSpanThread')!.args[0]).toEqual({ threadId, blockId: 'b_2', quote: 'the Hessian test decides it' });

    await table.call('chat:send', { fileId: 'f_deck', threadId, text: 'and in general?' });
    expect(fx.actor.calls.filter((c) => c.method === 'noteSpanThread')).toHaveLength(2);
  });

  it('refuses an un-minted block id before it creates a room', async () => {
    const fx = fakeHost({ doc: deck() });
    await expect(
      wire(fx).call('chat:openSpan', { fileId: 'f_deck', blockId: '', quote: 'q', question: 'Why?' }),
    ).rejects.toThrow(/minted blockId/);
    expect(fx.opened).toEqual([]);
  });

  it('binds the objective when the block’s pages name exactly one, and not when two do', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const table = wire(fx);
    const one = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'q',
      question: 'Why?',
    });
    expect(
      fx.db
        .prepare('SELECT objective_id FROM notes_threads WHERE thread_id = @t')
        .get<{ objective_id: string | null }>({ t: one.threadId })!.objective_id,
    ).toBe('o2');

    fx.setTree([objective('o2', { refs: [{ page: 2 }] }), objective('o3', { refs: [{ page: 2 }] })]);
    const two = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'q',
      question: 'Why?',
    });
    expect(
      fx.db
        .prepare('SELECT objective_id FROM notes_threads WHERE thread_id = @t')
        .get<{ objective_id: string | null }>({ t: two.threadId })!.objective_id,
    ).toBeNull();
  });
});

describe('the private thread', () => {
  it('opens, registers its agent, and sends — without touching the document', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    const opened = await table.call<{ roomId: string; threadId: string }>('chat:privateOpen', {
      fileId: 'f_deck',
      agent: 'max',
    });
    expect(opened).toMatchObject({ roomId: fx.roomId, threadId: 'wthread_1' });
    expect(
      fx.db
        .prepare('SELECT kind, agent_key FROM notes_threads WHERE thread_id = @t')
        .get<{ kind: string; agent_key: string }>({ t: 'wthread_1' }),
    ).toEqual({ kind: 'private', agent_key: 'max' });

    await table.call('chat:privateSend', { roomId: fx.roomId, threadId: 'wthread_1', text: 'quietly' });
    expect(fx.actor.last('sendPrivate')!.args).toEqual(['wthread_1', 'quietly']);
    // The one path from private to shared is `chat:insertIntoDoc`, and nothing else here calls it.
    expect(fx.actor.calls.some((c) => c.method === 'insertPrivateIntoDoc')).toBe(false);
  });

  it('inserts one turn into the doc through the actor, which runs the guard', async () => {
    const fx = fakeHost({ doc: deck() });
    const out = await wire(fx).call<{ editId: string | null }>('chat:insertIntoDoc', {
      roomId: fx.roomId,
      threadId: 'wthread_1',
      turnId: 'w_3',
      anchorBlockId: 'b_2',
    });
    expect(out).toEqual({ editId: 'edit_1' });
    expect(fx.actor.last('insertPrivateIntoDoc')!.args[0]).toEqual({
      threadId: 'wthread_1',
      turnId: 'w_3',
      anchorBlockId: 'b_2',
    });
  });
});

describe('quiz:pass', () => {
  it('releases the answer through the actor and pushes a fresh bar', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    fx.roomExists = true;
    const out = await wire(fx).call('quiz:pass', { roomId: fx.roomId, threadId: 'doc' });

    expect(out).toEqual({ released: true, refused: null });
    expect(fx.actor.last('pass')!.args).toEqual(['doc']);
    await new Promise((resolve) => setImmediate(resolve));
    expect(fx.events.map((e) => e.type)).toContain('progress.updated');
  });

  it('fails loudly, naming the method, while T3’s `pass` is not there', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.actor.omit('pass');
    await expect(wire(fx).call('quiz:pass', { roomId: fx.roomId, threadId: 'doc' })).rejects.toThrow(
      /RoomActor\.pass is not available yet/,
    );
  });
});

describe('notes:answerQuestion', () => {
  const base = {
    fileId: 'f_deck',
    docId: 'doc_deck',
    questionId: 'q_1',
    qBlockId: 'b_2',
    question: 'Why is the Hessian test sufficient?',
    answerBlockId: 'b_ans',
    answer: 'PSD',
  };
  type Out = { accepted: boolean; threadId: string | null; reason: string | null };

  it('hands an answer to Max’s question to the actor, with no gate on its length', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.roomExists = true;
    const out = await wire(fx).call<Out>('notes:answerQuestion', { ...base, askedBy: 'max' });

    expect(out).toEqual({ accepted: true, threadId: 'doc', reason: null });
    expect(fx.actor.last('answerInPlace')!.args[0]).toEqual({ questionId: 'q_1', blockId: 'b_ans', text: 'PSD' });
    expect(fx.actor.last('markOwnQuestion')).toBeUndefined();
  });

  it('passes the actor’s refusal back, so the Q block can say the question is closed', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.roomExists = true;
    fx.actor.inPlaceResult = { accepted: false, threadId: null, reason: 'not_open' };
    const out = await wire(fx).call<Out>('notes:answerQuestion', { ...base, askedBy: 'max' });
    expect(out).toEqual({ accepted: false, threadId: null, reason: 'not_open' });
  });

  it('never opens a room for an answer to Max: his question can only be open in one that exists', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.roomExists = false;
    const out = await wire(fx).call<Out>('notes:answerQuestion', { ...base, askedBy: 'max' });
    expect(out.reason).toBe('not_open');
    expect(fx.opened).toEqual([]);
    expect(fx.actor.calls).toEqual([]);
  });

  it('marks the learner’s own question in a span thread on its Q block, filed under no objective', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const out = await wire(fx).call<Out>('notes:answerQuestion', { ...base, askedBy: 'user' });

    expect(out.accepted).toBe(true);
    expect(out.threadId).toMatch(/^span_/);
    expect(fx.actor.last('markOwnQuestion')!.args[0]).toMatchObject({
      anchorId: out.threadId,
      questionId: 'q_1',
      blockId: 'b_2',
      question: base.question,
      answer: 'PSD',
    });
    expect(fx.actor.last('answerInPlace')).toBeUndefined();
    const row = fx.db
      .prepare("SELECT objective_id AS objectiveId FROM notes_threads WHERE kind = 'span'")
      .get<{ objectiveId: string | null }>({})!;
    expect(row.objectiveId).toBeNull();
  });

  it('marks a revised answer in the same thread', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    const first = await table.call<Out>('notes:answerQuestion', { ...base, askedBy: 'user' });
    const second = await table.call<Out>('notes:answerQuestion', { ...base, askedBy: 'user', answer: 'positive semidefinite' });
    expect(second.threadId).toBe(first.threadId);
  });

  it('refuses an empty answer, and an own question with no question, before any room or call', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    expect((await table.call<Out>('notes:answerQuestion', { ...base, askedBy: 'max', answer: '  ' })).reason).toBe('empty');
    expect((await table.call<Out>('notes:answerQuestion', { ...base, askedBy: 'user', question: ' ' })).reason).toBe(
      'no_question',
    );
    expect((await table.call<Out>('notes:answerQuestion', { ...base, askedBy: 'user', qBlockId: '' })).reason).toBe('no_doc');
    expect(fx.opened).toEqual([]);
    expect(fx.actor.calls).toEqual([]);
  });
});

describe('notes:generateBlock', () => {
  const base = { fileId: 'f_deck', docId: 'doc_deck', blockId: 'b_2', kind: 'table' as const, instruction: '  by cost  ' };
  type Out = { inserted: boolean; editId: string | null; reason: string | null };

  it('asks the actor for the block, with the slides of its section resolved here', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.pageText = 'THE PAGES OF THE SECTION';
    const out = await wire(fx).call<Out>('notes:generateBlock', base);

    expect(out).toEqual({ inserted: true, editId: 'edit_gen', reason: null });
    expect(fx.actor.last('generateBlock')!.args[0]).toEqual({
      blockId: 'b_2',
      kind: 'table',
      instruction: 'by cost',
      passage: 'THE PAGES OF THE SECTION',
      // `fileBytesKey`'s page count, which main's handler used to leave out.
      pageCount: 12,
    });
  });

  it('sends no instruction when the learner gave none', async () => {
    const fx = fakeHost({ doc: deck() });
    await wire(fx).call<Out>('notes:generateBlock', { ...base, kind: 'diagram', instruction: '   ' });
    expect(fx.actor.last('generateBlock')!.args[0]).toMatchObject({ kind: 'diagram', instruction: null });
  });

  it('refuses without a block or a document, before any room is opened', async () => {
    const fx = fakeHost({ doc: deck() });
    expect((await wire(fx).call<Out>('notes:generateBlock', { ...base, blockId: '' })).reason).toBe('no_doc');
    const empty = fakeHost();
    expect((await wire(empty).call<Out>('notes:generateBlock', base)).reason).toBe('no_doc');
    expect(fx.opened).toEqual([]);
    expect(empty.opened).toEqual([]);
    expect(fx.actor.calls).toEqual([]);
  });
});

describe('notes:docText', () => {
  const payload = { fileId: 'f_deck', docId: 'doc_deck', blockId: 'b_2', text: CLAIM };

  it('assesses a claim in a block that maps to one objective, in a span thread on that block', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const out = await wire(fx).call<{ assessed: boolean; threadId: string | null; reason: string | null }>(
      'notes:docText',
      payload,
    );

    expect(out.assessed).toBe(true);
    expect(out.threadId).toMatch(/^span_/);
    expect(fx.actor.last('assessDocText')!.args[0]).toEqual({
      anchorId: out.threadId,
      objectiveId: 'o2',
      blockId: 'b_2',
      text: CLAIM,
    });
  });

  it('reuses the span thread the learner already opened on that block', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const table = wire(fx);
    const opened = await table.call<{ threadId: string }>('chat:openSpan', {
      fileId: 'f_deck',
      blockId: 'b_2',
      quote: 'the Hessian test',
      question: 'What does that mean?',
    });

    const out = await table.call<{ threadId: string }>('notes:docText', payload);
    expect(out.threadId).toBe(opened.threadId);
    expect(fx.db.prepare("SELECT COUNT(*) AS n FROM notes_threads WHERE kind = 'span'").get<{ n: number }>({})!.n).toBe(
      1,
    );
  });

  it('does not assess the same paragraph twice', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const table = wire(fx);
    expect((await table.call<{ assessed: boolean }>('notes:docText', payload)).assessed).toBe(true);
    const again = await table.call<{ assessed: boolean; reason: string | null }>('notes:docText', payload);
    expect(again).toMatchObject({ assessed: false, reason: 'unchanged' });
    expect(fx.actor.calls.filter((c) => c.method === 'assessDocText')).toHaveLength(1);
  });

  it('does not assess the same paragraph again after a relaunch, and does assess an edit to it', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const table = wire(fx);
    const first = await table.call<{ assessed: boolean; threadId: string }>('notes:docText', payload);
    expect(first.assessed).toBe(true);
    // What the real actor's `assessDocText` leaves behind: the verbatim text as a doc_text message.
    fx.store.messages.insert({
      id: 'm_doc_text',
      room_id: fx.roomId,
      participant_id: 'p_student',
      seq: 60,
      body: CLAIM,
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
      anchor_id: first.threadId,
      created_at: '2026-09-19T10:00:00.000Z',
    });
    fx.db.prepare("UPDATE messages SET kind = 'doc_text' WHERE id = 'm_doc_text'").run({});

    // The relaunch: main's memory is gone, and the renderer reports every learner block again.
    resetDocTextState();
    const again = await table.call<{ assessed: boolean; reason: string | null }>('notes:docText', payload);
    expect(again).toMatchObject({ assessed: false, reason: 'unchanged' });
    expect(fx.actor.calls.filter((c) => c.method === 'assessDocText')).toHaveLength(1);

    const edited = await table.call<{ assessed: boolean }>('notes:docText', {
      ...payload,
      text: `${CLAIM} So a zero eigenvalue still counts.`,
    });
    expect(edited.assessed).toBe(true);
  });

  it('refuses a block no objective claims, and never creates a room for it', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o1', { refs: [{ page: 1 }] })]);
    const out = await wire(fx).call<{ assessed: boolean; reason: string | null }>('notes:docText', payload);
    expect(out).toEqual({ assessed: false, threadId: null, reason: 'no_objective' });
    expect(fx.opened).toEqual([]);
  });

  it('refuses half a sentence before it costs a model call', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const out = await wire(fx).call<{ reason: string | null }>('notes:docText', { ...payload, text: 'the Hessian' });
    expect(out.reason).toBe('too_short');
    expect(fx.actor.calls).toEqual([]);
  });

  it('refuses a file with no ingested document', async () => {
    const fx = fakeHost();
    const out = await wire(fx).call<{ reason: string | null }>('notes:docText', payload);
    expect(out).toEqual({ assessed: false, threadId: null, reason: 'no_doc' });
  });

  it('refuses a block whose id has not been minted', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    const out = await wire(fx).call<{ reason: string | null }>('notes:docText', { ...payload, blockId: '' });
    expect(out).toEqual({ assessed: false, threadId: null, reason: 'no_doc' });
  });
});

describe('closeFileQuestions', () => {
  it('dispatches the closure release and does not wait for it', () => {
    const fx = fakeHost({ doc: deck() });
    closeFileQuestions(fx.host, fx.roomId);
    expect(fx.actor.last('closeOpenQuestion')!.args).toEqual(['closure']);
  });

  it('is a no-op when the actor has no open question machinery or the room is gone', () => {
    const fx = fakeHost({ doc: deck() });
    fx.actor.omit('closeOpenQuestion');
    expect(() => closeFileQuestions(fx.host, fx.roomId)).not.toThrow();
    expect(fx.actor.calls).toEqual([]);
  });

  /**
   * Opening another file stops this room's actor while its closure turn is still out (#49). What
   * it closed has to be saved as *this* room's sitting: `persistFlow` saves the open actor, which
   * by then is the other file's, and a relaunch would restore the question as open and release
   * it a second time.
   */
  it('saves the closed room’s own sitting once the release lands, even after another room opened', async () => {
    const fx = fakeHost({ doc: deck() });
    const other = { snapshot: () => ({ roomId: 'room_other' }) };
    closeFileQuestions(fx.host, fx.roomId);
    Object.assign(fx.host, { currentActor: () => other });
    await new Promise((resolve) => setImmediate(resolve));
    expect(loadFlowState(fx.store, fx.roomId)).toEqual(fx.actor.flowSnapshot());
  });
});

describe('chat:closeFile', () => {
  it('releases the open question of the file being closed, without waiting for it', async () => {
    const fx = fakeHost({ doc: deck() });
    const out = await wire(fx).call<{ closing: boolean }>('chat:closeFile', { fileId: 'f_deck' });
    expect(out).toEqual({ closing: true });
    expect(fx.actor.last('closeOpenQuestion')!.args).toEqual(['closure']);
    // A read path: closing a file never opens a room.
    expect(fx.opened).toEqual([]);
  });

  it('leaves the open room alone when it belongs to another file', async () => {
    const fx = fakeHost({ doc: deck() });
    const out = await wire(fx).call<{ closing: boolean }>('chat:closeFile', { fileId: 'f_other' });
    expect(out).toEqual({ closing: false });
    expect(fx.actor.calls).toEqual([]);
  });

  it('does nothing when no room is open', async () => {
    const fx = fakeHost({ doc: deck() });
    Object.assign(fx.host, { currentActor: () => null });
    const out = await wire(fx).call<{ closing: boolean }>('chat:closeFile', { fileId: 'f_deck' });
    expect(out).toEqual({ closing: false });
    expect(fx.actor.calls).toEqual([]);
  });
});

// ── New Conversation (2026-09-23) ─────────────────────────────────────────

describe('chat:reset', () => {
  it('does nothing, and asks nothing, when the file has no conversation yet', async () => {
    const fx = fakeHost({ doc: deck() });
    const out = await wire(fx).call<{ confirmed: boolean; reset: boolean }>('chat:reset', { fileId: 'f_deck' });
    expect(out).toEqual({ confirmed: false, reset: false });
    expect(fx.confirms).toEqual([]);
    expect(fx.retired).toEqual([]);
  });

  it('asks first, and a Cancel leaves the room exactly as it was', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.roomExists = true;
    fx.confirmAnswer = false;
    const out = await wire(fx).call<{ confirmed: boolean; reset: boolean }>('chat:reset', { fileId: 'f_deck' });
    expect(out).toEqual({ confirmed: false, reset: false });
    expect(fx.confirms).toHaveLength(1);
    expect(fx.confirms[0]!.confirmLabel).toBe('New Conversation');
    expect(fx.confirms[0]!.detail).toContain('Your notes and your progress are kept');
    expect(fx.retired).toEqual([]);
  });

  it('retires the room on a yes, names an open question in the sheet, and the next read finds no room', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.roomExists = true;
    fx.actor.threads = [
      {
        threadId: 'doc',
        kind: 'doc',
        blockId: null,
        quote: null,
        agentKey: null,
        messageIds: [],
        lastSeenSeq: 0,
        quiz: { open: true } as never,
        createdAt: 'whenever',
      },
    ];
    const table = wire(fx);
    const out = await table.call<{ confirmed: boolean; reset: boolean }>('chat:reset', { fileId: 'f_deck' });
    expect(out).toEqual({ confirmed: true, reset: true });
    expect(fx.confirms[0]!.detail).toContain('open question is dropped');
    expect(fx.retired).toEqual([{ roomId: fx.roomId, reason: 'learner_reset' }]);
    // An open question is dropped, not released: no closure turn is asked for.
    expect(fx.actor.last('closeOpenQuestion')).toBeUndefined();
    const view = await table.call<ChatView>('chat:threads', { fileId: 'f_deck' });
    expect(view.roomId).toBeNull();
  });
});

// ── notebooks (`notebooks.md`, contract C2 and C7) ───────────────────────

const NB = 'nb_test';

describe('notes:blockAction', () => {
  const base = { fileId: 'f_deck', docId: 'doc_deck', blockId: 'b_2', kind: 'explain' as const, quote: 'The Hessian test decides it on the interior.' };
  type Out = { accepted: boolean; roomId: string | null; threadId: string | null; reason: string | null };

  it('opens the room, mints the block’s span thread and asks the actor, with its pages resolved here', async () => {
    const fx = fakeHost({ doc: deck() });
    fx.setTree([objective('o2', { refs: [{ page: 2 }] })]);
    fx.pageText = 'THE SLIDE OF THE BLOCK';
    const out = await wire(fx).call<Out>('notes:blockAction', base);

    expect(out).toMatchObject({ accepted: true, roomId: fx.roomId, reason: null });
    expect(out.threadId).toMatch(/^span_/);
    const args = fx.actor.last('blockAction')!.args[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      kind: 'explain',
      blockId: 'b_2',
      anchorId: out.threadId,
      quote: base.quote,
      objectiveId: 'o2',
      passage: 'THE SLIDE OF THE BLOCK',
    });
    expect(args.context).toMatchObject({ scope: 'segment', passageText: 'THE SLIDE OF THE BLOCK' });
    const row = fx.db.prepare("SELECT block_id, objective_id FROM notes_threads WHERE thread_id = @t").get<{ block_id: string; objective_id: string }>({
      t: out.threadId,
    })!;
    expect(row).toEqual({ block_id: 'b_2', objective_id: 'o2' });
  });

  it('reuses the block’s one span thread for every action on it', async () => {
    const fx = fakeHost({ doc: deck() });
    const table = wire(fx);
    const first = await table.call<Out>('notes:blockAction', base);
    const second = await table.call<Out>('notes:blockAction', { ...base, kind: 'quiz' });
    expect(second.threadId).toBe(first.threadId);
    expect(fx.db.prepare("SELECT COUNT(*) AS n FROM notes_threads WHERE kind = 'span'").get<{ n: number }>({})!.n).toBe(1);
  });

  it('passes the actor’s refusal through, and leaves no empty thread behind', async () => {
    for (const reason of ['busy', 'question_open'] as const) {
      const fx = fakeHost({ doc: deck() });
      fx.actor.blockActionResult = { accepted: false, threadId: reason === 'question_open' ? 'span_open' : null, reason };
      const out = await wire(fx).call<Out>('notes:blockAction', base);
      expect(out).toEqual({ accepted: false, roomId: fx.roomId, threadId: reason === 'question_open' ? 'span_open' : null, reason });
      expect(fx.db.prepare("SELECT COUNT(*) AS n FROM notes_threads WHERE kind = 'span'").get<{ n: number }>({})!.n).toBe(0);
    }
  });

  it('refuses without a block or a document, before any room is opened', async () => {
    const fx = fakeHost({ doc: deck() });
    expect((await wire(fx).call<Out>('notes:blockAction', { ...base, blockId: '' })).reason).toBe('no_doc');
    const empty = fakeHost();
    expect((await wire(empty).call<Out>('notes:blockAction', base)).reason).toBe('no_doc');
    expect(fx.opened).toEqual([]);
    expect(empty.opened).toEqual([]);
    expect(fx.actor.calls).toEqual([]);
  });
});

describe('notebook-aware page text (C2)', () => {
  const notebook = () => fakeHost({ doc: deck(), fileId: NB, contentSha: `nb:${NB}` });

  it('reads a span thread’s pages from the notebook, never the vault', async () => {
    const fx = notebook();
    fx.notebookPageText = 'NOTEBOOK PAGE 2';
    await wire(fx).call('chat:openSpan', { fileId: NB, blockId: 'b_2', quote: 'the Hessian test', question: 'Why?' });
    expect(fx.notebookReads).toEqual([{ notebookId: NB, pageFrom: 2, pageTo: 2 }]);
    expect(fx.vaultReads).toEqual([]);
    const context = fx.actor.last('sendMessage')!.args[2] as { scope: string; passageText: string };
    expect(context).toMatchObject({ scope: 'segment', passageText: 'NOTEBOOK PAGE 2' });
  });

  it('answers the doc chat from the notebook’s deck text', async () => {
    const fx = notebook();
    await wire(fx).call('chat:send', { fileId: NB, text: 'what is this about?' });
    const context = fx.actor.last('sendMessage')!.args[2] as { scope: string; passageText: string };
    expect(context).toMatchObject({ scope: 'deck', passageText: 'The notebook deck: [p. 1] … [p. 12] …' });
    expect(fx.vaultReads).toEqual([]);
  });

  it('reads a generated block’s section and a block action’s slide from the notebook too', async () => {
    const fx = notebook();
    fx.notebookPageText = 'NOTEBOOK SECTION';
    const table = wire(fx);
    await table.call('notes:generateBlock', { fileId: NB, docId: 'doc_deck', blockId: 'b_2', kind: 'table', instruction: null });
    expect(fx.actor.last('generateBlock')!.args[0]).toMatchObject({ passage: 'NOTEBOOK SECTION', pageCount: 12 });
    await table.call('notes:blockAction', { fileId: NB, docId: 'doc_deck', blockId: 'b_2', kind: 'example', quote: 'x' });
    expect(fx.actor.last('blockAction')!.args[0]).toMatchObject({ passage: 'NOTEBOOK SECTION' });
    expect(fx.vaultReads).toEqual([]);
  });
});

// ── tutorials (`tutorials.md` §4: Explain and Ask work on any line of the sheet) ─────────────

describe('a block action on a tutorial sheet’s line', () => {
  const TUT_KEY = `nb:${NB}:tut:f_tut`;
  const withTutorial = () => {
    const fx = fakeHost({ doc: deck(), fileId: NB, contentSha: `nb:${NB}` });
    fx.db
      .prepare(
        `INSERT INTO notes_docs (id, content_sha, file_id, title, page_count, version, doc_json, ingest_status, ingest_version, created_at, updated_at)
         VALUES ('doc_tut', @sha, 'f_tut', 'Tutorial 1', 12, 1, @json, 'ready', 1, @now, @now)`,
      )
      .run({
        sha: TUT_KEY,
        json: JSON.stringify(docOf(para('b_t1', 'Give a valid plan.', 'ingest', null, [9])).toJSON()),
        now: '2026-10-03T10:00:00.000Z',
      });
    return fx;
  };

  it('opens its thread on the tutorial’s doc and reads the sheet’s page, with docKey', async () => {
    const fx = withTutorial();
    fx.notebookPageText = 'SHEET PAGE 9';
    const out = await wire(fx).call<{ accepted: boolean; threadId: string }>('notes:blockAction', {
      fileId: NB,
      docId: 'doc_tut',
      docKey: TUT_KEY,
      blockId: 'b_t1',
      kind: 'explain',
      quote: 'Give a valid plan.',
    });
    expect(out.accepted).toBe(true);
    const row = fx.db.prepare('SELECT doc_id, block_id FROM notes_threads WHERE thread_id = @t').get<{ doc_id: string; block_id: string }>({
      t: out.threadId,
    })!;
    expect(row).toEqual({ doc_id: 'doc_tut', block_id: 'b_t1' });
    expect(fx.notebookReads).toEqual([{ notebookId: NB, pageFrom: 9, pageTo: 9 }]);
    expect(fx.actor.last('blockAction')!.args[0]).toMatchObject({ passage: 'SHEET PAGE 9' });
  });

  it('refuses another notebook’s tutorial key', async () => {
    const fx = withTutorial();
    const out = await wire(fx).call<{ reason: string | null }>('notes:blockAction', {
      fileId: NB,
      docId: 'doc_tut',
      docKey: 'nb:nb_other:tut:f_tut',
      blockId: 'b_t1',
      kind: 'explain',
      quote: 'x',
    });
    expect(out.reason).toBe('no_doc');
  });

  it('opens Ask… on a sheet line in the tutorial’s doc too', async () => {
    const fx = withTutorial();
    const out = await wire(fx).call<{ threadId: string }>('chat:openSpan', {
      fileId: NB,
      docKey: TUT_KEY,
      blockId: 'b_t1',
      quote: 'Give a valid plan.',
      question: 'What counts as valid?',
    });
    const row = fx.db.prepare('SELECT doc_id FROM notes_threads WHERE thread_id = @t').get<{ doc_id: string }>({ t: out.threadId })!;
    expect(row.doc_id).toBe('doc_tut');
    expect(fx.notebookReads).toEqual([{ notebookId: NB, pageFrom: 9, pageTo: 9 }]);
  });
});
