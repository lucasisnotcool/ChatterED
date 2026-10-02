/**
 * The learning overview's pure half (`notebooks.md` §3, contract C6; #58): the budget, the prompt,
 * the gate and the block shape. No database and no model.
 */
import { describe, expect, it } from 'vitest';
import { Node as PmNode } from 'prosemirror-model';
import { NOTE_SLOT_REASON } from '../../shared/doc/types.js';
import { blockAttrs, notesSchema } from '../../shared/doc/schema.js';
import {
  BLANK,
  OVERVIEW_BUDGET_CEILING,
  OVERVIEW_BUDGET_FLOOR,
  OVERVIEW_JSON_SCHEMA,
  OVERVIEW_SYSTEM,
  blankIsTheDecks,
  fitOverview,
  mintOverview,
  overviewMessage,
  overviewMeta,
  overviewPartLimits,
  overviewSectionRange,
  overviewWordBudget,
  overviewWords,
  overviewDrafts,
  pageTextsOf,
  plainLine,
  sourceWordsOf,
  validateOverview,
  type ValidOverview,
  overviewPolicy,
  proseWordBudget,
  sourceProfile,
  OVERVIEW_PROSE_MAX_IDEAS,
  OVERVIEW_PROSE_MAX_SECTIONS,
} from './overview.js';
import { critique1OverviewRaw } from './fixture.js';

const ctx = (pageCount = 20, gaps: number[] = []) => ({
  pageCount,
  pageExists: (p: number) => !gaps.includes(p),
  fallbackTitle: 'My notebook',
});

function section(heading: string, pages: number[], extra: Record<string, unknown> = {}) {
  return {
    heading,
    pages,
    takeaway: `The point of ${heading}.`,
    ideas: pages.map((p) => ({ text: `An idea from p. ${p}.`, pages: [p] })),
    recommendation: null,
    ...extra,
  };
}

function rawOverview(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Real World Planning',
    lede: { text: 'Planning in the real world. Two more sentences.', pages: [1, 2] },
    objectives: [1, 2, 3, 4].map((i) => ({
      title: `Explain idea ${i}`,
      statement: `Say idea ${i}.`,
      criteria: ['names it', 'says why'],
      quizSeeds: [`What is idea ${i}?`],
      pages: [i * 2],
    })),
    sections: [section('Heuristics', [3, 4]), section('Abstraction', [5]), section('Hierarchies', [6, 7]), section('Scheduling', [8]), section('Uncertainty', [9])],
    next: null,
    greeting: 'I read these too. Where shall we start?',
    starterQuestions: ['What is h_max?', 'Why abstract?', 'What is a hierarchy?'],
    ...over,
  };
}

describe('the word budget (§3.2)', () => {
  it('is about 350 for the brief\'s 58-page deck, whose text layer is 4,604 words, and scales gently', () => {
    // Measured live, 1 Oct 2026: Lecture-complex v4.0's `sourceWordsOf` is 4,604.
    expect(overviewWordBudget(4_604)).toBe(350);
    expect(overviewWordBudget(8_800)).toBe(490);
    expect(overviewWordBudget(2_500)).toBe(260);
  });

  it('is split into per-part limits the prompt states, the key ideas taking what is left', () => {
    expect(overviewPartLimits(350)).toEqual({ lede: 35, objective: 10, heading: 6, takeaway: 12, idea: 11 });
    expect(overviewPartLimits(200).idea).toBe(10);
    expect(overviewPartLimits(600).idea).toBe(28);
    const message = overviewMessage({
      notebookName: 'Planning',
      sourceNames: ['Lecture-complex v4.0.pdf'],
      deckText: '[p. 1]\nhello',
      condensed: false,
      sourceWords: 4_604,
      budget: 350,
      imagePages: [],
    });
    expect(message).toContain('each key idea 11.');
    expect(message).toContain('each takeaway 12;');
  });

  it('has a floor of 200 and a ceiling of 600', () => {
    expect(overviewWordBudget(0)).toBe(OVERVIEW_BUDGET_FLOOR);
    expect(overviewWordBudget(1_500)).toBe(200);
    expect(overviewWordBudget(100_000)).toBe(OVERVIEW_BUDGET_CEILING);
  });

  it('counts the sources\' words, not the page and source markers', () => {
    const text = '=== SOURCE: Lecture.pdf ===\n[p. 1]\none two three\n[p. 2] four five\n=== SOURCE: Notes.md ===\n[p. 3]\nsix';
    expect(sourceWordsOf(text)).toBe(6);
    expect(pageTextsOf(text).get(2)).toContain('four five');
    expect(pageTextsOf(text).get(3)).toContain('six');
  });

  it('is stated in the prompt as a ceiling', () => {
    const message = overviewMessage({
      notebookName: 'Planning',
      sourceNames: ['Lecture-complex v4.0.pdf'],
      deckText: '[p. 1]\nhello',
      condensed: false,
      sourceWords: 8_800,
      budget: 350,
      imagePages: [],
    });
    expect(message).toContain('at most 350 words');
    expect(message).toContain('about 8800 words');
    expect(OVERVIEW_SYSTEM).toContain('LENGTH IS A CEILING, NOT A TARGET');
  });
});

