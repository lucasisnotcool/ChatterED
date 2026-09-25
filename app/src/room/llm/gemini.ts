/**
 * **Google Gemini, on the learner's own AI Studio key** (BYOK, 2026-09-25).
 *
 * `POST {base}/models/{model}:streamGenerateContent?alt=sse` with the key in `x-goog-api-key` —
 * a header, never the `?key=` query form, so the key cannot end up in a URL that a log line or an
 * error message might carry. Checked against ai.google.dev/api/generate-content on 2026-09-25.
 * Google's docs now lead with a newer "Interactions API"; `generateContent` is still served and
 * documented, and it is the one this client speaks because its request shape maps one-to-one onto
 * the port.
 *
 * The mapping:
 *  - `system` blocks → `systemInstruction.parts[].text` (joined, order kept);
 *  - `assistant` → role `model`; consecutive turns of the same role are merged, because the API
 *    wants them alternating;
 *  - `images` → `inlineData` parts ahead of the last user turn's text, under the shared ceiling
 *    (`images.ts`; Gemini's inline limit is 20 MB for the whole request);
 *  - `jsonSchema` → `responseMimeType: application/json` + `responseJsonSchema` (full JSON Schema,
 *    the current field). If the model refuses the schema, the retry keeps JSON mode and moves the
 *    schema into the system instruction;
 *  - `max_tokens` → `maxOutputTokens` **plus thinking headroom**: Gemini counts thought tokens
 *    against that cap (see `withThinkingHeadroom`). Gemini 3.x thinks by default at `medium`;
 *    this client asks for `LOW`, the lowest level every current Flash accepts, because a room
 *    turn is waited for. A model that rejects the field is asked again without it.
 *
 * Streaming: parts marked `thought: true` are not the reply and are never delivered to
 * `onDelta`. `usageMetadata` is cumulative across chunks, so the last one wins; it is normalised
 * to the ledger's shape — cached prompt tokens out of `input_tokens` and into
 * `cache_read_input_tokens`, thought tokens into `output_tokens` because they are billed as output.
 *
 * Portable: fetch-only, no SDK, no import from `src/main`.
 */
import { lastUserIndex, loadImages, type ReadFileLike } from './images.js';
import { httpErrorFor, LlmHttpError, postJson, readSse, withThinkingHeadroom, type FetchLike } from './http.js';
import { extractJson, parsesAsJson, schemaInstruction } from './structured.js';
import type { LLMClient, LlmRequest, LlmResult, LlmUsage } from './types.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiClientOptions {
  apiKey: string;
  baseUrl?: string | null;
  fetch?: FetchLike;
  readFile?: ReadFileLike;
}

interface Learned {
  noThinkingConfig?: boolean;
  noTemperature?: boolean;
  /** The schema went into the prompt; JSON mode stays on. */
  promptedSchema?: boolean;
}

const MAX_ADAPTATIONS = 3;

/** Gemini 3 and later take `thinkingLevel`; 2.x used a token budget and is left at its default. */
export function takesThinkingLevel(model: string): boolean {
  const m = /gemini-(\d+)/i.exec(model);
  return m !== null && Number(m[1]) >= 3;
}

export class GeminiClient implements LLMClient {
  readonly kind = 'gemini' as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #readFile: ReadFileLike | undefined;
  readonly #learned = new Map<string, Learned>();

  constructor(opts: GeminiClientOptions) {
    this.#apiKey = opts.apiKey.trim();
    this.#baseUrl = (opts.baseUrl?.trim() || GEMINI_BASE_URL).replace(/\/+$/, '');
    this.#fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.#readFile = opts.readFile;
  }

