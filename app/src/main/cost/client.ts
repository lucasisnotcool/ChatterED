/**
 * **The one place a call is counted.**
 *
 * A decorator over any `LLMClient`, applied in `backend.createClient()` underneath
 * `loggedClient`, for the same reason that one exists: instrumenting *the port* rather than
 * every call site means a new call site cannot forget. The orchestrator decision, the ledger
 * update, the concept ingest, the objectives ingest, a REFERENCE answer and every agent turn all
 * arrive here without any of them knowing a ledger exists.
 *
 * **Order matters, and it is deliberate.** `createClient` composes
 * `loggedClient(costedClient(raw))`, so the cost row is written *before* `llm.complete` is
 * logged. A row that exists and a log line that describes it therefore cannot disagree about
 * whether the call happened, and a crash between the two loses a log line rather than an
 * accounting fact.
 *
 * **A failed accounting write must never cost the learner their turn.** Everything here is
 * inside a try/catch that logs `cost.record_failed` and returns the result untouched. The worst
 * case is a counter that is low; the alternative — a full disk turning into a failed reply — is
 * not a trade this app makes.
 *
 * **A call that throws is recorded too** (migration 021; the gap #42 shipped with, closed).
 *
 * It used to record nothing, and the consequence was worse than an undercount: every total got
 * quietly *better* the more a session went wrong, because a killed call left no trace at all. So
 * the decorator now writes a row on the failure path as well, carrying
 *
 *  - **whatever usage the backend managed to report** before it died. `usageFromError()` reads it
 *    off the thrown error, which `claude-cli.ts` attaches when a `result` message arrived before
 *    the kill. Usually that is nothing, and a zero-token row is the honest answer: the tokens the
 *    provider burned are not observable from here and inventing them would be worse than a zero.
 *  - **why it ended** — `'aborted'` for the learner's Stop, `'preempted'` for a notes window the
 *    lane killed to let a click through (which `notes/ingest.ts` then re-queues, so a *second*
 *    row follows for the same work), `'error'` for everything else.
 *
 * The error is always re-thrown. Accounting never changes what the caller sees.
 */
import { type CostBackend, type CostOutcome, type CostScope, type CostTokens } from '../../shared/cost.js';
import { LlmAbortedError, type LLMClient, type LlmRequest, type LlmResult, type LlmScope, type LlmUsage } from '../../room/llm/types.js';
import { log, type Logger } from '../log.js';
import type { RecordInput } from './ledger.js';

/** What the decorator needs: somewhere to write, and somewhere to push the tick. */
export interface CostSink {
  record(input: RecordInput): unknown;
}

export function costedClient(inner: LLMClient, sink: CostSink | null, logger: () => Logger = log): LLMClient {
  if (sink === null) return inner;
  return {
    kind: inner.kind,
    async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
      const startedAt = Date.now();
      let result: LlmResult;
      try {
        result = await inner.complete(request, onDelta, signal);
      } catch (err) {
        write(() => sink.record(recordForFailure(request, err, inner.kind, Date.now() - startedAt)));
        throw err;
      }
      write(() => sink.record(recordFor(request, result, inner.kind, Date.now() - startedAt)));
      return result;

      /** A failed accounting write must never cost the learner their turn. See the header. */
      function write(fn: () => void): void {
        try {
          fn();
        } catch (err) {
          logger().warn('cost.record_failed', {
            scope: request.meta.scope,
            class: err instanceof Error ? err.name : 'Error',
            cause: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
          });
        }
      }
    },
  };
}

/**
 * The mapping from a completed call to a ledger row. Exported because it is the whole of the
 * translation and it is worth being able to assert without a database.
 *
 * `result.model` over `request.model`: the CLI resolves an alias (`sonnet`) to a dated id and
 * reports back which model actually answered — `claude-cli.ts#modelFromResult` picks the one
 * with the most output tokens precisely so this is the model that *wrote the reply*, not one of
 * the auxiliary Haiku calls Claude Code makes alongside it.
 */
