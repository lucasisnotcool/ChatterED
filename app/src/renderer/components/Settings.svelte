<script lang="ts">
  /**
   * Settings — the backend and the two model choices (issue #19).
   *
   * The organising idea: **say what is actually running, before offering to change it.** The
   * first line of the pane is the resolved backend and, when the learner's choice could not be
   * honoured, why. A dropdown that silently does nothing is the failure mode this avoids.
   */
  import type { BackendChoice, ReplySpeed } from '../../shared/types.js';
  import { REPLY_SPEEDS, REPLY_SPEED_NOTE } from '../lib/flowchat.js';
  import { store } from '../lib/store.svelte.js';
  // The strip and these radios describe the same setting, so they read the same copy.
  import { PACING_PROFILES, pacingProfile } from '../lib/labels.js';
  import {
    counterLine,
    counterTitle,
    csvFilename,
    tokensLabel,
    usdWithLabel,
    validateRateCard,
    windowLine,
  } from '../lib/cost.js';
  import { COST_SCOPE_LABEL, totalTokens, type CostScope, type CostSlice } from '../../shared/cost.js';
  import ResearchTrialSettings from './ResearchTrialSettings.svelte';
  import ProviderKeys from './settings/ProviderKeys.svelte';

  const settings = $derived(store.settings);

  const BACKENDS: { value: BackendChoice; label: string; hint: string }[] = [
    {
      value: 'auto',
      label: 'Automatic (recommended)',
      hint: 'Claude Code if it is signed in; otherwise your preferred API provider, then the first one with a key; otherwise the scripted demo.',
    },
    { value: 'claude_cli', label: 'Claude Code on this Mac', hint: 'Recommended. Uses the subscription you are already signed in to. No API key, no per-token cost.' },
    { value: 'anthropic', label: 'Anthropic API key', hint: 'Your own key, billed to you. Haiku 4.5 for the group, Sonnet 5 for the ledger, unless you change them below.' },
    { value: 'openai', label: 'OpenAI API key', hint: 'Your own key, billed to you. Models are set under Your own API keys.' },
    { value: 'gemini', label: 'Google Gemini API key', hint: 'Your own AI Studio key, billed to you. Models are set under Your own API keys.' },
    {
      value: 'openai_compatible',
      label: 'OpenAI-compatible endpoint',
      hint: 'OpenRouter, Ollama, LM Studio, Groq, DeepSeek, vLLM… at a base URL you give it.',
    },
    { value: 'scripted', label: 'Scripted demo', hint: 'Replays a fixed transcript. No network calls at all.' },
  ];

  const BACKEND_LABEL: Record<string, string> = {
    claude_cli: 'Claude Code on this Mac',
    anthropic: 'Anthropic API key',
    openai: 'OpenAI API key',
    gemini: 'Google Gemini API key',
    openai_compatible: 'OpenAI-compatible endpoint',
    scripted: 'Scripted demo',
  };

  /**
   * **Why this backend, in one sentence.** The first line says *what* is running; this says why,
   * because an Automatic choice that landed on a paid API key is the case a learner must not have
   * to work out for themselves.
   */
  const whyLine = $derived.by(() => {
    if (!settings) return '';
    const kind = settings.resolvedBackend;
    if (kind === 'claude_cli') return 'Claude Code is signed in on this Mac — the recommended default.';
    if (settings.backendChoice !== 'auto') return settings.fellBackBecause ? '' : 'You chose it above.';
    const cliState = settings.cli.found ? 'is not signed in' : 'was not found on this Mac';
    if (kind === 'scripted') return `Claude Code ${cliState} and no API provider is set up, so the scripted demo is running.`;
    const how = settings.preferredProvider === kind ? 'your preferred API provider' : 'the first API provider with a key';
    return `Claude Code ${cliState}, so Automatic is using ${how}. Calls are billed to your key.`;
  });

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

  // ── Usage (issue #41 item 4c) ───────────────────────────────────────────
  const allTime = $derived(store.costApp);
  const session = $derived(store.costSession);
  /** The window is only meaningful on the CLI path, and `cost:summary` only sends one there. */
  const burn = $derived(windowLine(allTime?.cliWindow ?? null, allTime?.mode ?? 'none'));

  /** A slice's own line. Same units and the same hedge as every other counter in the app. */
  function sliceLine(slice: CostSlice, mode: typeof allTimeMode): string {
    const tokens = `${tokensLabel(totalTokens(slice.tokens))} tokens`;
    const calls = `${slice.calls} call${slice.calls === 1 ? '' : 's'}`;
    const money = usdWithLabel(slice.estimatedUsd, mode);
    return money.length === 0 ? `${tokens} · ${calls}` : `${tokens} · ${money} · ${calls}`;
  }
  const allTimeMode = $derived(allTime?.mode ?? 'none');
  function scopeWord(key: string): string {
    return COST_SCOPE_LABEL[key as CostScope] ?? key;
  }

  let exporting = $state(false);
  let exported = $state('');

  /**
   * **Export CSV.** Written through a Blob and an `<a download>` rather than a main-process save
   * dialog, because the dialog belongs to `cost:export` and this path has to work without it.
   * The object URL is revoked on the next tick — an un-revoked one pins the whole CSV in memory
   * for the life of the window, which for an all-time export is not nothing.
   */
  async function exportCsv(): Promise<void> {
    exporting = true;
    const csv = await store.exportCost();
    exporting = false;
    if (csv === null) {
      exported = 'Nothing to export yet.';
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    exported = `Saved ${a.download}`;
  }

  let rateDraft = $state('');
  let rateTouched = $state(false);
  const rateCheck = $derived(validateRateCard(rateDraft));
  /**
   * The override travels as a settings row (`main/cost/rates.ts` `parseRateCardOverride`). The
   * field is not on `SettingsPatch` yet — the cost ledger is on the main-process track — so it is
   * sent as an extra key, the same way `objectiveId` rides on `flow:askHere`, and a main process
   * that does not read it yet simply ignores it. The cast is the one line that changes when the
   * contract catches up.
   */
  async function saveRateCard(): Promise<void> {
    if (!rateCheck.ok) return;
    await store.saveSettings({ rateCardOverride: rateDraft.trim() } as never);
    rateTouched = false;
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
      {#if whyLine}<p class="quiet">{whyLine}</p>{/if}
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
          These two choices apply to Claude Code on this Mac. Each API provider has its own two,
          under Your own API keys below.
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

    <!--
      **Reply speed (cui-standards-audit.md §9).** `design-brief.md` §D4 and
      `product-design.md` §C3 both promise this control and neither shipped it, while
      `latency_scale` sat plumbed all the way through `latencyTargetMs`. §C3's own closing
      argument is that a paced system the learner cannot un-pace is a dark pattern — so this is
      the setting that retires an ethics risk rather than adding a feature, and the disclosure
      lives on the options themselves.
    -->
    <section>
      <h2>Reply speed</h2>
      <div class="choices">
        {#each REPLY_SPEEDS as r (r.value)}
          <label class="choice" class:on={settings.replySpeed === r.value}>
            <input
              type="radio"
              name="reply-speed"
              value={r.value}
              checked={settings.replySpeed === r.value}
              disabled={store.settingsBusy}
              onchange={() => void store.saveSettings({ replySpeed: r.value as ReplySpeed })}
            />
            <span class="choice-text">
              <span class="choice-label">{r.label}</span>
              <span class="quiet">{r.hint}</span>
            </span>
          </label>
        {/each}
      </div>
      {#if settings.replySpeed !== 'default'}
        <p class="warn">{REPLY_SPEED_NOTE}</p>
      {/if}
      <p class="quiet">
        The wait is a floor on how quickly a reply becomes <em>visible</em>, not on how long the
        model takes; a shorter floor does not make a model faster. It applies to the next turn,
        not to one already in flight.
      </p>
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

    <!-- BYOK (2026-09-25): every API provider's key, models and Test connection. -->
    <ProviderKeys {settings} />

    <!--
      **Usage** (issue #41 item 4c).

      The organising rule is `shared/cost.ts` note 2, and it is not cosmetic: on the default
      backend — the learner's own Claude Code subscription — **nobody is billed per token at
      all**, so every dollar figure here is arithmetic this app did against a cached rate card
      and is labelled *API-equivalent*. An unlabelled `$0.41` in an app a cohort of students
      installs is a claim that a student owes money. Tokens lead; the estimate follows, hedged.

      The 5-hour window is on this panel for the same reason: on a subscription the constraint
      that actually bites is the rolling usage window, not a bill, and that is the thing that
      fails invisibly on the evening the A1 video is recorded.
    -->
    {#if store.costOn}
      <section>
        <h2>Usage</h2>

        <!--
          The per-message meter's off switch (#42 item C).

          Default **on**: the ask is that cost be visible, and a number nobody finds is not
          visible. But a line of grey figures under every reply is a line of grey figures beside
          somebody's lecture, and a learner who has decided they do not want to be told what each
          sentence cost should be able to say so once and never see it again. The counters at the
          thread, document and app levels stay — they are not in anybody's way.
        -->
        <label class="choice" class:on={store.showMessageCost}>
          <input
            type="checkbox"
            checked={store.showMessageCost}
            onchange={(e) => store.setShowMessageCost(e.currentTarget.checked)}
          />
          <span class="choice-text">
            <span class="choice-label">Show what each message cost</span>
            <span class="quiet">
              A small line under each of Ellie's and Max's replies — tokens first, then what the
              same calls would have cost on the API. Click one to see what the reply was made of.
            </span>
          </span>
        </label>

        {#if !allTime || allTime.calls === 0}
          <p class="quiet">
            {store.costBusy ? 'Reading the ledger…' : 'No model calls recorded yet.'}
          </p>
        {:else}
          <p class="status" title={counterTitle(allTime)}>{counterLine(allTime)}</p>
          {#if session}
            <p class="quiet">
              this session · {tokensLabel(totalTokens(session.tokens))} tokens{usdWithLabel(
                session.estimatedUsd,
                session.mode,
              ).length === 0
                ? ''
                : ` · ${usdWithLabel(session.estimatedUsd, session.mode)}`}
            </p>
          {/if}
          {#if burn}
            <!-- The rolling window, from now back five hours — not a fixed boundary, which would
                 be a guess presented as a fact (`CliWindowBurn`'s docstring). -->
            <p class="quiet">{burn}</p>
          {/if}

          <div class="tables">
            {#each [{ title: 'By model', rows: allTime.byModel, word: (k: string) => k }, { title: 'By scope', rows: allTime.byScope, word: scopeWord }, { title: 'By backend', rows: allTime.byBackend, word: (k: string) => k }] as table (table.title)}
              {#if table.rows.length > 0}
                <div class="table">
                  <h3>{table.title}</h3>
                  {#each table.rows as row (row.key)}
                    <div class="row">
                      <span class="key">{table.word(row.key)}</span>
                      <span class="val">{sliceLine(row, allTimeMode)}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>

          <p class="quiet">
            Prices come from a rate card cached on {allTime.rateCardDate}. They are an estimate of
            what these calls would have cost on the API, not a bill.
          </p>
        {/if}

        <div class="acts">
          <button type="button" class="btn" disabled={exporting || !store.canExportCost} onclick={() => void exportCsv()}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          {#if exported}<span class="quiet">{exported}</span>{/if}
        </div>

        <!--
          The override. These prices are cached, not fetched, and this app ships unsigned to a
          cohort for a semester: when a price changes, the correct fix is a new build and the
          correct *fallback* is a settings row, so a wrong number is something the owner can
          correct in an afternoon rather than a reason to distrust the panel.
        -->
        <label class="field">
          Rate card override — dollars per million tokens
          <textarea
            rows="3"
            spellcheck="false"
            placeholder={'{"claude-sonnet-5": {"input": 2, "output": 10}}'}
            bind:value={rateDraft}
            oninput={() => (rateTouched = true)}
          ></textarea>
        </label>
        {#if rateTouched && !rateCheck.ok}
          <!-- Said before it is saved. The main side merges entry by entry and ignores the bad
               ones, which is right there and wrong in a text box: a setting that is silently
               dropped is a setting that comes to be believed and not applied. -->
          <p class="warn">{rateCheck.errors.join(' · ')}</p>
        {/if}
        <div class="acts">
          <button type="button" class="btn" disabled={!rateTouched || !rateCheck.ok} onclick={() => void saveRateCard()}>
            Save rate card
          </button>
          <span class="quiet">cacheWrite and cacheRead are optional and derive from input.</span>
        </div>
      </section>
    {/if}

    <ResearchTrialSettings />

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

  /* Usage. Three small tables rather than one wide one: they are three different questions —
     which model, what for, over which backend — and a learner reads them one at a time. */
  .tables { display: flex; flex-direction: column; gap: 14px; margin: 14px 0 12px; }
  .table h3 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: var(--text-2); }
  .row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 2px 0;
    font-size: 12px;
    border-bottom: 1px solid var(--hairline);
  }
  .row:last-child { border-bottom: 0; }
  .row .key { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Tabular, because these tick while the panel is open and a proportional figure would jitter. */
  .row .val { flex: none; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .field textarea {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    background: var(--pane);
    resize: vertical;
  }
</style>
