/**
 * **The update manifest, v1**: what a channel offers, signed by the owner (ECDSA P-256, SHA-256).
 *
 * Two files at a fixed URL per channel (`study-manifest-v1.json` and `….json.sig`). The `.sig` is
 * the DER signature over the **exact bytes** of the `.json`, checked before the bytes are parsed:
 * nothing is canonicalised or re-serialised. P-256 rather than Ed25519 because macOS's own
 * `/usr/bin/openssl` (LibreSSL 3.3) verifies P-256 and cannot verify Ed25519, so a shell-level
 * rescue can check the same files later:
 *
 *     openssl dgst -sha256 -verify active.pub.pem -signature study-manifest-v1.json.sig study-manifest-v1.json
 *
 * **Forward compatibility.** Unknown fields are ignored and no field is ever repurposed. A new
 * format gets a new file name (`-v2.json`) published beside this one, so every v1 client keeps
 * reading v1. `minClientSchema` exists for a v1 change old clients must not misread; raising it
 * strands every older client, so it should never be needed. No expiry and no not-before: a wrong
 * clock on a participant's Mac must never block an update.
 *
 * **Keys.** The app compiles in two public keys: `active` (signs every release) and `cold` (kept
 * offline, never used unless the active one is lost or leaks). A manifest signed by a cold key may
 * carry `keys.add` / `keys.revoke`, which the client remembers; from an active key those fields are
 * ignored. Pure: `node:crypto` only, shared with `tools/update-manifest.mjs`.
 *
 * **The owner's levers** (`decide()`), none of which needs anyone's Mac:
 *  - `build`: the build to be on. Never a downgrade, except
 *  - `blocked`: copies running one of these leave it for `build`, even when that is older;
 *  - `pin`: every copy goes to `build`, up or down (a channel-wide rollback);
 *  - `paused`: install nothing (checks still run and are logged).
 *  - `targets`: `{ "<install id>": { …any of TARGET_FIELDS } }` overrides the channel default for
 *    one install, so a fix can go to one participant first (`release.sh --target`), or one
 *    install can be pinned back (`--rollback-to N --target <id>`).
 * A downgrade also needs `dbSchema` (the newest migration that build knows) to be at least the
 * participant's database `user_version`, so old code never meets a schema it cannot read.
 */
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

export const MANIFEST_FORMAT = 'chattered-update';
/** The payload schema this client understands. */
export const CLIENT_SCHEMA = 1;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_SIG_BYTES = 1024;
/** The production bundle id; the test variant is `sg.nus.chattered.test` (`baked.ts`). */
export const APP_ID = 'sg.nus.chattered';
export const ARCH = 'arm64';
/** The fields a per-install `targets` entry may override (all of them describe the payload or a lever). */
export const TARGET_FIELDS = ['build', 'version', 'commit', 'url', 'mirrors', 'size', 'sha256', 'cdhash', 'minOs', 'dbSchema', 'blocked', 'pin', 'paused'] as const;
/** An install id (`<userData>/install-id`): what `targets` is keyed by. */
export const INSTALL_ID = /^[A-Za-z0-9_-]{6,64}$/;

export type KeyRole = 'active' | 'cold' | 'rotated';

export interface TrustedKey {
  id: string;
  role: KeyRole;
  pem: string;
}

export interface UpdateManifest {
  /** True when this install's `targets` entry was applied. */
  targeted: boolean;
  schema: number;
  /**
   * Publish counter, signed in and raised by every publish (`update-tool manifest`). A client
   * refuses a manifest older than the newest it has seen, so a replayed manifest cannot undo a
   * rollback, pin or block (review D-6). 0 when absent (manifests before 2026-11-19).
   */
  seq: number;
  appId: string;
  arch: string;
  channel: string;
  /** CFBundleVersion of the payload, allocated by `tools/release.sh` (last published + 1). */
  build: number;
  version: string;
  commit: string | null;
  url: string;
  /** Other copies of the same zip, tried in order after `url`. Trusted only through `sha256`. */
  mirrors: string[];
  size: number;
  sha256: string;
  /** The main executable's CDHash (`codesign -dv --verbose=4`), checked before the swap. */
  cdhash: string | null;
  /** LSMinimumSystemVersion of the payload: a Mac below it never downloads it. */
  minOs: string;
  /** The newest migration the payload knows; null when unstated (then it may not downgrade). */
  dbSchema: number | null;
  blocked: number[];
  pin: boolean;
  paused: boolean;
  keys: { add: string[]; revoke: string[] };
  notes: string;
  publishedAt: string;
}

export type VerifyResult =
  | { ok: true; manifest: UpdateManifest; signer: TrustedKey }
  | { ok: false; reason: string };

const HEX64 = /^[0-9a-f]{64}$/;
const CDHASH = /^[0-9a-f]{40,64}$/;

function posInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
}

