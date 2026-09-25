/**
 * The SSE framer, the structured-output helpers and the error sentences the fetch-only clients
 * share. No network.
 */
import { describe, expect, it } from 'vitest';
import { httpErrorFor, providerErrorMessage, readSse, safeOrigin, withThinkingHeadroom } from './http.js';
import { extractJson, isStrictCompatible, schemaInstruction } from './structured.js';

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

async function events(chunks: string[]) {
  const out: { event: string | null; data: string }[] = [];
  for await (const ev of readSse(body(chunks))) out.push(ev);
  return out;
}

describe('readSse', () => {
  it('frames events, joins multi-line data, skips comments, and reads event names', async () => {
    expect(await events([': keep-alive\n\nevent: delta\ndata: a\ndata: b\n\ndata: {"x":1}\n\n'])).toEqual([
      { event: 'delta', data: 'a\nb' },
      { event: null, data: '{"x":1}' },
    ]);
  });

  it('handles a \\r\\n split across two chunks without inventing an empty event', async () => {
    expect(await events(['data: one\r', '\n\r\n', 'data: two\r\n\r\n'])).toEqual([
      { event: null, data: 'one' },
      { event: null, data: 'two' },
    ]);
  });

  it('delivers a last event the server did not terminate with a blank line', async () => {
    expect(await events(['data: first\n\ndata: last'])).toEqual([
      { event: null, data: 'first' },
      { event: null, data: 'last' },
    ]);
  });

  it('decodes a multi-byte character split between chunks', async () => {
    const bytes = new TextEncoder().encode('data: é✓\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7));
        c.enqueue(bytes.slice(7));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const ev of readSse(stream)) out.push(ev.data);
    expect(out).toEqual(['é✓']);
  });
});

describe('error sentences', () => {
  it('reads both providers’ error shapes and plain text', () => {
    expect(providerErrorMessage('{"error":{"message":"bad key","type":"x"}}')).toBe('bad key');
    expect(providerErrorMessage('[{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}]')).toBe('API key not valid.');
    expect(providerErrorMessage('{"error":"model not found"}')).toBe('model not found');
    expect(providerErrorMessage('<html>502 Bad Gateway</html>')).toBe('<html>502 Bad Gateway</html>');
  });

  it('treats a 400 that says the key is invalid as a key problem', () => {
    const err = httpErrorFor('Gemini', 400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}');
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/rejected the API key/);
  });

  it('never puts more than scheme and host of a URL into a message', () => {
    expect(safeOrigin('https://example.test/v1?key=secret')).toBe('https://example.test');
  });
});

describe('thinking headroom', () => {
  it('adds the cap again, between 1,024 and 8,192', () => {
    expect(withThinkingHeadroom(400)).toBe(1_424);
    expect(withThinkingHeadroom(1_600)).toBe(3_200);
    expect(withThinkingHeadroom(20_000)).toBe(28_192);
  });
});

describe('structured output helpers', () => {
  it('extracts the JSON from prose, a fence, or a nested object with braces in strings', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('Sure:\n```json\n{"a": [1, 2]}\n```')).toBe('{"a": [1, 2]}');
    expect(extractJson('The answer is {"a": "a } inside", "b": {"c": 2}} — done')).toBe('{"a": "a } inside", "b": {"c": 2}}');
    expect(extractJson('[{"x":1}] trailing')).toBe('[{"x":1}]');
    expect(extractJson('no json here')).toBeNull();
  });

  it('checks strict compatibility without rewriting the schema', () => {
    const strict = { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: { b: { type: 'string' } }, required: ['b'], additionalProperties: false } } }, required: ['a'], additionalProperties: false };
    expect(isStrictCompatible(strict)).toBe(true);
    expect(isStrictCompatible({ ...strict, required: [] })).toBe(false);
    expect(isStrictCompatible({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toBe(false);
    expect(isStrictCompatible({ ...strict, patternProperties: {} })).toBe(false);
  });

  it('states the schema in full in the prompted fallback', () => {
    const text = schemaInstruction({ type: 'object', properties: { speak: { type: 'boolean' } } });
    expect(text).toContain('JSON');
    expect(text).toContain('"speak"');
  });
});
