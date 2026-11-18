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
 * `<userData>/tutorial-reads/<sheet>-<words>.json`, beside the page images: the model's answer,
 * which holds the sheet's own words and the hidden keys, and so never goes into a log or an
 * export. A kept read a week old goes (a sheet removed, or one nobody retried).
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SheetWindow } from './windows.js';

/** Moves when the windows' prompt or shape changes, so an old file is not read as a new one. */
export const READ_CACHE_VERSION = 1;

type Raw = Record<string, unknown>;

/** A kept read older than this is from a sheet nobody came back to (or one since removed). */
export const READ_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const hash = (parts: readonly string[]): string => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);

export class WindowCache {
  readonly #dir: string;
  readonly #file: string;
  readonly #sheet: string;
  #entries: Record<string, Raw>;

  /**
   * `keyParts[1]` names the sheet (its tutorial content key); the rest are its words. A file is
   * `<sheet>-<words>.json`, so a sheet's files can be found and cleared whatever its words were.
   */
  constructor(userDataDir: string, keyParts: readonly string[], now: () => number = Date.now) {
    this.#dir = join(userDataDir, 'tutorial-reads');
    this.#sheet = hash([String(READ_CACHE_VERSION), keyParts[1] ?? '']);
    this.#file = join(this.#dir, `${this.#sheet}-${hash([String(READ_CACHE_VERSION), ...keyParts])}.json`);
    this.#entries = {};
    sweep(this.#dir, now());
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
      // The sheet's words and its hidden keys: this user's only (0700 directory, 0600 file),
      // written whole or not at all (a temporary file renamed over the old one).
      mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
      chmodSync(this.#dir, 0o700);
      const tmp = `${this.#file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.#entries), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.#file);
    } catch {
      // A window that cannot be kept is paid for again on a retry; the read itself goes on.
    }
  }

  /** Every kept read of this sheet goes, whatever its words were when it was kept. */
  clear(): void {
    this.#entries = {};
    try {
      for (const f of readdirSync(this.#dir)) if (f.startsWith(`${this.#sheet}-`)) rmSync(join(this.#dir, f), { force: true });
    } catch {
      // No folder: nothing kept.
    }
  }
}

/** Kept reads nobody came back to for a week, and temporary files a crash left, go. */
function sweep(dir: string, now: number): void {
  try {
    for (const f of readdirSync(dir)) {
      const path = join(dir, f);
      if (f.endsWith('.tmp') || now - statSync(path).mtimeMs > READ_CACHE_MAX_AGE_MS) rmSync(path, { force: true });
    }
  } catch {
    // No folder yet.
  }
}
