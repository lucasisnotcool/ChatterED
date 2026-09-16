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
import { EMPTY_USAGE, LlmAbortedError } from '../../room/llm/types.js';

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


// ── one `claude` at a time ──────────────────────────────────────────────────

/**
 * **The reply goes first, and it goes alone.**
 *
 * 2026-09-16 05:10:48, `room_6a9609d5c6fb`: the group call and the ledger call were dispatched
 * three milliseconds apart (`llm.request` scope=group at 47.209, scope=ledger at 47.206) and
 * **both** came back `CliExitError "The Claude CLI exited 1: no output"` 1.7 s later. Two
 * `claude` children starting into the same config at the same instant is a shape the CLI does
 * not survive, and the learner saw a failed turn and a failed rail from one keystroke.
 *
 * So: one child at a time, process-wide. Module-level and not per-instance on purpose —
 * `AppService.llm()` constructs a fresh `ClaudeCliClient` on every room open and every rebind,
 * so a queue owned by the client would be several queues and would serialise nothing.
 *
 * **Priority, because serialising is not enough.** If the ledger merely went first the learner
 * would wait for it, which is the failure the ledger was moved off the critical path to avoid.
 * Lower number wins; within a priority it is first-come, first-served, so nothing starves.
 */
export const CLI_PRIORITY: Record<string, number> = {
  // What the learner is watching for.
  group: 0,
  reference: 0,
  whisper: 0,
  // Decides who speaks. Usually settled by rule now (`rule:teacher_answers`), rarely a call.
  orchestrator: 1,
  // Nobody is waiting to read either of these.
  ledger: 2,
  ingest: 2,
};

export const CLI_DEFAULT_PRIORITY = 1;

/**
 * **Which call may be thrown off the lane for a learner.**
 *
 * Serialising alone was not enough, and the live run proved it: at 07:45:23.313 the background
 * ingest took the lane, at 07:45:23.342 — twenty-nine milliseconds later — the learner's own
 * deck question arrived, and it waited **70,591 ms** (`llm.queued_ms`) for an ingest nobody was
 * looking at. Priority reorders what is *waiting*; it cannot reorder what is already running.
 *
 * Only the concept ingest is on this list. It is the one call that is both long (70 s) and
 * genuinely disposable: a killed draft leaves `pack_provenance = 'pending'`, which is exactly
 * the state it started in, and the next room open or the next answer starts it again. The
 * ledger is *not* here — it is seconds, not a minute, and killing it loses a rail movement that
 * the learner's words have already earned.
 */
export const CLI_PREEMPTIBLE: ReadonlySet<string> = new Set(['ingest']);

/**
 * How long a pre-emptible call waits before it even joins the queue.
 *
 * The ingest is kicked off by the same click that asks the question, so this alone settles the
 * common case without anything being killed: the learner's call claims the lane first and the
 * draft queues behind it. Pre-emption is for the other case — a draft already a minute in when
 * the learner asks their second question.
 */
export const CLI_LOW_PRIORITY_GRACE_MS = 1_200;

/**
 * **Which calls wait out that window.** Every call nobody is watching for, which is a wider set
 * than the pre-emptible one.
 *
 * The ledger belongs here and not on `CLI_PREEMPTIBLE`: `#runAgentTurn` dispatches it *first*,
 * milliseconds before the reply, so without a grace window it takes the lane every single turn
 * and the learner waits behind it. Measured on five live turns before this line existed: the
 * reply queued **23.2 s, 56.7 s, 17.8 s and 28.4 s** behind a ledger call on turns 2–5. That is
 * the serialising fix turning into the very wait it was added to prevent. It still must not be
 * *killed*, though — a rail movement the learner's own words earned is not disposable.
 */
export const CLI_DEFERRED: ReadonlySet<string> = new Set(['ingest', 'ledger']);

/** Thrown when a background call was killed to let a learner-facing one through. Not a failure. */
export class CliPreemptedError extends Error {
  constructor() {
    super('That background call was stopped so the learner\u2019s question could go first.');
    this.name = 'CliPreemptedError';
  }
}

