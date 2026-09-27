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
import { accessSync, constants, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import type { LLMClient, LlmMessage, LlmRequest, LlmResult, LlmUsage } from '../../room/llm/types.js';
import { EMPTY_USAGE, LlmAbortedError } from '../../room/llm/types.js';
import { attachUsageToError, usageFromError } from '../cost/client.js';
import { scrub } from '../log.js';

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

/** A regular file (symlinks followed) this user may execute. A directory with +x is not one. */
function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * **What a Settings override may point at** (release review, 2026-09-25).
 *
 * The override is a string the renderer sends, and main *spawns* it — so an unchecked value is
 * "run any executable on this Mac". It is accepted only when it is:
 *  - absolute (a leading `~/` is expanded against `HOME` first, because that is how the
 *    placeholder and the install docs write it);
 *  - an existing **regular file** (symlinks followed — `~/.local/bin/claude` is a symlink into
 *    `~/.local/share/claude/versions/…`) that this user may execute;
 *  - named **`claude`**, as the link or file the learner pointed at is named.
 *
 * Returns the sentence to show, or null when the path is acceptable. `saveSettings` refuses a
 * path that fails, and `resolveClaudeBinary` re-checks on every read, so a row written by an
 * older build (or by hand) that fails is never spawned either.
 */
export function cliOverrideProblem(raw: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const path = expandHome(raw.trim(), env);
  if (path.length === 0) return null;
  if (!isAbsolute(path)) return 'Give the full path to the claude binary, starting with / (or ~/).';
  if (basename(path) !== 'claude') return 'The path must point at the Claude Code binary itself — a file named claude.';
  let st;
  try {
    st = statSync(path);
  } catch {
    return `There is no file at ${path}.`;
  }
  if (!st.isFile()) return `${path} is not a file.`;
  if (!isExecutable(path)) return `${path} is not executable.`;
  return null;
}

/** `~/x` → `$HOME/x`. Anything else unchanged. */
export function expandHome(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? '';
  if (home && (path === '~' || path.startsWith('~/'))) return join(home, path.slice(1));
  return path;
}

/** Whether a resolved binary path is one this app will spawn: see `cliOverrideProblem`. */
export function isSpawnableClaude(path: string | null | undefined): path is string {
  return typeof path === 'string' && path.length > 0 && isAbsolute(path) && basename(path) === 'claude' && isExecutable(path);
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
  const override = expandHome((opts.override ?? '').trim(), env);
  if (override.length > 0) return cliOverrideProblem(override, env) === null ? override : null;

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

/**
 * **A non-zero exit, with what the CLI said about it.**
 *
 * The CLI prints its own failures — the subscription limit, an API error — as an `is_error`
 * `result` event on **stdout**, with stderr empty. Reading stderr alone logged every one of them
 * as `exited 1: no output` (15 in `main.log` to 25 Sep), which is not a diagnosis. So the reason
 * is stderr if there is one, else the error result's text (or its `errors` list), passed through
 * the log's key scrubbing and capped. A result that is *not* an error is a model answer, may echo
 * the learner, and is never copied in.
 *
 * `kind` is what the payload makes clear and nothing more: `limit` when the CLI tagged the
 * message `rate_limit`/`billing_error` or said "limit" in so many words, `api` for an `API Error`
 * line or a server/request error tag, `exit` otherwise. The name carries it into `errorClass`, so
 * `llm.error class=CliLimitError` is one grep. The message still reads `exited N: …`, so the
 * learner's card (`failureReason`) and `exit_code` are unchanged.
 */
export type CliFailureKind = 'exit' | 'limit' | 'api';

export class CliExitError extends Error {
  readonly code: number | null;
  readonly kind: CliFailureKind;
  /** Nothing on stderr — the shape `isEmptyExitOne` retries, whatever stdout said. */
  readonly quiet: boolean;

  constructor(code: number | null, detail: string, kind: CliFailureKind, quiet: boolean) {
    super(`The Claude CLI exited ${code}: ${detail || 'no output'}`);
    this.code = code;
    this.kind = kind;
    this.quiet = quiet;
    this.name = kind === 'limit' ? 'CliLimitError' : kind === 'api' ? 'CliApiError' : 'CliExitError';
  }
}

const LIMIT_TAGS: ReadonlySet<string> = new Set(['rate_limit', 'billing_error']);
const API_TAGS: ReadonlySet<string> = new Set(['server_error', 'invalid_request', 'authentication_failed']);

export function cliFailureKind(detail: string, tag: string | null): CliFailureKind {
  if ((tag !== null && LIMIT_TAGS.has(tag)) || /hit your (?:\w+ )?limit|usage limit|limit reached|credit balance/i.test(detail)) return 'limit';
  if ((tag !== null && API_TAGS.has(tag)) || /API Error|overloaded|\b(?:429|5\d\d)\b/i.test(detail)) return 'api';
  return 'exit';
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
  /** `result.errors` on an `error_during_execution` result: the CLI's own words, not the model's. */
  errors: string[];
  /** The `error` tag on a synthetic assistant message (`rate_limit`, `server_error`, …). */
  errorTag: string | null;
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
  /**
   * **The doc edit belongs to the turn the learner is reading** (#48, collab-doc.md §5). It runs
   * after the agent's words have landed, so it is not on the visible latency path — but it is
   * what writes the answer into the document, and a learner watching Ellie's cursor sit still
   * for a minute behind a notes window has been lied to by the cursor. Above the background
   * lane, below the turn itself.
   */
  docedit: 1,
  // Nobody is waiting to read any of these.
  ledger: 2,
  ingest: 2,
  notes: 2,
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
 *
 * **`notes` is here too, and it is the one that is *not* disposable** (#48). A notes window is
 * the longest call the app makes and a deck is seven to nine of them back to back, so a learner
 * who asks a question three windows in must not wait behind one — but a killed window would
 * lose a slice of the document, not a draft nobody has seen. The difference is paid for in the
 * caller, not here: `notes/ingest.ts` catches `CliPreemptedError` and **re-queues that window**,
 * and `ingest_state` on the row means even an app quit resumes rather than redoes. Pre-emption
 * is a kill; whether it is a loss is the caller's decision, and for this caller it is not.
 */
export const CLI_PREEMPTIBLE: ReadonlySet<string> = new Set(['ingest', 'notes']);

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
export const CLI_DEFERRED: ReadonlySet<string> = new Set(['ingest', 'ledger', 'notes']);

/**
 * **One lane, still — and that is a decision, not an omission** (#48).
 *
 * A windowed notes ingest is seven to nine serial calls on a 66-page deck, and the obvious fix
 * is a second lane so the ingest and a learner's question never contend. The comment on
 * `CliQueue` above is why that is not done: on 2026-09-16 the group call and the ledger call
 * were dispatched three milliseconds apart and **both** came back `exited 1: no output`. Two
 * `claude` children starting into the same config at the same instant is a shape the CLI does
 * not survive, and a second lane would make that the *normal* state of a deck being ingested
 * rather than a rare race.
 *
 * So the ingest is kept off the learner's way by the three mechanisms that do not spawn a second
 * child: priority 2 (it never takes the lane from something waiting), the grace window above
 * (the click that starts it is usually the click that asks something), and pre-emption with a
 * re-queue (what is already running is killed, and retried afterwards). The cost is that the
 * ingest is *slower* while a learner is asking questions, which is the right way round.
 */
export const CLI_SINGLE_LANE = true;

/**
 * **How long the lane stays free after a learner-facing call ends, for that turn's follow-ups.**
 *
 * `release()` used to hand the lane over synchronously, to whatever was waiting *at that
 * instant* — and at the end of a reply that is usually the ledger alone, its grace window long
 * expired. The same turn's doc edit (priority 1) and Max's chained reply (priority 0) are
 * dispatched a few milliseconds later, and so found a ledger on the lane and waited the whole of
 * it: 2026-09-20 02:24:13.538, Ellie's reply released, the doc edit asked at +3 ms and Max at
 * +7 ms, and they queued 9.5 s and 6.0 s. Across the 24 live turns in the log the gap between a
 * reply's release and its follow-up was 2–11 ms; after 19 Sep every queued reply over 3 s was
 * behind a ledger. Priority cannot reorder a call that is already running, so the fix is in the
 * hand-off: after a priority ≤ 1 call the lane is held this long, a priority-0 call arriving in
 * the window takes it at once, and when the window closes the best waiter gets it — so Max
 * goes before the doc edit, and both before the ledger, as `CLI_PRIORITY` already says.
 *
 * Not a tick: the follow-ups come after awaited work (the reply's persistence, the next turn's
 * set-up), not after a microtask. 150 ms is an order of magnitude above the measured gap and
 * below anything a learner could see on a doc edit; the ledger and the ingests lose at most that.
 * A priority-0 call already waiting at release is handed the lane with no hold at all.
 */
export const CLI_HANDOFF_HOLD_MS = 150;

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

/** Exported for tests: the lane's ordering is a rule, and a rule is asserted on its own. */
export class CliQueue {
  #running: { priority: number; preempt: (() => void) | null } | null = null;
  #waiting: Waiter[] = [];
  #seq = 0;
  /** Set while the lane is kept free for a finished turn's follow-ups (`CLI_HANDOFF_HOLD_MS`). */
  #hold: ReturnType<typeof setTimeout> | null = null;

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
    // Free, and either not held or held for exactly this: a learner-facing reply.
    if (this.#running === null && (this.#hold === null || priority === 0)) {
      this.#endHold();
      this.#running = { priority, preempt };
      return Promise.resolve(0);
    }
    /**
     * A learner is waiting on this one, and what holds the lane can be thrown off it.
     *
     * **`<= 1`, not `<= 0`** (20 Sep). Priority 1 is `orchestrator` and `docedit`, and both are
     * part of a turn the learner is watching: `docedit`'s own entry in `CLI_PRIORITY` says a
     * learner "watching Ellie's cursor sit still for a minute behind a notes window has been
     * lied to by the cursor", and that is precisely what the gate allowed — pre-emption stopped
     * at priority 0, so a doc edit queued behind the running window instead of taking the lane.
     * Measured at 8.6 s on a one-window deck; a 66-page deck's windows are ~80 s each.
     *
     * It cannot starve the background work: only `ingest` and `notes` are pre-emptible, both
     * re-queue or are retried by their callers, and nothing at priority 2 can pre-empt anything.
     */
    /**
     * **Taken now, fired after the waiter is on the queue.** `kill()` may release the lane
     * synchronously — that is the tidiest thing a pre-empted caller can do — and if this call
     * were still outside the queue at that moment, `release()` would find nothing waiting, drop
     * the lane, and the caller that did the pre-empting would wait for a wake-up that never
     * comes. Found by the test below; in production the window is narrow (the notes window
     * releases when its child exits) but it is the kind of narrow that shows up on camera.
     */
    const kill = priority <= 1 ? (this.#running?.preempt ?? null) : null;
    if (kill && this.#running) this.#running.preempt = null;
    const queued = new Promise<number>((resolve, reject) => {
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
    if (kill) kill();
    return queued;
  }

  release(): void {
    const released = this.#running?.priority ?? Number.POSITIVE_INFINITY;
    this.#running = null;
    const next = this.#best();
    // A learner-facing call just ended and nothing better than its follow-ups is waiting: keep
    // the lane free for them rather than hand it to the ledger (`CLI_HANDOFF_HOLD_MS`).
    if (released <= 1 && (next === null || next.priority > 0) && CLI_HANDOFF_HOLD_MS > 0) {
      this.#endHold();
      this.#hold = setTimeout(() => {
        this.#hold = null;
        if (this.#running === null) this.#handOff();
      }, CLI_HANDOFF_HOLD_MS);
      return;
    }
    this.#handOff();
  }

  #best(): Waiter | null {
    return this.#waiting.reduce<Waiter | null>(
      (best, w) => (best === null || w.priority < best.priority || (w.priority === best.priority && w.seq < best.seq) ? w : best),
      null,
    );
  }

  #handOff(): void {
    const next = this.#best();
    if (!next) return;
    this.#waiting = this.#waiting.filter((w) => w !== next);
    next.start();
  }

  #endHold(): void {
    if (this.#hold === null) return;
    clearTimeout(this.#hold);
    this.#hold = null;
  }

  /** Tests only. The app has exactly one queue for its whole life. */
  reset(): void {
    this.#endHold();
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

/**
 * The retry's own rule, now that the message can carry stdout's reason: exit 1 with **nothing
 * on stderr**, exactly as before — except a usage limit, which will not lift in half a second.
 */
export function isRetryableExit(err: unknown): boolean {
  if (err instanceof CliExitError) return err.code === 1 && err.quiet && err.kind !== 'limit';
  return err instanceof Error && isEmptyExitOne(err.message);
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
  /**
   * A notes window is the biggest single answer the app asks for: eight to twelve slides in, and
   * cohesive prose notes with provenance on every block out — several thousand output tokens,
   * plus (on the image path) a Read tool call per slide before the answer even begins. Measured
   * on the CS3249 Lecture 4 deck, a text-only window runs 60–150 s and an image window longer.
   * It is pre-emptible and nobody is waiting on it, so a generous ceiling costs nothing; it only
   * decides when a stuck child is declared stuck.
   */
  notes: 600_000,
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
      //
      // Whatever the killed child had already reported travels with the substitution, or the
      // cost row for a pre-empted window would be a zero where a number was available
      // (`src/main/cost/client.ts`).
      if (preempted && !signal?.aborted) {
        const carried = usageFromError(err);
        throw attachUsageToError(new CliPreemptedError(), {
          usage: {
            input_tokens: carried.tokens.input,
            output_tokens: carried.tokens.output,
            cache_read_input_tokens: carried.tokens.cacheRead,
            cache_creation_input_tokens: carried.tokens.cacheWrite,
          },
          model: carried.model,
          costUsd: carried.costUsd,
        });
      }
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
    const images = request.images ?? [];
    return [
      '-p',
      '--model',
      request.model,
      /**
       * **`--tools ""` is the rule, and `Read` on an image request is the one exception** (#48).
       *
       * The notes ingest's refine pass is specified "with the slide images" (collab-doc.md §2),
       * and this backend has no image flag and no argv big enough for a JPEG — the prompt is on
       * stdin for exactly that reason. The only door the CLI leaves open is its own file tools,
       * so a request that carries `images` is given **Read and nothing else**, plus the one
       * directory those images are in, and `promptFor` lists the absolute paths with an
       * instruction to read every one before answering.
       *
       * Two properties keep this from eroding the posture argued at the top of this file: the
       * grant is *per request* (every call without `images` produces byte-identical argv to the
       * one it produced before this existed, which `claude-cli.test.ts` asserts), and `--add-dir`
       * names a directory the app itself wrote inside `userData` — the child is not given the
       * learner's vault, their home directory or the repository. `--strict-mcp-config`,
       * `--setting-sources ""` and `--disable-slash-commands` are unchanged, so no MCP server and
       * no user setting rides in with the grant.
       */
      '--tools',
      images.length > 0 ? 'Read' : '',
      ...imageDirs(images).flatMap((dir) => ['--add-dir', dir]),
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
      if (err instanceof LlmAbortedError || !isRetryableExit(err)) throw err;
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
        errors: [],
        errorTag: null,
      };
      let stderr = '';
      let buffer = '';
      let settled = false;
      let sawResult = false;

      /**
       * **Reject, carrying what the run had already reported.**
       *
       * Usually nothing: `usage` only arrives on the `result` message, and a SIGKILL beats it.
       * But a run that *did* see a result and then failed on `is_error` — or one killed after it
       * — has real numbers on `acc`, and dropping them is how a ledger becomes a floor
       * (`src/main/cost/client.ts`). The carrier is non-enumerable, so nothing that logs or
       * serialises this error sees it.
       */
      const fail = (err: unknown): void => {
        reject(attachUsageToError(err, { usage: acc.usage, model: acc.model, costUsd: acc.costUsd }));
      };

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
              fail(new LlmAbortedError());
            });
          }
        : null;
      if (onAbort) signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutMs = CLI_TIMEOUT_MS[request.meta.scope] ?? this.#timeoutMs;
      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL');
          fail(new Error(`The Claude CLI did not answer within ${Math.round(timeoutMs / 1000)}s.`));
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
          acc.errors = Array.isArray(event.errors) ? event.errors.filter((e): e is string => typeof e === 'string') : [];
        }
        if (event.type === 'assistant' && typeof event.error === 'string') acc.errorTag = event.error;
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
        finish(() => fail(err.code === 'ENOENT' ? new ClaudeCliNotFoundError() : err));
      });

      child.on('close', (code) => {
        consume(buffer);
        finish(() => {
          const combined = `${stderr}\n${acc.resultText ?? ''}`;
          if (looksNotLoggedIn(combined)) {
            fail(new ClaudeCliNotLoggedInError());
            return;
          }
          if (code !== 0) {
            const said = stderr.trim();
            // Only an error result is the CLI talking; a successful one is the model's answer.
            const reported = acc.isError ? (acc.resultText ?? '').trim() || acc.errors.join('; ').trim() : '';
            const detail = scrub((said || reported).slice(0, 300));
            fail(new CliExitError(code, detail, cliFailureKind(`${said}\n${reported}`, acc.errorTag), said.length === 0));
            return;
          }
          if (!sawResult) {
            fail(new Error(`The Claude CLI produced no parseable result: ${(acc.text || stderr).trim().slice(0, 300) || 'empty output'}`));
            return;
          }
          if (acc.isError) {
            fail(new Error(`The Claude CLI reported an error: ${(acc.resultText ?? stderr).trim().slice(0, 300)}`));
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
  const flat = flattenMessages(request.messages);
  const images = request.images ?? [];
  if (images.length === 0) return flat;
  return `${imageInstruction(images)}\n\n${flat}`;
}

/** The directories `--add-dir` must name: one per distinct parent, in first-seen order. */
export function imageDirs(images: readonly { path: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const image of images) {
    const dir = dirname(image.path);
    if (dir.length === 0 || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

/**
 * How a CLI request asks for its images.
 *
 * It goes **first**, before the transcript, because it is an instruction about how to answer and
 * the answer's own instructions are in `--system-prompt`. The paths are absolute and listed one
 * per line with their page number, so the model can tie a picture to the page whose text it is
 * reading — a figure block's `page` has to be right, and "the third image" is not a page number.
 */
export function imageInstruction(images: readonly { path: string; page: number }[]): string {
  return [
    'BEFORE YOU ANSWER: read every one of these slide images with the Read tool. They are the',
    'slides the text below was extracted from, and they show the layout, the diagrams and the',
    'figures that the text layer cannot carry. Read all of them, then answer. Do not use any',
    'other tool, and do not read any other file.',
    '',
    ...images.map((image) => `  p. ${image.page}: ${image.path}`),
  ].join('\n');
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
