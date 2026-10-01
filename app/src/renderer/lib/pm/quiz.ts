/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE QUIZ (notebooks §5.3, 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A `quiz` block is three to five questions. Each `quiz_question` is real, editable text: a
 * prompt, (for multiple choice) the options, and an explanation that is the answer and why. All
 * of it is in the per-span author mark, so the guard protects what a learner writes in a quiz as
 * it protects a paragraph, and the author's key (`quiz_option.correct`) is part of the document
 * the learner can change (Mark correct).
 *
 * **The answer is held back.** A multiple-choice question shows its options as buttons; pressing
 * one reveals whether it was right and the explanation. A short-answer question has Show answer.
 * Try again (or Hide answer) puts it back. **That state is view chrome**: `data-revealed` and
 * `data-picked` on the question's own DOM, never a transaction, never saved, and so it can never
 * reach the progress ledger. A quiz fills no progress; the bar fills only on the learner's own
 * words (§6). **Editing reveals everything**: the caret in a question marks it `nd-item-active`
 * and the stylesheet shows the explanation and the key.
 *
 * Right and wrong are said in words (the status line, which is a polite live region, and the
 * ✓ / ✗ in the option's own marker), never by colour alone.
 */

import type { Node } from 'prosemirror-model';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { optionLabel } from '../../../shared/doc/schema.js';
import { addOption, markCorrect, questionAt, removeOption } from '../blockfields.js';
import { BlockView, ItemView, el, tool, type ItemViewConfig, type Run, type ToolSpec } from './blockkit.js';
import type { NodeViewContext } from './nodeviews.js';

/** `A`, `B`, … for the n-th option (0-based); the stylesheet counts the same way. */
export const optionLetter = optionLabel;

/** What the status line says once a multiple-choice question has been answered. */
export function verdictLine(correct: number | null, picked: number): string {
  if (correct === null) return 'No answer is marked for this question yet.';
  if (picked === correct) return 'Correct.';
  return `Not quite. The answer is ${optionLetter(correct)}.`;
}

/** question dom → its view, so an option's button can find the question it is in. */
const QUESTIONS = new WeakMap<HTMLElement, QuestionState>();

interface QuestionState {
  pick(index: number): void;
}

/** The question the item is, read from its node the way `quizSpec` reads a whole quiz. */
function questionOf(node: Node): { mc: boolean; correct: number | null; options: number } {
  let options = 0;
  let correct: number | null = null;
  node.forEach((child) => {
    if (child.type.name !== 'quiz_option') return;
    if (child.attrs.correct === true && correct === null) correct = options;
    options++;
  });
  return { mc: options > 0 && node.attrs.qtype !== 'short', correct, options };
}

function questionConfig(): ItemViewConfig {
  let picked: number | null = null;
  let revealed = false;
  let status: HTMLElement;
  let action: HTMLButtonElement;

  const CONFIG: ItemViewConfig = {
    type: 'quiz_question',
    className: 'nd-qz-q',
    build(item) {
      status = el('p', 'nd-qz-status');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      action = tool('nd-qz-action', 'Show answer', 'Show the answer', () => {
        if (questionOf(item.node).mc) {
          // Try again.
          picked = null;
          revealed = false;
          clearPicks(item.dom);
        } else {
          revealed = !revealed;
        }
        CONFIG.refresh?.(item);
      });
      QUESTIONS.set(item.dom, {
        pick(index) {
          if (revealed || !questionOf(item.node).mc) return;
          picked = index;
          revealed = true;
          item.dom.querySelectorAll<HTMLElement>('.nd-qz-option').forEach((option, i) => {
            option.dataset.picked = String(i === index);
          });
          CONFIG.refresh?.(item);
        },
      });
      return [status, action];
    },
    refresh(item) {
      const { mc, correct } = questionOf(item.node);
      const type = mc ? 'mc' : 'short';
      if (item.dom.dataset.type !== type) item.dom.dataset.type = type;
      // A question that stopped being multiple choice has nothing picked any more.
      if (!mc && picked !== null) {
        picked = null;
        clearPicks(item.dom);
      }
      const shown = String(revealed);
      if (item.dom.dataset.revealed !== shown) item.dom.dataset.revealed = shown;
      const line = mc && revealed && picked !== null ? verdictLine(correct, picked) : '';
      if (status.textContent !== line) status.textContent = line;
      status.dataset.verdict = mc && revealed && picked !== null && picked === correct ? 'right' : mc && revealed ? 'wrong' : '';
      // Multiple choice answers by pressing an option; Try again is all the button is for there.
      action.hidden = mc && !revealed;
      const label = mc ? 'Try again' : revealed ? 'Hide answer' : 'Show answer';
      if (action.textContent !== label) action.textContent = label;
    },
  };
  return CONFIG;
}

function clearPicks(dom: HTMLElement): void {
  dom.querySelectorAll<HTMLElement>('.nd-qz-option').forEach((option) => {
    delete option.dataset.picked;
  });
}

/** One option: its text is the contentDOM, and a button (A, B, … by the stylesheet) picks it. */
class OptionView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  #pick: HTMLButtonElement;

  constructor(node: Node) {
    this.dom = el('div', 'nd-qz-option');
    this.#pick = el('button', 'nd-qz-pick');
    this.#pick.type = 'button';
    this.#pick.contentEditable = 'false';
    this.#pick.setAttribute('aria-label', 'Choose this answer');
    this.#pick.addEventListener('mousedown', (event) => event.preventDefault());
    this.#pick.addEventListener('click', (event) => {
      event.preventDefault();
      const question = this.dom.closest<HTMLElement>('.nd-qz-q');
      if (!question) return;
      const options = Array.from(question.querySelectorAll<HTMLElement>('.nd-qz-option'));
      QUESTIONS.get(question)?.pick(options.indexOf(this.dom));
    });
    this.contentDOM = el('div', 'nd-qz-option-text');
    this.dom.append(this.#pick, this.contentDOM);
    this.#paint(node);
  }

  #paint(node: Node): void {
    const correct = String(node.attrs.correct === true);
    if (this.dom.dataset.correct !== correct) this.dom.dataset.correct = correct;
  }

  update(node: Node): boolean {
    if (node.type.name !== 'quiz_option') return false;
    this.#paint(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.#pick.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }
}

