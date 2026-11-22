<script lang="ts">
  /**
   * The always-visible "Experimental trial" label in the title bar. Opens the notice. Quiet on
   * purpose: it is a standing reminder, not an alert. A grader copy (`shared/grader.ts`) says so.
   */
  import { GRADER_BADGE } from '../../shared/grader.js';
  import { trial } from '../lib/trialstore.svelte.js';
</script>

{#if trial.status?.grader}
  <button type="button" class="badge no-drag" title="What this copy sends, and where" onclick={() => (trial.noticeOpen = true)}>
    {GRADER_BADGE}
  </button>
{:else}
<button
  type="button"
  class="badge no-drag"
  title={trial.status?.participantId ? `Participant ${trial.status.participantId} — what this trial shares` : 'What this trial shares'}
  onclick={() => (trial.noticeOpen = true)}
>
  Experimental trial
</button>
{/if}

<style>
  .badge {
    flex: none;
    margin-right: 10px;
    padding: 2px 8px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--text-2);
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }
  .badge:hover { color: var(--indigo); border-color: var(--indigo); }
</style>
