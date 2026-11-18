import { describe, expect, it } from 'vitest';
import { BUILD_HISTORY_SETTING, readBuildHistory, recordBuild } from './buildhistory.js';

function settings() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), m };
}

describe('build history', () => {
  it('records each build once, in order, including a return to an older one', () => {
    const s = settings();
    recordBuild(s, { build: 500, sha: 'a', at: 't1' });
    recordBuild(s, { build: 500, sha: 'a', at: 't2' });
    recordBuild(s, { build: 501, sha: 'b', at: 't3' });
    recordBuild(s, { build: 500, sha: 'a', at: 't4' });
    expect(readBuildHistory(s).map((e) => [e.build, e.firstLaunchAt])).toEqual([
      [500, 't1'],
      [501, 't3'],
      [500, 't4'],
    ]);
  });
  it('survives junk in the setting', () => {
    const s = settings();
    s.m.set(BUILD_HISTORY_SETTING, '{nope');
    expect(readBuildHistory(s)).toEqual([]);
    expect(recordBuild(s, { build: 1, sha: 'x', at: 't' })).toHaveLength(1);
  });
});
