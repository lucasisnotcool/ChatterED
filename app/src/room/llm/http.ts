/**
 * **The HTTP half of the fetch-only clients** (OpenAI, Gemini, any OpenAI-compatible endpoint).
 *
 * No SDK. This app ships with very few runtime dependencies (see the note atop
 * `src/main/log.ts`), and three provider SDKs to do what one `fetch` and a forty-line SSE reader
 * do would be three more bundles nobody has read. Node's global `fetch` streams, aborts on an
 * `AbortSignal` and is injectable, which is all a test needs: **no test in this repo makes a
 * network call** — every client here takes a `fetch` in its options.
 *
 * What lives here is what the three clients would otherwise each get slightly wrong:
 *  - one error class with a sentence a learner can act on (401 → the key, 404 → the model,
 *    429 → the rate limit), carrying the status so a test and a log line can branch on it;
 *  - Stop, which must surface as `LlmAbortedError` whichever of `fetch` or the body reader
 *    noticed it first;
 *  - the Server-Sent Events framing both providers stream in.
 *
 * Portable: imports nothing from `src/main`. It never sees a key except inside the headers the
 * caller hands to `fetch`, and it never puts one in an error message.
 */
import { LlmAbortedError } from './types.js';

/** The subset of `fetch` the clients use. `typeof fetch` is assignable to it; a fake is easy. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<Response>;

/**
 * A provider refused the call. `message` is written for the learner; `status` and
 * `providerMessage` are for the log and the tests. `providerMessage` is the provider's own
 * `error.message`, capped — it may name the model or the parameter it rejected, which is exactly
 * what the owner needs to see in a log, and it never contains the key (providers do not echo it,
 * and `src/main/log.ts` scrubs key-shaped tokens out of every string anyway).
 */
export class LlmHttpError extends Error {
  readonly status: number;
  readonly provider: string;
  readonly providerMessage: string;
  constructor(provider: string, status: number, providerMessage: string, message: string) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
    this.provider = provider;
    this.providerMessage = providerMessage;
  }
}

/** The provider's own error sentence, from either of the two JSON shapes, or the raw text. */
export function providerErrorMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    const err = (root as { error?: unknown } | null)?.error;
    if (typeof err === 'string') return err.slice(0, 400);
    if (err && typeof err === 'object') {
      const m = (err as { message?: unknown }).message;
      if (typeof m === 'string') return m.slice(0, 400);
    }
    const m = (root as { message?: unknown } | null)?.message;
    if (typeof m === 'string') return m.slice(0, 400);
  } catch {
    // Not JSON — an HTML error page from a proxy, or a bare string from a local server.
  }
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * The sentence a learner reads. Status first, because the status is what decides what they
 * should do; the provider's own words after it, because "model `gpt-5.9` does not exist" is
 * more useful than any paraphrase of it.
 */
export function httpErrorFor(provider: string, status: number, bodyText: string, model?: string): LlmHttpError {
  const said = providerErrorMessage(bodyText);
  const tail = said ? ` (${provider} said: ${said})` : '';
  let message: string;
  if (status === 401 || (status === 400 && /api[_ ]?key.*(invalid|not valid)|invalid.*api[_ ]?key|API_KEY_INVALID/i.test(said))) {
    message = `${provider} rejected the API key. Check it in Settings ▸ Where the study partners run.${tail}`;
    return new LlmHttpError(provider, status === 400 ? 401 : status, said, message);
  }
  if (status === 403) {
    message = `${provider} refused the call (403): the key is valid but not allowed to use this model or endpoint.${tail}`;
  } else if (status === 404) {
    message = `${provider} does not know the model${model ? ` "${model}"` : ''} (404). Check the model id in Settings.${tail}`;
  } else if (status === 429) {
    message = `${provider} is rate-limiting this key, or it is out of credit (429). Wait a minute, or check the account's quota.${tail}`;
  } else if (status >= 500) {
    message = `${provider} had a server error (${status}). Try again in a moment.${tail}`;
  } else {
    message = `${provider} rejected the request (${status}).${tail}`;
  }
  return new LlmHttpError(provider, status, said, message);
}

