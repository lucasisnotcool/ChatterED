<script lang="ts">
  /**
   * **A turn that failed, said out loud.**
   *
   * On 2026-09-16 a learner asked a question, the orchestrator decision came back unusable, no
   * agent turn was dispatched — and the thread showed *nothing*, then nudged them twice for
   * being quiet. This card is the fix for the visible half of that: it names who was going to
   * reply, what broke in one clause, and offers the retry. It is deliberately quiet (hairline,
   * muted, no colour alarm): an outage is not the learner's mistake and must not read as one.
   *
   * It is **not** a message. It has no row in `messages`, no participant, no seq, and it never
   * reaches any agent's prompt — the transcript must stay a record of what was actually said.
   */
  import type { TurnFailureView } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';

  let { failure }: { failure: TurnFailureView } = $props();

  const line = $derived(
    failure.kind === 'ledger'
      ? `The progress rail didn't update — ${failure.reason}.`
      : `${failure.displayName ?? 'Ellie'} couldn't reply — ${failure.reason}.`,
  );
</script>

<div class="failed" role="status">
  <span class="mark" aria-hidden="true">!</span>
  <p>{line}</p>
  <button type="button" onclick={() => store.retryTurn(failure.id)}>Retry</button>
</div>

<style>
  .failed {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 10px 0 10px 26px;
    padding: 7px 11px;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius);
    background: var(--pane);
  }
  .mark {
    flex: none;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--hairline);
    color: var(--muted);
    font-size: 10px;
    line-height: 13px;
    text-align: center;
  }
  p {
    margin: 0;
    flex: 1;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--muted);
  }
  button {
    flex: none;
    font-size: 11px;
    color: var(--indigo);
    padding: 2px 8px;
    border: 1px solid var(--hairline);
    border-radius: 4px;
  }
  button:hover { border-color: var(--indigo); }
</style>
