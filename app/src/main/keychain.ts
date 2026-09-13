/**
 * The Anthropic API key.
 *
 * Decision #15: each user enters their own key on first run. So the key must be stored the way
 * macOS wants secrets stored — encrypted with a key the OS keychain holds — and never in plain
 * text on disk, never in git, and never sent anywhere but api.anthropic.com.
 *
 * `safeStorage.encryptString` encrypts with a key stored in the login keychain ("Electron Safe
 * Storage"); what lands on disk is ciphertext. We keep that ciphertext in the app's own
 * settings table rather than a loose file so that clearing it is one DELETE.
 */
import { safeStorage } from 'electron';
import type { SettingsRepo } from './db/repos/core.js';

const KEY = 'anthropic_api_key_ciphertext';

export interface Keychain {
  available(): boolean;
  has(): boolean;
  get(): string | null;
  set(plaintext: string): void;
  clear(): void;
}

export function createKeychain(settings: SettingsRepo, now: () => string): Keychain {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    has: () => (settings.get(KEY) ?? '') !== '',
    get() {
      const stored = settings.get(KEY);
      if (!stored) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'));
      } catch {
        // A keychain entry from another machine or another user account: treat as absent.
        return null;
      }
    },
    set(plaintext) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('This Mac will not let the app use the keychain, so the key cannot be stored safely.');
      }
      settings.set(KEY, safeStorage.encryptString(plaintext).toString('base64'), now());
    },
    clear() {
      settings.set(KEY, '', now());
    },
  };
}

/** Cheap shape check so an obvious paste error is caught before the first request. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}