export function recordFor(request: LlmRequest, result: LlmResult, kind: CostBackend, durationMs: number): RecordInput {
  const usage = result.usage;
  return {
    scope: request.meta.costScope ?? costScopeFor(request.meta.scope),
    model: result.model || request.model,
    backend: (result.backend ?? kind) as CostBackend,
    tokens: {
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheWrite: usage?.cache_creation_input_tokens ?? 0,
      cacheRead: usage?.cache_read_input_tokens ?? 0,
    },
    turnId: request.meta.turnId ?? null,
    roomId: request.meta.roomId ?? null,
    fileId: request.meta.fileId ?? null,
    anchorId: request.meta.anchorId ?? null,
    reportedUsd: typeof result.costUsd === 'number' ? result.costUsd : null,
    durationMs,
    outcome: 'ok',
  };
}

/**
 * **The same mapping, for a call that never returned.**
 *
 * The attribution is taken entirely from the *request* — there is no result to read a resolved
 * model id off, so `request.model` stands, and it is the alias (`sonnet`) rather than the dated
 * id on the CLI path. That is correct and not a downgrade: it is what this app asked for, and it
 * is all that is knowable about a call that was killed.
 */
export function recordForFailure(request: LlmRequest, err: unknown, kind: CostBackend, durationMs: number): RecordInput {
  const harvested = usageFromError(err);
  return {
    scope: request.meta.costScope ?? costScopeFor(request.meta.scope),
    model: harvested.model ?? request.model,
    backend: kind,
    tokens: harvested.tokens,
    turnId: request.meta.turnId ?? null,
    roomId: request.meta.roomId ?? null,
    fileId: request.meta.fileId ?? null,
    anchorId: request.meta.anchorId ?? null,
    reportedUsd: harvested.costUsd,
    durationMs,
    outcome: outcomeFor(err),
  };
}

/**
 * Stop is `'aborted'`; the pre-emption the notes lane suffers is `'preempted'`; everything else
 * is `'error'`.
 *
 * `CliPreemptedError` is matched **by name, not by class**: it lives in `src/main/llm/` and this
 * module is imported by `src/room`'s tests, so an import would drag the CLI backend (and
 * `node:child_process`) into every one of them. A name is enough for a class this module only
 * ever reads.
 */
export function outcomeFor(err: unknown): CostOutcome {
  if (err instanceof LlmAbortedError) return 'aborted';
  const name = err instanceof Error ? err.name : '';
  if (name === 'LlmAbortedError') return 'aborted';
  if (name === 'CliPreemptedError') return 'preempted';
  return 'error';
}

/**
 * **What the backend managed to report before it threw**, read off the error.
 *
 * Duck-typed rather than an interface the backends implement, because the shape has to survive
 * an error that crossed a `Promise.all`, a re-throw and an `AggregateError` without anybody
 * having remembered to re-attach it. A missing or malformed carrier reads as zero, which is the
 * common case and the honest one.
 */
export function usageFromError(err: unknown): { tokens: CostTokens; model: string | null; costUsd: number | null } {
  const empty = { tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, model: null, costUsd: null };
  if (typeof err !== 'object' || err === null) return empty;
  const carrier = (err as { llmUsage?: unknown }).llmUsage;
  if (typeof carrier !== 'object' || carrier === null) return empty;
  const u = carrier as { usage?: Partial<LlmUsage>; model?: unknown; costUsd?: unknown };
  const usage = u.usage ?? {};
  return {
    tokens: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
    },
    model: typeof u.model === 'string' && u.model.length > 0 ? u.model : null,
    costUsd: typeof u.costUsd === 'number' && Number.isFinite(u.costUsd) ? u.costUsd : null,
  };
}

/**
 * **Attach what a call consumed to the error that ends it.** Called by the backends on their
 * failure paths; read back by `usageFromError` above. Non-enumerable so it cannot end up in a
 * log line or a JSON-serialised error — the carrier is an accounting channel, not a payload.
 */
export function attachUsageToError<E>(err: E, carried: { usage?: LlmUsage; model?: string | null; costUsd?: number | null }): E {
  if (typeof err !== 'object' || err === null) return err;
  try {
    Object.defineProperty(err, 'llmUsage', { value: carried, enumerable: false, configurable: true });
  } catch {
    // A frozen error is not worth failing a call over.
  }
  return err;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

/**
 * `LlmScope` → `CostScope`. One-to-one for now; the two vocabularies are kept apart because the
 * port's is about which prompt builder ran and the ledger's is about what a learner is being
 * shown they spent. `'objectives'` and `'summary'` are only ever reached through
 * `meta.costScope`.
 */
export function costScopeFor(scope: LlmScope): CostScope {
  return scope;
}
