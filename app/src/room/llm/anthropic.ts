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
import { extractJson, schemaInstruction } from './structured.js';
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
  /**
   * **Schemas the API would not compile**, by their JSON. Structured outputs turn a schema into a
   * grammar, and a big one (the tutorial reader's: parts, keys, links, figure boxes) is refused
   * with a 400 before anything is generated — found in the study pilot, 2026-10-25; the Claude
   * CLI's `--json-schema` takes the same schema without complaint, so the dogfood never saw it.
   * Such a schema is stated in the system prompt instead and the reply unwrapped
   * (`structured.ts`), as the OpenAI and Gemini clients do; every caller validates what it gets.
   * Remembered for the life of the client, so only the first call pays the refused round trip.
   */
  readonly #promptedSchemas = new Set<string>();

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
    const key = request.jsonSchema ? JSON.stringify(request.jsonSchema) : null;
    if (key === null || this.#promptedSchemas.has(key)) return this.#run(request, key !== null, onDelta, signal);
    try {
      return await this.#run(request, false, onDelta, signal);
    } catch (err) {
      if (!schemaTooLarge(err)) throw err;
      this.#promptedSchemas.add(key);
      return this.#run(request, true, onDelta, signal);
    }
  }

  /** One call. `promptedSchema`: the schema goes in the system prompt, not `output_config.format`. */
  async #run(request: LlmRequest, promptedSchema: boolean, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const startedAt = Date.now();
    let ttftMs = -1;
    let text = '';

    const shape = requestShape(request);
    const format = request.jsonSchema && !promptedSchema ? { format: { type: 'json_schema' as const, schema: request.jsonSchema } } : {};
    const system = request.system.map((block) => ({
      type: 'text' as const,
      text: block.text,
      ...(block.cache_control ? { cache_control: block.cache_control } : {}),
    }));
    // After every cache breakpoint, so the cached prefix is the same as on a constrained call.
    if (request.jsonSchema && promptedSchema) system.push({ type: 'text' as const, text: schemaInstruction(request.jsonSchema) });
    const stream = this.#client.messages.stream(
      {
      model: request.model,
      max_tokens: shape.maxTokens,
      system,
      messages: withImages(request),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.jsonSchema || shape.effort
        ? {
            output_config: {
              ...(shape.effort ? { effort: shape.effort } : {}),
              ...format,
            },
          }
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
    if ((final.stop_reason as string | null) === 'refusal') throw new Error(REFUSAL_MESSAGE);
    if (text.length === 0) {
      text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
    // Unconstrained, a model may fence or preface its JSON; the callers parse the object alone.
    if (promptedSchema) text = extractJson(text) ?? text;

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
 * The 400 the API gives a schema it will not compile into a grammar. Matched on the message
 * because no error type or code tells it apart from any other bad request; anything else is
 * thrown as it was.
 */
export function schemaTooLarge(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown } | null;
  return e?.status === 400 && typeof e.message === 'string' && /compiled grammar is too large|reduce the number of strict tools/i.test(e.message);
}

/** What the learner reads when a safety classifier declines the call (`stop_reason: "refusal"`). */
export const REFUSAL_MESSAGE = 'Claude declined to answer this one. Try asking it a different way.';

/**
 * **Models that think unless told otherwise** (the Claude 5 generation: Opus 5 and 5.5, Sonnet 5
 * and 5.5, Haiku 5.5). On them an omitted `thinking` means adaptive thinking, and thinking tokens
 * count against `max_tokens`.
 *
 * Every budget in this app (700 for a Teacher turn, 400 for a whisper) was set on calls that did
 * not think, so on these models a turn could spend its whole budget thinking and come back empty
 * or cut off. Found preparing the study build (2026-10-15), whose participants run Sonnet 5.5 on
 * the API path: the dogfood ran on the Claude CLI, which never sends `max_tokens`.
 *
 * So for these models a call keeps its visible-text budget and gets headroom for thinking on
 * top: output is billed on what is generated, not on the ceiling. A schema-bound call also runs
 * at `low` effort, which is the API's nearest match to the CLI's `MAX_THINKING_TOKENS=0` for the
 * same calls (`claude-cli.ts`, `cliEnv`): there is nothing to deliberate about in filling a form.
 * Free-text calls keep the model's default effort, as the CLI did.
 */
export function thinksByDefault(model: string): boolean {
  return /^claude-(opus|sonnet|haiku)-5(-\d+)?$/.test(model.trim().toLowerCase());
}

export const THINKING_HEADROOM = { schema: 2_000, prose: 8_000 } as const;

export function requestShape(request: Pick<LlmRequest, 'model' | 'max_tokens' | 'jsonSchema'>): {
  maxTokens: number;
  effort: 'low' | null;
} {
  if (!thinksByDefault(request.model)) return { maxTokens: request.max_tokens, effort: null };
  if (request.jsonSchema) return { maxTokens: request.max_tokens + THINKING_HEADROOM.schema, effort: 'low' };
  return { maxTokens: request.max_tokens + THINKING_HEADROOM.prose, effort: null };
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
