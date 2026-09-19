/**
 * The API client's image path (#48, `collab-doc.md` §2: the refine pass runs "with the slide
 * images"). No network: what is tested is the request body this client *would* send, which is
 * the only part of it that changed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMAGE_BYTES_PER_REQUEST, withImages } from './anthropic.js';
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
