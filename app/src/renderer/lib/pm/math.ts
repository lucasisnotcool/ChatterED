/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * MATHS IN THE NOTES: TYPESET, TYPED, COPIED AND PASTED (2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `math_inline` is a mark whose text is the formula's TeX (`schema.ts`), and until now it was only
 * *styled*: the learner read `h_{\max} = \max\{1,1,1\}` in an italic face. The mark stays a mark —
 * the guard, the author stamp and the doc-text assessment all read text spans, and a formula the
 * learner typed is still their words — and the typesetting is a **decoration**:
 *
 *  - **At rest** the source is hidden (`nd-math-hidden`) and a KaTeX widget stands in its place.
 *    The caret steps over a formula as one unit (← →), and Backspace or Delete first highlights it
 *    and deletes it on the second press, so nothing the learner cannot see is ever deleted.
 *  - **Editing** is the popover (`matheditor.ts`): a click on a formula, ⌘⇧E, or `$$` and a space
 *    on an empty line. Notion's shape, with MathLive's field so no LaTeX is needed to write one.
 *  - **Typing it directly** still works for anyone who knows the notation: `$x^2$` becomes a
 *    formula on the closing `$`, and so does `\(x^2\)` on the closing `\)` (Pandoc's rules: no
 *    space just inside the dollars, so "$5 and $6" stays money). Backspace straight after undoes
 *    the conversion.
 *  - **A selection strictly inside a formula** (an undo, a search) shows its source in place with
 *    a live preview under it (`nd-math-src`), as Typora and Obsidian do. Enter or Esc puts it back.
 *
 * Copy writes `$…$` and `$$…$$` as the plain text, which pastes cleanly into Notion, Obsidian,
 * Overleaf, ChatGPT and Claude. Paste reads those, `\(…\)` and `\[…\]`, and the TeX inside
 * rendered maths from the web (`mathpaste.ts`), rather than the doubled characters a rendered
 * formula leaves in plain text.
 *
 * A formula split across text nodes (a learner's edit inside Ellie's formula splits it by author)
 * is one run here, as it is in `inline.ts`; the text, not the mark's `tex` attr, is the source.
 */

import katex from 'katex';
// KaTeX's stylesheet (and its fonts, which MathLive borrows), carried by the module that draws
// with it, so any surface with the editor has it, the dev harness included.
import 'katex/dist/katex.min.css';
import { Fragment, Slice, type Mark, type Node, type ResolvedPos } from 'prosemirror-model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { InputRule, undoInputRule } from 'prosemirror-inputrules';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { notesSchema } from '../../../shared/doc/schema.js';
import { displayMathOf, hasMathDelimiters, mathSegments } from '../../../shared/doc/tex.js';
import { openMathEditor } from './matheditor.js';
import { normalisePastedMathHtml } from './mathpaste.js';

export interface MathRun {
  from: number;
  to: number;
  /** The formula's source: the run's text. */
  tex: string;
}

function mathMarkOf(node: Node): Mark | null {
  return node.isText ? (node.marks.find((m) => m.type.name === 'math_inline') ?? null) : null;
}

/** Every inline formula in the document, in order. A run is adjacent text wearing an equal mark. */
export function mathRuns(doc: Node): MathRun[] {
  const runs: MathRun[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let open: { from: number; to: number; tex: string; mark: Mark } | null = null;
    node.forEach((child, offset) => {
      const from = pos + 1 + offset;
      const mark = mathMarkOf(child);
      if (mark !== null && open !== null && open.to === from && open.mark.eq(mark)) {
        open.to += child.nodeSize;
        open.tex += child.text ?? '';
        return;
      }
      if (open !== null) runs.push({ from: open.from, to: open.to, tex: open.tex });
      open = mark === null ? null : { from, to: from + child.nodeSize, tex: child.text ?? '', mark };
    });
    if (open !== null) {
      const last: { from: number; to: number; tex: string } = open;
      runs.push({ from: last.from, to: last.to, tex: last.tex });
    }
    return false;
  });
  return runs;
}

