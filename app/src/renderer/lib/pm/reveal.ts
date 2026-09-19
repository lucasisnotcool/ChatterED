/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * TYPED IN, NOT PASTED (`collab-doc.md` §5)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The agent edit is already in the document — applied in one transaction, guarded once, authored
 * and `editId`-stamped from the first frame (`typing.ts` argues that ordering at length). What is
 * left is to *show* it arriving, and that is this plugin: it holds, per running edit, the ranges
 * the edit inserted and how many characters of them are visible, and it hides the rest with
 * decorations.
 *
 * **Hidden with `display: none`, not `visibility: hidden`.** The difference is the whole effect:
 * `visibility` reserves the final layout, so the paragraph appears at full height and fills in
 * like a crossword; `display` reflows, so the line grows word by word and the paragraphs below
 * are pushed down exactly as they are when a person types. The second one is what a learner
 * recognises as somebody writing.
 *
 * **The ranges are plugin state and are mapped through every transaction**, which is what lets
 * the learner keep typing in the same paragraph while Ellie's sentence lands below it: their
 * insertions move the reveal window rather than tearing it.
 *
 * The pure half — `revealText`, `revealPlan` — is unit-tested against real documents in node.
 */

import { Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import type { AgentAuthor } from '../../../shared/doc/types.js';
import { ATOM_COST } from '../typing.js';
import type { Range } from './authorship.js';

export const revealKey = new PluginKey<RevealState>('chattered:reveal');

/** One edit mid-animation. */
export interface RevealRun {
  editId: string;
  author: AgentAuthor;
  ranges: Range[];
  /** Characters of this edit that are visible. */
  revealed: number;
  /** Characters in total. */
  total: number;
}

export interface RevealState {
  runs: RevealRun[];
}

type RevealAction =
  | { kind: 'start'; run: RevealRun }
  | { kind: 'advance'; editId: string; revealed: number }
  | { kind: 'finish'; editId: string };

/** The placeholder an atom contributes to the reveal string: one "word" of `ATOM_COST`. */
const ATOM_TOKEN = `${'█'.repeat(Math.max(1, ATOM_COST - 1))} `;

/** A node's length in reveal units — the same accounting `revealPlan` walks with. */
function revealCost(node: Node): number {
  if (node.isText) return node.text?.length ?? 0;
  if (node.isAtom) return ATOM_COST;
  let sum = 0;
  node.forEach((child) => {
    sum += revealCost(child);
  });
  return sum;
}

/**
 * The text of an edit, as the typing schedule should see it.
 *
 * Atoms (a display formula, an inline slide figure) become one opaque token of `ATOM_COST`
 * characters: they cannot half-appear, but they should not be free either, or a figure would
 * flash past between two words of the sentence that introduces it.
 */
export function revealText(doc: Node, ranges: readonly Range[]): string {
  let out = '';
  for (const range of ranges) {
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (node.isText) {
        const from = Math.max(pos, range.from);
        const to = Math.min(pos + node.nodeSize, range.to);
        if (to > from) out += (node.text ?? '').slice(from - pos, to - pos);
        return false;
      }
      if (node.isAtom) {
        if (pos >= range.from && pos + node.nodeSize <= range.to) out += ATOM_TOKEN;
        return false;
      }
      // A block boundary is a space as far as word-splitting is concerned, so two paragraphs do
      // not run together into one enormous word.
      if (node.isBlock && pos >= range.from && out.length > 0 && !out.endsWith(' ')) out += ' ';
      return true;
    });
  }
  return out;
}

export interface RevealPlan {
  /** Text ranges to hide. */
  inline: Range[];
  /** Positions of whole block nodes to hide. */
  blocks: number[];
  /** Where the agent's caret sits: just before the first hidden thing, or at the end. */
  frontier: number | null;
}

/**
 * What is still hidden when `revealed` characters of this edit are visible.
 *
 * Walks the same accounting `revealText` builds, so step *n* of the schedule and frame *n* of the
 * decoration agree about which character they are on. A block whose every character is still
 * hidden is hidden **as a block** rather than as its text, because an empty `<p>` is a blank line
 * the layout jumps over when it fills — the paragraph should not exist yet at all.
 */
