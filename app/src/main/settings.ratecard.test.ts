/**
 * **Two seams a live run found, both on the main side.**
 *
 * 1. `rateCardOverride` was not on `SettingsPatch`, so the Settings box did not round-trip: the
 *    override could be typed and was thrown away at the IPC boundary.
 * 2. `cost.updated` was not a member of `RoomEvent`, so a renderer holding one `onEvent`
 *    subscription never saw a call being counted and was ticking its counters off
 *    `turn.released` — which fires on turns and misses the orchestrator, the ledger, both
 *    ingests and the summary calls entirely.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppService } from './ipc.js';
import { openTestDb } from '../test-support/db.js';
import type { RoomEvent } from '../shared/types.js';

function service(sent: { channel: string; payload: unknown }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'chattered-settings-'));
  const app = new AppService({
    ...openTestDb(),
    appVersion: '0.0.0-test',
    osVersion: 'darwin test',
    userDataDir: join(dir, 'ChatterED'),
    logDir: join(dir, 'logs'),
    getWindow: () =>
      ({ webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }) as never,
  });
  return app;
}

describe('the rate-card override round-trips', () => {
  it('comes back on the view exactly as it was typed', () => {
    const app = service();
    const json = '{"claude-sonnet-5": {"input": 2, "output": 10}}';
    expect(app.saveSettings({ rateCardOverride: json })).toEqual({ ok: true });

    const view = app.settingsView();
    expect(view.rateCardOverride).toBe(json);
    expect(view.rateCardErrors).toEqual([]);
    expect(view.rateCardDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * **A malformed entry is kept, not rejected.** The parser already falls back entry by entry;
   * refusing the write would leave the learner's box holding a value the app had discarded, with
   * no way to edit the one line that is wrong.
   */
  it('stores a card with a bad entry and says which entry, rather than refusing it', () => {
    const app = service();
    const json = '{"claude-sonnet-5": {"input": 2, "output": 10}, "claude-haiku-4-5": {"input": "free"}}';
    expect(app.saveSettings({ rateCardOverride: json })).toEqual({ ok: true });

    const view = app.settingsView();
    expect(view.rateCardOverride).toBe(json);
    expect(view.rateCardErrors).toHaveLength(1);
    expect(view.rateCardErrors[0]).toContain('claude-haiku-4-5');
  });

  it('clears back to the built-in card on an empty string', () => {
    const app = service();
    app.saveSettings({ rateCardOverride: '{"claude-sonnet-5": {"input": 2, "output": 10}}' });
    app.saveSettings({ rateCardOverride: '   ' });
    expect(app.settingsView().rateCardOverride).toBe('');
    expect(app.settingsView().rateCardErrors).toEqual([]);
  });

  it('is untouched by a patch that does not mention it', () => {
    const app = service();
    const json = '{"claude-sonnet-5": {"input": 2, "output": 10}}';
    app.saveSettings({ rateCardOverride: json });
    app.saveSettings({ replySpeed: 'faster' });
    expect(app.settingsView().rateCardOverride).toBe(json);
  });
});

describe('cost.updated reaches the room event stream', () => {
  /**
   * Driven through the client the app actually builds — `llm()` composes
   * `loggedClient(costedClient(raw))` with the service's own sink — so what is asserted is the
   * path a real turn takes, not a hand-called emitter.
   */
  it('pushes the same CostUpdate on the dedicated channel and on the room stream', async () => {
    const sent: { channel: string; payload: unknown }[] = [];
    const app = service(sent);
    const client = app.llm();

    await client.complete({
      model: 'claude-sonnet-5',
      max_tokens: 100,
      system: [{ type: 'text', text: 'x' }],
      messages: [{ role: 'user', content: 'hello' }],
      meta: { scope: 'reference', costScope: 'summary', anchorId: 'seg_3' },
    });

    const cost = sent.filter((s) => s.channel === 'cost:updated');
    const stream = sent.filter(
      (s) => s.channel === 'room:event' && (s.payload as RoomEvent).type === 'cost.updated',
    );
    expect(cost).toHaveLength(1);
    expect(stream).toHaveLength(1);
    // The same object, so a renderer reading either gets the same figures — and must not read both.
    expect((stream[0]!.payload as { update: unknown }).update).toBe(cost[0]!.payload);

    // The summary lane is billed as its own scope, which is what the cost track reserved it for.
    const update = cost[0]!.payload as { call: { scope: string; anchorId: string | null } };
    expect(update.call.scope).toBe('summary');
    expect(update.call.anchorId).toBe('seg_3');
  });
});
