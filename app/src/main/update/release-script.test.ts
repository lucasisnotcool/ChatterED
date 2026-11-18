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
