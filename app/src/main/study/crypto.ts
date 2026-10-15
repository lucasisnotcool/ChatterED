/**
 * **The study key bundle: one API key per participant, each sealed under that participant's code.**
 *
 * The study build ships a `keys.json` with one sealed entry per participant slot. A participant
 * types the code they were given (`S07-K3QX-…`), and that code opens their slot and no other. What
 * is sealed is a small JSON payload: the Anthropic key, the slot's budget and the models to run.
 *
 * Why per participant, not one shared password (decision, 2026-10-15): anything the app can
 * decrypt, a participant holding the password can decrypt too, so a key in the DMG is a key the
 * participant has. The cap therefore has to live where the participant cannot reach it, which is
 * the Anthropic Console: each slot's key belongs to its own workspace, and that workspace carries
 * the spend limit. One code opens one key, so a leaked code costs one budget and is revoked alone.
 *
 * The bundle sits in a DMG anyone could copy, so an attacker can guess codes offline. Two things
 * make that hopeless: a code carries 60 random bits (12 Crockford base32 characters), and each
 * guess costs one scrypt derivation (N = 2^16, r = 8: about 64 MB and a tenth of a second).
 *
 * AES-256-GCM with the slot id and the format string as associated data, so an entry cannot be
 * moved to another slot or replayed from another bundle format without failing authentication.
 *
 * **This file imports only `node:crypto`**, because `tools/study-keys.mjs` loads its compiled copy
 * (`dist/main/study/crypto.js`) to make the bundle. The app and the tool therefore cannot drift
 * apart.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync } from 'node:crypto';

export const BUNDLE_FORMAT = 'chattered-study-keys';
export const BUNDLE_VERSION = 1;

/** Crockford base32: no I, L, O or U, so a code read aloud or copied by hand survives. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 12 characters × 5 bits = 60 bits of secret per code. */
const SECRET_CHARS = 12;

export interface KdfParams {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
  keyLen: number;
}

export const DEFAULT_KDF: KdfParams = { name: 'scrypt', N: 2 ** 16, r: 8, p: 1, keyLen: 32 };

export interface SealedSlot {
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export interface StudyBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  /** A label for the study, shown nowhere secret: "CS3249 field phase, Oct 2026". */
  study: string;
  createdAt: string;
  kdf: KdfParams;
  slots: Record<string, SealedSlot>;
}

/** What one slot unseals to. */
export interface StudyPayload {
  slot: string;
  provider: 'anthropic';
  apiKey: string;
  budgetUsd: number;
  /** The models the study runs on, both roles. */
  models: { agent: string; orchestrator: string };
  issuedAt: string;
}

/** `07` from a number or a string; slots are two digits or more, always. */
export function slotId(n: number | string): string {
  const s = String(n).trim();
  if (!/^\d{1,3}$/.test(s)) throw new Error(`A slot is a number from 1 to 999, not "${s}".`);
  return s.padStart(2, '0');
}

/** A fresh code for a slot: `S07-K3QX-9MZT-4HRA`. */
export function newCode(slot: string): string {
  let secret = '';
  for (let i = 0; i < SECRET_CHARS; i++) secret += ALPHABET[randomInt(ALPHABET.length)];
  return `S${slot}-${secret.slice(0, 4)}-${secret.slice(4, 8)}-${secret.slice(8, 12)}`;
}

export interface ParsedCode {
  slot: string;
  /** The 12 secret characters, upper case, Crockford-normalised. */
  secret: string;
}

/**
 * **Reads a code as a person types it**: any case, spaces or no dashes, and the letters people
 * mistake for digits (O for 0, I and L for 1) mapped the Crockford way. Null when it cannot be a
 * code at all, so the screen can say "check the code" before spending a derivation on it.
 */
export function parseCode(raw: string): ParsedCode | null {
  const cleaned = raw.toUpperCase().replace(/[\s-]+/g, '');
  const m = /^S(\d{2,3})([0-9A-Z]{12})$/.exec(cleaned);
  if (!m) return null;
  const secret = m[2]!.replace(/O/g, '0').replace(/[IL]/g, '1');
  if ([...secret].some((c) => !ALPHABET.includes(c))) return null;
  return { slot: m[1]!, secret };
}

