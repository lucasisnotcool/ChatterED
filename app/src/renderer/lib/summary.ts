/**
 * **The artefact, as arithmetic** (issue #41, `conversation-refinement.md` §5).
 *
 * Lucas's suggested workflow has three steps and this file is the middle one:
 *
 *   1. the live conversation happens,
 *   2. a **button** turns what that conversation taught into a durable card,
 *   3. the conversation behind the card stays *retrievable and continuable*.
 *
 * Step 2 is the main process's (`flow:summarise` writes the card). Steps 1 and 3 are a layout
 * question, and the answer this file encodes is: **a thread that has been summarised is shown as
 * its artefact, and the conversation is what the artefact opens.** Not the artefact appended to
 * the bottom of forty turns — that is the thing the learner was trying not to scroll through.
 *
 * Everything here is pure and node-testable, for the reason `flowthread.ts` gives: the rules
 * about *which card is which* are worth being able to check without a browser.
 */
import type { MessageView } from '../../shared/types.js';

/**
 * The cap `flow:summarise` enforces in code, repeated here so the renderer can *say* it.
 *
 * `pivot-spec.md` §B1's argument for capping the old REFERENCE card at 120 words applies
 * unchanged at 150: a cap a model is merely asked for is a cap exceeded on camera.
 */
export const SUMMARY_WORD_CAP = 150;

/** The REFERENCE-style header §C4 requires: an artefact must say, on its face, that it is one. */
export const SUMMARY_HEADER = 'Summary · written by ChatterED from this conversation';

/** The `byRule` value on the Teacher's one-line offer (`rule:offer_summary`). */
export const OFFER_SUMMARY_RULE = 'offer_summary';

/** A `MessageView` from a build whose `MessageKind` has not landed yet reads as a plain turn. */
type MaybeKinded = MessageView & { kind?: string; sourceThreadId?: string | null };

/**
 * Is this card the artefact rather than a turn?
 *
 * `'answer'` counts. Migration 017 rewrites the legacy REFERENCE entry cards into `'summary'`,
 * but a vault opened on a newer build before it runs still holds them, and the honest way to
 * render one is as what it became — a typeset block written by the app, not by a person and not
 * really by a persona either — rather than as a chat turn from a voice that no longer exists.
 */
export function isArtefact(message: MessageView): boolean {
  const kind = (message as MaybeKinded).kind;
  return kind === 'summary' || kind === 'answer';
}

/** The thread this artefact was written from. Falls back to its own anchor for a legacy card. */
export function sourceThreadOf(message: MessageView): string | null {
  return (message as MaybeKinded).sourceThreadId ?? message.anchorId;
}

export interface ThreadSplit {
  /** The conversation: everything that is not the artefact, in order. */
  turns: MessageView[];
  /**
   * The artefact for this thread, if it has one. At most one: `flow:summarise` *replaces* rather
   * than appends, so a second press is a regeneration and not a second card. If a build ever
   * produces two, the newest wins — a stale artefact under a fresh one is the one arrangement
   * that actively misinforms.
   */
  artefact: MessageView | null;
}

export function splitThread(anchorId: string, messages: readonly MessageView[]): ThreadSplit {
  const turns: MessageView[] = [];
  let artefact: MessageView | null = null;
  for (const m of messages) {
    if (!isArtefact(m)) {
      turns.push(m);
      continue;
    }
    // Only the artefact *of this thread*. A deck-scope summary sits on the deck anchor and a
    // segment's does not, so this can only ever reject a card the main process mis-anchored.
    if (sourceThreadOf(m) !== anchorId && m.anchorId !== anchorId) continue;
    if (!artefact || m.seq > artefact.seq) artefact = m;
  }
  return { turns, artefact };
}

/** The Teacher's one-line offer, which the card turns into a chip rather than a paragraph. */
export function offersSummary(message: MessageView): boolean {
  return message.byRule === OFFER_SUMMARY_RULE;
}

/**
 * Is **Summarise into the document** worth offering on this thread yet?
 *
 * One agent turn. Below that there is nothing taught to summarise, and an action that produces
 * an empty artefact is worse than no action — it teaches the learner that the button lies.
 * Deliberately looser than `rule:offer_summary`'s own threshold (two Teacher turns *and* a
 * taught objective): the rule decides when the app **volunteers**, this decides when the learner
 * is **allowed**, and the learner is allowed earlier than the app volunteers.
 */
export function canSummarise(turns: readonly MessageView[]): boolean {
  return turns.some((m) => m.speaker.kind === 'agent' && !offersSummary(m));
}

/**
 * The conversation behind an artefact, in order.
 *
 * `flow:threadOf` is authoritative and returns **ids**, for the reason its docstring gives: the
 * bodies already travel on `room.messages` and two copies could disagree. `ids` is null when the
 * channel is not on this build yet, and then the local grouping is used — which is the same
 * answer in every case except a thread whose messages the main process reorders, and it does not.
 */
export function conversationFor(
  threadId: string,
  messages: readonly MessageView[],
  ids: readonly string[] | null,
): MessageView[] {
  if (ids && ids.length > 0) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    return ids.flatMap((id) => {
      const found = byId.get(id);
      return found && !isArtefact(found) ? [found] : [];
    });
  }
  return messages
    .filter((m) => m.anchorId === threadId && !isArtefact(m))
    .sort((a, b) => a.seq - b.seq);
}

/** *"Show the conversation · 6 turns"* / *"Hide the conversation"*. */
export function conversationLabel(open: boolean, turns: number): string {
  if (open) return 'Hide the conversation';
  return turns === 0 ? 'Show the conversation' : `Show the conversation · ${turns} turns`;
}
