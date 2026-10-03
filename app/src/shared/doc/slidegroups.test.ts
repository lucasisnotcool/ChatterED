import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { docFromJson } from './schema.js';
import {
  EARLIER_NOTES_REASON,
  OPENING_KEY,
  OTHER_KEY,
  slideGroups,
  slidePlacements,
  type SlideGroup,
  type SlideGroupsInput,
} from './slidegroups.js';
import { NOTE_SLOT_REASON, OBJECTIVES_REASON, type DocAuthor } from './types.js';

// ── building docs as JSON, the shape the store holds them in ─────────────────────────────────

type J = Record<string, unknown>;

const text = (value: string, by: DocAuthor = 'ingest'): J => ({
  type: 'text',
  text: value,
  marks: [{ type: 'author', attrs: { by, editId: null, at: 0 } }],
});
const attrs = (blockId: string, pages: number[], reason: string | null = null): J => ({ blockId, pages, reason, objectiveIds: [] });
const h = (id: string, level: number, value: string, pages: number[], reason: string | null = null): J => ({
  type: 'heading',
  attrs: { level, ...attrs(id, pages, reason) },
  content: [text(value)],
});
const p = (id: string, value: string, pages: number[], by: DocAuthor = 'ingest', reason: string | null = null): J => ({
  type: 'paragraph',
  attrs: attrs(id, pages, reason),
  ...(value ? { content: [text(value, by)] } : {}),
});
const slot = (id: string, pages: number[]): J => p(id, '', pages, 'ingest', NOTE_SLOT_REASON);
const idea = (id: string, value: string, pages: number[], by: DocAuthor = 'ingest'): J => ({
  type: 'bullet_list',
  attrs: attrs(id, pages),
  content: [{ type: 'list_item', attrs: { blockId: `${id}_li` }, content: [p(`${id}_p`, value, pages, by)] }],
});
const objectives = (id: string, pages: number[]): J => ({
  type: 'ordered_list',
  attrs: attrs(id, pages, OBJECTIVES_REASON),
  content: [{ type: 'list_item', attrs: { blockId: `${id}_li` }, content: [p(`${id}_p`, 'Describe a planning problem', [])] }],
});
const qBlock = (id: string, pages: number[]): J => ({
  type: 'q_block',
  attrs: { questionId: `q_${id}`, askedBy: 'max', status: 'open', resolution: null, objectiveId: null, ...attrs(id, pages) },
  content: [p(`${id}_p`, 'A question on this slide', pages, 'user')],
});
const figure = (id: string, page: number): J => ({
  type: 'slide_figure',
  attrs: { page, rect: null, caption: 'A slide', evidentiary: true, ...attrs(id, [page]) },
});
const table = (id: string, pages: number[], rowPages: number[][]): J => ({
  type: 'table',
  attrs: { caption: null, ...attrs(id, pages) },
  content: [
    { type: 'table_row', attrs: { pages: [] }, content: [{ type: 'table_cell', attrs: { header: true }, content: [text('Approach', 'ellie')] }] },
    ...rowPages.map((rp, i) => ({
      type: 'table_row',
      attrs: { pages: rp },
      content: [{ type: 'table_cell', attrs: { header: false }, content: [text(`Row ${i}`, 'ellie')] }],
    })),
  ],
});
const docOf = (...blocks: J[]): Node => docFromJson({ type: 'doc', content: blocks });
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const byTitle = (groups: SlideGroup[]): Record<string, number[]> => Object.fromEntries(groups.map((g) => [g.title, g.pages]));
const groupOf = (groups: SlideGroup[], page: number): string => groups.find((g) => g.pages.includes(page))!.title;

function expectPartition(groups: SlideGroup[], pages: readonly number[]): void {
  const all = groups.flatMap((g) => g.pages);
  expect([...all].sort((a, b) => a - b)).toEqual([...new Set(pages)].sort((a, b) => a - b));
  expect(new Set(all).size).toBe(all.length);
  for (const g of groups) expect(g.pages).toEqual([...g.pages].sort((a, b) => a - b));
}

// ── the v4.0 lecture, trimmed (CS4246 "Real World Planning and Acting", a lecturer's deck) ─────
//
// The structure of the real overview this module was written against (2026-10-03): the H1 title,
// a lede citing 8, 9 and 52, the objectives list citing the union of every objective's pages,
// seven sections each with heading, takeaway, ideas and note slot, Ellie's tables (whose rows cite
// p. 19, 46, 51, 54 and 55), the learner's Q blocks and two pasted paragraphs carrying the
// objectives' union, a Q block sitting under the wrong section, and a carried-over "Earlier notes".

const UNION = [3, 4, 5, 6, 16, 17, 18, 21, 22, 23, 24, 30, 31, 33, 38, 41, 42, 45, 47, 49, 50, 56];

