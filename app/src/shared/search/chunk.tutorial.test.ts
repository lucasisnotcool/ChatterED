/**
 * The tutorial sheet's doc in search (2026-10-07, search.md §10): a part is one group (question,
 * the learner's answer, Ellie's solution), never across parts; the stem groups as notes do; the
 * sheet's housekeeping and Max's marking lines are left out; the rows reach the index with keys
 * that name the sheet.
 */
import { describe, expect, it } from 'vitest';
import { notebookRows } from './build.js';
import { TUTORIAL_PART_MAX_WORDS, tutorialChunks } from './chunk.js';
import { tutorialFileOfKey } from './types.js';
import { FIXTURE_SHEET } from '../doc/tutorial.fixture.test-support.js';
import { tutorialDocJson } from '../doc/tutorialdoc.js';

type Marks = { type: string; attrs: { by: string; editId: string | null; at: number } }[];
const ingest: Marks = [{ type: 'author', attrs: { by: 'ingest', editId: null, at: 0 } }];
const user = [{ type: 'author', attrs: { by: 'user', editId: null, at: 0 } }];
const ellie = [{ type: 'author', attrs: { by: 'ellie', editId: 'e1', at: 0 } }];
const max = [{ type: 'author', attrs: { by: 'max', editId: 'm1', at: 0 } }];
const attrs = (blockId: string, reason: string | null, pages: number[] = []) => ({ blockId, pages, reason, objectiveIds: [] });
const para = (blockId: string, text: string, reason: string | null, pages: number[] = [], marks: Marks = ingest) => ({
  type: 'paragraph',
  attrs: attrs(blockId, reason, pages),
  content: [{ type: 'text', text, marks }],
});
const heading = (blockId: string, level: number, text: string, reason: string, pages: number[] = []) => ({
  type: 'heading',
  attrs: { ...attrs(blockId, reason, pages), level },
  content: [{ type: 'text', text, marks: ingest }],
});
const list = (blockId: string, items: string[], reason: string, pages: number[], marks: Marks) => ({
  type: 'bullet_list',
  attrs: attrs(blockId, reason, pages),
  content: items.map((t) => ({ type: 'list_item', content: [{ type: 'paragraph', attrs: attrs('', null), content: [{ type: 'text', text: t, marks }] }] })),
});
const part = (blockId: string, partId: string, label: string, pages: number[], content: unknown[]) => ({
  type: 'tut_part',
  attrs: { ...attrs(blockId, 'sheet_part', pages), partId, label, answerKind: 'text', origin: 'sheet' },
  content,
});
const slot = (blockId: string, text: string) => ({
  type: 'tut_answer',
  attrs: { ...attrs(blockId, 'answer_slot', [47]), answerKind: 'text' },
  content: [para('', text, null, [], user)],
});

const DOC = {
  type: 'doc',
  content: [
    heading('t_title', 1, 'Tutorial 2 Week 4: Rational Decision Making', 'title'),
    para('t_admin', 'You may discuss the questions with your classmates, but write your own answers.', 'sheet_admin', [47]),
    heading('t_p1', 2, 'Problem 1: Utility Matchmaker', 'sheet', [47]),
    para('t_stem', 'Consider the following lotteries, where [p, x] denotes outcome x with probability p.', 'sheet', [47]),
    part('t_p1a', 'P1A', 'Problem 1 Part A', [47], [
      para('t_q1a', 'Match each student with a utility function consistent with their preferences.', 'sheet', [47]),
      slot('t_a1a', 'Adam (b), Bing (c), Candy (a), Diana (d)'),
      para('t_hint', 'Checked: correct. All four matches are correct.', 'tutor_hint', [], max),
      para('t_sol1a', 'Solution: compare each lottery by expected utility; linear is risk neutral.', 'exam_prep_solution', [47, 12], ellie),
    ]),
    part('t_p1b', 'P1B', 'Problem 1 Part B', [47], [
      para('t_q1b', 'If U1 = 2 U2 + 3, do Agents 1 and 2 have the same preferences?', 'sheet', [47]),
      slot('t_a1b', 'Yes, a positive affine map keeps the order.'),
    ]),
    // Ellie's solution right after the part, at the top level: still the part's.
    para('t_sol1b', 'Solution: yes; expected utility is linear, so EU1 = 2 EU2 + 3 orders lotteries alike.', 'exam_prep_solution', [47, 14], ellie),
    list('t_sol1b2', ['Expand EU1 by linearity', 'Positive scale and shift keep the order'], 'exam_prep_solution', [14], ellie),
    heading('t_p2', 2, 'Problem 2: PacBaby', 'sheet', [48]),
    para('t_stem2', 'PacBaby owns a $100 note; with probability 0.2 a monster steals it.', 'sheet', [48]),
  ],
};

