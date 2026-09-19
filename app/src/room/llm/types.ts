/**
 * The LLM port. Three implementations ship: `ClaudeCliClient` (the default — the local,
 * logged-in `claude` binary, in src/main/llm because it spawns a process), `AnthropicClient`
 * (per-user API key, streaming, prompt caching) and `ScriptedClient` (replays design-brief.md
 * §G — the A1 video fallback, and what every test runs against; no test in this repo makes a
 * network call).
 *
 * The Room actor must not be able to tell which one it has (issue #19).
 */

import type { CostScope } from '../../shared/cost.js';

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

/**
 * `'reference'` is the neutral REFERENCE voice (pivot-spec.md §B1, flow-build-plan.md §4.3): a
 * **new scope, not a new agent**. It answers the learner's "+ Ask here" question in the deck's
 * own register, and what it produces is not an agent turn — see `src/room/reference.ts`.
 */
export type LlmScope =
  | 'group'
  | 'whisper'
  | 'orchestrator'
  | 'ledger'
  | 'ingest'
  | 'reference'
  /** collab-doc (#48): one window of the two-pass lecture-notes ingest. Long, background, retried. */
  | 'notes'
  /** collab-doc (#48): the structured call that plans an agent's doc edit after its turn. */
  | 'docedit';

export interface LlmRequest {
  model: string;
  max_tokens: number;
  system: CacheableBlock[];
  messages: LlmMessage[];
  temperature?: number;
  /** Structured output schema for the orchestrator and the ledger calls. */
  jsonSchema?: Record<string, unknown>;
  /**
   * **Images to answer with** (#48, `collab-doc.md` §2: the refine pass runs "with the slide
   * images"). Absolute paths to files main has already written, with the source page each one
   * is of, so a `figure` block's `page` can be right.
   *
   * Optional, and **nothing in `src/room` reads it** — it is set by `src/main/notes/ingest.ts`
   * and consumed by the two live backends, which reach the pixels by different doors: the API
   * path sends base64 image blocks in the user message, and the CLI path, which has no image
   * flag and a prompt on stdin, grants `Read` for the one directory they are in. The scripted
   * backend ignores it, as it ignores the model id.
   *
   * A path, not bytes: the CLI can only be given a path, and putting a 66-page deck's worth of
   * JPEG through this object would put it in every log line and every retry.
   */
  images?: { path: string; mime: string; page: number }[];
  meta: {
    scope: LlmScope;
    roomId?: string;
    agentKey?: string;
    /** A stable id for the turn; used to de-duplicate a retried call. */
    turnId?: string;
    /** Scripted replay only: which script beat this request corresponds to. */
    scriptCue?: string;
    /**
     * **Scripted replay only: the cue to try if the first one has nothing** (issue #47).
     *
     * The ledger call on a Tester **feedback** turn is cued `feedback:N`, because a judgement of an
     * attempt belongs to the turn that judges it (`attempt-first.md` §2.3) — but
     * `script.psd-hessian.ts` keys its ledger blocks to the learner cue (`student:N`), and it must
     * keep working. So the actor passes both and the scripted client tries them in order. No live
     * backend reads either field.
     */
    scriptCueFallback?: string;
    /**
     * **Cost attribution** (`src/main/cost/`, `src/shared/cost.ts`). All three are optional and
     * nothing in `src/room` reads them — they exist so that the one decorator every call passes
     * through can file the call under the right document and the right thread without the room
     * having to know a ledger exists.
     *
     * `costScope` overrides `scope` where the port's vocabulary is too coarse to bill against:
     * the learning-objective ingest travels as `'ingest'` because it shares that lane, but it is
     * a separate per-file cost and a learner must be able to see it as one.
     */
    fileId?: string | null;
    anchorId?: string | null;
    costScope?: CostScope;
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
  /**
   * How long this call sat in the CLI backend's queue before a `claude` child was spawned
   * (issue #35 item 5c). Absent when it did not wait, and on every other backend. It is
   * **not** part of `ttftMs`, which measures the call: a turn that took 6 s of which 4 s was
   * queue is a different problem from one that took 6 s of generation, and the log must be
   * able to tell them apart.
   */
  queuedMs?: number;
}

/**
 * Thrown when `signal` fires. It is **not a failure**: the learner pressed Stop, the partial
 * text they were already looking at becomes the message, and nothing anywhere puts up a card.
 */
export class LlmAbortedError extends Error {
  constructor() {
    super('The call was stopped.');
    this.name = 'LlmAbortedError';
  }
}

export interface LLMClient {
  readonly kind: LlmBackend;
  /**
   * Generates a reply. `onDelta` receives tokens as they arrive; the *caller* owns the
   * latency floor and the release pacing, because the hold is a product decision, not a
   * transport one (design-brief.md §D4).
   *
   * `signal` is **Stop**. Aborting must end the underlying work for real — the CLI path kills
   * its child process — because a "stopped" turn whose model keeps generating is a bill and a
   * race, not a stop. Whatever `onDelta` has already delivered is the caller's to keep.
   */
  complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult>;
}

export const EMPTY_USAGE: LlmUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
