/**
 * THE KEYCHAIN-FREE BOOT TEST (issue #15, amended 2026-09-14).
 *
 * `safeStorage` keeps its encryption key in the login keychain, so every call into it reads a
 * keychain item; with an ad-hoc-signed bundle rebuilt every six hours, macOS asked the learner
 * for permission on every single launch — including the default CLI path, which never wants an
 * API key. The fix was to delete the dependency, and this file is what stops it coming back.
 *
 * Asserted four ways:
 *   1. the file store itself — 0600 file in a 0700 directory, and the round trip;
 *   2. static import graph — nothing reachable from `ipc.ts` or `index.ts` names it;
 *   3. a sweep of every .ts and .svelte file under src/;
 *   4. boot — constructing the IPC layer and resolving the backend with no key present against
 *      an `electron` mock whose `safeStorage` throws on any property access.
 *
 * The forbidden name is assembled from two halves so that this file is not itself a hit for the
 * sweeps in (2) and (3) — the same trick as the whisper canary in src/room/context.test.ts.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeyPath, createApiKeyStore, createProviderKeyStores, keyShapeProblem, looksLikeAnthropicKey, maskKey, PROVIDER_KEY_FILES } from './apikey.js';
import { AppService } from './ipc.js';
import { openTestDb, openTestStore } from '../test-support/db.js';

const FORBIDDEN = 'safe' + 'Storage';
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const SELF = resolve(HERE, 'apikey.test.ts');

// Every property read on `electron.safeStorage` explodes. A module-level mock, so it is in force
// before `ipc.js` is evaluated — an import-time call would fail just as loudly as a boot-time one.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => undefined },
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  safeStorage: new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        throw new Error(`Boot touched electron.${'safe' + 'Storage'}.${String(prop)} — issue #15 forbids it.`);
      },
    },
  ),
}));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chattered-apikey-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const KEY = 'sk-ant-api03-0123456789abcdefghijklmnopqrstuvwxyz';

describe('the API key file', () => {
  it('is absent until one is stored', () => {
    const store = createApiKeyStore(join(dir, 'ChatterED'));
    expect(store.has()).toBe(false);
    expect(store.get()).toBeNull();
    expect(existsSync(store.path)).toBe(false);
  });

  it('round-trips the key, trimmed', () => {
    const store = createApiKeyStore(join(dir, 'ChatterED'));
    store.set(`  ${KEY}\n`);
    expect(store.has()).toBe(true);
    expect(store.get()).toBe(KEY);
    expect(readFileSync(store.path, 'utf8')).toBe(KEY);
  });

  it('writes the file 0600 inside a directory it creates 0700', () => {
    const userData = join(dir, 'ChatterED');
    const store = createApiKeyStore(userData);
    store.set(KEY);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(statSync(userData).mode & 0o777).toBe(0o700);
  });

  it('tightens a file an earlier version left readable', () => {
    const userData = join(dir, 'ChatterED');
    mkdirSync(userData, { recursive: true });
    const path = apiKeyPath(userData);
    writeFileSync(path, 'sk-ant-old');
    chmodSync(path, 0o644);
    createApiKeyStore(userData).set(KEY);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('treats an empty file as no key, and refuses to store one', () => {
    const userData = join(dir, 'ChatterED');
    mkdirSync(userData, { recursive: true });
    writeFileSync(apiKeyPath(userData), '   \n');
    const store = createApiKeyStore(userData);
    expect(store.has()).toBe(false);
    expect(() => store.set('  ')).toThrow();
  });

  it('clears by unlinking, and clearing nothing is not an error', () => {
    const store = createApiKeyStore(join(dir, 'ChatterED'));
    store.set(KEY);
    store.clear();
    expect(existsSync(store.path)).toBe(false);
    expect(store.has()).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });

  it('still catches an obvious paste error before the first request', () => {
    expect(looksLikeAnthropicKey(KEY)).toBe(true);
    expect(looksLikeAnthropicKey('hunter2')).toBe(false);
  });
});

/** Strips comments so that documenting the ban does not count as breaking it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('nothing in the app can reach Electron safe storage', () => {
  it('cannot reach it through the static import graph from the main process entry points', () => {
    const seen = new Set<string>();
    const queue = [resolve(HERE, 'ipc.ts'), resolve(HERE, 'index.ts')];
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');

      for (const match of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        queue.push(resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts')));
      }

      if (code(src).includes(FORBIDDEN)) offenders.push(file.replace(SRC, 'src'));
    }

    expect(offenders).toEqual([]);
    expect(seen.size).toBeGreaterThan(10);
  });

  it('is named nowhere in src/', () => {
    const offenders: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|svelte)$/.test(entry.name) && path !== SELF) {
          // Comment-stripped: apikey.ts and migration 004 must stay free to name the API they
          // exist to have deleted. What is banned is an import or a call.
          if (code(readFileSync(path, 'utf8')).includes(FORBIDDEN)) offenders.push(path.replace(SRC, 'src'));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe('one key file per provider (BYOK)', () => {
  it('keeps the Anthropic key where it always was, so an upgrade loses nothing', () => {
    const userData = join(dir, 'ChatterED');
    createApiKeyStore(userData).set(KEY);
    const stores = createProviderKeyStores(userData);
    expect(stores.anthropic.path).toBe(apiKeyPath(userData));
    expect(stores.anthropic.get()).toBe(KEY);
    expect(stores.openai.has()).toBe(false);
  });

  it('writes each provider its own 0600 file and keeps them apart', () => {
    const userData = join(dir, 'ChatterED');
    const stores = createProviderKeyStores(userData);
    stores.openai.set('sk-proj-0123456789abcdefghijklmn');
    stores.gemini.set('AIzaSyTEST0123456789abcdefghijklmnopq');
    for (const provider of ['openai', 'gemini'] as const) {
      expect(stores[provider].path).toBe(join(userData, PROVIDER_KEY_FILES[provider]));
      expect(statSync(stores[provider].path).mode & 0o777).toBe(0o600);
    }
    expect(stores.openai.get()).toBe('sk-proj-0123456789abcdefghijklmn');
    stores.openai.clear();
    expect(stores.openai.has()).toBe(false);
    expect(stores.gemini.has()).toBe(true);
    expect(createApiKeyStore(userData).has()).toBe(false);
  });

  it('checks each provider’s key shape, loosely past the prefix', () => {
    expect(keyShapeProblem('anthropic', KEY)).toBeNull();
    expect(keyShapeProblem('openai', 'sk-proj-0123456789abcdefghijklmn')).toBeNull();
    expect(keyShapeProblem('openai', 'sk-svcacct-0123456789abcdefghijklmn')).toBeNull();
    expect(keyShapeProblem('openai', KEY)).toMatch(/Anthropic key/);
    expect(keyShapeProblem('openai', 'hunter2')).toMatch(/OpenAI/);
    expect(keyShapeProblem('gemini', 'AIzaSyTEST0123456789abcdefghijklmnopq')).toBeNull();
    expect(keyShapeProblem('gemini', 'sk-0123456789abcdefghijk')).toMatch(/AIza/);
    expect(keyShapeProblem('openai_compatible', 'anything-at-all')).toBeNull();
    expect(keyShapeProblem('openai_compatible', 'two words')).toMatch(/spaces/);
    expect(keyShapeProblem('gemini', '   ')).toMatch(/Paste/);
  });

  it('masks a key down to its last four characters', () => {
    expect(maskKey('sk-proj-0123456789abcdefghijklmn')).toBe('••••klmn');
    expect(maskKey('short')).toBe('••••');
    expect(maskKey(null)).toBeNull();
  });
});

describe('boot with no key', () => {
  it('constructs the IPC layer and resolves a backend without touching the keychain', () => {
    const service = new AppService({
      ...openTestDb(),
      appVersion: '0.0.0-test',
      osVersion: 'darwin test',
      userDataDir: join(dir, 'ChatterED'),
      logDir: join(dir, 'logs'),
      getWindow: () => null,
    });
    service.register();

    const boot = service.bootstrap();
    expect(boot.hasApiKey).toBe(false);
    expect(boot.mode).toBe('scripted');
    expect(service.backend().kind).toBe('scripted');
    // No key, so the API path is never chosen and the plaintext is never read.
    expect(service.apiKeyStore.has()).toBe(false);
    expect(existsSync(service.apiKeyStore.path)).toBe(false);
  });

  it('offers the API backend once a key is in the file, still without the keychain', () => {
    const userData = join(dir, 'ChatterED');
    const service = new AppService({
      ...openTestDb(),
      appVersion: '0.0.0-test',
      osVersion: 'darwin test',
      userDataDir: userData,
      logDir: join(userData, 'logs'),
      getWindow: () => null,
    });
    service.apiKeyStore.set(KEY);
    expect(service.backend().kind).toBe('anthropic');
    expect(service.bootstrap().hasApiKey).toBe(true);
  });
});

describe('migration 004', () => {
  it('leaves no ciphertext row behind', () => {
    const store = openTestStore();
    // A pre-upgrade database would have had this row; the migration deletes it, and nothing
    // writes it again, so it must never be readable after a migrated open.
    expect(store.settings.get('anthropic_api_key_ciphertext')).toBeUndefined();
    expect(Object.keys(store.settings.all())).not.toContain('anthropic_api_key_ciphertext');
  });
});
