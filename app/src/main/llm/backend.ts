/**
 * Which backend answers, and on which models — resolved in one place so the Room actor can
 * carry on not knowing (issue #19).
 *
 * The order, when the learner has not forced one:
 *
 *   1. **the local Claude CLI**, if it is installed *and* logged in — it costs the learner
 *      nothing per token and needs no key. Still the preferred default after BYOK;
 *   2. **the preferred API provider**, if the learner picked one in Settings and it is
 *      configured (a key; for the compatible endpoint, a base URL and a model);
 *   3. **the first configured API provider**, in the fixed order Anthropic, OpenAI, Gemini,
 *      OpenAI-compatible (`API_PROVIDERS`). Anthropic first because it is the provider the
 *      prompts were written and measured against, and the one existing installs already have a
 *      key for; the compatible endpoint last because it could be anything;
 *   4. **the scripted transcript player** — always available, never a network call, and what
 *      the A1 video falls back to.
 *
 * Forcing a backend in Settings overrides the order but not reality: forcing the CLI when it
 * is not installed falls to the API chain above (2–3), then Scripted; forcing an API provider
 * that is not configured lands on Scripted — never on a *different* paid provider the learner
 * did not pick. Either way the reason comes back with the resolution so the UI can say which
 * backend is actually running and why.
 */
import { AnthropicClient } from '../../room/llm/anthropic.js';
import { GeminiClient } from '../../room/llm/gemini.js';
import type { FetchLike } from '../../room/llm/http.js';
import { OpenAIClient } from '../../room/llm/openai.js';
import { ScriptedClient } from '../../room/llm/scripted.js';
import type { LLMClient } from '../../room/llm/types.js';
import {
  API_PLAN,
  cliPlan,
  DEFAULT_CLI_AGENT_MODEL,
  DEFAULT_CLI_ORCHESTRATOR_MODEL,
  type ModelPlan,
} from '../../room/llm/models.js';
import { API_PROVIDERS, type AgentProfile, type ApiProvider, type BackendChoice, type BackendKind } from '../../shared/types.js';
import type { SettingsRepo } from '../db/repos/core.js';
import { ClaudeCliClient, isSpawnableClaude } from './claude-cli.js';
import { log, type Logger } from '../log.js';
import { loggedClient } from './logged.js';
import { costedClient, type CostSink } from '../cost/client.js';
import { readCachedDetection, SETTINGS_KEYS, type CliDetection } from './detect.js';
import { PROVIDER_LABEL, readCompatibleBaseUrl, readPreferredProvider, readProviderModels } from './providers.js';

export type { BackendChoice, BackendKind };

export interface ResolvedBackend {
  kind: BackendKind;
  /** What the learner asked for in Settings. */
  choice: BackendChoice;
  models: ModelPlan;
  /** Set when the choice could not be honoured, e.g. "forced CLI, but it is not logged in". */
  fellBackBecause: string | null;
  detection: CliDetection | null;
}

const CHOICES: readonly string[] = ['claude_cli', 'scripted', ...API_PROVIDERS];

export function readBackendChoice(settings: SettingsRepo): BackendChoice {
  const raw = settings.get(SETTINGS_KEYS.backend);
  return raw !== undefined && CHOICES.includes(raw) ? (raw as BackendKind) : 'auto';
}

export function readCliModels(settings: SettingsRepo): ModelPlan {
  return cliPlan(
    settings.get(SETTINGS_KEYS.cliAgentModel) ?? DEFAULT_CLI_AGENT_MODEL,
    settings.get(SETTINGS_KEYS.cliOrchestratorModel) ?? DEFAULT_CLI_ORCHESTRATOR_MODEL,
  );
}

export interface ResolveInput {
  settings: SettingsRepo;
  /** Whether an **Anthropic** key is present (#15; the original name). The key never comes in here. */
  hasApiKey: boolean;
  /**
   * Which providers have a key stored, when the caller knows (the app always does). `anthropic`
   * falls back to `hasApiKey`. A provider absent here has no key.
   */
  keys?: Partial<Record<ApiProvider, boolean>>;
}

/**
 * Whether an API provider can answer now: a key for Anthropic, OpenAI and Gemini; a valid base
 * URL and a named model for the compatible endpoint, whose key is optional (a local Ollama takes
 * none). Pure — reads settings, never a key.
 */
