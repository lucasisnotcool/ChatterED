<script lang="ts">
  /**
   * **The consent gate.** Full window, before anything else — first run included. Nothing behind
   * it is rendered, and the main process refuses every other channel until it is agreed to
   * (`src/main/research/consent.ts`). A new `CONSENT_VERSION` brings it back.
   */
  import {
    CONSENT_AGREE,
    CONSENT_CHECKBOX,
    CONSENT_QUIT,
    NOTICE_TITLE,
  } from '../../shared/trial.js';
  import { trial } from '../lib/trialstore.svelte.js';
  import ResearchTrialNotice from './ResearchTrialNotice.svelte';

  let agreed = $state(false);
  const renewed = $derived(trial.status?.consentedVersion != null);
</script>

<div class="gate">
  <div class="drag" aria-hidden="true"></div>
  {#if trial.gate === 'loading'}
    <div class="center"><span class="quiet">Opening…</span></div>
  {:else if trial.gate === 'error'}
    <div class="center">
      <div class="card small">
        <p>ChatterED could not read its trial settings.</p>
        <p class="quiet">{trial.loadError}</p>
        <div class="acts">
          <button type="button" class="btn" onclick={() => void trial.quit()}>{CONSENT_QUIT}</button>
          <button type="button" class="btn-primary" onclick={() => void trial.load()}>Try again</button>
        </div>
      </div>
    </div>
  {:else}
    <div class="scroll">
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="trial-title">
        <p class="kicker">Experimental trial{renewed ? ' · the notice has changed' : ''}</p>
        <h1 id="trial-title">{NOTICE_TITLE}</h1>
        {#if renewed}
          <p class="quiet">
            This notice has been updated since you last agreed to it. Please read it again before you
            continue.
          </p>
        {/if}
        <ResearchTrialNotice />
        <label class="check">
          <input type="checkbox" bind:checked={agreed} />
          <span>{CONSENT_CHECKBOX}</span>
        </label>
        <div class="acts">
          <button type="button" class="btn" onclick={() => void trial.quit()}>{CONSENT_QUIT}</button>
          <button
            type="button"
            class="btn-primary"
            disabled={!agreed || trial.accepting}
            onclick={() => void trial.accept()}
          >
            {CONSENT_AGREE}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .gate { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--ground); }
  /* The title bar is not drawn behind the gate, so this strip is the window's drag handle and
     the room the traffic lights sit in. */
  .drag { flex: none; height: 38px; -webkit-app-region: drag; }
  .center { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .scroll { flex: 1; overflow-y: auto; padding: 8px 24px 40px; display: flex; justify-content: center; }
  .card {
    width: min(640px, 100%);
    align-self: flex-start;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 26px 32px 24px;
  }
  .card.small { width: min(440px, 100%); align-self: center; }
  .kicker {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--indigo);
  }
  h1 { margin: 0 0 12px; font-size: 17px; font-weight: 600; }
  p { margin: 0 0 12px; font-size: 13px; line-height: 1.65; }
  .quiet { color: var(--text-2); }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 20px 0 0;
    padding: 12px 14px;
    background: var(--indigo-tint);
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .check input { margin-top: 3px; }
  .acts { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 18px; }
</style>
