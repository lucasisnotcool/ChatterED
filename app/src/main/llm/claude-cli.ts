/**
 * The local Claude Code CLI as an LLM backend (issue #19).
 *
 * Why this exists: the API-key path (#15) asks every user to bring a key and pay per token.
 * Most of the people who will actually run this already have Claude Code installed and logged
 * in, and the subscription they are already paying for will answer these calls. So the default
 * backend shells out to `claude -p` and the room never knows the difference — this class
 * implements the same `LLMClient` interface as `AnthropicClient`, returns the same
 * `{ text, model, usage, ttftMs }`, and streams deltas through the same `onDelta`.
 *
 * Why it is in `src/main` and not `src/room/llm` next to the other two: `src/room` is the
 * portable half (README, architecture-mac.md §B.1) and this client spawns a process. A client
 * that shells out is a platform adapter, so it lives on the platform side. The *port* it
 * implements is still `src/room/llm/types.ts`, which is the part that has to stay portable.
 *
 * The exact command line:
 *
 *   claude -p --model <model> --tools "" --output-format stream-json
 *          --include-partial-messages --verbose --no-session-persistence
 *          --strict-mcp-config --setting-sources "" --disable-slash-commands
 *          [--json-schema <schema>] --system-prompt <text>
 *
 * with the flattened transcript on stdin. Four notes on that, all verified against
 * Claude Code 2.1.259 on 14 Sep 2026:
 *
 *  - **`--verbose` is not optional.** `-p` with `--output-format stream-json` exits 1 with
 *    "requires --verbose" without it.
 *  - **`--bare` must not be passed.** It makes auth strictly `ANTHROPIC_API_KEY`/apiKeyHelper
 *    and never reads the OAuth login, so the subscription this whole backend exists to use
 *    comes back "Not logged in".
 *  - **`--strict-mcp-config --setting-sources "" --disable-slash-commands`** keep the user's
 *    own Claude Code configuration out of the room. Without them the call loads their MCP
 *    servers and hands the model those tools (measured: 6,319 extra cached prompt tokens and
 *    an unrelated Google Drive server connected), which is both slower and a privacy surprise.
 *  - the prompt goes on **stdin**, never in argv: a group transcript plus a lecture slide is
 *    well past the argv limit.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { LLMClient, LlmMessage, LlmRequest, LlmResult, LlmUsage } from '../../room/llm/types.js';
import { EMPTY_USAGE } from '../../room/llm/types.js';

/**
 * An Electron app launched from Finder inherits launchd's PATH, not the login shell's — so
 * `claude`, which lives in `~/.local/bin`, is simply not on it. Build the PATH explicitly,
 * exactly as /Applications/scribe/com.scribeapp.daemon.plist does for the same reason.
 */
