/**
 * The Gemini client against a fake `fetch` streaming `streamGenerateContent?alt=sse` chunks in
 * the documented shape: `candidates[0].content.parts[]` (thought parts flagged `thought: true`),
 * `finishReason`, and a cumulative `usageMetadata` on every chunk. No network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chop, fakeFetch, sse } from '../../test-support/sse.js';
import { GeminiClient, normaliseGeminiUsage, takesThinkingLevel } from './gemini.js';
import { LlmHttpError } from './http.js';
import { LlmAbortedError, type LlmRequest } from './types.js';

const KEY = 'AIzaSyTEST0123456789abcdefghijklmnopq';
const SCHEMA = { type: 'object', properties: { speak: { type: 'boolean' } }, required: ['speak'] };

function req(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'gemini-3.8-flash',
    max_tokens: 600,
    system: [
      { type: 'text', text: 'SHARED' },
      { type: 'text', text: 'DIRECTIVE' },
    ],
    messages: [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ],
    meta: { scope: 'group' },
    ...over,
  };
}

const part = (text: string, usage: Record<string, number>, extra: Record<string, unknown> = {}, finishReason?: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ text, ...extra }] }, index: 0, ...(finishReason ? { finishReason } : {}) }],
  usageMetadata: usage,
  modelVersion: 'gemini-3.8-flash',
  responseId: 'r1',
});

const STREAM = sse([
  part('thinking about it', { promptTokenCount: 900, totalTokenCount: 910, thoughtsTokenCount: 10 }, { thought: true }),
  part('Because ', { promptTokenCount: 900, candidatesTokenCount: 2, thoughtsTokenCount: 10, totalTokenCount: 912 }),
  part('curvature.', { promptTokenCount: 900, cachedContentTokenCount: 512, candidatesTokenCount: 5, thoughtsTokenCount: 10, totalTokenCount: 915 }, {}, 'STOP'),
]);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-gemini-'));
  writeFileSync(join(dir, 'p1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Gemini: a streamed turn', () => {
  it('delivers visible text only, never thought parts, with the last (cumulative) usage', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    const client = new GeminiClient({ apiKey: KEY, fetch });
    const deltas: string[] = [];
    const result = await client.complete(req(), (d) => deltas.push(d));

    expect(deltas).toEqual(['Because ', 'curvature.']);
    expect(result.text).toBe('Because curvature.');
    expect(result.backend).toBe('gemini');
    expect(result.model).toBe('gemini-3.8-flash');
    // Cached prompt tokens out of input; thought tokens into output (they are billed as output).
    expect(result.usage).toEqual({ input_tokens: 388, output_tokens: 15, cache_read_input_tokens: 512, cache_creation_input_tokens: 0 });
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    // The key travels in a header, never in the URL.
    expect(calls[0]!.headers['x-goog-api-key']).toBe(KEY);
    expect(calls[0]!.url).not.toContain(KEY);
  });

  it('maps the port onto generateContent: systemInstruction, model role, headroom, low thinking', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    await new GeminiClient({ apiKey: KEY, fetch }).complete(req({ temperature: 0.5 }));
    const body = calls[0]!.body;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SHARED\n\nDIRECTIVE' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1' }] },
      { role: 'user', parts: [{ text: 'Q2' }] },
    ]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 600 + 1024, temperature: 0.5, thinkingConfig: { thinkingLevel: 'LOW' } });
  });

  it('merges consecutive turns of the same role, which the API wants alternating', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    await new GeminiClient({ apiKey: KEY, fetch }).complete(
      req({ messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }),
    );
    expect(calls[0]!.body.contents).toEqual([{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }]);
  });

  it('survives chunk boundaries anywhere', async () => {
    const { fetch } = fakeFetch([{ status: 200, chunks: chop(STREAM, 3) }]);
    expect((await new GeminiClient({ apiKey: KEY, fetch }).complete(req())).text).toBe('Because curvature.');
  });

  it('says so when the prompt was blocked, instead of returning an empty turn', async () => {
    const blocked = sse([{ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 10 } }]);
    const { fetch } = fakeFetch([{ status: 200, chunks: [blocked] }]);
    await expect(new GeminiClient({ apiKey: KEY, fetch }).complete(req())).rejects.toThrow(/blocked the prompt \(SAFETY\)/);
  });

  it('says so when thinking used the whole budget', async () => {
    const out = sse([part('', { promptTokenCount: 10, thoughtsTokenCount: 1624 }, { thought: true }, 'MAX_TOKENS')]);
    const { fetch } = fakeFetch([{ status: 200, chunks: [out] }]);
    await expect(new GeminiClient({ apiKey: KEY, fetch }).complete(req())).rejects.toThrow(/whole output budget/);
  });
});

describe('Gemini: structured output and images', () => {
  it('asks for JSON with responseJsonSchema and returns it', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [sse([part('{"speak": true}', { promptTokenCount: 5 }, {}, 'STOP')])] }]);
    const result = await new GeminiClient({ apiKey: KEY, fetch }).complete(req({ jsonSchema: SCHEMA }));
    const config = calls[0]!.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseJsonSchema).toEqual(SCHEMA);
    expect(JSON.parse(result.text)).toEqual({ speak: true });
  });

  it('moves the schema into the prompt when the model refuses it, keeping JSON mode', async () => {
    const refusal = { error: { code: 400, message: 'Invalid JSON payload: responseJsonSchema is not supported for this model.', status: 'INVALID_ARGUMENT' } };
    const { fetch, calls } = fakeFetch([
      { status: 400, body: JSON.stringify(refusal) },
      { status: 200, chunks: [sse([part('{"speak": false}', { promptTokenCount: 5 }, {}, 'STOP')])] },
    ]);
    const result = await new GeminiClient({ apiKey: KEY, fetch }).complete(req({ jsonSchema: SCHEMA }));
    const retry = calls[1]!.body;
    expect((retry.generationConfig as Record<string, unknown>).responseJsonSchema).toBeUndefined();
    expect((retry.generationConfig as Record<string, unknown>).responseMimeType).toBe('application/json');
    expect(JSON.stringify(retry.systemInstruction)).toContain('JSON Schema');
    expect(result.text).toBe('{"speak": false}');
  });

  it('drops thinkingConfig for a model that rejects it', async () => {
    const refusal = { error: { code: 400, message: 'thinking_level is not supported for this model.', status: 'INVALID_ARGUMENT' } };
    const { fetch, calls } = fakeFetch([{ status: 400, body: JSON.stringify(refusal) }, { status: 200, chunks: [STREAM] }]);
    await new GeminiClient({ apiKey: KEY, fetch }).complete(req());
    expect((calls[1]!.body.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it('sends the slides as inlineData ahead of the last user turn', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [STREAM] }]);
    await new GeminiClient({ apiKey: KEY, fetch }).complete(req({ images: [{ path: join(dir, 'p1.jpg'), mime: 'image/jpeg', page: 4 }] }));
    const contents = calls[0]!.body.contents as { parts: unknown[] }[];
    expect(contents[2]!.parts).toEqual([
      { inlineData: { mimeType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') } },
      { text: 'Q2' },
    ]);
  });

  it('leaves Gemini 2.x at its own thinking default', () => {
    expect(takesThinkingLevel('gemini-2.5-flash')).toBe(false);
    expect(takesThinkingLevel('gemini-3.8-flash')).toBe(true);
    expect(takesThinkingLevel('gemini-3.1-pro-preview')).toBe(true);
  });
});

describe('Gemini: Stop and errors', () => {
  it('Stop mid-stream throws LlmAbortedError', async () => {
    const { fetch } = fakeFetch([{ status: 200, chunks: [sse([part('Par', { promptTokenCount: 1 })])], hang: true }]);
    const controller = new AbortController();
    const pending = new GeminiClient({ apiKey: KEY, fetch }).complete(req(), () => controller.abort(), controller.signal);
    await expect(pending).rejects.toBeInstanceOf(LlmAbortedError);
  });

  it.each([
    [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 401, /rejected the API key/],
    [403, { error: { code: 403, message: 'Permission denied.', status: 'PERMISSION_DENIED' } }, 403, /refused the call \(403\)/],
    [404, { error: { code: 404, message: 'models/gemini-9 is not found for API version v1beta.', status: 'NOT_FOUND' } }, 404, /does not know the model/],
    [429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }, 429, /rate-limiting/],
  ])('%i is surfaced as a learner-readable error', async (status, body, expectedStatus, pattern) => {
    const { fetch } = fakeFetch([{ status, body: JSON.stringify(body) }]);
    const err = await new GeminiClient({ apiKey: KEY, fetch })
      .complete(req())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect((err as LlmHttpError).status).toBe(expectedStatus);
    expect((err as Error).message).toMatch(pattern);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('normalises absent usage to zeros', () => {
    expect(normaliseGeminiUsage(null)).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  });
});
