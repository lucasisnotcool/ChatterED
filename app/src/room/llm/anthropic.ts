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
import type { LLMClient, LlmRequest, LlmResult, LlmUsage } from './types.js';

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

  async complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult> {
    const startedAt = Date.now();
    let ttftMs = -1;
    let text = '';

    const stream = this.#client.messages.stream({
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system.map((block) => ({
        type: 'text' as const,
        text: block.text,
        ...(block.cache_control ? { cache_control: block.cache_control } : {}),
      })),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.jsonSchema
        ? { output_config: { format: { type: 'json_schema' as const, schema: request.jsonSchema } } }
        : {}),
    });

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
