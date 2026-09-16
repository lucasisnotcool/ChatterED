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
 * **Errors are not recorded, and that is a real gap.** A call that throws reports no usage: the
 * CLI kills the child before a `result` message, and the API stream never reaches
 * `finalMessage()`. Tokens were spent on the provider's side and this ledger cannot see them,
 * so a summary is a floor, not a total. Said out loud here because the alternative is a panel
 * that quietly under-reports the exact sessions that went wrong.
 */
import type { CostBackend, CostScope } from '../../shared/cost.js';
import type { LLMClient, LlmRequest, LlmResult, LlmScope } from '../../room/llm/types.js';
import { log, type Logger } from '../log.js';
import type { CostLedger, RecordInput } from './ledger.js';

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
      const result = await inner.complete(request, onDelta, signal);
      try {
        sink.record(recordFor(request, result, inner.kind, Date.now() - startedAt));
      } catch (err) {
        logger().warn('cost.record_failed', {
          scope: request.meta.scope,
          class: err instanceof Error ? err.name : 'Error',
          cause: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        });
      }
      return result;
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
  };
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