const run = (explainMode: 'off' | 'append' | 'separate' = 'off', explains?: Map<string, string>) =>
  tutorialChunks(DOC, { notebookId: 'nb_a', fileId: 'f_tut', title: 'Tutorial 2 Week 4: Rational Decision Making', explainMode, ...(explains ? { explains } : {}) });

describe('tutorial sheet chunks', () => {
  it('one group per part: the question, the answer and the solution, inside or right after it', () => {
    const { chunks } = run();
    const a = chunks.find((c) => c.blockIds.includes('t_q1a'))!;
    expect(a.key).toBe('tut:nb_a:f_tut:t_q1a');
    expect(a.kind).toBe('note');
    expect(a.section).toEqual(['Problem 1 Part A']);
    expect(a.embedText.split('\n')[0]).toBe('Tutorial 2 Week 4: Rational Decision Making › Problem 1 Part A');
    expect(a.text).toContain('Match each student');
    expect(a.text).toContain('Adam (b), Bing (c)');
    expect(a.text).toContain('Solution: compare each lottery');
    expect(a.pages).toEqual([12, 47]);

    const b = chunks.find((c) => c.blockIds.includes('t_q1b'))!;
    expect(b.blockIds).toEqual(['t_q1b', 't_a1b', 't_sol1b', 't_sol1b2']);
    expect(b.text).toContain('EU1 = 2 EU2 + 3');
    expect(b.text).toContain('• Expand EU1 by linearity');
    // Never across parts.
    expect(b.text).not.toContain('Match each student');
    expect(a.text).not.toContain('affine');
  });

  it('leaves out the title, the housekeeping and Max\'s marking lines', () => {
    const all = run().chunks.map((c) => c.text).join('\n');
    expect(all).not.toContain('discuss the questions');
    expect(all).not.toContain('Checked: correct');
  });

  it('groups the stem under its heading, apart from the parts', () => {
    const { chunks } = run();
    const stem = chunks.find((c) => c.blockIds.includes('t_stem'))!;
    expect(stem.section).toEqual(['Problem 1: Utility Matchmaker']);
    expect(stem.blockIds).toEqual(['t_stem']);
    const stem2 = chunks.find((c) => c.blockIds.includes('t_stem2'))!;
    expect(stem2.section).toEqual(['Problem 2: PacBaby']);
    expect(stem2.pages).toEqual([48]);
  });

  it('a unit per member; an answer paragraph with no id of its own highlights its slot', () => {
    const { units } = run();
    expect(units.map((u) => u.blockId)).toEqual(expect.arrayContaining(['t_q1a', 't_a1a', 't_sol1a', 't_q1b', 't_a1b', 't_sol1b', 't_sol1b2']));
    expect(units.find((u) => u.blockId === 't_hint')).toBeUndefined();
  });

  it('a long part splits at a block, never into the next', () => {
    const long = Array.from({ length: 6 }, (_, i) => para(`t_s${String(i)}`, `Step ${String(i)} ${'word '.repeat(80)}`.trim(), 'exam_prep_solution', [47], ellie));
    const doc = { type: 'doc', content: [part('t_px', 'PX', 'Problem X', [47], [para('t_qx', 'Prove it.', 'sheet', [47]), ...long]), part('t_py', 'PY', 'Problem Y', [47], [para('t_qy', 'And this one.', 'sheet', [47])])] };
    const { chunks } = tutorialChunks(doc, { notebookId: 'nb_a', fileId: 'f_tut', title: 'T' });
    const x = chunks.filter((c) => c.section[0] === 'Problem X');
    expect(x.length).toBeGreaterThan(1);
    for (const c of x) expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(TUTORIAL_PART_MAX_WORDS + 2);
    expect(x[0]!.blockIds[0]).toBe('t_qx');
    expect(chunks.find((c) => c.section[0] === 'Problem Y')!.blockIds).toEqual(['t_qy']);
  });

  it('reads the explains by mode: appended to the part, or chunks of their own', () => {
    const explains = new Map([
      ['t_sol1a', 'Risk attitude is the curvature of U: concave means risk averse.'],
      ['t_p1b', 'Affine transformations preserve the preference order.'],
    ]);
    const appended = run('append', explains).chunks;
    const a = appended.find((c) => c.blockIds.includes('t_q1a'))!;
    expect(a.embedText).toContain('concave means risk averse');
    expect(a.text).not.toContain('concave');
    // The part's own explain rides with its first member.
    expect(appended.find((c) => c.blockIds.includes('t_q1b'))!.embedText).toContain('preserve the preference order');

    const separate = run('separate', explains).chunks.filter((c) => c.kind === 'explain');
    expect(separate.map((c) => c.blockIds)).toEqual([['t_sol1a'], ['t_p1b', 't_q1b']]);
    expect(run('off', explains).chunks.some((c) => c.embedText.includes('concave'))).toBe(false);
  });

  it('a blank shows what was typed in it, and a tick box its options', () => {
    const doc = tutorialDocJson(FIXTURE_SHEET, { pageBase: 40, at: 1, newId: (() => { let n = 0; return () => `b_${String(++n)}`; })() });
    const { chunks } = tutorialChunks(doc, { notebookId: 'nb_a', fileId: 'f_fix', title: FIXTURE_SHEET.title });
    const text = chunks.map((c) => c.text).join('\n');
    expect(text).toContain('[____]');
    expect(text).toMatch(/\[ \] /);
    expect(chunks.every((c) => c.pages.every((p) => p > 40))).toBe(true);
  });

  it('reaches the index rows with keys that name the sheet, units deduped across docs', () => {
    const rows = notebookRows({
      notebookId: 'nb_a',
      doc: { docJson: { type: 'doc', content: [para('t_q1a', 'A notes block that happens to share an id.', null, [3])] }, title: 'Notes' },
      sources: [],
      tutorials: [{ fileId: 'f_tut', docJson: DOC, title: 'Tutorial 2 Week 4: Rational Decision Making' }],
    });
    const tut = rows.filter((r) => tutorialFileOfKey(r.key) === 'f_tut');
    expect(tut.length).toBeGreaterThan(0);
    expect(tut.every((r) => r.kind === 'note' && r.title === 'Tutorial 2 Week 4: Rational Decision Making')).toBe(true);
    const units = rows.filter((r) => r.kind === 'unit').map((r) => r.key);
    expect(new Set(units).size).toBe(units.length);
    expect(notebookRows({ notebookId: 'nb_a', doc: null, sources: [] }).length).toBe(0);
  });
});

describe('tutorialFileOfKey', () => {
  it('reads the sheet from a tutorial key only', () => {
    expect(tutorialFileOfKey('tut:nb_a:f_1:b_2')).toBe('f_1');
    expect(tutorialFileOfKey('tut:nb_a:f_1:b_2~2')).toBe('f_1');
    expect(tutorialFileOfKey('note:nb_a:b_2')).toBeNull();
    expect(tutorialFileOfKey('page:nb_a:3')).toBeNull();
  });
});
