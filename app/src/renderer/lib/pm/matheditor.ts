/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE FORMULA EDITOR (2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * One popover, for an inline formula and a display one alike, opened by a click on a formula,
 * by ⌘⇧E, or by `$$` and a space on an empty line. Notion's shape: the formula is typeset in the
 * notes, and editing it happens beside it, not in place.
 *
 * **The field is MathLive's `<math-field>`**, because a learner who has never written LaTeX should
 * not have to: `/` makes a fraction, `^` a power, `_` a subscript, and typing `alpha`, `sqrt`,
 * `sum`, `>=` or `->` gives the symbol. A learner who does know LaTeX types `\` for raw TeX, or
 * opens the **LaTeX** box under the field, which edits the source directly and stays in step with
 * it. What is stored is always the TeX, so an agent reads what the learner wrote.
 *
 * Only one field exists at a time, created when it is opened: MathLive is about 230 KB gzipped,
 * so it is loaded on the first edit, and every formula at rest is KaTeX (`math.ts`). It sits
 * outside ProseMirror's DOM, appended to the notes pane like the citation preview
 * (`sourcepop.ts`), so the editor never sees its keystrokes and the field never fights the editor
 * for the selection.
 *
 * Enter, Done, or a click outside keeps the edit; Esc drops it. An arrow off either end of the
 * field keeps it and puts the caret on that side of the formula.
 */

import type { MathfieldElement } from 'mathlive';

export interface MathEditRequest {
  tex: string;
  display: boolean;
  /** Where the formula is on screen now. Read again on scroll, so the popover follows it. */
  anchor: () => { left: number; top: number; bottom: number } | null;
  /** The element the popover is appended to: the notes pane. */
  host: HTMLElement;
  /** The edit, kept (`tex`, and which side the caret goes), or null when it was dropped. */
  onClose: (result: { tex: string; exit: 'after' | 'before' } | null) => void;
  /** Shown as Remove when given: delete the formula. */
  onRemove?: () => void;
}

const EDGE = 8;

let loading: Promise<typeof MathfieldElement> | null = null;

/** MathLive, once, with KaTeX's fonts (already loaded by `main.ts`) rather than its own copy. */
function mathlive(): Promise<typeof MathfieldElement> {
  loading ??= import('mathlive').then((module) => {
    module.MathfieldElement.fontsDirectory = null;
    module.MathfieldElement.soundsDirectory = null;
    return module.MathfieldElement;
  });
  return loading;
}

let current: { close: (keep: boolean) => void } | null = null;

/** True while a formula is being edited. */
export function mathEditorOpen(): boolean {
  return current !== null;
}

/** Close the open editor, keeping its edit. */
export function closeMathEditor(): void {
  current?.close(true);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** MathLive's keyboard and menus live under `document.body`; a click in them is not "outside". */
function isMathLiveChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.ML__keyboard, .ui-menu-container, math-field') !== null;
}

export async function openMathEditor(request: MathEditRequest): Promise<void> {
  current?.close(true);
  const Field = await mathlive();

  const pop = el('div', 'nd-pop nd-matheditor');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', request.display ? 'Edit display formula' : 'Edit formula');

  const field = new Field();
  field.className = 'nd-matheditor-field';
  field.value = request.tex;
  // Plain parentheses: `\left(…\right)` adds spacing and is harder TeX for the agents to read.
  field.smartFence = false;
  field.mathVirtualKeyboardPolicy = 'manual';

  const hint = el(
    'p',
    'nd-matheditor-hint',
    'Type / for a fraction, ^ for a power and _ for a subscript, then → to step out of it. Names like alpha, sqrt, sum or >= give the symbol.',
  );

  const sourceToggle = el('button', 'nd-matheditor-link', 'LaTeX');
  sourceToggle.type = 'button';
  sourceToggle.title = 'Show and edit the LaTeX source';
  const source = el('textarea', 'nd-matheditor-source');
  source.spellcheck = false;
  source.rows = 2;
  source.value = request.tex;
  source.hidden = true;
  source.setAttribute('aria-label', 'LaTeX source');

  const actions = el('div', 'nd-matheditor-actions');
  const keyboard = el('button', 'nd-matheditor-link', 'Symbols');
  keyboard.type = 'button';
  keyboard.title = 'Show the on-screen keyboard of maths symbols';
  const done = el('button', 'nd-matheditor-done', 'Done');
  done.type = 'button';
  const spacer = el('span', 'nd-matheditor-spacer');
  actions.append(sourceToggle, keyboard, spacer);
  if (request.onRemove) {
    const remove = el('button', 'nd-matheditor-link', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      close(false);
      request.onRemove?.();
    });
    actions.append(remove);
  }
  actions.append(done);
  pop.append(field, source, hint, actions);

  // The two views of one formula stay in step: the field is the truth while it has focus.
  /** The TeX, without the empty boxes a template leaves (a sum's unused upper limit). */
  const texOfField = (): string => field.getValue('latex-without-placeholders');
  field.addEventListener('input', () => {
    if (document.activeElement !== source) source.value = texOfField();
  });
  source.addEventListener('input', () => {
    field.setValue(source.value, { silenceNotifications: true });
  });
  sourceToggle.addEventListener('click', () => {
    source.hidden = !source.hidden;
    sourceToggle.classList.toggle('nd-on', !source.hidden);
    if (!source.hidden) source.focus();
    place();
  });
  keyboard.addEventListener('click', () => {
    field.focus();
    window.mathVirtualKeyboard.show();
  });
  done.addEventListener('click', () => close(true));

  const place = (): void => {
    const at = request.anchor();
    if (at === null) return;
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const left = Math.min(Math.max(EDGE, at.left - 12), Math.max(EDGE, globalThis.innerWidth - width - EDGE));
    const below = at.bottom + 8;
    const top = below + height + EDGE <= globalThis.innerHeight ? below : Math.max(EDGE, at.top - height - 8);
    pop.style.left = `${String(Math.round(left))}px`;
    pop.style.top = `${String(Math.round(top))}px`;
  };

  let exit: 'after' | 'before' = 'after';
  let closed = false;
  const close = (keep: boolean): void => {
    if (closed) return;
    closed = true;
    current = null;
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    window.mathVirtualKeyboard.hide();
    const tex = (document.activeElement === source ? source.value : texOfField()).trim();
    pop.remove();
    request.onClose(keep ? { tex, exit } : null);
  };

  const onDown = (event: MouseEvent): void => {
    if (pop.contains(event.target as globalThis.Node) || isMathLiveChrome(event.target)) return;
    close(true);
  };
  pop.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(false);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && (event.target === field || event.target === source)) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    },
    true,
  );
  field.addEventListener('move-out', (event) => {
    const direction = event.detail.direction;
    if (direction !== 'forward' && direction !== 'backward') return;
    event.preventDefault();
    exit = direction === 'forward' ? 'after' : 'before';
    close(true);
  });

  request.host.append(pop);
  place();
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  current = { close };
  field.focus();
  field.executeCommand('moveToMathfieldEnd');
}