describe('the section range scales with the budget', () => {
  it('is three to five at the floor, four to seven in the middle, five to eight past 400', () => {
    expect(overviewSectionRange(200)).toEqual({ min: 3, max: 5 });
    expect(overviewSectionRange(250)).toEqual({ min: 3, max: 5 });
    expect(overviewSectionRange(350)).toEqual({ min: 4, max: 7 });
    expect(overviewSectionRange(400)).toEqual({ min: 4, max: 7 });
    expect(overviewSectionRange(600)).toEqual({ min: 5, max: 8 });
  });

  it('is stated in the user message for the budget it was given', () => {
    const base = { notebookName: 'N', sourceNames: ['a.pdf'], deckText: '[p. 1]\nhi', condensed: false, sourceWords: 500, imagePages: [] };
    expect(overviewMessage({ ...base, budget: 200 })).toContain('3 to 5 sections');
    expect(overviewMessage({ ...base, budget: 350 })).toContain('4 to 7 sections');
    expect(overviewMessage({ ...base, budget: 600 })).toContain('5 to 8 sections');
  });

  it('the validator accepts a three-section overview for a small source', () => {
    const { overview } = validateOverview(rawOverview({ sections: [section('A', [1]), section('B', [2]), section('C', [3])] }), ctx());
    expect(overview!.sections).toHaveLength(3);
  });
});

describe('the prompt carries the rules code cannot fully check', () => {
  it('blanks only where the deck leaves one, verbatim, never invented (answer B)', () => {
    expect(OVERVIEW_SYSTEM).toContain('BLANKS ONLY WHERE THE DECK LEAVES ONE');
    expect(OVERVIEW_SYSTEM).toContain('VERBATIM with the blank written as ____');
    expect(OVERVIEW_SYSTEM).toContain('NEVER invent a blank');
  });

  it('scaffolding, not answers (§3.3); no mind map and no image (answer E)', () => {
    expect(OVERVIEW_SYSTEM).toContain('SCAFFOLDING, NOT ANSWERS');
    expect(OVERVIEW_SYSTEM).toContain('do not work an example');
    expect(OVERVIEW_SYSTEM).toContain('Never a mind map, never an image.');
  });

  it('names several sources and the images, when there are any', () => {
    const message = overviewMessage({
      notebookName: 'Planning',
      sourceNames: ['A.pdf', 'B.md'],
      deckText: '',
      condensed: true,
      sourceWords: 10,
      budget: 200,
      imagePages: [3, 17],
    });
    expect(message).toContain('SOURCES (2');
    expect(message).toContain('pages 3, 17');
    expect(message).toContain('CONDENSED');
  });

  it('offers exactly the five block kinds a recommendation may be', () => {
    const sections = (OVERVIEW_JSON_SCHEMA.properties as Record<string, { items: { properties: Record<string, { properties: { kind: { enum: string[] } } }> } }>).sections;
    expect(sections!.items.properties.recommendation!.properties.kind.enum).toEqual(['table', 'diagram', 'flashcards', 'quiz', 'infographic']);
  });
});

