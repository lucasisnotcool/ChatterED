/**
 * `tools/release.sh` keeps its study-bundle guards (regression: 361580a dropped the whole block,
 * so `--study` died on an unbound variable and an ordinary build no longer refused leftover keys).
 * The script is not unit-testable as shell, so this pins the guards' text and their order: they
 * must run before the build starts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(__dirname, '..', '..', '..', 'tools', 'release.sh'), 'utf8');
const buildAt = script.indexOf('# ── build ─');

describe('release.sh study guards', () => {
  it('has one build section', () => {
    expect(buildAt).toBeGreaterThan(0);
    expect(script.indexOf('# ── build ─', buildAt + 1)).toBe(-1);
  });

  it.each([
    ['sets where the bundle goes', 'STUDY_DEST="$APP_DIR/study/keys.json"'],
    ['sets where the preload code goes', 'PRELOAD_DEST="$APP_DIR/study/preload.txt"'],
    ['never publishes a study build', 'it is never published. Drop --publish.'],
    ['refuses leftover keys in an ordinary build', 'an ordinary build must not carry either'],
    ['copies the bundle in', 'cp "$STUDY_BUNDLE" "$STUDY_DEST"'],
    ['refuses --preload without --study', '--preload is for a study build'],
  ])('%s, before the build', (_what, needle) => {
    const at = script.indexOf(needle);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(buildAt);
  });
});

describe('the manifest seq can never strand installs (E2E item 1)', () => {
  it('release.sh refuses a manifest whose seq is not above the published one, before uploading', () => {
    const deliver = script.indexOf('deliver() {');
    const check = script.indexOf("is not above the published one: every install would refuse it");
    const upload = script.indexOf('gh release upload');
    expect(deliver).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(deliver);
    expect(check).toBeLessThan(upload);
  });

  it('update-tool sets seq to at least the clock, and above the base', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync: write, readFileSync: read } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'chattered-seq-'));
    const tool = join(__dirname, '..', '..', '..', 'tools', 'update-tool.mjs');
    const entry = join(dir, 'e.json');
    write(entry, JSON.stringify({ build: 5, url: 'https://x/y.zip', size: 1, sha256: 'a'.repeat(64) }));
    const make = (base: object | null) => {
      const out = join(dir, `m${Math.random()}.json`);
      const args = [tool, 'manifest', '--app-id', 'sg.nus.chattered', '--channel', 'study', '--out', out, '--default', entry, '--pin'];
      if (base) {
        const b = join(dir, `b${Math.random()}.json`);
        write(b, JSON.stringify(base));
        args.push('--base', b);
      }
      execFileSync(process.execPath, args, { stdio: 'ignore' });
      return (JSON.parse(read(out, 'utf8')) as { seq: number }).seq;
    };
    const now = Math.floor(Date.now() / 1000);
    const baseFields = { format: 'chattered-update', schema: 1, build: 9, url: 'https://x/a.zip', size: 1, sha256: 'b'.repeat(64) };
    expect(make(null)).toBeGreaterThanOrEqual(now);
    expect(make({ ...baseFields, seq: 3 })).toBeGreaterThanOrEqual(now); // a stale, low base
    expect(make({ ...baseFields, seq: now + 1000 })).toBe(now + 1001); // a base already ahead
  });
});

describe('release.sh grader copy guards (src/main/study/grader.ts)', () => {
  it.each([
    ['refuses --grader without --study --preload', '--grader makes a preloaded study copy'],
    ['refuses --grader with --update', '--grader is a DMG for the teaching team, never an update'],
    ['sets where the grader marker goes', 'GRADER_DEST="$APP_DIR/study/grader.txt"'],
    ['refuses a leftover grader marker in an ordinary build', 'an ordinary build must not carry it'],
  ])('%s, before the build', (_what, needle) => {
    const at = script.indexOf(needle);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(buildAt);
  });

  it('checks the marker and the sample inside the DMG, and refuses a marker nobody asked for', () => {
    const mounted = script.indexOf('hdiutil attach');
    for (const needle of ['The grader marker is missing from the DMG', 'The sample tutorial is missing from the DMG', 'a grader marker it was not asked for']) {
      expect(script.indexOf(needle)).toBeGreaterThan(mounted);
    }
  });
});
