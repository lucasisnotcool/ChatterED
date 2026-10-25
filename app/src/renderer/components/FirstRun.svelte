<script lang="ts">
  /**
   * First run: three cards in the main window (product-design.md §B7, adapted — this build
   * carries a backend card, because the study partners can run on the copy of Claude Code
   * already installed on this Mac and only fall back to a key if it cannot, issue #19).
   *
   * Card 1 describes notebooks and the learning overview (#58, `docs/research/notebooks.md` §0).
   * **Card 3 starts with a tutorial** (2026-10-25): the learner picks or drops a tutorial sheet,
   * and its lecture deck if they have it, and lands in a notebook with the sheet as the main view,
   * so the first thing they do is attempt part 1 (`store.startFromTutorial`). Skipping it goes to
   * the Notebooks home as before. A preloaded study copy has nothing to unlock and opens on card 3
   * itself, so a participant goes from the consent notice straight to adding their sheet.
   */
  import { bridge } from '../lib/bridge.js';
  import { store } from '../lib/store.svelte.js';
  import type { ApiProvider } from '../../shared/types.js';
  import { study } from '../lib/studystore.svelte.js';
  import { usd } from '../../shared/study.js';
  import StudyUnlock from './study/StudyUnlock.svelte';
  import { createFileDrop, filesToPaths, noPathNotice } from '../lib/dropguard.js';

  // A preloaded copy is unlocked in main before the window opens, and `study.load()` runs before
  // first run mounts, so this reads the settled status.
  let card = $state(study.status.available && study.status.unlocked ? 3 : 1);
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

  /** A preloaded copy (`release.sh --preload`) is unlocked before first run: no card 2 to show. */
  const preloaded = $derived(study.status.available && study.status.unlocked && !ownKey);

  function toCard(n: number): void {
    if (n === 2 && preloaded) n = 3;
    card = n;
    if (n === 2 && !studyCard) void checkCli();
  }

  // ── Card 3: the tutorial, and the lecture deck that goes with it ──
  let tutorialPath = $state<string | null>(null);
  let lecturePath = $state<string | null>(null);
  let starting = $state(false);
  let overSlot = $state<'tutorial' | 'lecture' | null>(null);
  const baseName = (p: string): string => p.split('/').pop() ?? p;

  function slotDrop(slot: 'tutorial' | 'lecture') {
    return createFileDrop<File>({
      onover: (o) => (overSlot = o ? slot : overSlot === slot ? null : overSlot),
      ondrop: (files) => {
        const { paths, refused } = filesToPaths(files, (f) => bridge().pathForFile(f));
        store.notebook.say(noPathNotice(refused));
        if (paths[0]) setSlot(slot, paths[0]);
      },
    });
  }
  const tutorialDrop = slotDrop('tutorial');
  const lectureDrop = slotDrop('lecture');

  function setSlot(slot: 'tutorial' | 'lecture', path: string): void {
    if (slot === 'tutorial') tutorialPath = path;
    else lecturePath = path;
  }

  async function pickInto(slot: 'tutorial' | 'lecture'): Promise<void> {
    try {
      const picked = (await bridge().notebookPickFiles()).paths;
      if (picked[0]) setSlot(slot, picked[0]);
    } catch {
      // The picker failed to open; the slot stays as it was and a drop still works.
    }
  }

  async function startTutorial(): Promise<void> {
    if (!tutorialPath || starting) return;
    starting = true;
    const ok = await store.startFromTutorial(tutorialPath, lecturePath);
    if (!ok) starting = false;
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
    {#if !preloaded}
      <span class="steps" aria-label="Step {card} of 3">
        {#each [1, 2, 3] as n (n)}<span class="pip" class:on={n === card}></span>{/each}
      </span>
    {/if}

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
      <h1>Start with a tutorial</h1>
      <p>
        Add this week's tutorial sheet. If you have the lecture slides it goes with, add them too:
        Ellie and Max then answer from the lecture. The sheet opens with an answer slot under every
        part, and help is beside each one.
      </p>
      {#if preloaded}
        <p class="quiet">
          Two study partners work beside you: <strong>Ellie</strong> explains from the lecture, and
          <strong>Max</strong> gives hints, checks your answers, and quizzes you. Their API credit is
          paid by the study ({usd(study.status.budgetUsd)}); what is left is always shown at the top
          right.
        </p>
      {/if}

      <div class="slots">
        {#each [{ slot: 'tutorial', label: 'Tutorial sheet', hint: 'PDF, Word or an image', path: tutorialPath, drop: tutorialDrop }, { slot: 'lecture', label: 'Lecture slides (optional)', hint: 'the deck this tutorial is on', path: lecturePath, drop: lectureDrop }] as s (s.slot)}
          <button
            type="button"
            class="slot"
            class:filled={s.path !== null}
            class:over={overSlot === s.slot}
            data-dropzone
            disabled={starting}
            onclick={() => void pickInto(s.slot as 'tutorial' | 'lecture')}
            ondragenter={s.drop.dragenter}
            ondragover={s.drop.dragover}
            ondragleave={s.drop.dragleave}
            ondrop={s.drop.drop}
          >
            <span class="slot-label">{s.label}</span>
            {#if s.path}
              <span class="slot-file">{baseName(s.path)}</span>
              <span class="quiet slot-hint">Click to choose another</span>
            {:else}
              <span class="quiet slot-hint">Drop it here, or click to choose · {s.hint}</span>
            {/if}
          </button>
        {/each}
      </div>
      <p class="quiet">
        ChatterED keeps its own copy of each file on this Mac; nothing is uploaded anywhere. Max
        reads the sheet first, which takes a minute or two.
      </p>
      <div class="acts">
        <button type="button" class="btn-primary" onclick={() => void startTutorial()} disabled={!tutorialPath || starting}>
          {starting ? 'Opening…' : 'Open the tutorial'}
        </button>
        <button type="button" class="btn-link" disabled={starting} onclick={() => void store.completeFirstRun()}>
          Skip — I'll add files later
        </button>
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
  .slots { display: flex; flex-direction: column; gap: 10px; margin: 16px 0 12px; }
  .slot {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    text-align: left;
    padding: 12px 14px;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius);
    background: var(--ground);
    font: inherit;
    cursor: pointer;
  }
  .slot.filled { border-style: solid; background: var(--pane); }
  .slot.over { border-color: var(--indigo); }
  .slot:disabled { cursor: default; opacity: 0.7; }
  .slot-label { font-size: 13px; font-weight: 600; }
  .slot-file { font-size: 13px; }
  .slot-hint { font-size: 12px; }
</style>
