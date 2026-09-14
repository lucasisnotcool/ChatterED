<script lang="ts">
  /**
   * First run: three cards in the main window (product-design.md §B7, adapted — this build
   * carries a backend card, because the study partners can run on the copy of Claude Code
   * already installed on this Mac and only fall back to a key if it cannot, issue #19).
   */
  import { bridge } from '../lib/bridge.js';
  import { store } from '../lib/store.svelte.js';

  let card = $state(1);
  let key = $state('');
  let saving = $state(false);
  let keyError = $state<string | null>(null);
  let folder = $state<string | null>(null);
  let checking = $state(false);
  let showKeyField = $state(false);

  const cli = $derived(store.settings?.cli ?? store.boot?.cli ?? null);
  const cliReady = $derived(cli?.found === true && cli.loggedIn === true);

  /** Runs when the learner reaches card 2, so the 1–2 s probe overlaps with reading card 1. */
  async function checkCli(): Promise<void> {
    if (checking) return;
    checking = true;
    await store.checkCli(true);
    checking = false;
    showKeyField = !(store.settings?.cli.found && store.settings.cli.loggedIn);
  }

  function toCard(n: number): void {
    card = n;
    if (n === 2) void checkCli();
  }

  async function saveKey(): Promise<void> {
    if (!key.trim()) return;
    saving = true;
    keyError = null;
    const result = await bridge().setApiKey(key.trim());
    saving = false;
    if (result.ok) {
      key = '';
      if (store.boot) store.boot.hasApiKey = true;
      await store.refreshBoot();
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
        <button type="button" class="btn-primary" onclick={() => toCard(2)}>Next</button>
      </div>
    {:else if card === 2}
      <h1>Who answers</h1>
      {#if checking}
        <p class="quiet">Looking for Claude Code on this Mac…</p>
      {:else if cliReady}
        <p>
          Found Claude Code on this Mac, signed in. The study partners will run on it — nothing to
          set up, no API key, and nothing billed per message.
        </p>
        <p class="quiet">You can change the models, or switch to an API key, in Settings.</p>
      {:else if cli?.found}
        <p>
          Claude Code is installed here but not signed in. Open Terminal, run <code>claude</code>
          once and sign in — then come back and check again.
        </p>
      {:else}
        <p>
          Claude Code was not found on this Mac. You can install it, or give ChatterED an
          Anthropic API key instead.
        </p>
      {/if}

      {#if !cliReady && !checking}
        <div class="acts">
          <button type="button" class="btn" onclick={() => void checkCli()}>Check again</button>
          <button type="button" class="btn-link" onclick={() => (showKeyField = true)}>Use an API key</button>
        </div>
      {/if}

      {#if showKeyField && !cliReady}
        <p class="quiet">
          Stored in a file only your user account can read:
          <code>~/Library/Application&nbsp;Support/ChatterED/anthropic-api-key</code>. Not needed if
          Claude Code is installed.
        </p>
        <label class="field">
          <span>API key</span>
          <input type="password" bind:value={key} placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
        </label>
        {#if keyError}<p class="err">{keyError}</p>{/if}
      {/if}

      <div class="acts">
        {#if showKeyField && !cliReady}
          <button type="button" class="btn-primary" onclick={() => void saveKey()} disabled={!key.trim() || saving}>
            Save the key
          </button>
        {:else}
          <button type="button" class="btn-primary" onclick={() => toCard(3)} disabled={checking}>Next</button>
        {/if}
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
  code { font-size: 11px; background: var(--ground); padding: 1px 5px; border-radius: 4px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-2); margin: 16px 0 6px; }
  .field input {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 9px 11px;
    font-size: 13px;
  }
  .acts { display: flex; align-items: center; gap: 16px; margin-top: 22px; }
</style>