/** An EC P-256 public key from PEM, or null. */
export function loadPublicKey(pem: string): KeyObject | null {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ec') return null;
    const curve = key.asymmetricKeyDetails?.namedCurve;
    return curve === 'prime256v1' || curve === 'P-256' ? key : null;
  } catch {
    return null;
  }
}

/** A key's name: the first 16 hex of the SHA-256 of its SPKI DER. */
export function keyId(pem: string): string | null {
  const key = loadPublicKey(pem);
  if (!key) return null;
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

/** Which trusted key signed `bytes`, or null. */
export function signerOf(bytes: Buffer, signature: Buffer, keys: readonly TrustedKey[]): TrustedKey | null {
  if (signature.length === 0 || signature.length > MAX_SIG_BYTES) return null;
  for (const k of keys) {
    const key = loadPublicKey(k.pem);
    if (!key) continue;
    try {
      if (cryptoVerify('sha256', bytes, key, signature)) return k;
    } catch {
      /* a malformed signature is just not this key's */
    }
  }
  return null;
}

function semverOk(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){0,2}$/.test(v);
}

function httpsUrl(raw: unknown, allowHttp: boolean): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || (allowHttp && u.protocol === 'http:')) return u.toString();
  } catch {
    /* not a URL */
  }
  return null;
}

/**
 * **The only gate.** Verify the signature over the raw bytes with a trusted key, then parse and
 * check the shape. `allowHttp` is true only in a dev run or a test build (`bootstrap.ts`); a
 * packaged release build has no way to set it.
 */
export function verifyManifest(
  bytes: Buffer,
  signature: Buffer,
  keys: readonly TrustedKey[],
  opts: { allowHttp?: boolean; installId?: string | null } = {},
): VerifyResult {
  if (bytes.length > MAX_MANIFEST_BYTES) return { ok: false, reason: 'too_large' };
  const signer = signerOf(bytes, signature, keys);
  if (!signer) return { ok: false, reason: 'bad_signature' };

  let p: Record<string, unknown>;
  try {
    p = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'not_json' };
  // This install's own entry, if the owner sent it one, replaces the channel default field by field.
  let targeted = false;
  const id = opts.installId;
  const targets = p.targets as Record<string, unknown> | undefined;
  if (id && INSTALL_ID.test(id) && targets && typeof targets === 'object' && Object.hasOwn(targets, id)) {
    const t = targets[id];
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const over: Record<string, unknown> = {};
      for (const f of TARGET_FIELDS) if (Object.hasOwn(t, f)) over[f] = (t as Record<string, unknown>)[f];
      // A target at a build the channel has since blocked is ignored, not fatal: the install falls
      // back to the channel default instead of being stranded (review #7).
      const blockedNow = Array.isArray(p.blocked) ? p.blocked : [];
      if (!blockedNow.includes(over.build ?? p.build)) {
        p = { ...p, ...over };
        targeted = true;
      }
    }
  }
  if (p.format !== MANIFEST_FORMAT) return { ok: false, reason: 'bad_field:format' };
  const minClient = p.minClientSchema === undefined ? 1 : p.minClientSchema;
  if (!posInt(minClient)) return { ok: false, reason: 'bad_field:minClientSchema' };
  if (minClient > CLIENT_SCHEMA) return { ok: false, reason: 'client_too_old' };
  if (!posInt(p.schema) || p.schema < 1) return { ok: false, reason: 'bad_field:schema' };
  if (p.seq !== undefined && !posInt(p.seq)) return { ok: false, reason: 'bad_field:seq' };
  for (const f of ['appId', 'arch', 'channel'] as const) {
    if (typeof p[f] !== 'string' || !(p[f] as string)) return { ok: false, reason: `bad_field:${f}` };
  }
  if (!posInt(p.build) || p.build < 1) return { ok: false, reason: 'bad_field:build' };
  if (typeof p.version !== 'string' || p.version.length > 40) return { ok: false, reason: 'bad_field:version' };
  const allowHttp = opts.allowHttp === true;
  const url = httpsUrl(p.url, allowHttp);
  if (!url) return { ok: false, reason: 'bad_field:url' };
  const mirrorsRaw = p.mirrors === undefined ? [] : p.mirrors;
  if (!Array.isArray(mirrorsRaw)) return { ok: false, reason: 'bad_field:mirrors' };
  const mirrors = mirrorsRaw.map((m) => httpsUrl(m, allowHttp)).filter((m): m is string => m !== null).slice(0, 4);
  if (!posInt(p.size) || p.size < 1) return { ok: false, reason: 'bad_field:size' };
  if (typeof p.sha256 !== 'string' || !HEX64.test(p.sha256)) return { ok: false, reason: 'bad_field:sha256' };
  if (p.cdhash !== undefined && (typeof p.cdhash !== 'string' || !CDHASH.test(p.cdhash))) return { ok: false, reason: 'bad_field:cdhash' };
  const minOs = p.minOs === undefined ? '13.0' : p.minOs;
  if (!semverOk(minOs)) return { ok: false, reason: 'bad_field:minOs' };
  if (p.dbSchema !== undefined && !posInt(p.dbSchema)) return { ok: false, reason: 'bad_field:dbSchema' };
  const blocked = p.blocked === undefined ? [] : p.blocked;
  if (!Array.isArray(blocked) || !blocked.every(posInt)) return { ok: false, reason: 'bad_field:blocked' };
  if (blocked.includes(p.build)) return { ok: false, reason: 'build_is_blocked' };
  for (const f of ['pin', 'paused'] as const) {
    if (p[f] !== undefined && typeof p[f] !== 'boolean') return { ok: false, reason: `bad_field:${f}` };
  }
  const keysRaw = (p.keys ?? {}) as { add?: unknown; revoke?: unknown };
  const add = Array.isArray(keysRaw.add) ? keysRaw.add.filter((k): k is string => typeof k === 'string' && keyId(k) !== null) : [];
  const revoke = Array.isArray(keysRaw.revoke) ? keysRaw.revoke.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{16}$/.test(k)) : [];

  return {
    ok: true,
    signer,
    manifest: {
      targeted,
      schema: p.schema,
      seq: posInt(p.seq) ? p.seq : 0,
      appId: p.appId as string,
      arch: p.arch as string,
      channel: p.channel as string,
      build: p.build,
      version: p.version,
      commit: typeof p.commit === 'string' ? p.commit.slice(0, 40) : null,
      url,
      mirrors,
      size: p.size,
      sha256: p.sha256,
      cdhash: typeof p.cdhash === 'string' ? p.cdhash : null,
      minOs,
      dbSchema: posInt(p.dbSchema) ? p.dbSchema : null,
      blocked,
      pin: p.pin === true,
      paused: p.paused === true,
      // Only a cold key may change which keys are trusted.
      keys: signer.role === 'cold' ? { add, revoke } : { add: [], revoke: [] },
      notes: typeof p.notes === 'string' ? p.notes.slice(0, 500) : '',
      publishedAt: typeof p.publishedAt === 'string' ? p.publishedAt.slice(0, 40) : '',
    },
  };
}