  async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const startedAt = Date.now();
    const model = request.model.replace(/^models\//, '');
    const url = `${this.#baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const learned: Learned = { ...(this.#learned.get(model) ?? {}) };

    let res: Response | null = null;
    for (let attempt = 0; ; attempt += 1) {
      const body = this.body(request, learned);
      try {
        res = await postJson(this.#fetch, 'Gemini', url, { 'x-goog-api-key': this.#apiKey }, body, signal, model);
        break;
      } catch (err) {
        if (!(err instanceof LlmHttpError) || attempt >= MAX_ADAPTATIONS || !adapt(err, learned, body)) throw err;
      }
    }
    this.#learned.set(model, learned);

    let ttftMs = -1;
    let text = '';
    let answeredBy = model;
    let usage: Record<string, unknown> | null = null;
    let finish: string | null = null;
    let blocked: string | null = null;

    for await (const ev of readSse(res.body, signal)) {
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (chunk.error) throw httpErrorFor('Gemini', 502, JSON.stringify({ error: chunk.error }), model);
      if (typeof chunk.modelVersion === 'string' && chunk.modelVersion) answeredBy = chunk.modelVersion;
      if (chunk.usageMetadata && typeof chunk.usageMetadata === 'object') usage = chunk.usageMetadata as Record<string, unknown>;
      const feedback = chunk.promptFeedback as { blockReason?: unknown } | undefined;
      if (typeof feedback?.blockReason === 'string') blocked = feedback.blockReason;

      const candidate = Array.isArray(chunk.candidates) ? (chunk.candidates[0] as Record<string, unknown> | undefined) : undefined;
      if (!candidate) continue;
      if (typeof candidate.finishReason === 'string') finish = candidate.finishReason;
      const parts = ((candidate.content as { parts?: unknown } | undefined)?.parts ?? []) as { text?: unknown; thought?: unknown }[];
      for (const part of parts) {
        if (part.thought === true || typeof part.text !== 'string' || part.text.length === 0) continue;
        if (ttftMs < 0) ttftMs = Date.now() - startedAt;
        text += part.text;
        onDelta?.(part.text);
      }
    }

    if (text.length === 0) {
      if (blocked) throw new Error(`Gemini blocked the prompt (${blocked}).`);
      if (finish === 'MAX_TOKENS') {
        throw new Error(`Gemini used the whole output budget thinking before writing a reply (model ${answeredBy}).`);
      }
      if (finish && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
        throw new Error(`Gemini ended the reply without text (${finish}, model ${answeredBy}).`);
      }
    }

    if (request.jsonSchema && !parsesAsJson(text)) text = extractJson(text) ?? text;

    return {
      text,
      model: answeredBy,
      usage: normaliseGeminiUsage(usage),
      ttftMs: ttftMs < 0 ? Date.now() - startedAt : ttftMs,
      backend: 'gemini',
    };
  }

  /** The request body — the whole of the dialect, so tests assert it directly. */
  body(request: LlmRequest, learned: Learned = this.#learned.get(request.model.replace(/^models\//, '')) ?? {}): Record<string, unknown> {
    let system = request.system.map((b) => b.text).join('\n\n');
    if (request.jsonSchema && learned.promptedSchema) {
      system = [system, schemaInstruction(request.jsonSchema)].filter((s) => s.length > 0).join('\n\n');
    }

    const images = loadImages(request, this.#readFile ? { readFile: this.#readFile } : {});
    const lastUser = lastUserIndex(request);
    const contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [];
    request.messages.forEach((m, i) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts: Record<string, unknown>[] = [];
      if (i === lastUser) for (const img of images) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
      parts.push({ text: m.content });
      const prev = contents.at(-1);
      if (prev && prev.role === role) prev.parts.push(...parts);
      else contents.push({ role, parts });
    });

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: withThinkingHeadroom(request.max_tokens),
    };
    if (request.temperature !== undefined && !learned.noTemperature) generationConfig.temperature = request.temperature;
    if (request.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      if (!learned.promptedSchema) generationConfig.responseJsonSchema = request.jsonSchema;
    }
    if (takesThinkingLevel(request.model) && !learned.noThinkingConfig) {
      generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    }

    const body: Record<string, unknown> = { contents, generationConfig };
    if (system.length > 0) body.systemInstruction = { parts: [{ text: system }] };
    return body;
  }
}

function adapt(err: LlmHttpError, learned: Learned, body: Record<string, unknown>): boolean {
  if (err.status !== 400) return false;
  const said = err.providerMessage.toLowerCase();
  const config = body.generationConfig as Record<string, unknown>;
  if ('responseJsonSchema' in config && /schema/.test(said)) return (learned.promptedSchema = true);
  if ('thinkingConfig' in config && /thinking/.test(said)) return (learned.noThinkingConfig = true);
  if ('temperature' in config && said.includes('temperature')) return (learned.noTemperature = true);
  return false;
}

/** `usageMetadata`, in the ledger's shape. See the header for the split. */
export function normaliseGeminiUsage(usage: Record<string, unknown> | null | undefined): LlmUsage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  if (!usage) return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const prompt = num(usage.promptTokenCount);
  const cached = Math.min(prompt, num(usage.cachedContentTokenCount));
  return {
    input_tokens: prompt - cached,
    output_tokens: num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}
