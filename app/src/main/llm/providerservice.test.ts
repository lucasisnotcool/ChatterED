/**
 * BYOK, end to end inside the main process: the key files, the Settings view (which never
 * carries a key), the patch checks (Fable, the compatible URL rule, the CLI path rule), and
 * Test connection against a fake `fetch`. No network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFetch, sse } from '../../test-support/sse.js';
import { openTestDb, openTestStore } from '../../test-support/db.js';
import { ProviderService } from './providerservice.js';
import { Logger } from '../log.js';
import { AppService } from '../ipc.js';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => undefined },
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-providers-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const OPENAI_KEY = 'sk-proj-0123456789abcdefghijklmnop';
const lines: string[] = [];
const LOGGER = new Logger({ sink: { write: (line: string) => void lines.push(line) } });

function service(fetch?: ReturnType<typeof fakeFetch>['fetch']) {
  const store = openTestStore();
  return {
    store,
    providers: new ProviderService({ userDataDir: join(dir, 'ChatterED'), settings: store.settings, logger: () => LOGGER, ...(fetch ? { fetch } : {}) }),
  };
}

function app(): AppService {
  return new AppService({
    ...openTestDb(),
    appVersion: '0.0.0-test',
    osVersion: 'darwin test',
    userDataDir: join(dir, 'ChatterED'),
    logDir: join(dir, 'logs'),
    getWindow: () => null,
  });
}

describe('the Settings view of the providers', () => {
  it('lists all four, masks a stored key, and never carries one', () => {
    const { providers } = service();
    expect(providers.setKey('openai', OPENAI_KEY)).toEqual({ ok: true });
    const views = providers.views();
    expect(views.map((v) => v.id)).toEqual(['anthropic', 'openai', 'gemini', 'openai_compatible']);
    const openai = views.find((v) => v.id === 'openai')!;
    expect(openai).toMatchObject({ hasKey: true, configured: true, keyHint: '••••mnop', agentModel: 'gpt-6-sol' });
    expect(JSON.stringify(views)).not.toContain(OPENAI_KEY);
    expect(views.find((v) => v.id === 'openai_compatible')).toMatchObject({ keyRequired: false, configured: false, agentModel: '' });
  });

  it('refuses a key of the wrong shape and stores nothing', () => {
    const { providers } = service();
    expect(providers.setKey('gemini', OPENAI_KEY).ok).toBe(false);
    expect(providers.keyFlags().gemini).toBe(false);
  });
});

describe('Settings patches, through AppService', () => {
  it('stores provider models, the preferred provider and a loopback http URL', () => {
    const svc = app();
    const result = svc.saveSettings({
      preferredProvider: 'openai_compatible',
      providerModels: { provider: 'openai_compatible', agent: 'llama3.3:70b', orchestrator: 'qwen3:32b' },
      compatibleBaseUrl: 'http://localhost:11434/v1/',
    });
    expect(result.ok).toBe(true);
    const view = svc.settingsView();
    expect(view.preferredProvider).toBe('openai_compatible');
    expect(view.providers.find((p) => p.id === 'openai_compatible')).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      agentModel: 'llama3.3:70b',
      orchestratorModel: 'qwen3:32b',
      configured: true,
    });
    // No CLI in the test env, so auto lands on the preferred provider and says so.
    expect(view.resolvedBackend).toBe('openai_compatible');
  });

  it('refuses Fable on any provider, and a remote http URL, writing nothing', () => {
    const svc = app();
    expect(svc.saveSettings({ providerModels: { provider: 'openai_compatible', agent: 'anthropic/claude-fable-5-1' } })).toMatchObject({ ok: false });
    expect(svc.saveSettings({ compatibleBaseUrl: 'http://192.168.1.4:11434/v1', backendChoice: 'scripted' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/only for a server on this Mac/),
    });
    const view = svc.settingsView();
    expect(view.backendChoice).toBe('auto');
    expect(view.providers.find((p) => p.id === 'openai_compatible')!.baseUrl).toBeNull();
  });

  it('refuses a CLI path that is not an executable named claude, and never stores it', () => {
    const svc = app();
    const result = svc.saveSettings({ cliPathOverride: '/bin/sh' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/named claude/);
    expect(svc.settingsView().cliPathOverride).toBeNull();
    // Clearing it is always allowed.
    expect(svc.saveSettings({ cliPathOverride: '' }).ok).toBe(true);
  });
});

describe('Test connection', () => {
  it('makes one tiny call on the fast-lane model and reports success', async () => {
    const reply = sse(
      [
        { id: 'c', object: 'chat.completion.chunk', model: 'gpt-6-sol', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] },
        { id: 'c', object: 'chat.completion.chunk', model: 'gpt-6-sol', choices: [], usage: { prompt_tokens: 20, completion_tokens: 3 } },
      ],
      { done: true },
    );
    const { fetch, calls } = fakeFetch([{ status: 200, chunks: [reply] }]);
    const { providers } = service(fetch);
    providers.setKey('openai', OPENAI_KEY);
    lines.length = 0;
    const result = await providers.test('openai');
    expect(result).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-6-sol', error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.model).toBe('gpt-6-sol');
    // Logged like any call; the key is nowhere in the log.
    expect(lines.join('')).toContain('llm.complete');
    expect(lines.join('')).not.toContain(OPENAI_KEY);
  });

  it('reports the provider’s own refusal as the error', async () => {
    const { fetch } = fakeFetch([{ status: 401, body: JSON.stringify({ error: { message: 'Incorrect API key provided.' } }) }]);
    const { providers } = service(fetch);
    providers.setKey('openai', OPENAI_KEY);
    const result = await providers.test('openai');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rejected the API key/);
  });

  it('says what is missing without calling anything', async () => {
    const { fetch, calls } = fakeFetch([]);
    const { providers, store } = service(fetch);
    expect((await providers.test('gemini')).error).toBe('No Google Gemini API key has been entered.');
    expect((await providers.test('openai_compatible')).error).toMatch(/base URL/);
    store.settings.set('openai_compatible_base_url', 'http://localhost:1234/v1', new Date().toISOString());
    expect((await providers.test('openai_compatible')).error).toMatch(/No model/);
    expect(calls).toHaveLength(0);
  });
});

describe('boot', () => {
  it('reports any configured provider as hasApiKey, and auto resolves to it', () => {
    const svc = app();
    expect(svc.bootstrap().hasApiKey).toBe(false);
    svc.saveSettings({ compatibleBaseUrl: 'http://127.0.0.1:1234/v1', providerModels: { provider: 'openai_compatible', agent: 'qwen3' } });
    expect(svc.bootstrap().hasApiKey).toBe(true);
    expect(svc.bootstrap().backend).toBe('openai_compatible');
    expect(svc.settingsView().backendChoice).toBe('auto');
    expect(svc.settingsView().fellBackBecause).toBeNull();
  });
});
