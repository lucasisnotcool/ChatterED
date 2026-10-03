import { describe, expect, it } from 'vitest';
import { Fragment, Slice, type Node } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { authorMark, notesSchema } from '../../../shared/doc/schema.js';
import {
  markPastedMath,
  mathClipboardText,
  mathInputRules,
  mathKey,
  mathPlugin,
  mathRuns,
  nextActive,
  pastedTextSlice,
} from './math.js';

const s = notesSchema;
const AT = 1_000;
const math = (tex: string) => s.marks.math_inline!.create({ tex });
const by = (who: 'user' | 'ellie') => authorMark(who, null, AT);
const t = (text: string, ...marks: ReturnType<typeof math>[]) => s.text(text, marks);
const para = (...content: Node[]) => s.nodes.paragraph!.create({ blockId: 'b_1' }, content);
const docOf = (...blocks: Node[]) => s.nodes.doc!.create(null, blocks);

/** "h = $h_{\max}$ ok", with the formula split by author the way a learner's edit splits it. */
function splitFormula(): Node {
  const m = math('h_{\\max}');
  return docOf(para(t('h = ', by('ellie')), t('h_{', m, by('ellie')), t('\\max}', m, by('user')), t(' ok', by('ellie'))));
}

describe('mathRuns', () => {
  it('reads a formula split across text nodes as one run, with its text as the source', () => {
    expect(mathRuns(splitFormula())).toEqual([{ from: 5, to: 13, tex: 'h_{\\max}' }]);
  });

  it('keeps two different formulas apart even when they touch', () => {
    const doc = docOf(para(t('a', math('a')), t('b', math('b'))));
    expect(mathRuns(doc).map((r) => r.tex)).toEqual(['a', 'b']);
  });
});

describe('nextActive', () => {
  const runs = [{ from: 5, to: 13, tex: 'x' }];
  it('shows the source when the selection is strictly inside, not at an edge', () => {
    expect(nextActive(runs, null, { from: 8, to: 8 }, undefined)).toBe(5);
    expect(nextActive(runs, null, { from: 13, to: 13 }, undefined)).toBeNull();
    expect(nextActive(runs, null, { from: 5, to: 5 }, undefined)).toBeNull();
  });
  it('keeps it shown at the edges once shown, and an explicit close wins', () => {
    expect(nextActive(runs, 5, { from: 13, to: 13 }, undefined)).toBe(5);
    expect(nextActive(runs, 5, { from: 14, to: 14 }, undefined)).toBeNull();
    expect(nextActive(runs, 5, { from: 8, to: 8 }, { deactivate: true })).toBeNull();
  });
});

describe('the plugin state', () => {
  const state = () => EditorState.create({ doc: splitFormula(), plugins: [mathPlugin()] });

  it('arms a formula for one transaction only', () => {
    const armed = state().apply(state().tr.setMeta(mathKey, { arm: 5 }));
    expect(mathKey.getState(armed)?.armed).toBe(5);
    const moved = armed.apply(armed.tr.setSelection(TextSelection.create(armed.doc, 2)));
    expect(mathKey.getState(moved)?.armed).toBeNull();
  });

  it('keeps the request to open a new display formula through a transaction appended after it', () => {
    const asked = state().apply(state().tr.setMeta(mathKey, { openBlockAt: 0 }));
    const appended = asked.apply(asked.tr.insertText('x', 2));
    expect(mathKey.getState(appended)?.openBlockAt).toBe(0);
    const cleared = appended.apply(appended.tr.setMeta(mathKey, { openBlockAt: null }));
    expect(mathKey.getState(cleared)?.openBlockAt).toBeNull();
  });

  it('maps the range being edited through an agent’s edit made meanwhile', () => {
    const editing = state().apply(state().tr.setMeta(mathKey, { editing: { kind: 'inline', from: 5, to: 13 } }));
    const shifted = editing.apply(editing.tr.insertText('Note: ', 1));
    expect(mathKey.getState(shifted)?.editing).toEqual({ kind: 'inline', from: 11, to: 19 });
  });
});