/**
 * The keys to verify with: the compiled ones and any a cold key added, minus any a cold key
 * revoked. A compiled cold key can never be revoked, so losing the active key is always
 * recoverable while the cold one is safe.
 */
export function trustedKeys(compiled: readonly TrustedKey[], rotation: { add: readonly string[]; revoke: readonly string[] }): TrustedKey[] {
  const out: TrustedKey[] = [];
  const seen = new Set<string>();
  const push = (k: TrustedKey) => {
    if (seen.has(k.id)) return;
    if (k.role !== 'cold' && rotation.revoke.includes(k.id)) return;
    seen.add(k.id);
    out.push(k);
  };
  for (const k of compiled) push(k);
  for (const pem of rotation.add) {
    const id = keyId(pem);
    if (id) push({ id, role: 'rotated', pem });
  }
  return out;
}

/** `13.6.1` ≥ `13.0`? Missing parts count as 0. */
export function osAtLeast(host: string, min: string): boolean {
  const a = host.split('.').map((n) => Number(n) || 0);
  const b = min.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export type SkipReason =
  | 'app'
  | 'channel'
  | 'paused'
  | 'os_too_old'
  | 'current'
  | 'known_bad'
  | 'schema_too_new';

export type Decision = { action: 'install'; downgrade: boolean } | { action: 'skip'; reason: SkipReason };

export interface DecideInput {
  manifest: UpdateManifest;
  /** This build's bundle id (`baked.appId`). */
  appId: string;
  channel: string;
  currentBuild: number;
  osVersion: string;
  /** The participant's database `user_version` (read from the file header), or null if unknown. */
  dbUserVersion: number | null;
  /** Builds that failed to start on this Mac and were rolled back from. */
  badBuilds: readonly number[];
}

/** What to do with a verified manifest. A signed `pin` or `blocked` is the only way down. */
export function decide(i: DecideInput): Decision {
  const m = i.manifest;
  if (m.appId !== i.appId || m.arch !== ARCH) return { action: 'skip', reason: 'app' };
  if (m.channel !== i.channel) return { action: 'skip', reason: 'channel' };
  if (m.paused) return { action: 'skip', reason: 'paused' };
  if (!osAtLeast(i.osVersion, m.minOs)) return { action: 'skip', reason: 'os_too_old' };
  if (m.build === i.currentBuild) return { action: 'skip', reason: 'current' };
  // A build that already failed to start here is never reinstalled, pinned or not: it would loop.
  if (i.badBuilds.includes(m.build)) return { action: 'skip', reason: 'known_bad' };
  const forced = m.pin || m.blocked.includes(i.currentBuild);
  if (m.build < i.currentBuild) {
    if (!forced) return { action: 'skip', reason: 'current' };
    if (m.dbSchema === null || (i.dbUserVersion !== null && m.dbSchema < i.dbUserVersion)) return { action: 'skip', reason: 'schema_too_new' };
    return { action: 'install', downgrade: true };
  }
  return { action: 'install', downgrade: false };
}
