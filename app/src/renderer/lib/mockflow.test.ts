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
import { classifyLearnerTurn } from '../../room/attempt.js';
import { createMockBridge } from './mockBridge.js';
import { quizControls } from './quiz.js';

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
      const card = posted.find((m) => m.id === answer.answerId!)!;

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
      expect(before!.threads.find((t) => t.anchorId === SEG)!.lockedByAnswerId).toBe(answer.answerId!);

      expect(await bridge.flowExplainBack({ answerId: answer.answerId! })).toEqual({ unlocked: true, anchorId: SEG });

      const after = await bridge.flowMessages({ fileId: 'f1' });
      expect(after!.threads.find((t) => t.anchorId === SEG)!.lockedByAnswerId).toBeNull();

      // Unlocking twice is not an error and does not unlock something else.
      expect(await bridge.flowExplainBack({ answerId: answer.answerId! })).toEqual({ unlocked: false, anchorId: null });
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
      await bridge.flowExplainBack({ answerId: answer.answerId! });

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

/**
 * ── the attempt loop (issue #47, `attempt-first.md` §2) ─────────────────────
 *
 * The mock is where the loop can be driven end to end without Electron, so it is also where the
 * decision can be *asserted* end to end: **no answer before one attempt**, on the same surface the
 * renderer reads. The classifier's cases quote R6's own lines, because they are the evidence.
 */
describe('classifyLearnerTurn (§2.2), the rule the mock loop reads', () => {
  it("reads R6's own answer requests as answer requests", () => {
    for (const line of ['answer?', 'please solve the question', "what's the answer", 'send me the answer']) {
      expect(classifyLearnerTurn(line)).toBe('answer_request');
    }
    expect(classifyLearnerTurn('I give up')).toBe('answer_request');
    // Curly apostrophes are what a Mac keyboard actually produces.
    expect(classifyLearnerTurn('what\u2019s the answer')).toBe('answer_request');
  });

  it('reads a one-sentence clarification as a question, not an attempt', () => {
    expect(classifyLearnerTurn('what does T mean?')).toBe('question');
    // An answer request that happens to end in "?" is still an answer request: order matters.
    expect(classifyLearnerTurn('what is the answer?')).toBe('answer_request');
  });

  it('reads agreement and emptiness as neither', () => {
    // `ledger.ts`'s own AGREEMENT vocabulary — rule 4's second ground, reused verbatim by §2.2.
    for (const line of ['ok', 'okay', 'got it', 'makes sense', 'i see', '   ', '']) {
      expect(classifyLearnerTurn(line)).toBe('other');
    }
  });

  it('reads everything else as an attempt, including a two-word one', () => {
    expect(classifyLearnerTurn('no tools')).toBe('attempt');
    expect(classifyLearnerTurn('it reads the session and has no tools of its own')).toBe('attempt');
    // Two sentences, the second a question: not the one-sentence clarification shape.
    expect(classifyLearnerTurn('I think the window is bounded. But why does that cost anything?')).toBe('attempt');
  });
});