export function buildPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? '';
  const explicit = ['/opt/homebrew/bin', '/usr/local/bin', home ? join(home, '.local/bin') : '', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const existing = (env.PATH ?? '').split(delimiter);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...explicit, ...existing]) {
    if (dir.length === 0 || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(delimiter);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ResolveOptions {
  /** The Settings override. Tried first, and a bad one is reported rather than skipped. */
  override?: string | null;
  env?: NodeJS.ProcessEnv;
}

/**
 * `~/.local/bin/claude` first (the native install location, and where it is on this Mac), then
 * whatever is on the built PATH, then the two Homebrew prefixes. Returns null when there is
 * none — the caller falls back to the API key or the scripted client, it never throws at boot.
 */
export function resolveClaudeBinary(opts: ResolveOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const override = (opts.override ?? '').trim();
  if (override.length > 0) return isExecutable(override) ? override : null;

  const home = env.HOME ?? '';
  const candidates: string[] = [];
  if (home) candidates.push(join(home, '.local/bin/claude'));
  for (const dir of buildPath(env).split(delimiter)) {
    if (dir.length > 0) candidates.push(join(dir, 'claude'));
  }
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export class ClaudeCliNotFoundError extends Error {
  constructor() {
    super('The Claude CLI was not found. Install Claude Code, or point Settings at the binary.');
    this.name = 'ClaudeCliNotFoundError';
  }
}

export class ClaudeCliNotLoggedInError extends Error {
  constructor() {
    super('Claude Code is installed but not logged in. Run `claude` once in Terminal and sign in.');
    this.name = 'ClaudeCliNotLoggedInError';
  }
}

/** The CLI says this in a few different shapes; one predicate so every call site agrees. */
export function looksNotLoggedIn(text: string): boolean {
  return /not logged in|please run .?claude.? to log in|invalid api key|authentication_error|oauth token has expired/i.test(text);
}

export interface ClaudeCliClientOptions {
  /** Absolute path to the binary. Resolve it once at construction, not per call. */
  binary: string;
  /** Hard ceiling on one call. A stuck CLI must not strand a turn (architecture-mac.md §B.4). */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Working directory for the child. Defaults to a temp dir so the CLI's CLAUDE.md
   * auto-discovery finds nothing — the room's prompt is the whole prompt.
   */
  cwd?: string;
  /** Injectable for tests. */
  now?: () => number;
}

interface CliRun {
  text: string;
  /** `result.result` — under `--json-schema` this is the structured JSON, as a string. */
  resultText: string | null;
  model: string | null;
  usage: LlmUsage;
  costUsd: number | null;
  ttftMs: number;
  isError: boolean;
  subtype: string | null;
}

export class ClaudeCliClient implements LLMClient {
  readonly kind = 'claude-cli' as const;
  readonly binary: string;
  readonly #timeoutMs: number;
  readonly #env: NodeJS.ProcessEnv;
  readonly #cwd: string;
  readonly #now: () => number;

  constructor(opts: ClaudeCliClientOptions) {
    this.binary = opts.binary;
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
    this.#env = opts.env ?? process.env;
    this.#cwd = opts.cwd ?? tmpdir();
    this.#now = opts.now ?? Date.now;
  }

  async complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult> {
    const run = await this.#run(request, systemTextFor(request), promptFor(request), onDelta);

    let text = pickText(run);

    // Structured output: `--json-schema` is enforced by the CLI, but a model that wraps the
    // object in prose (or a CLI that declines the schema) must not take the room down. One
    // repair retry, then let the caller's own parse failure handle it — the orchestrator and
    // the ledger both already treat an unparseable answer as "stay quiet".
    if (request.jsonSchema && !parsesAsJson(text)) {
      const repaired = await this.#run(
        request,
        systemTextFor(request),
        `${promptFor(request)}\n\n[Your previous answer was not valid JSON. Reply with the JSON object only — no prose, no code fence.]\n\nPrevious answer:\n${text}`,
      );
      const repairedText = pickText(repaired);
      if (parsesAsJson(repairedText)) return this.#result(repairedText, repaired, request);
      // Last resort: hand back the first JSON object we can find, which is what the
      // orchestrator's own `extractJson` would have done anyway.
      text = extractJson(text) ?? text;
    }

    return this.#result(text, run, request);
  }

  #result(text: string, run: CliRun, request: LlmRequest): LlmResult {
    return {
      text,
      model: run.model ?? request.model,
      usage: run.usage,
      ttftMs: run.ttftMs,
      backend: 'claude-cli',
      ...(run.costUsd === null ? {} : { costUsd: run.costUsd }),
    };
  }

  /** The argv for one call. Exported shape so the test can assert it without spawning. */
  argsFor(request: LlmRequest, systemText: string): string[] {
    return [
      '-p',
      '--model',
      request.model,
      '--tools',
      '',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      // Required: `-p` + stream-json exits 1 without it.
      '--verbose',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--disable-slash-commands',
      ...(request.jsonSchema ? ['--json-schema', JSON.stringify(request.jsonSchema)] : []),
      '--system-prompt',
      systemText,
    ];
  }

  #run(request: LlmRequest, systemText: string, prompt: string, onDelta?: (text: string) => void): Promise<CliRun> {
    const args = this.argsFor(request, systemText);
    const startedAt = this.#now();

    return new Promise<CliRun>((resolve, reject) => {
      let child;
      try {
        child = spawn(this.binary, args, {
          cwd: this.#cwd,
          env: { ...this.#env, PATH: buildPath(this.#env) },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(new ClaudeCliNotFoundError());
        void err;
        return;
      }

      const acc: CliRun = {
        text: '',
        resultText: null,
        model: null,
        usage: { ...EMPTY_USAGE },
        costUsd: null,
        ttftMs: -1,
        isError: false,
        subtype: null,
      };
      let stderr = '';
      let buffer = '';
      let settled = false;
      let sawResult = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL');
          reject(new Error(`The Claude CLI did not answer within ${Math.round(this.#timeoutMs / 1000)}s.`));
        });
      }, this.#timeoutMs);

      const consume = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          // A stray non-JSON line (a warning, a progress bar) is noise, not a failure. Only a
          // run that produces no `result` event at all counts as malformed.
          return;
        }
        if (event.type === 'stream_event') {
          const inner = event.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
          if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
            const delta = inner.delta.text ?? '';
            if (delta.length > 0) {
              if (acc.ttftMs < 0) acc.ttftMs = this.#now() - startedAt;
              acc.text += delta;
              onDelta?.(delta);
            }
          }
          return;
        }
        if (event.type === 'result') {
          sawResult = true;
          acc.subtype = typeof event.subtype === 'string' ? event.subtype : null;
          acc.isError = event.is_error === true || acc.subtype === 'error_during_execution';
          acc.resultText = typeof event.result === 'string' ? event.result : null;
          acc.usage = normaliseCliUsage(event.usage);
          acc.costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null;
          acc.model = modelFromResult(event) ?? acc.model;
          if (acc.ttftMs < 0 && typeof event.ttft_ms === 'number') acc.ttftMs = event.ttft_ms;
        }
        if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') {
          acc.model = event.model;
        }
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          consume(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        finish(() => reject(err.code === 'ENOENT' ? new ClaudeCliNotFoundError() : err));
      });

      child.on('close', (code) => {
        consume(buffer);
        finish(() => {
          const combined = `${stderr}\n${acc.resultText ?? ''}`;
          if (looksNotLoggedIn(combined)) {
            reject(new ClaudeCliNotLoggedInError());
            return;
          }
          if (code !== 0) {
            reject(new Error(`The Claude CLI exited ${code}: ${stderr.trim().slice(0, 300) || 'no output'}`));
            return;
          }
          if (!sawResult) {
            reject(new Error(`The Claude CLI produced no parseable result: ${(acc.text || stderr).trim().slice(0, 300) || 'empty output'}`));
            return;
          }
          if (acc.isError) {
            reject(new Error(`The Claude CLI reported an error: ${(acc.resultText ?? stderr).trim().slice(0, 300)}`));
            return;
          }
          if (acc.ttftMs < 0) acc.ttftMs = this.#now() - startedAt;
          resolve(acc);
        });
      });

      child.stdin.on('error', () => {
        /* The child can exit before the write drains; `close` reports the real failure. */
      });
      child.stdin.end(prompt, 'utf8');
    });
  }
}