/** The range the popover is editing, mapped through every transaction while it is open. */
export interface MathEditing {
  kind: 'inline' | 'block';
  from: number;
  to: number;
}

export interface MathState {
  runs: MathRun[];
  /** The `from` of the formula showing its source in place, or null. */
  active: number | null;
  /** The `from` of a formula one Backspace or Delete away from being deleted, or null. */
  armed: number | null;
  /** What the popover is editing, or null. */
  editing: MathEditing | null;
  /** A display formula just made by `$$`, to open the popover on once the view has it. */
  openBlockAt: number | null;
}

type MathMeta =
  | { activate: number }
  | { deactivate: true }
  | { arm: number }
  | { editing: MathEditing | null }
  | { openBlockAt: number | null };

export const mathKey = new PluginKey<MathState>('chattered:math');

/**
 * Which formula shows its source after a transaction. Pure, so the rules are tested without a view:
 *
 *  1. An explicit `activate` or `deactivate` wins.
 *  2. A formula showing its source keeps showing it while the selection is within it, edges
 *     included, so the caret can sit at either end.
 *  3. Otherwise a formula the selection is **strictly inside** shows its source (an undo or a
 *     search that put the caret there).
 */
export function nextActive(
  runs: readonly MathRun[],
  previous: number | null,
  selection: { from: number; to: number },
  meta: MathMeta | undefined,
): number | null {
  if (meta && 'deactivate' in meta) return null;
  if (meta && 'activate' in meta) {
    const run = runs.find((r) => r.from <= meta.activate && meta.activate <= r.to);
    return run ? run.from : null;
  }
  if (previous !== null) {
    const run = runs.find((r) => r.from <= previous && previous <= r.to);
    if (run && selection.from >= run.from && selection.to <= run.to) return run.from;
  }
  const inside = runs.find((r) => r.from < selection.from && selection.to < r.to);
  return inside ? inside.from : null;
}

/** KaTeX with the app's settings (`aitext.ts`): a broken formula shows as written, never as a card. */
export function renderTex(target: HTMLElement, tex: string, display = false): void {
  try {
    katex.render(tex, target, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    target.textContent = tex;
    target.classList.add('nd-math-error');
  }
}

// ── the popover, opened on a formula ───────────────────────────────────────────────────────────

function hostOf(view: EditorView): HTMLElement {
  return view.dom.closest<HTMLElement>('.nd') ?? document.body;
}

function setEditing(view: EditorView, editing: MathEditing | null): void {
  view.dispatch(view.state.tr.setMeta(mathKey, { editing }));
}

/** The marks a rewritten formula keeps: bold and italics. The author mark is the stamp's to add. */
function keptMarks($at: ResolvedPos, from: number, to: number, doc: Node): Mark[] {
  const first = from < to ? doc.nodeAt(from) : null;
  const marks = first ? first.marks : $at.marks();
  return marks.filter((m) => m.type.name === 'strong' || m.type.name === 'em');
}

/**
 * Edit an inline formula, or write a new one over `[from, to)`. `anchor` is the element the
 * formula is drawn in, when a click opened it; otherwise the popover hangs from the caret.
 */
export function editInline(view: EditorView, range: { from: number; to: number }, tex: string, anchor?: HTMLElement): void {
  setEditing(view, { kind: 'inline', from: range.from, to: range.to });
  void openMathEditor({
    tex,
    display: false,
    host: hostOf(view),
    anchor: () => {
      if (anchor?.isConnected) return anchor.getBoundingClientRect();
      const editing = mathKey.getState(view.state)?.editing;
      return editing ? view.coordsAtPos(editing.from) : null;
    },
    onRemove: range.from < range.to ? () => finishInline(view, { tex: '', exit: 'after' }) : undefined,
    onClose: (result) => finishInline(view, result),
  });
}

function finishInline(view: EditorView, result: { tex: string; exit: 'after' | 'before' } | null): void {
  const editing = mathKey.getState(view.state)?.editing;
  if (!editing || editing.kind !== 'inline') return;
  const { from, to } = editing;
  const tr = view.state.tr.setMeta(mathKey, { editing: null });
  const before = view.state.doc.textBetween(from, to);
  if (result !== null && result.tex !== before) {
    if (result.tex.length > 0) {
      const marks = [...keptMarks(tr.doc.resolve(from), from, to, tr.doc), notesSchema.marks.math_inline!.create({ tex: result.tex })];
      tr.replaceWith(from, to, notesSchema.text(result.tex, marks));
    } else {
      tr.delete(from, to);
    }
  }
  const end = tr.mapping.map(to, result?.tex === before ? -1 : 1);
  const caret = result?.exit === 'before' ? from : end;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
  view.dispatch(tr);
  view.focus();
}

/** Edit the display formula at `pos`. A new one (empty) that is left empty is removed again. */
export function editBlock(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'math_block') return;
  setEditing(view, { kind: 'block', from: pos, to: pos + node.nodeSize });
  void openMathEditor({
    tex: (node.attrs.tex as string) || '',
    display: true,
    host: hostOf(view),
    anchor: () => {
      const editing = mathKey.getState(view.state)?.editing;
      const dom = editing ? view.nodeDOM(editing.from) : null;
      return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
    },
    onRemove: () => finishBlock(view, { tex: '', exit: 'after' }),
    onClose: (result) => finishBlock(view, result),
  });
}