describe('validateOverview: repair before reject', () => {
  it('keeps a clean overview as it is', () => {
    const { overview, repairs } = validateOverview(rawOverview(), ctx());
    expect(overview!.sections).toHaveLength(5);
    expect(overview!.objectives).toHaveLength(4);
    expect(overview!.starterQuestions).toEqual(['What is h_max?', 'Why abstract?', 'What is a hierarchy?']);
    expect(repairs.pagesDropped).toBe(0);
  });

  it('drops pages past the notebook and in a gap, and ideas left uncited', () => {
    const { overview, repairs } = validateOverview(
      rawOverview({
        sections: [
          {
            heading: 'Heuristics',
            pages: [3, 99],
            takeaway: 'x',
            ideas: [
              { text: 'cited', pages: [3, 12] },
              { text: 'in a gap only', pages: [12] },
              { text: 'past the end', pages: [40] },
            ],
          },
        ],
      }),
      ctx(20, [12]),
    );
    const s = overview!.sections[0]!;
    expect(s.pages).toEqual([3]);
    expect(s.ideas.map((i) => i.text)).toEqual(['cited']);
    expect(s.ideas[0]!.pages).toEqual([3]);
    expect(repairs.ideasDropped).toBe(2);
    expect(repairs.pagesDropped).toBe(4);
  });

  it('clamps the counts: 8 sections, 3 ideas, 6 objectives, 4 criteria, 3 seeds', () => {
    const many = Array.from({ length: 10 }, (_, i) => section(`S${i}`, [i + 1, i + 2, i + 3, i + 4]));
    const objectives = Array.from({ length: 8 }, (_, i) => ({
      title: `Objective ${i}`,
      statement: 's',
      criteria: ['a', 'b', 'c', 'd', 'e'],
      quizSeeds: ['q1', 'q2', 'q3', 'q4'],
      pages: [1],
    }));
    const { overview, repairs } = validateOverview(rawOverview({ sections: many, objectives }), ctx());
    expect(overview!.sections).toHaveLength(8);
    expect(repairs.sectionsOverCap).toBe(2);
    expect(overview!.sections.every((s) => s.ideas.length <= 3)).toBe(true);
    expect(overview!.objectives).toHaveLength(6);
    expect(overview!.objectives[0]!.criteria).toHaveLength(4);
    expect(overview!.objectives[0]!.quizSeeds).toHaveLength(3);
  });

  it('caps an objective title at twelve words and a recommendation title at eight', () => {
    const { overview } = validateOverview(
      rawOverview({
        objectives: [{ title: 'one two three four five six seven eight nine ten eleven twelve thirteen', statement: '', criteria: [], quizSeeds: [], pages: [1] }],
        sections: [section('A', [1], { recommendation: { kind: 'quiz', title: 'one two three four five six seven eight nine', description: 'Checks it. And more.' } })],
      }),
      ctx(),
    );
    expect(overview!.objectives[0]!.title.split(' ')).toHaveLength(12);
    expect(overview!.sections[0]!.recommendation).toEqual({ kind: 'quiz', title: 'one two three four five six seven eight', description: 'Checks it.' });
  });

  it('refuses a recommendation of a kind that is not offered (no mind map, no image)', () => {
    const { overview, repairs } = validateOverview(
      rawOverview({
        sections: [
          section('A', [1], { recommendation: { kind: 'mindmap', title: 'Map', description: 'A map.' } }),
          section('B', [2], { recommendation: { kind: 'image', title: 'Picture', description: 'A picture.' } }),
          section('C', [3], { recommendation: { kind: 'infographic', title: 'Steps', description: 'The steps.' } }),
        ],
      }),
      ctx(),
    );
    expect(overview!.sections.map((s) => s.recommendation?.kind ?? null)).toEqual([null, null, 'infographic']);
    expect(repairs.recommendationsDropped).toBe(2);
  });

  it('keeps at most four recommendations, varied in kind first, then in section order', () => {
    const rec = (kind: string) => ({ recommendation: { kind, title: `A ${kind}`, description: 'Holds it.' } });
    const kinds = ['table', 'table', 'quiz', 'diagram', 'table', 'flashcards'];
    const sections = kinds.map((k, i) => section(`S${i}`, [i + 1], rec(k)));
    const { overview, repairs } = validateOverview(rawOverview({ sections }), ctx());
    // S0 table, S2 quiz, S3 diagram, S5 flashcards: the repeated tables (S1, S4) go.
    expect(overview!.sections.map((s) => s.recommendation?.kind ?? null)).toEqual(['table', null, 'quiz', 'diagram', null, 'flashcards']);
    expect(repairs.recommendationsDropped).toBe(2);
  });

  it('fills the four from repeats, in section order, when there are fewer than four kinds', () => {
    const rec = (kind: string) => ({ recommendation: { kind, title: `A ${kind}`, description: 'Holds it.' } });
    const kinds = ['table', 'table', 'quiz', 'table', 'quiz'];
    const sections = kinds.map((k, i) => section(`S${i}`, [i + 1], rec(k)));
    const { overview } = validateOverview(rawOverview({ sections }), ctx());
    expect(overview!.sections.map((s) => s.recommendation?.kind ?? null)).toEqual(['table', 'table', 'quiz', 'table', null]);
  });

  it('leaves four or fewer recommendations alone', () => {
    const rec = { recommendation: { kind: 'table', title: 'T', description: 'D.' } };
    const sections = [1, 2, 3, 4].map((i) => section(`S${i}`, [i], rec));
    const { overview, repairs } = validateOverview(rawOverview({ sections }), ctx());
    expect(overview!.sections.filter((s) => s.recommendation)).toHaveLength(4);
    expect(repairs.recommendationsDropped).toBe(0);
  });

  it('makes exactly three starter questions: cuts the extra, fills the missing from quiz seeds', () => {
    expect(validateOverview(rawOverview({ starterQuestions: ['a', 'b', 'c', 'd'] }), ctx()).overview!.starterQuestions).toEqual(['a', 'b', 'c']);
    const filled = validateOverview(rawOverview({ starterQuestions: ['Only one?'] }), ctx());
    expect(filled.overview!.starterQuestions).toEqual(['Only one?', 'What is idea 1?', 'What is idea 2?']);
    expect(filled.repairs.startersFilled).toBe(2);
  });

  it('fills a missing title and greeting, and takes the greeting\'s first line only', () => {
    const { overview, repairs } = validateOverview(rawOverview({ title: '', greeting: 'Line one\nline two' }), ctx());
    expect(overview!.title).toBe('My notebook');
    expect(repairs.titleFilled).toBe(true);
    expect(overview!.greeting).toBe('Line one');
  });

  it('returns null when no section survives', () => {
    expect(validateOverview(rawOverview({ sections: [{ heading: 'A', pages: [99], takeaway: 't', ideas: [] }] }), ctx()).overview).toBeNull();
    expect(validateOverview('not json at all', ctx()).overview).toBeNull();
  });

  it('keeps the optional last section, without a recommendation', () => {
    const { overview } = validateOverview(
      rawOverview({ next: { heading: '', pages: [20], takeaway: 'Next week: learning.', ideas: [], recommendation: { kind: 'quiz', title: 't', description: 'd' } } }),
      ctx(),
    );
    const last = overview!.sections[overview!.sections.length - 1]!;
    expect(last).toMatchObject({ heading: 'What comes next', next: true, recommendation: null });
  });
});