function v4Doc(): Node {
  return docOf(
    h('b_title', 1, 'Real World Planning and Acting', [], 'title'),
    p('b_lede', 'Classical planning is scaled with heuristics, abstraction, hierarchy and LLMs.', [8, 9, 52]),
    h('b_byend', 3, 'By the end you can', [], OBJECTIVES_REASON),
    objectives('b_objs', UNION),

    h('b_pddl', 2, 'Classical planning in PDDL', [3, 4, 5, 6, 7]),
    p('b_pddl_t', 'A domain plus a problem is searched or encoded for a plan.', [3, 4, 5, 6, 7]),
    p('b_pddl_bg', 'A PDDL domain holds the rules of a world.', [], 'ellie', 'background Ellie added'),
    idea('b_pddl_i1', 'Air cargo example split into domain and problem in PDDL.', [3, 4, 5]),
    idea('b_pddl_i2', 'Approaches: forward and backward search, SAT, planning graph.', [7]),
    qBlock('b_pddl_q', [4, 6]),
    slot('b_pddl_s', [3, 4, 5, 6, 7]),

    h('b_heur', 2, 'Heuristics for search-based planning', [11, 12, 13, 16, 17, 18]),
    p('b_heur_u1', 'PREREQ: HEURISTICS', UNION, 'user'),
    p('b_heur_u2', 'In the 8-puzzle, Manhattan distance is consistent.', UNION, 'user'),
    qBlock('b_heur_q', [17]),
    p('b_heur_t', 'Heuristics are explicit in search, implicit in inference.', [11, 12, 13, 16, 17, 18]),
    idea('b_heur_i1', 'Admissible, domain-independent and domain-specific heuristics.', [13]),
    idea('b_heur_i2', 'h_FF builds a relaxed plan; informed but inadmissible.', [18]),
    slot('b_heur_s', [11, 12, 13, 16, 17, 18]),
    table('b_heur_tab', [11, 12, 13, 16, 17, 18], [[17], [19]]),

    h('b_abs', 2, 'State abstraction and goal decomposition', [21, 22, 23, 24, 25]),
    p('b_abs_t', 'Fewer states and subgoal costs give simpler, stronger estimates.', [21, 22, 23, 24, 25]),
    idea('b_abs_i1', 'Abstraction shrinks the air cargo state count.', [22]),
    idea('b_abs_i2', 'Blocks example leaves Max(Cost) and Sum(Cost) open.', [24]),
    qBlock('b_abs_q', [24]),
    slot('b_abs_s', [21, 22, 23, 24, 25]),

    h('b_hier', 2, 'Hierarchical planning and HLAs', [28, 29, 30, 31, 32, 33]),
    p('b_hier_t', 'Refine abstract tasks until only primitive actions remain.', [28, 29, 30, 31, 32, 33]),
    p('b_hier_e', 'Primitive means executable directly by the agent.', [30, 33], 'ellie'),
    idea('b_hier_i1', 'Changi trip refined by driving or taxi.', [28, 32]),
    idea('b_hier_i2', 'HTN loop: pick an HLA, replace it, repeat.', [31]),
    slot('b_hier_s', [28, 29, 30, 31, 32, 33]),

    h('b_reach', 2, 'Reachable sets and approximations', [36, 38, 39, 41, 42, 43]),
    p('b_reach_t', 'Optimistic and pessimistic reachable sets decide success or failure.', [36, 38, 39, 41, 42, 43]),
    idea('b_reach_i1', 'REACH(s, h) and downward refinement justify high-level plans.', [38]),
    idea('b_reach_i2', 'Optimistic and pessimistic bounds on REACH.', [41, 42]),
    slot('b_reach_s', [36, 38, 39, 41, 42, 43]),
    table('b_reach_tab', [36, 38, 39, 41, 42, 43], [[41], [46], [46]]),
    // A learner's question on the hierarchy slides, sitting under the wrong section.
    qBlock('b_reach_q', [28, 31]),

    h('b_llm', 2, 'LLM-assisted planning', [44, 45, 47, 48, 49, 50, 56]),
    p('b_llm_t', 'LLMs help with models, subgoals, heuristics and generalized plans.', [44, 45, 47, 48, 49, 50, 56]),
    idea('b_llm_i1', 'PDDL creation, task decomposition, heuristic generation and generalized planning.', [45, 47, 49, 50]),
    idea('b_llm_i2', 'Symbolic planner switches to MCTS when subproblems are too complex.', [48]),
    slot('b_llm_s', [44, 45, 47, 48, 49, 50, 56]),
    table('b_llm_tab', [44, 45, 47, 48, 49, 50, 56], [[49, 50], [51], [54, 55]]),

    h('b_next', 2, 'Next: planning under uncertainty', [52, 53]),
    p('b_next_t', 'Uncertainty leads to utility theory, MDPs and reinforcement learning.', [52, 53]),
    idea('b_next_i1', 'Noisy sensors and stochastic dynamics motivate the next topic.', [52]),
    idea('b_next_i2', 'Homework: RN 11.3, 11.4, 11.7; review 3.3, 3.5, 3.6.', [53]),
    slot('b_next_s', [52, 53]),

    h('b_earlier', 2, 'Earlier notes', [], EARLIER_NOTES_REASON),
    p('b_earlier_p', 'In logical inference planning there is no explicit heuristic.', [11], 'user'),
  );
}

