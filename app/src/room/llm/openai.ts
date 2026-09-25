/**
 * **OpenAI, and anything that speaks its Chat Completions dialect** (BYOK, 2026-09-25).
 *
 * One client, two flavours:
 *
 *  - `'openai'` — api.openai.com on the learner's own key. The request is written for the current
 *    reasoning models (GPT-6, GPT-5.x, o-series; checked against developers.openai.com on
 *    2026-09-25): the system blocks go in a `developer` message, the cap is
 *    `max_completion_tokens` with headroom for hidden reasoning (`withThinkingHeadroom`),
 *    `temperature` is not sent because those models reject it whenever reasoning is on, and
 *    `reasoning_effort` is `low` — the one value every reasoning model in the family accepts, and
 *    the right one for a room where a reply is waited for.
 *  - `'compatible'` — a base URL the learner typed: OpenRouter, Ollama, LM Studio, Groq,
 *    DeepSeek, Together, a vLLM box. The request is the conservative common denominator (`system`
 *    role, `max_tokens`, `temperature` when the caller set one) because that is what every one of
 *    those servers accepts.
 *
 * **Structured output degrades rather than fails.** `jsonSchema` goes out as
 * `response_format: json_schema` (with `strict: true` only when the schema already meets
 * OpenAI's strict rules — see `isStrictCompatible`). An endpoint that refuses that with a 400 is
 * asked again with `json_object` plus the schema in the prompt, and one that refuses *that* is
 * asked with the schema in the prompt alone. Other 400s that name a parameter this client sent
 * (`temperature`, `reasoning_effort`, `stream_options`, the `developer` role, one of the two
 * token caps) get the same treatment: drop or swap that one parameter, try again. What was
 * learned is remembered per model for the life of the client, so the second call does not pay
 * for the first one's discovery. The reply is then unwrapped by `extractJson` if the model put
 * prose around it — the callers already treat an unparseable answer as "stay quiet".
 *
 * Streaming is real: `onDelta` fires per SSE chunk, and `ttftMs` is the first visible token.
 * Usage comes from the terminal chunk (`stream_options.include_usage`) and is normalised to the
 * Anthropic shape the ledger stores: `input_tokens` **excludes** cached tokens, which go to
 * `cache_read_input_tokens` (`src/main/cost/ledger.ts` prices the two separately).
 *
 * Portable: fetch-only, no SDK, no import from `src/main`. The key is sent only as a bearer header
 * to the configured host, and appears in no error message.
 */
import { lastUserIndex, loadImages, type ReadFileLike } from './images.js';
import { postJson, readSse, httpErrorFor, LlmHttpError, withThinkingHeadroom, type FetchLike } from './http.js';
import { extractJson, isStrictCompatible, parsesAsJson, schemaInstruction } from './structured.js';
import type { LLMClient, LlmRequest, LlmResult, LlmUsage } from './types.js';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type OpenAIFlavour = 'openai' | 'compatible';

export interface OpenAIClientOptions {
  flavour: OpenAIFlavour;
  /** Optional on a compatible endpoint (a local Ollama takes none). */
  apiKey?: string | null;
  /** Defaults to api.openai.com for the `openai` flavour; required for `compatible`. */
  baseUrl?: string | null;
  /** Injectable; nothing in this repo's tests talks to the network. */
  fetch?: FetchLike;
  readFile?: ReadFileLike;
}

type JsonMode = 'json_schema' | 'json_object' | 'prompted';

/** What a 400 has taught this client about one model on one endpoint. */
interface Learned {
  jsonMode?: JsonMode;
  noTemperature?: boolean;
  noReasoningEffort?: boolean;
  noStreamOptions?: boolean;
  systemRole?: boolean;
  capField?: 'max_tokens' | 'max_completion_tokens';
}

const MAX_ADAPTATIONS = 5;

/**
 * Whether an OpenAI model id is a reasoning model (no `temperature`, takes `reasoning_effort`).
 * GPT-6, GPT-5.x and the o-series are; `gpt-4.1`, `gpt-4o` and the `*-chat-latest` aliases are
 * not. A wrong guess is not fatal — the 400 names the parameter and the retry drops it.
 */
