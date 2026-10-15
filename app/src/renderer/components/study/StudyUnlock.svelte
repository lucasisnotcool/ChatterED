<script lang="ts">
  /**
   * The study code field: first run's card 2 on a study build, and Settings ▸ Study credit until a
   * code is entered. The code is sent once, to open the participant's sealed key, and never kept.
   */
  import { study } from '../../lib/studystore.svelte.js';

  let { onunlocked }: { onunlocked?: () => void } = $props();

  let code = $state('');

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!code.trim()) return;
    if (await study.unlock(code)) {
      code = '';
      onunlocked?.();
    }
  }
</script>

<form class="unlock" onsubmit={(e) => void submit(e)}>
  <label class="field">
    <span>Study code</span>
    <input
      type="text"
      bind:value={code}
      placeholder="S07-K3QX-9MZT-4HRA"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
    />
  </label>
  {#if study.unlockError}<p class="err">{study.unlockError}</p>{/if}
  <button type="submit" class="btn-primary" disabled={!code.trim() || study.unlocking}>
    {study.unlocking ? 'Checking…' : 'Unlock'}
  </button>
</form>

<style>
  .unlock { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin-top: 4px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-2); width: 100%; }
  .field input {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 9px 11px;
    font-size: 14px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .err { margin: 0; color: var(--text-2); font-size: 12px; max-width: 62ch; }
</style>
