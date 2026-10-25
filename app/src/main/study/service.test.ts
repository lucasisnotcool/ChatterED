/**
 * The study service: a code makes the install a study install (key, backend, models), the credit
 * counts only Anthropic calls on the study key, and the guard stops a call over budget before it
 * is made.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { createApiKeyStore } from '../apikey.js';
import { SETTINGS_KEYS } from '../llm/detect.js';
import { agentModelKey, orchestratorModelKey } from '../llm/providers.js';
import type { LLMClient, LlmRequest, LlmResult } from '../../room/llm/types.js';
import { CREDIT_USED_UP_MESSAGE, STUDY_SETTINGS, type StudyStatus } from '../../shared/study.js';
import { BUNDLE_FORMAT, BUNDLE_VERSION, newCode, sealSlot, type KdfParams, type StudyBundle } from './crypto.js';
import { PRELOAD_FILE, StudyCreditUsedUpError, StudyService, keyFingerprint } from './service.js';

const FAST: KdfParams = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1, keyLen: 32 };
const STUDY_KEY = 'sk-ant-api03-studystudystudystudystudy';
const T0 = '2026-10-20T08:00:00.000Z';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: { bundle?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'study-'));
  dirs.push(dir);
  const code = newCode('07');
  let bundlePath: string | null = null;
  if (opts.bundle !== false) {
    const bundle: StudyBundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      study: 'test',
      createdAt: T0,
      kdf: FAST,
      slots: {
        '07': sealSlot(
          {
            slot: '07',
            provider: 'anthropic',
            apiKey: STUDY_KEY,
            budgetUsd: 30,
            models: { agent: 'claude-sonnet-5-5', orchestrator: 'claude-sonnet-5-5' },
            issuedAt: T0,
          },
          code,
          FAST,
        ),
      },
    };
    bundlePath = join(dir, 'keys.json');
    writeFileSync(bundlePath, JSON.stringify(bundle));
  }
  const { db, store } = openTestDb();
  const key = createApiKeyStore(join(dir, 'userData'));
  let clock = T0;
  const pushed: StudyStatus[] = [];
  const service = new StudyService({
    db,
    settings: store.settings,
    anthropicKey: key,
    bundlePath,
    now: () => clock,
    onChanged: (s) => pushed.push(s),
  });
  let n = 0;
  const spend = (usd: number, at: string, backend = 'anthropic') =>
    db
      .prepare(
        `INSERT INTO llm_usage (id, created_at, scope, model, backend, estimated_cost_usd)
         VALUES (@id, @at, 'group', 'claude-sonnet-5-5', @backend, @usd)`,
      )
      .run({ id: `u${++n}`, at, backend, usd });
  const preload = (text: string) => writeFileSync(join(dir, PRELOAD_FILE), text);
  return { service, store, key, code, spend, pushed, preload, setClock: (t: string) => (clock = t) };
}

function client(fail?: Error): LLMClient & { calls: number } {
  const c = {
    kind: 'anthropic' as const,
    calls: 0,
    async complete(_r: LlmRequest): Promise<LlmResult> {
      c.calls += 1;
      if (fail) throw fail;
      return { text: 'ok', model: 'claude-sonnet-5-5', ttftMs: 1, backend: 'anthropic' } as LlmResult;
    },
  };
  return c;
}

const REQ = { model: 'claude-sonnet-5-5', max_tokens: 10, system: [], messages: [], meta: { scope: 'group' } } as unknown as LlmRequest;

describe('an ordinary build', () => {
  it('is not a study build and guards nothing', async () => {
    const { service } = setup({ bundle: false });
    expect(service.status().available).toBe(false);
    expect(service.unlock('S07-AAAA-AAAA-AAAA').ok).toBe(false);
    const inner = client();
    expect(service.guard(inner, 'anthropic')).toBe(inner);
  });
});

describe('unlocking', () => {
  it('writes the key and makes the study the backend, both roles on the study models', () => {
    const { service, store, key, code } = setup();
    expect(service.status()).toMatchObject({ available: true, unlocked: false });
    const out = service.unlock(code);
    expect(out.ok).toBe(true);
    expect(key.get()).toBe(STUDY_KEY);
    const s = store.settings;
    expect(s.get(SETTINGS_KEYS.backend)).toBe('anthropic');
    expect(s.get(agentModelKey('anthropic'))).toBe('claude-sonnet-5-5');
    expect(s.get(orchestratorModelKey('anthropic'))).toBe('claude-sonnet-5-5');
    expect(s.get(STUDY_SETTINGS.keyFingerprint)).toBe(keyFingerprint(STUDY_KEY));
    // The key itself is never a settings row.
    expect(Object.values(s.all()).some((v) => v.includes(STUDY_KEY))).toBe(false);
    expect(service.status()).toMatchObject({ unlocked: true, active: true, slot: '07', budgetUsd: 30, remainingUsd: 30 });
  });

  it('explains a wrong code without changing anything', () => {
    const { service, key, code } = setup();
    const out = service.unlock(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'));
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/did not work/) });
    expect(key.get()).toBeNull();
    expect(service.status().unlocked).toBe(false);
  });
});

describe('a preloaded copy (2026-10-25)', () => {
  it('enters the code it carries on the first launch, with no typing', () => {
    const { service, store, key, code, preload } = setup();
    preload(`${code}\n`);
    const outcome = service.unlockPreloaded();
    expect(outcome).toMatchObject({ ok: true, status: { unlocked: true, slot: '07', budgetUsd: 30 } });
    expect(key.get()).toBe(STUDY_KEY);
    expect(store.settings.get(SETTINGS_KEYS.backend)).toBe('anthropic');
  });

  it('does nothing without a preload file, or on an ordinary build', () => {
    expect(setup().service.unlockPreloaded()).toBeNull();
    const plain = setup({ bundle: false });
    plain.preload('S07-AAAA-BBBB-CCCC');
    expect(plain.service.unlockPreloaded()).toBeNull();
  });

  it('never moves a participant back once a slot has been unlocked on this Mac', () => {
    const { service, key, code, preload } = setup();
    preload(code);
    expect(service.unlockPreloaded()?.ok).toBe(true);
    key.set('sk-ant-api03-mineminemineminemineminemine');
    expect(service.unlockPreloaded()).toBeNull();
    expect(key.get()).toBe('sk-ant-api03-mineminemineminemineminemine');
    expect(service.status()).toMatchObject({ active: false, endedReason: 'key_replaced' });
  });

  it('reports a code that does not open the bundle, and changes nothing', () => {
    const { service, key, preload } = setup();
    preload('S07-AAAA-BBBB-CCCC');
    expect(service.unlockPreloaded()).toMatchObject({ ok: false });
    expect(key.get()).toBeNull();
  });
});

describe('the credit', () => {
  it('counts Anthropic calls since the unlock, and nothing else', () => {
    const { service, code, spend } = setup();
    spend(5, '2026-10-19T00:00:00.000Z'); // before the unlock
    service.unlock(code);
    spend(4.25, '2026-10-20T09:00:00.000Z');
    spend(9, '2026-10-20T09:30:00.000Z', 'openai');
    spend(1.5, '2026-10-21T09:00:00.000Z');
    expect(service.status()).toMatchObject({ spentUsd: 5.75, remainingUsd: 24.25, exhausted: false });
    expect(service.status().fraction).toBeCloseTo(5.75 / 30);
  });

  it('stops counting when the participant puts in their own Anthropic key', () => {
    const { service, code, spend, key, setClock } = setup();
    service.unlock(code);
    spend(10, '2026-10-20T09:00:00.000Z');
    setClock('2026-10-21T00:00:00.000Z');
    key.set('sk-ant-api03-mineminemineminemine0000');
    expect(service.status()).toMatchObject({ active: false, endedReason: 'key_replaced', spentUsd: 10 });
    spend(50, '2026-10-22T09:00:00.000Z');
    expect(service.status().spentUsd).toBe(10);
  });

  it('carries the same count on when the same code is entered again', () => {
    const { service, code, spend, key, setClock } = setup();
    service.unlock(code);
    spend(3, '2026-10-20T09:00:00.000Z');
    key.clear();
    setClock('2026-10-21T00:00:00.000Z');
    expect(service.status()).toMatchObject({ active: false, endedReason: 'key_removed' });
    service.unlock(code);
    expect(service.status()).toMatchObject({ active: true, spentUsd: 3 });
  });
});

describe('the guard', () => {
  it('lets calls through under budget, and pushes the new credit after each', async () => {
    const { service, code, pushed } = setup();
    service.unlock(code);
    const inner = client();
    await service.guard(inner, 'anthropic').complete(REQ);
    expect(inner.calls).toBe(1);
    expect(pushed.at(-1)?.active).toBe(true);
  });

  it('refuses a call once the budget is spent, before it is made', async () => {
    const { service, code, spend } = setup();
    service.unlock(code);
    spend(30.01, '2026-10-20T09:00:00.000Z');
    const inner = client();
    await expect(service.guard(inner, 'anthropic').complete(REQ)).rejects.toThrow(StudyCreditUsedUpError);
    await expect(service.guard(inner, 'anthropic').complete(REQ)).rejects.toThrow(CREDIT_USED_UP_MESSAGE);
    expect(inner.calls).toBe(0);
  });

  it('never stops another backend, or the participant’s own key', async () => {
    const { service, code, spend, key } = setup();
    service.unlock(code);
    spend(40, '2026-10-20T09:00:00.000Z');
    const other = client();
    await service.guard(other, 'openai').complete(REQ);
    expect(other.calls).toBe(1);
    key.set('sk-ant-api03-mineminemineminemine0000');
    const own = client();
    await service.guard(own, 'anthropic').complete(REQ);
    expect(own.calls).toBe(1);
  });

  it('marks the credit used up when Anthropic refuses over the spend limit', async () => {
    const { service, code } = setup();
    service.unlock(code);
    const refusal = Object.assign(new Error('400 {"type":"error","error":{"message":"You have reached your specified workspace API usage limits."}}'), {
      status: 400,
    });
    await expect(service.guard(client(refusal), 'anthropic').complete(REQ)).rejects.toThrow(StudyCreditUsedUpError);
    expect(service.status()).toMatchObject({ exhausted: true, serverCapped: true });
  });

  it('passes any other error through unchanged', async () => {
    const { service, code } = setup();
    service.unlock(code);
    const boom = Object.assign(new Error('500 overloaded'), { status: 500 });
    await expect(service.guard(client(boom), 'anthropic').complete(REQ)).rejects.toBe(boom);
    expect(service.status().exhausted).toBe(false);
  });
});
