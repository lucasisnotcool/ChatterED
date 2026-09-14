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
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

export function createApiKeyStore(userDataDir: string): ApiKeyStore {
  const path = apiKeyPath(userDataDir);

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
