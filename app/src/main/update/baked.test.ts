import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { manifestUrl, parseBaked } from './baked.js';
import { ensureInstallId, readInstallId } from './installid.js';

describe('parseBaked', () => {
  const key = { id: '0123456789abcdef', role: 'active', pem: '-----BEGIN PUBLIC KEY-----' };
  it('gives a production build the fixed channel URL and nothing a test build may have', () => {
    const b = parseBaked(
      JSON.stringify({ variant: 'production', channel: 'study', keys: [key], test: true, fault: 'hang-boot', manifestUrls: ['http://127.0.0.1:1/x.json'] }),
    );
    expect(b).toMatchObject({ variant: 'production', appId: 'sg.nus.chattered', productName: 'ChatterED', test: false, fault: null });
    expect(b.manifestUrls).toEqual([manifestUrl('study')]);
    expect(manifestUrl('study')).toBe('https://github.com/lucasisnotcool/ChatterED-releases/releases/download/study-channel/study-manifest-v1.json');
  });
  it('gives the test variant its own app id, name, local URL and fault', () => {
    const b = parseBaked(JSON.stringify({ variant: 'test', test: true, channel: 'test', keys: [key], fault: 'crash-at-launch-live', manifestUrls: ['http://127.0.0.1:8765/test-manifest-v1.json'] }));
    expect(b).toMatchObject({ appId: 'sg.nus.chattered.test', productName: 'ChatterED Test', test: true, fault: 'crash-at-launch-live' });
    expect(b.manifestUrls).toEqual(['http://127.0.0.1:8765/test-manifest-v1.json']);
  });
  it('treats junk as an ordinary build with no updates', () => {
    expect(parseBaked('nope')).toMatchObject({ channel: null, keys: [], build: 0 });
    expect(parseBaked(JSON.stringify({ channel: '../../etc' })).channel).toBeNull();
  });
});

describe('install id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chattered-iid-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('is made once and read back; a file someone else made is kept', () => {
    const a = ensureInstallId(join(dir, 'u1'));
    expect(a).toMatch(/^[0-9a-f]{20}$/);
    expect(ensureInstallId(join(dir, 'u1'))).toBe(a);
    writeFileSync(join(dir, 'install-id'), 'Debug_Agent-Id42\n');
    expect(ensureInstallId(dir)).toBe('Debug_Agent-Id42');
    writeFileSync(join(dir, 'install-id'), 'bad id with spaces');
    expect(readInstallId(dir)).toBeNull();
  });
});
