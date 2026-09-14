/**
 * The LLM port. Three implementations ship: `ClaudeCliClient` (the default — the local,
 * logged-in `claude` binary, in src/main/llm because it spawns a process), `AnthropicClient`
 * (per-user API key, streaming, prompt caching) and `ScriptedClient` (replays design-brief.md
 * §G — the A1 video fallback, and what every test runs against; no test in this repo makes a
 * network call).
 *
 * The Room actor must not be able to tell which one it has (issue #19).
 */

export interface CacheableBlock {
  type: 'text';
  text: string;
  /** A cache breakpoint. Everything before it is the cached prefix. */
  cache_control?: { type: 'ephemeral' };
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type LlmScope = 'group' | 'whisper' | 'orchestrator' | 'ledger' | 'ingest';

export interface LlmRequest {
  model: string;
  max_tokens: number;
  system: CacheableBlock[];
  messages: LlmMessage[];
  temperature?: number;
  /** Structured output schema for the orchestrator and the ledger calls. */
  jsonSchema?: Record<string, unknown>;
  meta: {
    scope: LlmScope;
    roomId?: string;
    agentKey?: string;
    /** A stable id for the turn; used to de-duplicate a retried call. */
    turnId?: string;
    /** Scripted replay only: which script beat this request corresponds to. */
    scriptCue?: string;
  };
}

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type LlmBackend = 'anthropic' | 'scripted' | 'claude-cli';

export interface LlmResult {
  text: string;
  model: string;
  usage: LlmUsage;
  /** Real time to first token. Stored next to `latency_target_ms` so the manipulation is checkable. */
  ttftMs: number;
  /** Which backend answered. Persisted on the message row next to `model` (issue #19). */
  backend?: LlmBackend;
  /** The local CLI reports a dollar figure per call; the API path does not. */
  costUsd?: number;
}

export interface LLMClient {
  readonly kind: LlmBackend;
  /**
   * Generates a reply. `onDelta` receives tokens as they arrive; the *caller* owns the
   * latency floor and the release pacing, because the hold is a product decision, not a
   * transport one (design-brief.md §D4).
   */
  complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult>;
}

export const EMPTY_USAGE: LlmUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
