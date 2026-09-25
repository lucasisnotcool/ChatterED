/**
 * BYOK (2026-09-25): the provider order, the preferred provider, the honesty of a forced choice,
 * the per-provider model plans, the compatible endpoint's URL rule, and which client each
 * resolution builds. No network — the clients are constructed, never called.
 */
import { describe, expect, it } from 'vitest';
import { apiClient, createClient, firstConfiguredProvider, resolveBackend, type ResolveInput } from './backend.js';
import { SETTINGS_KEYS } from './detect.js';
import {
  agentModelKey,
  orchestratorModelKey,
  PROVIDER_SETTINGS,
  readCompatibleBaseUrl,
  readProviderModels,
  validateCompatibleBaseUrl,
} from './providers.js';
import { API_PLAN, GEMINI_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL } from '../../room/llm/models.js';
import { Logger } from '../log.js';
import type { SettingsRepo } from '../db/repos/core.js';
import type { ApiProvider } from '../../shared/types.js';

function settingsWith(values: Record<string, string> = {}): SettingsRepo {
  const map = new Map(Object.entries(values));
  return { get: (key) => map.get(key), set: (key, value) => void map.set(key, value), all: () => Object.fromEntries(map) };
}

const LOGGED_IN = JSON.stringify({ found: true, path: '/Users/x/.local/bin/claude', loggedIn: true, detail: null, checkedAt: new Date().toISOString() });
const NOT_FOUND = JSON.stringify({ found: false, path: null, loggedIn: null, detail: 'not found', checkedAt: new Date().toISOString() });
const COMPATIBLE = {
  [PROVIDER_SETTINGS.compatibleBaseUrl]: 'http://localhost:11434/v1',
  [agentModelKey('openai_compatible')]: 'llama3.3:70b',
};

function input(values: Record<string, string>, keys: Partial<Record<ApiProvider, boolean>> = {}): ResolveInput {
  return { settings: settingsWith(values), hasApiKey: keys.anthropic ?? false, keys };
}

const SILENT = () => new Logger({ sink: { write: () => {} } });

describe('auto: the Claude CLI stays first', () => {
  it('beats every configured API provider', () => {
    const r = resolveBackend(input({ [SETTINGS_KEYS.detection]: LOGGED_IN, [PROVIDER_SETTINGS.preferred]: 'openai' }, { openai: true, gemini: true }));
    expect(r.kind).toBe('claude_cli');
  });
});

describe('auto: after the CLI', () => {
  it('takes the preferred provider when it is configured', () => {
    const r = resolveBackend(input({ [PROVIDER_SETTINGS.preferred]: 'gemini' }, { anthropic: true, openai: true, gemini: true }));
    expect(r.kind).toBe('gemini');
    expect(r.fellBackBecause).toBeNull();
    expect(r.models).toEqual({ agent: GEMINI_DEFAULT_MODEL, orchestrator: GEMINI_DEFAULT_MODEL, fast: GEMINI_DEFAULT_MODEL });
  });

  it('skips a preferred provider that is not configured, to the fixed order', () => {
    const r = resolveBackend(input({ [PROVIDER_SETTINGS.preferred]: 'gemini' }, { openai: true }));
    expect(r.kind).toBe('openai');
  });

  it('walks anthropic → openai → gemini → openai_compatible', () => {
    expect(resolveBackend(input({}, { anthropic: true, openai: true })).kind).toBe('anthropic');
    expect(resolveBackend(input({}, { openai: true, gemini: true })).kind).toBe('openai');
    expect(resolveBackend(input({}, { gemini: true })).kind).toBe('gemini');
    expect(resolveBackend(input(COMPATIBLE)).kind).toBe('openai_compatible');
    expect(resolveBackend(input({})).kind).toBe('scripted');
  });

  it('keeps honouring the legacy hasApiKey flag for Anthropic', () => {
    expect(resolveBackend({ settings: settingsWith(), hasApiKey: true }).kind).toBe('anthropic');
    expect(firstConfiguredProvider({ settings: settingsWith(), hasApiKey: true })).toBe('anthropic');
  });

  it('does not count a compatible endpoint without a model, or with a URL that fails the rule', () => {
    expect(resolveBackend(input({ [PROVIDER_SETTINGS.compatibleBaseUrl]: 'http://localhost:11434/v1' })).kind).toBe('scripted');
    expect(resolveBackend(input({ ...COMPATIBLE, [PROVIDER_SETTINGS.compatibleBaseUrl]: 'http://10.0.0.5:8000/v1' })).kind).toBe('scripted');
  });
});

describe('a forced provider', () => {
  it('runs when configured, with the learner’s own model choices', () => {
    const r = resolveBackend(
      input({ [SETTINGS_KEYS.backend]: 'openai', [agentModelKey('openai')]: 'gpt-6-luna' }, { openai: true, anthropic: true }),
    );
    expect(r.kind).toBe('openai');
    expect(r.models).toEqual({ agent: 'gpt-6-luna', orchestrator: OPENAI_DEFAULT_MODEL, fast: OPENAI_DEFAULT_MODEL });
  });

  it('lands on scripted — never on a different paid provider — and says why', () => {
    const r = resolveBackend(input({ [SETTINGS_KEYS.backend]: 'gemini', [SETTINGS_KEYS.detection]: LOGGED_IN }, { openai: true }));
    expect(r.kind).toBe('scripted');
    expect(r.fellBackBecause).toBe('No Google Gemini API key has been entered.');
  });

  it('names what the compatible endpoint is missing', () => {
    expect(resolveBackend(input({ [SETTINGS_KEYS.backend]: 'openai_compatible' })).fellBackBecause).toMatch(/base URL/);
    expect(
      resolveBackend(input({ [SETTINGS_KEYS.backend]: 'openai_compatible', [PROVIDER_SETTINGS.compatibleBaseUrl]: 'https://openrouter.ai/api/v1' })).fellBackBecause,
    ).toMatch(/No model/);
  });

  it('forcing the CLI when it is absent falls to the API chain and keeps the reason', () => {
    const r = resolveBackend(input({ [SETTINGS_KEYS.backend]: 'claude_cli', [SETTINGS_KEYS.detection]: NOT_FOUND, [PROVIDER_SETTINGS.preferred]: 'openai' }, { openai: true, anthropic: true }));
    expect(r.kind).toBe('openai');
    expect(r.fellBackBecause).toBe('Claude Code was not found on this Mac.');
  });
});

