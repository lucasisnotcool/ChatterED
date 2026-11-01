import { EditorState } from 'prosemirror-state';
import type { Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { docOf, heading, para } from '../../../shared/doc/fixture.test-support.js';
import { notesSchema } from '../../../shared/doc/schema.js';
import { FIXTURE_SHEET } from '../../../shared/doc/tutorial.fixture.test-support.js';
import { tutorialDoc } from '../../../shared/doc/tutorialdoc.js';
import type { TutorialPartView, TutorialView } from '../../../shared/tutorial.js';
import {
  bumpTutorialChrome,
  practiceChipsPlugin,
  practiceKey,
  tutorialChromeKey,
  tutorialPlugins,
  type TutorialChromeContext,
} from './tutorial.js';
import {
  adminRanges,
  blankAfter,
  blankFromCaret,
  blankSpots,
  fromNotesTitle,
  nextHintLabel,
  notesChips,
  pageGroups,
  pageLinkLabel,
  partChromeState,
  practiceBySection,
  sheetSourceLabels,
  shortSourceLabels,
  shortTutorialTitle,
  shownStatus,
  splitCitation,
  slotPlaceholder,
  statusLook,
} from './tutorialmodel.js';
import { optionMark, toggledPicks } from './tutorialviews.js';

let n = 0;
const sheetDoc = () => tutorialDoc(FIXTURE_SHEET, { pageBase: 40, at: 1, newId: () => `b${String(++n)}` });

const partView = (partId: string, over: Partial<TutorialPartView> = {}): TutorialPartView => ({
  partId,
  origin: 'sheet',
  blockId: `blk_${partId}`,
  label: partId,
  answerKind: 'text',
  status: 'untried',
  hintLevel: 0,
  attempts: 0,
  checkedBy: null,
  verifiedSolution: false,
  links: { notesBlockIds: [], pages: [] },
  objectiveIds: [],
  ...over,
});

const tutorial = (fileId: string, title: string, parts: TutorialPartView[]): TutorialView => ({
  notebookId: 'nb_1',
  fileId,
  docId: `doc_${fileId}`,
  contentKey: `nb:nb_1:tut:${fileId}`,
  title,
  status: 'ready',
  error: null,
  parts,
  hasSolutions: false,
  gaps: [],
});

describe('the help ladder and the status pill', () => {
  it('names the next rung, and none past the third', () => {
    expect(nextHintLabel(0)).toBe('Point');
    expect(nextHintLabel(1)).toBe('Break it down');
    expect(nextHintLabel(2)).toBe('A worked step');
    expect(nextHintLabel(3)).toBeNull();
  });

  it('derives working from the document, since main records untried until a check', () => {
    expect(shownStatus(null, true)).toBe('untried');
    expect(shownStatus({ status: 'untried' }, false)).toBe('working');
    expect(shownStatus({ status: 'working' }, true)).toBe('untried');
    expect(shownStatus({ status: 'incorrect' }, false)).toBe('incorrect');
    expect(shownStatus({ status: 'revealed' }, true)).toBe('revealed');
  });

  it('says every status in words, and who decided it', () => {
    expect(statusLook('correct').label).toBe('✓ correct');
    expect(statusLook('partial').label).toBe('½ partial');
    expect(statusLook('incorrect').label).toBe('✗ not yet');
    expect(statusLook('revealed').label).toBe('revealed');
    expect(statusLook('untried').glyph).toBe('');
    expect(statusLook('correct', 'simulation').title).toMatch(/checked by code/i);
    expect(statusLook('correct', 'model').title).toMatch(/Judged by Max/);
  });

  it('builds a part’s chrome: dots, hint, check and reveal', () => {
    const fresh = partChromeState(null, true);
    expect(fresh.dots).toEqual([false, false, false]);
    expect(fresh.nextHint).toBe('Point');
    expect(fresh.canCheck).toBe(false);
    expect(fresh.canReveal).toBe(false);

    const hinted = partChromeState(partView('P1a', { hintLevel: 3 }), false);
    expect(hinted.canReveal).toBe(false);
    expect(hinted.hintTitle).toMatch(/Try your answer/);

    const climbed = partChromeState(partView('P1a', { hintLevel: 2, status: 'incorrect', attempts: 1, checkedBy: 'model' }), false);
    expect(climbed.dots).toEqual([true, true, false]);
    expect(climbed.nextHint).toBe('A worked step');
    expect(climbed.canCheck).toBe(true);
    expect(climbed.canReveal).toBe(true);
    expect(climbed.look.label).toBe('✗ not yet');

    const top = partChromeState(partView('P1a', { hintLevel: 3, status: 'revealed' }), false);
    expect(top.nextHint).toBeNull();
    expect(top.hintTitle).toMatch(/all three hints/);
    expect(top.canReveal).toBe(false);
  });
});

describe('the answer slot’s placeholder', () => {
  it('shapes the line to the answer and the prompt', () => {
    expect(slotPlaceholder('code', 'Write the domain in PDDL.')).toBe('Write your PDDL here');
    expect(slotPlaceholder('code', 'Write a Python function.')).toBe('Write your code here');
    expect(slotPlaceholder('sequence', 'Give a valid plan.')).toBe('Your plan, one action per line');
    expect(slotPlaceholder('tree', 'Draw the forward search tree.')).toMatch(/^Your search tree as a nested list/);
    expect(slotPlaceholder('text')).toBe('Your answer');
    expect(slotPlaceholder('blanks')).toBe('');
  });
});

describe('the blanks, in Tab order', () => {
  const doc = (() => {
    const s = notesSchema.nodes;
    const blank = (id: string) => s.tut_blank!.create({ blankId: id, value: '' });
    const p = (id: string, ...inline: ReturnType<typeof blank>[]) =>
      s.paragraph!.create({ blockId: id, pages: [], reason: 'sheet', objectiveIds: [] }, [notesSchema.text('Effect: '), ...inline]);
    const part = (partId: string, ...children: ReturnType<typeof p>[]) =>
      s.tut_part!.create({ blockId: `pt_${partId}`, pages: [], reason: 'sheet_part', objectiveIds: [], partId, label: partId, answerKind: 'blanks' }, children);
    return docOf(heading('h', 1, 'Sheet'), part('A', p('a1', blank('x'), blank('y'))), part('B', p('b1', blank('z'))));
  })();

  it('lists every blank in reading order with its part', () => {
    const spots = blankSpots(doc);
    expect(spots.map((s) => `${String(s.partId)}:${s.blankId}`)).toEqual(['A:x', 'A:y', 'B:z']);
    expect(spots[0]!.pos).toBeLessThan(spots[1]!.pos);
  });

  it('steps forward and back, stopping at the ends', () => {
    const spots = blankSpots(doc);
    expect(blankAfter(spots, spots[0]!.pos, 1)?.blankId).toBe('y');
    expect(blankAfter(spots, spots[1]!.pos, 1)?.blankId).toBe('z');
    expect(blankAfter(spots, spots[2]!.pos, 1)).toBeNull();
    expect(blankAfter(spots, spots[2]!.pos, -1)?.blankId).toBe('y');
    expect(blankAfter(spots, spots[0]!.pos, -1)).toBeNull();
  });

  it('Tab from the words goes to the part’s next blank, wrapping inside the part', () => {
    const spots = blankSpots(doc);
    expect(blankFromCaret(spots, 'A', 0, 1)?.blankId).toBe('x');
    expect(blankFromCaret(spots, 'A', spots[1]!.pos + 1, 1)?.blankId).toBe('x');
    expect(blankFromCaret(spots, 'A', spots[1]!.pos, -1)?.blankId).toBe('x');
    expect(blankFromCaret(spots, 'A', spots[0]!.pos, -1)?.blankId).toBe('y');
    expect(blankFromCaret(spots, 'C', 0, 1)).toBeNull();
  });
});

describe('the tick boxes', () => {
  const options = [
    { id: 'i', text: 'a' },
    { id: 'ii', text: 'b' },
    { id: 'iii', text: 'c' },
  ];
  it('keeps the sheet’s order, and one at most for a single choice', () => {
    expect(toggledPicks(options, ['iii'], 'i', true, true)).toEqual(['i', 'iii']);
    expect(toggledPicks(options, ['i', 'iii'], 'i', false, true)).toEqual(['iii']);
    expect(toggledPicks(options, ['i'], 'ii', true, false)).toEqual(['ii']);
    expect(toggledPicks(options, ['ii'], 'ii', false, false)).toEqual([]);
  });
  it('numbers options as the sheet does', () => {
    expect(optionMark('ii')).toBe('ii.');
    expect(optionMark('(a)')).toBe('(a)');
    expect(optionMark('b.')).toBe('b.');
  });
});

describe('From the notes', () => {
  it('names each section once, and folds unknown headings into one Notes chip', () => {
    const headings: Record<string, string | null> = { n1: 'PDDL', n2: 'PDDL', n3: 'Forward search', n4: null };
    expect(notesChips(['n1', 'n2', 'n4', 'n3'], (id) => headings[id] ?? null)).toEqual([
      { blockId: 'n1', label: 'PDDL' },
      { blockId: 'n3', label: 'Forward search' },
      { blockId: 'n4', label: 'Notes' },
    ]);
  });
  it('groups pages into runs', () => {
    expect(pageGroups([7, 3, 4, 5, 10, 9, 4])).toEqual([[3, 4, 5], [7], [9, 10]]);
  });

  it('splits a citation back into its sources and places', () => {
    expect(splitCitation('p. 3–5')).toEqual([{ source: null, where: 'p. 3–5' }]);
    expect(splitCitation('Lecture-complex v4.0 p. 3–5 · Notes §2 · removed source · Diagram')).toEqual([
      { source: 'Lecture-complex v4.0', where: 'p. 3–5' },
      { source: 'Notes', where: '§2' },
      { source: null, where: 'removed source' },
      { source: 'Diagram', where: '' },
    ]);
    expect(splitCitation('')).toEqual([]);
  });

  it('drops the source name when the sheet cites one source, and shortens it otherwise', () => {
    expect(sheetSourceLabels('Lecture-complex v4.0 p. 3–5, 7–8')).toBeNull();
    expect(sheetSourceLabels('p. 3–5')).toBeNull();
    expect(pageLinkLabel('Lecture-complex v4.0 p. 3–5', null)).toBe('p. 3–5');

    const short = sheetSourceLabels('Lecture-complex v4.0 p. 3–5 · Lecture-complex Notes p. 2')!;
    expect(short.get('Lecture-complex v4.0')).toBe('v4.0');
    expect(short.get('Lecture-complex Notes')).toBe('Notes');
    expect(pageLinkLabel('Lecture-complex v4.0 p. 3–5 · Lecture-complex Notes p. 2', short)).toBe('v4.0 p. 3–5 · Notes p. 2');
    // Nothing shared: a long name is cut to the limit, never to nothing.
    expect(shortSourceLabels(['Planning lecture slides', 'Week 3'], 12).get('Planning lecture slides')).toBe('Planning le…');
    expect(shortSourceLabels(['Week 3', 'Week 3 notes']).get('Week 3')).toBe('Week 3');
  });

  it('puts the whole list, in full, in the line’s tooltip', () => {
    expect(fromNotesTitle([{ label: 'Classical planning in PDDL' }], ['Lecture-complex v4.0 p. 3–5'])).toBe(
      'From the notes: Classical planning in PDDL · Lecture-complex v4.0 p. 3–5',
    );
    expect(fromNotesTitle([], [])).toBe('');
  });
});

describe('practiceBySection', () => {
  const notes = docOf(
    heading('h_title', 1, 'Planning'),
    para('b_lede', 'Lede.', 'ingest', null, [1]),
    heading('h_a', 2, 'PDDL', [3]),
    para('b_a1', 'Actions.', 'ingest', null, [3]),
    heading('h_b', 2, 'Heuristics', [8]),
    para('b_b1', 'Relaxation.', 'ingest', null, [8]),
    para('b_b2', 'Admissible.', 'ingest', null, [9]),
  );
  const offsetOf = (id: string): number => {
    let at = -1;
    notes.forEach((node, offset) => {
      if (node.attrs.blockId === id) at = offset;
    });
    return at;
  };

  it('collects the parts linked into each section, by tutorial, before the next H2', () => {
    const t1 = tutorial('f1', 'Tutorial 1 Week 3: Real World Planning', [
      partView('P1a', { label: 'Problem 1 a.', status: 'correct', links: { notesBlockIds: ['b_a1'], pages: [] } }),
      partView('P1b', { label: 'Problem 1 b.', links: { notesBlockIds: ['h_a', 'b_b2'], pages: [] } }),
      partView('P2', { label: 'Problem 2', links: { notesBlockIds: ['b_lede'], pages: [] } }),
    ]);
    const t2 = tutorial('f2', 'Tutorial 2', [partView('P3A.i', { links: { notesBlockIds: ['b_b1'], pages: [] } })]);
    const sections = practiceBySection(notes, [t1, t2]);
    expect(sections.map((s) => s.headingBlockId)).toEqual(['h_a', 'h_b']);
    expect(sections[0]!.pos).toBe(offsetOf('h_b'));
    expect(sections[1]!.pos).toBe(notes.content.size);
    expect(sections[0]!.groups).toEqual([
      {
        fileId: 'f1',
        title: 'Tutorial 1 Week 3',
        parts: [
          { fileId: 'f1', partId: 'P1a', label: 'Problem 1 a.', status: 'correct' },
          { fileId: 'f1', partId: 'P1b', label: 'Problem 1 b.', status: 'untried' },
        ],
      },
    ]);
    expect(sections[1]!.groups.map((g) => [g.title, g.parts.map((p) => p.partId)])).toEqual([
      ['Tutorial 1 Week 3', ['P1b']],
      ['Tutorial 2', ['P3A.i']],
    ]);
  });

  it('leaves out sections nobody practises, and parts before the first section', () => {
    const t = tutorial('f1', 'T', [partView('P2', { links: { notesBlockIds: ['b_lede'], pages: [] } })]);
    expect(practiceBySection(notes, [t])).toEqual([]);
    expect(practiceBySection(notes, [])).toEqual([]);
  });

  it('shortens a tutorial’s title to its name', () => {
    expect(shortTutorialTitle('Tutorial 1 Week 3: Real World Planning and Acting')).toBe('Tutorial 1 Week 3');
    expect(shortTutorialTitle('Problem Set 4 – Search')).toBe('Problem Set 4');
    expect(shortTutorialTitle('A very long tutorial title with no colon at all')).toMatch(/…$/);
  });
});

// ── the plugins, without a DOM: their decorations are built lazily ────────────────────────────

function chromeContext(parts: Record<string, TutorialPartView> = {}): TutorialChromeContext {
  return {
    part: (id) => parts[id] ?? null,
    onHelp: () => {},
    onCheck: () => {},
    onOpenNotesBlock: () => {},
    onOpenSlide: () => {},
    citation: (pages) => `p. ${pages.join('–')}`,
    notesHeading: () => 'PDDL',
  };
}

function decorations(state: EditorState): Decoration[] {
  return tutorialChromeKey.getState(state)!.deco.find();
}

const classOf = (d: Decoration): string => ((d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class ?? '');
const keyOf = (d: Decoration): string => String((d.spec as { key?: string }).key ?? '');

describe('tutorialPlugins', () => {
  const doc = sheetDoc();
  const make = (ctx = chromeContext()) => EditorState.create({ doc, plugins: tutorialPlugins(() => ctx) });

  it('finds the course admin and folds it, until toggled', () => {
    expect(adminRanges(doc)).toHaveLength(2);
    let state = make();
    expect(decorations(state).filter((d) => classOf(d).includes('nd-tut-folded'))).toHaveLength(2);
    expect(decorations(state).some((d) => keyOf(d).startsWith('tutadmin:c:2'))).toBe(true);
    state = state.apply(state.tr.setMeta(tutorialChromeKey, { toggleAdmin: true }));
    expect(decorations(state).filter((d) => classOf(d).includes('nd-tut-folded'))).toHaveLength(0);
    expect(decorations(state).some((d) => keyOf(d).startsWith('tutadmin:o:2'))).toBe(true);
  });

  it('draws a header per part, a card, sheet ink, and a placeholder in each empty slot', () => {
    const decos = decorations(make());
    expect(decos.filter((d) => keyOf(d).startsWith('tuthead|'))).toHaveLength(5);
    expect(decos.filter((d) => classOf(d) === 'nd-tut-part')).toHaveLength(5);
    expect(decos.filter((d) => classOf(d) === 'nd-tut-slot')).toHaveLength(3);
    const placeholders = decos.filter((d) => classOf(d) === 'nd-tut-ph').map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-placeholder']);
    expect(placeholders).toEqual(['Write your PDDL here', 'Your plan, one action per line', 'Your answer']);
    expect(decos.some((d) => classOf(d) === 'nd-tut-sheet')).toBe(true);
  });

  it('rekeys a header when its record changes, and only then', () => {
    const parts: Record<string, TutorialPartView> = { P1a: partView('P1a') };
    const ctx = chromeContext(parts);
    let state = make(ctx);
    const before = decorations(state).find((d) => keyOf(d).startsWith('tuthead|P1a|'))!;
    state = state.apply(bumpTutorialChrome(state.tr));
    expect(decorations(state).find((d) => keyOf(d).startsWith('tuthead|P1a|'))!.spec.key).toBe(before.spec.key);
    parts.P1a = partView('P1a', { status: 'correct', checkedBy: 'simulation', attempts: 1 });
    state = state.apply(bumpTutorialChrome(state.tr));
    const after = decorations(state).find((d) => keyOf(d).startsWith('tuthead|P1a|'))!;
    expect(after.spec.key).not.toBe(before.spec.key);
    expect(keyOf(after)).toContain('|correct|');
  });

  it('keys page links by their short words: no source name when the sheet cites one source', () => {
    const one = chromeContext({ P1a: partView('P1a', { links: { notesBlockIds: ['n1'], pages: [3, 4, 5] } }) });
    one.citation = (pages) => `Lecture-complex v4.0 p. ${String(pages[0])}–${String(pages[pages.length - 1])}`;
    const key = keyOf(decorations(make(one)).find((d) => keyOf(d).startsWith('tuthead|P1a|'))!);
    expect(key).toContain('|p. 3–5=Lecture-complex v4.0 p. 3–5');
  });

  it('turns working, and drops the placeholder, on the first word in a slot', () => {
    let state = make();
    let slotText = -1;
    state.doc.descendants((node, pos) => {
      if (slotText < 0 && node.type.name === 'tut_answer' && node.attrs.answerKind === 'text') slotText = pos + 2;
      return slotText < 0;
    });
    state = state.apply(state.tr.insertText('Because', slotText));
    const decos = decorations(state);
    expect(decos.filter((d) => classOf(d) === 'nd-tut-ph')).toHaveLength(2);
    expect(decos.some((d) => keyOf(d).startsWith('tuthead|P2|') && keyOf(d).includes('|working|'))).toBe(true);
  });

  it('marks a tutor_hint line as an agent’s note', () => {
    const s = notesSchema.nodes;
    let state = make();
    let end = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'tut_part' && node.attrs.partId === 'P2') end = pos + node.nodeSize - 1;
      return end < 0;
    });
    const hint = s.paragraph!.create(
      { blockId: 'h1', pages: [], reason: 'tutor_hint', objectiveIds: [] },
      notesSchema.text('Look at what deletes do.', [notesSchema.marks.author!.create({ by: 'max', editId: 'e1', at: 1 })]),
    );
    state = state.apply(state.tr.insert(end, hint));
    expect(decorations(state).some((d) => classOf(d) === 'nd-tut-hint nd-max')).toBe(true);
  });
});

describe('practiceChipsPlugin', () => {
  const notes = docOf(heading('h_title', 1, 'Planning'), heading('h_a', 2, 'PDDL', [3]), para('b_a1', 'Actions.', 'ingest', null, [3]));
  it('draws one row per practised section, before the slide strip, and redraws on a bump', () => {
    const tutorials: TutorialView[] = [];
    let state = EditorState.create({
      doc: notes,
      plugins: [practiceChipsPlugin(() => ({ tutorials: () => tutorials, onOpenPart: () => {} }))],
    });
    expect(practiceKey.getState(state)!.find()).toHaveLength(0);
    tutorials.push(tutorial('f1', 'Tutorial 1', [partView('P1a', { links: { notesBlockIds: ['b_a1'], pages: [] } })]));
    state = state.apply(bumpTutorialChrome(state.tr));
    const found = practiceKey.getState(state)!.find();
    expect(found).toHaveLength(1);
    expect(found[0]!.from).toBe(notes.content.size);
    expect((found[0]!.spec as { side?: number }).side).toBe(-2);
  });
});
