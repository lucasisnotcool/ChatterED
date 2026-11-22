/**
 * The grader copy's flag and sample (`grader.ts`). The flag is off unless the marker is beside
 * the shipped bundle, or (in dev only) `CHATTERED_GRADER` says so; the sample is staged into
 * userData and fails soft when it is missing.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GRADER_SAMPLE_COPY_NAME, GRADER_SAMPLE_FILE, GRADER_SAMPLE_MISSING } from '../../shared/grader.js';
import { GRADER_FILE, isGraderCopy, sampleSourcePath, stageSample } from './grader.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'chattered-grader-'));
  dirs.push(d);
  return d;
}

describe('isGraderCopy', () => {
  it('is false for an ordinary build: no bundle path, or no marker beside it', () => {
    expect(isGraderCopy({ packaged: true, shippedBundlePath: null })).toBe(false);
    const dir = temp();
    expect(isGraderCopy({ packaged: true, shippedBundlePath: join(dir, 'keys.json') })).toBe(false);
  });

  it('is true when grader.txt sits beside the shipped bundle, as release.sh --grader puts it', () => {
    const dir = temp();
    writeFileSync(join(dir, GRADER_FILE), 'grader\n');
    expect(isGraderCopy({ packaged: true, shippedBundlePath: join(dir, 'keys.json') })).toBe(true);
    expect(isGraderCopy({ packaged: false, shippedBundlePath: join(dir, 'keys.json') })).toBe(true);
  });

  it('honours CHATTERED_GRADER only in an unpackaged run', () => {
    expect(isGraderCopy({ packaged: false, shippedBundlePath: null, env: '1' })).toBe(true);
    expect(isGraderCopy({ packaged: false, shippedBundlePath: null, env: 'true' })).toBe(true);
    expect(isGraderCopy({ packaged: false, shippedBundlePath: null, env: '0' })).toBe(false);
    expect(isGraderCopy({ packaged: false, shippedBundlePath: null, env: '' })).toBe(false);
    expect(isGraderCopy({ packaged: true, shippedBundlePath: null, env: '1' })).toBe(false);
  });

  it('reads a failing lookup as false rather than throwing', () => {
    const exists = (): boolean => {
      throw new Error('EACCES');
    };
    expect(isGraderCopy({ packaged: true, shippedBundlePath: '/x/study/keys.json', exists })).toBe(false);
  });
});

describe('sampleSourcePath', () => {
  it('is Resources/samples in a packaged app and app/samples in dev', () => {
    expect(sampleSourcePath({ packaged: true, resourcesPath: '/A.app/Contents/Resources', appPath: '/ignored' })).toBe(
      `/A.app/Contents/Resources/samples/${GRADER_SAMPLE_FILE}`,
    );
    expect(sampleSourcePath({ packaged: false, resourcesPath: '/ignored', appPath: '/repo/app' })).toBe(`/repo/app/samples/${GRADER_SAMPLE_FILE}`);
  });

  it('points at the PDF that is committed in app/samples', () => {
    const appDir = join(__dirname, '..', '..', '..');
    expect(existsSync(sampleSourcePath({ packaged: false, resourcesPath: '', appPath: appDir }))).toBe(true);
  });
});

describe('stageSample', () => {
  it('copies the sample into userData/grader under its readable name', () => {
    const src = join(temp(), GRADER_SAMPLE_FILE);
    writeFileSync(src, '%PDF-1.4 sample');
    const userData = temp();
    const out = stageSample({ source: src, userDataDir: userData });
    expect(out).toEqual({ ok: true, path: join(userData, 'grader', GRADER_SAMPLE_COPY_NAME) });
    expect(readFileSync(join(userData, 'grader', GRADER_SAMPLE_COPY_NAME), 'utf8')).toBe('%PDF-1.4 sample');
  });

  it('replaces an earlier copy, so a second press reads the shipped file again', () => {
    const src = join(temp(), GRADER_SAMPLE_FILE);
    writeFileSync(src, 'v2');
    const userData = temp();
    mkdirSync(join(userData, 'grader'));
    writeFileSync(join(userData, 'grader', GRADER_SAMPLE_COPY_NAME), 'edited');
    expect(stageSample({ source: src, userDataDir: userData }).ok).toBe(true);
    expect(readFileSync(join(userData, 'grader', GRADER_SAMPLE_COPY_NAME), 'utf8')).toBe('v2');
  });

  it('fails soft when the sample is missing or is not a file', () => {
    const userData = temp();
    expect(stageSample({ source: join(userData, 'nope.pdf'), userDataDir: userData })).toEqual({ ok: false, error: GRADER_SAMPLE_MISSING });
    expect(stageSample({ source: userData, userDataDir: userData })).toEqual({ ok: false, error: GRADER_SAMPLE_MISSING });
  });
});

describe('the study:graderSample channel', () => {
  async function channel(graderSample?: () => { ok: true; path: string }) {
    const { registerStudyIpc } = await import('./ipc.js');
    const { STUDY_IPC } = await import('../../shared/study.js');
    const handlers = new Map<string, (payload: unknown) => unknown>();
    registerStudyIpc({
      service: {} as never,
      handle: (name, fn) => handlers.set(name, fn as (payload: unknown) => unknown),
      onUnlocked: () => undefined,
      ...(graderSample ? { graderSample } : {}),
    });
    return handlers.get(STUDY_IPC.graderSample)!;
  }

  it('answers "missing" in every build that is not a grader copy', async () => {
    expect((await channel())(undefined)).toEqual({ ok: false, error: GRADER_SAMPLE_MISSING });
  });

  it('hands back the staged path in a grader copy', async () => {
    expect((await channel(() => ({ ok: true, path: '/u/grader/x.pdf' })))(undefined)).toEqual({ ok: true, path: '/u/grader/x.pdf' });
  });
});