describe('per-provider model plans', () => {
  it('defaults per provider, and Anthropic keeps the API plan', () => {
    const s = settingsWith();
    expect(readProviderModels(s, 'anthropic')).toEqual(API_PLAN);
    expect(readProviderModels(s, 'openai')?.agent).toBe(OPENAI_DEFAULT_MODEL);
    expect(readProviderModels(s, 'openai_compatible')).toBeNull();
  });

  it('never resolves to Fable on any provider (CLAUDE.md invariant)', () => {
    const s = settingsWith({
      [agentModelKey('openai_compatible')]: 'anthropic/claude-fable-5-1',
      [orchestratorModelKey('anthropic')]: 'claude-fable-5',
      [agentModelKey('gemini')]: 'FABLE',
    });
    expect(readProviderModels(s, 'openai_compatible')).toBeNull();
    expect(readProviderModels(s, 'anthropic')?.orchestrator).toBe(API_PLAN.orchestrator);
    expect(readProviderModels(s, 'gemini')?.agent).toBe(GEMINI_DEFAULT_MODEL);
  });

  it('keeps router and tag spellings intact', () => {
    const s = settingsWith({ [agentModelKey('openai_compatible')]: 'meta-llama/Llama-3.3-70B-Instruct', [orchestratorModelKey('openai_compatible')]: 'qwen3:32b' });
    expect(readProviderModels(s, 'openai_compatible')).toEqual({
      agent: 'meta-llama/Llama-3.3-70B-Instruct',
      orchestrator: 'qwen3:32b',
      fast: 'qwen3:32b',
    });
  });
});

describe('the compatible base URL', () => {
  it.each([
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:1234/v1/', 'http://127.0.0.1:1234/v1'],
    ['http://[::1]:8080/v1', 'http://[::1]:8080/v1'],
    ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1'],
    ['https://api.groq.com/openai/v1/chat/completions', 'https://api.groq.com/openai/v1'],
  ])('accepts %s', (raw, url) => {
    expect(validateCompatibleBaseUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ['http://192.168.1.20:11434/v1', /only for a server on this Mac/],
    ['http://api.deepseek.com/v1', /only for a server on this Mac/],
    ['ftp://localhost/v1', /https:\/\//],
    ['file:///etc/passwd', /https:\/\//],
    ['javascript:alert(1)', /https:\/\//],
    ['https://user:pw@example.com/v1', /credentials/],
    ['https://example.com/v1?key=abc', /query string/],
    ['not a url', /not a URL/],
    ['', /base URL/],
  ])('refuses %s', (raw, pattern) => {
    const r = validateCompatibleBaseUrl(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(pattern);
  });

  it('re-validates a stored row on read, so a bad row is treated as absent', () => {
    expect(readCompatibleBaseUrl(settingsWith({ [PROVIDER_SETTINGS.compatibleBaseUrl]: 'http://evil.example/v1' }))).toBeNull();
  });
});

describe('which client a resolution builds', () => {
  const keyFor = (p: ApiProvider) => ({ openai: 'sk-openai0123456789abcdef', gemini: 'AIzaSyTEST0123456789abcdefghijklmnopq', openai_compatible: null, anthropic: null })[p];

  it.each([
    ['openai', 'openai'],
    ['gemini', 'gemini'],
    ['openai_compatible', 'openai-compatible'],
  ] as const)('%s → a %s client, wrapped like every other', (provider, kind) => {
    const settings = settingsWith(COMPATIBLE);
    const resolved = resolveBackend({ settings, hasApiKey: false, keys: { openai: true, gemini: true, [provider]: true } });
    const client = createClient({
      settings,
      hasApiKey: false,
      resolved: { ...resolved, kind: provider },
      apiKey: () => null,
      keyFor,
      logger: SILENT,
    });
    expect(client.kind).toBe(kind);
  });

  it('falls to scripted rather than build a client with no key', () => {
    const settings = settingsWith();
    const client = createClient({
      settings,
      hasApiKey: false,
      resolved: { kind: 'openai', choice: 'openai', models: API_PLAN, fellBackBecause: null, detection: null },
      apiKey: () => null,
      keyFor: () => null,
      logger: SILENT,
    });
    expect(client.kind).toBe('scripted');
    expect(apiClient({ settings, apiKey: () => null, keyFor: () => null }, 'gemini')).toBeNull();
  });

  it('never spawns a cached CLI path that is not an executable named claude', () => {
    const settings = settingsWith();
    const client = createClient({
      settings,
      hasApiKey: false,
      resolved: {
        kind: 'claude_cli',
        choice: 'auto',
        models: API_PLAN,
        fellBackBecause: null,
        detection: { found: true, path: '/bin/sh', loggedIn: true, detail: null, checkedAt: '' },
      },
      apiKey: () => null,
      logger: SILENT,
    });
    expect(client.kind).toBe('scripted');
  });
});
