<script lang="ts">
  /**
   * Settings — the backend and the two model choices (issue #19).
   *
   * The organising idea: **say what is actually running, before offering to change it.** The
   * first line of the pane is the resolved backend and, when the learner's choice could not be
   * honoured, why. A dropdown that silently does nothing is the failure mode this avoids.
   */
  import type { BackendChoice } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  // The strip and these radios describe the same setting, so they read the same copy.
  import { PACING_PROFILES, pacingProfile } from '../lib/labels.js';

  const settings = $derived(store.settings);

  const BACKENDS: { value: BackendChoice; label: string; hint: string }[] = [
    { value: 'auto', label: 'Automatic', hint: 'Claude Code if it is logged in, then your API key, then the scripted demo.' },
    { value: 'claude_cli', label: 'Claude Code on this Mac', hint: 'Uses the subscription you are already signed in to. No API key, no per-token cost.' },
    { value: 'anthropic', label: 'Anthropic API key', hint: 'Your own key, billed to you. Haiku 4.5 for the group, Sonnet 5 for the ledger.' },
    { value: 'scripted', label: 'Scripted demo', hint: 'Replays a fixed transcript. No network calls at all.' },
  ];

  const BACKEND_LABEL: Record<string, string> = {
    claude_cli: 'Claude Code on this Mac',
    anthropic: 'Anthropic API key',
    scripted: 'Scripted demo',
  };

  /** The dropdowns only bind the model when the CLI is the live path; the API path is fixed. */
  const cliPath = $derived(settings?.resolvedBackend === 'claude_cli' || settings?.backendChoice === 'claude_cli');

  let customAgent = $state('');
  let customOrchestrator = $state('');
  let pathDraft = $state('');
  let pathDirty = $state(false);

  $effect(() => {
    if (settings && !pathDirty) pathDraft = settings.cliPathOverride ?? '';
  });

  function isChoice(model: string): boolean {
    return (settings?.modelChoices ?? []).includes(model);
  }

  async function setBackend(value: string): Promise<void> {
    await store.saveSettings({ backendChoice: value as BackendChoice });
  }
</script>