/** Run an input rule the way prosemirror-inputrules does: the text before the caret plus the key. */
function typeInto(doc: Node, caret: number, key: string): EditorState | null {
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, caret) });
  const $caret = state.doc.resolve(caret);
  const before = $caret.parent.textBetween(Math.max(0, $caret.parentOffset - 500), $caret.parentOffset, undefined, '￼') + key;
  // `match` and `handler` are the rule's internals; this is what the plugin does with them.
  type Rule = { match: RegExp; handler: (state: EditorState, match: RegExpExecArray, start: number, end: number) => Transaction | null };
  for (const rule of mathInputRules() as unknown as Rule[]) {
    const match = rule.match.exec(before);
    if (!match) continue;
    const tr = rule.handler(state, match, caret - (match[0].length - key.length), caret);
    if (tr) return state.apply(tr);
  }
  return null;
}

describe('typing a formula', () => {
  it('turns $x^2$ into a formula on the closing dollar, dollars gone', () => {
    const doc = docOf(para(t('so $x^2', by('user'))));
    const after = typeInto(doc, 1 + 'so $x^2'.length, '$')!;
    expect(after).not.toBeNull();
    expect(after.doc.textContent).toBe('so x^2');
    expect(mathRuns(after.doc)).toEqual([{ from: 4, to: 7, tex: 'x^2' }]);
  });

  it('turns \\(x\\) into a formula too', () => {
    const doc = docOf(para(t('\\(a+b\\', by('user'))));
    const after = typeInto(doc, 1 + '\\(a+b\\'.length, ')')!;
    expect(mathRuns(after.doc).map((r) => r.tex)).toEqual(['a+b']);
  });

  it('leaves money alone', () => {
    const doc = docOf(para(t('between $5 and ', by('user'))));
    expect(typeInto(doc, 1 + 'between $5 and '.length, '$')).toBeNull();
  });

  it('makes a display formula from $$ and a space on an empty line, and asks to open it', () => {
    const doc = docOf(para(t('$$', by('user'))));
    const after = typeInto(doc, 3, ' ')!;
    expect(after.doc.firstChild?.type.name).toBe('math_block');
  });
});

describe('copy', () => {
  it('writes formulas in dollars, a split one once, and a display one on its own line', () => {
    const doc = docOf(splitFormula().firstChild!, s.nodes.math_block!.create({ tex: '\\sum_i x_i' }));
    expect(mathClipboardText(new Slice(doc.content, 0, 0))).toBe('h = $h_{\\max}$ ok\n\n$$\\sum_i x_i$$');
  });
});

describe('paste', () => {
  it('reads ChatGPT’s delimiters from plain text: inline in the line, display as a block', () => {
    const slice = pastedTextSlice('so \\(h(s) \\le h^*(s)\\) holds\n\\[\\sum_i x_i\\]');
    const [line, block] = [slice.content.child(0), slice.content.child(1)];
    expect(line.textContent).toBe('so h(s) \\le h^*(s) holds');
    expect(mathRuns(s.nodes.doc!.create(null, [line])).map((r) => r.tex)).toEqual(['h(s) \\le h^*(s)']);
    expect(block.type.name).toBe('math_block');
    expect(block.attrs.tex).toBe('\\sum_i x_i');
    expect([slice.openStart, slice.openEnd]).toEqual([1, 0]);
  });

  it('reads pasted ** as two stars, not bold', () => {
    const slice = pastedTextSlice('**a** $b$');
    expect(slice.content.child(0).textContent).toBe('**a** b');
  });

  it('marks delimited text in a pasted fragment, and leaves code and money alone', () => {
    const fragment = Fragment.from([
      para(t('so $x$ here')),
      para(t('$y$', s.marks.code!.create())),
      para(t('costs $5 and $6')),
    ]);
    const marked = markPastedMath(fragment);
    expect(mathRuns(s.nodes.doc!.create(null, marked)).map((r) => r.tex)).toEqual(['x']);
    expect(marked.child(1).textContent).toBe('$y$');
    expect(marked.child(2).textContent).toBe('costs $5 and $6');
  });
});
