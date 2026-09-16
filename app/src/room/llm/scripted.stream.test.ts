/**
 * The scripted client streams. It is the backend the A1 video runs on and the one every test
 * runs on, so if it answered in one block while the live clients streamed, scripted mode would
 * *look* like a different product from the one being studied.
 */
import { describe, expect, it } from 'vitest';
import { ScriptedClient } from './scripted.js';
import type { LlmRequest } from './types.js';

function request(scope: LlmRequest['meta']['scope'], cue = 'open'): LlmRequest {
  return {
    model: 'haiku',
    max_tokens: 400,
    system: [{ type: 'text', text: 'system' }],
    messages: [{ role: 'user', content: 'Student: go on then' }],
    meta: { scope, scriptCue: cue },
  };
}

describe('the scripted client', () => {
  it('streams prose in word chunks whose concatenation is the reply', async () => {
    const client = new ScriptedClient();
    const deltas: string[] = [];
    const result = await client.complete(request('group'), (d) => deltas.push(d));
    expect(result.text.length).toBeGreaterThan(0);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(result.text);
    // Word chunks, not characters: a per-character stream is a different visual rhythm.
    expect(deltas[0]!.length).toBeGreaterThan(3);
  });

  it('does not chunk a decision or a ledger blob', async () => {
    const client = new ScriptedClient();
    for (const scope of ['orchestrator', 'ledger'] as const) {
      const deltas: string[] = [];
      const result = await client.complete(request(scope), (d) => deltas.push(d));
      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toBe(result.text);
      // Still a whole object — a half-parsed decision is the 16 Sep silence all over again.
      expect(() => JSON.parse(result.text)).not.toThrow();
    }
  });

  it('paces the chunks when the app asks it to, and not otherwise', async () => {
    const paced = new ScriptedClient({ chunkMs: 6 });
    const startedAt = Date.now();
    await paced.complete(request('group'), () => {});
    expect(Date.now() - startedAt).toBeGreaterThan(5);

    const instant = new ScriptedClient();
    const t0 = Date.now();
    await instant.complete(request('group'), () => {});
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