interface Waiter {
  priority: number;
  seq: number;
  preempt: (() => void) | null;
  start: () => void;
  fail: (err: Error) => void;
}

class CliQueue {
  #running: { priority: number; preempt: (() => void) | null } | null = null;
  #waiting: Waiter[] = [];
  #seq = 0;

  /**
   * Resolves with the milliseconds spent waiting. The caller must call `release()`.
   *
   * `preempt` is how this call says it may be killed for a learner: it is invoked on the
   * **running** call when something learner-facing arrives, and the call it belongs to is
   * expected to abort its child and reject. It is not a request to finish early — there is no
   * such thing for a subprocess — it is a kill.
   */
  acquire(priority: number, signal?: AbortSignal, preempt: (() => void) | null = null): Promise<number> {
    const queuedAt = Date.now();
    if (this.#running === null) {
      this.#running = { priority, preempt };
      return Promise.resolve(0);
    }
    // A learner is waiting on this one, and what holds the lane can be thrown off it.
    if (priority <= 0 && this.#running.preempt) {
      const kill = this.#running.preempt;
      this.#running.preempt = null;
      kill();
    }
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        seq: (this.#seq += 1),
        preempt,
        start: () => {
          if (onAbort) signal?.removeEventListener('abort', onAbort);
          this.#running = { priority, preempt };
          resolve(Date.now() - queuedAt);
        },
        fail: (err) => {
          if (onAbort) signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
      // Stop pressed while queued: the call never starts, and it does not hold the lane.
      const onAbort = signal
        ? () => {
            this.#waiting = this.#waiting.filter((w) => w !== waiter);
            waiter.fail(new LlmAbortedError());
          }
        : null;
      if (onAbort) signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(waiter);
    });
  }

  release(): void {
    const next = this.#waiting.reduce<Waiter | null>(
      (best, w) => (best === null || w.priority < best.priority || (w.priority === best.priority && w.seq < best.seq) ? w : best),
      null,
    );
    if (!next) {
      this.#running = null;
      return;
    }
    this.#waiting = this.#waiting.filter((w) => w !== next);
    next.start();
  }

  /** Tests only. The app has exactly one queue for its whole life. */
  reset(): void {
    this.#running = null;
    this.#waiting = [];
    this.#seq = 0;
  }
}

export const cliQueue = new CliQueue();

/**
 * The failure the retry is for: `exited 1` with **nothing on stderr**. That is the CLI losing a
 * race with itself, not a bad request — a bad request exits 1 with a reason printed. One retry,
 * after a breath, and then it is a real failure like any other.
 */
export function isEmptyExitOne(message: string): boolean {
  return /exited 1: no output/i.test(message);
}

export const CLI_RETRY_DELAY_MS = 500;

/**
 * **A call nobody is waiting for may take longer than one a learner is waiting on.**
 *
 * The single 120 s timeout was written for a turn, and for a turn it is generous: the longest
 * measured reply on this backend is ~11 s and a 40 s cold start is already a bug. The
 * learning-objective ingest (issue #38) is a different animal — 30 K characters of deck in, a
 * forced schema, and up to twenty nodes each with a statement, four criteria and three question
 * stems out. Measured on the 58-page CS4246 deck it **exceeded 120 s and was killed mid-answer**
 * (`llm.error TimeoutError` at 121,211 ms, 16 Sep), which is the worst of both: a minute of
 * Sonnet spent and a `failed` row at the end of it.
 *
 * Latency here is output tokens (`whole-file-context.md` §2), so the ceiling has to scale with
 * what is being asked for. Nothing on this list is on any path — both are background calls that
 * can be pre-empted for a learner at any moment — so a long ceiling costs nobody a wait; it only
 * decides when a stuck child is declared stuck.
 */
export const CLI_TIMEOUT_MS: Record<string, number> = {
  ingest: 300_000,
};

