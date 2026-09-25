/**
 * **The BYOK providers, as the app holds them** (2026-09-25): the four key files, the Settings
 * view of each provider, the patch validation, and **Test connection**.
 *
 * Its own module rather than more of `AppService` so that `ipc.ts` keeps one line per concern:
 * the service owns the key stores, `AppService` asks it for flags and clients, and the three IPC
 * channels are registered from here (`registerProviderIpc`).
 *
 * What never happens here: a key in a log line (the `loggedClient` wrapper logs sizes and ids,
 * and `src/main/log.ts` scrubs key-shaped tokens from every string), a key crossing IPC back to
 * the renderer (it gets `••••1a2b`), or a key sent anywhere but its own provider.
 */
import { createProviderKeyStores, keyShapeProblem, maskKey, PROVIDER_KEY_FILES, type ApiKeyStore } from '../apikey.js';
import { isBlockedModelId, PROVIDER_MODEL_SUGGESTIONS, PROVIDER_PLANS, normaliseApiModelId } from '../../room/llm/models.js';
import { LlmAbortedError, type LlmRequest } from '../../room/llm/types.js';
import { IPC } from '../../shared/ipc.js';
import {
  API_PROVIDERS,
  type ApiProvider,
  type ProviderTestResult,
  type ProviderView,
  type SettingsPatch,
} from '../../shared/types.js';
import type { SettingsRepo } from '../db/repos/core.js';
import type { IpcHandle } from '../dochost.js';
import { log, type Logger } from '../log.js';
import { apiClient, notConfiguredReason, providerConfigured, type ResolveInput } from './backend.js';
import type { FetchLike } from '../../room/llm/http.js';
import { loggedClient } from './logged.js';
import {
  agentModelKey,
  isApiProvider,
  orchestratorModelKey,
  PROVIDER_LABEL,
  PROVIDER_SETTINGS,
  readCompatibleBaseUrl,
  readPreferredProvider,
  readProviderModels,
  validateCompatibleBaseUrl,
} from './providers.js';

/** How long Test connection waits before calling the endpoint unreachable. */
export const TEST_TIMEOUT_MS = 30_000;

export interface ProviderServiceDeps {
  userDataDir: string;
  settings: SettingsRepo;
  /** Injectable for tests; the app uses Node's global `fetch`. */
  fetch?: FetchLike;
  logger?: () => Logger;
}

export class ProviderService {
  readonly #d: ProviderServiceDeps;
  readonly #keys: Record<ApiProvider, ApiKeyStore>;

  constructor(deps: ProviderServiceDeps) {
    this.#d = deps;
    this.#keys = createProviderKeyStores(deps.userDataDir);
  }

  /** One provider's key file. `anthropic` is the original `anthropic-api-key`. */
  store(provider: ApiProvider): ApiKeyStore {
    return this.#keys[provider];
  }

  /** Which providers have a key file with something in it. Reads files; never returns a key. */
  keyFlags(): Record<ApiProvider, boolean> {
    return {
      anthropic: this.#keys.anthropic.has(),
      openai: this.#keys.openai.has(),
      gemini: this.#keys.gemini.has(),
      openai_compatible: this.#keys.openai_compatible.has(),
    };
  }