describe('blanks: only the deck\'s own (answer B)', () => {
  const pageTexts = new Map([
    [24, 'Combining heuristics\nMax(Cost) =\nSum(Cost) =\n'],
    [17, 'h_FF : ?\nrelaxed plan'],
    [5, 'The cost of the relaxed plan is admissible.'],
  ]);

  it('keeps a blank that sits after the slide\'s own words, and normalises the underscores', () => {
    const { overview, repairs } = validateOverview(
      rawOverview({ sections: [section('Combining', [24], { ideas: [{ text: 'Max(Cost) = ______ and Sum(Cost) = __', pages: [24] }] })] }),
      { ...ctx(30), pageTexts },
    );
    expect(overview!.sections[0]!.ideas[0]!.text).toBe(`Max(Cost) = ${BLANK} and Sum(Cost) = __`);
    expect(repairs.inventedBlanks).toBe(0);
  });

  it('drops an idea whose blank the cited slide does not leave', () => {
    const { overview, repairs } = validateOverview(
      rawOverview({
        sections: [
          section('Relaxed plans', [5], {
            ideas: [
              { text: 'The cost of the relaxed plan is ____.', pages: [5] },
              { text: 'Relaxed plans ignore deletes.', pages: [5] },
            ],
          }),
        ],
      }),
      { ...ctx(30), pageTexts },
    );
    // "relaxed plan is" is on p. 5, but p. 5 leaves no blank anywhere (no line ends on "=",
    // "?" or "__"), so a blank cited to it is invented however well its words match.
    expect(blankIsTheDecks({ text: 'Heuristics are always ____.', pages: [5] }, pageTexts)).toBe(false);
    expect(blankIsTheDecks({ text: 'h_FF : ____', pages: [17] }, pageTexts)).toBe(true);
    expect(blankIsTheDecks({ text: 'Max(Cost) = ____', pages: [5] }, pageTexts)).toBe(false);
    expect(overview!.sections[0]!.ideas.map((i) => i.text)).toEqual(['Relaxed plans ignore deletes.']);
    expect(repairs.inventedBlanks).toBe(1);
  });

  it('keeps the deck\'s blank inside the model\'s own sentence (two words before it, not four)', () => {
    // As the live run of 1 Oct 2026 wrote p. 24's blanks: inside a sentence of its own.
    const idea = { text: 'For the blocks example (A on B, C on D), Max(Cost) = ____ and Sum(Cost) = ____.', pages: [24] };
    expect(blankIsTheDecks(idea, pageTexts)).toBe(true);
    // A blank after words the page has, on a page that leaves one, but not after them.
    expect(blankIsTheDecks({ text: 'Combining heuristics is ____.', pages: [24] }, pageTexts)).toBe(false);
  });

  it('counts an invented blank and drops its idea', () => {
    const { overview, repairs } = validateOverview(
      rawOverview({ sections: [section('Heuristics', [5], { ideas: [{ text: 'Heuristics are always ____.', pages: [5] }, { text: 'kept', pages: [5] }] })] }),
      { ...ctx(30), pageTexts },
    );
    expect(overview!.sections[0]!.ideas.map((i) => i.text)).toEqual(['kept']);
    expect(repairs.inventedBlanks).toBe(1);
  });

  it('never lets a takeaway or the lede carry a blank', () => {
    const { overview, repairs } = validateOverview(
      rawOverview({ lede: { text: 'Planning is ____.', pages: [1] }, sections: [section('A', [1], { takeaway: 'It is ____ here.' })] }),
      ctx(),
    );
    expect(overview!.lede.text).not.toContain(BLANK);
    expect(overview!.sections[0]!.takeaway).not.toContain(BLANK);
    expect(repairs.inventedBlanks).toBe(2);
  });
});