export function providerConfigured(input: ResolveInput, provider: ApiProvider): boolean {
  if (provider === 'anthropic') return input.keys?.anthropic ?? input.hasApiKey;
  if (provider === 'openai_compatible') {
    return readCompatibleBaseUrl(input.settings) !== null && readProviderModels(input.settings, provider) !== null;
  }
  return input.keys?.[provider] === true;
}

/** Why a forced provider cannot run, in the words Settings shows under the radio. */
export function notConfiguredReason(input: ResolveInput, provider: ApiProvider): string {
  if (provider === 'openai_compatible') {
    if (readCompatibleBaseUrl(input.settings) === null) return 'No base URL has been entered for the OpenAI-compatible endpoint.';
    return 'No model has been named for the OpenAI-compatible endpoint.';
  }
  return `No ${PROVIDER_LABEL[provider]} API key has been entered.`;
}

/** The API chain `auto` walks after the CLI: the preferred provider, then the fixed order. */
export function firstConfiguredProvider(input: ResolveInput): ApiProvider | null {
  const preferred = readPreferredProvider(input.settings);
  if (preferred && providerConfigured(input, preferred)) return preferred;
  return API_PROVIDERS.find((p) => providerConfigured(input, p)) ?? null;
}

/** A provider's plan. The compatible endpoint's is never null once it is configured. */
export function modelsFor(settings: SettingsRepo, provider: ApiProvider): ModelPlan {
  return readProviderModels(settings, provider) ?? API_PLAN;
}

/**
 * Pure: reads settings and the cached detection, decides. Does not spawn anything, so it is
 * safe to call on every bootstrap and on every room open.
 */
export function resolveBackend(input: ResolveInput): ResolvedBackend {
  const choice = readBackendChoice(input.settings);
  const detection = readCachedDetection(input.settings);
  const cliUsable = detection?.found === true && detection.loggedIn === true;
  const cliModels = readCliModels(input.settings);
  const api = (provider: ApiProvider, fellBackBecause: string | null): ResolvedBackend => ({
    kind: provider,
    choice,
    models: modelsFor(input.settings, provider),
    fellBackBecause,
    detection,
  });

  const scripted = (fellBackBecause: string | null): ResolvedBackend => ({
    kind: 'scripted',
    choice,
    // Scripted ignores the model id, but recording the plan keeps the session row honest
    // about what *would* have run.
    models:
      cliUsable || choice === 'claude_cli'
        ? cliModels
        : choice !== 'auto' && choice !== 'scripted'
          ? modelsFor(input.settings, choice)
          : API_PLAN,
    fellBackBecause,
    detection,
  });

  if (choice === 'scripted') return scripted(null);

  if (choice === 'claude_cli' || choice === 'auto') {
    if (cliUsable) return { kind: 'claude_cli', choice, models: cliModels, fellBackBecause: null, detection };
    const next = firstConfiguredProvider(input);
    if (choice === 'claude_cli') {
      const why = detection?.found
        ? (detection.detail ?? 'Claude Code is installed but not logged in.')
        : 'Claude Code was not found on this Mac.';
      return next ? api(next, why) : scripted(why);
    }
    return next ? api(next, null) : scripted(null);
  }

  // A forced API provider: it, or the script — never a different paid provider.
  if (providerConfigured(input, choice)) return api(choice, null);
  return scripted(notConfiguredReason(input, choice));
}