export function isOpenAiReasoningModel(model: string): boolean {
  const id = model.toLowerCase().replace(/^openai\//, '');
  if (/chat-latest|^chat-/.test(id)) return false;
  return /^(o\d|gpt-5|gpt-6|gpt-[7-9])/.test(id);
}

/** Trims, drops trailing slashes and a pasted `/chat/completions`. */
export function normaliseBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

export class OpenAIClient implements LLMClient {
  readonly kind: 'openai' | 'openai-compatible';
  readonly #flavour: OpenAIFlavour;
  readonly #apiKey: string | null;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #readFile: ReadFileLike | undefined;
  readonly #label: string;
  readonly #learned = new Map<string, Learned>();

  constructor(opts: OpenAIClientOptions) {
    this.#flavour = opts.flavour;
    this.kind = opts.flavour === 'openai' ? 'openai' : 'openai-compatible';
    this.#apiKey = opts.apiKey?.trim() || null;
    const base = opts.baseUrl?.trim() || (opts.flavour === 'openai' ? OPENAI_BASE_URL : '');
    if (!base) throw new Error('An OpenAI-compatible endpoint needs a base URL.');
    this.#baseUrl = normaliseBaseUrl(base);
    this.#fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.#readFile = opts.readFile;
    this.#label = opts.flavour === 'openai' ? 'OpenAI' : 'The OpenAI-compatible endpoint';
  }

  async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const startedAt = Date.now();
    const learned: Learned = { ...(this.#learned.get(request.model) ?? {}) };

    let res: Response | null = null;
    for (let attempt = 0; ; attempt += 1) {
      const body = this.body(request, learned);
      try {
        res = await postJson(this.#fetch, this.#label, `${this.#baseUrl}/chat/completions`, this.#headers(), body, signal, request.model);
        break;
      } catch (err) {
        if (!(err instanceof LlmHttpError) || attempt >= MAX_ADAPTATIONS || !adapt(err, learned, request, body)) throw err;
      }
    }
    this.#learned.set(request.model, learned);

    let ttftMs = -1;
    let text = '';
    let model = request.model;
    let usage: Record<string, unknown> | null = null;
    let finish: string | null = null;

    for await (const ev of readSse(res.body, signal)) {
      if (ev.data === '[DONE]') break;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        continue; // A keep-alive or a line some proxy injected; not ours to fail on.
      }
      // Several compatible servers report a mid-stream failure as an `error` object on a 200.
      if (chunk.error) throw httpErrorFor(this.#label, 502, JSON.stringify({ error: chunk.error }), request.model);
      if (typeof chunk.model === 'string' && chunk.model) model = chunk.model;
      if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage as Record<string, unknown>;
      const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as Record<string, unknown> | undefined) : undefined;
      if (!choice) continue;
      if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
      const delta = choice.delta as { content?: unknown } | undefined;
      const piece = typeof delta?.content === 'string' ? delta.content : '';
      if (piece.length === 0) continue;
      if (ttftMs < 0) ttftMs = Date.now() - startedAt;
      text += piece;
      onDelta?.(piece);
    }

    if (text.length === 0 && (finish === 'length' || finish === 'content_filter')) {
      throw new Error(
        finish === 'length'
          ? `${this.#label} used the whole output budget before writing a reply (model ${model}). Try a model with less reasoning, or a larger one.`
          : `${this.#label} withheld the reply (content filter, model ${model}).`,
      );
    }

    if (request.jsonSchema && !parsesAsJson(text)) text = extractJson(text) ?? text;

    return {
      text,
      model,
      usage: normaliseOpenAiUsage(usage),
      ttftMs: ttftMs < 0 ? Date.now() - startedAt : ttftMs,
      backend: this.kind,
    };
  }

  #headers(): Record<string, string> {
    return this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {};
  }

  /** The request body. Exported through the instance for tests: it is the whole of the dialect. */
  body(request: LlmRequest, learned: Learned = this.#learned.get(request.model) ?? {}): Record<string, unknown> {
    const openai = this.#flavour === 'openai';
    const reasoning = openai && isOpenAiReasoningModel(request.model);
    const jsonMode: JsonMode | null = request.jsonSchema ? (learned.jsonMode ?? 'json_schema') : null;

    let system = request.system.map((b) => b.text).join('\n\n');
    if (request.jsonSchema && jsonMode !== 'json_schema') {
      system = [system, schemaInstruction(request.jsonSchema)].filter((s) => s.length > 0).join('\n\n');
    }
    const systemRole = openai && !learned.systemRole ? 'developer' : 'system';

    const images = loadImages(request, this.#readFile ? { readFile: this.#readFile } : {});
    const lastUser = lastUserIndex(request);
    const messages: Record<string, unknown>[] = [];
    if (system.length > 0) messages.push({ role: systemRole, content: system });
    request.messages.forEach((m, i) => {
      if (i === lastUser && images.length > 0) {
        messages.push({
          role: m.role,
          content: [
            ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })),
            { type: 'text', text: m.content },
          ],
        });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    });

    const capField = learned.capField ?? (openai ? 'max_completion_tokens' : 'max_tokens');
    const cap = reasoning ? withThinkingHeadroom(request.max_tokens) : request.max_tokens;

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
      [capField]: cap,
    };
    if (!learned.noStreamOptions) body.stream_options = { include_usage: true };
    if (reasoning && !learned.noReasoningEffort) body.reasoning_effort = 'low';
    if (request.temperature !== undefined && !reasoning && !learned.noTemperature) body.temperature = request.temperature;
    if (request.jsonSchema && jsonMode === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: request.jsonSchema, strict: isStrictCompatible(request.jsonSchema) },
      };
    } else if (request.jsonSchema && jsonMode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }
}