<main class="pane">
  <header>
    <h1>Settings</h1>
    <p class="quiet">ChatterED {settings?.appVersion ?? ''}</p>
  </header>

  {#if !settings}
    <p class="quiet">Loading…</p>
  {:else}
    <section>
      <h2>Where the study partners run</h2>

      <p class="status">
        Right now:
        <strong>{BACKEND_LABEL[settings.resolvedBackend] ?? settings.resolvedBackend}</strong>
        {#if settings.resolvedBackend !== 'scripted'}
          · agents on <code>{settings.agentModel}</code>, ledger on <code>{settings.orchestratorModel}</code>
        {/if}
      </p>
      {#if settings.fellBackBecause}
        <p class="warn">{settings.fellBackBecause}</p>
      {/if}

      <div class="choices">
        {#each BACKENDS as b (b.value)}
          <label class="choice" class:on={settings.backendChoice === b.value}>
            <input
              type="radio"
              name="backend"
              value={b.value}
              checked={settings.backendChoice === b.value}
              disabled={store.settingsBusy}
              onchange={() => void setBackend(b.value)}
            />
            <span class="choice-text">
              <span class="choice-label">{b.label}</span>
              <span class="quiet">{b.hint}</span>
            </span>
          </label>
        {/each}
      </div>
    </section>

    <section>
      <h2>Claude Code on this Mac</h2>
      {#if settings.cli.found && settings.cli.loggedIn}
        <p class="ok">Found and signed in — <code>{settings.cli.path}</code></p>
      {:else if settings.cli.found}
        <p class="warn">
          {settings.cli.detail ?? 'Installed but not signed in.'}
          Open Terminal, run <code>claude</code> once and sign in, then check again.
        </p>
      {:else}
        <p class="warn">{settings.cli.detail ?? 'Not found on this Mac.'}</p>
      {/if}

      <label class="field">
        <span>Path to the <code>claude</code> binary (optional)</span>
        <input
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="~/.local/bin/claude"
          bind:value={pathDraft}
          oninput={() => (pathDirty = true)}
        />
      </label>
      <div class="acts">
        <button
          type="button"
          class="btn"
          disabled={store.settingsBusy || !pathDirty}
          onclick={async () => {
            await store.saveSettings({ cliPathOverride: pathDraft });
            pathDirty = false;
            await store.checkCli(true);
          }}
        >
          Save path and check
        </button>
        <button type="button" class="btn" disabled={store.settingsBusy} onclick={() => void store.checkCli(true)}>
          {store.settingsBusy ? 'Checking…' : 'Check again'}
        </button>
        <span class="quiet">Checking asks Claude one short question, so it takes a second or two.</span>
      </div>
    </section>

    <section>
      <h2>Models</h2>
      {#if !cliPath}
        <p class="quiet">
          On the API-key path the models are fixed: Haiku 4.5 for the group turns, Sonnet 5 for the
          orchestrator and the ledger. These two choices apply to Claude Code on this Mac.
        </p>
      {/if}

      <div class="pair">
        <label class="field">
          <span>Agent turns (Ellie and Max)</span>
          <select
            disabled={store.settingsBusy}
            value={isChoice(settings.agentModel) ? settings.agentModel : '__custom'}
            onchange={(e) => {
              const v = e.currentTarget.value;
              if (v !== '__custom') void store.saveSettings({ agentModel: v });
            }}
          >
            {#each settings.modelChoices as m (m)}<option value={m}>{m}</option>{/each}
            <option value="__custom">a specific model id…</option>
          </select>
        </label>

        <label class="field">
          <span>Orchestrator + ledger</span>
          <select
            disabled={store.settingsBusy}
            value={isChoice(settings.orchestratorModel) ? settings.orchestratorModel : '__custom'}
            onchange={(e) => {
              const v = e.currentTarget.value;
              if (v !== '__custom') void store.saveSettings({ orchestratorModel: v });
            }}
          >
            {#each settings.modelChoices as m (m)}<option value={m}>{m}</option>{/each}
            <option value="__custom">a specific model id…</option>
          </select>
        </label>
      </div>

      <div class="pair">
        <label class="field">
          <span>…or a full model id for agent turns</span>
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={settings.agentModel}
            bind:value={customAgent}
            onchange={() => {
              if (customAgent.trim()) void store.saveSettings({ agentModel: customAgent.trim() });
            }}
          />
        </label>
        <label class="field">
          <span>…or a full model id for orchestrator + ledger</span>
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={settings.orchestratorModel}
            bind:value={customOrchestrator}
            onchange={() => {
              if (customOrchestrator.trim()) void store.saveSettings({ orchestratorModel: customOrchestrator.trim() });
            }}
          />
        </label>
      </div>

      {#if store.settingsError}<p class="warn">{store.settingsError}</p>{/if}
      <p class="quiet">A model change applies to the next room you open, not the one already running.</p>
    </section>

    <!-- The Tester's pacing, disclosed. `flow-build-plan.md` §4.2 asks for the demo profile to be
         selectable; §3.5 asks for the pacing to be *disclosed*, which is why this section says
         what each profile actually does instead of naming two modes and leaving it there. -->
    <section>
      <h2>Tester pacing</h2>
      <p class="status">
        Right now: <strong>{settings.flowProfile === 'demo' ? 'Demo' : 'Study'}</strong>
      </p>
      <div class="choices">
        {#each PACING_PROFILES as p (p.value)}
          <label class="choice" class:on={settings.flowProfile === p.value}>
            <input
              type="radio"
              name="flow-profile"
              value={p.value}
              checked={settings.flowProfile === p.value}
              disabled={store.settingsBusy}
              onchange={() => void store.saveSettings({ flowProfile: p.value })}
            />
            <span class="choice-text">
              <span class="choice-label">{p.label}</span>
              <span class="quiet">{p.hint} The Tester is offered the floor after {p.rule}.</span>
            </span>
          </label>
        {/each}
      </div>
      <p class="quiet">
        Neither setting changes what the Tester asks or how long he holds a reply — replies are
        paced at 9–12 seconds on both. It changes only how much of a sitting has to happen before
        he is offered the floor: {pacingProfile(settings.flowProfile).rule}. A change applies to
        the next document you open.
      </p>
      <div class="acts">
        <button
          type="button"
          class="btn"
          disabled={store.settingsBusy || !settings.pacingStripSeen}
          onclick={() => void store.saveSettings({ pacingStripSeen: false })}
        >
          {settings.pacingStripSeen ? 'Show the pacing note again' : 'The pacing note is showing'}
        </button>
        <span class="quiet">It appears once at the top of a document you open.</span>
      </div>
    </section>

    <!-- §B7's "Sources" group, and the answer to "once a document is open there is no way in the
         entire application to change vault" (ui-review-ux.md M5). -->
    <section>
      <h2>Your files</h2>
      {#if store.vault?.rootPath}
        <p class="status">{store.vault.displayName}</p>
        <p class="quiet">{store.vault.rootPath}</p>
        <p class="quiet">
          {store.vault.totalFiles} readable {store.vault.totalFiles === 1 ? 'file' : 'files'} ·
          {store.vault.topics.length} {store.vault.topics.length === 1 ? 'topic' : 'topics'}. ChatterED
          reads them from disk; nothing is uploaded anywhere you didn't put it.
        </p>
      {:else}
        <p class="quiet">No folder opened yet. ChatterED reads the course material already on this Mac.</p>
      {/if}
      <div class="acts">
        <button type="button" class="btn" disabled={store.vaultBusy} onclick={() => void store.chooseVault()}>
          {store.vaultBusy ? 'Reading…' : store.vault?.rootPath ? 'Change vault…' : 'Open a folder…'}
        </button>
        {#if store.vault?.rootPath}
          <button type="button" class="btn" disabled={store.vaultBusy} onclick={() => void store.rescanVault()}>
            Re-scan
          </button>
          <button type="button" class="btn-link" onclick={() => void store.openTopicSheet()}>Edit topics…</button>
        {/if}
      </div>
    </section>

    <section>
      <h2>Anthropic API key</h2>
      <p class="quiet">
        {settings.hasApiKey
          ? 'A key is stored in a file only your user account can read: ~/Library/Application Support/ChatterED/anthropic-api-key. Not needed if Claude Code is installed.'
          : 'No key stored. A key you enter is stored in a file only your user account can read: ~/Library/Application Support/ChatterED/anthropic-api-key. Not needed if Claude Code is installed.'}
      </p>
      {#if settings.hasApiKey}
        <div class="acts">
          <button
            type="button"
            class="btn"
            disabled={store.settingsBusy}
            onclick={async () => {
              await store.saveSettings({});
              await store.loadSettings();
            }}
          >
            Refresh
          </button>
        </div>
      {/if}
    </section>

    <!--
      Diagnostics. Not a debug affordance for me: this is the two things a learner can do when
      the app misbehaves during a study session and there is nobody to ask. The log is JSON lines
      at ~/Library/Logs/ChatterED/main.log, and it has been redacted on the way in — no message
      bodies, no prompts, no key — so **Copy diagnostics** is safe to paste anywhere.
    -->
    <section>
      <h2>Diagnostics</h2>
      <p class="quiet">
        ChatterED keeps a log of every turn — which model answered, how long it took, and what
        failed — at ~/Library/Logs/ChatterED/main.log. It records sizes and timings, never what
        you or the agents wrote.
      </p>
      <div class="acts">
        <button type="button" class="btn" onclick={() => void store.openLogFolder()}>Open log folder</button>
        <button type="button" class="btn" onclick={() => void store.copyDiagnostics()}>
          {store.diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}
        </button>
      </div>
    </section>
  {/if}
</main>

<style>
  .pane { flex: 1; overflow-y: auto; padding: 28px 32px 60px; min-width: 0; }
  header { margin-bottom: 22px; }
  h1 { margin: 0 0 2px; font-size: 16px; font-weight: 600; }
  h2 { margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
  section {
    max-width: 68ch;
    padding: 18px 20px;
    margin-bottom: 16px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.7; }
  .quiet { color: var(--text-2); font-size: 12px; }
  .warn { color: var(--text-2); font-size: 12px; }
  .ok { color: var(--text-2); font-size: 12px; }
  .status { font-size: 13px; }
  code { font-size: 11px; background: var(--ground); padding: 1px 5px; border-radius: 4px; }

  .choices { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; }
  .choice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .choice:hover { background: var(--ground); }
  .choice.on { background: #eaeaf4; }
  .choice input { margin-top: 3px; }
  .choice-text { display: flex; flex-direction: column; gap: 2px; }
  .choice-label { font-size: 13px; }

  .pair { display: flex; gap: 16px; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-2); margin: 12px 0 4px; flex: 1 1 260px; }
  .field input,
  .field select {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 8px 10px;
    font-size: 13px;
    background: var(--pane);
  }
  .acts { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
</style>