export interface CreateClientInput extends ResolveInput {
  resolved: ResolvedBackend;
  /** Read lazily so the plaintext key is fetched only when the API path is actually chosen. */
  apiKey: () => string | null;
  /** Every other provider's key, read the same lazy way. Absent → only Anthropic has one. */
  keyFor?: (provider: ApiProvider) => string | null;
  /** Injectable for the fetch-only clients; no test makes a network call. */
  fetch?: FetchLike;
  cliTimeoutMs?: number;
  /**
   * What the session was started from, when the caller knows — `materials.file_path` and the
   * material's sha, which for a flow room is the file's own `content_sha`.
   *
   * `scripts.ts` says the client has to sniff because "the IPC layer that knows the material is
   * owned by another piece of work this week". It is not any more: `AppService.openRoom()` has
   * the material row in its hand, so it passes it and the script is **pinned** rather than
   * recognised. Sniffing still runs for every caller that does not pass one, and it is still the
   * only thing standing between a REFERENCE call over one segment and the wrong voice — a
   * single crop of a slide may carry no marker at all, which is exactly what happened on the
   * first live run of this path.
   */
  material?: { fileName?: string | null; contentSha?: string | null };
  /** The live roster, so a scripted beat names the agents the room is actually running (#32). */
  roster?: readonly AgentProfile[];
  /** Injectable so a test can assert what was logged without touching the process-wide one. */
  logger?: () => Logger;
  /**
   * The cost ledger, when there is one. Omit it and nothing is counted — which is what every
   * existing test does, so instrumenting the port costs them nothing.
   */
  cost?: CostSink | null;
}

/**
 * Every backend comes back wrapped in `loggedClient`, so `llm.request`/`first_token`/`complete`/
 * `error` are a property of *calling a model*, not of one implementation remembering to.
 */
/**
 * How fast a scripted turn unrolls, in ms between word chunks. The class defaults to 0 so the
 * fake-clock tests stay instant; the *app* wants a plausible rate, because the point of the
 * scripted backend is that the video and the live session look the same.
 */
const SCRIPTED_CHUNK_MS = 35;

/**
 * `loggedClient` **outside** `costedClient`: the usage row is written before `llm.complete` is
 * logged, so the log line and the ledger row cannot disagree about whether the call happened.
 */
export function createClient(input: CreateClientInput): LLMClient {
  return loggedClient(costedClient(rawClient(input), input.cost ?? null, input.logger ?? log), input.logger ?? log);
}

function rawClient(input: CreateClientInput): LLMClient {
  switch (input.resolved.kind) {
    case 'claude_cli': {
      const binary = input.resolved.detection?.path;
      // The cached detection is a settings row; it is re-checked here so a path that is not a
      // file named `claude` this user can execute is never spawned (release review, 2026-09-25).
      if (isSpawnableClaude(binary)) return new ClaudeCliClient({ binary, timeoutMs: input.cliTimeoutMs });
      return new ScriptedClient({ material: input.material, roster: input.roster, chunkMs: SCRIPTED_CHUNK_MS });
    }
    case 'anthropic':
    case 'openai':
    case 'gemini':
    case 'openai_compatible':
      return apiClient(input, input.resolved.kind) ?? new ScriptedClient({ material: input.material, roster: input.roster, chunkMs: SCRIPTED_CHUNK_MS });
    default:
      return new ScriptedClient({ material: input.material, roster: input.roster, chunkMs: SCRIPTED_CHUNK_MS });
  }
}

/**
 * The raw client for one API provider, or null when it cannot be built (no key; no base URL).
 * Exported for Settings ▸ Test connection, which builds one provider's client directly rather
 * than whatever `auto` would have resolved to.
 */
export function apiClient(
  input: Pick<CreateClientInput, 'settings' | 'apiKey' | 'keyFor' | 'fetch'>,
  provider: ApiProvider,
): LLMClient | null {
  const key = provider === 'anthropic' ? input.apiKey() : (input.keyFor?.(provider) ?? null);
  const fetchOpt = input.fetch ? { fetch: input.fetch } : {};
  switch (provider) {
    case 'anthropic':
      return key ? new AnthropicClient({ apiKey: key }) : null;
    case 'openai':
      return key ? new OpenAIClient({ flavour: 'openai', apiKey: key, ...fetchOpt }) : null;
    case 'gemini':
      return key ? new GeminiClient({ apiKey: key, ...fetchOpt }) : null;
    case 'openai_compatible': {
      const baseUrl = readCompatibleBaseUrl(input.settings);
      return baseUrl ? new OpenAIClient({ flavour: 'compatible', apiKey: key, baseUrl, ...fetchOpt }) : null;
    }
  }
}

/** 'live' means a real model is answering, whichever backend it is; 'scripted' means the script. */
export function modeFor(kind: BackendKind): 'scripted' | 'live' {
  return kind === 'scripted' ? 'scripted' : 'live';
}
