/**
 * **The BYOK providers, as settings** (2026-09-25): where each one's model choices and the
 * compatible endpoint's base URL are stored, what each is called, and the one validation that
 * stands between a typed URL and a request carrying the learner's key.
 *
 * The keys themselves are not here — they are files, one per provider (`src/main/apikey.ts`).
 */
import { API_PROVIDERS, type ApiProvider } from '../../shared/types.js';
import { providerPlan, type ModelPlan } from '../../room/llm/models.js';
import type { SettingsRepo } from '../db/repos/core.js';

export { API_PROVIDERS };
export type { ApiProvider };

export const PROVIDER_SETTINGS = {
  /** Which provider `auto` tries first after the Claude CLI. Empty = "the first configured". */
  preferred: 'llm_preferred_provider',
  compatibleBaseUrl: 'openai_compatible_base_url',
} as const;

export function agentModelKey(provider: ApiProvider): string {
  return `api_model_agent_${provider}`;
}

export function orchestratorModelKey(provider: ApiProvider): string {
  return `api_model_orchestrator_${provider}`;
}

/** The provider's name, as the UI and the error sentences say it. */
export const PROVIDER_LABEL: Record<ApiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openai_compatible: 'OpenAI-compatible endpoint',
};

export function isApiProvider(raw: unknown): raw is ApiProvider {
  return typeof raw === 'string' && (API_PROVIDERS as readonly string[]).includes(raw);
}

export function readPreferredProvider(settings: SettingsRepo): ApiProvider | null {
  const raw = settings.get(PROVIDER_SETTINGS.preferred);
  return isApiProvider(raw) ? raw : null;
}

/** The provider's plan from settings, or null (a compatible endpoint with no model named). */
export function readProviderModels(settings: SettingsRepo, provider: ApiProvider): ModelPlan | null {
  return providerPlan(provider, settings.get(agentModelKey(provider)), settings.get(orchestratorModelKey(provider)));
}

/** The stored compatible base URL, **re-validated on read**: a row that fails is treated as absent. */
export function readCompatibleBaseUrl(settings: SettingsRepo): string | null {
  const raw = settings.get(PROVIDER_SETTINGS.compatibleBaseUrl) ?? '';
  const checked = validateCompatibleBaseUrl(raw);
  return checked.ok ? checked.url : null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * **Where the learner's key may be sent.** An `openai_compatible` base URL is typed by the
 * learner and receives their key as a bearer token on every call, so:
 *
 *  - only `http:` and `https:` — no `file:`, no `javascript:`, nothing a fetch would treat oddly;
 *  - `http:` **only for loopback** (`localhost`, `127.0.0.1`, `::1`) — Ollama on :11434 and LM
 *    Studio on :1234 are plain HTTP and never leave the machine; anything that crosses a network
 *    must be HTTPS, or the key travels in clear text;
 *  - no credentials in the URL (`https://user:pass@…`) and no query string or fragment — the
 *    key has its own header, and a URL is the thing most likely to be copied into a log;
 *  - trailing slashes and a pasted `/chat/completions` are trimmed, so the stored value is the
 *    base and the client appends the path exactly once.
 */
export function validateCompatibleBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Enter the endpoint’s base URL, e.g. http://localhost:11434/v1.' };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: `"${trimmed.slice(0, 80)}" is not a URL.` };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'The base URL must start with https:// (or http:// for a server on this Mac).' };
  }
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) {
    return {
      ok: false,
      error: 'Plain http:// is allowed only for a server on this Mac (localhost, 127.0.0.1, ::1). Anything else must be https://, so your key is not sent in clear text.',
    };
  }
  if (u.username || u.password) return { ok: false, error: 'Leave credentials out of the URL — the key field is where the key goes.' };
  if (u.search || u.hash) return { ok: false, error: 'The base URL takes no query string or #fragment.' };
  const path = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return { ok: true, url: `${u.protocol}//${u.host}${path}` };
}