const FOOT = 'Real World Planning and Acting';
/** Each slide's title (and a line of body where the rules read it), the footer on most. */
const V4_TEXT: Record<number, string> = {
  1: `© Copyright National University of Singapore. All Rights Reserved.\n${FOOT}\nCS4246/CS5446\nReinforcement Learning and Sequential Decision Making\nVersion 4.0`,
  2: 'Types of AI Agents\nClassical Planning 2',
  3: 'Example: Air Cargo Transport Planning\n3Classical Planning\nPlanning Problem\nPlanning Domain',
  4: 'Example: Planning Domain in PDDL\n(define (domain air-cargo)\n(:action Load\n(:action Fly',
  5: 'Example: Planning Problem in PDDL\n(define (problem air-cargo-problem)\n(:init (At C1 SFO))',
  6: 'A Possible Plan\n• A solution – How to find it?\nLoad(C1, P1, SFO)\nFly(P1, SFO, SIN)\nClassical Planning 6',
  7: 'Classical Planning Summary\n• Goal-directed planning\n• STRIPS, PDDL\n• Forward (progression)\n• SAT-based approaches',
  8: 'From Classical to Modern Planning\n• Classical planning remains highly relevant\n• Heuristics, hierarchical decomposition, LLM-assisted methods\nClassical Planning 8',
  9: `Topics\n• Heuristics for planning\n• State abstraction and Goal decomposition\n• Hierarchical planning\n• Scale with LLM-Assisted Planning\n${FOOT} 9`,
  10: `Heuristics for Search-Based Planning\nEnhancing efficiency\n10${FOOT}`,
  11: `Heuristics for Classical Planning Paradigms\n• Why use heuristics?\n• Reduce search space\n${FOOT} 11`,
  12: `Planning as Search Overview\n• States (nodes), Actions (edges)\n• Heuristic h(s) estimates cost to goal\n${FOOT} 12`,
  13: `Improving Efficiency in Search-Based Planning\n• Admissible heuristics never overestimate\n• Domain-independent heuristics from relaxed problems\n${FOOT} 13`,
  14: `Planning as Path Search\n• Example: 8-Puzzle\n• Rearrange eight numbered tiles on a 3×3 board\n${FOOT} 14`,
  15: `Example: 8-Puzzle as Planning\n• States, actions, goal test, path cost\n• Tiles slide left, right, up, or down\n${FOOT} 15`,
  16: `Ignore Selected Preconditions Heuristic\n• Remove preconditions\n• No. of misplaced tiles heuristic\n${FOOT} 16`,
  17: `Ignore Delete Effects Heuristic\n• Manhattan distances\n• h_max admissible, weak\n• h_add more informative, not admissible\n${FOOT} 17`,
  18: `Notes: The Fast Forward Heuristic\n• Ignore delete effects, build a relaxed problem\n• Compute relaxed plan greedily\n${FOOT} 18`,
  19: `Summary: Improving Efficiency\n• Relaxation-based heuristics provide optimistic lower bounds\n• Admissible heuristics ensure optimality\n• Trade-off informativeness vs admissibility\n• Domain-independent pruning, symmetry reduction, forward pruning\n${FOOT} 20`,
  20: `State Abstraction and Goal Decomposition\nReducing complexity\n21${FOOT}`,
  21: `State Abstraction for Simplicity\n• Group states into abstract states, search a smaller space, then refine\n${FOOT} 22`,
  22: `Example: Air Cargo Transportation\n• 10 airports, 50 planes and 200 cargos\n${FOOT} 23`,
  23: `Goal Decomposition for Efficiency\n• Break goal G into subgoals\n• Max(Cost) admissible but weak\n${FOOT} 24`,
  24: `Example\n• All four blocks A, B, C and D are on the table\n• Subgoals are independent\n${FOOT} 25`,
  25: `Abstraction-Based Approaches\n• State abstraction groups states\n• Goal decomposition splits complex goals\n${FOOT} 26`,
  26: `Hierarchical Planning and Acting\nManage complexity\n${FOOT} 27`,
  27: `Examples\n• How to go to the lecture from home?\n• How to land on the Jezero Crater of Mars?\n• How to get from home to Changi airport?\n${FOOT} 28`,
  28: `Example: Going to Changi Airport\nRefinement (1) Drive(Home, SIN)\nRefinement (2) Taxi(Home, SIN)\n${FOOT} 29`,
  29: `Managing Complexity in Planning\n• Hierarchical decomposition\n• Deferred planning\n${FOOT} 30`,
  30: `Hierarchical Task Networks (HTNs)\n• Built on High-Level Actions (HLAs)\n• Primitive actions with preconditions/effects\n${FOOT} 31`,
  31: `HTN Planning\n• Start with top-level task, refine until primitive actions only\n• Select an HLA, replace with one refinement\n${FOOT} 32`,
  32: 'Call-Taxi(Home)\nRide(Home, SIN)\nPay-Taxi(Home, SIN)\nDecomposition into subtasks',
  33: `Complexity Analysis\n• Non-hierarchical planner branching factor\n• HTN planner refinements\n${FOOT} 36`,
  34: `Proving Plan Properties\nSearching for Abstract Solutions\n${FOOT} 37`,
  35: `Motivation\n• Decide if a high-level plan achieves the goal without low-level details\n• [Call-Taxi(Home), Ride(Home, SIN), Pay-Taxi(SIN)]\n${FOOT} 38`,
  36: `High-Level Planning with HLAs\n• Goal: decide if a high-level plan achieves the goal\n${FOOT} 39`,
  37: `Example: Reachable Sets\n${FOOT}\nSource: RN: Fig 11.6\nREACH(s, [h1])\nREACH(s, [h1, h2])\ns\ns\n40`,
  38: `Reachable Sets\n• REACH(s, h) is the set of states reachable by any refinement\n• Downward refinement property\n${FOOT} 41`,
  39: `Representing Reachable Set\n• Notations for effects of HLAs\n${FOOT} 42`,
  40: `Example\n• Schemas for HLAs h1 and h2\n${FOOT} 43`,
  41: `Approximate Reachable Sets\n• Why approximate? Optimistic and pessimistic descriptions\n${FOOT} 44`,
  42: `High-Level Planning with Approximate Descriptions\n• Optimistic reachable set misses the goal: plan fails\n${FOOT} 45`,
  43: `Summary\n• Hierarchical decomposition, abstraction and refinement\n• Reachable sets with approximations\n${FOOT} 47`,
  44: `LLM-Assisted Planning\nModeling\nTask decomposition\nSearch optimization\n48${FOOT}`,
  45: `LLM-Guided PDDL Creation and Refinement\n• Generate and refine PDDL models via feedback\n${FOOT} 49`,
  46: 'LLM-assisted PDDL Creation\nClassical Planning 50\nSource: Figure 3\nTranslate into PDDL\nDomain refinement\nDomain checking',
  47: `Task Decomposition & Subgoal Planning\n• LLM decomposes tasks; symbolic planners solve subgoals\n${FOOT} 51`,
  48: `Notes: Symbolic + MCTS with LLM\n• Symbolic planner switches to MCTS for complex subproblems\n${FOOT} 52`,
  49: `Heuristic Generation via LLMs\n• LLM synthesizes domain-specific heuristics\n${FOOT} 53`,
  50: `Generalized Planning in PDDL Domains with LLMs\n• LLM writes generalized plans as programs\n${FOOT} 54`,
  51: 'Example: Generalized Planning in PDDL Domains with\nPretrained Large Language Models (LLMs)\nOverview 55\nSource: Generalized planning in PDDL domains with pretrained large language models. AAAI 2024.',
  52: `From Classical to Modern Planning: Next Steps\n• Real world environments involve uncertainty\n• Noisy sensors, stochastic dynamics\n• Utility theory, Markov decision processes\n${FOOT} 56`,
  53: `Homework\n• Readings: Heuristics RN 11.3; Hierarchical RN 11.4; Summary RN 11.7\n• Reviews: RN 3.3, 3.5, 3.6\n${FOOT} 57`,
  54: 'References\n• Hoffmann and Nebel, The FF planning system, 2001\n• Helmert, The fast downward planning system, 2006',
  55: `Appendix\n59${FOOT}`,
  56: 'Notes: Examples of LLM-Assisted Planning\nCategory\nLLM + PDDL Integration\nKey Contribution Planner(s) Used Reference\nModel Creation\nTask Decomposition & Subgoal Planning\nHeuristic Generation',
  57: 'Notes: AIPlanning4EU Project\nClassical Planning 61\nhttps://github.com/aiplan4eu/unified-planning\nMaking planning applicable for everyone',
  58: 'Notes: The PANDA Framework\n• Planning and Acting in a Network Decomposition Architecture\n• PANDApss, PANDApro, PANDAtotSAT\n• Winner in HTN categories at IPC 2023',
};

