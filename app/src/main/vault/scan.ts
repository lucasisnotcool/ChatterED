/**
 * The recursive vault scan (issue #22 decision 1).
 *
 * Lives in `src/main` because it touches the filesystem: `src/room` receives plain text and
 * nothing else (architecture-mac.md §B.1, and the ESLint portability rule).
 *
 * Synchronous on purpose. `readdirSync(..., { withFileTypes: true })` costs one syscall per
 * directory and gives the type without a stat; a 5,000-file vault scans in tens of
 * milliseconds, and the alternative — an async walk interleaved with the room actor's writes —
 * buys nothing and costs determinism. If a vault ever appears where this stalls, the fix is a
 * worker thread, not a rewrite.
 */
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { extensionOf, kindFor, skipDir, skipFile, type FileKind, type SkipReason } from './kinds.js';

export interface ScannedFile {
  /** POSIX-separated, relative to the vault root. The key everything else joins on. */
  relPath: string;
  name: string;
  ext: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

export interface ScannedDir {
  relPath: string;
  name: string;
  depth: number;
}

export interface Skipped extends SkipReason {
  relPath: string;
}

export interface ScanResult {
  files: ScannedFile[];
  dirs: ScannedDir[];
  skipped: Skipped[];
}

export interface ScanOptions {
  /** Depth guard. 12 is deeper than any notes tree and shallow enough to survive a loop. */
  maxDepth?: number;
  /** Hard stop, so a vault root of `/` cannot hang the app. */
  maxFiles?: number;
}

/**
 * Walks `root` and returns every file that survives the skip rules, plus every directory that
 * was descended into (the topic candidates are the depth-1 entries of that list).
 *
 * Symlinks are **not** followed. `readdirSync` reports them as symlinks, and resolving them is
 * how a scan ends up walking `~/Library` through one `~/Documents/link` — or walking forever.
 */
export function scanVault(root: string, options: ScanOptions = {}): ScanResult {
  const maxDepth = options.maxDepth ?? 12;
  const maxFiles = options.maxFiles ?? 50_000;
  const files: ScannedFile[] = [];
  const dirs: ScannedDir[] = [];
  const skipped: Skipped[] = [];

  const walk = (absDir: string, relDir: string, depth: number): void => {
    if (files.length >= maxFiles) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      skipped.push({ relPath: relDir, reason: 'not-a-file', detail: 'unreadable directory' });
      return;
    }
    // Sorted so that two scans of an unchanged tree produce byte-identical output. The rest of
    // the app leans on that: the topic file list goes into a cached prompt prefix, where an
    // unsorted list is exactly the volatility architecture-mac.md §E.2 L1077 forbids.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skipped.push({ relPath: rel, reason: 'not-a-file', detail: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        const skip = skipDir(entry.name);
        if (skip) {
          skipped.push({ relPath: rel, ...skip });
          continue;
        }
        if (depth + 1 > maxDepth) {
          skipped.push({ relPath: rel, reason: 'too-deep' });
          continue;
        }
        dirs.push({ relPath: rel, name: entry.name, depth: depth + 1 });
        walk(join(absDir, entry.name), rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({ relPath: rel, reason: 'not-a-file' });
        continue;
      }
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = statSync(join(absDir, entry.name));
        size = st.size;
        mtimeMs = Math.round(st.mtimeMs);
      } catch {
        skipped.push({ relPath: rel, reason: 'not-a-file', detail: 'unreadable' });
        continue;
      }
      const skip = skipFile(entry.name, size);
      if (skip) {
        skipped.push({ relPath: rel, ...skip });
        continue;
      }
      if (files.length >= maxFiles) return;
      files.push({ relPath: rel, name: entry.name, ext: extensionOf(entry.name), kind: kindFor(entry.name), size, mtimeMs });
    }
  };

  walk(root, '', 0);
  return { files, dirs, skipped };
}

export interface TopicCandidate {
  relPath: string;
  name: string;
  fileCount: number;
}

/**
 * The folders the learner is offered as topics: the immediate children of the vault root, with
 * the number of scanned files anywhere beneath each. Depth 1 only — "MA3236" is a topic,
 * "MA3236/Week 4/slides" is a place inside one.
 */
export function topicCandidates(scan: ScanResult): TopicCandidate[] {
  const counts = new Map<string, number>();
  for (const d of scan.dirs) if (d.depth === 1) counts.set(d.relPath, 0);
  for (const f of scan.files) {
    const head = f.relPath.includes('/') ? f.relPath.slice(0, f.relPath.indexOf('/')) : null;
    if (head !== null && counts.has(head)) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([relPath, fileCount]) => ({ relPath, name: relPath, fileCount }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Which promoted topic a file belongs to, or null for "Other". Longest prefix wins. */
export function topicForPath(relPath: string, topicRelPaths: string[]): string | null {
  let best: string | null = null;
  for (const t of topicRelPaths) {
    if (t.length === 0) continue;
    if (relPath === t || relPath.startsWith(`${t}/`)) {
      if (best === null || t.length > best.length) best = t;
    }
  }
  return best;
}