describe('the C6 block shape', () => {
  const valid = (): ValidOverview => validateOverview(rawOverview(), ctx()).overview!;

  function shape(nodes: PmNode[]): string[] {
    return nodes.map((n) => {
      const a = blockAttrs(n);
      const level = n.type.name === 'heading' ? `${n.attrs.level as number}` : '';
      return `${n.type.name}${level}${a.reason ? `(${a.reason})` : ''}`;
    });
  }

  it('is title, lede, "By the end you can", the objectives, then per section H2, takeaway, one list per idea, the slot', () => {
    const minted = mintOverview(valid(), ['Explain idea 1', 'Explain idea 2', 'Explain idea 3', 'Explain idea 4']);
    expect(shape(minted.nodes).slice(0, 9)).toEqual([
      'heading1(title)',
      'paragraph',
      'heading3(objectives)',
      'ordered_list(objectives)',
      'heading2',
      'paragraph',
      'bullet_list',
      'bullet_list',
      `paragraph(${NOTE_SLOT_REASON})`,
    ]);
    // A whole doc of it passes the schema's own check.
    expect(() => notesSchema.nodes.doc!.create(null, minted.nodes).check()).not.toThrow();
  });

  it('puts the objectives in tree order, and their union of pages on the list', () => {
    const minted = mintOverview(valid(), ['Second first', 'First second']);
    const list = minted.nodes[3]!;
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe('Second first');
    expect(blockAttrs(list).pages).toEqual([2, 4, 6, 8]);
  });

  it('gives each idea its own one-item bullet list with its own pages', () => {
    const minted = mintOverview(valid(), []);
    const lists = minted.nodes.filter((n) => n.type.name === 'bullet_list');
    expect(lists.every((l) => l.childCount === 1)).toBe(true);
    expect(blockAttrs(lists[0]!).pages).toEqual([3]);
    expect(blockAttrs(lists[1]!).pages).toEqual([4]);
  });

  it('leaves each your-note slot empty, with the section\'s pages and the slot reason', () => {
    const minted = mintOverview(valid(), []);
    expect(minted.slotIds).toHaveLength(5);
    const slot = minted.nodes.find((n) => blockAttrs(n).blockId === minted.slotIds[0])!;
    expect(slot.content.size).toBe(0);
    expect(blockAttrs(slot)).toMatchObject({ pages: [3, 4], reason: NOTE_SLOT_REASON });
  });

  it('maps each recommendation to its section heading block, offered', () => {
    const overview = validateOverview(
      rawOverview({ sections: [section('A', [1]), section('B', [2], { recommendation: { kind: 'table', title: 'Compare', description: 'Side by side.' } })] }),
      ctx(),
    ).overview!;
    const minted = mintOverview(overview, []);
    const meta = overviewMeta({ overview, headingIds: minted.headingIds, fingerprint: 'f', writtenAt: 't', words: minted.words, wordBudget: 200 });
    expect(meta.recommendations).toHaveLength(1);
    const rec = meta.recommendations[0]!;
    expect(rec).toMatchObject({ kind: 'table', status: 'offered', headingBlockId: minted.headingIds[1] });
    const heading = minted.nodes.find((n) => blockAttrs(n).blockId === rec.headingBlockId)!;
    expect(heading.textContent).toBe('B');
    expect(rec.id).toMatch(/^rec_[0-9a-f]{12}$/);
    expect(meta).toMatchObject({ version: 1, fingerprint: 'f', wordBudget: 200, greeting: overview.greeting });
  });

  it('counts the words written, title excluded', () => {
    const minted = mintOverview(validateOverview(critique1OverviewRaw(), ctx(7)).overview!, ['One two']);
    expect(minted.words).toBeGreaterThan(100);
    expect(minted.words).toBeLessThan(400);
  });
});

