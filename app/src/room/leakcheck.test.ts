import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import {
  LEAK_CHECK_AGENT_KEY,
  LEAK_CHECK_SCHEMA,
  OPEN_QUESTION_DEFER_LINE,
  QUESTION_CHECK_AGENT_KEY,
  checkLeak,
  checkQuestionLeak,
  leakCheckRequest,
  parseLeakCheck,
  questionLeakRequest,
} from './leakcheck.js';

const INPUT = {
  model: 'test-model',
  draft: 'Picture whispering to one friend while the class talks.',
  question: 'Why does a side channel never reach the shared context?',
  keyPoints: ['A side channel is private to one agent.', 'It never enters the shared context.'],
};

function fake(reply: (r: LlmRequest) => string): LLMClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    kind: 'scripted',
    requests,
    async complete(request) {
      requests.push(request);
      return { text: reply(request), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
    },
  };
}

describe('leakCheckRequest', () => {
  it('is one structured call that carries the question, the numbered key points and the draft', () => {
    const r = leakCheckRequest(INPUT);
    expect(r.jsonSchema).toBe(LEAK_CHECK_SCHEMA);
    expect(r.meta.agentKey).toBe(LEAK_CHECK_AGENT_KEY);
    expect(r.temperature).toBe(0);
    const user = r.messages[0]!.content;
    expect(user).toContain(INPUT.question);
    expect(user).toContain('1. A side channel is private to one agent.');
    expect(user).toContain('2. It never enters the shared context.');
    expect(user).toContain(INPUT.draft);
    expect(r.system[0]!.text).toMatch(/translation/);
  });
});

describe('parseLeakCheck', () => {
  it('reads the stated points, in range, once each, sorted', () => {
    expect(parseLeakCheck('{"stated":[2,1,2,7,0],"why":"x"}', 2)).toEqual([1, 2]);
    expect(parseLeakCheck('```json\n{"stated":["1"]}\n```', 2)).toEqual([1]);
  });
  it('reads anything else as none', () => {
    expect(parseLeakCheck('no', 2)).toEqual([]);
    expect(parseLeakCheck('{"stated":"1"}', 2)).toEqual([]);
    expect(parseLeakCheck('{broken', 2)).toEqual([]);
  });
});

describe('checkLeak', () => {
  it('asks the client and returns what it names', async () => {
    const llm = fake(() => '{"stated":[2],"why":"says it stays out of the shared context"}');
    expect(await checkLeak(llm, INPUT)).toEqual({ stated: [2], failed: false });
    expect(llm.requests).toHaveLength(1);
  });
  it('makes no call with no key or no draft', async () => {
    const llm = fake(() => '{"stated":[1]}');
    expect(await checkLeak(llm, { ...INPUT, keyPoints: [] })).toEqual({ stated: [], failed: false });
    expect(await checkLeak(llm, { ...INPUT, draft: '  ' })).toEqual({ stated: [], failed: false });
    expect(llm.requests).toHaveLength(0);
  });
  it('never throws: a failed call is no leak found, marked failed', async () => {
    const llm: LLMClient = {
      kind: 'scripted',
      complete: () => Promise.reject(new Error('down')),
    };
    expect(await checkLeak(llm, INPUT)).toEqual({ stated: [], failed: true });
  });
});

describe('the learner\'s question (neighbouring questions)', () => {
  const Q = { model: 'm', learnerQuestion: 'does the group ever see a private turn?', question: INPUT.question, keyPoints: INPUT.keyPoints };

  it('asks whether a direct answer to the learner\'s question would state a point', () => {
    const r = questionLeakRequest(Q);
    expect(r.meta.agentKey).toBe(QUESTION_CHECK_AGENT_KEY);
    expect(r.jsonSchema).toBe(LEAK_CHECK_SCHEMA);
    expect(r.messages[0]!.content).toContain(Q.learnerQuestion);
    expect(r.messages[0]!.content).toContain('2. It never enters the shared context.');
    expect(r.system[0]!.text).toMatch(/direct, correct answer/);
  });

  it('returns the named points, makes no call without a question or a key, and never throws', async () => {
    const llm = fake(() => '{"stated":[2],"why":"x"}');
    expect(await checkQuestionLeak(llm, Q)).toEqual({ stated: [2], failed: false });
    expect(await checkQuestionLeak(llm, { ...Q, learnerQuestion: ' ' })).toEqual({ stated: [], failed: false });
    expect(await checkQuestionLeak(llm, { ...Q, keyPoints: [] })).toEqual({ stated: [], failed: false });
    expect(llm.requests).toHaveLength(1);
    const down: LLMClient = { kind: 'scripted', complete: () => Promise.reject(new Error('down')) };
    expect(await checkQuestionLeak(down, Q)).toEqual({ stated: [], failed: true });
  });

  it('defers in a line that names Max\'s question and Hint, and holds no key content', () => {
    expect(OPEN_QUESTION_DEFER_LINE).toMatch(/Max/);
    expect(OPEN_QUESTION_DEFER_LINE).toMatch(/Hint/);
    for (const p of INPUT.keyPoints) expect(OPEN_QUESTION_DEFER_LINE).not.toContain(p);
  });
});