export function revealPlan(doc: Node, ranges: readonly Range[], revealed: number): RevealPlan {
  const inline: Range[] = [];
  const blocks: number[] = [];
  let seen = 0;
  let firstHidden: number | null = null;
  let lastRevealed: number | null = null;

  const hideFrom = (pos: number): void => {
    if (firstHidden === null) firstHidden = pos;
  };

  for (const range of ranges) {
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (node.isText) {
        const from = Math.max(pos, range.from);
        const to = Math.min(pos + node.nodeSize, range.to);
        const length = to - from;
        if (length <= 0) return false;
        if (seen >= revealed) {
          inline.push({ from, to });
          hideFrom(from);
        } else if (seen + length > revealed) {
          const cut = from + (revealed - seen);
          inline.push({ from: cut, to });
          hideFrom(cut);
          lastRevealed = cut;
        } else {
          lastRevealed = to;
        }
        seen += length;
        return false;
      }

      const whole = pos >= range.from && pos + node.nodeSize <= range.to;
      if (node.isBlock && whole) {
        const cost = revealCost(node);
        if (seen >= revealed) {
          blocks.push(pos);
          hideFrom(pos);
          seen += cost;
          return false;
        }
        if (seen + cost <= revealed) {
          seen += cost;
          lastRevealed = pos + node.nodeSize;
          return false;
        }
        return true; // partially revealed: descend
      }
      if (node.isAtom) {
        if (whole && seen >= revealed) {
          blocks.push(pos);
          hideFrom(pos);
        }
        if (whole) seen += ATOM_COST;
        return false;
      }
      return true;
    });
  }

  return { inline, blocks, frontier: firstHidden ?? lastRevealed };
}

/** Where the caret of a running edit should be drawn, or null when it is finished. */
export function frontierOf(doc: Node, run: RevealRun): number | null {
  if (run.revealed >= run.total) return null;
  return revealPlan(doc, run.ranges, run.revealed).frontier;
}

function decorationsFor(doc: Node, state: RevealState): DecorationSet {
  const decorations: Decoration[] = [];
  for (const run of state.runs) {
    if (run.revealed >= run.total) continue;
    const plan = revealPlan(doc, run.ranges, run.revealed);
    for (const range of plan.inline) {
      if (range.to > range.from) decorations.push(Decoration.inline(range.from, range.to, { class: 'nd-unwritten' }));
    }
    for (const pos of plan.blocks) {
      const node = doc.nodeAt(pos);
      if (node) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nd-unwritten-block' }));
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** Dispatch helpers — the store drives the animation through these. */
export const reveal = {
  start(tr: Transaction, run: RevealRun): Transaction {
    return tr.setMeta(revealKey, { kind: 'start', run } satisfies RevealAction);
  },
  advance(tr: Transaction, editId: string, revealed: number): Transaction {
    return tr.setMeta(revealKey, { kind: 'advance', editId, revealed } satisfies RevealAction);
  },
  finish(tr: Transaction, editId: string): Transaction {
    return tr.setMeta(revealKey, { kind: 'finish', editId } satisfies RevealAction);
  },
};

export function revealPlugin(): Plugin<RevealState> {
  return new Plugin<RevealState>({
    key: revealKey,
    state: {
      init(): RevealState {
        return { runs: [] };
      },
      apply(tr, value): RevealState {
        let runs = value.runs;
        if (tr.docChanged) {
          runs = runs.map((run) => ({
            ...run,
            // `-1` / `+1`: the window stays open around text the learner types at its edges,
            // instead of splitting the agent's sentence in half around their cursor.
            ranges: run.ranges
              .map((range) => ({ from: tr.mapping.map(range.from, -1), to: tr.mapping.map(range.to, 1) }))
              .filter((range) => range.to > range.from),
          }));
        }
        const action = tr.getMeta(revealKey) as RevealAction | undefined;
        if (!action) return runs === value.runs ? value : { runs };
        switch (action.kind) {
          case 'start':
            return { runs: [...runs.filter((r) => r.editId !== action.run.editId), action.run] };
          case 'advance':
            return {
              runs: runs.map((run) =>
                run.editId === action.editId ? { ...run, revealed: Math.max(run.revealed, action.revealed) } : run,
              ),
            };
          case 'finish':
            return { runs: runs.filter((run) => run.editId !== action.editId) };
        }
      },
    },
    props: {
      decorations(state: EditorState) {
        const value = revealKey.getState(state);
        if (!value || value.runs.length === 0) return null;
        return decorationsFor(state.doc, value);
      },
    },
  });
}
