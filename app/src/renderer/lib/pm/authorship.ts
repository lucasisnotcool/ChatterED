/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHO TYPED THIS? — STAMPING THE LEARNER'S OWN WORDS (`collab-doc.md` §5.4, §6)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `schema.ts` puts the whole safety argument in one mark and then says who has to maintain it:
 *
 * > `inclusive: false` is load-bearing … text typed at a span boundary carries no author mark at
 * > all — **which is why T4 must stamp `author{by:'user'}` on every learner insertion from a
 * > plugin rather than leaning on mark inheritance.**
 *
 * This file is that plugin. It is the *only* reason the guard has anything to protect, and the
 * only reason §6's "the learner's own doc text counts" can be computed at all, so it is written
 * to the same standard as `guard.ts`: it reads **steps**, not intentions.
 *
 * ## The rule, stated positively
 *
 * A transaction stamps `author{by:'user'}` over everything it **inserted** when it is *learner
 * input*, and learner input is everything that is not one of three named exceptions:
 *
 *  1. **Our own agent transactions** (`meta(AGENT_TR)`): an agent's text is already carrying the
 *     agent's mark and its `editId`, from the first frame of the typing animation.
 *  2. **Anything dispatched with `addToHistory: false`**: that is this app's convention for "the
 *     program did this, not the person" — every agent batch, every suggestion resolution, every
 *     ingest window.
 *  3. **Undo and redo**: they re-insert a slice that already carries its original author, and
 *     restamping it would quietly transfer Ellie's sentences to the learner one undo at a time.
 *
 * Everything else — a keystroke, a paste, a drag inside the document, a list command, an input
 * rule — is the learner, and is stamped. Defaulting *to* the learner is the safe direction: the
 * cost of a false positive is that an agent may not rewrite a sentence it wrote itself; the cost
 * of a false negative is an agent overwriting the learner's words, which is the one thing the
 * product promises will never happen.
 *
 * ## Why insertion ranges and not the selection
 *
 * `handleTextInput` sees one keystroke and never sees a paste, a drop, an input rule's
 * replacement or an `Enter` that splits a block. `appendTransaction` sees all of them as the same
 * evidence — a `StepMap` whose new half is longer than its old half — and that is what
 * `insertedRanges` reads. Pure, and unit-tested without a DOM.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Mark, type Node } from 'prosemirror-model';
import { assignMissingBlockIds, authorMark, notesSchema } from '../../../shared/doc/schema.js';

/**
 * Set on every transaction generated on an agent's (or the ingest's) behalf. The plain string
 * `'agent'` is the cross-track convention the lead settled — anything that dispatches an
 * `ApplyResult.tr` or an `appendWindow` transaction sets it, here or anywhere else.
 */
export const AGENT_TR = 'agent';

/** prosemirror-history tags its own transactions with the meta of its `PluginKey("history")`. */
const HISTORY_META = 'history$';

export const authorshipKey = new PluginKey('chattered:authorship');

export interface Range {
  from: number;
  to: number;
}

/** Overlapping and abutting ranges folded together, in document order. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

/**
 * Everything these transactions **inserted**, in the positions of the document they leave behind.
 *
 * Each step's `StepMap` reports `(oldStart, oldEnd, newStart, newEnd)`; `[newStart, newEnd)` is
 * the content that step put there. Those positions are in that step's own output document, so
 * they are mapped forward through every later step of the same transaction and then through the
 * whole mapping of every later transaction — which is what makes the result usable against
 * `newState.doc` inside an `appendTransaction`.
 *
 * Bias: `-1` on the start and `+1` on the end, so a range stays *open* as later steps insert at
 * its edges. A range that closes to nothing is dropped.
 */
export function insertedRanges(transactions: readonly Transaction[]): Range[] {
  const ranges: Range[] = [];
  for (let t = 0; t < transactions.length; t++) {
    const tr = transactions[t]!;
    for (let i = 0; i < tr.steps.length; i++) {
      tr.steps[i]!.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd <= newStart) return;
        let from = newStart;
        let to = newEnd;
        for (let j = i + 1; j < tr.steps.length; j++) {
          const map = tr.steps[j]!.getMap();
          from = map.map(from, -1);
          to = map.map(to, 1);
        }
        for (let u = t + 1; u < transactions.length; u++) {
          from = transactions[u]!.mapping.map(from, -1);
          to = transactions[u]!.mapping.map(to, 1);
        }
        if (to > from) ranges.push({ from, to });
      });
    }
  }
  return mergeRanges(ranges);
}

/**
 * Is this transaction the learner's own input?
 *
 * See the three exceptions in the file header. `tr.docChanged` is part of the question because a
 * pure selection move inserts nothing and there is nothing to stamp.
 */
export function isLearnerInput(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  if (tr.getMeta(AGENT_TR)) return false;
  if (tr.getMeta('addToHistory') === false) return false;
  if (tr.getMeta(HISTORY_META) !== undefined) return false;
  return true;
}

/**
 * Put `author{by:'user'}` over these ranges, replacing whatever author mark was inherited there.
 *
 * `removeMark` before `addMark` is not belt and braces: text typed *inside* an existing span
 * inherits that span's marks (`inclusive: false` only governs the ends), so the single most
 * likely way for the learner's words to end up attributed to Ellie is a learner typing into the
 * middle of Ellie's sentence. Without the remove, `addMark` would find a mark of the same type
 * already there and the ranges would fight.
 */
