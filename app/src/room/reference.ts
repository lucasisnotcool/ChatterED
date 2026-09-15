/**
 * The REFERENCE path — **a new scope, not a new agent** (`pivot-spec.md` §B1,
 * `flow-build-plan.md` §4.3).
 *
 * The learner clicks "+ Ask here" between two crops, types a question, and one neutral card is
 * inserted into the flow: the answer, a rule, and the hand-back line. It is the mechanism that
 * turns *"the AI gave me the answer"* from the disease into the hook, and it does that by being
 * four things at once, **all four enforced here and in `actor.ts` rather than in a prompt**:
 *
 *  1. it **does not take the floor** and does not increment `consecutive_agent_turns`;
 *  2. it **does not reset the silence timer** or its stage counter;
 *  3. it **can never be ledger evidence** — trivially true, since evidence must be a substring
 *     of a *learner* message, but asserted anyway because it is a product promise;
 *  4. it **locks Ellie and Max out of that segment's thread** until the learner presses
 *     *Explain it back*. Property 4 is the single most important line in this file.
 *
 * The 120-word cap is applied **in code, here**, not asked for in the prompt: a cap a model is
 * asked to respect is a cap that is exceeded on camera. The same truncation runs on the scripted
 * path, so a script cannot smuggle a longer answer past it either.
 */
import { referenceSystemBlock } from './prompts.reference.js';
import type { MessageRow, ParticipantRow } from './records.js';
import type { CacheableBlock, LlmRequest } from './llm/types.js';

/** `pivot-spec.md` §B1: "Capped at **120 words**, hard-truncated in code". */
export const REFERENCE_WORD_CAP = 120;

/**
 * The hand-back. It is the whole point of the card: reading an answer is not explaining one, and
 * the ledger row stays at `·` until the learner says it back in their own words.
 */
export const HAND_BACK_LINE = "Now say it back in your own words and I'll tell you what's missing.";

/** The rule between the answer and the hand-back, as drawn in §B1's sketch. */
export const RULE_LINE = '───';

/**
 * A reference "participant" is **not an agent**: `agent_key` is null, which is exactly what the
 * schema already means by it, and no row is added to the `agents` table. That keeps the voice
 * outside the roster by construction — `agentByRole` cannot find it, the orchestrator cannot
 * select it, and `rosterFor()` does not return it — and it needs no migration to widen the
 * `agents.role` CHECK. `pivot-spec.md` §B1 calls for "one `participants` row with
 * `role = 'reference'`"; `participants` has no role column, and `kind = 'agent'` with a null
 * `agent_key` says the same thing in the schema that exists.
 */
export const REFERENCE_DISPLAY_NAME = 'REFERENCE';

export function isReferenceParticipant(p: ParticipantRow): boolean {
  return p.kind === 'agent' && p.agent_key === null && p.display_name === REFERENCE_DISPLAY_NAME;
}

export function findReferenceParticipant(participants: readonly ParticipantRow[]): ParticipantRow | undefined {
  return participants.find(isReferenceParticipant);
}

export interface Truncation {
  text: string;
  words: number;
  truncated: boolean;
}

/**
 * Hard-truncate at `cap` words, on a sentence boundary when one is close enough that cutting
 * there loses less than a whole sentence would. A card that ends mid-clause reads as a bug; a
 * card that silently ran to 300 words reads as a tutorial, which is the failure this cap exists
 * to prevent.
 */
export function truncateToWords(text: string, cap = REFERENCE_WORD_CAP): Truncation {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= cap) return { text: text.trim(), words: words.length, truncated: false };

  const cut = words.slice(0, cap).join(' ');
  // Prefer the last sentence end inside the cut, but never throw away more than a fifth of it.
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  const keep = lastStop > cut.length * 0.8 ? cut.slice(0, lastStop + 1) : `${cut.replace(/[,;:\s]+$/, '')}…`;
  return { text: keep, words: keep.split(/\s+/).length, truncated: true };
}

/** The card's body, as one string: the capped answer, the rule, the hand-back. */
export function composeReferenceBody(raw: string): { body: string; truncated: boolean } {
  const { text, truncated } = truncateToWords(raw);
  return { body: `${text}\n\n${RULE_LINE}\n${HAND_BACK_LINE}`, truncated };
}

export interface ReferenceRequestInput {
  model: string;
  roomId: string;
  deckTitle: string;
  /** The extracted text of the segment the learner asked on. */
  segmentText: string;
  question: string;
  anchorId?: string | null;
  scriptCue?: string;
}

/**
 * The request. `meta.scope = 'reference'` is what every client keys on, and it is deliberately
 * not `'group'`: this call sees the segment and the question and **nothing else** — no
 * transcript, no ledger, no concept pack, and (by construction, since it never touches the
 * whisper store) no whisper.
 */
export function buildReferenceRequest(input: ReferenceRequestInput): LlmRequest {
  const system: CacheableBlock[] = [
    {
      type: 'text',
      text: referenceSystemBlock({ deckTitle: input.deckTitle, segmentText: input.segmentText }),
      cache_control: { type: 'ephemeral' },
    },
  ];
  return {
    model: input.model,
    // Generous against the 120-word cap: truncation is the app's job, and a request that cuts
    // the model off mid-sentence produces a worse first 120 words than one that does not.
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: input.question.trim() }],
    meta: {
      scope: 'reference',
      roomId: input.roomId,
      scriptCue: input.scriptCue,
    },
  };
}

// ── the gate (property 4) ───────────────────────────────────────────────────

export interface ReferenceAnswerState {
  answerId: string;
  anchorId: string | null;
  /** Set when the learner presses "Explain it back →". */
  explainedBackAt: number | null;
}

/**
 * **Neither Ellie nor Max may post into a segment's thread while an unanswered REFERENCE card is
 * sitting in it.** Enforced in code, not in the prompt (§B1's turn-taking rule, and
 * `flow-build-plan.md` §4.3's "single most important line in this section").
 *
 * The lock is per anchor. An answer with no anchor locks nothing — it cannot, because there is
 * no thread for the agents to be kept out of.
 */
export function isAnchorLocked(answers: readonly ReferenceAnswerState[], anchorId: string | null): boolean {
  if (anchorId === null) return false;
  return answers.some((a) => a.anchorId === anchorId && a.explainedBackAt === null);
}

/** Any anchor still locked. Used by the actor when a turn is not itself anchored. */
export function anyAnchorLocked(answers: readonly ReferenceAnswerState[]): boolean {
  return answers.some((a) => a.anchorId !== null && a.explainedBackAt === null);
}

export function explainBack(
  answers: readonly ReferenceAnswerState[],
  answerId: string,
  now: number,
): ReferenceAnswerState[] {
  return answers.map((a) => (a.answerId === answerId && a.explainedBackAt === null ? { ...a, explainedBackAt: now } : a));
}

/**
 * Every message on one segment's thread, in order.
 *
 * Deliberately a **pure filter over `messages.forRoom()`** rather than a `forAnchor` method on
 * `MessagesRepo`: `src/main/db/repos/core.ts` is owned by the geometry-pipeline work in flight
 * this week, and a room's transcript is small enough that the index added by migration 010 buys
 * nothing at this size. Promote it to SQL (`WHERE room_id = ? AND anchor_id = ? ORDER BY seq`)
 * when that file is free — the index is already there for it.
 */
export function messagesForAnchor(messages: readonly MessageRow[], anchorId: string): MessageRow[] {
  return messages.filter((m) => m.anchor_id === anchorId).sort((a, b) => a.seq - b.seq);
}
