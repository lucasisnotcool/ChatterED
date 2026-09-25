/**
 * The real client. Streaming, prompt caching, and `usage` persisted on every message row.
 *
 * Model ids are exact and carry no date suffix: `claude-haiku-4-5` for agent turns,
 * `claude-sonnet-5` for the orchestrator, the ledger and ingestion (CLAUDE.md policy, and
 * architecture-mac.md §G.1). Cache breakpoints are set by the context builders, which put the
 * byte-stable shared block first and the volatile turn directive after every breakpoint.
 *
 * Two things this client deliberately does NOT do:
 *  - it does not hold the reply. The latency floor is a *product* decision and lives in the
 *    room actor (design-brief.md §D4: a floor on visible TTFT, not an added delay);
 *  - it does not retry a turn on its own beyond the SDK's transport retries, because a
 *    duplicated agent message is a worse corruption of the transcript than a missing one
 *    (architecture-mac.md §B.4).
 */
import Anthropic from '@anthropic-ai/sdk';
import { lastUserIndex, loadImages } from './images.js';
import type { LLMClient, LlmMessage, LlmRequest, LlmResult, LlmUsage } from './types.js';

export interface AnthropicClientOptions {
  apiKey: string;
  /** Overridable for tests; nothing in this repo's tests talks to the network. */
  client?: Anthropic;
  maxRetries?: number;
}

export class AnthropicClient implements LLMClient {
  readonly kind = 'anthropic' as const;
  readonly #client: Anthropic;

  constructor(opts: AnthropicClientOptions) {
    this.#client =
      opts.client ??
      new Anthropic({
        apiKey: opts.apiKey,
        maxRetries: opts.maxRetries ?? 2,
        // The key never leaves this process except to api.anthropic.com (issue #15).
      });
  }

  async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const startedAt = Date.now();
    let ttftMs = -1;
    let text = '';

    const stream = this.#client.messages.stream(
      {
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system.map((block) => ({
        type: 'text' as const,
        text: block.text,
        ...(block.cache_control ? { cache_control: block.cache_control } : {}),
      })),
      messages: withImages(request),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.jsonSchema
        ? { output_config: { format: { type: 'json_schema' as const, schema: request.jsonSchema } } }
        : {}),
      },
      // Stop. The SDK aborts the HTTP request, the iterator throws, and the actor keeps the
      // deltas it already handed out.
      signal ? { signal } : undefined,
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (ttftMs < 0) ttftMs = Date.now() - startedAt;
        text += event.delta.text;
        onDelta?.(event.delta.text);
      }
    }

    const final = await stream.finalMessage();
    if (text.length === 0) {
      text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }

    return {
      text,
      model: final.model,
      usage: normaliseUsage(final.usage),
      ttftMs: ttftMs < 0 ? Date.now() - startedAt : ttftMs,
      backend: 'anthropic',
    };
  }
}

/**
 * The media-type allow-list and the per-request byte ceiling are shared with the fetch-only
 * clients (`images.ts`), because the rule is the same on every provider: drop what cannot be sent,
 * stop before a body the API refuses. Re-exported so existing imports keep working.
 */
export { IMAGE_BYTES_PER_REQUEST } from './images.js';

/**
 * The messages, with `request.images` attached to the **last user message** as base64 image
 * blocks (#48, `collab-doc.md` §2: the refine pass runs "with the slide images").
 *
 * The last user message is where the window's slide text is, and the images are the pictures of
 * those same slides, so they belong in the same turn. They go **before** the text, which is the
 * documented ordering and the one the model reads as "here is what you are about to be told
 * about". Nothing changes for a request with no images: `content` stays the plain string it has
 * always been, so every existing call produces a byte-identical body.
 */
export function withImages(request: LlmRequest): Anthropic.MessageParam[] {
  const plain = (m: LlmMessage): Anthropic.MessageParam => ({ role: m.role, content: m.content });
  if ((request.images ?? []).length === 0) return request.messages.map(plain);

  const lastUser = lastUserIndex(request);
  if (lastUser < 0) return request.messages.map(plain);

  const blocks: Anthropic.ContentBlockParam[] = loadImages(request).map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mime as 'image/jpeg' | 'image/png', data: image.data },
  }));

  return request.messages.map((m, i) => {
    if (i !== lastUser || blocks.length === 0) return plain(m);
    return { role: m.role, content: [...blocks, { type: 'text' as const, text: m.content }] };
  });
}

/**
 * `cache_read_input_tokens` on every message row is the only way to know the cache is working.
 * A sustained zero on the agent turns means a silent invalidator and a 3x bill
 * (architecture-mac.md §G.5 lever 5).
 */
export function normaliseUsage(usage: Anthropic.Usage | undefined): LlmUsage {
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
  };
}