/**
 * Print mode takes exactly one user turn, so the transcript is flattened into it. The labels
 * the group context builder already wrote into each message body ("Student: …", "Max
 * (challenger): …") are what carries who-said-what, so they are kept verbatim; the only thing
 * added is a marker on the speaker's *own* past turns, which arrive as `assistant` messages
 * with no label because the API path would have attributed them by role.
 *
 * Nothing is summarised, reordered or dropped: byte-for-byte, every message body in
 * `request.messages` appears in this string, in order.
 */
export function promptFor(request: LlmRequest): string {
  return flattenMessages(request.messages);
}

export const OWN_TURN_PREFIX = 'You said: ';

export function flattenMessages(messages: LlmMessage[]): string {
  return messages
    .map((m) => (m.role === 'assistant' ? `${OWN_TURN_PREFIX}${m.content}` : m.content))
    .join('\n\n');
}

/** `--system-prompt` takes one string; the cache breakpoints are an API-path concern. */
export function systemTextFor(request: LlmRequest): string {
  return request.system.map((b) => b.text).join('\n\n');
}

function pickText(run: CliRun): string {
  const streamed = run.text.trim();
  const final = (run.resultText ?? '').trim();
  // Under `--json-schema` the structured answer arrives only in `result.result`; in a plain
  // turn the streamed deltas and `result.result` agree, and `result` is the tidier of the two.
  if (final.length > 0) return final;
  return streamed;
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** First balanced `{…}` in the string. Same job as the orchestrator's own unwrapper. */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function modelFromResult(event: Record<string, unknown>): string | null {
  const usage = event.modelUsage;
  if (usage && typeof usage === 'object') {
    const keys = Object.keys(usage as Record<string, unknown>);
    if (keys.length > 0) return keys[0]!;
  }
  return null;
}

/**
 * The CLI's `result.usage` is the Anthropic usage shape with extra fields. Mapped to the same
 * four numbers the API path persists, so `cache_read_input_tokens` on a message row means the
 * same thing whichever backend produced it.
 */
export function normaliseCliUsage(raw: unknown): LlmUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_input_tokens: n(u.cache_read_input_tokens),
    cache_creation_input_tokens: n(u.cache_creation_input_tokens),
  };
}
