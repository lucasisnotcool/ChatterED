/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE COMMANDS FOR A DECK, A QUIZ AND AN INFOGRAPHIC (notebooks §5.3, 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The three blocks are one shape: a top-level block (`flashcards`, `quiz`, `infographic`) of
 * **items** (a card, a question, a panel), each item a fixed run of inline **fields** (a front and
 * a back, a prompt, options and an answer, a value, a heading and a body). The diagram's problems
 * come back in each: Enter would split a field and break the item's content rule, Backspace at a
 * field's start would try to merge two, and a paste of paragraphs would break the block apart.
 * So the answers are the diagram's, written once for all three and kept pure over `EditorState`
 * so they can be tested without a view (`blockfields.test.ts`):
 *
 *  - **where the cursor is** (`fieldBlockAt`) and **where every field is** (`fieldRanges`);
 *  - **moving**: Tab, Shift-Tab and Enter go field to field and never split;
 *  - **deleting**: Backspace at a field's start and Delete at its end are taken and do nothing; a
 *    selection that spans fields loses its text field by field, and every field keeps its box;
 *  - **editing the structure**: add or delete an item, retitle, switch an infographic's layout,
 *    add or remove a quiz option, mark which option is right.
 *
 * Every command is an ordinary transaction, in the history, and so the learner's own
 * (`pm/authorship.ts` stamps what they type; nothing here writes text).
 */

import type { Node } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import {
  ITEM_BLOCKS,
  INFOGRAPHIC_LAYOUTS,
  blockAttrs,
  isInfographicLayout,
  notesSchema,
} from '../../shared/doc/schema.js';
import type { InfographicLayout } from '../../shared/doc/types.js';

export type FieldBlockName = keyof typeof ITEM_BLOCKS;

/** More than this many options on one question is a wall, whatever the author wants. */
export const MAX_OPTIONS = 6;

export function isFieldBlock(name: string): name is FieldBlockName {
  return Object.prototype.hasOwnProperty.call(ITEM_BLOCKS, name);
}

export interface FieldHit {
  blockPos: number;
  block: Node;
  name: FieldBlockName;
  /** The item the selection starts in, or null when it is on the block itself. */
  index: number | null;
  itemPos: number | null;
}

/** The deck, quiz or infographic the selection starts in, and the item inside it, if any. */
export function fieldBlockAt(state: EditorState): FieldHit | null {
  const { selection } = state;
  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (!isFieldBlock(node.type.name)) continue;
    const inside = $from.depth > d;
    return {
      blockPos: $from.before(d),
      block: node,
      name: node.type.name,
      index: inside ? $from.index(d) : null,
      itemPos: inside ? $from.before(d + 1) : null,
    };
  }
  const selected = state.doc.nodeAt(selection.from);
  if (selected && isFieldBlock(selected.type.name) && selection.to === selection.from + selected.nodeSize) {
    return { blockPos: selection.from, block: selected, name: selected.type.name, index: null, itemPos: null };
  }
  return null;
}

export interface FieldRange {
  /** The item this field is in. */
  item: number;
  /** The field's node type, e.g. `flashcard_back`. */
  type: string;
  /** Content start and end (the text's positions, not the field node's). */
  from: number;
  to: number;
}

/** Every field of the block, in document order, as the range of text it holds. */
export function fieldRanges(block: Node, blockPos: number): FieldRange[] {
  const out: FieldRange[] = [];
  block.forEach((item, itemOffset, index) => {
    const itemPos = blockPos + 1 + itemOffset;
    item.forEach((field, fieldOffset) => {
      const from = itemPos + 1 + fieldOffset + 1;
      out.push({ item: index, type: field.type.name, from, to: from + field.content.size });
    });
  });
  return out;
}

function fieldIndexAt(ranges: readonly FieldRange[], pos: number): number {
  return ranges.findIndex((r) => pos >= r.from && pos <= r.to);
}

// ── moving and deleting ─────────────────────────────────────────────────────────────────────

/**
 * Tab, Shift-Tab and Enter: to the end of the next (or previous) field. At either end of the
 * block the key is still taken, so it cannot fall through to a split or to the browser's focus.
 */