describe('flow:tryHere', () => {
  it('picks an objective, asks one question at the short band, and opens the quiz when it lands', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, events } = harness();
      const view = await bridge.flowTryHere({ fileId: 'f1', segmentId: SEG, objectiveId: undefined });
      expect(view.refused).toBeNull();
      expect(view.objectiveId).not.toBe('');
      // The pick resolves before the question exists: the quiz is not in the return value.
      expect(view.flow.threads.find((t) => t.anchorId === SEG)?.quiz ?? null).toBeNull();

      // The question band is the Teacher's 3–6 s, not the Tester's 9–12: the learner asked for it.
      const thinking = events.filter((e) => e.type === 'agent.thinking').map((e) => e.thinking);
      expect(thinking.at(-1)!.role).toBe('challenger');
      expect(thinking.at(-1)!.etaMs).toBeLessThan(9000);

      await vi.advanceTimersByTimeAsync(9000);
      const after = await bridge.flowMessages({ fileId: 'f1' });
      const quiz = after!.threads.find((t) => t.anchorId === SEG)!.quiz!;
      expect(quiz.attempts).toBe(0);
      expect(quiz.answerShown).toBe(false);
      expect(quiz.elementId).toBe(view.objectiveId);

      const asked = threadFor(after!.room.messages, SEG).at(-1)!;
      expect(asked.decidedBy).toBe('rule:try_here');
      expect(asked.speaker.kind).toBe('agent');

      // And this is the state the composer asks for an attempt in, with no escape hatch.
      const controls = quizControls(quiz);
      expect(controls.placeholder).toBe('Your attempt…');
      expect(controls.showAnswer).toBe(false);
      expect(controls.tryAnother).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours an objective the learner picked in the panel', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      const view = await bridge.flowTryHere({ fileId: 'f1', segmentId: SEG, objectiveId: 'mock-btw-cost' });
      expect(view.objectiveId).toBe('mock-btw-cost');
      await vi.advanceTimersByTimeAsync(9000);
      const after = await bridge.flowMessages({ fileId: 'f1' });
      expect(after!.threads.find((t) => t.anchorId === SEG)!.quiz!.elementId).toBe('mock-btw-cost');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the answer lock (§2.3)', () => {
  /** Ask, then let the question land, so a quiz is open on SEG. */
  async function asked(bridge: ReturnType<typeof createMockBridge>) {
    await bridge.flowTryHere({ fileId: 'f1', segmentId: SEG });
    await vi.advanceTimersByTimeAsync(9000);
  }

  const quizOf = async (bridge: ReturnType<typeof createMockBridge>) =>
    (await bridge.flowMessages({ fileId: 'f1' }))!.threads.find((t) => t.anchorId === SEG)!.quiz!;

  it('withholds the answer, with a hint, on an answer request with no attempt', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      const before = (await bridge.flowMessages({ fileId: 'f1' }))!.room.ledger.covered;

      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: "what's the answer" });
      await vi.advanceTimersByTimeAsync(15000);

      const view = await bridge.flowMessages({ fileId: 'f1' });
      const last = threadFor(view!.room.messages, SEG).at(-1)!;
      expect(last.decidedBy).toBe('rule:answer_withheld');
      // Not an attempt, so the lock is still on and the ledger has not moved.
      const quiz = view!.threads.find((t) => t.anchorId === SEG)!.quiz!;
      expect(quiz.attempts).toBe(0);
      expect(quiz.answerShown).toBe(false);
      expect(view!.room.ledger.covered).toBe(before);
      expect(quizControls(quiz).showAnswer).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses flow:showAnswer before an attempt, whatever the renderer thinks', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      const refused = await bridge.flowShowAnswer({ roomId: 'mock-room-1', threadId: SEG });
      expect(refused.shown).toBe(false);
      expect(refused.refused).toMatch(/try it once/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts the attempt, moves the ledger on it, and cites the deck in the feedback', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);

      await bridge.flowSend({
        roomId: 'mock-room-1', segmentId: SEG,
        text: 'it cannot use tools, so a todo it says it wrote was never written',
      });
      await vi.advanceTimersByTimeAsync(15000);

      const view = await bridge.flowMessages({ fileId: 'f1' });
      const feedback = threadFor(view!.room.messages, SEG).at(-1)!;
      expect(feedback.decidedBy).toBe('rule:quiz_feedback');
      // §3: every point says where the deck settles it, as `p. N: "…"`. Item 4 makes it clickable.
      expect(feedback.body).toMatch(/p\. \d+: "/);
      // Feedback carries no new question (Rowland's constraint) — the next one is a click.
      expect(feedback.body).not.toContain('?');

      const quiz = view!.threads.find((t) => t.anchorId === SEG)!.quiz!;
      expect(quiz.attempts).toBe(1);
      expect(quiz.feedbackGiven).toBe(true);
      // The ledger moved, and on the learner's own words.
      const moved = view!.room.ledger.rows.find((r) => r.elementId === 'R1')!;
      expect(moved.state).not.toBe('not_yet');
      expect(threadFor(view!.room.messages, SEG).find((m) => m.id === moved.evidenceMsgId)!.speaker.kind)
        .toBe('student');

      // And *now* both controls are on offer.
      const controls = quizControls(quiz);
      expect(controls.tryAnother).toBe(true);
      expect(controls.showAnswer).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers a clarification without answering the quiz, and without counting it', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'what does "the history" mean here?' });
      await vi.advanceTimersByTimeAsync(15000);

      const view = await bridge.flowMessages({ fileId: 'f1' });
      expect(threadFor(view!.room.messages, SEG).at(-1)!.decidedBy).toBe('rule:quiz_clarify');
      const quiz = view!.threads.find((t) => t.anchorId === SEG)!.quiz!;
      expect(quiz.attempts).toBe(0);
      expect(quiz.feedbackGiven).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('nudges on an agreement-only turn', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'ok' });
      await vi.advanceTimersByTimeAsync(15000);
      const view = await bridge.flowMessages({ fileId: 'f1' });
      expect(threadFor(view!.room.messages, SEG).at(-1)!.decidedBy).toBe('rule:quiz_nudge');
      expect((await quizOf(bridge)).attempts).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the answer after one attempt, and moves nothing when it does', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'no tools of its own' });
      await vi.advanceTimersByTimeAsync(15000);

      const settled = (await bridge.flowMessages({ fileId: 'f1' }))!.room.ledger;
      const covered = settled.covered;

      const shown = await bridge.flowShowAnswer({ roomId: 'mock-room-1', threadId: SEG });
      expect(shown.shown).toBe(true);
      await vi.advanceTimersByTimeAsync(15000);

      const view = await bridge.flowMessages({ fileId: 'f1' });
      const answer = threadFor(view!.room.messages, SEG).at(-1)!;
      expect(answer.decidedBy).toBe('rule:answer_shown');
      expect(answer.body).toMatch(/p\. \d+: "/);
      // The one rule the report is about: the ledger never moves on a shown answer.
      expect(view!.room.ledger.covered).toBe(covered);

      const quiz = view!.threads.find((t) => t.anchorId === SEG)!.quiz!;
      expect(quiz.answerShown).toBe(true);
      // Try another survives; Show the answer cannot be asked for twice.
      const controls = quizControls(quiz);
      expect(controls.tryAnother).toBe(true);
      expect(controls.showAnswer).toBe(false);
      expect((await bridge.flowShowAnswer({ roomId: 'mock-room-1', threadId: SEG })).shown).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the answer to an answer request once an attempt exists', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'it has no tools' });
      await vi.advanceTimersByTimeAsync(15000);
      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'just tell me' });
      await vi.advanceTimersByTimeAsync(15000);

      const view = await bridge.flowMessages({ fileId: 'f1' });
      expect(threadFor(view!.room.messages, SEG).at(-1)!.decidedBy).toBe('rule:answer_shown');
      expect((await quizOf(bridge)).answerShown).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Try another asks a second question on the same anchor', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = harness();
      await asked(bridge);
      const first = (await quizOf(bridge)).elementId;
      await bridge.flowSend({ roomId: 'mock-room-1', segmentId: SEG, text: 'it has no tools and no memory' });
      await vi.advanceTimersByTimeAsync(15000);

      // **Try another** passes no objective, so §2.1's level-ordered pick runs again.
      const again = await bridge.flowTryHere({ fileId: 'f1', segmentId: SEG });
      expect(again.refused).toBeNull();
      await vi.advanceTimersByTimeAsync(9000);
      const quiz = await quizOf(bridge);
      // A fresh question: the attempt count is back to zero and the lock is back on.
      expect(quiz.attempts).toBe(0);
      expect(quiz.feedbackGiven).toBe(false);
      expect(quizControls(quiz).showAnswer).toBe(false);
      expect(first).not.toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
