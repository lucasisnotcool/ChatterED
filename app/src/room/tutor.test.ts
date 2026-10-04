/**
 * **The tutorial turn's code-side decisions** (`tutor.ts`, S5): who speaks, the request row, the
 * line under the part, and where in the part it goes, read off a real tutorial document's outline.
 */
import { describe, expect, it } from 'vitest';
import { docOutline } from '../shared/doc/schema.js';
import { BLOCK_LINE_MAX_WORDS, type OutlineEntry } from '../shared/doc/types.js';
import { tutorialDoc } from '../shared/doc/tutorialdoc.js';
import { FIXTURE_SHEET } from '../shared/doc/tutorial.fixture.test-support.js';
import { wordCount } from './timer.js';
import {
  TUTOR_HINT_REASON,
  capWords,
  isTutorLineText,
  partLastChild,
  tutorDecision,
  tutorDocLine,
  tutorLineBatch,
  tutorialRequestLine,
} from './tutor.js';

describe('tutorDecision', () => {
  it('is Max for hint, feedback and reveal, Ellie for a refresher, all rule-made', () => {
    expect(tutorDecision('hint')).toMatchObject({ role: 'challenger', moveType: 'tutor_hint', decidedBy: 'rule:tutor_hint', challenges: [] });
    expect(tutorDecision('feedback')).toMatchObject({ role: 'challenger', decidedBy: 'rule:tutor_feedback' });
    expect(tutorDecision('reveal')).toMatchObject({ role: 'challenger', decidedBy: 'rule:tutor_reveal' });
    expect(tutorDecision('refresher')).toMatchObject({ role: 'peer', decidedBy: 'rule:tutor_refresher' });
  });

  it('moves Max’s three to Ellie when TUTOR_HELPER is ellie', () => {
    for (const kind of ['hint', 'feedback', 'reveal', 'refresher'] as const) expect(tutorDecision(kind, 'ellie').role).toBe('peer');
  });
});

describe('tutorialRequestLine', () => {
  it('says what was asked, by the part’s label', () => {
    expect(tutorialRequestLine('hint', 'Problem 3 A) i.', 2)).toBe('Hint, please: Problem 3 A) i. (break it down)');
    expect(tutorialRequestLine('refresher', 'Problem 3 A) i.')).toBe('A refresher for Problem 3 A) i.');
    expect(tutorialRequestLine('feedback', 'Problem 3 A) i.')).toBe('Check my answer to Problem 3 A) i.');
    expect(tutorialRequestLine('reveal', 'Problem 3 A) i.')).toBe('Show me the answer to Problem 3 A) i.');
  });
});

describe('tutorDocLine', () => {
  const base = { level: 1 as const, reply: '', notesHeading: 'STRIPS actions', pages: [14, 12], prerequisite: 'Preconditions must hold before an action.' };

  it('hint 1 says where to look', () => {
    expect(tutorDocLine({ ...base, kind: 'hint' })).toBe('Hint 1: look at “STRIPS actions” in the notes and p. 12, p. 14.');
  });

  it('hint 2 takes the reply’s first sub-goal question', () => {
    const reply = 'Break it down:\n1. **What must be true before Move can run?** (p. 14)\n2. Which block is clear?';
    expect(tutorDocLine({ ...base, kind: 'hint', level: 2, reply })).toBe('Hint 2: start from — What must be true before Move can run?');
    expect(tutorDocLine({ ...base, kind: 'hint', level: 2, reply: 'No questions here.' })).toMatch(/^Hint 2: /);
  });

  it('hint 3, refresher, feedback and reveal', () => {
    expect(tutorDocLine({ ...base, kind: 'hint', level: 3 })).toMatch(/^Hint 3: one step worked on the lecture’s example \(p\. 12, p\. 14\)/);
    expect(tutorDocLine({ ...base, kind: 'refresher' })).toBe('Refresher: Preconditions must hold before an action, see “STRIPS actions” in the notes and p. 12, p. 14.');
    expect(
      tutorDocLine({ ...base, kind: 'feedback', verdict: { verdict: 'partial', checkedBy: 'simulation', detail: 'Plan valid up to step 2. Step 3 fails.' } }),
    ).toBe('Checked (run by the app): partly there. Plan valid up to step 2.');
    expect(tutorDocLine({ ...base, kind: 'feedback', verdict: { verdict: 'complete', checkedBy: 'model', detail: '' } })).toBe('Checked: correct.');
    expect(tutorDocLine({ ...base, kind: 'reveal' })).toBe('Answer shown in the chat.');
  });

  it('is never more than 25 words, and every line is recognisable as a tutor line', () => {
    const long = 'word '.repeat(80);
    for (const line of [
      tutorDocLine({ ...base, kind: 'feedback', verdict: { verdict: 'not_yet', checkedBy: 'model', detail: long } }),
      tutorDocLine({ ...base, kind: 'refresher', prerequisite: long }),
      tutorDocLine({ ...base, kind: 'hint', level: 2, reply: `${long}?` }),
    ]) {
      expect(wordCount(line)).toBeLessThanOrEqual(BLOCK_LINE_MAX_WORDS);
      expect(isTutorLineText(line)).toBe(true);
    }
    expect(capWords('a b c', 2)).toBe('a b…');
  });
});