export function moveField(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const hit = fieldBlockAt(state);
    if (!hit || hit.index === null) return false;
    const ranges = fieldRanges(hit.block, hit.blockPos);
    const here = fieldIndexAt(ranges, state.selection.from);
    if (here < 0) return false;
    const next = ranges[here + direction];
    if (!next) return true;
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, next.to)).scrollIntoView());
    return true;
  };
}

/** Backspace at a field's very start, or Delete at its very end: taken, and nothing happens. */
export function guardFieldEdge(edge: 'start' | 'end'): Command {
  return (state) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const $at = selection.$from;
    if (!$at.parent.isTextblock || !isFieldBlock(fieldBlockAt(state)?.name ?? '')) return false;
    return edge === 'start' ? $at.parentOffset === 0 : $at.parentOffset === $at.parent.content.size;
  };
}

/**
 * Delete `from`–`to` field by field: each field keeps its box and loses only the text inside the
 * range. Null when the range is inside one field (an ordinary delete is right), or not in one of
 * these blocks at all.
 */
export function clearAcrossFields(state: EditorState, from: number, to: number): Transaction | null {
  if (to <= from) return null;
  const $from = state.doc.resolve(from);
  let blockPos = -1;
  let block: Node | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if (isFieldBlock($from.node(d).type.name)) {
      blockPos = $from.before(d);
      block = $from.node(d);
      break;
    }
  }
  if (!block || to > blockPos + block.nodeSize) return null;
  const ranges = fieldRanges(block, blockPos);
  const touched = ranges.filter((r) => Math.min(r.to, to) > Math.max(r.from, from));
  const startsIn = fieldIndexAt(ranges, from);
  const endsIn = fieldIndexAt(ranges, to);
  if (startsIn >= 0 && startsIn === endsIn) return null;
  const tr = state.tr;
  for (const r of [...touched].reverse()) tr.delete(Math.max(r.from, from), Math.min(r.to, to));
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, -1)));
  return tr;
}

// ── editing the structure ───────────────────────────────────────────────────────────────────

/** The title, trimmed; an empty one is none. */
export function setBlockTitle(state: EditorState, blockPos: number, title: string): Transaction | null {
  const block = state.doc.nodeAt(blockPos);
  if (!block || !isFieldBlock(block.type.name)) return null;
  const next = title.replace(/\s+/g, ' ').trim() || null;
  if (next === ((block.attrs.title as string | null) || null)) return null;
  return state.tr.setNodeAttribute(blockPos, 'title', next);
}

export function setInfographicLayout(state: EditorState, blockPos: number, layout: InfographicLayout): Transaction | null {
  const block = state.doc.nodeAt(blockPos);
  if (block?.type.name !== 'infographic' || !isInfographicLayout(layout) || block.attrs.layout === layout) return null;
  return state.tr.setNodeAttribute(blockPos, 'layout', layout);
}

function newItem(name: FieldBlockName, pages: number[]): Node {
  const n = notesSchema.nodes;
  const attrs = { pages, reason: null };
  switch (name) {
    case 'flashcards':
      return n.flashcard!.create(attrs, [n.flashcard_front!.create(), n.flashcard_back!.create()]);
    case 'quiz':
      return n.quiz_question!.create({ ...attrs, qtype: 'short' }, [n.quiz_prompt!.create(), n.quiz_explain!.create()]);
    case 'infographic':
      return n.info_panel!.create(attrs, [n.info_value!.create(), n.info_heading!.create(), n.info_body!.create()]);
  }
}

/**
 * **Add a card, a question or a panel**: a new empty one after the item the cursor is in (or at
 * the end), carrying the block's own pages, the cursor in its first field. A new question is a
 * short-answer one; **+ Option** turns it multiple choice.
 */
export function addItem(state: EditorState, blockPos: number): Transaction | null {
  const block = state.doc.nodeAt(blockPos);
  if (!block || !isFieldBlock(block.type.name)) return null;
  const hit = fieldBlockAt(state);
  const here = hit && hit.blockPos === blockPos && hit.index !== null ? hit.index : block.childCount - 1;
  let at = blockPos + 1;
  for (let i = 0; i <= here; i++) at += block.child(i).nodeSize;
  const tr = state.tr.insert(at, newItem(block.type.name, blockAttrs(block).pages));
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  return tr.scrollIntoView();
}

