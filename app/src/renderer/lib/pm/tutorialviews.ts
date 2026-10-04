/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A TUTORIAL'S FIELDS: THE BLANKS AND THE TICK BOXES (`tutorials.md` §3, S7)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two node views, because a field and a tick box are controls, not text:
 *
 *  - **`tut_blank`** — an input in the sheet's own line (`Effect: ____`), sized to what is in it,
 *    with a six-character floor so an empty one still reads as a gap to fill. Typing writes the
 *    node's `value` attr; Tab and Enter go to the next blank, Shift+Tab to the one before, and
 *    the arrows at the field's edges step out into the words around it, as a form in Word does.
 *  - **`tut_choices`** — the sheet's options, each with a tick box (a radio when only one may be
 *    chosen), numbered as the sheet numbers them, `$tex$` typeset. A tick writes `picked`.
 *
 * **What a keystroke in a field is.** The value is an attr, so the learner's text never becomes
 * a text node: `setNodeMarkup` on a leaf is one `ReplaceStep` over the node, which the history
 * coalesces like typing (adjacent ranges within its delay) and the authorship stamp has no text to
 * stamp in. It is still the learner's edit — it is not dispatched as an agent's, so the store
 * hears it, saves it and counts it. ⌘Z in a field is the editor's undo, so one undo stack covers
 * the sheet and its fields.
 */

import type { Node } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { redo, undo } from 'prosemirror-history';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import { inlineToNodesWith } from '../../../shared/doc/inline.js';
import { notesSchema } from '../../../shared/doc/schema.js';
import type { TutorialOption } from '../../../shared/tutorial.js';
import { renderTex } from './math.js';
import { blankAfter, blankSpots } from './tutorialmodel.js';

/** Meta on a field's or a tick's transaction: the learner's, through a control rather than text. */
export const TUTORIAL_INPUT = 'chattered:tutorial-input';

// ── shared helpers ──────────────────────────────────────────────────────────────────────────

/** The inline subset (`**bold**`, `*em*`, `` `code` ``, `$tex$`) drawn into `target`, maths typeset. */
export function renderInline(target: HTMLElement, text: string): void {
  target.replaceChildren();
  for (const node of inlineToNodesWith(notesSchema, text, [])) {
    const names = new Set(node.marks.map((m) => m.type.name));
    const tex = node.marks.find((m) => m.type.name === 'math_inline');
    let inner: HTMLElement | Text;
    if (tex) {
      const span = document.createElement('span');
      span.className = 'nd-tut-tex';
      renderTex(span, (tex.attrs.tex as string) || node.text || '');
      inner = span;
    } else {
      inner = document.createTextNode(node.text ?? '');
    }
    for (const [mark, tag] of [
      ['code', 'code'],
      ['em', 'em'],
      ['strong', 'strong'],
    ] as const) {
      if (!names.has(mark)) continue;
      const wrap = document.createElement(tag);
      wrap.append(inner);
      inner = wrap;
    }
    target.append(inner);
  }
}

