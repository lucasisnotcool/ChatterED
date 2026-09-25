<script lang="ts">
  /**
   * Settings ▸ **Your own API keys** (BYOK, 2026-09-25).
   *
   * One card per API provider — Anthropic, OpenAI, Google Gemini, and any OpenAI-compatible
   * endpoint (OpenRouter, Ollama, LM Studio, Groq, DeepSeek, vLLM). Each card says whether the
   * provider can answer, takes a key (masked, stored in its own 0600 file — never shown again,
   * only `••••1a2b`), lets the learner pick the two models, and has **Test connection**, which
   * makes one tiny call and reports what the provider said.
   *
   * The Claude CLI is not here: it is the recommended default and has its own section above.
   * These keys are what `Automatic` falls back to when Claude Code is not signed in — the
   * preferred provider first, then the first one configured.
   */
  import type { ApiProvider, ProviderTestResult, ProviderView, SettingsView } from '../../../shared/types.js';
  import { bridge } from '../../lib/bridge.js';
  import { store } from '../../lib/store.svelte.js';

  let { settings }: { settings: SettingsView } = $props();

  const HINTS: Record<ApiProvider, string> = {
    anthropic: 'The prompts were written against Claude. Haiku 4.5 for the group and Sonnet 5 for the orchestrator by default.',
    openai: 'An OpenAI platform key (sk-… or sk-proj-…). GPT-6 Sol for both roles by default.',
    gemini: 'A Google AI Studio key (AIza…). Gemini 3.8 Flash for both roles by default.',
    openai_compatible:
      'Any server that speaks the OpenAI Chat Completions API: OpenRouter, Ollama, LM Studio, Groq, DeepSeek, Together, vLLM. Name the models it serves; the key is optional for a local server.',
  };
  const URL_PLACEHOLDER = 'http://localhost:11434/v1  ·  https://openrouter.ai/api/v1';

  let keyDraft = $state<Record<string, string>>({});
  let keyError = $state<Record<string, string | null>>({});
  let urlDraft = $state<Record<string, string>>({});
  let urlDirty = $state<Record<string, boolean>>({});
  let customAgent = $state<Record<string, string>>({});
  let customOrch = $state<Record<string, string>>({});
  let testing = $state<Record<string, boolean>>({});
  let tested = $state<Record<string, ProviderTestResult | null>>({});
  let busy = $state(false);

  $effect(() => {
    for (const p of settings.providers) {
      if (p.id === 'openai_compatible' && !urlDirty[p.id]) urlDraft[p.id] = p.baseUrl ?? '';
    }
  });

  async function refresh(): Promise<void> {
    await store.loadSettings();
  }

  async function saveKey(p: ProviderView): Promise<void> {
    const key = (keyDraft[p.id] ?? '').trim();
    if (!key) return;
    busy = true;
    keyError[p.id] = null;
    const result = await bridge().setProviderKey({ provider: p.id, key });
    busy = false;
    if (result.ok) {
      keyDraft[p.id] = '';
      tested[p.id] = null;
      await refresh();
    } else {
      keyError[p.id] = result.error ?? 'That key could not be stored.';
    }
  }

  async function clearKey(p: ProviderView): Promise<void> {
    busy = true;
    await bridge().clearProviderKey({ provider: p.id });
    busy = false;
    tested[p.id] = null;
    await refresh();
  }

  async function saveUrl(p: ProviderView): Promise<void> {
    await store.saveSettings({ compatibleBaseUrl: urlDraft[p.id] ?? '' });
    if (!store.settingsError) urlDirty[p.id] = false;
  }

  async function setModel(p: ProviderView, role: 'agent' | 'orchestrator', value: string): Promise<void> {
    await store.saveSettings({ providerModels: { provider: p.id, [role]: value } });
  }

  async function test(p: ProviderView): Promise<void> {
    testing[p.id] = true;
    tested[p.id] = null;
    tested[p.id] = await bridge().testProvider({ provider: p.id });
    testing[p.id] = false;
  }

  function status(p: ProviderView): string {
    if (p.id === 'openai_compatible') {
      if (!p.baseUrl) return 'No endpoint yet.';
      if (!p.agentModel) return 'Endpoint set — name a model below.';
      return `Ready${p.hasKey ? ` · key ${p.keyHint}` : ' · no key (fine for a local server)'}`;
    }
    return p.hasKey ? `Key stored ${p.keyHint ?? ''}` : 'No key stored.';
  }

  function inSuggestions(p: ProviderView, model: string): boolean {
    return p.suggestions.includes(model);
  }
</script>

