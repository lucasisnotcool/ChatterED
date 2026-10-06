/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE QUESTION AND ITS ANSWER, IN ONE BLOCK (`collab-doc.md` §5.2, §5.3; 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two things became possible on 1 Oct and both live inside a `q_block`:
 *
 *  - **Answer in place.** Max's question sits in the notes; the learner may type their answer
 *    under it and press Submit, instead of going to the chat.
 *  - **A question of the learner's own** (`askedBy: 'user'`). They write the question, answer it
 *    in the same block, and Max marks the answer. It fills no progress.
 *
 * This file is the pure half: what in a Q block is the question, what is the answer, and the two
 * transactions that open a place to write one. The button, the footer and the call to main are
 * `nodeviews.ts` and `docstore.svelte.ts`.
 *
 * ## What counts as the answer
 *
 * The **first child is the question**, whoever wrote it. Everything after it is where answers and
 * resolutions go, and of that only **the learner's own spans** are the answer: §5.3 writes Max's
 * correct version under the same question, and sending that back to him as the learner's attempt
 * would have him mark his own words. The author mark decides, as it does everywhere else (§5.4).
 */

import type { Node } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { blockAttrs, newBlockId, notesSchema, textRuns } from '../../../shared/doc/schema.js';
import type { QResolution } from '../../../shared/doc/types.js';
import { questionLine } from '../../../core/quizturn.js';

export interface QuestionParts {
  /** The text of the Q block's first child. */
  question: string;
  /** The first block after the question that holds learner text, or null when there is none. */
  answerBlockId: string | null;
  /** The learner's own text after the question: spans joined by a space, blocks by a newline. */
  answer: string;
}

/** What a Submit hands to main, less the file and doc ids the store adds. */
export interface QuestionAnswer {
  questionId: string;
  qBlockId: string;
  askedBy: 'max' | 'user';
  question: string;
  answerBlockId: string;
  answer: string;
}

/** The provenance reason on a question the learner added themselves. */
export const OWN_QUESTION_REASON = 'your own question';

/** The provenance reason on the paragraph "Answer here" opens. */
export const OWN_ANSWER_REASON = 'your answer';

/** `q_<12 hex>`, the shape `newBlockId` mints a block id in. */
export function newQuestionId(): string {
  return `q_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * The learner's own text in one block, its separate spans joined by a single space.
 *
 * The same rule as `learnerSpans` and `learnerTextByBlock`: runs that a mark boundary split are
 * one span, and an agent's phrase between two of the learner's is a gap, not a join.
 */
function learnerTextIn(block: Node): string {
  const spans: string[] = [];
  let end = -1;
  for (const run of textRuns(block, 0)) {
    const mine = run.marks.some((mark) => mark.type.name === 'author' && mark.attrs.by === 'user');
    if (!mine) continue;
    if (spans.length > 0 && end === run.from) spans[spans.length - 1] += run.text;
    else spans.push(run.text);
    end = run.to;
  }
  return spans
    .map((span) => span.trim())
    .filter((span) => span.length > 0)
    .join(' ');
}

export function questionParts(qNode: Node): QuestionParts {
  const first = qNode.firstChild;
  const question = first ? first.textBetween(0, first.content.size, ' ', ' ').trim() : '';
  let answerBlockId: string | null = null;
  const blocks: string[] = [];
  qNode.forEach((child, _offset, index) => {
    if (index === 0) return;
    const text = learnerTextIn(child);
    if (text.length === 0) return;
    if (blocks.length === 0) answerBlockId = blockAttrs(child).blockId || null;
    blocks.push(text);
  });
  return { question, answerBlockId, answer: blocks.join('\n') };
}

/**
 * The open Q block whose **answer** holds the selection, for ⌘↩.
 *
 * The answer, not the question: ⌘↩ in the question paragraph is left to whatever else binds it,
 * because a learner still wording their own question has not asked for it to be marked.
 */
export function answerTarget(state: EditorState): { pos: number; node: Node } | null {
  const at = state.selection.$from;
  for (let depth = at.depth; depth >= 1; depth--) {
    const node = at.node(depth);
    if (node.type.name !== 'q_block') continue;
    if ((node.attrs.status as string) !== 'open') return null;
    if (at.index(depth) < 1) return null;
    return { pos: at.before(depth), node };
  }
  return null;
}

/** The pages a block stands for. A figure names its page in `page`, not in `pages`. */
function pagesOf(node: Node | null): number[] {
  if (!node) return [];
  const { pages } = blockAttrs(node);
  if (pages.length === 0 && node.type.name === 'slide_figure') return [node.attrs.page as number];
  return pages;
}

/**
 * **Add a question of one's own**: an empty Q block after the top-level block that holds the
 * selection, with the cursor in its question paragraph.
 *
 * Top-level always, so a question added while the cursor is inside another question lands after
 * that one rather than nested in it. The pages are the neighbour's: the question is about the
 * part of the notes it was added to, and that is the slide Max is given to mark against.
 *
 * Dispatched as the learner's own transaction (no `addToHistory: false`), so `authorship` stamps
 * what they type there as theirs and ⌘Z takes the block back out.
 */
export const insertOwnQuestion: Command = (state, dispatch) => {
  const { paragraph, q_block: qBlock } = notesSchema.nodes;
  const to = state.selection.$to;
  // Depth 0 is a selection that ends *between* top-level blocks: a figure selected as a node, a
  // gap cursor, or select-all, which ends at the end of the doc. It is already the place.
  const pos = to.depth >= 1 ? to.after(1) : to.pos;
  const neighbour = to.depth >= 1 ? to.node(1) : (to.nodeBefore ?? to.nodeAfter);
  const pages = pagesOf(neighbour);
  const question = paragraph!.create({
    blockId: newBlockId(),
    pages: [...pages],
    reason: OWN_QUESTION_REASON,
    objectiveIds: [],
  });
  const node = qBlock!.create(
    {
      questionId: newQuestionId(),
      askedBy: 'user',
      status: 'open',
      resolution: null,
      objectiveId: null,
      blockId: newBlockId(),
      pages: [...pages],
      reason: OWN_QUESTION_REASON,
      objectiveIds: [],
    },
    question,
  );
  if (dispatch) {
    const tr = state.tr.insert(pos, node);
    // +1 is inside the Q block, +2 inside its question paragraph.
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * **Answer here**: an empty paragraph as the Q block's last child, with the cursor in it.
 *
 * A trailing empty paragraph that is already there is reused, so pressing the button twice does
 * not stack blank lines under the question. Null when `qPos` is not a Q block.
 */
export function startAnswer(state: EditorState, qPos: number): Transaction | null {
  const q = state.doc.nodeAt(qPos);
  if (!q || q.type.name !== 'q_block') return null;
  const tr = state.tr;
  const end = qPos + q.nodeSize - 1;
  const last = q.lastChild;
  if (q.childCount > 1 && last && last.type.name === 'paragraph' && last.content.size === 0) {
    return tr.setSelection(TextSelection.create(tr.doc, end - 1));
  }
  const { pages, objectiveIds } = blockAttrs(q);
  tr.insert(
    end,
    notesSchema.nodes.paragraph!.create({ blockId: newBlockId(), pages, reason: OWN_ANSWER_REASON, objectiveIds }),
  );
  return tr.setSelection(TextSelection.create(tr.doc, end + 1));
}

// ── Max's question in the rail, and closed as a self-check chip (D4, 2026-10-06) ─────────────

/**
 * What a closed question says it holds. **Only two words**, by Lucas's decision of 2026-10-06
 * (D4, "a clean doc"; `collab-doc.md` §5.3, amended 2026-10-06): *your answer* when the learner's
 * own answer earned it (`you_got_this`, the one resolution under which main files anything, and
 * what it files is the learner's words), and *revisit* for everything else. "You got this",
 * "partly yours" and "released" were Max grading the page; the grade is the chat's and the
 * progress bar's, and the notes keep only what the learner can use: their answer, or a pointer
 * back to a question worth another go. `null` is a legacy or half-written block: revisit.
 */
export type SelfCheckLabel = 'your answer' | 'recall' | 'revisit';

/**
 * *recall* (6 Oct afternoon, decision 14 on #67; `notebooks.md` §11.10.6): a correct
 * fill-in-the-blank after a release. The learner's answer is kept and shown with a small *recall*
 * tag; it fills no progress and is never called *revisit*. It used to say *revisit* beside a
 * *Well done* in the chat.
 */
export function selfCheckLabel(resolution: QResolution | null | undefined): SelfCheckLabel {
  if (resolution === 'you_got_this') return 'your answer';
  if (resolution === 'recall') return 'recall';
  return 'revisit';
}

/** The `data-state` a chip's tag is styled by: `yours`, `recall` or `revisit`. */
export function selfCheckState(label: SelfCheckLabel): 'yours' | 'recall' | 'revisit' {
  return label === 'your answer' ? 'yours' : label;
}

/**
 * **Max's one sentence on the chip** (6 Oct afternoon, decision 12 on #67; `notebooks.md`
 * §11.10.5), or null. Only on a question the learner earned (*your answer*): it is stored as the
 * Q block's `maxNote` attribute by `resolve_q`, never as text, so it can never be read back as the
 * learner's words, and the chip draws it under their answer marked as his.
 */
export function selfCheckNote(node: Node): string | null {
  if (!isSelfCheck(node) || (node.attrs.resolution as QResolution | null) !== 'you_got_this') return null;
  const note = ((node.attrs.maxNote as string | null) ?? '').trim();
  return note.length > 0 ? note : null;
}

/** An agent's question: Max's, or an older one's. `askedBy` predates the learner's own questions. */
function agentAsked(node: Node): boolean {
  return node.type.name === 'q_block' && (node.attrs.askedBy as string) !== 'user';
}

/**
 * Is this Q block drawn as a one-line self-check chip? A **closed question the learner did not
 * ask**. Old docs' resolved blocks qualify too, so a notebook written before 6 Oct opens clean.
 */
export function isSelfCheck(node: Node): boolean {
  return agentAsked(node) && (node.attrs.status as string) === 'resolved';
}

/**
 * Is this Q block Max's **open** question, which reads in the side rail rather than in the text
 * (D4)? The learner's own open question stays in the flow: they are writing it there.
 */
export function isRailQuestion(node: Node): boolean {
  return agentAsked(node) && ((node.attrs.status as string) || 'open') === 'open';
}

/**
 * The chip's one line: the question paragraph through `questionLine`, so an old block that still
 * carries the chat's preamble ("Max here. This one tests the statement…") shows the question.
 */
export function selfCheckLine(node: Node): string {
  return questionLine(questionParts(node).question);
}