/** A network-level failure (DNS, refused connection, TLS) — the endpoint never answered. */
export class LlmNetworkError extends Error {
  constructor(provider: string, url: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`Could not reach ${provider} at ${safeOrigin(url)}: ${why}`);
    this.name = 'LlmNetworkError';
  }
}

/** Scheme and host only: a URL may carry a query string, and a query string may carry a key. */
export function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'the configured address';
  }
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'LlmAbortedError');
}

/**
 * POST a JSON body and return the response **only if it is 2xx**. Anything else becomes an
 * `LlmHttpError` (the body is read for the provider's own message); a fetch that never reached
 * the server becomes an `LlmNetworkError`; Stop becomes `LlmAbortedError`.
 */
export async function postJson(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
  model?: string,
): Promise<Response> {
  if (signal?.aborted) throw new LlmAbortedError();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (isAbort(err, signal)) throw new LlmAbortedError();
    throw new LlmNetworkError(provider, url, err);
  }
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch (err) {
      if (isAbort(err, signal)) throw new LlmAbortedError();
    }
    throw httpErrorFor(provider, res.status, text, model);
  }
  return res;
}

/**
 * **Room for the model to think inside the output cap.**
 *
 * The room's callers size `max_tokens` for the *visible* reply (400 for a REFERENCE answer, 1,600
 * for a doc-edit plan). On OpenAI's reasoning models `max_completion_tokens` also counts the
 * hidden reasoning tokens, and on Gemini `maxOutputTokens` "includes thought tokens" — so the
 * caller's number, sent as-is, lets a model spend the whole budget thinking and return nothing.
 * This adds the same again on top (at least 1,024, at most 8,192). A cap, not a target: the
 * reply's length is still governed by the prompt, and unused headroom costs nothing.
 */
export function withThinkingHeadroom(maxTokens: number): number {
  const base = Math.max(1, Math.floor(maxTokens));
  return base + Math.min(8_192, Math.max(1_024, base));
}

export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * **Server-Sent Events, framed.** Yields one `{event, data}` per blank-line-terminated block;
 * multi-line `data:` fields are joined with `\n` as the spec says; comments (`:`) are skipped.
 * Handles `\r\n` and a chunk boundary anywhere, including inside a multi-byte character.
 *
 * Stop: an abort mid-stream surfaces from the reader as an `AbortError`, which becomes
 * `LlmAbortedError` here so every client throws the same thing.
 */
export async function* readSse(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];
  let finished = false;

  const flush = (): SseEvent | null => {
    if (data.length === 0) {
      event = null;
      return null;
    }
    const out = { event, data: data.join('\n') };
    event = null;
    data = [];
    return out;
  };

  try {
    for (;;) {
      if (signal?.aborted) throw new LlmAbortedError();
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (isAbort(err, signal)) throw new LlmAbortedError();
        throw err;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r\n|\r|\n/)) >= 0) {
        // A `\r` at the very end may be the first half of a `\r\n` split across two chunks.
        if (buffer[nl] === '\r' && nl === buffer.length - 1) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === '\r' && buffer[nl + 1] === '\n' ? 2 : 1));
        if (line === '') {
          const ev = flush();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
        else if (field === 'event') event = value;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      // A stream that ended without the final blank line still delivered its last event.
      for (const line of buffer.split(/\r\n|\r|\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    const last = flush();
    finished = true;
    if (last) yield last;
  } finally {
    // Stopped, errored, or the consumer broke out early: close the connection rather than let
    // the provider keep generating into a socket nobody reads (a stopped turn must stop).
    if (!finished) reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // Already released, or the stream errored; nothing to do.
    }
  }
}
