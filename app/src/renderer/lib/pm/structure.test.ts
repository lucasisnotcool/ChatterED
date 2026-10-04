import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { GapCursor } from 'prosemirror-gapcursor';
import { notesSchema } from '../../../shared/doc/schema.js';
import { isComponent, lineAround } from './structure.js';

const s = notesSchema;
const p = (t: string) => s.nodes.paragraph!.create({ blockId: '' }, t ? s.text(t) : null);
const li = (t: string) => s.nodes.list_item!.create({}, p(t));
const part = (...content: Node[]) => s.nodes.tut_part!.create({ partId: 'P1', label: 'Problem 1', blockId: 'b_part' }, content);
const answer = (...content: Node[]) => s.nodes.tut_answer!.create({ blockId: 'b_ans' }, content);

/** The caret at the first place `needle` occurs in the text. */
function caretAt(doc: Node, needle: string): EditorState {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(needle)) at = pos + node.text!.indexOf(needle);
    return at < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, at) });
}

function run(state: EditorState, side: 'before' | 'after'): EditorState {
  let next = state;
  const ok = lineAround(side)(state, (tr: Transaction) => (next = state.apply(tr)));
  expect(ok).toBe(true);
  return next;
}

const outline = (doc: Node) => {
  const out: string[] = [];
  doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}`));
  return out;
};

describe('⌥↩ and ⇧⌥↩: a line outside the component the caret is in (2026-10-04)', () => {
  const doc = s.nodes.doc!.create({}, [p('before'), part(p('prompt'), answer(s.nodes.bullet_list!.create({}, [li('one'), li('two')]))), p('after')]);

  it('puts an empty line after the whole part, from deep inside its answer list, with the caret on it', () => {
    const next = run(caretAt(doc, 'two'), 'after');
    expect(outline(next.doc)).toEqual(['paragraph:before', 'tut_part:promptonetwo', 'paragraph:', 'paragraph:after']);
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
    expect(next.selection.$from.depth).toBe(1);
    expect(next.selection.$from.index(0)).toBe(2);
  });

  it('puts one before the part', () => {
    const next = run(caretAt(doc, 'prompt'), 'before');
    expect(outline(next.doc)).toEqual(['paragraph:before', 'paragraph:', 'tut_part:promptonetwo', 'paragraph:after']);
  });

  it('works from the gap cursor between two parts', () => {
    const two = s.nodes.doc!.create({}, [part(p('a')), part(p('b'))]);
    const gap = two.child(0).nodeSize;
    const state = EditorState.create({ doc: two, selection: new GapCursor(two.resolve(gap)) });
    expect(outline(run(state, 'after').doc)).toEqual(['tut_part:a', 'paragraph:', 'tut_part:b']);
  });

  it('works on a selected component, as a table or a diagram is selected', () => {
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, doc.child(0).nodeSize) });
    expect(outline(run(state, 'after').doc).slice(1, 3)).toEqual(['tut_part:promptonetwo', 'paragraph:']);
  });

  it('counts containers and atoms as components, and lines and lists not', () => {
    expect(isComponent(doc.child(1))).toBe(true);
    expect(isComponent(doc.child(0))).toBe(false);
    expect(isComponent(s.nodes.bullet_list!.create({}, [li('x')]))).toBe(false);
  });
});