const V4_PAGES = range(1, 58);

/** Where the slides belong, read by hand off the deck. */
const V4_TARGET: Record<string, number[]> = {
  Opening: [1, 2, 8, 9],
  'Classical planning in PDDL': range(3, 7),
  'Heuristics for search-based planning': range(10, 19),
  'State abstraction and goal decomposition': range(20, 25),
  'Hierarchical planning and HLAs': range(26, 33),
  'Reachable sets and approximations': range(34, 43),
  'LLM-assisted planning': [...range(44, 51), 56],
  'Next: planning under uncertainty': [52, 53],
  'Earlier notes': [],
  'Other slides': [54, 55, 57, 58],
};

const v4 = (extra: Partial<SlideGroupsInput> = {}): SlideGroupsInput => ({
  doc: v4Doc(),
  pages: V4_PAGES,
  pageText: (page) => V4_TEXT[page],
  ...extra,
});

describe('slideGroups on the v4.0 lecture', () => {
  it('matches the hand-read allocation, every page in exactly one group', () => {
    const groups = slideGroups(v4());
    expectPartition(groups, V4_PAGES);
    expect(byTitle(groups)).toEqual(V4_TARGET);
    expect(groups.map((g) => g.key)).toEqual([OPENING_KEY, 'b_pddl', 'b_heur', 'b_abs', 'b_hier', 'b_reach', 'b_llm', 'b_next', 'b_earlier', OTHER_KEY]);
  });

  it('puts p. 41 with Reachable sets, not with the learner paragraphs that paste every objective page', () => {
    expect(groupOf(slideGroups(v4()), 41)).toBe('Reachable sets and approximations');
  });

  it('sends each section divider to the section it opens, and the slides after it too', () => {
    const placements = new Map(slidePlacements(v4()).map((pl) => [pl.page, pl]));
    expect(placements.get(10)).toMatchObject({ key: 'b_heur', why: 'divider' });
    expect(placements.get(20)).toMatchObject({ key: 'b_abs', why: 'divider' });
    expect(placements.get(26)).toMatchObject({ key: 'b_hier', why: 'divider' });
    expect(placements.get(27)).toMatchObject({ key: 'b_hier', why: 'divider' });
    expect(placements.get(34)).toMatchObject({ key: 'b_reach', why: 'divider' });
    expect(placements.get(35)).toMatchObject({ key: 'b_reach', why: 'divider' });
    // The summary before a divider closes the section it summarises.
    expect(placements.get(19)).toMatchObject({ key: 'b_heur', why: 'before-divider' });
  });

  it('keeps the title, the objectives list and the agenda out of the sections', () => {
    const placements = new Map(slidePlacements(v4()).map((pl) => [pl.page, pl]));
    expect(placements.get(9)).toMatchObject({ key: OPENING_KEY, why: 'agenda' });
    expect(placements.get(8)).toMatchObject({ key: OPENING_KEY, why: 'cited' });
    // The lede also cites p. 52, but the "Next" section's own frame cites it more.
    expect(placements.get(52)).toMatchObject({ key: 'b_next', why: 'cited' });
  });

  it('does not let a Q block under the wrong section, or Ellie\'s table rows, move a slide', () => {
    const groups = slideGroups(v4());
    expect(groupOf(groups, 28)).toBe('Hierarchical planning and HLAs');
    expect(groupOf(groups, 31)).toBe('Hierarchical planning and HLAs');
    expect(groupOf(groups, 46)).toBe('LLM-assisted planning');
    expect(groupOf(groups, 54)).toBe('Other slides');
  });

  it('treats References and Appendix as back matter, and the appendix tools after them as other', () => {
    const placements = new Map(slidePlacements(v4()).map((pl) => [pl.page, pl]));
    expect(placements.get(54)).toMatchObject({ key: OTHER_KEY, why: 'back-matter' });
    expect(placements.get(55)).toMatchObject({ key: OTHER_KEY, why: 'back-matter' });
    expect(placements.get(57)).toMatchObject({ key: OTHER_KEY, why: 'tail' });
    expect(placements.get(56)).toMatchObject({ key: 'b_llm', why: 'cited' });
  });

  it('returns the carried-over section empty: it is weak and swallows nothing', () => {
    const earlier = slideGroups(v4()).find((g) => g.key === 'b_earlier')!;
    expect(earlier.pages).toEqual([]);
    expect(earlier.lastBlockId).toBe('b_earlier_p');
  });

  it('names where each strip is drawn: a section\'s last block, null for the two synthetic groups', () => {
    const groups = slideGroups(v4());
    const last = Object.fromEntries(groups.map((g) => [g.key, g.lastBlockId]));
    expect(last.b_pddl).toBe('b_pddl_s');
    expect(last.b_heur).toBe('b_heur_tab');
    expect(last.b_reach).toBe('b_reach_q');
    expect(last.b_next).toBe('b_next_s');
    expect(last[OPENING_KEY]).toBeNull();
    expect(last[OTHER_KEY]).toBeNull();
    expect(groups.find((g) => g.key === 'b_hier')!.headingBlockId).toBe('b_hier');
    expect(groups.find((g) => g.key === OPENING_KEY)!.headingBlockId).toBeNull();
  });

  it('still partitions every page on the structural rules alone, without page text', () => {
    const groups = slideGroups(v4({ pageText: undefined }));
    expectPartition(groups, V4_PAGES);
    expect(groupOf(groups, 41)).toBe('Reachable sets and approximations');
    expect(groupOf(groups, 1)).toBe('Opening');
    expect(groupOf(groups, 2)).toBe('Opening');
    expect(groupOf(groups, 14)).toBe('Heuristics for search-based planning');
    expect(groupOf(groups, 37)).toBe('Reachable sets and approximations');
    expect(groupOf(groups, 46)).toBe('LLM-assisted planning');
    // Gaps go forward when nothing says otherwise: the divider and the slides after it.
    expect(groupOf(groups, 26)).toBe('Hierarchical planning and HLAs');
    expect(groupOf(groups, 34)).toBe('Reachable sets and approximations');
    expect(groupOf(groups, 57)).toBe('Other slides');
    expect(groupOf(groups, 58)).toBe('Other slides');
  });

  it('is deterministic, and indifferent to the order and duplicates of the pages it is given', () => {
    const a = slideGroups(v4());
    const b = slideGroups(v4({ pages: [...V4_PAGES].reverse().concat([5, 5, 0, -1, 2.5]) }));
    expect(b).toEqual(a);
  });
});