/**
 * **The app spawns `claude`, so the app decides how `claude` runs — not whatever launched the
 * app.**
 *
 * Found on the installed build, 16 Sep. The learning-objective ingest went out and produced
 * *nothing at all* in 300 s, twice; the stream showed why — the child opened a `thinking` block
 * and stayed in it, `system/thinking_tokens` climbing past 2,800 estimated tokens with no answer
 * begun. ChatterED had been started from a terminal that was itself inside Claude Code, and the
 * child inherited that session's environment: `CLAUDE_EFFORT`, `CLAUDECODE`,
 * `CLAUDE_CODE_SESSION_ID`, `MAX_THINKING_TOKENS=31999`. The same prompt with those removed and
 * thinking pinned off answered in **49.7 s / 6,205 output tokens**.
 *
 * Two consequences, and the second is the one that matters beyond this bug:
 *
 *  - **An app whose behaviour depends on how it was launched is not testable.** A build started
 *    from Finder, from launchd and from a developer's shell must make the same call, so every
 *    variable that describes *another* Claude Code session is dropped here. It is a denylist and
 *    not a `CLAUDE_*` sweep on purpose: `CLAUDE_CONFIG_DIR` is where the learner's login lives,
 *    and taking that away would log the app out of the subscription it runs on.
 *  - **Thinking buys nothing on a schema-bound call.** `ModelPlan.fast` already records the
 *    measurement from the other side — Haiku "reasons its way to the object where Sonnet writes
 *    it", two to four times the output tokens for the same JSON. These calls fill in a schema;
 *    there is nothing to deliberate about, and `MAX_THINKING_TOKENS=0` is what says so.
 */
export const CLI_DROPPED_ENV: readonly string[] = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_ENABLE_TASKS',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
  'MAX_THINKING_TOKENS',
];

