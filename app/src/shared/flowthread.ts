/**
 * The arithmetic of the conversation inside the flow — pure, and shared by both sides.
 *
 * The main process builds `FlowRoomView.threads` with these functions; the renderer re-runs the
 * same ones against the live snapshot as `message.appended` and `ledger.updated` arrive, so the
 * flow never has to re-fetch a view to stay current. One implementation, two callers, and the
 * tests are node-only.
 *
 * The property this file exists to make checkable is `claimsForAnchor`'s:
 *
 *   **a REFERENCE answer can never move a segment's glyph.**
 *
 * It holds by construction rather than by care. A glyph is drawn for a claim only when the
 * ledger row's `evidenceMsgId` names a message anchored to that segment, and the ledger's
 * verbatim rule means evidence is always a *learner* message. A REFERENCE card is written by
 * the reference participant, so it can never be the evidence, so it can never contribute a
 * glyph. `pivot-spec.md` §B1: "nothing you read moves a row."
 */
import type { LedgerState, LedgerView, MessageView } from './types.js';

export interface AnchoredMessage {
  id: string;
  anchorId: string | null;
  seq: number;
}

export interface ThreadGrouping {
  anchorId: string;
  messageIds: string[];
}

/**
 * Every anchored message, grouped by segment, each thread in `seq` order and the threads
 * themselves ordered by their first message. Unanchored messages (the opener, and every message
 * written before migration 010) are not in any thread and are not lost — they are still on
 * `room.messages`, which is the whole transcript.
 */
export function groupByAnchor(messages: readonly AnchoredMessage[]): ThreadGrouping[] {
  const order: string[] = [];
  const byAnchor = new Map<string, AnchoredMessage[]>();
  for (const m of [...messages].sort((a, b) => a.seq - b.seq)) {
    if (m.anchorId === null) continue;
    let bucket = byAnchor.get(m.anchorId);
    if (!bucket) {
      bucket = [];
      byAnchor.set(m.anchorId, bucket);
      order.push(m.anchorId);
    }
    bucket.push(m);
  }
  return order.map((anchorId) => ({ anchorId, messageIds: byAnchor.get(anchorId)!.map((m) => m.id) }));
}

/** The messages on one segment's thread, in order. */
export function threadFor<T extends AnchoredMessage>(messages: readonly T[], anchorId: string): T[] {
  return messages.filter((m) => m.anchorId === anchorId).sort((a, b) => a.seq - b.seq);
}

export interface AnchorClaim {
  elementId: string;
  learnerLabel: string;
  state: LedgerState;
}

/**
 * The claims this segment has touched, for the glyph strip on its card.
 *
 * "Touched" means: the learner said something on **this thread** that the ledger took as the
 * evidence for that claim. Not "was mentioned near", not "the agent talked about" — the same
 * verbatim-evidence rule the rail has always used, read per anchor.
 *
 * Ordered by element id so the strip does not reshuffle when a second claim lands.
 */
export function claimsForAnchor(
  anchorId: string,
  messages: readonly AnchoredMessage[],
  ledger: Pick<LedgerView, 'rows'> | null,
): AnchorClaim[] {
  if (!ledger) return [];
  const here = new Set(messages.filter((m) => m.anchorId === anchorId).map((m) => m.id));
  return ledger.rows
    .filter((r) => r.evidenceMsgId !== null && here.has(r.evidenceMsgId))
    .map((r) => ({ elementId: r.elementId, learnerLabel: r.learnerLabel, state: r.state }))
    .sort((a, b) => (a.elementId < b.elementId ? -1 : 1));
}

/**
 * The REFERENCE card a thread is currently locked by, if any.
 *
 * Read off the transcript rather than off actor state, so it survives a relaunch: a thread whose
 * last reference answer has never been followed by a learner turn is still locked. The actor is
 * the authority (`reference.ts` property 4); this is the renderer's read of the same fact, and
 * `flow:messages` reports the actor's answer on top of it.
 */
export function isReferenceAnswer(m: MessageView): boolean {
  return m.speaker.kind === 'reference';
}