function deriveKey(secret: string, salt: Buffer, kdf: KdfParams): Buffer {
  return scryptSync(secret, salt, kdf.keyLen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 1024 * 1024 });
}

function aad(slot: string): Buffer {
  return Buffer.from(`${BUNDLE_FORMAT}/v${BUNDLE_VERSION}/slot:${slot}`, 'utf8');
}

export function sealSlot(payload: StudyPayload, code: string, kdf: KdfParams = DEFAULT_KDF): SealedSlot {
  const parsed = parseCode(code);
  if (!parsed) throw new Error('Not a study code.');
  if (parsed.slot !== payload.slot) throw new Error(`The code is for slot ${parsed.slot}, the payload for slot ${payload.slot}.`);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(parsed.secret, salt, kdf), iv);
  cipher.setAAD(aad(payload.slot));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export type UnsealResult =
  | { ok: true; payload: StudyPayload }
  | { ok: false; reason: 'malformed' | 'no_slot' | 'wrong_code' | 'bad_payload' };

/**
 * **Opens the participant's slot, or says why not.** "Wrong code" and "no such slot" are told
 * apart because the screen gives different advice for each, and the slot number is not a secret:
 * it is printed in the code itself.
 */
export function unsealSlot(bundle: StudyBundle, code: string): UnsealResult {
  const parsed = parseCode(code);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const sealed = bundle.slots[parsed.slot];
  if (!sealed) return { ok: false, reason: 'no_slot' };
  let plain: string;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(parsed.secret, Buffer.from(sealed.salt, 'base64'), bundle.kdf),
      Buffer.from(sealed.iv, 'base64'),
    );
    decipher.setAAD(aad(parsed.slot));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return { ok: false, reason: 'wrong_code' };
  }
  const payload = parsePayload(plain);
  if (!payload || payload.slot !== parsed.slot) return { ok: false, reason: 'bad_payload' };
  return { ok: true, payload };
}

function parsePayload(plain: string): StudyPayload | null {
  try {
    const p = JSON.parse(plain) as Partial<StudyPayload>;
    const models = p.models as Partial<StudyPayload['models']> | undefined;
    if (
      typeof p.slot !== 'string' ||
      p.provider !== 'anthropic' ||
      typeof p.apiKey !== 'string' ||
      p.apiKey.length === 0 ||
      typeof p.budgetUsd !== 'number' ||
      !(p.budgetUsd > 0) ||
      typeof models?.agent !== 'string' ||
      typeof models.orchestrator !== 'string' ||
      typeof p.issuedAt !== 'string'
    ) {
      return null;
    }
    return {
      slot: p.slot,
      provider: 'anthropic',
      apiKey: p.apiKey,
      budgetUsd: p.budgetUsd,
      models: { agent: models.agent, orchestrator: models.orchestrator },
      issuedAt: p.issuedAt,
    };
  } catch {
    return null;
  }
}

/** Validates a bundle read from disk. Null when it is not one this build can open. */
export function parseBundle(raw: string): StudyBundle | null {
  try {
    const b = JSON.parse(raw) as Partial<StudyBundle>;
    if (b.format !== BUNDLE_FORMAT || b.version !== BUNDLE_VERSION) return null;
    const kdf = b.kdf as Partial<KdfParams> | undefined;
    if (kdf?.name !== 'scrypt' || !Number.isInteger(kdf.N) || !Number.isInteger(kdf.r) || !Number.isInteger(kdf.p) || kdf.keyLen !== 32) {
      return null;
    }
    if (typeof b.slots !== 'object' || b.slots === null || Object.keys(b.slots).length === 0) return null;
    return {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      study: typeof b.study === 'string' ? b.study : '',
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : '',
      kdf: { name: 'scrypt', N: kdf.N!, r: kdf.r!, p: kdf.p!, keyLen: 32 },
      slots: b.slots,
    };
  } catch {
    return null;
  }
}