describe('plain lines for the chat (§6)', () => {
  it('takes maths delimiters and markup off a starter question or the greeting', () => {
    expect(plainLine('Why is $h_{max}$ admissible but $h_{sum}$ sometimes not?')).toBe('Why is h_max admissible but h_sum sometimes not?');
    expect(plainLine('What does **downward refinement** guarantee for `HLA` plans?')).toBe('What does downward refinement guarantee for HLA plans?');
    expect(plainLine('Is $10^{405}$ a *lot*?')).toBe('Is 10^405 a lot?');
  });

  it('is applied by the gate to the starters and the greeting', () => {
    const { overview } = validateOverview(
      rawOverview({ greeting: 'Hi, I read about $h_{FF}$ too.', starterQuestions: ['Why $h_{max}$?', 'B?', 'C?'] }),
      ctx(),
    );
    expect(overview!.greeting).toBe('Hi, I read about h_FF too.');
    expect(overview!.starterQuestions[0]).toBe('Why h_max?');
  });
});

describe('the budget kept in code (§3.2: a ceiling)', () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const wordsOf = (o: ValidOverview) => overviewWords(overviewDrafts(o, o.objectives.map((x) => x.title)).drafts);

  it('cuts third ideas, last section first, until the overview fits', () => {
    const sections = [1, 3, 5, 7, 9].map((p) =>
      section(`S${p}`, [p], { ideas: [p, p, p].map((q) => ({ text: long(20), pages: [q] })) }),
    );
    const { overview } = validateOverview(rawOverview({ sections }), ctx());
    const before = wordsOf(overview!);
    // Over by more than the slack: two sections' third ideas (2 x 20 words) bring it back.
    const budget = Math.floor((before - 45) / 1.1);
    const { overview: fitted, ideasCut } = fitOverview(overview!, budget);
    expect(ideasCut).toBeGreaterThan(0);
    expect(wordsOf(fitted)).toBeLessThanOrEqual(budget * 1.1);
    // The last sections lost theirs; the first kept its three.
    expect(fitted.sections[0]!.ideas).toHaveLength(3);
    expect(fitted.sections.at(-1)!.ideas).toHaveLength(2);
  });

  it('never cuts below two ideas, nor anything within the slack', () => {
    const { overview } = validateOverview(rawOverview(), ctx());
    expect(fitOverview(overview!, 10_000)).toEqual({ overview, ideasCut: 0 });
    const tiny = fitOverview(overview!, 1);
    tiny.overview.sections.forEach((s, i) => {
      expect(s.ideas.length).toBe(Math.min(2, overview!.sections[i]!.ideas.length));
    });
  });
});

