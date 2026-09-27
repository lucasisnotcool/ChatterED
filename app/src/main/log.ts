/**
 * **The log.** JSON lines, one object per event, at `~/Library/Logs/ChatterED/main.log`.
 *
 * *Why not `electron-log`.* It is the obvious answer and it was the first plan. Three things
 * argued it down. (1) This app ships with exactly three runtime dependencies and is installed
 * unsigned by a hand-rolled script; every package added to `dependencies` is another thing
 * inside the bundle nobody has read. (2) `electron-log` writes human-readable lines by default
 * and its JSON transport still formats through a template — what is wanted here is a *record*,
 * greppable with `jq`, with a correlation id on every line. (3) The single feature that would
 * justify the dependency is rotation, and rotation is the twenty lines below. So: no dependency,
 * and the format is documented in `docs/STATUS.md` rather than inherited from a library.
 *
 * **What may never appear in it.** No message body, no prompt, no system block, no API key, no
 * file contents, no learner text of any kind. Sizes, counts, ids, models, durations and error
 * *classes* — never the thing itself. `redact()` enforces it on the way in and
 * `log.test.ts` asserts it, modelled on the existing "event payloads never contain message
 * bodies" test, which is the same promise one layer down.
 *
 * This module lives in `src/main` and nothing in `src/room` imports it: the portable half takes
 * a `TurnLog` port (`src/room/ports.ts`) and the main process passes this in.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 4 MB a file, four files kept: enough for a long sitting, bounded at 16 MB forever. */
export const MAX_BYTES = 4 * 1024 * 1024;
export const KEEP = 4;

/**
 * Keys whose *values* are never written, whatever they contain. The list is by key name rather
 * than by content sniffing, because a heuristic that looks at values is a heuristic that lets
 * one through. Anything not on this list is still capped at `MAX_VALUE` characters.
 */
const FORBIDDEN = new Set([
  'body', 'text', 'content', 'prompt', 'system', 'messages', 'message', 'answer', 'reply',
  'question', 'selection', 'evidence', 'rationale', 'excerpt', 'snippet', 'quote', 'line',
  'apikey', 'api_key', 'key', 'token', 'authorization', 'password', 'secret', 'stdin',
  'extracted_text', 'page_text', 'transcript', 'draft', 'note',
]);

const MAX_VALUE = 300;

/**
 * **The key is scrubbed out of every string, not just out of the fields called `key`.**
 *
 * One free-text field does ship: `cause`, which carries the tail of the child process's own
 * stderr, because "the Claude CLI exited 1" without the line it printed is a dead end. That
 * stream is not ours and its contents cannot be predicted, so a key-shaped token is removed from
 * *any* string on the way in and the whole field is capped. The learner's own words never reach
 * a string field at all — those are dropped by key name above.
 */
const KEY_SHAPED = /sk-ant-[A-Za-z0-9_-]{8,}/g;

/**
 * The other providers' keys (BYOK, 2026-09-25), scrubbed the same way. Order matters: the
 * Anthropic pattern runs first so its marker survives, and the OpenAI pattern skips anything
 * already redacted.
 *  - OpenAI: `sk-…`, including `sk-proj-…` and `sk-svcacct-…`;
 *  - Google (Gemini / AI Studio): `AIza…`;
 *  - any `Bearer <token>` — an OpenAI-compatible endpoint's key can be any string at all, and the
 *    Authorization header is the one place it is guaranteed to be written next to that word;
 *  - `x-goog-api-key: …` / `api-key=…` / `key=…` in a quoted header or a URL query.
 */
const OPENAI_KEY_SHAPED = /\bsk-(?!ant-\[redacted\])[A-Za-z0-9_-]{16,}/g;
const GOOGLE_KEY_SHAPED = /\bAIza[0-9A-Za-z_-]{20,}/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_PARAM = /\b(x-goog-api-key|x-api-key|api[_-]?key|key)(["']?\s*[:=]\s*["']?)(?!\[redacted\])[A-Za-z0-9._~+/-]{12,}/gi;

/** Exported for the one other place free text from a child process is put into an error. */
export function scrub(value: string): string {
  const clean = value
    .replace(KEY_SHAPED, 'sk-ant-[redacted]')
    .replace(OPENAI_KEY_SHAPED, 'sk-[redacted]')
    .replace(GOOGLE_KEY_SHAPED, 'AIza[redacted]')
    .replace(BEARER, '$1 [redacted]')
    .replace(KEY_PARAM, '$1$2[redacted]');
  return clean.length > MAX_VALUE ? `${clean.slice(0, MAX_VALUE)}…` : clean;
}

/** A `stderr` tail is the one free-text field that ships, and it is capped hard. */
export const STDERR_TAIL = 400;

export function redact(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN.has(key.toLowerCase())) {
      // The shape is still useful — "there was one, and it was 812 characters long".
      out[`${key}_chars`] = typeof value === 'string' ? value.length : null;
      continue;
    }
    if (value === null || value === undefined) out[key] = null;
    else if (typeof value === 'string') out[key] = scrub(value);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.length;
    else if (typeof value === 'object' && depth < 2) out[key] = redact(value as Record<string, unknown>, depth + 1);
    else out[key] = scrub(String(value));
  }
  return out;
}