/** **Delete the item** at `index`. The last item of a block cannot go (`+` content): delete the block. */
export function deleteItem(state: EditorState, blockPos: number, index: number): Transaction | null {
  const block = state.doc.nodeAt(blockPos);
  if (!block || !isFieldBlock(block.type.name) || block.childCount <= 1) return null;
  if (!Number.isInteger(index) || index < 0 || index >= block.childCount) return null;
  let from = blockPos + 1;
  for (let i = 0; i < index; i++) from += block.child(i).nodeSize;
  const tr = state.tr.delete(from, from + block.child(index).nodeSize);
  const caret = index > 0 ? from - 1 : from + 1;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
  return tr.scrollIntoView();
}

// ── a quiz's options ────────────────────────────────────────────────────────────────────────

export interface OptionHit {
  questionPos: number;
  question: Node;
  /** The option the selection is in, as an index among the question's options, or null. */
  option: number | null;
  optionPos: number | null;
}

/** The quiz question the selection starts in, and its option if it is in one. */
export function questionAt(state: EditorState): OptionHit | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'quiz_question') continue;
    const question = $from.node(d);
    const questionPos = $from.before(d);
    const inField = $from.depth > d ? $from.node(d + 1) : null;
    if (inField?.type.name !== 'quiz_option') return { questionPos, question, option: null, optionPos: null };
    const at = $from.index(d);
    let option = 0;
    question.forEach((child, _offset, i) => {
      if (i < at && child.type.name === 'quiz_option') option++;
    });
    return { questionPos, question, option, optionPos: $from.before(d + 1) };
  }
  return null;
}

/** **+ Option**: a new empty option after the last one, the question multiple choice from now on. */
export function addOption(state: EditorState): Transaction | null {
  const hit = questionAt(state);
  if (!hit) return null;
  let options = 0;
  let at = hit.questionPos + 1;
  hit.question.forEach((child) => {
    if (child.type.name === 'quiz_option') options++;
    // Before the explanation, after the prompt and any options.
    if (child.type.name !== 'quiz_explain') at += child.nodeSize;
  });
  if (options >= MAX_OPTIONS) return null;
  const tr = state.tr;
  tr.insert(at, notesSchema.nodes.quiz_option!.create({ correct: options === 0 }));
  if (hit.question.attrs.qtype !== 'mc') tr.setNodeAttribute(hit.questionPos, 'qtype', 'mc');
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  return tr.scrollIntoView();
}

/** **Mark correct**: the option the cursor is in is the one right answer; the others are not. */
export function markCorrect(state: EditorState): Transaction | null {
  const hit = questionAt(state);
  if (!hit || hit.option === null) return null;
  const tr = state.tr;
  let changed = false;
  let seen = -1;
  hit.question.forEach((child, offset) => {
    if (child.type.name !== 'quiz_option') return;
    seen++;
    const want = seen === hit.option;
    if ((child.attrs.correct === true) === want) return;
    tr.setNodeAttribute(hit.questionPos + 1 + offset, 'correct', want);
    changed = true;
  });
  return changed ? tr : null;
}

/**
 * **Remove option**: the option the cursor is in. A question left with none is short answer
 * again; a multiple-choice one that loses its right answer has none marked until the author does.
 */
export function removeOption(state: EditorState): Transaction | null {
  const hit = questionAt(state);
  if (!hit || hit.option === null || hit.optionPos === null) return null;
  const node = state.doc.nodeAt(hit.optionPos);
  if (!node) return null;
  let options = 0;
  hit.question.forEach((child) => {
    if (child.type.name === 'quiz_option') options++;
  });
  const tr = state.tr.delete(hit.optionPos, hit.optionPos + node.nodeSize);
  if (options <= 1) tr.setNodeAttribute(hit.questionPos, 'qtype', 'short');
  const caret = Math.min(hit.optionPos, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1));
  return tr.scrollIntoView();
}

export { INFOGRAPHIC_LAYOUTS };
