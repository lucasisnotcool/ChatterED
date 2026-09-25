/**
 * The OpenAI client, both flavours, against a fake `fetch` streaming the chunk shapes the Chat
 * Completions API documents (`chat.completion.chunk`, a terminal usage chunk with `choices: []`,
 * then `[DONE]`). No network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chop, fakeFetch, sse } from '../../test-support/sse.js';
import { LlmHttpError } from './http.js';
import { isOpenAiReasoningModel, normaliseOpenAiUsage, OpenAIClient } from './openai.js';
import { LlmAbortedError, type LlmRequest } from './types.js';

const SCHEMA = {
  type: 'object',
  properties: { speak: { type: 'boolean' }, why: { type: 'string' } },
  required: ['speak', 'why'],
  additionalProperties: false,
};

function req(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'gpt-6-sol',
    max_tokens: 400,
    system: [
      { type: 'text', text: 'SHARED PREFIX', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'TURN DIRECTIVE' },
    ],
    messages: [
      { role: 'user', content: 'What is a Hessian?' },
      { role: 'assistant', content: 'A matrix of second derivatives.' },
      { role: 'user', content: 'Why PSD?' },
    ],
    meta: { scope: 'group' },
    ...over,
  };
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'gpt-6-sol-2026-09-01',
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const USAGE = {
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'gpt-6-sol-2026-09-01',
  choices: [],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 40,
    total_tokens: 1240,
    prompt_tokens_details: { cached_tokens: 1024 },
    completion_tokens_details: { reasoning_tokens: 12 },
  },
};
const STREAM = sse(
  [chunk({ role: 'assistant', content: '' }), chunk({ content: 'Because ' }), chunk({ content: 'curvature.' }), chunk({}, 'stop'), USAGE],
  { done: true },
);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-openai-'));
  writeFileSync(join(dir, 'p1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('OpenAI: a streamed turn', () => {
  it('delivers each delta, the whole text, the model that answered and normalised usage', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    const client = new OpenAIClient({ flavour: 'openai', apiKey: 'sk-proj-test0123456789abcdef', fetch });
    const deltas: string[] = [];
    const result = await client.complete(req(), (d) => deltas.push(d));

    expect(deltas).toEqual(['Because ', 'curvature.']);
    expect(result.text).toBe('Because curvature.');
    expect(result.model).toBe('gpt-6-sol-2026-09-01');
    expect(result.backend).toBe('openai');
    expect(client.kind).toBe('openai');
    expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    // prompt_tokens includes the cached prefix; the ledger wants them apart.
    expect(result.usage).toEqual({ input_tokens: 176, output_tokens: 40, cache_read_input_tokens: 1024, cache_creation_input_tokens: 0 });
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]!.headers.authorization).toBe('Bearer sk-proj-test0123456789abcdef');
  });

  it('writes the request for a reasoning model: developer role, completion cap with headroom, low effort, no temperature', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req({ temperature: 0.7 }));
    const body = calls[0]!.body;
    expect(body.messages).toEqual([
      { role: 'developer', content: 'SHARED PREFIX\n\nTURN DIRECTIVE' },
      { role: 'user', content: 'What is a Hessian?' },
      { role: 'assistant', content: 'A matrix of second derivatives.' },
      { role: 'user', content: 'Why PSD?' },
    ]);
    expect(body.max_completion_tokens).toBe(400 + 1024);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body.reasoning_effort).toBe('low');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('keeps temperature and skips reasoning_effort on a non-reasoning model', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req({ model: 'gpt-4.1', temperature: 0.3 }));
    expect(calls[0]!.body.temperature).toBe(0.3);
    expect(calls[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(calls[0]!.body.max_completion_tokens).toBe(400);
  });

  it('reassembles a stream split at arbitrary byte boundaries, CRLF framing included', async () => {
    const crlf = sse([chunk({ content: 'Ünï' }), chunk({ content: 'cødé ✓' }), USAGE], { done: true, crlf: true });
    const { fetch } = fakeFetch([{ status: 200, chunks: chop(crlf, 5) }]);
    const result = await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req());
    expect(result.text).toBe('Ünïcødé ✓');
    expect(result.usage.output_tokens).toBe(40);
  });

  it('throws an explicit error when a reasoning model spends the whole budget and writes nothing', async () => {
    const { fetch } = fakeFetch([{ status: 200, chunks: [sse([chunk({}, 'length'), USAGE], { done: true })] }]);
    await expect(new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req())).rejects.toThrow(
      /whole output budget/,
    );
  });
});

describe('OpenAI: structured output', () => {
  it('sends a strict json_schema when the schema already meets the strict rules, and returns the JSON', async () => {
    const body = JSON.stringify({ speak: true, why: 'asked' });
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [sse([chunk({ content: body }), USAGE], { done: true })] }]);
    const result = await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req({ jsonSchema: SCHEMA }));
    expect(calls[0]!.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'response', schema: SCHEMA, strict: true } });
    expect(JSON.parse(result.text)).toEqual({ speak: true, why: 'asked' });
  });

  it('sends strict:false for a schema with optional properties rather than rewriting it', async () => {
    const loose = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [sse([chunk({ content: '{"a":"x"}' })], { done: true })] }]);
    await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req({ jsonSchema: loose }));
    expect((calls[0]!.body.response_format as { json_schema: { strict: boolean; schema: unknown } }).json_schema).toMatchObject({ strict: false, schema: loose });
  });

  it('unwraps JSON the model put in a code fence with prose around it', async () => {
    const reply = 'Here you go:\n```json\n{"speak": false, "why": "quiet"}\n```\nDone.';
    const { fetch } = fakeFetch([{ status: 200, chunks: [sse([chunk({ content: reply })], { done: true })] }]);
    const result = await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req({ jsonSchema: SCHEMA }));
    expect(JSON.parse(result.text)).toEqual({ speak: false, why: 'quiet' });
  });
});

describe('OpenAI: images', () => {
  it('puts the slides on the last user turn as data URLs, ahead of its text, and drops what it cannot send', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(
      req({
        images: [
          { path: join(dir, 'p1.png'), mime: 'image/png', page: 1 },
          { path: join(dir, 'p1.png'), mime: 'image/tiff', page: 2 },
          { path: join(dir, 'missing.png'), mime: 'image/png', page: 3 },
        ],
      }),
    );
    const messages = calls[0]!.body.messages as { role: string; content: unknown }[];
    expect(messages[1]!.content).toBe('What is a Hessian?');
    expect(messages[3]!.content).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}` } },
      { type: 'text', text: 'Why PSD?' },
    ]);
  });
});

describe('OpenAI: Stop and errors', () => {
  it('Stop mid-stream throws LlmAbortedError after the deltas already delivered', async () => {
    const { fetch } = fakeFetch([{ status: 200, chunks: [sse([chunk({ content: 'Partial' })])], hang: true }]);
    const controller = new AbortController();
    const deltas: string[] = [];
    const pending = new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(
      req(),
      (d) => {
        deltas.push(d);
        controller.abort();
      },
      controller.signal,
    );
    await expect(pending).rejects.toBeInstanceOf(LlmAbortedError);
    expect(deltas).toEqual(['Partial']);
  });

  it('an already-stopped call never reaches the network', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch }).complete(req(), undefined, controller.signal),
    ).rejects.toBeInstanceOf(LlmAbortedError);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, { error: { message: 'Incorrect API key provided: sk-proj-****cdef.', type: 'invalid_request_error', code: 'invalid_api_key' } }, /rejected the API key/],
    [404, { error: { message: 'The model `gpt-9` does not exist.', type: 'invalid_request_error', code: 'model_not_found' } }, /does not know the model "gpt-6-sol"/],
    [429, { error: { message: 'Rate limit reached.', type: 'requests', code: 'rate_limit_exceeded' } }, /rate-limiting/],
    [500, { error: { message: 'boom' } }, /server error/],
  ])('%i becomes a sentence the learner can act on', async (status, body, pattern) => {
    const { fetch } = fakeFetch([{ status, body: JSON.stringify(body) }]);
    const err = await new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch })
      .complete(req())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect((err as LlmHttpError).status).toBe(status);
    expect((err as Error).message).toMatch(pattern);
    expect((err as Error).message).toContain(body.error.message);
  });

  it('retries once without a parameter the model rejects, and remembers it for the next call', async () => {
    const rejected = { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: 'invalid_request_error', param: 'temperature' } };
    const { fetch, calls } = fakeFetch([
      { status: 400, body: JSON.stringify(rejected) },
      { status: 200, chunks: [STREAM] },
      { status: 200, chunks: [STREAM] },
    ]);
    const client = new OpenAIClient({ flavour: 'openai', apiKey: 'sk-test0123456789abcdefgh', fetch });
    const result = await client.complete(req({ model: 'gpt-4.1', temperature: 0.2 }));
    expect(result.text).toBe('Because curvature.');
    expect(calls[0]!.body.temperature).toBe(0.2);
    expect(calls[1]!.body).not.toHaveProperty('temperature');
    await client.complete(req({ model: 'gpt-4.1', temperature: 0.2 }));
    expect(calls).toHaveLength(3);
    expect(calls[2]!.body).not.toHaveProperty('temperature');
  });
});

describe('OpenAI-compatible endpoints', () => {
  it('uses the typed base URL, no auth header without a key, the system role and max_tokens', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    const client = new OpenAIClient({ flavour: 'compatible', baseUrl: 'http://localhost:11434/v1/chat/completions/', fetch });
    const result = await client.complete(req({ model: 'llama3.3:70b', temperature: 0.4 }));
    expect(client.kind).toBe('openai-compatible');
    expect(result.backend).toBe('openai-compatible');
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0]!.headers).not.toHaveProperty('authorization');
    const body = calls[0]!.body;
    expect((body.messages as { role: string }[])[0]!.role).toBe('system');
    expect(body.max_tokens).toBe(400);
    expect(body.temperature).toBe(0.4);
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('falls back json_schema → json_object → prompted when the endpoint rejects each, and keeps what worked', async () => {
    const noSchema = { error: { message: "This response_format type is unavailable now: 'json_schema'", type: 'invalid_request_error' } };
    const noObject = { error: { message: 'response_format is not supported' } };
    const answer = sse([chunk({ content: 'Sure! {"speak": true, "why": "x"}' })], { done: true });
    const { fetch, calls } = fakeFetch([
      { status: 400, body: JSON.stringify(noSchema) },
      { status: 400, body: JSON.stringify(noObject) },
      { status: 200, chunks: [answer] },
      { status: 200, chunks: [answer] },
    ]);
    const client = new OpenAIClient({ flavour: 'compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-deepseek0123456789ab', fetch });
    const result = await client.complete(req({ model: 'deepseek-chat', jsonSchema: SCHEMA }));

    expect((calls[0]!.body.response_format as { type: string }).type).toBe('json_schema');
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' });
    // Once the schema is not a parameter, it is in the prompt — and the prompt says "JSON".
    const system1 = (calls[1]!.body.messages as { content: string }[])[0]!.content;
    expect(system1).toContain('JSON Schema');
    expect(system1).toContain('"speak"');
    expect(calls[2]!.body).not.toHaveProperty('response_format');
    expect(JSON.parse(result.text)).toEqual({ speak: true, why: 'x' });

    await client.complete(req({ model: 'deepseek-chat', jsonSchema: SCHEMA }));
    expect(calls).toHaveLength(4);
    expect(calls[3]!.body).not.toHaveProperty('response_format');
  });

  it('reads DeepSeek-style cache counts', () => {
    expect(normaliseOpenAiUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 64 })).toEqual({
      input_tokens: 36,
      output_tokens: 5,
      cache_read_input_tokens: 64,
      cache_creation_input_tokens: 0,
    });
  });

  it('surfaces an error object streamed on a 200', async () => {
    const { fetch } = fakeFetch([{ status: 200, chunks: [sse([{ error: { message: 'model crashed' } }])] }]);
    await expect(
      new OpenAIClient({ flavour: 'compatible', baseUrl: 'http://127.0.0.1:1234/v1', fetch }).complete(req({ model: 'qwen' })),
    ).rejects.toThrow(/model crashed/);
  });

  it('refuses to be built without a base URL', () => {
    expect(() => new OpenAIClient({ flavour: 'compatible' })).toThrow(/base URL/);
  });
});

describe('which OpenAI ids are reasoning models', () => {
  it.each([
    ['gpt-6-sol', true],
    ['gpt-6-astra', true],
    ['gpt-5.4-mini', true],
    ['o4-mini', true],
    ['gpt-4.1', false],
    ['gpt-4o-mini', false],
    ['chat-latest', false],
  ])('%s → %s', (id, expected) => {
    expect(isOpenAiReasoningModel(id)).toBe(expected);
  });
});