/** The environment one `claude` child is given: the app's, minus the ambient session, plus PATH. */
export function cliEnv(base: NodeJS.ProcessEnv, request: LlmRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, PATH: buildPath(base) };
  for (const key of CLI_DROPPED_ENV) delete env[key];
  // A call that must fill in a schema has nothing to deliberate about.
  if (request.jsonSchema) env.MAX_THINKING_TOKENS = '0';
  return env;
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

  async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const priority = CLI_PRIORITY[request.meta.scope] ?? CLI_DEFAULT_PRIORITY;
    const preemptible = CLI_PREEMPTIBLE.has(request.meta.scope);

    // Let a click that is about to produce a learner-facing call get there first.
    if (CLI_DEFERRED.has(request.meta.scope) && CLI_LOW_PRIORITY_GRACE_MS > 0) {
      await new Promise((r) => setTimeout(r, CLI_LOW_PRIORITY_GRACE_MS));
      if (signal?.aborted) throw new LlmAbortedError();
    }

    const killer = preemptible ? new AbortController() : null;
    let preempted = false;
    const combined = killer
      ? signal
        ? AbortSignal.any([signal, killer.signal])
        : killer.signal
      : signal;

    const queuedMs = await cliQueue.acquire(
      priority,
      signal,
      killer
        ? () => {
            preempted = true;
            killer.abort();
          }
        : null,
    );
    try {
      const result = await this.#complete(request, onDelta, combined);
      return queuedMs > 0 ? { ...result, queuedMs } : result;
    } catch (err) {
      // The learner's question took the lane. Distinguished from their Stop, because the caller
      // does different things with the two: a pre-empted draft is retried, a stopped turn is not.
      if (preempted && !signal?.aborted) throw new CliPreemptedError();
      throw err;
    } finally {
      cliQueue.release();
    }
  }

  async #complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const run = await this.#runOnce(request, systemTextFor(request), promptFor(request), onDelta, signal);

    let text = pickText(run);

    // Structured output: `--json-schema` is enforced by the CLI, but a model that wraps the
    // object in prose (or a CLI that declines the schema) must not take the room down. One
    // repair retry, then let the caller's own parse failure handle it — the orchestrator and
    // the ledger both already treat an unparseable answer as "stay quiet".
    if (request.jsonSchema && !parsesAsJson(text)) {
      const repaired = await this.#runOnce(
        request,
        systemTextFor(request),
        `${promptFor(request)}\n\n[Your previous answer was not valid JSON. Reply with the JSON object only — no prose, no code fence.]\n\nPrevious answer:\n${text}`,
        undefined,
        // The repair spawns a *second* child. Without the signal a stop during it would leave
        // that one running, which is the whole failure mode SIGKILL is here to prevent.
        signal,
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

  /**
   * One spawn, with **one retry on the empty `exited 1`**. See `isEmptyExitOne`: that shape is
   * the CLI losing a race, and the serialising queue above makes it rare rather than impossible
   * — a `claude` the *user* is running in another window is outside this process's control.
   * Anything with a reason on stderr is a real failure and is not retried.
   */
  async #runOnce(
    request: LlmRequest,
    systemText: string,
    prompt: string,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<CliRun> {
    try {
      return await this.#spawnOnce(request, systemText, prompt, onDelta, signal);
    } catch (err) {
      if (err instanceof LlmAbortedError || !isEmptyExitOne((err as Error).message)) throw err;
      if (signal?.aborted) throw new LlmAbortedError();
      await new Promise((r) => setTimeout(r, CLI_RETRY_DELAY_MS));
      if (signal?.aborted) throw new LlmAbortedError();
      return this.#spawnOnce(request, systemText, prompt, onDelta, signal);
    }
  }

  #spawnOnce(
    request: LlmRequest,
    systemText: string,
    prompt: string,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<CliRun> {
    const args = this.argsFor(request, systemText);
    const startedAt = this.#now();

    return new Promise<CliRun>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new LlmAbortedError());
        return;
      }
      let child;
      try {
        child = spawn(this.binary, args, {
          cwd: this.#cwd,
          env: cliEnv(this.#env, request),
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
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        fn();
      };

      /**
       * **Stop, on the process.** Closing our end of the pipes would leave `claude` running: it
       * would finish the generation, bill the subscription for it, and only then notice nobody
       * was listening. SIGKILL is the only stop that is actually a stop. The partial text the
       * actor already received through `onDelta` is what becomes the message.
       */
      const onAbort = signal
        ? () => {
            finish(() => {
              child.kill('SIGKILL');
              reject(new LlmAbortedError());
            });
          }
        : null;
      if (onAbort) signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutMs = CLI_TIMEOUT_MS[request.meta.scope] ?? this.#timeoutMs;
      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL');
          reject(new Error(`The Claude CLI did not answer within ${Math.round(timeoutMs / 1000)}s.`));
        });
      }, timeoutMs);

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

/**
 * Which model actually answered.
 *
 * `result.modelUsage` is keyed by model id, and **it holds more than one entry**: the CLI runs
 * its own auxiliary Haiku calls alongside the request, so taking `Object.keys(...)[0]` reported
 * `claude-haiku-4-5` for a call made with `--model sonnet` — which then went onto the message
 * row as `messages.model`, i.e. into the research record. The one with the most output tokens is
 * the one that wrote the answer.
 */
export function modelFromResultForTest(event: Record<string, unknown>): string | null {
  return modelFromResult(event);
}

function modelFromResult(event: Record<string, unknown>): string | null {
  const usage = event.modelUsage;
  if (!usage || typeof usage !== 'object') return null;
  let best: string | null = null;
  let mostOutput = -1;
  for (const [model, u] of Object.entries(usage as Record<string, unknown>)) {
    const out = typeof (u as { outputTokens?: unknown })?.outputTokens === 'number'
      ? ((u as { outputTokens: number }).outputTokens)
      : typeof (u as { output_tokens?: unknown })?.output_tokens === 'number'
        ? ((u as { output_tokens: number }).output_tokens)
        : 0;
    if (out > mostOutput) {
      mostOutput = out;
      best = model;
    }
  }
  return best;
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
