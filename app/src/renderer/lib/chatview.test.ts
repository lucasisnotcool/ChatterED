import { describe, expect, it } from 'vitest';
import {
  AGENT_HUE,
  agentOf,
  chatComposer,
  chatTag,
  docThread,
  findThread,
  isEllieGuess,
  mentionPieces,
  mentionQuery,
  mergeThread,
  messagesOf,
  parseMention,
  tabs,
  threadsOfKind,
  unreadCount,
} from './chatview.js';
import type { DocQuizView, ThreadView } from '../../shared/doc/types.js';
import type { MessageView } from '../../shared/types.js';

function thread(id: string, over: Partial<ThreadView> = {}): ThreadView {
  return {
    threadId: id,
    kind: 'doc',
    blockId: null,
    quote: null,
    agentKey: null,
    messageIds: [],
    lastSeenSeq: 0,
    quiz: null,
    createdAt: '2026-09-19T10:00:00.000Z',
    ...over,
  };
}

function message(id: string, seq: number, over: Partial<MessageView> = {}): MessageView {
  return {
    id,
    seq,
    speaker: { kind: 'agent', key: 'peer.ellie', role: 'peer', displayName: 'Ellie', colour: '#0f7b6c' },
    body: 'hello',
    createdAt: '2026-09-19T10:00:00.000Z',
    latencyTargetMs: null,
    ttftActualMs: null,
    promotedFromWhisper: false,
    disagreement: null,
    divider: null,
    reference: null,
    anchorId: 'doc',
    byRule: null,
    ...over,
  };
}

function quiz(over: Partial<DocQuizView> = {}): DocQuizView {
  return {
    quizMessageId: 'm1',
    elementId: 'obj-1',
    attempts: 0,
    feedbackGiven: false,
    answerShown: false,
    verdict: null,
    questionId: 'q1',
    objectiveId: 'obj-1',
    cueGiven: false,
    resolution: null,
    open: true,
    ...over,
  };
}

describe('agentOf', () => {
  it('reads the role, not the name', () => {
    expect(agentOf(message('m1', 1))).toBe('ellie');
    expect(
      agentOf(
        message('m2', 2, {
          speaker: { kind: 'agent', key: 'challenger.max', role: 'challenger', displayName: 'Rex', colour: '#b45309' },
        }),
      ),
    ).toBe('max');
    expect(agentOf(message('m3', 3, { speaker: { kind: 'student', displayName: 'You' } }))).toBeNull();
  });

  it('gives the two agents the tokens the doc uses for their edits', () => {
    expect(AGENT_HUE.ellie).toBe('var(--peer)');
    expect(AGENT_HUE.max).toBe('var(--challenger)');
  });
});

describe('parseMention', () => {
  it('takes the first mention and hands back the rest', () => {
    expect(parseMention('@Max what did you mean?')).toEqual({ agent: 'max', rest: 'what did you mean?' });
    expect(parseMention('hey @ellie   can you explain')).toEqual({ agent: 'ellie', rest: 'hey can you explain' });
    expect(parseMention('@ELLIE and @max')).toEqual({ agent: 'ellie', rest: 'and @max' });
  });

  it('is null when nobody was named', () => {
    expect(parseMention('what is a wizard of oz study?')).toBeNull();
    expect(parseMention('email me@maximum.com')).toBeNull();
  });
});

describe('mentionPieces', () => {
  it('tokenises every mention, not only the one that wins', () => {
    expect(mentionPieces('ask @Ellie then @Max')).toEqual([
      { kind: 'text', text: 'ask ' },
      { kind: 'mention', text: '@Ellie', agent: 'ellie' },
      { kind: 'text', text: ' then ' },
      { kind: 'mention', text: '@Max', agent: 'max' },
    ]);
  });

  it('leaves plain text as one piece', () => {
    expect(mentionPieces('no mentions here')).toEqual([{ kind: 'text', text: 'no mentions here' }]);
  });
});

describe('mentionQuery', () => {
  it('offers the menu while a mention is being typed at a word start', () => {
    expect(mentionQuery('tell @e', 7)).toEqual({ from: 5, query: 'e' });
    expect(mentionQuery('@', 1)).toEqual({ from: 0, query: '' });
  });

  it('does not fire mid-word or after the mention is finished', () => {
    expect(mentionQuery('me@you', 6)).toBeNull();
    expect(mentionQuery('@ellie what', 11)).toBeNull();
  });
});

