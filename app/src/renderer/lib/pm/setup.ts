/**
 * The editor's behaviour: history, keys, input rules, cursors.
 *
 * Kept apart from the host component because none of it is Svelte's business and all of it is
 * worth reading in one place. Nothing here knows about agents; the agent-facing plugins are
 * `authorship`, `reveal` and `chrome`.
 *
 * **Undo never crosses an author.** Every agent transaction is dispatched `addToHistory: false`
 * (`docstore.svelte.ts`), so `⌘Z` walks the learner's own edits and steps straight over Ellie's
 * paragraph as if it had always been there. The alternative — agent edits in the undo stack —
 * means a learner pressing ⌘Z three times to fix their own typo silently un-asks Max's question,
 * and the document they are looking at stops being the document main has saved.
 */

import { baseKeymap, chainCommands, setBlockType, toggleMark } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';
import { notesSchema } from '../../../shared/doc/schema.js';
import { blockKitPlugin } from './blockkit.js';
import { diagramPlugin } from './diagram.js';
import { editFormula, mathInputRules, mathPlugin } from './math.js';
import { imageKeysPlugin } from './image.js';
import { searchHitPlugin } from './searchhit.js';
import { readAloudPlugin } from './readaloud.js';
import { tableGuard, tableKeymap } from './table.js';
import { tableChrome } from './tableview.js';

/** `# ` … `### ` at the start of a block. */
function headingRule() {
  return textblockTypeInputRule(/^(#{1,3})\s$/, notesSchema.nodes.heading!, (match) => ({
    level: match[1]!.length,
  }));
}

/** `- `, `* ` or `+ ` opens a bullet list. */
function bulletRule() {
  return wrappingInputRule(/^\s*([-+*])\s$/, notesSchema.nodes.bullet_list!);
}

/** `1. ` opens a numbered list at the number it was actually written with. */
function orderedRule() {
  return wrappingInputRule(
    /^(\d+)\.\s$/,
    notesSchema.nodes.ordered_list!,
    (match) => ({ start: Number(match[1]) }),
    (match, node) => node.childCount + (node.attrs.start as number) === Number(match[1]),
  );
}

/** ``` opens a code block. */
function codeRule() {
  return textblockTypeInputRule(/^```$/, notesSchema.nodes.code_block!);
}

export interface EditorKeys {
  /** Highlight + Ctrl+E / ⌘E (§3). Returns true when it handled the key. */
  onAskAboutSelection: () => boolean;
  /** ⌘S — the doc saves itself, but the reflex has to do something honest. */
  onSaveNow: () => boolean;
  /**
   * ⌘↩ — submit the answer the cursor is in (`nodeviews.ts` `submitAnswerAtSelection`). A whole
   * command, because it needs the view; it returns false outside an open Q block's answer, and
   * the key then falls through to the base keymap's `exitCode`.
   */
  submitAnswer: Command;
}

export function editorPlugins(keys: EditorKeys): Plugin[] {
  const marks = notesSchema.marks;
  const nodes = notesSchema.nodes;

  const askAbout: Command = (state) => {
    if (state.selection.empty) return false;
    return keys.onAskAboutSelection();
  };

  const saveNow: Command = () => keys.onSaveNow();

  return [
    inputRules({ rules: [headingRule(), bulletRule(), orderedRule(), codeRule(), ...mathInputRules()] }),
    history(),
    // Formulas typeset at rest, stepped over as one unit, edited in a popover (`math.ts`). Ahead of
    // every keymap, so its arrow and delete keys at a formula's edge are seen first.
    mathPlugin(),
    // Images in line with text: Backspace after one deletes it, ← → step over it (`image.ts`).
    imageKeysPlugin(),
    // Inside a table cell, first: Tab, Enter, the arrows and the deletes are the table's (`table.ts`).
    keymap(tableKeymap()),
    // Inside a diagram node, also first: Enter, Tab and the deletes never split or merge a box (`diagram.ts`).
    diagramPlugin(),
    // Inside a card, a question or a panel: the same, for the three blocks of notebooks §5.3 (`blockkit.ts`).
    blockKitPlugin(),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      'Mod-b': toggleMark(marks.strong!),
      'Mod-i': toggleMark(marks.em!),
      'Mod-`': toggleMark(marks.code!),
      // Notion's key for an inline formula: edit the one at the caret, or write one.
      'Mod-Shift-e': editFormula,
      'Mod-e': askAbout,
      'Mod-s': saveNow,
      'Mod-Enter': keys.submitAnswer,
      'Shift-Ctrl-0': setBlockType(nodes.paragraph!),
      'Shift-Ctrl-1': setBlockType(nodes.heading!, { level: 1 }),
      'Shift-Ctrl-2': setBlockType(nodes.heading!, { level: 2 }),
      'Shift-Ctrl-3': setBlockType(nodes.heading!, { level: 3 }),
      // Inside a list, Enter makes the next item; everywhere else the base command wins.
      Enter: chainCommands(splitListItem(nodes.list_item!), baseKeymap.Enter!),
      Tab: sinkListItem(nodes.list_item!),
      'Shift-Tab': liftListItem(nodes.list_item!),
      // Backspace right after an input rule fired undoes the rule, not the character.
      Backspace: chainCommands(undoInputRule, baseKeymap.Backspace!),
    }),
    keymap(baseKeymap),
    dropCursor({ color: 'var(--indigo)', width: 2 }),
    gapCursor(),
    // The block being read aloud: a decoration only (`readaloud.ts`).
    readAloudPlugin(),
    // The search page's picked hit: a decoration only (`searchhit.ts`).
    searchHitPlugin(),
    // Every table stays a rectangle; its row chips and toolbar state (`table.ts`, `tableview.ts`).
    tableGuard(),
    tableChrome(),
  ];
}
