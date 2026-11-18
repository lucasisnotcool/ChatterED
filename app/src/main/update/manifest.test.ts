import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { APP_ID, decide, keyId, osAtLeast, trustedKeys, verifyManifest, type TrustedKey, type UpdateManifest } from './manifest.js';

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { pem, privateKey, id: keyId(pem)! };
}

const active = pair();
const cold = pair();
const stranger = pair();
const KEYS: TrustedKey[] = [
  { id: active.id, role: 'active', pem: active.pem },
  { id: cold.id, role: 'cold', pem: cold.pem },
];

const SHA = 'a'.repeat(64);
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'chattered-update',
    schema: 1,
    appId: APP_ID,
    arch: 'arm64',
    channel: 'study',
    build: 500,
    version: '0.1.0',
    commit: 'abc123',
    url: 'https://github.com/x/y/releases/download/study-build-500/ChatterED-500-arm64.zip',
    size: 1234,
    sha256: SHA,
    cdhash: 'b'.repeat(40),
    minOs: '13.0',
    dbSchema: 34,
    publishedAt: '2026-11-18T00:00:00Z',
    ...over,
  };
}

function signed(p: Record<string, unknown>, key = active.privateKey) {
  const bytes = Buffer.from(JSON.stringify(p), 'utf8');
  return { bytes, sig: sign('sha256', bytes, key) };
}

