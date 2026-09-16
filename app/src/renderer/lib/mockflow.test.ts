/**
 * The flow's IPC contract, driven through the dev mock.
 *
 * The renderer store is a `.svelte.ts` module and needs the Svelte compiler, which this suite
 * does not run; the mock bridge is the same surface without it, and it is what the store calls.
 * So: drive `createMockBridge()` through the sequence the video films — ask → REFERENCE card →
 * explain back → the learner's own words → Ellie → hand-off → Max — and assert the shape the
 * store and the components depend on. A mock that drifts from the contract is a renderer that
 * cannot be developed without Electron, which is the whole reason the mock exists.
 */
import { describe, expect, it, vi } from 'vitest';
import { claimsForAnchor, groupByAnchor, threadFor } from '../../shared/flowthread.js';
import type { RoomEvent } from '../../shared/types.js';
import { createMockBridge } from './mockBridge.js';

const SEG = 'seg_page3_lower';

function harness() {
  const bridge = createMockBridge();
  const events: RoomEvent[] = [];
  bridge.onEvent((e) => events.push(e));
  return { bridge, events };
}

describe('flow:messages', () => {
  it('is null for a document nobody has asked a question in', async () => {
    const { bridge } = harness();
    expect(await bridge.flowMessages({ fileId: 'f1' })).toBeNull();
  });
});

describe('flow:askHere', () => {
  it('posts the question as the learner and the answer as the REFERENCE voice, both anchored', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, events } = harness();
      const pending = bridge.flowAskHere({ fileId: 'f1', segmentId: SEG, question: 'what does /btw actually see?' });
      await vi.advanceTimersByTimeAsync(3000);
      const answer = await pending;

      expect(answer.anchorId).toBe(SEG);
      const posted = events.filter((e) => e.type === 'message.appended').map((e) => e.message);
      const question = posted.find((m) => m.id === answer.questionId)!;
      const card = posted.find((m) => m.id === answer.answerId)!;

      expect(question.speaker.kind).toBe('student');
      expect(question.anchorId).toBe(SEG);
      // Not 'student', and not 'agent' either: the REFERENCE voice is a scope, not an agent.
      expect(card.speaker.kind).toBe('reference');
      expect(card.anchorId).toBe(SEG);
      expect(card.body).toContain('───');
    } finally {
      vi.useRealTimers();
    }
  });

  it("locks the segment's thread until Explain it back", async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      const pending = bridge.flowAskHere({ fileId: 'f1', segmentId: SEG, question: 'what does it see?' });
      await vi.advanceTimersByTimeAsync(3000);
      const answer = await pending;

      const before = await bridge.flowMessages({ fileId: 'f1' });
      expect(before!.threads.find((t) => t.anchorId === SEG)!.lockedByAnswerId).toBe(answer.answerId);

      expect(await bridge.flowExplainBack({ answerId: answer.answerId })).toEqual({ unlocked: true, anchorId: SEG });

      const after = await bridge.flowMessages({ fileId: 'f1' });
      expect(after!.threads.find((t) => t.anchorId === SEG)!.lockedByAnswerId).toBeNull();

      // Unlocking twice is not an error and does not unlock something else.
      expect(await bridge.flowExplainBack({ answerId: answer.answerId })).toEqual({ unlocked: false, anchorId: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the thread, end to end', () => {
  it("runs learner -> Ellie -> hand-off -> Max on one anchor, and moves the ledger on the learner's words", async () => {
    vi.useFakeTimers();
    try {
      const { bridge, events } = harness();
      const asked = bridge.flowAskHere({ fileId: 'f1', segmentId: SEG, question: 'what does it see?' });
      await vi.advanceTimersByTimeAsync(3000);
      const answer = await asked;
      await bridge.flowExplainBack({ answerId: answer.answerId });

      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'it reads the session and has no tools' });
      await vi.advanceTimersByTimeAsync(6000);

      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'and the exchange is thrown away after' });
      await vi.advanceTimersByTimeAsync(20000);

      const view = await bridge.flowMessages({ fileId: 'f1' });
      const thread = threadFor(view!.room.messages, SEG);

      // Every turn landed on the segment, not in a room-level stream.
      expect(thread.length).toBeGreaterThanOrEqual(6);
      expect(thread.every((m) => m.anchorId === SEG)).toBe(true);

      const kinds = thread.map((m) => m.speaker.kind);
      expect(kinds[0]).toBe('student');
      expect(kinds[1]).toBe('reference');
      expect(kinds).toContain('agent');

      // The hand-off line is Ellie's own message, tagged as written by a rule.
      const handOff = thread.find((m) => m.byRule === 'handoff')!;
      expect(handOff.speaker.kind).toBe('agent');
      expect(handOff.body).toContain('over to you');

      // The Tester answers after it, and the counter is asked for on his hold only.
      const thinking = events.filter((e) => e.type === 'agent.thinking').map((e) => e.thinking);
      expect(thinking.some((t) => t.role === 'challenger' && t.showCounter && t.verb === 'reading')).toBe(true);
      expect(thinking.some((t) => t.role === 'peer' && !t.showCounter)).toBe(true);

      // One thread, and the glyph is on it.
      expect(groupByAnchor(view!.room.messages).map((t) => t.anchorId)).toEqual([SEG]);
      const claims = claimsForAnchor(SEG, view!.room.messages, view!.room.ledger);
      expect(claims.length).toBeGreaterThan(0);
      // …and its evidence is a learner message, never the REFERENCE card.
      const evidence = view!.room.ledger.rows.find((r) => r.elementId === claims[0]!.elementId)!.evidenceMsgId;
      expect(thread.find((m) => m.id === evidence)!.speaker.kind).toBe('student');
    } finally {
      vi.useRealTimers();
    }
  });
});