  /** The resolver's input, from the key files and settings. */
  resolveInput(): ResolveInput {
    const keys = this.keyFlags();
    return { settings: this.#d.settings, hasApiKey: keys.anthropic, keys };
  }

  /** The plaintext key, for the client that is about to use it. Lazy by design; see `createClient`. */
  keyFor = (provider: ApiProvider): string | null => this.#keys[provider].get();

  /** Whether any API provider could answer now. */
  anyConfigured(): boolean {
    const input = this.resolveInput();
    return API_PROVIDERS.some((p) => providerConfigured(input, p));
  }

  views(): ProviderView[] {
    const input = this.resolveInput();
    return API_PROVIDERS.map((provider) => {
      const plan = readProviderModels(this.#d.settings, provider);
      const defaults = PROVIDER_PLANS[provider];
      return {
        id: provider,
        label: PROVIDER_LABEL[provider],
        hasKey: input.keys?.[provider] === true,
        keyHint: maskKey(this.#keys[provider].get()),
        keyRequired: provider !== 'openai_compatible',
        keyFile: PROVIDER_KEY_FILES[provider],
        configured: providerConfigured(input, provider),
        agentModel: plan?.agent ?? '',
        orchestratorModel: plan?.orchestrator ?? '',
        defaultAgentModel: defaults?.agent ?? '',
        defaultOrchestratorModel: defaults?.orchestrator ?? '',
        suggestions: [...PROVIDER_MODEL_SUGGESTIONS[provider]],
        baseUrl: provider === 'openai_compatible' ? (this.#d.settings.get(PROVIDER_SETTINGS.compatibleBaseUrl) || null) : null,
      };
    });
  }

  preferred(): ApiProvider | null {
    return readPreferredProvider(this.#d.settings);
  }

  /**
   * The provider half of a Settings patch: checked first (a refusal writes nothing), then
   * written. Returns the refusal, or null. Fable is refused on every provider, exactly as on the
   * CLI's fields — never silently substituted (CLAUDE.md hard invariant).
   */
  checkPatch(patch: SettingsPatch): string | null {
    if (patch.preferredProvider !== undefined && patch.preferredProvider !== null && !isApiProvider(patch.preferredProvider)) {
      return 'That is not a provider ChatterED knows.';
    }
    if (patch.providerModels !== undefined) {
      const { provider, agent, orchestrator } = patch.providerModels;
      if (!isApiProvider(provider)) return 'That is not a provider ChatterED knows.';
      for (const candidate of [agent, orchestrator]) {
        if (candidate === undefined || candidate.trim() === '') continue;
        if (isBlockedModelId(candidate)) return 'That model is not available in ChatterED.';
        if (normaliseApiModelId(candidate) === null) return `"${candidate.trim().slice(0, 80)}" is not a usable model id.`;
      }
    }
    if (patch.compatibleBaseUrl !== undefined && patch.compatibleBaseUrl.trim() !== '') {
      const checked = validateCompatibleBaseUrl(patch.compatibleBaseUrl);
      if (!checked.ok) return checked.error;
    }
    return null;
  }

  applyPatch(patch: SettingsPatch, now: string): void {
    const set = (key: string, value: string) => this.#d.settings.set(key, value, now);
    if (patch.preferredProvider !== undefined) set(PROVIDER_SETTINGS.preferred, patch.preferredProvider ?? '');
    if (patch.providerModels !== undefined) {
      const { provider, agent, orchestrator } = patch.providerModels;
      if (agent !== undefined) set(agentModelKey(provider), normaliseApiModelId(agent) ?? '');
      if (orchestrator !== undefined) set(orchestratorModelKey(provider), normaliseApiModelId(orchestrator) ?? '');
    }
    if (patch.compatibleBaseUrl !== undefined) {
      const raw = patch.compatibleBaseUrl.trim();
      const checked = raw === '' ? null : validateCompatibleBaseUrl(raw);
      set(PROVIDER_SETTINGS.compatibleBaseUrl, checked && checked.ok ? checked.url : '');
    }
  }

  setKey(provider: ApiProvider, key: string): { ok: boolean; error?: string } {
    if (!isApiProvider(provider)) return { ok: false, error: 'That is not a provider ChatterED knows.' };
    const problem = keyShapeProblem(provider, key);
    if (problem) return { ok: false, error: problem };
    try {
      this.#keys[provider].set(key.trim());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  clearKey(provider: ApiProvider): void {
    if (isApiProvider(provider)) this.#keys[provider].clear();
  }

  /**
   * **Test connection**: one tiny call to one provider, on its fast-lane model, whatever `auto`
   * would pick. Logged through `loggedClient` like every other call; **not** written to the cost
   * ledger, because it belongs to no document and no thread — it is a few dozen tokens, and the
   * log line records them.
   */
  async test(provider: ApiProvider, signal?: AbortSignal): Promise<ProviderTestResult> {
    const started = Date.now();
    const fail = (model: string, error: string): ProviderTestResult => ({ ok: false, provider, model, ms: Date.now() - started, error });
    if (!isApiProvider(provider)) return fail('', 'That is not a provider ChatterED knows.');
    const input = this.resolveInput();
    const plan = readProviderModels(this.#d.settings, provider);
    if (provider === 'openai_compatible' && readCompatibleBaseUrl(this.#d.settings) === null) {
      return fail('', notConfiguredReason(input, provider));
    }
    if (!plan) return fail('', notConfiguredReason(input, provider));
    const raw = apiClient(
      { settings: this.#d.settings, apiKey: () => this.keyFor('anthropic'), keyFor: this.keyFor, ...(this.#d.fetch ? { fetch: this.#d.fetch } : {}) },
      provider,
    );
    if (!raw) return fail(plan.fast, notConfiguredReason(input, provider));
    const client = loggedClient(raw, this.#d.logger ?? log);

    const timeout = AbortSignal.timeout(TEST_TIMEOUT_MS);
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const request: LlmRequest = {
      model: plan.fast,
      // Room for a reasoning model to think before it writes the one word; see `withThinkingHeadroom`.
      max_tokens: 256,
      system: [{ type: 'text', text: 'This is a connection test from ChatterED. Reply with the single word OK.' }],
      messages: [{ role: 'user', content: 'Connection test.' }],
      meta: { scope: 'reference', turnId: `test_${provider}_${started}` },
    };
    try {
      const result = await client.complete(request, undefined, both);
      return { ok: true, provider, model: result.model || plan.fast, ms: Date.now() - started, error: null };
    } catch (err) {
      if (err instanceof LlmAbortedError && timeout.aborted) {
        return fail(plan.fast, `No answer within ${TEST_TIMEOUT_MS / 1000} s. Check the address and that the server is running.`);
      }
      return fail(plan.fast, err instanceof Error ? err.message : String(err));
    }
  }
}

/** The three provider channels. `AppService.register()` places the hook; this file owns them. */
export function registerProviderIpc(service: ProviderService, handle: IpcHandle, onChanged: () => void): void {
  handle<{ provider: ApiProvider; key: string }>(IPC.setProviderKey, (input) => {
    const result = service.setKey(input.provider, input.key ?? '');
    if (result.ok) onChanged();
    return result;
  });
  handle<{ provider: ApiProvider }>(IPC.clearProviderKey, (input) => {
    service.clearKey(input.provider);
    onChanged();
  });
  handle<{ provider: ApiProvider }>(IPC.testProvider, (input) => service.test(input.provider));
}
