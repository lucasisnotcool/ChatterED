/**
 * The Anthropic API key.
 *
 * Decision #15: each learner enters their own key. It was originally encrypted with Electron
 * `safeStorage` and kept as ciphertext in the settings table — amended 2026-09-14, and the
 * amendment is the reason this file exists.
 *
 * `safeStorage` keeps its encryption key in the login keychain ("ChatterED Safe Storage"), so
 * `isEncryptionAvailable()` reads a keychain item. Boot called it on every launch to decide
 * whether to offer the key path at all, and because `tools/install-local.sh` ad-hoc re-signs the
 * bundle on every rebuild, macOS saw a different binary each time asking for that item: "ChatterED
 * wants to use your confidential information stored in your keychain", on every single launch,
 * including the default Claude-CLI path that never wants a key. A modal that the app cannot
 * explain and the learner cannot dismiss permanently is worse than the threat it guards against,
 * which here is a local attacker who already has the user's account.
 *
 * So: a plain file, `<userData>/anthropic-api-key`, mode 0600 inside a directory mode 0700 — the
 * same protection `~/.ssh/id_ed25519` and `~/.aws/credentials` rely on. Boot never touches the
 * keychain. The file lives in Application Support, outside the repo, so it cannot be committed;
 * it is never mirrored to Firestore and never leaves the machine except to api.anthropic.com.
 *
 * **One file per provider** (BYOK, 2026-09-25). OpenAI, Gemini and an OpenAI-compatible endpoint
 * each get their own file beside the first one, under the same modes and the same rules — and
 * each key goes only to its own provider's host (or, for the compatible endpoint, to the base URL
 * the learner typed). The Anthropic file keeps its original name, `anthropic-api-key`, so an
 * existing install's key is still there after the upgrade; nothing migrates, nothing is renamed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiProvider } from '../shared/types.js';

/** The file name under `app.getPath('userData')`. Named in the UI copy, so it is exported. */
export const API_KEY_FILE = 'anthropic-api-key';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface ApiKeyStore {
  /** Absolute path of the key file, whether or not it exists. */
  readonly path: string;
  has(): boolean;
  get(): string | null;
  set(key: string): void;
  clear(): void;
}

export function apiKeyPath(userDataDir: string): string {
  return join(userDataDir, API_KEY_FILE);
}

/**
 * The key file for each API provider. `anthropic` is the original file name and must stay it —
 * see the header. Exported because the Settings copy names the file the key is in.
 */
export const PROVIDER_KEY_FILES: Record<ApiProvider, string> = {
  anthropic: API_KEY_FILE,
  openai: 'openai-api-key',
  gemini: 'gemini-api-key',
  openai_compatible: 'openai-compatible-api-key',
};

export function providerKeyPath(userDataDir: string, provider: ApiProvider): string {
  return join(userDataDir, PROVIDER_KEY_FILES[provider]);
}

/** The Anthropic key's store — the original API, unchanged. */
export function createApiKeyStore(userDataDir: string): ApiKeyStore {
  return createKeyFileStore(userDataDir, apiKeyPath(userDataDir));
}

/** One provider's key store. Same file discipline as the Anthropic one; see the header. */
export function createProviderKeyStore(userDataDir: string, provider: ApiProvider): ApiKeyStore {
  return createKeyFileStore(userDataDir, providerKeyPath(userDataDir, provider));
}

/** Every provider's store, keyed by provider. Construction touches no file. */
export function createProviderKeyStores(userDataDir: string): Record<ApiProvider, ApiKeyStore> {
  return {
    anthropic: createProviderKeyStore(userDataDir, 'anthropic'),
    openai: createProviderKeyStore(userDataDir, 'openai'),
    gemini: createProviderKeyStore(userDataDir, 'gemini'),
    openai_compatible: createProviderKeyStore(userDataDir, 'openai_compatible'),
  };
}

function createKeyFileStore(userDataDir: string, path: string): ApiKeyStore {
  const read = (): string => {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      // Absent, or unreadable because it belongs to another account: the same answer either way.
      return '';
    }
  };

  return {
    path,
    has: () => read() !== '',
    get: () => read() || null,
    set(key) {
      const trimmed = key.trim();
      if (trimmed === '') throw new Error('An empty API key cannot be stored.');
      mkdirSync(userDataDir, { recursive: true, mode: DIR_MODE });
      // `mode` on writeFileSync applies only when the file is created, so chmod covers the
      // case where an earlier version (or a text editor) left it world-readable.
      writeFileSync(path, trimmed, { mode: FILE_MODE });
      chmodSync(path, FILE_MODE);
    },
    clear() {
      if (existsSync(path)) rmSync(path, { force: true });
    },
  };
}

/** Cheap shape check so an obvious paste error is caught before the first request. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

/**
 * **The paste check, per provider.** Returns the sentence to show, or null when the key looks
 * right. Deliberately loose past the prefix — providers change key lengths and add key kinds
 * (`sk-proj-`, `sk-svcacct-`), and a check that rejects a real key is worse than one that lets a
 * typo through to a 401 the Test button will name anyway.
 *
 *  - Anthropic: `sk-ant-…` (unchanged).
 *  - OpenAI: `sk-…` — user, project and service-account keys alike — and not an Anthropic key
 *    pasted into the wrong box.
 *  - Gemini (Google AI Studio): `AIza…`.
 *  - OpenAI-compatible: anything without whitespace, because a local server may take any string
 *    (or none — the key is optional there, and an empty one is simply not stored).
 */
export function keyShapeProblem(provider: ApiProvider, key: string): string | null {
  const k = key.trim();
  if (k === '') return 'Paste a key first.';
  if (/\s/.test(k)) return 'A key has no spaces or line breaks in it — check the paste.';
  switch (provider) {
    case 'anthropic':
      return looksLikeAnthropicKey(k) ? null : "That doesn't look like an Anthropic key — they start with sk-ant-.";
    case 'openai':
      if (k.startsWith('sk-ant-')) return 'That is an Anthropic key. Paste it under Anthropic instead.';
      return /^sk-[A-Za-z0-9_-]{20,}$/.test(k) ? null : "That doesn't look like an OpenAI key — they start with sk- (or sk-proj-).";
    case 'gemini':
      return /^AIza[A-Za-z0-9_-]{30,}$/.test(k) ? null : "That doesn't look like a Gemini API key — Google AI Studio keys start with AIza.";
    case 'openai_compatible':
      return null;
  }
}

/** `••••1a2b` — enough for the learner to recognise which key is stored, never enough to use. */
export function maskKey(key: string | null): string | null {
  if (!key) return null;
  const k = key.trim();
  return k.length <= 8 ? '••••' : `••••${k.slice(-4)}`;
}
