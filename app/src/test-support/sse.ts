/**
 * A fake `fetch` for the fetch-only LLM clients. No network: every test builds the exact bytes a
 * provider would stream, split into chunks wherever the test likes (including mid-line and
 * mid-character), and asserts on the request that was sent.
 */
import type { FetchLike } from '../room/llm/http.js';

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type Reply =
  | { status: 200; chunks: string[]; /** Hold the stream open after the chunks until aborted. */ hang?: boolean }
  | { status: number; body: string };

/** SSE framing for a list of JSON payloads, OpenAI style (`data: …\n\n`, then `[DONE]`). */
export function sse(payloads: unknown[], opts: { done?: boolean; crlf?: boolean } = {}): string {
  const nl = opts.crlf ? '\r\n' : '\n';
  const events = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}${nl}${nl}`);
  if (opts.done) events.push(`data: [DONE]${nl}${nl}`);
  return events.join('');
}

/** Splits a string into chunks of `size` characters — a boundary lands wherever it lands. */
export function chop(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function streamOf(chunks: string[], hang: boolean, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]!));
        return;
      }
      if (!hang) {
        controller.close();
        return;
      }
      return new Promise<void>((resolve) => {
        const fail = () => {
          controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          resolve();
        };
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      });
    },
  });
}

/** A fetch that answers each call with the next reply in `replies`, and records what it was sent. */
export function fakeFetch(replies: Reply[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const reply = replies[Math.min(n++, replies.length - 1)]!;
    if (reply.status !== 200 || !('chunks' in reply)) {
      return new Response((reply as { body: string }).body, { status: reply.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(streamOf(reply.chunks, reply.hang === true, init.signal), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return { fetch, calls };
}
