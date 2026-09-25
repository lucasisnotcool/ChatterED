/**
 * **The research export** — everything the trial shares, in one folder, zipped.
 *
 * Nothing is uploaded. The learner picks where the zip goes, and emails it (`shared/trial.ts`).
 * The scope is the owner's: **everything except the source lecture PDFs**. What is in it:
 *
 *   ChatterED-research-<P-id>-<YYYYMMDD>/
 *     README.txt                 what each file is, in plain words
 *     manifest.json              participant id, consent, versions, platform, backend, files + sha256
 *     consent-notice.txt         the notice this install agreed to
 *     database/chattered.db      a consistent snapshot of the app database, anonymised
 *     readable/…                 the same content as JSON / JSONL / CSV (`readable.ts`)
 *     logs/main*.log             the app's diagnostic logs, anonymised
 *     settings/ui-text-scale.json
 *
 * What is **not** in it, by construction rather than by filtering: the export copies the database
 * and an allowlist of small files, so the PDFs (which never leave the learner's own folder), the
 * rendered slide images under `userData/notes-pages/`, the API key files, and Chromium's caches
 * are simply never read. Source-document *text* inside the database is removed by `anonymise.ts`.
 *
 * Everything here runs under plain Node — no Electron import — so the tests exercise the real
 * pipeline; `research/ipc.ts` is the Electron half (dialog, shell, progress pushes).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SqlDatabase } from '../db/driver.js';
import { CONSENT_VERSION, TRIAL_CONTACT_EMAIL, exportBaseName, noticeAsText, type ExportProgress, type ExportSummary } from '../../shared/trial.js';
import {
  HOME_REPLACEMENT,
  KEY_REPLACEMENT,
  SOURCE_TEXT_COLUMNS,
  USER_REPLACEMENT,
  anonymiseDatabase,
  findLeaks,
  listTables,
  makeScrubber,
  quoteIdent,
  type AnonymiseReport,
} from './anonymise.js';
import { writeReadable, type ReadableReport } from './readable.js';

export const EXPORT_FORMAT = 'chattered-research-export';
export const EXPORT_FORMAT_VERSION = 1;

/** Small files under `userData` that are settings rather than content. An allowlist, never a walk. */
export const USER_DATA_FILES: readonly string[] = ['ui-text-scale.json'];

