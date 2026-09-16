<script lang="ts">
  /**
   * **⌥⌘D — the turn log (cui-standards-audit.md §10).**
   *
   * `latency_target_ms`, `ttft_actual_ms`, the orchestrator's `decided_by`, usage and cost are
   * all persisted and the event log already has §7.1's vocabulary — and **none of it is visible
   * while the app is running**, so diagnosing "hung, or thinking?" has meant opening SQLite in
   * another window. On 2026-09-16 that is exactly what the owner had to do.
   *
   * It is for the researcher, not the learner: a hidden gesture, no menu item, no discoverable
   * affordance, and it holds **no bodies at all** — `TurnTraceView` carries timings, ids and
   * token counts, and the actor's ring is built that way by construction, the same rule the log
   * sink enforces by key name. Nothing here can leak a transcript into a screenshot.
   */
  import { store } from '../lib/store.svelte.js';

  const rows = $derived([...store.turnTraces].reverse());

  function ms(n: number | null): string {
    return n === null ? '—' : `${(n / 1000).toFixed(2)}s`;
  }

  function tokens(usage: Record<string, number>): string {
    const inTok = usage.input_tokens ?? usage.inputTokens ?? 0;
    const outTok = usage.output_tokens ?? usage.outputTokens ?? 0;
    return inTok + outTok === 0 ? '—' : `${inTok}/${outTok}`;
  }
</script>

<aside class="drawer" aria-label="Turn log">
  <header>
    <span class="title">Turn log</span>
    <span class="quiet">{rows.length} turn{rows.length === 1 ? '' : 's'} · newest first · no bodies</span>
    <span class="gap"></span>
    <button type="button" class="mini" onclick={() => void store.loadTurnTraces()}>Refresh</button>
    <button type="button" class="mini" onclick={() => (store.debugOpen = false)}>Close ⌥⌘D</button>
  </header>

  {#if rows.length === 0}
    <p class="empty">
      No turns recorded yet in this room. If this stays empty while replies are arriving, the
      main process has not registered <code>flow:turnTrace</code> yet.
    </p>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>when</th><th>trigger</th><th>decided by</th><th>role</th>
            <th>decide</th><th>generate</th><th>ttft</th><th>floor</th><th>total</th>
            <th>model</th><th>backend</th><th>tok</th><th>end</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.turnId)}
            <tr class:bad={row.failed !== null} class:stopped={row.stopped}>
              <td>{row.startedAt.slice(11, 19)}</td>
              <td>{row.trigger}</td>
              <td>{row.decidedBy ?? '—'}</td>
              <td>{row.role ?? '—'}</td>
              <td>{ms(row.decisionMs)}</td>
              <td>{ms(row.generationMs)}</td>
              <td>{ms(row.ttftActualMs)}</td>
              <td>{ms(row.latencyTargetMs)}</td>
              <td>{ms(row.totalMs)}</td>
              <td>{row.model ?? '—'}</td>
              <td>{row.backend ?? '—'}</td>
              <td>{tokens(row.usage)}</td>
              <td>{row.failed ?? (row.stopped ? 'stopped' : 'ok')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</aside>

<style>
  .drawer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 46%;
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border-top: 1px solid var(--hairline);
    box-shadow: 0 -6px 20px rgb(0 0 0 / 10%);
    z-index: 60;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--hairline);
  }
  .title { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .quiet { font-size: 10.5px; color: var(--muted); }
  .gap { flex: 1; }
  .mini { font-size: 10.5px; color: var(--text-2); }
  .mini:hover { color: var(--indigo); }

  .empty { margin: 0; padding: 18px 12px; font-size: 11.5px; color: var(--muted); }
  .scroll { overflow: auto; min-height: 0; }

  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td {
    text-align: left;
    padding: 3px 8px;
    font-size: 10.5px;
    white-space: nowrap;
    border-bottom: 1px solid var(--hairline);
  }
  th { color: var(--muted); font-weight: 500; position: sticky; top: 0; background: var(--pane); }
  td { color: var(--text-2); }
  tr.bad td { color: #8a2708; }
  tr.stopped td { color: var(--muted); font-style: italic; }
</style>