function finishBlock(view: EditorView, result: { tex: string; exit: 'after' | 'before' } | null): void {
  const editing = mathKey.getState(view.state)?.editing;
  if (!editing || editing.kind !== 'block') return;
  const tr = view.state.tr.setMeta(mathKey, { editing: null });
  const node = tr.doc.nodeAt(editing.from);
  if (node && node.type.name === 'math_block') {
    const tex = result === null ? ((node.attrs.tex as string) || '') : result.tex;
    if (tex.length === 0) {
      tr.delete(editing.from, editing.from + node.nodeSize);
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(editing.from, tr.doc.content.size))));
    } else {
      if (tex !== node.attrs.tex) tr.setNodeMarkup(editing.from, undefined, { ...node.attrs, tex });
      const side = result?.exit === 'before' ? editing.from : editing.from + node.nodeSize;
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(side, tr.doc.content.size)), result?.exit === 'before' ? -1 : 1));
    }
  }
  view.dispatch(tr);
  view.focus();
}

/**
 * **⌘⇧E** (Notion's key): edit the formula at the caret, or write a new one — from the selected
 * text when there is a selection, or empty at the caret.
 */
export const editFormula: Command = (state, dispatch, view) => {
  const selection = state.selection;
  if (selection instanceof NodeSelection && selection.node.type.name === 'math_block') {
    if (dispatch && view) editBlock(view, selection.from);
    return true;
  }
  const $from = selection.$from;
  if (!$from.parent.isTextblock || !$from.parent.type.allowsMarkType(notesSchema.marks.math_inline!)) return false;
  if (!$from.sameParent(selection.$to)) return false;
  if (!dispatch || !view) return true;
  const runs = mathKey.getState(state)?.runs ?? [];
  const run = runs.find((r) => r.from <= selection.from && selection.to <= r.to);
  if (run) {
    editInline(view, run, run.tex);
    return true;
  }
  const text = state.doc.textBetween(selection.from, selection.to).trim();
  const tex = mathSegments(text).length === 1 ? (mathSegments(text)[0]!.tex ?? text) : text;
  editInline(view, { from: selection.from, to: selection.to }, tex);
  return true;
};

// ── decorations ────────────────────────────────────────────────────────────────────────────────

/** The typeset formula at rest. A click opens the popover on it. */
function restingWidget(tex: string, armed: boolean, editing: boolean) {
  return (view: EditorView, getPos: () => number | undefined): HTMLElement => {
    const span = document.createElement('span');
    span.className = `nd-math${armed ? ' nd-math-armed' : ''}${editing ? ' nd-math-editing' : ''}`;
    span.contentEditable = 'false';
    span.title = armed ? 'Press again to delete this formula' : 'Click to edit this formula';
    renderTex(span, tex);
    span.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (!view.editable) return;
      const at = getPos();
      const run = at === undefined ? undefined : mathKey.getState(view.state)?.runs.find((r) => r.from === at);
      if (run) editInline(view, run, run.tex, span);
    });
    return span;
  };
}