describe('partLastChild, on a real tutorial document', () => {
  let n = 0;
  const doc = tutorialDoc(FIXTURE_SHEET, { pageBase: 20, newId: () => `b_${(n += 1)}`, at: 0 });
  const outline = docOutline(doc);
  // The outline does not carry a part's id; the fixture's parts are found by their order.
  const parts = outline.filter((e) => e.kind === 'tut_part');
  const partId = (id: string) => parts[['P1a', 'P1b', 'P2', 'P3A.i', 'P3B'].indexOf(id)]!.blockId;

  it('is the answer slot for a part that has one', () => {
    const p1b = partId('P1b');
    const at = outline.findIndex((e) => e.blockId === p1b);
    const last = partLastChild(outline, p1b);
    expect(outline.find((e) => e.blockId === last)!.kind).toBe('tut_answer');
    expect(outline.findIndex((e) => e.blockId === last)).toBe(at + 2);
    // The choice part's slot is its tick boxes.
    expect(outline.find((e) => e.blockId === partLastChild(outline, partId('P3B')))!.kind).toBe('tut_choices');
  });

  it('is the last prompt block of a blanks part, which has no slot', () => {
    const last = partLastChild(outline, partId('P3A.i'));
    expect(outline.find((e) => e.blockId === last)!.text).toContain('Implementations');
  });

  it('is the last tutor line under the part when help was already given, and stops after it', () => {
    const p1b = partId('P1b');
    const at = outline.findIndex((e) => e.blockId === p1b);
    const line = (blockId: string, text: string): OutlineEntry => ({ blockId, kind: 'paragraph', path: [], text, pages: [], learnerText: false, questionId: null });
    const withLines = [
      ...outline.slice(0, at + 3),
      line('b_hint1', 'Hint 1: look at p. 14.'),
      line('b_hint2', 'Hint 2: start from — what must hold?'),
      line('b_sheet', 'A sheet paragraph after the part.'),
      ...outline.slice(at + 3),
    ];
    expect(partLastChild(withLines, p1b)).toBe('b_hint2');
    expect(partLastChild(withLines, 'b_missing')).toBeNull();
  });
});

describe('tutorLineBatch', () => {
  it('is one agent insert after the anchor with reason tutor_hint, focused on the part', () => {
    const batch = tutorLineBatch({
      editId: 'edit_1',
      author: 'max',
      anchorBlockId: 'b_slot',
      partBlockId: 'b_part',
      line: 'Hint 1: look at p. 14.',
      pages: [14],
      label: 'Problem 1 b.',
      kind: 'hint',
    });
    expect(batch).toMatchObject({ editId: 'edit_1', author: 'max', cause: 'block_action', focusBlockId: 'b_part', why: 'Hint on Problem 1 b.' });
    expect(batch.ops).toEqual([
      { op: 'insert_after', anchorBlockId: 'b_slot', blocks: [{ kind: 'paragraph', text: 'Hint 1: look at p. 14.', prov: { pages: [14], reason: TUTOR_HINT_REASON } }] },
    ]);
  });
});