describe('slideGroups: votes', () => {
  const pages = range(1, 10);

  it('ignores the title and the objectives list, which cite everything', () => {
    const doc = docOf(
      h('t', 1, 'Lecture', [], 'title'),
      objectives('o', pages),
      h('a', 2, 'Alpha', [2, 3]),
      h('b', 2, 'Beta', [6, 7]),
    );
    const groups = slideGroups({ doc, pages });
    expectPartition(groups, pages);
    expect(byTitle(groups)).toEqual({ Opening: [1], Alpha: [2, 3], Beta: [4, 5, 6, 7], 'Other slides': [8, 9, 10] });
  });

  it('gives a page cited by two sections to the one whose frame cites it more', () => {
    const doc = docOf(
      h('a', 2, 'Alpha', [1, 2, 3]),
      p('a_t', 'Alpha takeaway', [1, 2, 3]),
      h('b', 2, 'Beta', [4, 5]),
      idea('b_i', 'Beta idea', [3]),
    );
    expect(groupOf(slideGroups({ doc, pages: range(1, 5) }), 3)).toBe('Alpha');
  });

  it('breaks a frame tie with the blocks added since, then with the section\'s run, then by order', () => {
    const base = (extra: J[]): Node =>
      docOf(h('a', 2, 'Alpha', [1, 2]), idea('a_i', 'x', [5]), ...extra.slice(0, 1), h('b', 2, 'Beta', [7, 8]), idea('b_i', 'y', [5]), ...extra.slice(1));
    // Equal frame votes on p. 5, nothing else: the earlier section.
    expect(groupOf(slideGroups({ doc: base([]), pages: range(1, 8) }), 5)).toBe('Alpha');
    // Ellie's figure of p. 5 under Beta breaks the tie.
    expect(groupOf(slideGroups({ doc: base([p('a_x', '', []), figure('b_f', 5)]), pages: range(1, 8) }), 5)).toBe('Beta');
    // A run that contains the page breaks it too: Beta's heading spans 4..8.
    const doc = docOf(h('a', 2, 'Alpha', [1, 2]), idea('a_i', 'x', [5]), h('b', 2, 'Beta', [4, 8]), idea('b_i', 'y', [5]));
    expect(groupOf(slideGroups({ doc, pages: range(1, 8) }), 5)).toBe('Beta');
  });

  it('lets learner blocks, Q blocks and figures place a slide only when the deck order does not', () => {
    const doc = docOf(
      h('a', 2, 'Alpha', [1, 2, 3]),
      h('b', 2, 'Beta', [4, 5, 6]),
      qBlock('b_q', [2]),
      figure('b_f', 9),
      p('b_u', 'my note', [10], 'user'),
    );
    const groups = slideGroups({ doc, pages: range(1, 10) });
    expect(groupOf(groups, 2)).toBe('Alpha');
    // After the last anchored page the deck order says "other"; the learner's figure and note say Beta.
    expect(groupOf(groups, 9)).toBe('Beta');
    expect(groupOf(groups, 10)).toBe('Beta');
    expect(groupOf(groups, 7)).toBe('Other slides');
  });

  it('dilutes a block that cites a long list of pages', () => {
    // The learner's pasted paragraph under Beta cites all twenty pages; Beta's own frame cites 11..13.
    const doc = docOf(
      h('a', 2, 'Alpha', [1, 2, 3]),
      h('b', 2, 'Beta', [11, 12, 13]),
      p('b_u', 'pasted', range(1, 20), 'user'),
    );
    const groups = slideGroups({ doc, pages: range(1, 20) });
    expect(groupOf(groups, 2)).toBe('Alpha');
    expect(groupOf(groups, 18)).toBe('Beta');
  });

  it('seeds the opening from the lede, but not inside a section\'s run', () => {
    const doc = docOf(
      h('t', 1, 'Lecture', [], 'title'),
      p('lede', 'In brief.', [1, 2, 6]),
      h('a', 2, 'Alpha', [4, 8]),
    );
    const groups = slideGroups({ doc, pages: range(1, 8) });
    // p. 3 is a gap between the opening and Alpha: with no text, it goes forward.
    expect(byTitle(groups)).toEqual({ Opening: [1, 2], Alpha: [3, 4, 5, 6, 7, 8] });
  });

  it('never lets a weak section take a page a real section anchors or the deck order places', () => {
    const doc = docOf(
      h('a', 2, 'Alpha', [1, 2, 3]),
      h('b', 2, 'Beta', [5, 6]),
      h('mine', 2, 'My own section', []),
      idea('mine_i', 'mine', [2, 4, 8]),
      h('e', 2, 'Earlier notes', [], EARLIER_NOTES_REASON),
      p('e_p', 'kept', [6], 'user'),
    );
    const groups = slideGroups({ doc, pages: range(1, 8) });
    // p. 4 is in the gap before Beta, p. 7 after the last anchored page; only p. 8 is cited by
    // nothing but the weak section, so only p. 8 is its.
    expect(byTitle(groups)).toEqual({ Alpha: [1, 2, 3], Beta: [4, 5, 6], 'My own section': [8], 'Earlier notes': [], 'Other slides': [7] });
  });

  it('groups by H1 when a doc has no H2 at all, the first H1 being its title', () => {
    const doc = docOf(h('t', 1, 'Lecture', [1]), h('a', 1, 'Alpha', [2, 3]), h('b', 1, 'Beta', [5, 6]));
    expect(byTitle(slideGroups({ doc, pages: range(1, 6) }))).toEqual({ Opening: [1], Alpha: [2, 3], Beta: [4, 5, 6] });
  });

  it('puts everything in "Other slides" when nothing in the doc cites a page', () => {
    const doc = docOf(h('t', 1, 'Lecture', [], 'title'), p('x', '', []));
    expect(slideGroups({ doc, pages: range(1, 3) })).toEqual([
      { key: OTHER_KEY, title: 'Other slides', headingBlockId: null, lastBlockId: null, pages: [1, 2, 3], moved: [] },
    ]);
  });
});

