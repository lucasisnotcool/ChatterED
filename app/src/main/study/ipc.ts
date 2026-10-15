/**
 * **The study build's channels** (`shared/study.ts`): its status, the unlock, and the push.
 *
 * Its own module for the reason `research/ipc.ts` is: `AppService.register()` places one hook and
 * this file owns the channels. The code arrives from the renderer, is used once to open the slot
 * and is never stored or logged; the log line says only whether it worked.
 */
import { join } from 'node:path';
import { log } from '../log.js';
import { STUDY_IPC, type UnlockOutcome } from '../../shared/study.js';
import type { StudyService } from './service.js';

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
}
