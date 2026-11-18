/**
 * **This install's random id**, `<userData>/install-id`: one line of 20 lowercase hex characters,
 * created once with O_EXCL (0600), read by the bootstrap (which must not import the app) and by
 * the debug report (`main/debug/report.ts` re-exports this). It names an install in a manifest's
 * `targets` (a fix to one participant first) and in a pasted debug report. It is random and says
 * nothing about the person, their slot or their study code. The one implementation of it.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const INSTALL_ID_FILE = 'install-id';
/** What a valid id looks like on read (any such id is kept, whoever made it). */
export const INSTALL_ID_SHAPE = /^[A-Za-z0-9_-]{6,64}$/;

export function readInstallId(userDataDir: string): string | null {
  try {
    const id = readFileSync(join(userDataDir, INSTALL_ID_FILE), 'utf8').trim();
    return INSTALL_ID_SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Read it, or make it; `note` says why there is none (an errno code, `no userData`, `unreadable`). */
export function ensureInstallIdDetailed(userDataDir: string): { id: string | null; note: string | null } {
  if (!userDataDir) return { id: null, note: 'no userData' };
  const existing = readInstallId(userDataDir);
  if (existing) return { id: existing, note: null };
  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, INSTALL_ID_FILE), `${randomBytes(10).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    // Another process won the race, or the folder is not writable.
    const again = readInstallId(userDataDir);
    if (again) return { id: again, note: null };
    return { id: null, note: (err as NodeJS.ErrnoException).code ?? 'unwritable' };
  }
  const made = readInstallId(userDataDir);
  return made ? { id: made, note: null } : { id: null, note: 'unreadable' };
}

/** The id, or null. */
export function ensureInstallId(userDataDir: string): string | null {
  return ensureInstallIdDetailed(userDataDir).id;
}
