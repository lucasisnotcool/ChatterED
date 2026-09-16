/**
 * **Every model call, logged, without the room knowing.**
 *
 * A decorator over any `LLMClient`. It sits in `src/main` rather than next to the port because
 * it writes to a file, and it is applied in `backend.createClient()` so that the API path, the
 * CLI path and the scripted player are all instrumented identically — the actor still cannot
 * tell which one it has (issue #19), and now neither can the log, except by the `backend` field.
 *
 * What it records and, more importantly, what it does not: prompt **sizes**, never prompts;
 * chunk **counts**, never chunks; reply **lengths**, never replies. The one free-text field that
 * ships is the tail of the CLI's own stderr on a failure, capped at 400 characters, because "the
 * Claude CLI exited 1" without the line it printed is a dead end.
 */
import type { LLMClient, LlmRequest, LlmResult } from '../../room/llm/types.js';
import { STDERR_TAIL, errorClass, type Logger } from '../log.js';

export function loggedClient(inner: LLMClient, logger: () => Logger): LLMClient {
  return {
    kind: inner.kind,
    /**
     * `signal` **must** be forwarded. It was not, and the first live Stop looked like it worked —
     * the IPC said `stopped: true`, the partial was kept, the card said so — while the scripted
     * client streamed all twelve of its chunks to the end. On the CLI path the same omission
     * leaves `claude` generating and billing after a stop that reported success. A decorator that
     * silently drops an argument of the interface it decorates is worse than no decorator.
     */
    async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
      // The turn's correlation id when the caller set one; otherwise this call stands alone.
      const log = request.meta.turnId ? logger().child(request.meta.turnId) : logger();
      const startedAt = Date.now();
      const systemChars = request.system.reduce((n, b) => n + b.text.length, 0);
      const promptChars = request.messages.reduce((n, m) => n + m.content.length, 0);
      log.info('llm.request', {
        scope: request.meta.scope,
        model: request.model,
        backend: inner.kind,
        agent_key: request.meta.agentKey ?? null,
        system_chars: systemChars,
        prompt_chars: promptChars,
        turns: request.messages.length,
        // How much of the prefix is cacheable, which is the number §E.2 is about.
        cache_breakpoints: request.system.filter((b) => b.cache_control).length,
        max_tokens: request.max_tokens,
        json_schema: request.jsonSchema !== undefined,
      });

      let chunks = 0;
      let firstTokenAt = 0;
      const wrapped = (text: string): void => {
        chunks += 1;
        if (firstTokenAt === 0) {
          firstTokenAt = Date.now();
          log.info('llm.first_token', { scope: request.meta.scope, model: request.model, ms: firstTokenAt - startedAt });
        }
        // Count only, and only at debug: a stream of deltas is the message, one token at a time.
        log.debug('llm.stream.chunk', { scope: request.meta.scope, chunks });
        onDelta?.(text);
      };

      try {
        const result = await inner.complete(request, onDelta ? wrapped : undefined, signal);
        log.info('llm.complete', {
          scope: request.meta.scope,
          model: result.model,
          backend: result.backend ?? inner.kind,
          ms: Date.now() - startedAt,
          ttft_ms: result.ttftMs,
          chunks,
          reply_chars: result.text.length,
          usage: result.usage,
          ...(result.costUsd === undefined ? {} : { cost_usd: result.costUsd }),
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('llm.error', {
          scope: request.meta.scope,
          model: request.model,
          backend: inner.kind,
          ms: Date.now() - startedAt,
          class: errorClass(err),
          // The CLI puts its exit code and its stderr tail in the message already; capped here.
          cause: message.slice(0, STDERR_TAIL),
          exit_code: /exited (\d+)/i.exec(message)?.[1] ?? null,
        });
        throw err;
      }
    },
  };
}
