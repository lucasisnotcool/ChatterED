<script lang="ts">
  /**
   * Settings ▸ Research trial: the participant ID, when the notice was agreed to, the notice
   * itself, and what an export would contain right now — then the button that makes one.
   */
  import { TRIAL_CONTACT_EMAIL } from '../../shared/trial.js';
  import { trial } from '../lib/trialstore.svelte.js';

  $effect(() => {
    void trial.loadSummary();
  });

  const s = $derived(trial.summary);

  function size(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} KB`;
  }

  function plural(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
  }
</script>

<section>
  <h2>Research trial</h2>
  <p>
    Participant ID <strong class="pid">{trial.status?.participantId ?? '—'}</strong>
    {#if trial.status?.consentedAt}
      <span class="quiet">· agreed {new Date(trial.status.consentedAt).toLocaleString()} (notice v{trial.status.consentedVersion})</span>
    {/if}
  </p>
  <p class="quiet">
    Nothing is sent automatically. An export is one .zip file that you email to {TRIAL_CONTACT_EMAIL}
    yourself; your username and folder paths are removed from it, and your lecture PDFs are never in it.
    <button type="button" class="btn-link" onclick={() => (trial.noticeOpen = true)}>View notice</button>
  </p>
  {#if s}
    <p class="quiet">
      An export now would contain {plural(s.rooms, 'conversation')}, {plural(s.messages, 'message')},
      {plural(s.privateTurns, 'private-chat turn')}, {plural(s.notesDocs, 'notes document')},
      {plural(s.objectiveStates, 'objective record')}, {plural(s.usageRows, 'AI call')} and
      {plural(s.events, 'logged event')} — a {size(s.databaseBytes)} database — plus
      {plural(s.logFiles, 'log file')} ({size(s.logBytes)}).
    </p>
  {/if}
  <div class="acts">
    <button type="button" class="btn" disabled={trial.exporting} onclick={() => void trial.exportData()}>
      {trial.exporting ? (trial.progress?.label ?? 'Exporting…') : 'Export Research Data…'}
    </button>
  </div>
</section>

<style>
  /* The section frame matches Settings.svelte's own; its styles are scoped to that file. */
  section {
    max-width: 68ch;
    padding: 18px 20px;
    margin-bottom: 16px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  h2 { margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.7; }
  .quiet { color: var(--text-2); font-size: 12px; }
  .pid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .acts { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
</style>
