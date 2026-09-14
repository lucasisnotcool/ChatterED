/**
 * Backend order and the per-role model plan (issue #19).
 *
 * The order is a product decision, not an implementation detail — the local CLI first because
 * it costs the learner nothing, the key second, the script last — so it is asserted here rather
 * than left to read off the `if`s. The other half of the decision is that **forcing a backend
 * does not conjure it**: a forced choice that cannot run falls back and says why.
 */
import { describe, expect, it } from 'vitest';
import { readBackendChoice, readCliModels, resolveBackend } from './backend.js';
import { SETTINGS_KEYS } from './detect.js';
import { HAIKU_API, SONNET_API } from '../../room/llm/models.js';
import type { SettingsRepo } from '../db/repos/core.js';

function settingsWith(values: Record<string, string> = {}): SettingsRepo {
  const map = new Map(Object.entries(values));
  return {
    get: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    all: () => Object.fromEntries(map),
  };
}

const LOGGED_IN = JSON.stringify({
  found: true,
  path: '/Users/x/.local/bin/claude',
  loggedIn: true,
  detail: null,
  checkedAt: new Date().toISOString(),
});
const INSTALLED_NOT_LOGGED_IN = JSON.stringify({
  found: true,
  path: '/Users/x/.local/bin/claude',
  loggedIn: false,
  detail: 'not signed in',
  checkedAt: new Date().toISOString(),
});

describe('automatic backend order', () => {
  it('prefers the local CLI when it is installed and logged in, even with a key present', () => {
    const resolved = resolveBackend({ settings: settingsWith({ [SETTINGS_KEYS.detection]: LOGGED_IN }), hasApiKey: true });
    expect(resolved.kind).toBe('claude_cli');
    expect(resolved.models).toEqual({ agent: 'sonnet', orchestrator: 'sonnet' });
  });

  it('falls to the API key when the CLI is installed but not logged in', () => {
    const resolved = resolveBackend({
      settings: settingsWith({ [SETTINGS_KEYS.detection]: INSTALLED_NOT_LOGGED_IN }),
      hasApiKey: true,
    });
    expect(resolved.kind).toBe('anthropic');
    // The API path keeps its existing defaults: Haiku 4.5 agents, Sonnet 5 orchestrator.
    expect(resolved.models).toEqual({ agent: HAIKU_API, orchestrator: SONNET_API });
  });

  it('falls all the way to scripted with no CLI and no key', () => {
    expect(resolveBackend({ settings: settingsWith(), hasApiKey: false }).kind).toBe('scripted');
  });
});

describe('a forced backend', () => {
  it('is honoured when it can run', () => {
    const settings = settingsWith({ [SETTINGS_KEYS.detection]: LOGGED_IN, [SETTINGS_KEYS.backend]: 'anthropic' });
    expect(resolveBackend({ settings, hasApiKey: true }).kind).toBe('anthropic');
  });

  it('falls back and says why when it cannot', () => {
    const settings = settingsWith({ [SETTINGS_KEYS.detection]: INSTALLED_NOT_LOGGED_IN, [SETTINGS_KEYS.backend]: 'claude_cli' });
    const resolved = resolveBackend({ settings, hasApiKey: false });
    expect(resolved.kind).toBe('scripted');
    expect(resolved.fellBackBecause).toBe('not signed in');
  });

  it('forcing scripted is never overridden by an available CLI', () => {
    const settings = settingsWith({ [SETTINGS_KEYS.detection]: LOGGED_IN, [SETTINGS_KEYS.backend]: 'scripted' });
    expect(resolveBackend({ settings, hasApiKey: true }).kind).toBe('scripted');
  });

  it('ignores a junk backend setting rather than failing to open', () => {
    expect(readBackendChoice(settingsWith({ [SETTINGS_KEYS.backend]: 'gpt' }))).toBe('auto');
  });
});

describe('the per-role model plan', () => {
  it('defaults both roles to sonnet on the CLI path', () => {
    expect(readCliModels(settingsWith())).toEqual({ agent: 'sonnet', orchestrator: 'sonnet' });
  });

  it('keeps the two roles independent', () => {
    const settings = settingsWith({
      [SETTINGS_KEYS.cliAgentModel]: 'haiku',
      [SETTINGS_KEYS.cliOrchestratorModel]: 'opus',
    });
    expect(readCliModels(settings)).toEqual({ agent: 'haiku', orchestrator: 'opus' });
  });

  it('accepts a full model id in place of an alias', () => {
    const settings = settingsWith({ [SETTINGS_KEYS.cliAgentModel]: 'claude-sonnet-5' });
    expect(readCliModels(settings).agent).toBe('claude-sonnet-5');
  });

  it('never resolves to Fable, whatever is in the settings table (CLAUDE.md invariant)', () => {
    const settings = settingsWith({
      [SETTINGS_KEYS.cliAgentModel]: 'fable',
      [SETTINGS_KEYS.cliOrchestratorModel]: 'claude-fable-5',
    });
    expect(readCliModels(settings)).toEqual({ agent: 'sonnet', orchestrator: 'sonnet' });
  });
});
