import { Fragment } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { docOutline, docFromJson, notesSchema } from './schema.js';
import { FIXTURE_SHEET } from './tutorial.fixture.test-support.js';
import { carryAnswers, partAnswers, partBlockIds, SHEET_ADMIN_REASON, tutorialDoc, tutorialDocJson } from './tutorialdoc.js';
import { nodesToInline } from './inline.js';

let n = 0;
const ids = (): string => `b_${String(++n).padStart(4, '0')}`;

describe('tutorialDoc', () => {
  const doc = tutorialDoc(FIXTURE_SHEET, { pageBase: 58, at: 1, newId: ids });

  it('round-trips through JSON and passes the schema check', () => {
    const json = tutorialDocJson(FIXTURE_SHEET, { pageBase: 58, at: 1, newId: ids });
    expect(() => docFromJson(json)).not.toThrow();
  });

  it('opens with the title, keeps the admin blocks marked, and cites notebook pages', () => {
    expect(doc.firstChild!.type.name).toBe('heading');
    expect(doc.firstChild!.textContent).toBe('Tutorial 9: Planning practice');
    const admin = doc.child(1);
    expect(admin.attrs.reason).toBe(SHEET_ADMIN_REASON);
    expect(admin.attrs.pages).toEqual([59]);
  });

  it('turns every part into a tut_part with the slot its answer takes', () => {
    const kinds: Record<string, string[]> = {};
    doc.descendants((node) => {
      if (node.type.name !== 'tut_part') return true;
      const names: string[] = [];
      node.forEach((c) => names.push(c.type.name));
      kinds[node.attrs.partId as string] = names;
      return false;
    });
    expect(kinds.P1a).toEqual(['paragraph', 'tut_answer']);
    expect(kinds.P1b).toEqual(['paragraph', 'tut_answer']);
    expect(kinds.P2).toEqual(['paragraph', 'tut_answer']);
    expect(kinds['P3A.i']).toEqual(['paragraph', 'paragraph']);
    expect(kinds.P3B).toEqual(['paragraph', 'tut_choices']);
  });

  it('puts a field where the sheet had a blank, and the figure in a line of text', () => {
    let blanks = 0;
    let images = 0;
    doc.descendants((node) => {
      if (node.type.name === 'tut_blank') blanks++;
      if (node.type.name === 'slide_image') {
        images++;
        expect(node.attrs.page).toBe(60);
      }
      return true;
    });
    expect(blanks).toBe(1);
    expect(images).toBe(1);
  });

  it('gives every part and its children a block id the outline can address', () => {
    const outline = docOutline(doc);
    const parts = outline.filter((e) => e.kind === 'tut_part');
    expect(parts).toHaveLength(5);
    expect(outline.some((e) => e.kind === 'tut_answer')).toBe(true);
    expect(outline.find((e) => e.kind === 'tut_choices')!.text).toContain('[ ] i. K1 (Q1, Q2)');
    expect(partBlockIds(doc).get('P3B')).toMatch(/^b_/);
  });
});

