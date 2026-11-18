/**
 * **The windows of a read that has not landed yet** (field-study red team, 2026-11-18).
 *
 * A long sheet is seven or more calls. One that fails on the transport, a spent credit, or the
 * app quitting half way used to throw every finished window away, and Retry paid for all of them
 * again. So each window's parsed answer is kept here as it arrives, under the sheet's words, the
 * prompt version and the window's range, and the next read of the same sheet takes it from here
 * instead of asking again. The file goes when the sheet lands: a later *Read again* is a fresh
 * read, as the learner means it.
 *
 * `<userData>/tutorial-reads/<sha>.json`, beside the page images: the model's answer, which
 * holds the sheet's own words and the hidden keys, and so never goes into a log or an export.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SheetWindow } from './windows.js';

/** Moves when the windows' prompt or shape changes, so an old file is not read as a new one. */
export const READ_CACHE_VERSION = 1;

type Raw = Record<string, unknown>;

export class WindowCache {
  readonly #file: string;
  #entries: Record<string, Raw>;

  constructor(userDataDir: string, keyParts: readonly string[]) {
    const sha = createHash('sha256').update([String(READ_CACHE_VERSION), ...keyParts].join('\u0000')).digest('hex').slice(0, 40);
    this.#file = join(userDataDir, 'tutorial-reads', `${sha}.json`);
    this.#entries = {};
    try {
      const parsed = JSON.parse(readFileSync(this.#file, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.#entries = parsed as Record<string, Raw>;
    } catch {
      // Nothing kept, or a file that will not parse: read every window.
    }
  }

  static slot(w: SheetWindow): string {
    return `${w.from}-${w.to}-${w.ahead ?? 'end'}`;
  }

  get size(): number {
    return Object.keys(this.#entries).length;
  }

  get(w: SheetWindow): Raw | null {
    return this.#entries[WindowCache.slot(w)] ?? null;
  }

  put(w: SheetWindow, raw: Raw): void {
    this.#entries[WindowCache.slot(w)] = raw;
    try {
      // The sheet's words and its hidden keys: this user's only (0700 directory, 0600 file).
      const dir = join(this.#file, '..');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      writeFileSync(this.#file, JSON.stringify(this.#entries), { mode: 0o600 });
      chmodSync(this.#file, 0o600);
    } catch {
      // A window that cannot be kept is paid for again on a retry; the read itself goes on.
    }
  }

  clear(): void {
    this.#entries = {};
    rmSync(this.#file, { force: true });
  }
}