/** Log files in the log directory: `main.log`, `main.1.log` … (`log.ts` rotation), any `*.log`. */
export function isLogFile(name: string): boolean {
  return /\.log$/i.test(name) && !name.startsWith('.');
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ResearchManifest {
  format: string;
  formatVersion: number;
  participantId: string;
  consent: { version: number | null; consentedAt: string | null; currentVersion: number };
  exportedAt: string;
  app: { version: string; schemaVersion: number };
  platform: { os: string; arch: string; osVersion: string };
  backend: { kind: string; models: Record<string, string> };
  anonymisation: {
    homeDirectoryReplacedWith: string;
    usernameReplacedWith: string;
    apiKeysReplacedWith: string;
    droppedTables: string[];
    excludedColumns: string[];
    droppedSettings: number;
    valuesScrubbed: number;
  };
  contents: ReadableReport & { logFiles: number };
  contact: string;
  files: ManifestFile[];
}

export interface ResearchExportDeps {
  /** The live database. Only read: `VACUUM INTO` takes its snapshot. */
  db: SqlDatabase;
  /** Opens the snapshot file as its own connection (`openDatabase` / `openTestDatabase`). */
  openCopy(file: string): SqlDatabase;
  /** A fresh, empty temp directory to stage in; removed by the caller. */
  workDir: string;
  logDir: string;
  userDataDir: string;
  home: string;
  username: string;
  participantId: string;
  consentVersion: number | null;
  consentedAt: string | null;
  appVersion: string;
  platform: { os: string; arch: string; osVersion: string };
  backend: { kind: string; models: Record<string, string> };
  now: Date;
  onProgress?(progress: ExportProgress): void;
}

export interface StagedExport {
  /** The folder that becomes the zip's single top-level entry. */
  dir: string;
  name: string;
  manifest: ResearchManifest;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function schemaVersion(db: SqlDatabase): number {
  return db.prepare('PRAGMA user_version').get<{ user_version: number }>()?.user_version ?? 0;
}

/** Build the export folder. Does not zip; `zipDirectory` does. Throws on any failure. */
export async function stageResearchExport(deps: ResearchExportDeps): Promise<StagedExport> {
  const progress = (step: ExportProgress['step'], label: string) => deps.onProgress?.({ step, label });
  // Let a progress push reach the window before the next synchronous stretch starts.
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const scrub = makeScrubber({ home: deps.home, username: deps.username });
  const name = exportBaseName(deps.participantId, deps.now);
  const dir = join(deps.workDir, name);
  mkdirSync(join(dir, 'database'), { recursive: true });

  // 1. A consistent snapshot, never the live file: `VACUUM INTO` reads one transaction's view.
  progress('snapshot', 'Copying the app database…');
  await tick();
  const dbPath = join(dir, 'database', 'chattered.db');
  deps.db.prepare('VACUUM INTO @path').run({ path: dbPath });

  // 2. Anonymise the copy, check it, write the readable views from it.
  progress('anonymise', 'Removing your username, folder paths and secrets…');
  await tick();
  const copy = deps.openCopy(dbPath);
  let report: AnonymiseReport;
  let readable: ReadableReport;
  let schema: number;
  try {
    copy.exec('PRAGMA journal_mode = DELETE');
    report = anonymiseDatabase(copy, scrub);
    const leaks = findLeaks(copy, scrub);
    if (leaks.length > 0) throw new Error(`Anonymising left identifying text in ${leaks.join(', ')}`);
    schema = schemaVersion(copy);
    progress('readable', 'Writing readable copies…');
    await tick();
    readable = writeReadable(copy, dir);
    copy.exec('VACUUM');
  } finally {
    copy.close();
  }
  for (const sidecar of ['-wal', '-shm', '-journal']) rmSync(`${dbPath}${sidecar}`, { force: true });

  // 3. Logs and the allowlisted settings files, scrubbed the same way.
  progress('logs', 'Adding the app logs…');
  await tick();
  let logFiles = 0;
  if (existsSync(deps.logDir)) {
    mkdirSync(join(dir, 'logs'), { recursive: true });
    for (const file of readdirSync(deps.logDir).filter(isLogFile).sort()) {
      const from = join(deps.logDir, file);
      if (!statSync(from).isFile()) continue;
      writeFileSync(join(dir, 'logs', file), scrub(readFileSync(from, 'utf8')), 'utf8');
      logFiles += 1;
    }
  }
  for (const file of USER_DATA_FILES) {
    const from = join(deps.userDataDir, file);
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, 'settings'), { recursive: true });
    writeFileSync(join(dir, 'settings', file), scrub(readFileSync(from, 'utf8')), 'utf8');
  }

  // 4. README, the notice, the manifest (last, so it can list and hash everything else).
  progress('manifest', 'Writing the manifest…');
  await tick();
  writeFileSync(join(dir, 'consent-notice.txt'), noticeAsText(), 'utf8');
  writeFileSync(join(dir, 'README.txt'), readmeText(deps.participantId, deps.now), 'utf8');

  const files: ManifestFile[] = walk(dir).map((full) => ({
    path: relative(dir, full).split(sep).join('/'),
    bytes: statSync(full).size,
    sha256: sha256(full),
  }));
  const manifest: ResearchManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    participantId: deps.participantId,
    consent: { version: deps.consentVersion, consentedAt: deps.consentedAt, currentVersion: CONSENT_VERSION },
    exportedAt: deps.now.toISOString(),
    app: { version: deps.appVersion, schemaVersion: schema },
    platform: deps.platform,
    backend: { kind: deps.backend.kind, models: { ...deps.backend.models } },
    anonymisation: {
      homeDirectoryReplacedWith: HOME_REPLACEMENT,
      usernameReplacedWith: USER_REPLACEMENT,
      apiKeysReplacedWith: KEY_REPLACEMENT,
      droppedTables: report.droppedTables,
      excludedColumns: report.excludedColumns,
      droppedSettings: report.droppedSettings,
      valuesScrubbed: report.valuesScrubbed,
    },
    contents: { ...readable, logFiles },
    contact: TRIAL_CONTACT_EMAIL,
    files,
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { dir, name, manifest };
}

/**
 * macOS's own `ditto`, so the app takes no zip dependency. `--keepParent` makes the folder the
 * zip's single top-level entry. `--norsrc --noextattr --noacl` rather than `--sequesterRsrc`:
 * the latter adds a `__MACOSX/` tree of AppleDouble files (quarantine flags and the like) that
 * is noise to whoever opens the zip — and metadata about this Mac that the trial has no use for.
 */