/**
 * The quiz's toolbar: the option commands, each enabled only where it can act. They are about the
 * question the caret is in, so with the caret elsewhere in the block they are dimmed, not hidden.
 */
function optionTools(run: Run): ToolSpec[] {
  const add = tool('nd-blk-tool', '+ Option', 'Add an option to the question the cursor is in', () =>
    run((state) => addOption(state)),
  );
  const mark = tool('nd-blk-tool', 'Mark correct', 'Make the option the cursor is in the right answer', () =>
    run((state) => markCorrect(state)),
  );
  const remove = tool('nd-blk-tool', 'Remove option', 'Remove the option the cursor is in', () =>
    run((state) => removeOption(state)),
  );
  return [
    { el: add, sync: (_node, hit, state) => void (add.disabled = hit === null || questionAt(state) === null) },
    { el: mark, sync: (_node, hit, state) => void (mark.disabled = hit === null || questionAt(state)?.option == null) },
    { el: remove, sync: (_node, hit, state) => void (remove.disabled = hit === null || questionAt(state)?.option == null) },
  ];
}

export function quizNodeViews(ctx: NodeViewContext): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    quiz: (node, view, getPos) =>
      new BlockView(node, view, getPos, {
        name: 'quiz',
        className: 'nd-qz',
        label: 'Quiz',
        itemName: 'Question',
        tools: optionTools,
      }),
    quiz_question: (node) => new ItemView(node, questionConfig(), ctx),
    quiz_option: (node) => new OptionView(node),
  };
}
