/**
 * **The grader copy, main-process half** (`shared/grader.ts`): is this one, and where its sample is.
 *
 * `release.sh --grader` puts `grader.txt` beside the study bundle and the preloaded code
 * (`Resources/study/`), so it is read from the same folder `preload.txt` is. In dev the marker is
 * `app/study/grader.txt` (or beside `CHATTERED_STUDY_BUNDLE`), or `CHATTERED_GRADER=1`; the env var
 * is honoured only in an unpackaged run, so no installed copy can be switched into grader mode.
 *
 * No Electron here: the callers pass `app.isPackaged` and the paths, so this runs under plain Node.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GRADER_SAMPLE_COPY_NAME, GRADER_SAMPLE_FILE, GRADER_SAMPLE_MISSING, type GraderSampleResult } from '../../shared/grader.js';

/** The marker's name, beside `keys.json` and `preload.txt`. Its contents are not read. */
export const GRADER_FILE = 'grader.txt';

export interface GraderFlagInput {
  packaged: boolean;
  /** The shipped bundle's path (`resolveBundlePath`), or null when there is none to look beside. */
  shippedBundlePath: string | null;
  /** `process.env.CHATTERED_GRADER`. Ignored in a packaged app. */
  env?: string;
  exists?: (path: string) => boolean;
}

/** True only for a grader copy. Any doubt (no bundle path, an unreadable folder) is false. */
export function isGraderCopy(o: GraderFlagInput): boolean {
  if (!o.packaged && o.env !== undefined && ['1', 'true', 'yes'].includes(o.env.trim().toLowerCase())) return true;
  if (!o.shippedBundlePath) return false;
  const exists = o.exists ?? existsSync;
  try {
    return exists(join(dirname(o.shippedBundlePath), GRADER_FILE));
  } catch {
    return false;
  }
}

/** Packaged: `Resources/samples/<file>`. Dev: `app/samples/<file>`. */
export function sampleSourcePath(o: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return o.packaged ? join(o.resourcesPath, 'samples', GRADER_SAMPLE_FILE) : join(o.appPath, 'samples', GRADER_SAMPLE_FILE);
}

/**
 * **A copy of the sample the tutorial flow can be handed**, in `<userData>/grader/`. The renderer
 * then treats it exactly as a dropped file (the notebook keeps its own copy, as for any source),
 * so the copy here only has to be readable and well named. Re-copied each time, so a pressed
 * button never reads a half-written or edited file. Fails soft: the drop slots still work.
 */
export function stageSample(o: { source: string; userDataDir: string }): GraderSampleResult {
  try {
    if (!existsSync(o.source) || !statSync(o.source).isFile()) return { ok: false, error: GRADER_SAMPLE_MISSING };
    const dir = join(o.userDataDir, 'grader');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = join(dir, GRADER_SAMPLE_COPY_NAME);
    const tmp = `${dest}.${process.pid}.tmp`;
    copyFileSync(o.source, tmp);
    renameSync(tmp, dest);
    return { ok: true, path: dest };
  } catch {
    return { ok: false, error: GRADER_SAMPLE_MISSING };
  }
}
