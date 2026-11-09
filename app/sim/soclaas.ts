/**
 * **An OpenAI-compatible chat client for the test tooling** (`sim/README.md`, "Free-form runs").
 *
 * Reads `SOCLAAS_BASE_URL` and `SOCLAAS_API_KEY` from the environment, which `soclaas run -- <cmd>`
 * sets; the key is never logged or written anywhere. Each call has a timeout, retries 429 and 5xx
 * with backoff, and moves on to the next model in `models` when one stays unavailable. The model
 * that actually answered, and the date, are returned with every reply so a run can record them:
 * the ids are aliases the provider can repoint.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** Tried in order; the next one is used when a model stays unavailable after its retries. */
  models: string[];
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  /** Ask for a JSON object (`response_format: json_object`). */
  json?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export interface ChatResult {
  text: string;
  /** The model the provider says answered. */
  model: string;
  /** The model id this call asked for. */
  requested: string;
  at: string;
  ms: number;
  attempts: number;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function endpoint(): { base: string; key: string } {
  const base = process.env.SOCLAAS_BASE_URL?.replace(/\/+$/, '');
  const key = process.env.SOCLAAS_API_KEY;
  if (!base || !key) throw new Error('SOCLAAS_BASE_URL / SOCLAAS_API_KEY are not set: run under `soclaas run -- <cmd>`');
  return { base, key };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Comma-separated model list from an env var, or the default. */
export function modelList(value: string | undefined, fallback: string[]): string[] {
  const list = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const { base, key } = endpoint();
  const retries = req.retries ?? 4;
  const timeoutMs = req.timeoutMs ?? 180_000;
  let lastError: unknown = null;
  let attempts = 0;
  for (const model of req.models) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      attempts += 1;
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: req.temperature,
            max_tokens: req.maxTokens ?? 2_000,
            messages: req.messages,
            ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          model?: string;
          error?: unknown;
          choices?: { message?: { content?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
        } | null;
        if (!response.ok) {
          const detail = typeof body?.error === 'string' ? body.error : JSON.stringify(body?.error ?? '').slice(0, 200);
          throw new ChatError(`${model}: HTTP ${String(response.status)} ${detail}`, response.status);
        }
        const text = body?.choices?.[0]?.message?.content ?? '';
        if (text.trim().length === 0) throw new ChatError(`${model}: empty reply`, 0);
        return {
          text,
          model: body?.model ?? model,
          requested: model,
          at: new Date(started).toISOString(),
          ms: Date.now() - started,
          attempts,
          usage: {
            promptTokens: body?.usage?.prompt_tokens ?? 0,
            completionTokens: body?.usage?.completion_tokens ?? 0,
            reasoningTokens: body?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          },
        };
      } catch (err) {
        lastError = err;
        const status = err instanceof ChatError ? err.status : null;
        // A 4xx other than 429 will not get better by asking again.
        if (status !== null && status >= 400 && status < 500 && status !== 429) break;
        // "No healthy backend" is a model that is down, not a busy one: try the next model soon.
        const down = err instanceof ChatError && /no healthy provider/i.test(err.message);
        if (down && attempt >= 1) break;
        await sleep(Math.min(30_000, 1_500 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** The first JSON object in a reply (models wrap it in prose or a code fence now and then). */
export function parseJsonObject<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`reply is not JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}