describe('partAnswers', () => {
  it('reads an empty sheet as every part empty', () => {
    const answers = partAnswers(tutorialDoc(FIXTURE_SHEET, { pageBase: 0, newId: ids }));
    expect(answers.map((a) => a.partId)).toEqual(['P1a', 'P1b', 'P2', 'P3A.i', 'P3B']);
    expect(answers.every((a) => a.empty)).toBe(true);
    expect(answers.find((a) => a.partId === 'P3A.i')!.prompt).toContain('Effect: [____]');
  });

  it('gives each part its problem: the stem and earlier prompts, never their answers', () => {
    const answers = partAnswers(fill(tutorialDoc(FIXTURE_SHEET, { pageBase: 0, newId: ids })));
    const p1b = answers.find((a) => a.partId === 'P1b')!;
    expect(p1b.context).toContain('Problem 1 – Two towers');
    expect(p1b.context).toContain('Put **Y** on **X**');
    expect(p1b.context).toContain('Problem 1 a.: Write the domain');
    expect(p1b.context).not.toContain('Before you start');
    const p3b = answers.find((a) => a.partId === 'P3B')!;
    expect(p3b.context).toContain('Action(Q1');
    expect(p3b.context).not.toContain('Two towers');
    expect(p3b.context).not.toContain('F ∧ ∼±G');
  });

  it('reads blanks, ticks and a numbered plan', () => {
    const json = tutorialDocJson(FIXTURE_SHEET, { pageBase: 0, newId: ids }) as { content: Record<string, unknown>[] };
    const doc = notesSchema.nodeFromJSON(json);
    const filled = fill(doc);
    const answers = partAnswers(filled);
    const blank = answers.find((a) => a.partId === 'P3A.i')!;
    expect(blank.blanks).toEqual({ eff: 'F ∧ ∼±G' });
    expect(blank.empty).toBe(false);
    expect(answers.find((a) => a.partId === 'P3B')!.picked).toEqual(['i']);
    expect(answers.find((a) => a.partId === 'P1b')!.text).toBe('1. Move(X, Y, Table)\n2. Move(Y, Table, X)');
  });
});

describe('carryAnswers', () => {
  it('keeps the answers by part id across a re-read and returns the parts that vanished', () => {
    const filled = fill(tutorialDoc(FIXTURE_SHEET, { pageBase: 0, newId: ids }));
    const reread = tutorialDoc({ ...FIXTURE_SHEET, blocks: FIXTURE_SHEET.blocks.filter((b) => !(b.type === 'part' && b.id === 'P2')) }, { pageBase: 0, newId: ids });
    const { doc, orphans } = carryAnswers(filled, reread);
    doc.check();
    const answers = partAnswers(doc);
    expect(answers.find((a) => a.partId === 'P3A.i')!.blanks.eff).toBe('F ∧ ∼±G');
    expect(answers.find((a) => a.partId === 'P3B')!.picked).toEqual(['i']);
    expect(answers.find((a) => a.partId === 'P1b')!.text).toContain('Move(Y, Table, X)');
    expect(orphans.map((o) => o.attrs.partId)).toEqual(['P2']);
  });

  it('serialises a blank inside the sheet text as its value', () => {
    const filled = fill(tutorialDoc(FIXTURE_SHEET, { pageBase: 0, newId: ids }));
    let line = '';
    filled.descendants((node) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('Action(K1')) line = nodesToInline(node.content);
      return true;
    });
    expect(line).toContain('[F ∧ ∼±G]');
  });
});

/** The fixture with a plan typed, a blank filled and option i ticked. */
function fill(doc: ReturnType<typeof tutorialDoc>): ReturnType<typeof tutorialDoc> {
  const s = notesSchema.nodes;
  const user = notesSchema.marks.author!.create({ by: 'user', editId: null, at: 2 });
  const map = (node: ReturnType<typeof tutorialDoc>): ReturnType<typeof tutorialDoc> => {
    if (node.type.name === 'tut_blank') return node.type.create({ ...node.attrs, value: 'F ∧ ∼±G' });
    if (node.type.name === 'tut_choices') return node.type.create({ ...node.attrs, picked: ['i'] });
    if (node.type.name === 'tut_answer' && node.attrs.answerKind === 'sequence') {
      const item = (text: string) => s.list_item!.create(null, s.paragraph!.create(null, notesSchema.text(text, [user])));
      return node.type.create(node.attrs, s.ordered_list!.create(null, [item('Move(X, Y, Table)'), item('Move(Y, Table, X)')]));
    }
    if (node.isLeaf) return node;
    const children: ReturnType<typeof tutorialDoc>[] = [];
    node.forEach((c) => children.push(map(c)));
    return node.copy(Fragment.from(children));
  };
  return map(doc);
}
