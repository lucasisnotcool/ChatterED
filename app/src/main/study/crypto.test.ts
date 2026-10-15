/**
 * The study bundle's sealing: a code opens its own slot and no other, a typo is told apart from a
 * code for another build, and an entry moved to another slot fails rather than opening.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  DEFAULT_KDF,
  newCode,
  parseBundle,
  parseCode,
  sealSlot,
  slotId,
  unsealSlot,
  type KdfParams,
  type StudyBundle,
  type StudyPayload,
} from './crypto.js';

/** A cheap derivation for tests; the real one is DEFAULT_KDF. */
const FAST: KdfParams = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };

function payload(slot: string, apiKey = `sk-ant-api03-${slot.repeat(12)}`): StudyPayload {
  return {
    slot,
    provider: 'anthropic',
    apiKey,
    budgetUsd: 30,
    models: { agent: 'claude-sonnet-5-5', orchestrator: 'claude-sonnet-5-5' },
    issuedAt: '2026-10-15T00:00:00.000Z',
  };
}

function bundleOf(entries: Array<[string, string]>): StudyBundle {
  const slots: StudyBundle['slots'] = {};
  for (const [slot, code] of entries) slots[slot] = sealSlot(payload(slot), code, FAST);
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, study: 'test', createdAt: '2026-10-15', kdf: FAST, slots };
}

describe('codes', () => {
  it('makes a code of the documented shape for the slot', () => {
    const code = newCode('07');
    expect(code).toMatch(/^S07-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newCode('07')).not.toBe(code);
  });

  it('reads a code however it is typed, mapping the letters people mistake for digits', () => {
    expect(parseCode('S07-K3QX-9MZT-4HRA')).toEqual({ slot: '07', secret: 'K3QX9MZT4HRA' });
    expect(parseCode(' s07 k3qx 9mzt 4hra ')).toEqual({ slot: '07', secret: 'K3QX9MZT4HRA' });
    expect(parseCode('S07-K3QX-9MZT-4HRO')?.secret).toBe('K3QX9MZT4HR0');
    expect(parseCode('S07-K3QX-9MZT-4HRI')?.secret).toBe('K3QX9MZT4HR1');
    expect(parseCode('S07-K3QX-9MZT-4HRL')?.secret).toBe('K3QX9MZT4HR1');
  });

  it('refuses what cannot be a code', () => {
    expect(parseCode('')).toBeNull();
    expect(parseCode('hunter2')).toBeNull();
    expect(parseCode('S07-K3QX-9MZT')).toBeNull();
    expect(parseCode('S07-K3QX-9MZT-4HRU')).toBeNull(); // U is not Crockford
    expect(parseCode('P07-K3QX-9MZT-4HRA')).toBeNull();
  });

  it('pads slots to two digits and refuses anything else', () => {
    expect(slotId(7)).toBe('07');
    expect(slotId('12')).toBe('12');
    expect(slotId(101)).toBe('101');
    expect(() => slotId('x')).toThrow();
    expect(() => slotId(1000)).toThrow();
  });
});

describe('sealing', () => {
  const c1 = newCode('01');
  const c2 = newCode('02');
  const bundle = bundleOf([
    ['01', c1],
    ['02', c2],
  ]);

  it('opens a slot with its own code, and returns exactly what was sealed', () => {
    const opened = unsealSlot(bundle, c1);
    expect(opened).toEqual({ ok: true, payload: payload('01') });
    expect(unsealSlot(bundle, c2.toLowerCase().replace(/-/g, ' '))).toEqual({ ok: true, payload: payload('02') });
  });

  it('says "wrong code" for a typo and "no slot" for a code from another bundle', () => {
    const typo = c1.slice(0, -1) + (c1.endsWith('A') ? 'B' : 'A');
    expect(unsealSlot(bundle, typo)).toEqual({ ok: false, reason: 'wrong_code' });
    expect(unsealSlot(bundle, newCode('09'))).toEqual({ ok: false, reason: 'no_slot' });
    expect(unsealSlot(bundle, 'not a code')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('fails an entry moved to another slot, even with the right code', () => {
    const moved: StudyBundle = { ...bundle, slots: { ...bundle.slots, '02': bundle.slots['01']! } };
    const sameSecretOtherSlot = `S02${c1.slice(3)}`;
    expect(unsealSlot(moved, sameSecretOtherSlot)).toEqual({ ok: false, reason: 'wrong_code' });
  });

  it('fails a tampered entry', () => {
    const e = bundle.slots['01']!;
    const flipped = Buffer.from(e.data, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    const tampered: StudyBundle = { ...bundle, slots: { ...bundle.slots, '01': { ...e, data: flipped.toString('base64') } } };
    expect(unsealSlot(tampered, c1)).toEqual({ ok: false, reason: 'wrong_code' });
  });

  it('refuses to seal a payload under a code for another slot', () => {
    expect(() => sealSlot(payload('01'), c2, FAST)).toThrow(/slot 02/);
  });

  it('defaults to a derivation an offline guesser pays for', () => {
    expect(DEFAULT_KDF.N).toBeGreaterThanOrEqual(2 ** 16);
    expect(DEFAULT_KDF.r).toBeGreaterThanOrEqual(8);
  });
});

describe('parseBundle', () => {
  it('reads back a written bundle', () => {
    const b = bundleOf([['03', newCode('03')]]);
    expect(parseBundle(JSON.stringify(b))).toEqual(b);
  });

  it('refuses anything that is not a current bundle', () => {
    const b = bundleOf([['03', newCode('03')]]);
    expect(parseBundle('{')).toBeNull();
    expect(parseBundle(JSON.stringify({ ...b, format: 'other' }))).toBeNull();
    expect(parseBundle(JSON.stringify({ ...b, version: 2 }))).toBeNull();
    expect(parseBundle(JSON.stringify({ ...b, slots: {} }))).toBeNull();
    expect(parseBundle(JSON.stringify({ ...b, kdf: { ...b.kdf, name: 'pbkdf2' } }))).toBeNull();
  });
});
