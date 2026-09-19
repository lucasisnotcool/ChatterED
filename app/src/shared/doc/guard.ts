/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE GUARD (`docs/research/collab-doc.md` §5.4 — "the guard is code")
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * > **Learner-written text is never overwritten, moved, or undone by an agent.** … The guard is
 * > code: an agent transaction that touches a learner-authored range is rejected before it is
 * > applied, and re-expressed as a suggestion. It is unit-tested against the editor's document
 * > model, not against a prompt.
 *
 * This file is that sentence. It is the central safety claim of the product — the one thing an
 * AI-written document has to promise a learner before they will write in it — so it is written
 * to be *checkable* rather than clever:
 *
 *  - It reads the transaction's **steps**, not the ops that produced them. Whatever built the
 *    transaction — `ops.ts`, a paste, a drag, a command from a keymap — the same question is
 *    asked of the same evidence: *which ranges of the document that exists now would stop
 *    existing?*
 *  - It answers in positions of the **pre-transaction document**, because that is the document
 *    the caller can still show, log and reason about. A conflict the caller cannot locate is a
 *    conflict the caller cannot turn into a suggestion.
 *  - **A pure insertion never conflicts.** An agent may write between the learner's sentences
 *    all day; §5.4's rule is about overwriting, moving and undoing, not about proximity.
 *
 * A move (delete here, insert there) conflicts on its delete half, which is the point: "never
 * moved" is in the rule, and a move that kept the characters somewhere else would still have
 * taken them out of the paragraph the learner put them in.
 */

import type { Node } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { blockAttrs, eachBlock, isContainerBlock, textRuns } from './schema.js';
import type { DocAuthor } from './types.js';

export interface LearnerConflict {
  blockId: string;
  from: number;
  to: number;
  text: string;
}

function isUserText(marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]): boolean {
  return marks.some((mark) => mark.type.name === 'author' && (mark.attrs.by as DocAuthor) === 'user');
}

/**
 * Every learner-authored run inside `[from, to)`, clipped to the range and merged where the run
 * is only split by a mark boundary (a bold word in the middle of the learner's sentence).
 */
function learnerRunsIn(doc: Node, from: number, to: number): LearnerConflict[] {
  const found: LearnerConflict[] = [];
  eachBlock(doc, (node, pos) => {
    const end = pos + node.nodeSize;
    if (end <= from || pos >= to) return;
    // A q_block's text is its children's; they are visited in their own right, and reporting it
    // here as well would blame the container for a run the learner typed into a paragraph.
    if (isContainerBlock(node)) return;
    const { blockId } = blockAttrs(node);
    let open: LearnerConflict | null = null;
    for (const run of textRuns(node, pos + 1)) {
      const start = Math.max(run.from, from);
      const stop = Math.min(run.to, to);
      if (stop <= start || !isUserText(run.marks)) {
        open = null;
        continue;
      }
      const text = run.text.slice(start - run.from, stop - run.from);
      if (open && open.to === start) {
        open.to = stop;
        open.text += text;
      } else {
        open = { blockId, from: start, to: stop, text };
        found.push(open);
      }
    }
  });
  return found;
}

/**
 * **Does this range hold any of the learner's own writing?**
 *
 * "Any", not "all": the guard's question is never "is this range *entirely* theirs" but "would
 * this change touch something of theirs", and a replacement that swallows one learner word along
 * with nine of Ellie's is exactly the case §5.4 exists to stop.
 */
export function isLearnerRange(doc: Node, from: number, to: number): boolean {
  return learnerRunsIn(doc, from, to).length > 0;
}

/**
 * The learner text this transaction would delete or replace, in **pre-transaction** positions.
 *
 * How it reads the transaction: every step carries a `StepMap`, and `map.forEach` reports the
 * ranges that step *replaces*, in the coordinates of the document that step was applied to
 * (`tr.docs[i]`, with `state.doc` standing in for step 0). A range whose old half is empty is a
 * pure insertion and is skipped. Anything else is mapped back through the inverses of the
 * earlier steps, so a five-step transaction reports its damage in the document the caller holds.
 *
 * Mapping back through `invert()` is exact for positions that existed before the transaction,
 * which is every position that can hold learner text: text a step inserted *within* this same
 * transaction cannot be the learner's — the learner does not type inside an agent's transaction.
 */
export function learnerConflicts(state: EditorState, tr: Transaction): LearnerConflict[] {
  const conflicts: LearnerConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i]!;
    const map = step.getMap();
    map.forEach((oldStart, oldEnd) => {
      if (oldEnd <= oldStart) return; // pure insertion
      let from = oldStart;
      let to = oldEnd;
      for (let j = i - 1; j >= 0; j--) {
        const inverse = tr.steps[j]!.getMap().invert();
        from = inverse.map(from, -1);
        to = inverse.map(to, 1);
      }
      if (to <= from) return;
      for (const conflict of learnerRunsIn(state.doc, from, Math.min(to, state.doc.content.size))) {
        const key = `${conflict.from}:${conflict.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push(conflict);
      }
    });
  }
  conflicts.sort((a, b) => a.from - b.from);
  return conflicts;
}
