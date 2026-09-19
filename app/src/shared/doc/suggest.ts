/**
 * **Suggestions — what an agent does instead of overwriting the learner** (§5.4, §6).
 *
 * > An agent works around learner text; if a change to learner text is the only correct edit, it
 * > is a **suggestion**, Google-Docs style: strikethrough for the deletion, the agent's colour
 * > for the addition, and an accept / reject control. Rejecting leaves the learner's text exactly
 * > as it was.
 *
 * The representation is two marks and no new nodes: `suggest_del` over the text that would go,
 * `suggest_ins` on the text that would come, both carrying the `suggestionId` so a doc can hold
 * several at once and each control knows its own.
 *
 * **Why marks and not a "pending" node.** The reject has to leave the learner's text *byte
 * identical* in the serialised document — that is the promise, and it is a unit test
 * (`suggest.test.ts`). Adding and removing a mark is reversible by construction: ProseMirror
 * re-joins the text nodes a mark boundary split, so `toJSON()` before and after compare equal
 * string for string. Wrapping the learner's words in a node would not: the wrap's own attrs,
 * the split, and the re-join would each have to be undone by hand, and "by hand" is how a
 * promise like this one gets broken in the third month of a codebase.
 */

import type { Node } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { inlineToNodesWith } from './inline.js';
import { authorMark, blockPos, notesSchema, textRuns } from './schema.js';
import type { AgentAuthor } from './types.js';

export interface SuggestReplaceInput {
  suggestionId: string;
  by: AgentAuthor;
  blockId: string;
  quote: string;
  replacement: string;
}

/**
 * A block's text as one string, with the map from string index back to document position.
 *
 * Built from the text runs rather than from `textBetween` because a mark boundary splits a text
 * node in the middle of a word, and `quote` — which a model wrote by reading the outline — knows
 * nothing about where those splits are. Concatenating the runs and searching the concatenation
 * means a quote that spans a bold word still matches.
 */
function flatText(node: Node, base: number): { text: string; at: (index: number) => number } {
  const runs = textRuns(node, base);
  let text = '';
  const starts: { index: number; pos: number }[] = [];
  for (const run of runs) {
    starts.push({ index: text.length, pos: run.from });
    text += run.text;
  }
  const at = (index: number): number => {
    let pos = base;
    for (const start of starts) {
      if (index >= start.index) pos = start.pos + (index - start.index);
    }
    return pos;
  };
  return { text, at };
}

/**
 * Mark `quote` inside the block for deletion and offer `replacement` beside it.
 *
 * Returns `false` when the block is gone or the quote is not in it verbatim — the *model* chose
 * the quote, and a fuzzy match would be a model deciding which of the learner's words to strike
 * through. `null` from the public wrapper is the right answer: no suggestion is better than a
 * suggestion aimed at text nobody wrote.
 */
export function suggestReplaceOnTr(tr: Transaction, input: SuggestReplaceInput): boolean {
  const target = blockPos(tr.doc, input.blockId);
  if (!target) return false;
  const quote = input.quote.trim();
  if (quote.length === 0) return false;

  const { text, at } = flatText(target.node, target.pos + 1);
  const index = text.indexOf(quote);
  if (index < 0) return false;

  const from = at(index);
  const to = at(index + quote.length - 1) + 1;

  const insMark = notesSchema.marks.suggest_ins!.create({ suggestionId: input.suggestionId, by: input.by });
  const delMark = notesSchema.marks.suggest_del!.create({ suggestionId: input.suggestionId, by: input.by });
  const nodes = inlineToNodesWith(notesSchema, input.replacement, [authorMark(input.by, null), insMark]);

  // Insert first, then strike: the replacement lands at `to`, outside the range about to be
  // marked, so the two marks never meet on one character even though both are non-inclusive.
  if (nodes.length > 0) tr.insert(to, nodes);
  tr.addMark(from, to, delMark);
  return true;
}

export function suggestReplace(state: EditorState, input: SuggestReplaceInput): Transaction | null {
  const tr = state.tr;
  if (!suggestReplaceOnTr(tr, input)) return null;
  return tr;
}

interface MarkedRange {
  from: number;
  to: number;
}

/** Contiguous ranges wearing `markName` for this suggestion, in document order. */
function rangesOf(doc: Node, markName: string, suggestionId: string): MarkedRange[] {
  const ranges: MarkedRange[] = [];
  let open: MarkedRange | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const hit = node.marks.some(
      (mark) => mark.type.name === markName && (mark.attrs.suggestionId as string) === suggestionId,
    );
    if (!hit) {
      open = null;
      return false;
    }
    const from = pos;
    const to = pos + node.nodeSize;
    if (open && open.to === from) open.to = to;
    else {
      open = { from, to };
      ranges.push(open);
    }
    return false;
  });
  return ranges;
}

/**
 * **Accept**: the struck text goes, the offered text stays and becomes ordinary agent text.
 *
 * The inserted text keeps its `author` mark (`by` is the agent, `editId` null) — it was written
 * by Max and the document should keep saying so; what it loses is the suggestion mark, which is
 * the only thing the accept/reject control draws on.
 */
export function acceptSuggestion(state: EditorState, suggestionId: string): Transaction | null {
  const inserted = rangesOf(state.doc, 'suggest_ins', suggestionId);
  const struck = rangesOf(state.doc, 'suggest_del', suggestionId);
  if (inserted.length === 0 && struck.length === 0) return null;

  const tr = state.tr;
  for (const range of inserted) {
    tr.removeMark(tr.mapping.map(range.from), tr.mapping.map(range.to), notesSchema.marks.suggest_ins!);
  }
  // Back to front: a deletion never disturbs a position before it.
  for (const range of [...struck].reverse()) {
    tr.delete(tr.mapping.map(range.from), tr.mapping.map(range.to));
  }
  return tr.steps.length > 0 ? tr : null;
}

/**
 * **Reject**: the offered text goes, the struck text loses its strike — and the document is
 * byte-identical to what it was before the suggestion was made. That equality is the test.
 */
export function rejectSuggestion(state: EditorState, suggestionId: string): Transaction | null {
  const inserted = rangesOf(state.doc, 'suggest_ins', suggestionId);
  const struck = rangesOf(state.doc, 'suggest_del', suggestionId);
  if (inserted.length === 0 && struck.length === 0) return null;

  const tr = state.tr;
  for (const range of struck) {
    tr.removeMark(tr.mapping.map(range.from), tr.mapping.map(range.to), notesSchema.marks.suggest_del!);
  }
  for (const range of [...inserted].reverse()) {
    tr.delete(tr.mapping.map(range.from), tr.mapping.map(range.to));
  }
  return tr.steps.length > 0 ? tr : null;
}

/** Every open suggestion id in the document — what the renderer draws controls for. */
export function suggestionIds(doc: Node): string[] {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name === 'suggest_ins' || mark.type.name === 'suggest_del') {
        ids.add(mark.attrs.suggestionId as string);
      }
    }
    return false;
  });
  return [...ids];
}
