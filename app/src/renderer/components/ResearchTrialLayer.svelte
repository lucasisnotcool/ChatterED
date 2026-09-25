<script lang="ts">
  /**
   * The trial's overlays, mounted once above the screen router: the notice (re-opened from the
   * "Experimental trial" label or Settings), the export's progress, and what came of it.
   */
  import { NOTICE_TITLE, TRIAL_CONTACT_EMAIL } from '../../shared/trial.js';
  import { trial } from '../lib/trialstore.svelte.js';
  import ResearchTrialNotice from './ResearchTrialNotice.svelte';

  function kb(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    if (trial.noticeOpen) trial.noticeOpen = false;
    else if (trial.result) trial.result = null;
    else if (trial.exportError) trial.exportError = null;
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if trial.noticeOpen}
  <div class="scrim">
    <div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="trial-notice-title">
      <h2 id="trial-notice-title">{NOTICE_TITLE}</h2>
      {#if trial.status?.participantId}
        <p class="meta">
          Your participant ID is <strong>{trial.status.participantId}</strong>{#if trial.status.consentedAt}
            · you agreed on {new Date(trial.status.consentedAt).toLocaleDateString()}{/if}.
        </p>
      {/if}
      <div class="body"><ResearchTrialNotice /></div>
      <div class="actions">
        <button type="button" class="btn" onclick={() => (trial.noticeOpen = false)}>Close</button>
        <button
          type="button"
          class="btn-primary"
          onclick={() => {
            trial.noticeOpen = false;
            void trial.exportData();
          }}
        >
          Export Research Data…
        </button>
      </div>
    </div>
  </div>
{/if}

{#if trial.exporting}
  <div class="toast" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span>
    <span>{trial.progress?.label ?? 'Choose where to save the export…'}</span>
  </div>
{/if}

{#if trial.result}
  <div class="scrim">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="trial-done-title">
      <h2 id="trial-done-title">Research data exported</h2>
      <p>
        Saved <strong>{trial.result.fileName}</strong> ({kb(trial.result.bytes)}). It is a zip of readable
        files — open it and look through it before you send it if you like.
      </p>
      <p class="path">{trial.result.path}</p>
      <p class="quiet">
        To take part, email it to {TRIAL_CONTACT_EMAIL}. <strong>Email to the team</strong> opens a new
        message with the subject filled in; your email app cannot attach the file for you, so drag it in
        from Finder.
      </p>
      <div class="actions">
        <button type="button" class="btn" onclick={() => (trial.result = null)}>Close</button>
        <button type="button" class="btn" onclick={() => trial.reveal()}>Reveal in Finder</button>
        <button type="button" class="btn-primary" onclick={() => trial.email()}>Email to the team</button>
      </div>
    </div>
  </div>
{/if}

{#if trial.exportError}
  <div class="scrim">
    <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="trial-err-title">
      <h2 id="trial-err-title">The export did not finish</h2>
      <p class="quiet">{trial.exportError}</p>
      <p class="quiet">Nothing was sent anywhere. You can try again from File ▸ Export Research Data….</p>
      <div class="actions">
        <button type="button" class="btn-primary" onclick={() => (trial.exportError = null)}>OK</button>
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
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 20px 22px 18px;
  }
  .sheet.wide { width: min(620px, 100%); }
  .body { overflow-y: auto; min-height: 0; margin: 0 0 16px; padding-right: 4px; }
  h2 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.6; }
  .meta { font-size: 12px; color: var(--text-2); }
  .quiet { color: var(--text-2); font-size: 12px; }
  .path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    background: var(--ground);
    padding: 6px 8px;
    border-radius: 6px;
    word-break: break-all;
  }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .toast {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 55;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(27, 27, 34, 0.08);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    border-top-color: var(--indigo);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