describe('mergeThread', () => {
  it('replaces the thread with the same id and keeps order', () => {
    const before = [thread('doc'), thread('span_a', { kind: 'span' })];
    const after = mergeThread(before, thread('span_a', { kind: 'span', quote: 'the line' }));
    expect(after).toHaveLength(2);
    expect(after[1]!.quote).toBe('the line');
    expect(after[0]!.threadId).toBe('doc');
  });

  it('appends a thread it has not seen', () => {
    expect(mergeThread([thread('doc')], thread('span_b', { kind: 'span' }))).toHaveLength(2);
  });

  it('finds threads by id and by kind', () => {
    const list = [thread('doc'), thread('span_a', { kind: 'span' })];
    expect(findThread(list, 'span_a')?.kind).toBe('span');
    expect(threadsOfKind(list, 'span')).toHaveLength(1);
    expect(docThread(list)?.threadId).toBe('doc');
  });
});

describe('unreadCount and messagesOf', () => {
  const messages = [
    message('m1', 1, { anchorId: 'doc' }),
    message('m2', 2, { anchorId: 'doc', speaker: { kind: 'student', displayName: 'You' } }),
    message('m3', 3, { anchorId: 'doc' }),
    message('m4', 4, { anchorId: 'span_a' }),
    // A turn from the shipped chat room, with no anchor at all.
    message('m5', 5, { anchorId: null }),
  ];

  it('counts only agent turns past lastSeenSeq', () => {
    expect(unreadCount(thread('doc', { lastSeenSeq: 0 }), messages)).toBe(2);
    expect(unreadCount(thread('doc', { lastSeenSeq: 2 }), messages)).toBe(1);
    expect(unreadCount(thread('doc', { lastSeenSeq: 9 }), messages)).toBe(0);
  });

  it('never lets an un-anchored message fall into the doc chat', () => {
    expect(messagesOf('doc', messages).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(messagesOf('span_a', messages).map((m) => m.id)).toEqual(['m4']);
  });
});

describe('chatComposer', () => {
  it('asks a question when nothing is open', () => {
    const c = chatComposer(null);
    expect(c.answering).toBe(false);
    expect(c.pass).toBe(false);
    expect(c.note).toBeNull();
  });

  it('asks for an answer, offers Pass and says what Pass does', () => {
    const c = chatComposer(quiz());
    expect(c.placeholder).toBe('Your answer…');
    expect(c.pass).toBe(true);
    expect(c.note).toContain('Pass');
    expect(c.note).toContain('Max');
  });

  it('asks for the next attempt after a partial verdict', () => {
    const c = chatComposer(quiz({ attempts: 1, feedbackGiven: true, verdict: 'partial' }));
    expect(c.placeholder).toBe('Your next attempt…');
    expect(c.pass).toBe(true);
  });

  it('goes back to asking once the question is closed', () => {
    const c = chatComposer(quiz({ open: false, answerShown: true, resolution: 'released' }));
    expect(c.answering).toBe(false);
    expect(c.pass).toBe(false);
  });
});

describe('chatTag', () => {
  it("marks Ellie's cue as a guess and never as an answer", () => {
    const tag = chatTag('rule:ellie_cue');
    expect(tag?.kind).toBe('guess');
    expect(tag?.label).toContain('might be wrong');
    expect(isEllieGuess({ decidedBy: 'rule:ellie_cue' })).toBe(true);
    expect(isEllieGuess({ decidedBy: 'rule:ellie_answers' })).toBe(false);
  });

  it('leaves the ordinary course of the loop untagged', () => {
    expect(chatTag('rule:ellie_answers')).toBeNull();
    expect(chatTag('rule:quiz_feedback')).toBeNull();
    expect(chatTag(null)).toBeNull();
  });

  it('tags a released answer with the fact that it fills nothing', () => {
    expect(chatTag('rule:answer_released')?.label).toContain('fills nothing');
  });
});

describe('tabs', () => {
  it('rolls every shared thread into the doc tab and keeps the private ones apart', () => {
    const list = [thread('doc'), thread('span_a', { kind: 'span' })];
    const messages = [message('m1', 1, { anchorId: 'doc' }), message('m2', 2, { anchorId: 'span_a' })];
    const out = tabs({ threads: list, messages, privateUnread: { max: 3 } });
    expect(out.map((t) => t.key)).toEqual(['doc', 'ellie', 'max']);
    expect(out[0]!.unread).toBe(2);
    expect(out[1]!.unread).toBe(0);
    expect(out[2]!.unread).toBe(3);
  });
});