export function zipDirectory(dir: string, zipPath: string, ditto = '/usr/bin/ditto'): Promise<void> {
  rmSync(zipPath, { force: true });
  return new Promise((resolve, reject) => {
    execFile(ditto, ['-c', '-k', '--norsrc', '--noextattr', '--noacl', '--keepParent', dir, zipPath], (err, _stdout, stderr) => {
      if (err) reject(new Error(`Could not write the zip: ${String(stderr || err.message).trim().slice(0, 300)}`));
      else resolve();
    });
  });
}

// ── Settings ▸ Research trial: what the export will contain ─────────────────────────────────

function count(db: SqlDatabase, table: string, tables: Set<string>): number {
  if (!tables.has(table)) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get<{ n: number }>()?.n ?? 0;
}

export function exportSummary(db: SqlDatabase, logDir: string): ExportSummary {
  const tables = new Set(listTables(db));
  const page = db.prepare('PRAGMA page_size').get<{ page_size: number }>()?.page_size ?? 0;
  const pages = db.prepare('PRAGMA page_count').get<{ page_count: number }>()?.page_count ?? 0;
  let logBytes = 0;
  let logFiles = 0;
  try {
    for (const file of readdirSync(logDir).filter(isLogFile)) {
      const s = statSync(join(logDir, file));
      if (!s.isFile()) continue;
      logBytes += s.size;
      logFiles += 1;
    }
  } catch {
    /* No log directory yet. */
  }
  return {
    rooms: count(db, 'rooms', tables),
    messages: count(db, 'messages', tables),
    privateTurns: count(db, 'whispers', tables),
    notesDocs: count(db, 'notes_docs', tables),
    objectiveStates: count(db, 'learning_objective_states', tables),
    usageRows: count(db, 'llm_usage', tables),
    events: count(db, 'events', tables),
    databaseBytes: page * pages,
    logBytes,
    logFiles,
  };
}

// ── README.txt ───────────────────────────────────────────────────────────────────────────────

export function readmeText(participantId: string, now: Date): string {
  const excluded = SOURCE_TEXT_COLUMNS.map(([t, c]) => `${t}.${c}`).join(', ');
  return `ChatterED research export
========================

Participant ID: ${participantId}
Exported:       ${now.toISOString()}

This folder is everything ChatterED keeps about how you used it, anonymised, for the
experimental trial. Nothing was sent anywhere: you choose whether to email this file to
${TRIAL_CONTACT_EMAIL}. Every file below is plain text or a standard SQLite database, so
you can open and read all of it before you decide.

What is here
------------
  manifest.json          Participant ID, when you agreed to the trial notice, app and schema
                         versions, your Mac's OS version and chip type, which AI backend and
                         models were set (never keys), and every file with its size and SHA-256.
  consent-notice.txt     The notice you agreed to.
  database/chattered.db  A snapshot of the app's database (SQLite), anonymised. The complete
                         record: every table the app keeps.
  readable/              The same content, readable without SQLite:
    transcripts/*.json     one file per document's conversation: every thread and message —
                           what you typed and what the AI replied — with times, plus private chats.
    notes/*.json           each set of lecture notes: its text, who wrote which parts, and every
                           edit the AI proposed and what became of it.
    progress.json          learning objectives, your progress on them, and quiz outcomes.
    usage.csv              one row per AI call: model, tokens, estimated cost, timing.
    events.jsonl           the app's event log, one event per line.
    files.json             which file ID is which file name in your folder.
    settings.json          your settings (API keys and other secrets removed).
  logs/                  The app's diagnostic logs (sizes, timings and errors; no message text).
  settings/              Small interface preferences (text size).

How it was anonymised
---------------------
  - Your home folder path is replaced with "${HOME_REPLACEMENT}" and your Mac username with "${USER_REPLACEMENT}",
    everywhere: every table of the database, the readable files and the logs.
  - Anything that looks like an API key is replaced with "${KEY_REPLACEMENT}".
  - Settings whose name marks them as secret are removed.
  - The text of your lecture documents is removed (${excluded}), as is the
    search index of your folder. File names are kept.
  - You are identified only by the random participant ID above.
  - What you typed is included exactly as you typed it.

What is not here
----------------
  Your lecture PDFs and other files, the slide images made from them, API keys, and anything
  from outside ChatterED.

To have data you have sent deleted, email ${TRIAL_CONTACT_EMAIL} with your participant ID.
`;
}