describe('slideGroups: page text', () => {
  const doc = (): Node =>
    docOf(
      h('t', 1, 'Search', [], 'title'),
      h('a', 2, 'Uninformed search', [2, 3]),
      p('a_t', 'Breadth-first and depth-first search expand nodes blindly.', [2, 3]),
      h('b', 2, 'Informed search', [6, 7]),
      p('b_t', 'Heuristics guide greedy and A* search towards the goal.', [6, 7]),
      h('n', 2, 'What comes next', [8]),
      p('n_t', 'Adversarial games, then the homework on minimax.', [8]),
    );
  const deck: Record<number, string> = {
    1: 'Search\nCS1234 Lecture 3',
    2: 'Breadth-first search\nExpand the shallowest node first\nQueue frontier',
    3: 'Depth-first search\nExpand the deepest node first\nStack frontier',
    4: 'Comparing blind strategies\nBreadth-first is complete; depth-first saves memory',
    5: 'Greedy best-first search\nExpand the node the heuristic ranks closest to the goal',
    6: 'Heuristics\nAdmissible heuristics never overestimate',
    7: 'A* search\nf = g + h with an admissible heuristic',
    8: 'Next week: adversarial games\nMinimax and alpha-beta',
    9: 'Homework\nMinimax exercises from the games chapter, alpha-beta pruning',
    10: 'References\nRussell and Norvig, chapter 3',
    11: 'Thank you',
  };

  it('splits a gap with no divider where each side reads like its neighbour', () => {
    const groups = slideGroups({ doc: doc(), pages: range(1, 11), pageText: (pg) => deck[pg] });
    expect(groupOf(groups, 4)).toBe('Uninformed search');
    expect(groupOf(groups, 5)).toBe('Informed search');
  });

  it('keeps homework with the section that names it, and the rest of the back matter as other', () => {
    const placements = new Map(slidePlacements({ doc: doc(), pages: range(1, 11), pageText: (pg) => deck[pg] }).map((pl) => [pl.page, pl]));
    expect(placements.get(9)).toMatchObject({ key: 'n', why: 'text' });
    expect(placements.get(10)).toMatchObject({ key: OTHER_KEY, why: 'back-matter' });
    expect(placements.get(11)).toMatchObject({ key: OTHER_KEY, why: 'back-matter' });
  });

  it('treats a line on most pages as furniture, not as a slide\'s words', () => {
    const footer = (body: string, n: number): string => `${body}\nCS1234 Search and Planning ${n}`;
    const doc2 = docOf(h('a', 2, 'Alpha', [1, 2]), h('b', 2, 'Beta', [5, 6]));
    const text: Record<number, string> = {
      1: footer('Alpha one\nlots of alpha words here today, enough to be a real slide', 1),
      2: footer('Alpha two\nmore alpha words here again, enough to be a real slide', 2),
      3: footer('Alpha three\nstill more alpha words written here, enough to be a real slide', 3),
      // Without the footer stripped this would be nine words, too many for a divider.
      4: footer('Beta begins\nThe second part', 4),
      5: footer('Beta one\nlots of beta words here today, enough to be a real slide', 5),
      6: footer('Beta two\nmore beta words here again, enough to be a real slide', 6),
    };
    const placements = new Map(slidePlacements({ doc: doc2, pages: range(1, 6), pageText: (pg) => text[pg] }).map((pl) => [pl.page, pl]));
    expect(placements.get(3)).toMatchObject({ key: 'a', why: 'before-divider' });
    expect(placements.get(4)).toMatchObject({ key: 'b', why: 'divider' });
  });

  it('keeps an agenda in the opening even when the first section cites it', () => {
    const doc3 = docOf(h('a', 2, 'Alpha', [2, 3, 4]), h('b', 2, 'Beta', [5, 6]));
    const text: Record<number, string> = { 2: 'Outline\n• Alpha\n• Beta', 3: 'Alpha in full', 4: 'Alpha again' };
    const groups = slideGroups({ doc: doc3, pages: range(1, 6), pageText: (pg) => text[pg] });
    expect(byTitle(groups)).toEqual({ Opening: [1, 2], Alpha: [3, 4], Beta: [5, 6] });
  });

  it('groups a notebook\'s pages as given, gaps and text sources included', () => {
    // Two sources: a deck at 1..6, a Markdown file at 21..23 (a removed source left 7..20 a gap).
    const nb = docOf(
      h('a', 2, 'Alpha', [1, 2, 3]),
      h('b', 2, 'Beta', [4, 5, 6]),
      h('c', 2, 'Reading', [22]),
    );
    const pages = [...range(1, 6), 21, 22, 23];
    const groups = slideGroups({ doc: nb, pages, pageText: (pg) => (pg > 20 ? `Prose paragraph ${pg} of the reading` : null) });
    expectPartition(groups, pages);
    // p. 21 opens the second source, a short page in the gap before Reading's: it goes forward.
    expect(byTitle(groups)).toEqual({ Alpha: [1, 2, 3], Beta: [4, 5, 6], Reading: [21, 22], 'Other slides': [23] });
  });
});

