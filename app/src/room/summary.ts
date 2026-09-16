/**
 * **The artefact: a thread, summarised into the document** (issue #41,
 * `conversation-refinement.md` §5).
 *
 * `pivot-spec.md` §B1 had two ideas in it. One was that the *entry* answer should be a neutral
 * card, argued from a Peer contract that #32 retired and #36 replaced — that is gone, and the
 * Teacher answers the question now. The other was that a **typeset, capped, REFERENCE-register
 * block belongs in the learner's document**, and that one was always right; it was just attached
 * to the wrong moment. Lucas's #41 workflow attaches it to the right one: *"these artifacts /
 * references help the user to review and recall, without having to go through the conversation
 * again"*, and *"the conversation summarised to create that artefact should be retrievable,
 * continuable by the user."*
 *
 * Four properties, all enforced here or in `actor.ts` rather than asked for in a prompt:
 *
 *  1. **Nothing is inserted without the learner.** `rule:offer_summary` posts a one-line offer;
 *     the card itself exists only because `flow:summarise` was called. That is R1.
 *  2. **The cap is applied in code**, at 150 words — §B1's argument, at the length a conversation
 *     needs rather than the length one page of a deck needs.
 *  3. **It carries its source thread**, so the card is a handle on the conversation rather than a
 *     replacement for it: click expands, the composer continues, `flow:threadOf` is the lookup.
 *  4. **Regenerating replaces**, never appends. A second card for one thread is two records of
 *     the same conversation disagreeing in the learner's own document.
 */
import { truncateToWords, type Truncation } from './reference.js';
import { summarySystemBlock } from './prompts.summary.js';
import type { MessageRow, ParticipantRow } from './records.js';
import type { CacheableBlock, LlmRequest } from './llm/types.js';

/**
 * **150 words, not §B1's 120.**
 *
 * The 120 was for an answer to one question about one page. A thread that earned an artefact has
 * usually established two or three things — the prerequisite, the idea, the correction — and a cap
 * that forces two of them out produces a card the learner cannot use, which is a worse failure
 * than a card that is four lines long. It is still a cap, still applied in code, and still short
 * enough that the block does not become the document.
 */
export const SUMMARY_WORD_CAP = 150;

/**
 * The Teacher's one-line offer.
 *
 * Written here rather than generated, the same treatment `flow.handOffLine()` gets and for the
 * same reason: on camera the difference between a rule the learner can see and turn down and a
 * model's whim is the whole of `flow-build-plan.md` §4.2's argument. It never inserts anything —
 * the button on it does, and only if pressed.
 */
export const SUMMARY_OFFER_LINE =
  'Want me to put what we just worked out into the document, under this part? It lands as a short card you can come back to.';

/** How many Teacher turns a thread needs before the offer is worth making. */
export const OFFER_AFTER_TEACHER_TURNS = 2;

export interface SummaryRequestInput {
  model: string;
  roomId: string;
  deckTitle: string;
  segmentLabel?: string | null;
  page?: number | null;
  /** The thread, oldest first, already rendered to `Speaker: body` lines. */
  transcript: string;
  scriptCue?: string;
  /** The thread's anchor, for cost attribution (`src/main/cost/`). */
  anchorId?: string | null;
}

/**
 * The request. `meta.scope = 'reference'` because that is the register and the lane it bills to:
 * this call sees the **thread** and nothing else — no ledger, no pack, no whisper, and (the point
 * of the whole feature) no deck text, so it cannot summarise the slide instead.
 */
export function buildSummaryRequest(input: SummaryRequestInput): LlmRequest {
  const system: CacheableBlock[] = [
    {
      type: 'text',
      text: summarySystemBlock({
        deckTitle: input.deckTitle,
        ...(input.segmentLabel ? { segmentLabel: input.segmentLabel } : {}),
        ...(input.page !== undefined ? { page: input.page } : {}),
      }),
      cache_control: { type: 'ephemeral' },
    },
  ];
  return {
    model: input.model,
    // Generous against the 150-word cap: truncation is the app's job, and a request cut off
    // mid-sentence produces a worse first 150 words than one that is not.
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: `THE CONVERSATION:\n${input.transcript}` }],
    meta: {
      scope: 'reference',
      roomId: input.roomId,
      scriptCue: input.scriptCue,
      anchorId: input.anchorId ?? null,
      /**
       * **Billed as `summary`, not as `reference`** (`src/shared/cost.ts`). The port's vocabulary
       * is too coarse here: this travels in the reference lane because that is its register and
       * its client, but a learner asking what a deck cost them should see the cards they asked
       * for separately from the answers they were given. The scope was reserved on the cost track
       * for exactly this.
       */
      costScope: 'summary',
    },
  };
}

/** The card's body: the capped summary, and nothing appended. There is no hand-back any more. */
export function composeSummaryBody(raw: string): { body: string; truncated: boolean } {
  const { text, truncated }: Truncation = truncateToWords(raw, SUMMARY_WORD_CAP);
  return { body: text, truncated };
}

/**
 * One thread, as the summariser reads it.
 *
 * Labels rather than raw bodies, because *who said it* is load-bearing here in a way it is not on
 * the group path: the learner's own sentences are the ones the card must not attribute to the
 * teacher, and the teacher's are the ones that established anything. A summary card already in
 * the thread is left out — summarising a summary is how a record drifts.
 */
export function renderThread(
  messages: readonly MessageRow[],
  participants: Map<string, ParticipantRow>,
): string {
  return messages
    .filter((m) => (m.kind ?? 'turn') === 'turn')
    .filter((m) => m.body.trim().length > 0)
    .map((m) => {
      const p = participants.get(m.participant_id);
      const who = p?.kind === 'student' ? 'Learner' : (p?.display_name ?? 'Teacher');
      return `${who}: ${m.body.trim()}`;
    })
    .join('\n\n');
}

/**
 * Should the Teacher offer, on this thread, right now?
 *
 * Deliberately a pure function over what the actor already has: the thread's own rows and whether
 * the sitting has taught anything. "At most once per thread" is `alreadyOffered`, and a thread
 * that already carries a card is not offered one again — the learner has the artefact, and the
 * way to refresh it is Regenerate, not a second offer.
 */
export function shouldOfferSummary(input: {
  /** Every row in this thread, in order. */
  thread: readonly MessageRow[];
  /** Participant ids that belong to the Teacher. */
  teacherParticipantId: string;
  /** True when the sitting's taught set is non-empty — the thread taught something. */
  taughtSomething: boolean;
  alreadyOffered: boolean;
}): boolean {
  if (input.alreadyOffered || !input.taughtSomething) return false;
  if (input.thread.some((m) => (m.kind ?? 'turn') === 'summary')) return false;
  const teacherTurns = input.thread.filter(
    (m) => m.participant_id === input.teacherParticipantId && (m.kind ?? 'turn') === 'turn' && m.model !== 'rule:offer_summary',
  ).length;
  return teacherTurns >= OFFER_AFTER_TEACHER_TURNS;
}

/** The summary card already in a thread, if there is one. `flow:summarise` replaces it. */
export function summaryInThread(messages: readonly MessageRow[], threadId: string): MessageRow | undefined {
  return messages.find((m) => (m.kind ?? 'turn') === 'summary' && m.source_thread_id === threadId);
}