/** The live preview under a formula's source while it is shown in place. */
function previewWidget(tex: string) {
  return (): HTMLElement => {
    const anchor = document.createElement('span');
    anchor.className = 'nd-math-preview-anchor';
    anchor.contentEditable = 'false';
    const box = document.createElement('span');
    box.className = 'nd-math-preview';
    const rendered = document.createElement('span');
    if (tex.trim().length > 0) renderTex(rendered, tex);
    else rendered.textContent = 'An empty formula';
    const hint = document.createElement('span');
    hint.className = 'nd-math-hint';
    hint.textContent = 'Enter to finish';
    box.append(rendered, hint);
    anchor.append(box);
    return anchor;
  };
}

/** One set per plugin state: a caret that moves through plain text keeps the same state object. */
const decorated = new WeakMap<MathState, DecorationSet>();

function decorate(state: EditorState, math: MathState): DecorationSet {
  const cached = decorated.get(math);
  if (cached) return cached;
  const decorations: Decoration[] = [];
  for (const run of math.runs) {
    if (run.from === math.active) {
      decorations.push(Decoration.inline(run.from, run.to, { class: 'nd-math-src' }));
      decorations.push(Decoration.widget(run.to, previewWidget(run.tex), { side: 1, key: `mp:${run.tex}`, ignoreSelection: true }));
      continue;
    }
    const armed = run.from === math.armed;
    const editing = math.editing?.kind === 'inline' && math.editing.from === run.from;
    decorations.push(Decoration.inline(run.from, run.to, { class: 'nd-math-hidden' }));
    decorations.push(
      Decoration.widget(run.from, restingWidget(run.tex, armed, editing), {
        side: 1,
        key: `m:${armed ? 'a' : ''}${editing ? 'e' : ''}:${run.tex}`,
        ignoreSelection: true,
        stopEvent: (event) => event.type === 'mousedown',
      }),
    );
  }
  const set = DecorationSet.create(state.doc, decorations);
  decorated.set(math, set);
  return set;
}

// ── keys ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The keys at a formula's edge. At rest, ← and → step over it as one unit; Backspace and Delete
 * highlight it, and delete it on the second press. While its source is shown in place, Enter and
 * Esc put it back, and an arrow off either end does too. Enter on a selected display formula
 * opens it.
 */
export function mathKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const math = mathKey.getState(view.state);
  const selection = view.state.selection;
  if (!math) return false;

  if (selection instanceof NodeSelection && selection.node.type.name === 'math_block' && event.key === 'Enter') {
    editBlock(view, selection.from);
    return true;
  }
  if (!selection.empty) return false;
  const head = selection.head;
  const move = (pos: number, meta: MathMeta = { deactivate: true }): true => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setMeta(mathKey, meta));
    return true;
  };

  const active = math.active === null ? null : (math.runs.find((r) => r.from === math.active) ?? null);
  if (active !== null) {
    if (event.key === 'Enter' || event.key === 'Escape') return move(active.to);
    if (event.key === 'ArrowRight' && head === active.to) return move(active.to);
    if (event.key === 'ArrowLeft' && head === active.from) return move(active.from);
    return false;
  }

  const before = math.runs.find((r) => r.to === head);
  const after = math.runs.find((r) => r.from === head);
  if (event.key === 'ArrowLeft' && before) return move(before.from);
  if (event.key === 'ArrowRight' && after) return move(after.to);
  const target = event.key === 'Backspace' ? before : event.key === 'Delete' ? after : undefined;
  if (target) {
    // Straight after `$x$` became a formula, Backspace undoes that rather than arming it.
    if (event.key === 'Backspace' && undoInputRule(view.state, view.dispatch)) return true;
    if (math.armed === target.from) {
      view.dispatch(view.state.tr.delete(target.from, target.to).scrollIntoView());
    } else {
      view.dispatch(view.state.tr.setMeta(mathKey, { arm: target.from }));
    }
    return true;
  }
  return false;
}