export interface LogSink {
  write(line: string): void;
}

/** `~/Library/Logs/ChatterED` on macOS; `app.getPath('logs')` resolves to the same place. */
export function defaultLogDir(): string {
  return join(homedir(), 'Library', 'Logs', 'ChatterED');
}

/**
 * Size-based rotation, checked on write. `main.log` → `main.1.log` → … → `main.4.log`, oldest
 * discarded. Synchronous on purpose: a log that loses the last lines before a crash is a log
 * that is missing exactly the lines the crash was about.
 */
export function fileSink(dir: string, name = 'main.log'): LogSink {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const stem = name.replace(/\.log$/, '');
  return {
    write(line: string): void {
      try {
        let size = 0;
        try {
          size = statSync(path).size;
        } catch {
          size = 0;
        }
        if (size + line.length > MAX_BYTES) {
          const oldest = join(dir, `${stem}.${KEEP}.log`);
          if (existsSync(oldest)) unlinkSync(oldest);
          for (let i = KEEP - 1; i >= 1; i -= 1) {
            const from = join(dir, `${stem}.${i}.log`);
            if (existsSync(from)) renameSync(from, join(dir, `${stem}.${i + 1}.log`));
          }
          if (existsSync(path)) renameSync(path, join(dir, `${stem}.1.log`));
        }
        appendFileSync(path, line, 'utf8');
      } catch {
        /* A log that throws must never take a turn down with it. */
      }
    },
  };
}

export interface LoggerOptions {
  sink: LogSink;
  level?: LogLevel;
  /** Injectable for tests. */
  now?: () => number;
  /** Fields stamped on every line: app version, build, backend. */
  base?: Record<string, unknown>;
}

/**
 * One event: `{"ts","level","event","turn",…fields}`.
 *
 * `event` is a dotted name from a closed vocabulary (`turn.start`, `llm.complete`, …) so a
 * whole session can be read back with one `jq 'select(.event=="llm.complete")'`; `turn` is the
 * correlation id that stitches a learner message, its orchestrator decision, its ledger update,
 * its LLM calls and its timer back into one turn.
 */
export class Logger {
  #sink: LogSink;
  #level: LogLevel;
  #now: () => number;
  #base: Record<string, unknown>;
  readonly #turn: string | null;

  constructor(opts: LoggerOptions, turn: string | null = null) {
    this.#sink = opts.sink;
    this.#level = opts.level ?? 'info';
    this.#now = opts.now ?? Date.now;
    this.#base = opts.base ?? {};
    this.#turn = turn;
  }

  /** A logger stamped with a turn id. Everything one turn does shares it. */
  child(turn: string): Logger {
    return new Logger({ sink: this.#sink, level: this.#level, now: this.#now, base: this.#base }, turn);
  }

  get level(): LogLevel {
    return this.#level;
  }

  setLevel(level: LogLevel): void {
    this.#level = level;
  }

  event(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    if (ORDER[level] < ORDER[this.#level]) return;
    const line = JSON.stringify({
      ts: new Date(this.#now()).toISOString(),
      level,
      event,
      ...(this.#turn ? { turn: this.#turn } : {}),
      ...this.#base,
      ...redact(fields),
    });
    this.#sink.write(`${line}\n`);
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.event('debug', event, fields);
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.event('info', event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.event('warn', event, fields);
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.event('error', event, fields);
  }
}

/** The process-wide logger. Created once in `main/index.ts`, read by everything else. */
let current: Logger = new Logger({ sink: { write: () => {} } });

export function initLogger(opts: LoggerOptions): Logger {
  current = new Logger(opts);
  return current;
}

export function log(): Logger {
  return current;
}

/** The last N lines, for **Copy diagnostics**. Already redacted — they were redacted on write. */
export function tailLog(dir: string, n = 50, name = 'main.log'): string[] {
  try {
    const path = join(dir, name);
    const text = readFileSync(path, 'utf8');
    return text.split('\n').filter((l) => l.length > 0).slice(-n);
  } catch {
    return [];
  }
}

/**
 * The *class* of an error, for `llm.error`. The message goes in too, but capped and only after
 * `redact()` — the class is what a grep is for.
 */
export function errorClass(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  if (err.name && err.name !== 'Error') return err.name;
  if (/exited \d+/i.test(err.message)) return 'CliExitError';
  if (/did not answer within/i.test(err.message)) return 'TimeoutError';
  if (/JSON|parse/i.test(err.message)) return 'ParseError';
  if (/ECONN|network|socket|fetch/i.test(err.message)) return 'NetworkError';
  return 'Error';
}
