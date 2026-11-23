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
import {
  GRADER_LECTURE_COPY_NAME,
  GRADER_SAMPLE_COPY_NAME,
  GRADER_SAMPLE_FILE,
  GRADER_SAMPLE_MISSING,
  type GraderSampleFiles,
} from '../../shared/grader.js';

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

/** Packaged: `Resources/samples/<file>`. Dev: `app/samples/<file>`. The sheet unless `file` says otherwise. */
export function sampleSourcePath(o: { packaged: boolean; resourcesPath: string; appPath: string; file?: string }): string {
  const file = o.file ?? GRADER_SAMPLE_FILE;
  return o.packaged ? join(o.resourcesPath, 'samples', file) : join(o.appPath, 'samples', file);
}

/** One file into `<userData>/grader/<name>`, whole or not at all. */
function stageOne(source: string, dir: string, name: string): string | null {
  if (!source || !existsSync(source) || !statSync(source).isFile()) return null;
  const dest = join(dir, name);
  const tmp = `${dest}.${process.pid}.tmp`;
  copyFileSync(source, tmp);
  renameSync(tmp, dest);
  return dest;
}

/**
 * **Copies of the sample the tutorial flow can be handed**, in `<userData>/grader/`: the sheet,
 * and the lecture deck it is on when `lectureSource` is given and there. The renderer then treats
 * them exactly as dropped files (the notebook keeps its own copies, as for any source), so the
 * copies here only have to be readable and well named. Re-copied each time, so a pressed button
 * never reads a half-written or edited file. Fails soft: with no sheet the drop slots still work,
 * and with no lecture the sheet opens alone (`lecturePath: null`).
 */
export function stageSample(o: { source: string; lectureSource?: string | null; userDataDir: string }): GraderSampleFiles {
  try {
    const dir = join(o.userDataDir, 'grader');
    if (!existsSync(o.source) || !statSync(o.source).isFile()) return { ok: false, error: GRADER_SAMPLE_MISSING };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = stageOne(o.source, dir, GRADER_SAMPLE_COPY_NAME);
    if (!path) return { ok: false, error: GRADER_SAMPLE_MISSING };
    let lecturePath: string | null = null;
    try {
      lecturePath = o.lectureSource ? stageOne(o.lectureSource, dir, GRADER_LECTURE_COPY_NAME) : null;
    } catch {
      lecturePath = null;
    }
    return { ok: true, path, lecturePath };
  } catch {
    return { ok: false, error: GRADER_SAMPLE_MISSING };
  }
}