/**
 * **Slides or prose** (`notebooks.md` §3.2, amended 2026-10-02). The first research paper got a
 * slide deck's budget and shape; the policy is now read off the text.
 */
describe('overviewPolicy', () => {
  const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');
  const deck = (pages: string[]) => pages.map((body, i) => `[p. ${i + 1}] ${body}`).join('\n');

  it('reads a deck of short pages as slides and keeps the slide budget', () => {
    const text = deck(Array.from({ length: 40 }, () => words(80)));
    const policy = overviewPolicy(text);
    expect(policy.genre).toBe('slides');
    expect(policy.bodyWords).toBe(3200);
    expect(policy.budget).toBe(overviewWordBudget(3200));
    expect(policy.maxIdeas).toBe(3);
  });

  it('reads a paper as prose, leaves its references out, and gives it the prose budget and caps', () => {
    const pages = Array.from({ length: 11 }, () => words(700));
    pages.push(`References\n${words(500, 'ref')}`, words(600, 'ref'));
    const policy = overviewPolicy(deck(pages));
    expect(policy).toMatchObject({ genre: 'prose', bodyWords: 7700, referenceWords: 1101 });
    expect(policy.budget).toBe(proseWordBudget(7700));
    expect(policy.budget).toBe(770);
    expect(policy.maxSections).toBe(OVERVIEW_PROSE_MAX_SECTIONS);
    expect(policy.maxIdeas).toBe(OVERVIEW_PROSE_MAX_IDEAS);
  });

  it('does not let a References slide in the first half of a deck swallow the rest of it', () => {
    const pages = Array.from({ length: 20 }, () => words(60));
    pages[3] = 'References';
    expect(sourceProfile(deck(pages)).referenceWords).toBe(0);
  });

  it('keeps the prose budget between its floor and ceiling', () => {
    expect(proseWordBudget(1_000)).toBe(400);
    expect(proseWordBudget(40_000)).toBe(1_200);
  });

  it('tells the model a paper is prose, and asks for its method, data and results', () => {
    const message = overviewMessage({
      notebookName: 'p',
      sourceNames: ['p.pdf'],
      deckText: '[p. 1] x',
      condensed: false,
      sourceWords: 7700,
      budget: 770,
      genre: 'prose',
      imagePages: [],
    }).replace(/\s+/g, ' ');
    expect(message).toContain('THESE SOURCES ARE PROSE');
    expect(message).toContain('the headline results with their numbers');
    expect(message).toContain('two to four cited ideas each');
    expect(message).not.toContain('Blanks (____)');
    const slides = overviewMessage({ notebookName: 'd', sourceNames: ['d.pdf'], deckText: '[p. 1] x', condensed: false, sourceWords: 3000, budget: 300, imagePages: [] });
    expect(slides).not.toContain('THESE SOURCES ARE PROSE');
  });
});
