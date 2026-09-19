import { beforeEach, describe, expect, it } from 'vitest';
import { docOf, para } from '../../shared/doc/fixture.test-support.js';
import type { ChatView } from '../../shared/doc/types.js';
import { fakeHost, handlerTable, objective, type FakeHost } from './fakehost.test-support.js';
import { resetDocCache } from './doc.js';
import { closeFileQuestions, registerDocRoomIpc, resetDocTextState } from './ipc.js';

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
});
