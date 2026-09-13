<script lang="ts">
  /**
   * First run: three cards in the main window (product-design.md §B7, adapted —
   * this build carries an API-key card because each user brings their own key).
   */
  import { bridge } from '../lib/bridge.js';
  import { store } from '../lib/store.svelte.js';

  let card = $state(1);
  let key = $state('');
  let saving = $state(false);
  let keyError = $state<string | null>(null);
  let folder = $state<string | null>(null);

  async function saveKey(): Promise<void> {
    if (!key.trim()) return;
    saving = true;
    keyError = null;
    const result = await bridge().setApiKey(key.trim());
    saving = false;
    if (result.ok) {
      key = '';
      if (store.boot) store.boot.hasApiKey = true;
      card = 3;
    } else {
      keyError = result.error ?? "That key didn't work.";
    }
  }

  async function pickFolder(): Promise<void> {
    const picked = await bridge().chooseSlidesFolder();
    if (picked) {
      folder = picked;
      if (store.boot) store.boot.slidesFolder = picked;
    }
  }
</script>

<div class="screen">
  <section class="card">
    <span class="steps" aria-label="Step {card} of 3">
      {#each [1, 2, 3] as n (n)}<span class="pip" class:on={n === card}></span>{/each}
    </span>

    {#if card === 1}
      <h1>What this is</h1>
      <p>
        You explain a lecture concept out loud, in your own words, to a small group. They ask
        questions. They won't answer for you, and they'll disagree with each other sometimes.
      </p>
      <p>
        Replies here are deliberately paced so you get room to think first. You can speed this up
        in Settings.
      </p>
      <p class="quiet">A ledger on the right fills with what you have established, in your words.</p>
      <div class="acts">
        <button type="button" class="btn-primary" onclick={() => (card = 2)}>Next</button>
      </div>
    {:else if card === 2}
      <h1>Your Anthropic API key</h1>
      <p>
        The study partners run on your own key. It is stored in the macOS keychain{store.boot
          ?.keychainAvailable === false
          ? ', if this Mac makes one available'
          : ''} and never written to the database, the transcript or disk.
      </p>
      <label class="field">
        <span>API key</span>
        <input type="password" bind:value={key} placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
      </label>
      {#if keyError}<p class="err">{keyError}</p>{/if}
      <div class="acts">
        <button type="button" class="btn-primary" onclick={() => void saveKey()} disabled={!key.trim() || saving}>
          Save the key
        </button>
        <button type="button" class="btn-link" onclick={() => void store.completeFirstRun()}>
          Skip — use the scripted demo
        </button>
      </div>
    {:else}
      <h1>Choose your slides folder</h1>
      <p>
        ChatterED reads the slides already sitting on your Mac. Nothing is uploaded anywhere you
        didn't put it.
      </p>
      {#if folder}<p class="quiet">{folder}</p>{/if}
      <div class="acts">
        <button type="button" class="btn" onclick={() => void pickFolder()}>Choose a folder…</button>
        <button type="button" class="btn-primary" onclick={() => void store.completeFirstRun()}>Start</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: min(560px, 100%);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 28px 32px 26px;
  }
  .steps { display: flex; gap: 6px; margin-bottom: 18px; }
  .pip { width: 16px; height: 3px; border-radius: 2px; background: var(--hairline); }
  .pip.on { background: var(--indigo); }
  h1 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
  p { margin: 0 0 12px; font-size: 13px; line-height: 1.7; max-width: 62ch; }
  .quiet { color: var(--text-2); }
  .err { color: var(--text-2); font-size: 12px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-2); margin: 16px 0 6px; }
  .field input {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 9px 11px;
    font-size: 13px;
  }
  .acts { display: flex; align-items: center; gap: 16px; margin-top: 22px; }
</style>