describe('verifyManifest', () => {
  it('accepts a manifest signed by the active key, over its exact bytes', () => {
    const { bytes, sig } = signed(payload());
    const r = verifyManifest(bytes, sig, KEYS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.signer.role).toBe('active');
      expect(r.manifest.build).toBe(500);
      expect(r.manifest.targeted).toBe(false);
    }
  });

  it('refuses a flipped byte, a stranger key, an empty or junk signature', () => {
    const { bytes, sig } = signed(payload());
    const flipped = Buffer.from(bytes);
    flipped[10] = flipped[10]! ^ 1;
    expect(verifyManifest(flipped, sig, KEYS)).toEqual({ ok: false, reason: 'bad_signature' });
    const other = signed(payload(), stranger.privateKey);
    expect(verifyManifest(other.bytes, other.sig, KEYS)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyManifest(bytes, Buffer.alloc(0), KEYS)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyManifest(bytes, Buffer.from('nonsense'), KEYS)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyManifest(bytes, sig, [])).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('checks the signature before parsing: unsigned junk is a signature failure, signed junk a parse failure', () => {
    const junk = Buffer.from('{not json');
    expect(verifyManifest(junk, Buffer.from('x'), KEYS)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyManifest(junk, sign('sha256', junk, active.privateKey), KEYS)).toEqual({ ok: false, reason: 'not_json' });
  });

  it('accepts the cold (backup) key', () => {
    const { bytes, sig } = signed(payload(), cold.privateKey);
    const r = verifyManifest(bytes, sig, KEYS);
    expect(r.ok && r.signer.role).toBe('cold');
  });

  it('ignores unknown fields (a future manifest) but refuses one that demands a newer client', () => {
    const { bytes, sig } = signed(payload({ futureThing: { a: 1 }, rescue: 'x' }));
    expect(verifyManifest(bytes, sig, KEYS).ok).toBe(true);
    const newer = signed(payload({ minClientSchema: 2 }));
    expect(verifyManifest(newer.bytes, newer.sig, KEYS)).toEqual({ ok: false, reason: 'client_too_old' });
  });

  it('refuses http unless allowed, a bad sha, a payload that blocks itself', () => {
    const http = signed(payload({ url: 'http://127.0.0.1:8000/x.zip' }));
    expect(verifyManifest(http.bytes, http.sig, KEYS)).toEqual({ ok: false, reason: 'bad_field:url' });
    expect(verifyManifest(http.bytes, http.sig, KEYS, { allowHttp: true }).ok).toBe(true);
    const sha = signed(payload({ sha256: 'xyz' }));
    expect(verifyManifest(sha.bytes, sha.sig, KEYS)).toEqual({ ok: false, reason: 'bad_field:sha256' });
    const self = signed(payload({ blocked: [500] }));
    expect(verifyManifest(self.bytes, self.sig, KEYS)).toEqual({ ok: false, reason: 'build_is_blocked' });
  });

  it('honours key rotation only from a cold key', () => {
    const next = pair();
    const fromActive = signed(payload({ keys: { add: [next.pem], revoke: [active.id] } }));
    const a = verifyManifest(fromActive.bytes, fromActive.sig, KEYS);
    expect(a.ok && a.manifest.keys).toEqual({ add: [], revoke: [] });
    const fromCold = signed(payload({ keys: { add: [next.pem], revoke: [active.id] } }), cold.privateKey);
    const c = verifyManifest(fromCold.bytes, fromCold.sig, KEYS);
    expect(c.ok && c.manifest.keys).toEqual({ add: [next.pem], revoke: [active.id] });
    // After the rotation: the revoked active key is refused, the new one and the cold one accepted.
    const keys = trustedKeys(KEYS, { add: [next.pem], revoke: [active.id] });
    const old = signed(payload());
    expect(verifyManifest(old.bytes, old.sig, keys).ok).toBe(false);
    const viaNew = signed(payload(), next.privateKey);
    expect(verifyManifest(viaNew.bytes, viaNew.sig, keys).ok).toBe(true);
    // The compiled cold key can never be revoked.
    expect(trustedKeys(KEYS, { add: [], revoke: [cold.id] }).map((k) => k.role)).toContain('cold');
  });

  it("applies this install's targets entry, and only this install's", () => {
    const p = payload({ targets: { abcdef123456: { build: 501, sha256: 'c'.repeat(64), size: 99, url: 'https://e.org/501.zip', pin: true, appId: 'evil' } } });
    const { bytes, sig } = signed(p);
    const mine = verifyManifest(bytes, sig, KEYS, { installId: 'abcdef123456' });
    expect(mine.ok && [mine.manifest.build, mine.manifest.size, mine.manifest.pin, mine.manifest.targeted, mine.manifest.appId]).toEqual([
      501,
      99,
      true,
      true,
      APP_ID,
    ]);
    const other = verifyManifest(bytes, sig, KEYS, { installId: 'zzzzzz999999' });
    expect(other.ok && [other.manifest.build, other.manifest.targeted]).toEqual([500, false]);
  });
});

function manifest(over: Partial<UpdateManifest> = {}): UpdateManifest {
  const { bytes, sig } = signed(payload());
  const r = verifyManifest(bytes, sig, KEYS);
  if (!r.ok) throw new Error('fixture');
  return { ...r.manifest, ...over };
}

describe('decide', () => {
  const base = { appId: APP_ID, channel: 'study', osVersion: '15.1.0', dbUserVersion: 34, badBuilds: [] as number[] };

  it('installs a newer build, skips the same or an older one (never downgrade)', () => {
    expect(decide({ ...base, manifest: manifest(), currentBuild: 499 })).toEqual({ action: 'install', downgrade: false });
    expect(decide({ ...base, manifest: manifest(), currentBuild: 500 })).toEqual({ action: 'skip', reason: 'current' });
    expect(decide({ ...base, manifest: manifest(), currentBuild: 510 })).toEqual({ action: 'skip', reason: 'current' });
  });

  it('downgrades only under a signed pin or blocked, and only if the old build knows the schema', () => {
    expect(decide({ ...base, manifest: manifest({ blocked: [510] }), currentBuild: 510 })).toEqual({ action: 'install', downgrade: true });
    expect(decide({ ...base, manifest: manifest({ pin: true }), currentBuild: 510 })).toEqual({ action: 'install', downgrade: true });
    expect(decide({ ...base, manifest: manifest({ pin: true, dbSchema: 33 }), currentBuild: 510 })).toEqual({ action: 'skip', reason: 'schema_too_new' });
    expect(decide({ ...base, manifest: manifest({ pin: true, dbSchema: null }), currentBuild: 510 })).toEqual({ action: 'skip', reason: 'schema_too_new' });
  });

  it('never reinstalls a build that failed to start here, pinned or not', () => {
    expect(decide({ ...base, manifest: manifest(), currentBuild: 499, badBuilds: [500] })).toEqual({ action: 'skip', reason: 'known_bad' });
    expect(decide({ ...base, manifest: manifest({ pin: true }), currentBuild: 510, badBuilds: [500] })).toEqual({ action: 'skip', reason: 'known_bad' });
  });

  it('skips another app, another channel, a paused channel and a macOS too old', () => {
    expect(decide({ ...base, appId: `${APP_ID}.test`, manifest: manifest(), currentBuild: 1 })).toEqual({ action: 'skip', reason: 'app' });
    expect(decide({ ...base, channel: 'beta', manifest: manifest(), currentBuild: 1 })).toEqual({ action: 'skip', reason: 'channel' });
    expect(decide({ ...base, manifest: manifest({ paused: true }), currentBuild: 1 })).toEqual({ action: 'skip', reason: 'paused' });
    expect(decide({ ...base, osVersion: '13.6', manifest: manifest({ minOs: '14.0' }), currentBuild: 1 })).toEqual({ action: 'skip', reason: 'os_too_old' });
  });

  it('compares macOS versions numerically', () => {
    expect(osAtLeast('13.10', '13.9')).toBe(true);
    expect(osAtLeast('13', '13.0')).toBe(true);
    expect(osAtLeast('12.7.6', '13.0')).toBe(false);
  });
});