/** Is there any text in `[from, to)`? `addMark` over a range with none is a wasted step. */
function hasText(doc: Node, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (node.isText) found = true;
    return !found;
  });
  return found;
}

/**
 * The `at` of the learner's own author mark immediately before this range, if there is one.
 *
 * **Why a continuous run has to share one `at`.** A mark is minted per transaction, and typing
 * is one transaction per keystroke, so a fresh timestamp for every character makes every
 * character's mark unequal to its neighbour's — ProseMirror cannot merge the text nodes, and the
 * learner's sentence is stored, serialised and rendered as one node and one `<span>` *per
 * character*. On screen that is visible: each span is its own inline box, so lines break inside
 * words ("afterward / s."), which is what the live run of 20 Sep put on camera the moment a
 * sentence was typed into the notes. It is also what the document is saved as.
 *
 * Reusing the neighbour's timestamp costs nothing that is read anywhere: `at` says when the
 * learner wrote this run, and a run is exactly what it now marks. A range that does not follow
 * the learner's own text still gets `now` — a new run, and a new timestamp.
 */
function learnerRunAt(doc: Node, from: number): number | null {
  if (from <= 0 || from > doc.content.size) return null;
  const type = notesSchema.marks.author!;
  const $from = doc.resolve(from);
  // `childBefore`, not `$from.marks()`: at a boundary between two text nodes the latter answers
  // "what would a character typed here inherit", which is not the same question and drops a
  // non-inclusive mark. This one is exactly "the run this range continues, if any".
  const before = $from.parent.childBefore($from.parentOffset).node;
  const mark = before?.marks.find((m) => m.type === type && m.attrs.by === 'user');
  const at = mark?.attrs.at;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
}

export function stampLearnerText(tr: Transaction, ranges: readonly Range[], now: number): Transaction {
  const type = notesSchema.marks.author!;
  const size = tr.doc.content.size;
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, size));
    const to = Math.max(from, Math.min(range.to, size));
    if (to <= from) continue;
    // No text in there at all? Then there is no author mark to set and `addMark` would be a
    // no-op step. Cheap to check, and it keeps empty transactions out of the history.
    if (!hasText(tr.doc, from, to)) continue;
    const mark = authorMark('user', null, learnerRunAt(tr.doc, from) ?? now);
    tr.removeMark(from, to, type);
    tr.addMark(from, to, mark);
  }
  return tr;
}

/**
 * The marks a learner's next keystroke should wear at an empty cursor: whatever is there now,
 * with the author mark replaced by theirs.
 *
 * This is the belt to `stampLearnerText`'s braces, and it matters for one input path in
 * particular: **IME composition**. A Chinese or Japanese composition is assembled in the DOM
 * before ProseMirror ever sees a step, and it inherits the marks at the cursor; with Ellie's
 * author mark stored there, the composition renders as Ellie's until the commit is stamped, and
 * the stamp then has to fight a `Mark` set it did not create. Storing the learner's mark up front
 * means every path — typing, IME, paste, drop — starts out attributed correctly.
 *
 * `at: 0` deliberately: the timestamp is not known until the characters exist, and a mark whose
 * attrs change every millisecond can never compare equal, which would append a transaction on
 * every cursor move forever. `stampLearnerText` writes the real `at` a moment later.
 */
export function learnerStoredMarks(state: EditorState): readonly Mark[] {
  const type = notesSchema.marks.author!;
  const at = state.storedMarks ?? state.selection.$from.marks();
  return type.create({ by: 'user', editId: null, at: 0 }).addToSet(at.filter((mark) => mark.type !== type));
}

export interface AuthorshipOptions {
  /** Called whenever the learner actually changed the document. Drives `learnerTouched`. */
  onLearnerEdit?: (at: number) => void;
  /** Injectable for tests. */
  now?: () => number;
}

/**
 * The plugin: stamp the learner's insertions, then mint block ids for anything split or pasted.
 *
 * Both in **one** appended transaction, in that order, because `assignMissingBlockIds` reads
 * `tr.doc` and must see the document the stamping leaves behind. `schema.ts` is explicit that
 * every editor hosting this schema has to run the minter — without it, pressing Enter in the
 * middle of a paragraph leaves two blocks sharing one id and an agent op resolves onto whichever
 * half `blockPos` reaches first.
 */
export function authorship(options: AuthorshipOptions = {}): Plugin {
  const now = options.now ?? (() => Date.now());
  return new Plugin({
    key: authorshipKey,
    appendTransaction(transactions, _old: EditorState, newState: EditorState) {
      const learner = transactions.filter((tr) => isLearnerInput(tr));
      const tr = newState.tr;
      if (learner.length > 0) {
        const at = now();
        stampLearnerText(tr, insertedRanges(learner), at);
        options.onLearnerEdit?.(at);
      }
      assignMissingBlockIds(tr);

      // The cursor moved: pre-load the learner's author mark so IME and paste start out theirs.
      // Only at an empty selection — over a range, the marks are the range's business.
      let storedMarks = false;
      if (transactions.some((t) => t.selectionSet) && newState.selection.empty) {
        const wanted = learnerStoredMarks(newState);
        if (!Mark.sameSet(wanted, newState.storedMarks ?? newState.selection.$from.marks())) {
          tr.setStoredMarks(wanted);
          storedMarks = true;
        }
      }
      return tr.steps.length > 0 || storedMarks ? tr : null;
    },
  });
}
