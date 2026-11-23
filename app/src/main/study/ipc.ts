/**
 * **The study build's channels** (`shared/study.ts`): its status, the unlock, and the push.
 *
 * Its own module for the reason `research/ipc.ts` is: `AppService.register()` places one hook and
 * this file owns the channels. The code arrives from the renderer, is used once to open the slot
 * and is never stored or logged; the log line says only whether it worked.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { log } from '../log.js';
import { STUDY_IPC, type UnlockOutcome } from '../../shared/study.js';
import { GRADER_SAMPLE_MISSING, type GraderSampleResult } from '../../shared/grader.js';
import { PRELOAD_FILE, type StudyService } from './service.js';

/**
 * **The study bundle lives in userData once a study build has run** (2026-11-18). Updates install
 * a pristine ordinary build with no `Resources/study/`, and the bundle in the app is never edited
 * or re-signed on a participant's Mac. So the first launch of a study build copies its
 * `keys.json` (sealed keys, never the preloaded code) to `<userData>/study/keys.json` (0700/0600),
 * and the service reads that copy first. A newer DMG with a different bundle replaces the copy.
 * Nothing new is exposed: the unsealed key already sits in userData at 0600 (`apikey.ts`).
 */
export function persistStudyBundle(shipped: string | null, userDataDir: string): { bundlePath: string | null; preloadPath: string | null } {
  const kept = join(userDataDir, 'study', 'keys.json');
  const preloadPath = shipped ? join(dirname(shipped), PRELOAD_FILE) : null;
  try {
    if (shipped && existsSync(shipped)) {
      const bytes = readFileSync(shipped);
      if (!existsSync(kept) || !readFileSync(kept).equals(bytes)) {
        mkdirSync(dirname(kept), { recursive: true, mode: 0o700 });
        const tmp = `${kept}.${process.pid}.tmp`;
        writeFileSync(tmp, bytes, { mode: 0o600 });
        renameSync(tmp, kept);
        log().info('study.bundle_kept', { bytes: bytes.length });
      }
    }
  } catch (err) {
    log().warn('study.bundle_keep_failed', { cause: (err as Error).message });
  }
  if (existsSync(kept)) return { bundlePath: kept, preloadPath };
  return { bundlePath: shipped && existsSync(shipped) ? shipped : null, preloadPath };
}

/** Packaged: `Resources/study/keys.json`. Dev: `app/study/keys.json`, or `CHATTERED_STUDY_BUNDLE`. */
export function resolveBundlePath(o: { packaged: boolean; resourcesPath: string; appPath: string; env?: string }): string {
  if (!o.packaged && o.env) return o.env;
  return o.packaged ? join(o.resourcesPath, 'study', 'keys.json') : join(o.appPath, 'study', 'keys.json');
}

export interface StudyIpcDeps {
  service: StudyService;
  /** The same `handle` wrapper the rest of `AppService.register()` uses. */
  handle: <T>(channel: string, fn: (payload: T) => unknown) => void;
  /** After a successful unlock: the open room's next turn must run on the study key. */
  onUnlocked(): void;
  /** A grader copy's sample (`grader.ts` `stageSample`). Absent in every other build. */
  graderSample?: () => GraderSampleResult;
}

export function registerStudyIpc(deps: StudyIpcDeps): void {
  deps.handle(STUDY_IPC.status, () => deps.service.status());

  deps.handle<{ code: string }>(STUDY_IPC.unlock, (input): UnlockOutcome => {
    const code = typeof input?.code === 'string' ? input.code : '';
    const outcome = deps.service.unlock(code);
    log().info('study.unlock', outcome.ok ? { ok: true, slot: outcome.status.slot } : { ok: false });
    if (outcome.ok) deps.onUnlocked();
    return outcome;
  });

  deps.handle(STUDY_IPC.graderSample, (): GraderSampleResult => {
    if (!deps.graderSample) return { ok: false, error: GRADER_SAMPLE_MISSING };
    const out = deps.graderSample();
    log().info('grader.sample', !out.ok ? { ok: false } : 'notebookId' in out ? { ok: true, seeded: true } : { ok: true, seeded: false, lecture: out.lecturePath !== null });
    return out;
  });
}