describe('slideGroups: overrides', () => {
  const doc = (ids = { a: 'a', b: 'b' }): Node =>
    docOf(h(ids.a, 2, 'Alpha', [1, 2, 3]), h(ids.b, 2, 'Beta', [4, 5, 6]));
  const pages = range(1, 8);

  it('moves a page to the section its heading id names, and reports it as moved', () => {
    const groups = slideGroups({ doc: doc(), pages, overrides: [{ page: 2, key: 'b', title: 'Beta' }] });
    expectPartition(groups, pages);
    expect(groups.find((g) => g.key === 'b')).toMatchObject({ pages: [2, 4, 5, 6], moved: [2] });
    expect(groups.find((g) => g.key === 'a')).toMatchObject({ pages: [1, 3], moved: [] });
  });

  it('finds the section by its heading text when the overview was regenerated with new ids', () => {
    const groups = slideGroups({ doc: doc({ a: 'a2', b: 'b2' }), pages, overrides: [{ page: 2, key: 'b', title: 'Beta' }] });
    expect(groups.find((g) => g.key === 'b2')).toMatchObject({ pages: [2, 4, 5, 6], moved: [2] });
  });

  it('ignores an override whose section is gone, or whose page is not in the deck', () => {
    const overrides = [
      { page: 2, key: 'zzz', title: 'Gamma' },
      { page: 99, key: 'a', title: 'Alpha' },
    ];
    expect(slideGroups({ doc: doc(), pages, overrides })).toEqual(slideGroups({ doc: doc(), pages }));
  });

  it('can always move a page to the opening or to "Other slides", creating the group if need be', () => {
    const groups = slideGroups({
      doc: doc(),
      pages,
      overrides: [
        { page: 3, key: OPENING_KEY, title: '' },
        { page: 7, key: 'a', title: 'Alpha' },
        { page: 4, key: OTHER_KEY, title: '' },
      ],
    });
    expectPartition(groups, pages);
    expect(byTitle(groups)).toEqual({ Opening: [3], Alpha: [1, 2, 7], Beta: [5, 6], 'Other slides': [4, 8] });
    expect(groups.find((g) => g.key === OTHER_KEY)!.moved).toEqual([4]);
  });

  it('can move a slide into an empty section', () => {
    const d = docOf(h('a', 2, 'Alpha', [1, 2]), h('e', 2, 'Earlier notes', [], EARLIER_NOTES_REASON));
    const groups = slideGroups({ doc: d, pages: [1, 2], overrides: [{ page: 2, key: 'e', title: 'Earlier notes' }] });
    expect(byTitle(groups)).toEqual({ Alpha: [1], 'Earlier notes': [2] });
  });
});
