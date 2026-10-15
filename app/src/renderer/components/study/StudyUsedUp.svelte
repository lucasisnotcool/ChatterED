<script lang="ts">
  /**
   * The sheet that says the study credit has run out, the moment it does. A failed turn alone
   * would read as a bug; this says what happened and what the participant can do next.
   */
  import { store } from '../../lib/store.svelte.js';
  import { study } from '../../lib/studystore.svelte.js';
  import { TRIAL_CONTACT_EMAIL } from '../../../shared/trial.js';
  import { usd } from '../../../shared/study.js';

  function toSettings(): void {
    study.usedUpDismissed = true;
    void store.openSettings();
  }
</script>

{#if study.usedUpOpen}
  <div class="scrim">
    <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="study-out-title">
      <h2 id="study-out-title">Your study credit is used up</h2>
      <p>
        You have used the {usd(study.status.budgetUsd)} of API credit the study provides. Thank you for
        using ChatterED this much.
      </p>
      <p>
        To keep going, add your own API key (Anthropic, OpenAI or Google Gemini) in Settings. Your
        notebooks and progress stay as they are.
      </p>
      <p class="quiet">
        Either way, please still send your research data at the end of the study (File ▸ Export
        Research Data…). Questions: {TRIAL_CONTACT_EMAIL}.
      </p>
      <div class="actions">
        <button type="button" class="btn" onclick={() => (study.usedUpDismissed = true)}>Close</button>
        <button type="button" class="btn-primary" onclick={toSettings}>Open Settings</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(27, 27, 34, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    z-index: 60;
  }
  .sheet {
    width: min(480px, 100%);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 20px 22px 18px;
  }
  h2 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.6; }
  .quiet { color: var(--text-2); font-size: 12px; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
</style>