<section>
  <h2>Your own API keys</h2>
  <p class="quiet">
    Not needed when Claude Code is signed in — that stays the recommended default. A key here is
    used when Claude Code is unavailable (Automatic), or when you pick that provider above. Each key
    is stored in its own file only your user account can read, under
    <code>~/Library/Application&nbsp;Support/ChatterED/</code>, and is sent only to its own provider.
    Calls are billed to you by the provider.
  </p>

  <div class="choices">
    <label class="choice" class:on={settings.preferredProvider === null}>
      <input
        type="radio"
        name="preferred-provider"
        checked={settings.preferredProvider === null}
        disabled={store.settingsBusy}
        onchange={() => void store.saveSettings({ preferredProvider: null })}
      />
      <span class="choice-text">
        <span class="choice-label">When Claude Code is unavailable: the first provider with a key</span>
        <span class="quiet">In this order: Anthropic, OpenAI, Gemini, then the compatible endpoint.</span>
      </span>
    </label>
  </div>

  {#each settings.providers as p (p.id)}
    <div class="card" class:live={settings.resolvedBackend === p.id}>
      <div class="head">
        <strong>{p.label}</strong>
        <span class="quiet">{status(p)}</span>
        {#if settings.resolvedBackend === p.id}<span class="badge">running now</span>{/if}
      </div>
      <p class="quiet">{HINTS[p.id]}</p>

      <label class="inline">
        <input
          type="radio"
          name="preferred-provider"
          checked={settings.preferredProvider === p.id}
          disabled={store.settingsBusy}
          onchange={() => void store.saveSettings({ preferredProvider: p.id })}
        />
        <span>Prefer this one when Claude Code is unavailable</span>
      </label>

      {#if p.id === 'openai_compatible'}
        <label class="field">
          <span>Base URL (https://, or http:// for a server on this Mac)</span>
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={URL_PLACEHOLDER}
            bind:value={urlDraft[p.id]}
            oninput={() => (urlDirty[p.id] = true)}
          />
        </label>
        <div class="acts">
          <button type="button" class="btn" disabled={store.settingsBusy || !urlDirty[p.id]} onclick={() => void saveUrl(p)}>
            Save URL
          </button>
        </div>
      {/if}

      <label class="field">
        <span>{p.keyRequired ? 'API key' : 'API key (optional)'} — stored in <code>{p.keyFile}</code></span>
        <input
          type="password"
          spellcheck="false"
          autocomplete="off"
          placeholder={p.hasKey ? `A key is stored (${p.keyHint ?? '••••'}) — paste a new one to replace it` : 'Paste the key'}
          bind:value={keyDraft[p.id]}
        />
      </label>
      {#if keyError[p.id]}<p class="warn">{keyError[p.id]}</p>{/if}
      <div class="acts">
        <button type="button" class="btn" disabled={busy || !(keyDraft[p.id] ?? '').trim()} onclick={() => void saveKey(p)}>
          Save key
        </button>
        {#if p.hasKey}
          <button type="button" class="btn-link" disabled={busy} onclick={() => void clearKey(p)}>Remove key</button>
        {/if}
      </div>

      <div class="pair">
        <label class="field">
          <span>Agent turns (Ellie and Max)</span>
          {#if p.suggestions.length > 0}
            <select
              disabled={store.settingsBusy}
              value={inSuggestions(p, p.agentModel) ? p.agentModel : '__custom'}
              onchange={(e) => {
                const v = e.currentTarget.value;
                if (v !== '__custom') void setModel(p, 'agent', v);
              }}
            >
              {#each p.suggestions as m (m)}
                <option value={m}>{m}{m === p.defaultAgentModel ? ' (default)' : ''}</option>
              {/each}
              <option value="__custom">a specific model id…</option>
            </select>
          {/if}
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={p.agentModel || 'model id, e.g. llama3.3:70b'}
            bind:value={customAgent[p.id]}
            onchange={() => {
              const v = (customAgent[p.id] ?? '').trim();
              if (v) void setModel(p, 'agent', v);
            }}
          />
        </label>
        <label class="field">
          <span>Orchestrator + ledger</span>
          {#if p.suggestions.length > 0}
            <select
              disabled={store.settingsBusy}
              value={inSuggestions(p, p.orchestratorModel) ? p.orchestratorModel : '__custom'}
              onchange={(e) => {
                const v = e.currentTarget.value;
                if (v !== '__custom') void setModel(p, 'orchestrator', v);
              }}
            >
              {#each p.suggestions as m (m)}
                <option value={m}>{m}{m === p.defaultOrchestratorModel ? ' (default)' : ''}</option>
              {/each}
              <option value="__custom">a specific model id…</option>
            </select>
          {/if}
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={p.orchestratorModel || 'same as agent turns'}
            bind:value={customOrch[p.id]}
            onchange={() => {
              const v = (customOrch[p.id] ?? '').trim();
              if (v) void setModel(p, 'orchestrator', v);
            }}
          />
        </label>
      </div>

      <div class="acts">
        <button type="button" class="btn" disabled={testing[p.id] || !p.configured} onclick={() => void test(p)}>
          {testing[p.id] ? 'Testing…' : 'Test connection'}
        </button>
        {#if tested[p.id]}
          {#if tested[p.id]?.ok}
            <span class="ok">Connected — {tested[p.id]?.model} answered in {((tested[p.id]?.ms ?? 0) / 1000).toFixed(1)} s.</span>
          {:else}
            <span class="warn">{tested[p.id]?.error}</span>
          {/if}
        {:else if !p.configured}
          <span class="quiet">Add {p.id === 'openai_compatible' ? 'a URL and a model' : 'a key'} to test.</span>
        {:else}
          <span class="quiet">One short call; it may cost a fraction of a cent.</span>
        {/if}
      </div>
    </div>
  {/each}

  {#if store.settingsError}<p class="warn">{store.settingsError}</p>{/if}
</section>

<style>
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
  .warn { color: var(--text-2); font-size: 12px; }
  .ok { color: var(--text-2); font-size: 12px; }
  code { font-size: 11px; background: var(--ground); padding: 1px 5px; border-radius: 4px; }

  .choices { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 8px; }
  .choice { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
  .choice:hover { background: var(--ground); }
  .choice.on { background: #eaeaf4; }
  .choice input { margin-top: 3px; }
  .choice-text { display: flex; flex-direction: column; gap: 2px; }
  .choice-label { font-size: 13px; }

  .card { border-top: 1px solid var(--hairline); padding: 14px 0 6px; }
  .card.live .head strong { color: var(--indigo); }
  .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; }
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--ground); color: var(--text-2); }
  .inline { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); cursor: pointer; }

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
  .acts { display: flex; align-items: center; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
</style>