/**
 * Reads a 400 (or 422 — some local servers use it) and changes **one** thing the error names.
 * Returns false when there is nothing left to try, and the error goes to the caller as it came.
 */
function adapt(err: LlmHttpError, learned: Learned, request: LlmRequest, body: Record<string, unknown>): boolean {
  if (err.status !== 400 && err.status !== 422) return false;
  const said = err.providerMessage.toLowerCase();

  if ('response_format' in body && /response_format|json_schema|json_object|structured|schema/.test(said)) {
    learned.jsonMode = learned.jsonMode === 'json_object' || (body.response_format as { type?: string }).type === 'json_object' ? 'prompted' : 'json_object';
    return true;
  }
  if ('temperature' in body && said.includes('temperature')) return (learned.noTemperature = true);
  if ('reasoning_effort' in body && /reasoning_effort|reasoning effort/.test(said)) return (learned.noReasoningEffort = true);
  if ('stream_options' in body && said.includes('stream_options')) return (learned.noStreamOptions = true);
  if (!learned.systemRole && (body.messages as { role: string }[])[0]?.role === 'developer' && /developer/.test(said)) {
    return (learned.systemRole = true);
  }
  if ('max_tokens' in body && said.includes('max_tokens') && said.includes('max_completion_tokens')) {
    learned.capField = 'max_completion_tokens';
    return true;
  }
  if ('max_completion_tokens' in body && said.includes('max_completion_tokens')) {
    learned.capField = 'max_tokens';
    return true;
  }
  // A structured call to a server that answered 400 without saying why: the schema is the most
  // likely thing it did not understand, and the prompted mode needs nothing from it.
  if (request.jsonSchema && 'response_format' in body && said.length === 0) {
    learned.jsonMode = 'prompted';
    return true;
  }
  return false;
}

/**
 * OpenAI's usage, in the ledger's shape. `prompt_tokens` **includes** the cached prefix, so the
 * cached count is taken out of `input_tokens` and reported as a cache read — the same split the
 * Anthropic usage object makes, and the one `estimateUsd` prices. Reasoning tokens are already
 * inside `completion_tokens` and are billed as output, so nothing is added. DeepSeek reports its
 * cache as `prompt_cache_hit_tokens`; that is read too.
 */
export function normaliseOpenAiUsage(usage: Record<string, unknown> | null | undefined): LlmUsage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  if (!usage) return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const prompt = num(usage.prompt_tokens ?? usage.input_tokens);
  const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as Record<string, unknown> | undefined;
  const cached = Math.min(prompt, num(details?.cached_tokens) || num(usage.prompt_cache_hit_tokens));
  return {
    input_tokens: prompt - cached,
    output_tokens: num(usage.completion_tokens ?? usage.output_tokens),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}
