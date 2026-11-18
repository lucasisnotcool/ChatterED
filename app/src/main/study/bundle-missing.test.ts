/**
 * The study guard does not depend on the bundle being found (security review, 2026-11-18): an
 * update installs an ordinary build, and a slot unlocked here stays capped whatever happens to
 * the bundle. And the bundle itself is kept in userData, read from there first.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { createApiKeyStore } from '../apikey.js';
import type { LLMClient, LlmRequest, LlmResult } from '../../room/llm/types.js';
import { BUNDLE_FORMAT, BUNDLE_VERSION, newCode, sealSlot, type KdfParams } from './crypto.js';
import { persistStudyBundle } from './ipc.js';
import { StudyCreditUsedUpError, StudyService } from './service.js';

const FAST: KdfParams = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };
const T0 = '2026-10-20T08:00:00.000Z';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function bundleFile(dir: string, code: string): string {
  const path = join(dir, 'keys.json');
  const payload = { slot: '07', provider: 'anthropic' as const, apiKey: 'sk-ant-api03-studystudystudystudy', budgetUsd: 1, models: { agent: 'm', orchestrator: 'm' }, issuedAt: T0 };
  writeFileSync(path, JSON.stringify({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, study: 't', createdAt: T0, kdf: FAST, slots: { '07': sealSlot(payload, code, FAST) } }));
  return path;
}

const inner: LLMClient = { kind: 'anthropic', complete: async (_r: LlmRequest): Promise<LlmResult> => ({ text: 'ok' }) as unknown as LlmResult };

describe('the guard with the bundle gone', () => {
  it('still stops a call over budget once a slot was unlocked here', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-missing-'));
    dirs.push(dir);
    const code = newCode('07');
    const { db, store } = openTestDb();
    const key = createApiKeyStore(join(dir, 'userData'));
    const first = new StudyService({ db, settings: store.settings, anthropicKey: key, bundlePath: bundleFile(dir, code), now: () => T0 });
    expect(first.unlock(code).ok).toBe(true);
    db.prepare(`INSERT INTO llm_usage (id, created_at, scope, model, backend, estimated_cost_usd) VALUES ('u1', '2026-10-20T09:00:00.000Z', 'group', 'm', 'anthropic', 2)`).run();

    let missing = 0;
    const after = new StudyService({ db, settings: store.settings, anthropicKey: key, bundlePath: null, onBundleMissing: () => (missing += 1) });
    const guarded = after.guard(inner, 'anthropic');
    expect(guarded).not.toBe(inner);
    await expect(guarded.complete({} as LlmRequest)).rejects.toThrow(StudyCreditUsedUpError);
    after.guard(inner, 'anthropic');
    expect(missing).toBe(1);
  });

  it('passes an ordinary install that never had a slot straight through', () => {
    const { db, store } = openTestDb();
    const dir = mkdtempSync(join(tmpdir(), 'study-none-'));
    dirs.push(dir);
    const s = new StudyService({ db, settings: store.settings, anthropicKey: createApiKeyStore(dir), bundlePath: null });
    expect(s.guard(inner, 'anthropic')).toBe(inner);
  });
});

describe('persistStudyBundle', () => {
  it('copies the shipped bundle into userData (0600), reads it from there, and leaves preload.txt in the app', () => {
    const dir = mkdtempSync(join(tmpdir(), 'study-keep-'));
    dirs.push(dir);
    const res = join(dir, 'Resources', 'study');
    mkdirSync(res, { recursive: true });
    const shipped = bundleFile(res, newCode('07'));
    writeFileSync(join(res, 'preload.txt'), 'S07-AAAA-BBBB-CCCC\n');
    const userData = join(dir, 'userData');
    const got = persistStudyBundle(shipped, userData);
    expect(got.bundlePath).toBe(join(userData, 'study', 'keys.json'));
    expect(got.preloadPath).toBe(join(res, 'preload.txt'));
    expect(readFileSync(got.bundlePath!, 'utf8')).toBe(readFileSync(shipped, 'utf8'));
    expect(statSync(got.bundlePath!).mode & 0o777).toBe(0o600);
    expect(existsSync(join(userData, 'study', 'preload.txt'))).toBe(false);
    // An update: the new bundle has no study folder. The copy is still found.
    expect(persistStudyBundle(join(dir, 'gone', 'keys.json'), userData)).toEqual({ bundlePath: join(userData, 'study', 'keys.json'), preloadPath: join(dir, 'gone', 'preload.txt') });
  });
});
