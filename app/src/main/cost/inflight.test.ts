/**
 * A call to the API counted from the moment it is sent (`client.ts` `recordInFlight`; field-study
 * API test, 2026-11-18): quitting during a long tutorial read left requests billed that the study
 * credit never counted.
 */
import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from '../../room/llm/types.js';
import { costedClient } from './client.js';
import { CostLedger } from './ledger.js';

function setup() {
  const { db } = openTestDb();
  const ledger = new CostLedger({ db, readSetting: () => undefined, fileForRoom: () => null });
  const rows = () =>
    db.prepare('SELECT source, outcome, input_tokens, output_tokens, estimated_cost_usd FROM llm_usage ORDER BY created_at').all<{
      source: string;
      outcome: string;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
    }>();
  return { ledger, rows };
}

const request: LlmRequest = {
  model: 'claude-sonnet-5-5',
  max_tokens: 16_000,
  system: [{ type: 'text', text: 'S'.repeat(7_000) }],
  messages: [{ role: 'user', content: 'U'.repeat(28_000) }],
  images: [{ path: '/x/p-1.jpg', mime: 'image/jpeg', page: 1 }],
  meta: { scope: 'notes', costScope: 'tutorial', fileId: 'nb_1' },
};

describe('a call to the API, counted as it is sent', () => {
  it('holds an estimate while it runs, and the real row replaces it', async () => {
    const { ledger, rows } = setup();
    let during: ReturnType<typeof rows> = [];
    const inner: LLMClient = {
      kind: 'anthropic',
      async complete() {
        during = rows();
        return { text: '{}', model: 'claude-sonnet-5-5', usage: { ...EMPTY_USAGE, input_tokens: 12_000, output_tokens: 7_000 }, ttftMs: 1, backend: 'anthropic' };
      },
    };
    await costedClient(inner, ledger).complete(request);
    // 35,000 characters at 2.6 a token (on the high side), and one image.
    expect(during).toEqual([{ source: 'inflight', outcome: 'error', input_tokens: Math.ceil(35_000 / 2.6) + 1_600, output_tokens: 0, estimated_cost_usd: expect.any(Number) }]);
    expect(during[0]!.estimated_cost_usd).toBeGreaterThan(0);
    expect(rows().map((r) => [r.source, r.outcome, r.input_tokens, r.output_tokens])).toEqual([['live', 'ok', 12_000, 7_000]]);
  });

  it('keeps the estimate of a call the app quit during, so the credit counts it', async () => {
    const { ledger, rows } = setup();
    const never: LLMClient = { kind: 'anthropic', complete: () => new Promise(() => undefined) };
    void costedClient(never, ledger).complete(request);
    await Promise.resolve();
    // The process ends here; what the next launch reads:
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ source: 'inflight', input_tokens: Math.ceil(35_000 / 2.6) + 1_600 });
  });

  it('counts the output of an answer cut off while it was being written, capped at what the call may write', async () => {
    const { ledger, rows } = setup();
    let clock = 0;
    const writing: LLMClient = {
      kind: 'anthropic',
      complete: (_request, onDelta) => new Promise(() => {
        clock = 1_000;
        onDelta?.('{"title":"Finals"');
        clock = 31_000;
      }),
    };
    void costedClient(writing, ledger, undefined, { tickMs: 5, now: () => clock }).complete(request);
    await new Promise((r) => setTimeout(r, 30));
    // The quit: one in-flight row, its output 30 s of writing at 100 tokens a second.
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ source: 'inflight', output_tokens: 3_000 });
    clock = 10_000_000;
    await new Promise((r) => setTimeout(r, 20));
    expect(rows()[0]!.output_tokens).toBe(16_000 + 2_000);
  });

  it('replaces the estimate with the failure row when the call fails', async () => {
    const { ledger, rows } = setup();
    const failing: LLMClient = { kind: 'anthropic', complete: async () => { throw Object.assign(new Error('529'), { status: 529 }); } };
    await expect(costedClient(failing, ledger).complete(request)).rejects.toThrow('529');
    expect(rows().map((r) => [r.source, r.outcome])).toEqual([['live', 'error']]);
  });

  it('writes nothing ahead for the CLI, which is not billed per request', async () => {
    const { ledger, rows } = setup();
    let during = -1;
    const cli: LLMClient = { kind: 'claude-cli', async complete() { during = rows().length; return { text: '{}', model: 'sonnet', usage: EMPTY_USAGE, ttftMs: 1 }; } };
    await costedClient(cli, ledger).complete(request);
    expect(during).toBe(0);
    expect(rows()).toHaveLength(1);
  });
});
