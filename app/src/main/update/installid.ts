/**
 * **This install's random id**, `<userData>/install-id`: one line, created once with O_EXCL by
 * whichever of the bootstrap or the debug report gets there first, read by both. It names an
 * install in a manifest's `targets` (a fix to one participant first) and in a pasted debug report.
 * It is random and says nothing about the person, their slot or their study code.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const INSTALL_ID_FILE = 'install-id';
const SHAPE = /^[A-Za-z0-9_-]{6,64}$/;

export function readInstallId(userDataDir: string): string | null {
  try {
    const id = readFileSync(join(userDataDir, INSTALL_ID_FILE), 'utf8').trim();
    return SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Read it, or make it: 20 lowercase hex characters. Null if userData cannot be written. */
export function ensureInstallId(userDataDir: string): string | null {
  const existing = readInstallId(userDataDir);
  if (existing) return existing;
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, INSTALL_ID_FILE), `${randomBytes(10).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    /* another process won the race, or the folder is not writable */
  }
  return readInstallId(userDataDir);
}