// ── typing it ──────────────────────────────────────────────────────────────────────────────────

function inlineMathRule(pattern: RegExp): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const lead = match[1] ?? '';
    const tex = (match[2] ?? '').trim();
    const from = start + lead.length;
    const $from = state.doc.resolve(from);
    if (tex.length === 0 || !$from.parent.type.allowsMarkType(notesSchema.marks.math_inline!)) return null;
    if ($from.marks().some((m) => m.type.name === 'code' || m.type.name === 'math_inline')) return null;
    const marks = [...$from.marks().filter((m) => m.type.name === 'strong' || m.type.name === 'em'), notesSchema.marks.math_inline!.create({ tex })];
    return state.tr.replaceWith(from, end, notesSchema.text(tex, marks));
  });
}

/** `$x^2$` and `\(x^2\)`: a formula, on the closing delimiter. */
export function mathInputRules(): InputRule[] {
  return [
    // Pandoc's `tex_math_dollars`: no space just inside either dollar, and not `$$`.
    inlineMathRule(/(^|[^$\\])\$([^\s$](?:[^$\n]*[^\s$])?)\$$/),
    inlineMathRule(/(^|[^\\])\\\((.+?)\\\)$/),
    // `$$` and a space on an empty line: a display formula, opened in the popover.
    new InputRule(/^\$\$\s$/, (state, _match, start) => {
      const $start = state.doc.resolve(start);
      const parent = $start.parent;
      if (parent.type.name !== 'paragraph' || parent.textContent !== '$$') return null;
      const at = $start.before();
      const index = $start.index(-1);
      if (!$start.node(-1).canReplaceWith(index, index + 1, notesSchema.nodes.math_block!)) return null;
      const tr = state.tr.replaceWith(at, at + parent.nodeSize, notesSchema.nodes.math_block!.create({ tex: '' }));
      return tr.setSelection(NodeSelection.create(tr.doc, at)).setMeta(mathKey, { openBlockAt: at });
    }),
  ];
}

// ── copy and paste ─────────────────────────────────────────────────────────────────────────────

/** A textblock's inline content as text, each formula in `$…$`. */
function inlineText(block: Node): string {
  let out = '';
  let open: Mark | null = null;
  block.forEach((child) => {
    const mark = mathMarkOf(child);
    if (open !== null && (mark === null || !mark.eq(open))) {
      out += '$';
      open = null;
    }
    if (mark !== null && open === null) {
      out += '$';
      open = mark;
    }
    if (child.isText) out += child.text ?? '';
    else if (child.type.name === 'hard_break') out += '\n';
  });
  if (open !== null) out += '$';
  return out;
}

/**
 * **What a copy puts on the clipboard as plain text**: the text, every inline formula in `$…$` and
 * every display formula as `$$…$$` on its own line, blocks a blank line apart (ProseMirror's own
 * default, which wrote a formula's bare source with nothing around it).
 */
export function mathClipboardText(slice: Slice): string {
  const blocks: string[] = [];
  const walk = (fragment: Fragment): void => {
    fragment.forEach((node) => {
      if (node.type.name === 'math_block') blocks.push(`$$${(node.attrs.tex as string) || ''}$$`);
      else if (node.isTextblock) blocks.push(inlineText(node));
      else if (node.isText) blocks.push(inlineText(notesSchema.nodes.paragraph!.create(null, node)));
      else if (!node.isLeaf) walk(node.content);
    });
  };
  walk(slice.content);
  return blocks.join('\n\n');
}

/** A line of pasted text as inline content, its formulas marked. Display ones go inline too. */
function lineContent(line: string, marks: readonly Mark[] = []): Node[] {
  const nodes: Node[] = [];
  for (const segment of mathSegments(line)) {
    if (segment.text.length === 0) continue;
    const extra = segment.tex !== null ? [notesSchema.marks.math_inline!.create({ tex: segment.tex })] : [];
    nodes.push(notesSchema.text(segment.text, [...marks, ...extra]));
  }
  return nodes;
}