/** Focus the blank at `pos`, with the caret at its start or end, or its whole value selected. */
export function focusBlankAt(view: EditorView, pos: number, where: 'start' | 'end' | 'all'): boolean {
  const dom = view.nodeDOM(pos);
  const input = dom instanceof HTMLElement ? dom.querySelector('input') : null;
  if (!input) return false;
  input.focus();
  const end = input.value.length;
  if (where === 'all') input.setSelectionRange(0, end);
  else if (where === 'start') input.setSelectionRange(0, 0);
  else input.setSelectionRange(end, end);
  return true;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── a blank ─────────────────────────────────────────────────────────────────────────────────

class BlankView implements NodeView {
  readonly dom: HTMLElement;
  readonly #input: HTMLInputElement;
  #node: Node;
  readonly #view: EditorView;
  readonly #getPos: () => number | undefined;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.dom = document.createElement('span');
    this.dom.className = 'nd-tut-field';
    this.dom.contentEditable = 'false';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nd-tut-field-input';
    input.placeholder = '____';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Blank${node.attrs.blankId ? ` ${String(node.attrs.blankId)}` : ''}: type your answer`);
    this.#input = input;
    this.dom.append(input);
    this.#show((node.attrs.value as string) ?? '');

    input.addEventListener('input', () => this.#commit());
    input.addEventListener('keydown', (event) => this.#key(event));
    // A press on the field's padding (not the input) still lands in the input.
    this.dom.addEventListener('mousedown', (event) => {
      if (event.target === input) return;
      event.preventDefault();
      input.focus();
    });
  }

  #show(value: string): void {
    if (this.#input.value !== value) this.#input.value = value;
    this.dom.dataset.value = value;
    this.#input.readOnly = !this.#view.editable;
    this.dom.classList.toggle('nd-tut-field-filled', value.trim().length > 0);
  }

  #commit(): void {
    const value = this.#input.value;
    this.dom.dataset.value = value;
    this.dom.classList.toggle('nd-tut-field-filled', value.trim().length > 0);
    const pos = this.#getPos();
    if (pos === undefined || (this.#node.attrs.value as string) === value) return;
    const tr = this.#view.state.tr.setNodeMarkup(pos, undefined, { ...this.#node.attrs, value });
    tr.setMeta(TUTORIAL_INPUT, 'blank');
    this.#view.dispatch(tr);
  }

  /** Step out of the field into the sheet's words, before it (-1) or after it (1). */
  #leave(dir: -1 | 1): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const at = dir < 0 ? pos : pos + this.#node.nodeSize;
    const state = this.#view.state;
    this.#view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, Math.min(at, state.doc.content.size))));
    this.#view.focus();
  }

  /** Tab, Enter: the next blank in the sheet; Shift+Tab the one before. Past the last, out. */
  #move(dir: -1 | 1): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const target = blankAfter(blankSpots(this.#view.state.doc), pos, dir);
    if (target && focusBlankAt(this.#view, target.pos, 'all')) return;
    this.#leave(dir);
  }

  #key(event: KeyboardEvent): void {
    const input = this.#input;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault();
      const command = key === 'y' || event.shiftKey ? redo : undo;
      command(this.#view.state, this.#view.dispatch);
      return;
    }
    if (event.isComposing) return;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        this.#move(event.shiftKey ? -1 : 1);
        return;
      case 'Enter':
        event.preventDefault();
        this.#move(event.shiftKey ? -1 : 1);
        return;
      case 'Escape':
        event.preventDefault();
        this.#leave(1);
        return;
      case 'ArrowLeft':
        if (atStart && !event.shiftKey) {
          event.preventDefault();
          this.#leave(-1);
        }
        return;
      case 'ArrowRight':
        if (atEnd && !event.shiftKey) {
          event.preventDefault();
          this.#leave(1);
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.#leave(-1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.#leave(1);
        return;
    }
  }

  update(node: Node): boolean {
    if (node.type !== this.#node.type) return false;
    this.#node = node;
    this.#show((node.attrs.value as string) ?? '');
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as globalThis.Node | null;
    return target !== null && this.dom.contains(target);
  }

  ignoreMutation(): boolean {
    return true;
  }
}

// ── choose all that apply ───────────────────────────────────────────────────────────────────

let choiceGroups = 0;

/** The option's number as the sheet prints it: `i` → `i.`, `(a)` stays `(a)`. */
export function optionMark(id: string): string {
  const trimmed = id.trim();
  return /[.)]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The ticks after toggling `id`, in the sheet's order: one at most when `multi` is false. */
export function toggledPicks(options: readonly TutorialOption[], picked: readonly string[], id: string, on: boolean, multi: boolean): string[] {
  if (!multi) return on ? [id] : [];
  const set = new Set(picked);
  if (on) set.add(id);
  else set.delete(id);
  return options.map((o) => o.id).filter((o) => set.has(o));
}

class ChoicesView implements NodeView {
  readonly dom: HTMLElement;
  #node: Node;
  readonly #view: EditorView;
  readonly #getPos: () => number | undefined;
  readonly #name = `nd-tut-choice-${String(++choiceGroups)}`;
  #inputs = new Map<string, HTMLInputElement>();
  /** The radio pressed while already ticked: its click unticks it (a native radio cannot). */
  #pressed: string | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'nd-tut-choices';
    this.dom.contentEditable = 'false';
    this.#draw();
  }

  get #multi(): boolean {
    return this.#node.attrs.multi !== false;
  }

  get #options(): TutorialOption[] {
    return (this.#node.attrs.options as TutorialOption[] | null) ?? [];
  }

  get #picked(): string[] {
    return (this.#node.attrs.picked as string[] | null) ?? [];
  }

  #draw(): void {
    this.dom.replaceChildren();
    this.#inputs.clear();
    const multi = this.#multi;
    this.dom.setAttribute('role', multi ? 'group' : 'radiogroup');
    this.dom.setAttribute('aria-label', multi ? 'Choose all that apply' : 'Choose one');
    const picked = new Set(this.#picked);
    for (const option of this.#options) {
      const row = document.createElement('label');
      row.className = 'nd-tut-choice';
      const input = document.createElement('input');
      input.type = multi ? 'checkbox' : 'radio';
      input.name = this.#name;
      input.checked = picked.has(option.id);
      input.disabled = !this.#view.editable;
      row.classList.toggle('nd-on', input.checked);
      const mark = document.createElement('span');
      mark.className = 'nd-tut-choice-id';
      mark.textContent = optionMark(option.id);
      const text = document.createElement('span');
      text.className = 'nd-tut-choice-text';
      renderInline(text, option.text);
      row.append(input, mark, text);
      row.addEventListener('mousedown', () => {
        this.#pressed = input.checked ? option.id : null;
      });
      input.addEventListener('click', () => {
        const pressed = this.#pressed;
        this.#pressed = null;
        if (!multi && pressed === option.id) {
          input.checked = false;
          this.#commit(option.id, false);
        }
      });
      input.addEventListener('change', () => this.#commit(option.id, input.checked));
      this.#inputs.set(option.id, input);
      this.dom.append(row);
    }
  }

  #commit(id: string, on: boolean): void {
    const pos = this.#getPos();
    if (pos === undefined) return;
    const picked = toggledPicks(this.#options, this.#picked, id, on, this.#multi);
    if (sameJson(picked, this.#picked)) return;
    const tr = this.#view.state.tr.setNodeMarkup(pos, undefined, { ...this.#node.attrs, picked });
    tr.setMeta(TUTORIAL_INPUT, 'choice');
    this.#view.dispatch(tr);
  }

  update(node: Node): boolean {
    if (node.type !== this.#node.type) return false;
    const redraw = node.attrs.multi !== this.#node.attrs.multi || !sameJson(node.attrs.options, this.#node.attrs.options);
    this.#node = node;
    if (redraw) {
      this.#draw();
      return true;
    }
    const picked = new Set(this.#picked);
    for (const [id, input] of this.#inputs) {
      input.checked = picked.has(id);
      input.disabled = !this.#view.editable;
      input.closest('.nd-tut-choice')?.classList.toggle('nd-on', input.checked);
    }
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('nd-tut-choices-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('nd-tut-choices-selected');
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    return !!target?.closest?.('.nd-tut-choice');
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/** The tutorial's node views. `tut_part` and `tut_answer` are drawn by `toDOM` and the chrome. */
export function tutorialNodeViews(): Record<string, NodeViewConstructor> {
  return {
    tut_blank: (node, view, getPos) => new BlankView(node, view, getPos),
    tut_choices: (node, view, getPos) => new ChoicesView(node, view, getPos),
  };
}
