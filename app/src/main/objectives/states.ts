/**
 * **The ledger's moves, mirrored onto the file's objectives** (issue #38 §4).
 *
 * §4 is one sentence long and it is the whole design: *"The ledger's evaluator runs on every
 * learner turn, as now, but its candidates are the file's objectives (and prerequisite nodes),
 * not the room's pack. It proposes level moves with evidence; the same gates apply."*
 *
 * Because the pack **is** the tree (`objectives/pack.ts`), "its candidates are the file's
 * objectives" is already true by construction — `element.id` is `objective.id`. What is left is
 * this file: take the rows `applyLedgerRules` produced, after its four rules, and write the ones
 * that changed onto the file. Nothing here judges anything. If it did, there would be two
 * answers to "has this been explained?" and they would disagree.
 *
 * Two guards worth their lines:
 *
 *  - **Only ids that are in the tree.** A room whose pack is a fixture's — the scripted demo
 *    deck — has element ids that are not objectives, and a state row minted for one would be a
 *    node the panel can never draw.
 *  - **Only upward, and only what the ledger already gated.** `objectiveLevelFromLedger` clamps
 *    0–4 to 0–3 and does nothing else; the monotonicity, the confidence floor, the verbatim
 *    evidence check and the `defended` gate all happened before this was called.
 */
import { objectiveLevelFromLedger, type LearningObjectiveState } from '../../shared/objectives.js';
import type { ConceptPack, LedgerRow } from '../../room/records.js';
import type { TaughtItem } from '../../room/flow.js';
import type { LocalStore } from '../db/store.js';

/**
 * Write the moved rows onto the file's states. Returns the states that actually moved, so the
 * caller can emit one `objectives.state` per node rather than a redraw.
 */
export function mirrorLedger(
  store: LocalStore,
  input: { fileId: string; rows: readonly LedgerRow[]; changed: readonly string[] },
): LearningObjectiveState[] {
  const tree = store.objectives.tree(input.fileId);
  if (!tree || tree.status !== 'ready' || tree.objectives.length === 0) return [];
  const known = new Set(tree.objectives.map((o) => o.id));
  const moved: LearningObjectiveState[] = [];
  for (const elementId of input.changed) {
    if (!known.has(elementId)) continue;
    const row = input.rows.find((r) => r.element_id === elementId);
    if (!row) continue;
    const level = objectiveLevelFromLedger(row.level);
    const before = store.objectives.state(input.fileId, elementId);
    if (before && before.level === level && row.evidence_msg_id === null) continue;
    moved.push(
      store.objectives.setLevel({
        fileId: input.fileId,
        objectiveId: elementId,
        level,
        // The learner's **own** message, which is what rule 1 checked the quote against.
        evidenceMessageIds: row.evidence_msg_id ? [row.evidence_msg_id] : [],
        movedAt: row.updated_at,
      }),
    );
  }
  return moved;
}

/**
 * **The taught set, restored from the file's states** (§4: "`flow.ts`'s taught set reads it").
 *
 * The sitting's own `taught` array is in-memory state persisted with the flow session, so it is
 * about *this* sitting. `taughtAt` is about the file, and it is what makes the Tester able to
 * quiz something the learner was taught before they quit — inside `flow.ts`'s horizon, which for
 * an item with no `sessionId` is the plain six-hour age bound. Anything older than that is
 * filtered out by `quizzable()` and never reaches a question.
 *
 * Items already in the sitting's array win: they carry the session id, which is the more precise
 * horizon of the two.
 */
export function taughtFromStates(
  store: LocalStore,
  input: { fileId: string; pack: ConceptPack; existing: readonly TaughtItem[] },
): TaughtItem[] {
  const tree = store.objectives.tree(input.fileId);
  if (!tree || tree.status !== 'ready') return [];
  const seen = new Set(input.existing.map((t) => t.elementId));
  const order = new Map(tree.objectives.map((o) => [o.id, o.order]));
  const out: TaughtItem[] = [];
  for (const state of store.objectives.states(input.fileId)) {
    if (state.taughtAt === null || seen.has(state.objectiveId)) continue;
    if (!order.has(state.objectiveId)) continue;
    const element = input.pack.elements.find((e) => e.id === state.objectiveId);
    out.push({
      elementId: state.objectiveId,
      taughtAt: Date.parse(state.taughtAt),
      by: 'teacher',
      // Deliberately no `sessionId`: this was taught in a sitting that is over, and
      // `insideHorizon` falls back to the six-hour age bound for exactly that case.
      label: element?.learner_label ?? element?.label ?? state.objectiveId,
      ...(order.get(state.objectiveId) !== undefined ? { order: order.get(state.objectiveId)! } : {}),
    });
  }
  return out.filter((item) => Number.isFinite(item.taughtAt));
}
