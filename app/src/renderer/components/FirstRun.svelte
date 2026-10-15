<script lang="ts">
  /**
   * First run: three cards in the main window (product-design.md §B7, adapted — this build
   * carries a backend card, because the study partners can run on the copy of Claude Code
   * already installed on this Mac and only fall back to a key if it cannot, issue #19).
   *
   * Card 1 describes notebooks and the learning overview (#58, `docs/research/notebooks.md` §0),
   * and card 3 says how a notebook starts. It used to open a folder vault; notebooks replaced it,
   * so there is nothing to pick here any more and the card only explains.
   */
  import { bridge } from '../lib/bridge.js';
  import { store } from '../lib/store.svelte.js';
  import type { ApiProvider } from '../../shared/types.js';
  import { study } from '../lib/studystore.svelte.js';
  import { usd } from '../../shared/study.js';
  import StudyUnlock from './study/StudyUnlock.svelte';

  let card = $state(1);
  let key = $state('');
  let saving = $state(false);
  let keyError = $state<string | null>(null);
  let checking = $state(false);
  let showKeyField = $state(false);
  /**
   * BYOK (2026-09-25): which provider the key is for. The compatible endpoint needs a URL and
   * model ids as well as a key, so it is set up in Settings rather than squeezed onto this card.
   */
  let provider = $state<ApiProvider>('anthropic');
  const KEY_PROVIDERS: { id: ApiProvider; label: string; placeholder: string; file: string }[] = [
    { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-…', file: 'anthropic-api-key' },
    { id: 'openai', label: 'OpenAI', placeholder: 'sk-… or sk-proj-…', file: 'openai-api-key' },
    { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…', file: 'gemini-api-key' },
  ];
  const chosen = $derived(KEY_PROVIDERS.find((p) => p.id === provider) ?? KEY_PROVIDERS[0]!);

  /**
   * **A study build asks for the study code here instead** (`shared/study.ts`). Claude Code is
   * not offered and the scripted demo is not offered: a participant who skips past the code should
   * not end up on canned replies without knowing it. Bringing their own key stays possible.
   */
  let ownKey = $state(false);
  const studyCard = $derived(study.status.available && !ownKey);

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
    if (n === 2 && !studyCard) void checkCli();
  }

  async function saveKey(): Promise<void> {
    if (!key.trim()) return;
    saving = true;
    keyError = null;
    const result = await bridge().setProviderKey({ provider, key: key.trim() });
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
</script>

<div class="screen">
  <section class="card">
    <span class="steps" aria-label="Step {card} of 3">
      {#each [1, 2, 3] as n (n)}<span class="pip" class:on={n === card}></span>{/each}
    </span>

    {#if card === 1}
      <h1>What this is</h1>
      <p>
        Add your lecture slides and notes to a <strong>notebook</strong>, and ChatterED writes a short
        <strong>learning overview</strong> of them: a few minutes to read, every line citing the slide
        it came from. You build the full notes from it, line by line.
      </p>
      <p>
        Two study partners work in the notes beside you. <strong>Ellie</strong> explains: press
        Explain or Example on any line, or ask her, and you get the full answer in the chat and one
        line worth keeping in the notes. <strong>Max</strong> tests you when you press Quiz me, one
        question at a time, and it is yours to answer first. Stuck? Say so, and he gives you the
        answer and makes the next question easier.
      </p>
      <p>
        You can edit anything. Nothing you write is ever overwritten: if Ellie or Max want to change
        your words, it comes as a suggestion you accept or reject.
      </p>
      <p class="quiet">
        The progress bar fills only on your own words, in the chat or in the notes. Agreeing with Max
        never moves it.
      </p>
      <div class="acts">
        <button type="button" class="btn-primary" onclick={() => toCard(2)}>Next</button>
      </div>
    {:else if card === 2 && studyCard}
      <h1>Your study code</h1>
      {#if study.status.unlocked}
        <p>
          Unlocked. Ellie and Max run on the study's API credit: {usd(study.status.budgetUsd)}, paid by the
          study. What is left is always shown at the top right.
        </p>
        <div class="acts">
          <button type="button" class="btn-primary" onclick={() => toCard(3)}>Next</button>
        </div>
      {:else}
        <p>
          Enter the code you were sent with this download. It unlocks the API credit the study provides,
          so Ellie and Max can answer. Nothing is billed to you.
        </p>
        <StudyUnlock onunlocked={() => toCard(3)} />
        <div class="acts">
          <button type="button" class="btn-link" onclick={() => { ownKey = true; void checkCli(); }}>
            I'll use my own API key instead
          </button>
        </div>
      {/if}
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
          Claude Code was not found on this Mac. You can install it — that is the recommended
          way — or give ChatterED your own API key (Anthropic, OpenAI or Google Gemini) instead.
        </p>
      {/if}

      {#if !cliReady && !checking}
        <div class="acts">
          <button type="button" class="btn" onclick={() => void checkCli()}>Check again</button>
          <button type="button" class="btn-link" onclick={() => (showKeyField = true)}>Use an API key</button>
        </div>
      {/if}

      {#if showKeyField && !cliReady}
        <label class="field">
          <span>Provider</span>
          <select bind:value={provider}>
            {#each KEY_PROVIDERS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
          </select>
        </label>
        <p class="quiet">
          Stored in a file only your user account can read:
          <code>~/Library/Application&nbsp;Support/ChatterED/{chosen.file}</code>, and sent only to
          {chosen.label}. Billed to you by {chosen.label}. Not needed if Claude Code is installed. An
          OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio…) is set up in Settings.
        </p>
        <label class="field">
          <span>API key</span>
          <input type="password" bind:value={key} placeholder={chosen.placeholder} autocomplete="off" spellcheck="false" />
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
        {#if ownKey}
          <button type="button" class="btn-link" onclick={() => (ownKey = false)}>Back to the study code</button>
        {:else}
          <button type="button" class="btn-link" onclick={() => void store.completeFirstRun()}>
            Skip — use the scripted demo
          </button>
        {/if}
      </div>
    {:else}
      <h1>Start a notebook</h1>
      <p>
        A notebook is the files for one week or one topic: slides, notes, Word, Markdown, text or
        images. Drop them on the Notebooks screen, or press <strong>New notebook</strong> and pick
        them.
      </p>
      <p class="quiet">
        ChatterED keeps its own copy of each file on this Mac, so moving or deleting the original
        changes nothing. Nothing is uploaded anywhere. Tick which files count, and Ellie, Max and the
        overview read only those.
      </p>
      <div class="acts">
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
  .field input,
  .field select {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 9px 11px;
    font-size: 13px;
  }
  .acts { display: flex; align-items: center; gap: 16px; margin-top: 22px; }
</style>
