/**
 * **The trial's IPC channels** — consent, and the research export (`shared/trial.ts`).
 *
 * Its own module for the reason `cost/ipc.ts` is: `AppService.register()` places one hook and this
 * file owns the channels. The Electron-only parts of the export live here — the save dialog, the
 * progress pushes, Reveal in Finder and the `mailto:` — and the pipeline itself is in `export.ts`,
 * which runs under plain Node.
 *
 * `shell.openExternal` is only ever handed the `mailto:` built by `researchMailto`, and
 * `shell.showItemInFolder` only the path this process itself just wrote. Neither takes a string
 * from the renderer.
 */
import { app, dialog, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, release, tmpdir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { openDatabase, type SqlDatabase } from '../db/driver.js';
import type { SettingsRepo } from '../db/repos/core.js';
import { errorClass, log } from '../log.js';
import {
  TRIAL_IPC,
  exportBaseName,
  researchMailto,
  type ExportOutcome,
  type ExportProgress,
} from '../../shared/trial.js';
import { acceptConsent, consentGate, readTrialStatus } from './consent.js';
import { exportSummary, stageResearchExport, zipDirectory, type ManifestStudy } from './export.js';

export interface ResearchIpcDeps {
  db: SqlDatabase;
  settings: SettingsRepo;
  userDataDir: string;
  logDir: string;
  appVersion: string;
  /** The resolved backend, for the manifest: kind and model ids, never a key. */
  backendInfo(): { kind: string; models: Record<string, string> };
  /** The study build's slot and credit for the manifest, or null on an ordinary build. */
  studyInfo?(): ManifestStudy | null;
  getWindow(): BrowserWindow | null;
  /** The same `handle` wrapper the rest of `AppService.register()` uses. */
  handle: <T>(channel: string, fn: (payload: T) => unknown) => void;
}

/** The gate `AppService.register()`'s `handle` wrapper consults. */
export function trialGate(settings: SettingsRepo) {
  return consentGate(settings);
}

function macVersion(): string {
  try {
    // Electron's own: "15.1" rather than the Darwin kernel's "24.1.0".
    const v = (process as unknown as { getSystemVersion?: () => string }).getSystemVersion?.();
    if (v) return `macOS ${v} (Darwin ${release()})`;
  } catch {
    /* fall through */
  }
  return `${process.platform} ${release()}`;
}

function safeUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return basename(homedir());
  }
}

export function registerResearchIpc(deps: ResearchIpcDeps): void {
  let lastExport: { path: string; fileName: string; participantId: string } | null = null;
  let running = false;

  deps.handle(TRIAL_IPC.status, () => readTrialStatus(deps.settings));

  deps.handle<{ version: number }>(TRIAL_IPC.accept, (input) => {
    const status = acceptConsent(deps.settings, {
      version: Number(input?.version),
      now: new Date().toISOString(),
      uuid: randomUUID,
    });
    log().info('trial.consent', { version: status.consentedVersion });
    return status;
  });

  deps.handle(TRIAL_IPC.quit, () => {
    // After the reply, so the renderer's promise settles before the window goes.
    setImmediate(() => app.quit());
  });

  deps.handle(TRIAL_IPC.summary, () => exportSummary(deps.db, deps.logDir));

  deps.handle(TRIAL_IPC.exportData, async (): Promise<ExportOutcome> => {
    if (running) return { ok: false, canceled: false, error: 'An export is already running.' };
    const status = readTrialStatus(deps.settings);
    if (!status.participantId) return { ok: false, canceled: false, error: 'There is no participant ID yet.' };

    const now = new Date();
    const suggested = join(app.getPath('desktop'), `${exportBaseName(status.participantId, now)}.zip`);
    const win = deps.getWindow();
    const options: Electron.SaveDialogOptions = {
      title: 'Export Research Data',
      buttonLabel: 'Export',
      defaultPath: suggested,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const choice = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    const zipPath = choice.filePath.toLowerCase().endsWith('.zip') ? choice.filePath : `${choice.filePath}.zip`;

    const push = (p: ExportProgress) => {
      const w = deps.getWindow();
      if (w && !w.isDestroyed()) w.webContents.send(TRIAL_IPC.exportProgress, p);
    };

    running = true;
    const workDir = mkdtempSync(join(tmpdir(), 'chattered-export-'));
    const started = Date.now();
    try {
      const staged = await stageResearchExport({
        db: deps.db,
        openCopy: (file) => openDatabase(file),
        workDir,
        logDir: deps.logDir,
        userDataDir: deps.userDataDir,
        home: homedir(),
        username: safeUsername(),
        participantId: status.participantId,
        consentVersion: status.consentedVersion,
        consentedAt: status.consentedAt,
        appVersion: deps.appVersion,
        platform: { os: process.platform, arch: process.arch, osVersion: macVersion() },
        backend: deps.backendInfo(),
        study: deps.studyInfo?.() ?? null,
        now,
        onProgress: push,
      });
      push({ step: 'zip', label: 'Zipping…' });
      await zipDirectory(staged.dir, zipPath);
      const bytes = statSync(zipPath).size;
      const fileName = basename(zipPath);
      lastExport = { path: zipPath, fileName, participantId: status.participantId };
      push({ step: 'done', label: 'Done.' });
      log().info('trial.export', { bytes, files: staged.manifest.files.length, ms: Date.now() - started });
      return { ok: true, path: zipPath, fileName, bytes, participantId: status.participantId };
    } catch (err) {
      log().error('trial.export_failed', { class: errorClass(err), cause: (err as Error).message });
      return { ok: false, canceled: false, error: (err as Error).message };
    } finally {
      running = false;
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  deps.handle(TRIAL_IPC.reveal, () => {
    if (lastExport) shell.showItemInFolder(lastExport.path);
  });

  deps.handle(TRIAL_IPC.email, async () => {
    const status = readTrialStatus(deps.settings);
    const id = lastExport?.participantId ?? status.participantId;
    if (!id) return;
    await shell.openExternal(researchMailto(id, lastExport?.fileName ?? null));
  });
}
