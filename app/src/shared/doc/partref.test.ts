import { Slice, type Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { liveTutorialIds, partAsReference, referencePastedParts, unnestCopiedParts } from './partref.js';
import { notesSchema } from './schema.js';

const s = notesSchema;
const text = (t: string) => s.text(t);
const p = (...content: (Node | string)[]) =>
  s.nodes.paragraph!.create({ blockId: '' }, content.map((c) => (typeof c === 'string' ? text(c) : c)));
const blank = (blankId: string, value: string) => s.nodes.tut_blank!.create({ blankId, value });
const answer = (...content: Node[]) => s.nodes.tut_answer!.create({ blockId: '' }, content);
const part = (partId: string, label: string, ...content: Node[]) =>
  s.nodes.tut_part!.create({ partId, label, blockId: `b_${partId}`, pages: [65] }, content);
const choices = () =>
  s.nodes.tut_choices!.create({ options: [{ id: 'i', text: 'H1 (P1,P3)' }, { id: 'ii', text: 'H1 (P1,P2)' }], picked: ['ii'] });
const doc = (...content: Node[]) => s.nodes.doc!.create({}, content);

const partI = part('P3A.i', 'Problem 3 A) i.', p('Action(H1, Precond: ', blank('k1', '¬A'), ', Effect: )'), answer(p('[P1, P2]')));
const partB = part('P3B', 'Problem 3 B)', p('Which sequences reach the goal?'), choices());

describe('a part copied elsewhere pastes as a reference (2026-10-04)', () => {
  const live = liveTutorialIds(doc(partI, partB));

  it('knows the ids already in the sheet', () => {
    expect([...live.parts]).toEqual(['P3A.i', 'P3B']);
    expect([...live.blanks]).toEqual(['k1']);
  });

  it('turns a whole part into a labelled reference, its blank and its answer as text', () => {
    const out = referencePastedParts(new Slice(doc(partI).content, 0, 0), live);
    const blocks: string[] = [];
    out.content.forEach((n) => blocks.push(`${n.type.name}:${n.textContent}`));
    expect(blocks).toEqual(['paragraph:From Problem 3 A) i.:', 'paragraph:Action(H1, Precond: [¬A], Effect: )', 'paragraph:[P1, P2]']);
    out.content.descendants((n) => {
      expect(n.type.name).not.toMatch(/^tut_/);
      return true;
    });
  });

  it('pastes a phrase copied from inside a part as just the phrase', () => {
    const slice = doc(partI).slice(3, 10, true); // inside the first paragraph of the part, as the clipboard takes it
    expect(slice.openStart).toBe(2);
    const out = referencePastedParts(slice, live);
    expect(out.openStart).toBe(1);
    expect(out.content.firstChild!.type.name).toBe('paragraph');
    expect(out.content.textBetween(0, out.content.size)).toBe(slice.content.textBetween(0, slice.content.size));
  });

  it('keeps a part live when it is pasted after being cut (its id is no longer in the sheet)', () => {
    const elsewhere = { parts: new Set<string>(), blanks: new Set<string>() };
    const out = referencePastedParts(new Slice(doc(partI).content, 0, 0), elsewhere);
    expect(out.content.firstChild!.type.name).toBe('tut_part');
  });

  it('writes choices out as lines, the ticked one marked', () => {
    const lines: string[] = [];
    for (const n of partAsReference(partB)) n.descendants((c) => (c.isTextblock ? (lines.push(c.textContent), false) : true));
    expect(lines).toEqual(['[ ] i. H1 (P1,P3)', '[x] ii. H1 (P1,P2)']);
  });
});

describe('the copies already made are put right when the sheet opens', () => {
  it('turns parts nested in another part, with an id the sheet already has, into references, keeping the learner text', () => {
    const notes = p('P1 -> A and B');
    const broken = doc(partI, part('P3B', 'Problem 3 B)', p('Which sequences reach the goal?'), notes, partI, choices()));
    const fixed = unnestCopiedParts(broken);
    const ids: string[] = [];
    fixed.descendants((n) => (n.type.name === 'tut_part' ? (ids.push(n.attrs.partId as string), true) : true));
    expect(ids).toEqual(['P3A.i', 'P3B']);
    const b = fixed.child(1);
    const lines: string[] = [];
    b.forEach((n) => lines.push(`${n.type.name}:${n.textContent.slice(0, 30)}`));
    expect(lines).toEqual([
      'paragraph:Which sequences reach the goal',
      'paragraph:P1 -> A and B',
      'paragraph:From Problem 3 A) i.:',
      'paragraph:Action(H1, Precond: [¬A], Effe',
      'paragraph:[P1, P2]',
      'tut_choices:',
    ]);
  });

  it('lifts a nested part that is the only one with its id out after its container', () => {
    const lone = part('P9', 'Problem 9', p('nine'));
    const fixed = unnestCopiedParts(doc(part('P1', 'Problem 1', p('one'), lone)));
    expect(fixed.childCount).toBe(2);
    expect(fixed.child(1).attrs.partId).toBe('P9');
  });

  it('makes a second top-level part with the same id a reference', () => {
    const fixed = unnestCopiedParts(doc(partI, p('between'), partI));
    expect(fixed.child(2).textContent).toBe('From Problem 3 A) i.:');
  });

  it('leaves a sound sheet alone', () => {
    const sound = doc(partI, partB);
    expect(unnestCopiedParts(sound)).toBe(sound);
  });
});
