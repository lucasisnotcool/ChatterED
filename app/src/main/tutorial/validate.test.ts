/**
 * The model's reading of a sheet, checked in code (`validate.ts`), and the scripted fixture kept
 * in step with the shared one.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS as SHARED_KEYS, FIXTURE_SHEET as SHARED_SHEET } from '../../shared/doc/tutorial.fixture.test-support.js';
import type { PartKey, SheetPart } from '../../shared/tutorial.js';
import { FIXTURE_KEYS, FIXTURE_SHEET } from './fixture.js';
import { applySolved, checkFrom, iou, validateTutorial, type TutorialValidationContext } from './validate.js';

const CTX: TutorialValidationContext = {
  pageCount: 2,
  fallbackTitle: 'Tutorial 9',
  notesBlockIds: ['b_one', 'b_two', 'b_three'],
  isLecturePage: (p) => p >= 1 && p <= 10,
  objectiveIds: new Set(['obj_a', 'obj_b']),
};

const part = (over: Record<string, unknown> = {}) => ({
  type: 'part',
  id: 'P1',
  label: 'Problem 1',
  page: 1,
  prompt: [{ type: 'paragraph', text: 'Explain.', page: 1 }],
  answer: { kind: 'text' },
  ...over,
});

const key = (over: Record<string, unknown> = {}) => ({
  partId: 'P1',
  answer: 'Because.',
  blanks: [],
  correct: [],
  steps: ['a'],
  mistakes: [],
  prerequisites: [],
  formalCheck: null,
  notesBlockIds: [],
  pages: [],
  objectiveIds: [],
  ...over,
});

const parts = (raw: unknown) => {
  const out = validateTutorial(raw, CTX)!;
  return { out, sheetParts: out.sheet.blocks.filter((b): b is SheetPart => b.type === 'part') };
};

describe('validateTutorial', () => {
  it('refuses an answer with no part, and falls back to the source name for a title', () => {
    expect(validateTutorial({ title: 'x', blocks: [{ type: 'paragraph', text: 'hi', page: 1 }], parts: [] }, CTX)).toBeNull();
    expect(validateTutorial('nonsense', CTX)).toBeNull();
    expect(validateTutorial({ title: '', blocks: [part()], parts: [] }, CTX)!.sheet.title).toBe('Tutorial 9');
  });

  it('keeps blocks on the tutorial\'s pages, drops empty ones, and levels headings', () => {
    const { out } = parts({
      title: 'T',
      blocks: [
        { type: 'heading', level: 1, text: 'Problem 1', page: 2 },
        { type: 'paragraph', text: '  ', page: 1 },
        { type: 'paragraph', text: 'Off the end', page: 9 },
        { type: 'heading', level: 4, text: 'Sub', page: 1 },
        part(),
      ],
      parts: [key()],
    });
    expect(out.sheet.blocks.slice(0, 3)).toEqual([
      { type: 'heading', level: 2, text: 'Problem 1', page: 2 },
      // The page before it (the dropped empty paragraph's).
      { type: 'paragraph', text: 'Off the end', page: 1 },
      { type: 'heading', level: 3, text: 'Sub', page: 1 },
    ]);
    expect(out.repairs.pagesFixed).toBe(1);
    expect(out.repairs.blocksDropped).toBe(1);
  });

  it('drops a leading heading that repeats the title, after any housekeeping', () => {
    const { out } = parts({
      title: 'Tutorial 1: Planning',
      blocks: [
        { type: 'paragraph', text: 'School of Computing', page: 1, admin: true },
        { type: 'heading', level: 2, text: 'Tutorial 1 — planning', page: 1 },
        { type: 'heading', level: 2, text: 'Tutorial 1: Planning', page: 1 },
        part(),
      ],
      parts: [key()],
    });
    expect(out.sheet.blocks.map((b) => (b.type === 'heading' ? b.text : b.type))).toEqual(['paragraph', 'Tutorial 1: Planning', 'part']);
  });

  it('makes part ids unique and maps each key to the part it was written for', () => {
    const { sheetParts, out } = parts({
      title: 'T',
      blocks: [part({ id: 'P1' }), part({ id: 'P1', label: 'again' }), part({ id: 'bad id!' })],
      parts: [key({ partId: 'P1', answer: 'first' })],
    });
    expect(sheetParts.map((p) => p.id)).toEqual(['P1', 'P1-2', 'P3']);
    expect(out.parts.map((p) => [p.partId, p.key.answer, p.key.confidence])).toEqual([
      ['P1', 'first', 'high'],
      ['P1-2', '', 'low'],
      ['P3', '', 'low'],
    ]);
    expect(out.repairs.partIdsRenamed).toBe(2);
    expect(out.repairs.keysMissing).toBe(2);
  });

  it('takes a blanks part\'s ids from its prompt tokens, and strips tokens anywhere else', () => {
    const { out, sheetParts } = parts({
      title: 'T',
      blocks: [
        { type: 'paragraph', text: 'Fill {{blank:x}} here', page: 1 },
        part({
          id: 'B',
          prompt: [{ type: 'paragraph', text: 'Pre: {{blank:pre}} Eff: {{blank:eff}} Again: {{blank:pre}}', page: 1 }],
          answer: { kind: 'blanks' },
        }),
        part({ id: 'T', prompt: [{ type: 'paragraph', text: 'No {{blank:z}} here', page: 1 }], answer: { kind: 'text' } }),
        part({ id: 'N', prompt: [{ type: 'paragraph', text: 'No tokens', page: 1 }], answer: { kind: 'blanks' } }),
      ],
      parts: [key({ partId: 'B', blanks: [{ id: 'pre', accepted: ['F'] }, { id: 'ghost', accepted: ['G'] }] })],
    });
    expect(out.sheet.blocks[0]).toMatchObject({ text: 'Fill ____ here' });
    expect(sheetParts[0]!.answer).toEqual({ kind: 'blanks', blanks: ['pre', 'eff'] });
    expect(sheetParts[0]!.prompt[0]).toMatchObject({ text: 'Pre: {{blank:pre}} Eff: {{blank:eff}} Again: ____' });
    expect(sheetParts[1]!.prompt[0]).toMatchObject({ text: 'No ____ here' });
    expect(sheetParts[2]!.answer).toEqual({ kind: 'text' });
    expect(out.parts[0]!.key.blanks).toEqual({ pre: ['F'] });
  });

  it('demotes a choice with fewer than two options, and keeps correct ids among its options', () => {
    const { sheetParts, out } = parts({
      title: 'T',
      blocks: [
        part({ id: 'C', answer: { kind: 'choice', multi: true, options: [{ id: 'i', text: 'one' }, { id: 'ii', text: 'two' }, { id: 'i', text: 'dup' }] } }),
        part({ id: 'D', answer: { kind: 'choice', options: [{ id: 'i', text: 'only' }] } }),
      ],
      parts: [key({ partId: 'C', correct: ['ii', 'iv'] })],
    });
    expect(sheetParts[0]!.answer).toEqual({ kind: 'choice', multi: true, options: [{ id: 'i', text: 'one' }, { id: 'ii', text: 'two' }] });
    expect(sheetParts[1]!.answer).toEqual({ kind: 'text' });
    expect(out.parts[0]!.key.correct).toEqual(['ii']);
  });

  it('keeps only real notes blocks (in document order), lecture pages and the tree\'s objectives', () => {
    const { out } = parts({
      title: 'T',
      blocks: [part()],
      parts: [key({ notesBlockIds: ['b_three', 'b_ghost', 'b_one', 'b_one'], pages: [4, 40, 2, 4], objectiveIds: ['obj_b', 'obj_x'] })],
    });
    expect(out.parts[0]!.links).toEqual({ notesBlockIds: ['b_one', 'b_three'], pages: [2, 4] });
    expect(out.parts[0]!.objectiveIds).toEqual(['obj_b']);
    // A ghost and a repeat block, a non-lecture and a repeat page, an unknown objective.
    expect(out.repairs.linksDropped).toBe(5);
  });

  it('snaps a figure to the geometry box it overlaps, or takes the only box on its page', () => {
    const box = { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 };
    const out = validateTutorial(
      {
        title: 'T',
        blocks: [
          { type: 'figure', page: 1, rect: { x0: 0.12, y0: 0.1, x1: 0.5, y1: 0.52 }, caption: 'a' },
          { type: 'figure', page: 2, rect: null, caption: 'b' },
          { type: 'figure', page: 1, rect: { x0: 0.9, y0: 0.9, x1: 2, y1: 1 }, caption: 'bad' },
          part(),
        ],
        parts: [key()],
      },
      { ...CTX, figureCandidates: new Map([[1, [box]], [2, [box]]]) },
    )!;
    expect(out.sheet.blocks.slice(0, 3).map((b) => (b.type === 'figure' ? b.rect : null))).toEqual([box, box, box]);
    expect(iou(box, box)).toBe(1);
  });

  it('drops a formal check code refuses, and lets code\'s solution replace the model\'s answer', () => {
    const plan = SHARED_KEYS.find((k) => k.partId === 'P1b')!.check!;
    const { out } = parts({
      title: 'T',
      blocks: [part({ id: 'A', answer: { kind: 'sequence' } }), part({ id: 'B' })],
      parts: [
        key({ partId: 'A', answer: 'Move(Y, Table, X)', formalCheck: JSON.stringify(plan) }),
        key({ partId: 'B', formalCheck: '{"type":"plan","domain":"nope"}' }),
      ],
    });
    expect(out.parts[0]!.key.check?.type).toBe('plan');
    expect(out.parts[0]!.key.answer).not.toBe('Move(Y, Table, X)');
    expect(out.parts[0]!.key.answer).toMatch(/Move/);
    expect(out.parts[1]!.key.check).toBeUndefined();
    expect(out.repairs.checksDropped).toBe(1);
    expect(out.repairs.checksSolved).toBe(1);
    expect(checkFrom('not json')).toBeNull();
  });

  it('solves a sequences check into the correct options', () => {
    const check = SHARED_KEYS.find((k) => k.partId === 'P3B')!.check!;
    const p = SHARED_SHEET.blocks.find((b): b is SheetPart => b.type === 'part' && b.id === 'P3B')!;
    const k: PartKey = { partId: 'P3B', answer: 'ii', steps: [], mistakes: [], prerequisites: [], confidence: 'low', from: 'model' };
    expect(applySolved(k, p, check)).toBe(true);
    expect(k.correct).toEqual(['i']);
    expect(k.confidence).toBe('high');
  });
});

describe('the scripted fixture', () => {
  it('is the shared fixture, copied', () => {
    expect(FIXTURE_SHEET).toEqual(SHARED_SHEET);
    expect(FIXTURE_KEYS).toEqual(SHARED_KEYS);
  });
});