/**
 * **Plain text pasted** (ChatGPT's and Claude's copy buttons give markdown with `\(…\)`, `\[…\]`,
 * `$…$` or `$$…$$`): one paragraph per line, its formulas marked, and a line that is only a
 * display formula as a formula block. Nothing else is read as markup: a pasted `**` is two stars.
 */
export function pastedTextSlice(text: string): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: Node[] = [];
  for (const line of lines) {
    const display = displayMathOf(line);
    if (display !== null) nodes.push(notesSchema.nodes.math_block!.create({ tex: display }));
    else nodes.push(notesSchema.nodes.paragraph!.create(null, lineContent(line)));
  }
  const first = nodes[0];
  const last = nodes.at(-1);
  return new Slice(Fragment.from(nodes), first?.isTextblock ? 1 : 0, last?.isTextblock ? 1 : 0);
}

/** Text in a pasted slice that still carries delimiters (a page with unrendered TeX) gets marked. */
export function markPastedMath(fragment: Fragment): Fragment {
  const out: Node[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      const skip = node.marks.some((m) => m.type.name === 'code' || m.type.name === 'math_inline');
      if (!skip && hasMathDelimiters(node.text ?? '')) out.push(...lineContent(node.text ?? '', node.marks));
      else out.push(node);
      return;
    }
    if (node.type.name === 'code_block' || node.isLeaf) {
      out.push(node);
      return;
    }
    out.push(node.copy(markPastedMath(node.content)));
  });
  return Fragment.from(out);
}

// ── the plugin ─────────────────────────────────────────────────────────────────────────────────

export function mathPlugin(): Plugin<MathState> {
  return new Plugin<MathState>({
    key: mathKey,
    state: {
      init: (_config, state) => ({ runs: mathRuns(state.doc), active: null, armed: null, editing: null, openBlockAt: null }),
      apply(tr: Transaction, value: MathState, _old: EditorState, next: EditorState): MathState {
        const runs = tr.docChanged ? mathRuns(next.doc) : value.runs;
        const meta = tr.getMeta(mathKey) as MathMeta | undefined;
        const previous = value.active === null ? null : tr.mapping.map(value.active, 1);
        const active = nextActive(runs, previous, next.selection, meta);
        // Armed for one keypress: anything else that happens disarms it.
        const armed = meta && 'arm' in meta ? meta.arm : null;
        const editing =
          meta && 'editing' in meta
            ? meta.editing
            : value.editing === null
              ? null
              : { kind: value.editing.kind, from: tr.mapping.map(value.editing.from, 1), to: Math.max(tr.mapping.map(value.editing.from, 1), tr.mapping.map(value.editing.to, -1)) };
        // Kept, mapped, until the view opens it and clears it: the authorship stamp appends a
        // transaction of its own to the one that made the block, before the view sees either.
        const openBlockAt =
          meta && 'openBlockAt' in meta ? meta.openBlockAt : value.openBlockAt === null ? null : tr.mapping.map(value.openBlockAt);
        const same =
          runs === value.runs &&
          active === value.active &&
          armed === value.armed &&
          openBlockAt === value.openBlockAt &&
          editing?.from === value.editing?.from &&
          editing?.to === value.editing?.to &&
          editing?.kind === value.editing?.kind;
        return same ? value : { runs, active, armed, editing, openBlockAt };
      },
    },
    view: () => ({
      update(view) {
        const at = mathKey.getState(view.state)?.openBlockAt ?? null;
        if (at === null) return;
        view.dispatch(view.state.tr.setMeta(mathKey, { openBlockAt: null }));
        editBlock(view, at);
      },
    }),
    props: {
      decorations(state) {
        const math = mathKey.getState(state);
        return math ? decorate(state, math) : null;
      },
      handleKeyDown: mathKeyDown,
      clipboardTextSerializer: (slice) => mathClipboardText(slice),
      clipboardTextParser: (text) => pastedTextSlice(text),
      transformPastedHTML: (html) => normalisePastedMathHtml(html),
      transformPasted: (slice) => new Slice(markPastedMath(slice.content), slice.openStart, slice.openEnd),
    },
  });
}
