/**
 * The API client's image path (#48, `collab-doc.md` §2: the refine pass runs "with the slide
 * images"). No network: what is tested is the request body this client *would* send, which is
 * the only part of it that changed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicClient, IMAGE_BYTES_PER_REQUEST, REFUSAL_MESSAGE, THINKING_HEADROOM, requestShape, thinksByDefault, withImages } from './anthropic.js';
import type { LlmRequest } from './types.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-images-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'p-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x01]));
  writeFileSync(join(dir, 'p-2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x02]));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function request(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 8_000,
    system: [{ type: 'text', text: 'SYSTEM' }],
    messages: [
      { role: 'user', content: 'window 1' },
      { role: 'assistant', content: 'the notes so far' },
      { role: 'user', content: 'window 2, pages 9–16' },
    ],
    meta: { scope: 'notes', costScope: 'notes' },
    ...over,
  };
}

describe('slide images on the API path', () => {
  it('leaves a request with no images exactly as it was', () => {
    expect(withImages(request())).toEqual([
      { role: 'user', content: 'window 1' },
      { role: 'assistant', content: 'the notes so far' },
      { role: 'user', content: 'window 2, pages 9–16' },
    ]);
  });

  it('attaches them to the last user message, ahead of its text', () => {
    const messages = withImages(
      request({
        images: [
          { path: join(dir, 'p-1.jpg'), mime: 'image/jpeg', page: 9 },
          { path: join(dir, 'p-2.jpg'), mime: 'image/jpeg', page: 10 },
        ],
      }),
    );
    // The earlier turns are untouched — the window's slides belong to the window's turn.
    expect(messages[0]!.content).toBe('window 1');
    expect(messages[1]!.content).toBe('the notes so far');
    const last = messages[2]!.content as { type: string; source?: { data: string; media_type: string } }[];
    expect(last.map((b) => b.type)).toEqual(['image', 'image', 'text']);
    expect(last[0]!.source!.media_type).toBe('image/jpeg');
    expect(last[0]!.source!.data).toBe(Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString('base64'));
    expect(last[2]).toEqual({ type: 'text', text: 'window 2, pages 9–16' });
  });

  it('drops a media type the API does not take, rather than losing the whole window to a 400', () => {
    const messages = withImages(
      request({ images: [{ path: join(dir, 'p-1.jpg'), mime: 'image/tiff', page: 9 }] }),
    );
    expect(messages[2]!.content).toBe('window 2, pages 9–16');
  });

  it('drops a page the renderer never delivered, and keeps the ones it did', () => {
    const messages = withImages(
      request({
        images: [
          { path: join(dir, 'missing.jpg'), mime: 'image/jpeg', page: 9 },
          { path: join(dir, 'p-2.jpg'), mime: 'image/jpeg', page: 10 },
        ],
      }),
    );
    const last = messages[2]!.content as { type: string }[];
    expect(last.map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('stops at the request-size ceiling rather than sending a body the API refuses', () => {
    const big = join(dir, 'big.jpg');
    // Just over the ceiling on its own, so the second image can never fit.
    writeFileSync(big, Buffer.alloc(IMAGE_BYTES_PER_REQUEST));
    const messages = withImages(
      request({
        images: [
          { path: big, mime: 'image/jpeg', page: 9 },
          { path: join(dir, 'p-2.jpg'), mime: 'image/jpeg', page: 10 },
        ],
      }),
    );
    // The first is over on its own, so nothing is attached and the window runs on text alone —
    // and the message is the plain string it would have been without images at all.
    expect(messages[2]!.content).toBe('window 2, pages 9–16');
    rmSync(big);
  });
});

/**
 * **The Claude 5 generation thinks unless told otherwise** (study build, 2026-10-15). Its thinking
 * counts against `max_tokens`, so a call keeps its visible budget and gets headroom on top, and a
 * schema-bound call runs at low effort. What is checked is the body the SDK is handed.
 */
describe('requests to models that think by default', () => {
  function fakeSdk(stopReason = 'end_turn') {
    const sent: Record<string, unknown>[] = [];
    const sdk = {
      messages: {
        stream(body: Record<string, unknown>) {
          sent.push(body);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
            },
            async finalMessage() {
              return { model: body.model, content: [], stop_reason: stopReason, usage: { input_tokens: 1, output_tokens: 1 } };
            },
          };
        },
      },
    };
    return { sent, client: new AnthropicClient({ apiKey: 'x', client: sdk as never }) };
  }

  it('knows which models think by default', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-5']) {
      expect(thinksByDefault(m)).toBe(true);
    }
    for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8', 'gpt-6-sol']) expect(thinksByDefault(m)).toBe(false);
  });

  it('adds thinking headroom to a prose call and leaves its effort alone', async () => {
    const { sent, client } = fakeSdk();
    await client.complete(request({ model: 'claude-sonnet-5-5', max_tokens: 700 }));
    expect(sent[0]!.max_tokens).toBe(700 + THINKING_HEADROOM.prose);
    expect(sent[0]!.output_config).toBeUndefined();
  });

  it('runs a schema call at low effort, with its format kept', async () => {
    const { sent, client } = fakeSdk();
    const schema = { type: 'object', properties: {} };
    await client.complete(request({ model: 'claude-sonnet-5-5', max_tokens: 1_000, jsonSchema: schema }));
    expect(sent[0]!.max_tokens).toBe(1_000 + THINKING_HEADROOM.schema);
    expect(sent[0]!.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema } });
  });

  it('sends an older model exactly what it sent before', async () => {
    const { sent, client } = fakeSdk();
    await client.complete(request({ model: 'claude-haiku-4-5', max_tokens: 400 }));
    expect(sent[0]!.max_tokens).toBe(400);
    expect(sent[0]!.output_config).toBeUndefined();
    expect(requestShape({ model: 'claude-haiku-4-5', max_tokens: 400 })).toEqual({ maxTokens: 400, effort: null });
  });

  it('turns a refusal into an error the learner can read', async () => {
    const { client } = fakeSdk('refusal');
    await expect(client.complete(request({ model: 'claude-sonnet-5-5' }))).rejects.toThrow(REFUSAL_MESSAGE);
  });
});
