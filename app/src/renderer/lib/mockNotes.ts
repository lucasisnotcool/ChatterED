/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING (#48, #58). The fixture **learning overview** the mock
 *  bridge serves, so the editor, the chats, the sources panel and the progress
 *  bar can all be built and looked at under `vite dev`, with no Electron and
 *  no ingest.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **It is not invented material.** Every block is written from *Lecture-complex v4.0*
 * (CS4246/CS5446, "Real World Planning and Acting"), the deck the approved notebooks mockup was
 * built on, and carries the page it came from (`docs/research/notebooks.md` §3.4: provenance is
 * mandatory on every block). The pages are the PDF's own. The overview is short on purpose
 * (§3.2: about 350 words for a 60-page deck), and its one blank is the one p. 24 itself leaves
 * (§3.3, answer B), kept verbatim.
 *
 * **It is in exactly the contract's C6 shape** (`app/docs/NOTEBOOK-CONTRACT.md`), because the
 * editor track builds against it: a title H1 (`reason: 'title'`), a lede, an H3 *By the end you
 * can* and one numbered list (both `reason: 'objectives'`, the list's items the objective titles
 * in tree order, C5), then per section an H2 with its pages, a one-line takeaway, each key idea
 * as its **own** one-item bullet list with its own pages, and an empty paragraph whose `reason` is
 * `NOTE_SLOT_REASON` and whose pages are the section's: the learner's note slot.
 *
 * Inline maths is kept to plain text (h_max, 10⁴⁰⁵): the editor draws `$…$` as a styled mark,
 * not typeset, so TeX source would show as source.
 *
 * **The real functions do the work.** `validateDrafts` gates every written block as the ingest's
 * gate would and `draftsToDocJson` builds the nodes with an author mark on every span; only the
 * note slots are made directly, because an empty paragraph is exactly what the ingest gate
 * rejects and exactly what a slot is. The doc is built **once**, at module load, and every id
 * downstream is read back off it.
 *
 * **Pages are notebook pages** (C1). The fixture notebook's first source, the lecture, sits at
 * `pageBase` 0, so its page *n* is notebook page *n*; the notes and the tutorial sit after it.
 */

import type { Node } from 'prosemirror-model';
import { blocksForPages, docFromJson, newBlockId, notesSchema } from '../../shared/doc/schema.js';
import { draftsToDocJson, validateDrafts } from '../../shared/doc/validate.js';
import {
  NOTE_SLOT_REASON,
  type DocBlockDraft,
  type OverviewMeta,
  type OverviewRecommendation,
  type ProgressObjectiveView,
} from '../../shared/doc/types.js';
import type { NotebookSourceView } from '../../shared/notebook.js';

/** The fixture notebook. Its id is the subject on every notes / chat / progress channel (C2). */
export const MOCK_NOTEBOOK_ID = 'nb_cs4246wk2pln';
/**
 * The id `NotesPane` is opened with. Since #58 that is the **notebook's** id (C2); the old name is
 * kept because the editor's dev harness imports it.
 */
export const MOCK_FILE_ID = MOCK_NOTEBOOK_ID;
export const MOCK_DOC_ID = 'doc_mock_cs4246_planning';
export const MOCK_CONTENT_SHA = `nb:${MOCK_NOTEBOOK_ID}`;
export const MOCK_TITLE = 'Real World Planning and Acting';

/** The lecture itself: 59 pages, the whole of what the overview cites. */
export const MOCK_LECTURE_NAME = 'Lecture-complex v4.0.pdf';
export const MOCK_LECTURE_PAGES = 59;

/**
 * The fixture notebook's sources, as main would report them. Two ticked, one not: the state the
 * mockup opens on (*Using 2 of 3 sources*). The file ids are fixed so a reload is the same page.
 */
export function mockSources(): NotebookSourceView[] {
  const added = '2026-10-01T01:00:00.000Z';
  return [
    {
      fileId: 'f_mock_lecture',
      name: MOCK_LECTURE_NAME,
      kind: 'pdf',
      pageBase: 0,
      pageCount: MOCK_LECTURE_PAGES,
      enabled: true,
      status: 'ready',
      error: null,
      addedAt: added,
      role: 'lecture',
      keyFor: null,
    },
    {
      fileId: 'f_mock_notes',
      name: 'Lecture-complex Notes.pdf',
      kind: 'pdf',
      pageBase: MOCK_LECTURE_PAGES,
      pageCount: 10,
      enabled: true,
      status: 'ready',
      error: null,
      addedAt: added,
      role: 'lecture',
      keyFor: null,
    },
    {
      fileId: 'f_mock_tutorial',
      name: 'CSXX46_AY2627_1_Week3_Tutorial1_Real_World_Planning_and_Acting_Students.pdf',
      kind: 'pdf',
      pageBase: MOCK_LECTURE_PAGES + 10,
      pageCount: 4,
      enabled: false,
      status: 'ready',
      error: null,
      addedAt: added,
      role: 'tutorial',
      keyFor: null,
    },
  ];
}

/** Notebook pages in use by the fixture notebook: the end of its last source. */
export const MOCK_PAGE_COUNT = MOCK_LECTURE_PAGES + 10 + 4;

/** One timestamp for the fixture's own bookkeeping. */
const WRITTEN_AT = '2026-10-01T01:02:00.000Z';

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const p = (text: string, pages: number[], reason: string | null = null): DocBlockDraft => ({
  kind: 'paragraph',
  text,
  prov: { pages, reason },
});
const h = (level: 1 | 2 | 3, text: string, pages: number[], reason: string | null = null): DocBlockDraft => ({
  kind: 'heading',
  level,
  text,
  prov: { pages, reason },
});
/** A key idea: its own one-item bullet list, so it has its own pages, chip and toolbar (C6). */
const idea = (text: string, pages: number[]): DocBlockDraft => ({ kind: 'bullets', items: [text], prov: { pages, reason: null } });

// ── the objectives (C5): the tree's top level, and the "By the end you can" list ───────────

interface ObjectiveSeed {
  objectiveId: string;
  title: string;
  statement: string;
  criteria: string[];
  pages: number[];
}

/** Five, in tree order. Their titles **are** the numbered list's items, word for word. */
const SEEDS: ObjectiveSeed[] = [
  {
    objectiveId: 'obj-pddl',
    title: 'Model a planning problem in PDDL: domain versus problem',
    statement: 'Say what goes in a PDDL domain and what goes in a problem, using the air cargo example.',
    criteria: ['puts actions with preconditions and effects in the domain', 'puts objects, initial state and goal in the problem'],
    pages: [3, 4, 5],
  },
  {
    objectiveId: 'obj-heuristics',
    title: 'Derive and compare h_max, h_add and h_FF',
    statement: 'Say how each relaxed-problem heuristic is computed, and which of them are admissible.',
    criteria: ['says what ignoring delete effects does', 'says why h_max is admissible and h_FF is not'],
    pages: [16, 17, 18],
  },
  {
    objectiveId: 'obj-abstraction',
    title: 'Use abstraction, decomposition and HTNs to cut search',
    statement: 'Say how abstraction and subgoal decomposition shrink a search, and when Sum(Cost) over- or underestimates.',
    criteria: ['names an abstraction that shrinks the state space', 'says when Sum is exact and when it is not'],
    pages: [22, 23, 24, 28, 33],
  },
  {
    objectiveId: 'obj-reach',
    title: 'Judge a high-level plan with REACH+ and REACH−',
    statement: 'Say what the two reachable sets bound, and what each outcome tells you about a high-level plan.',
    criteria: ['orders REACH−, REACH and REACH+', 'says which test proves success and which proves failure'],
    pages: [41, 42],
  },
  {
    objectiveId: 'obj-llm',
    title: 'Name four ways LLMs assist a symbolic planner',
    statement: 'Name the four roles an LLM plays beside a planner, and what the planner still guarantees.',
    criteria: ['names at least three of the four roles', 'says what the symbolic side supplies'],
    pages: [45, 46, 47, 48, 49, 50],
  },
];

const OBJECTIVE_PAGES = [...new Set(SEEDS.flatMap((s) => s.pages))].sort((a, b) => a - b);

// ── the overview, section by section (§3.1) ─────────────────────────────────────────────────

interface Section {
  heading: string;
  pages: number[];
  takeaway: DocBlockDraft;
  ideas: DocBlockDraft[];
}

const LEDE = p(
  'A classical planner models a problem as states, actions and a goal, written in PDDL, and searches for ' +
    'a plan. This lecture covers how to keep that search tractable: relaxed heuristics, abstraction and ' +
    'decomposition, hierarchy, and now LLMs. Uncertainty comes next week.',
  [1, 3, 52],
);

const SECTIONS: Section[] = [
  {
    heading: 'Classical planning in one page',
    pages: range(3, 7),
    takeaway: p('A plan is a path of actions from the initial state to a goal state.', [3]),
    ideas: [
      idea(
        'PDDL splits a task into a **domain** (predicates, and actions with preconditions and effects) and a ' +
          '**problem** (objects, initial state, goal).',
        [4, 5],
      ),
      idea(
        'Search forward or backward, or encode as SAT. A search planner uses an explicit heuristic *h*(*s*). For a ' +
          'SAT solver, the heuristic is implicit in its branching.',
        [7, 11],
      ),
    ],
  },
  {
    heading: 'Heuristics from relaxed problems',
    pages: range(10, 19),
    takeaway: p('Solve an easier version of the problem, and use its cost as the estimate.', [10, 16]),
    ideas: [
      idea('Relax by ignoring some preconditions, or by ignoring delete effects so that facts never become false.', [16, 17]),
      idea(
        'h_max takes the largest subgoal cost, which is admissible but weak. h_add sums the subgoal costs, ' +
          'which is more informed but not always admissible.',
        [17],
      ),
      idea(
        'h_FF counts the actions in a greedily built relaxed plan. It is inadmissible, and it is the standard ' +
          'choice for greedy best-first search.',
        [18],
      ),
    ],
  },
  {
    heading: 'Abstraction and goal decomposition',
    pages: range(20, 25),
    takeaway: p('Search a smaller problem, or split the goal, and then map the result back.', [20]),
    ideas: [
      idea(
        'Air cargo with 10 airports, 50 planes and 200 cargos has about 10⁴⁰⁵ states. Assuming 5 airports and ' +
          'dropping the irrelevant *At* fluents leaves about 10¹¹.',
        [22],
      ),
      idea(
        'Estimate cost from subgoals: Max is admissible but weak, and Sum is better when subgoals are independent. ' +
          'Positive interactions can make Sum overestimate, and negative ones can make it underestimate.',
        [23],
      ),
      // The deck's own blank (§3.3, answer B): p. 24 leaves both values for the student.
      idea('Blocks A to D start on the table; the goal is A on B and C on D. Max(Cost) = ____ and Sum(Cost) = ____.', [24]),
    ],
  },
  {
    heading: 'Hierarchical planning: HTNs and HLAs',
    pages: range(26, 33),
    takeaway: p(
      'Plan with high-level actions first, then refine them, the way you would plan "go to Changi" before "call a taxi".',
      [26],
    ),
    ideas: [
      idea('`Go(Home, SIN)` refines to `Taxi(Home, SIN)`, which refines to Call-Taxi, Ride and Pay-Taxi.', [28, 32]),
      idea(
        'A flat planner pays O(bᵈ). An HTN planner chooses among *r* refinements per level, and a small *r* with ' +
          'a large *k* is cheaper.',
        [33],
      ),
    ],
  },
  {
    heading: 'Proving a high-level plan works: reachable sets',
    pages: range(34, 43),
    takeaway: p('Reason about what an HLA could reach, without expanding it.', [34]),
    ideas: [
      idea(
        'REACH−(s, h) ⊆ REACH(s, h) ⊆ REACH+(s, h). If REACH+ misses the goal, the plan fails. If REACH− hits it, ' +
          'the plan succeeds. Otherwise, refine.',
        [41, 42],
      ),
    ],
  },
  {
    heading: 'LLM-assisted planning',
    pages: range(44, 51),
    takeaway: p('The LLM supplies commonsense, and the symbolic planner supplies the guarantees.', [44]),
    ideas: [
      idea(
        'There are four roles. An LLM can write PDDL from text and refine it on validator feedback, decompose tasks ' +
          'into subgoals, generate heuristics as code, and write generalised planners.',
        range(45, 50),
      ),
    ],
  },
  {
    heading: 'Next: uncertainty',
    pages: [52],
    takeaway: p(
      'Noisy sensors and stochastic dynamics break the deterministic model. Next come utility theory, MDPs and ' +
        'reinforcement learning.',
      [52],
    ),
    ideas: [],
  },
];

/** The written blocks after the title, in order, with a marker where each note slot goes. */
type Planned = { draft: DocBlockDraft } | { slot: number[] };

function plan(): Planned[] {
  const out: Planned[] = [
    { draft: LEDE },
    { draft: h(3, 'By the end you can', [], 'objectives') },
    { draft: { kind: 'numbers', items: SEEDS.map((s) => s.title), prov: { pages: OBJECTIVE_PAGES, reason: 'objectives' } } },
  ];
  for (const section of SECTIONS) {
    out.push({ draft: h(2, section.heading, section.pages) });
    out.push({ draft: section.takeaway });
    for (const block of section.ideas) out.push({ draft: block });
    out.push({ slot: section.pages });
  }
  return out;
}

/** How many fixture blocks the real validator rejected. Zero, and the test says so. */
let FIXTURE_ISSUES = 0;
export function fixtureIssueCount(): number {
  return FIXTURE_ISSUES;
}

function build() {
  const planned = plan();
  const drafts = planned.flatMap((x) => ('draft' in x ? [x.draft] : []));
  const checked = validateDrafts(drafts, MOCK_PAGE_COUNT);
  FIXTURE_ISSUES = checked.issues.length;
  // The title is `draftsToDocJson`'s own H1 with `reason: 'title'` (C6), exactly as the ingest's.
  const written = docFromJson(draftsToDocJson(MOCK_TITLE, checked.blocks));
  const nodes: Node[] = [];
  written.forEach((node) => nodes.push(node));
  const [title, ...body] = nodes;
  // Splice the note slots back in where the plan put them: one empty paragraph per section.
  const content = [title!];
  let next = 0;
  for (const step of planned) {
    if ('draft' in step) {
      content.push(body[next]!);
      next += 1;
    } else {
      content.push(
        notesSchema.nodes.paragraph!.create({ blockId: newBlockId(), pages: [...step.slot], reason: NOTE_SLOT_REASON, objectiveIds: [] }),
      );
    }
  }
  const doc = notesSchema.nodes.doc!.create(null, content);
  const ids: string[] = [];
  const pagesOf = new Map<string, number[]>();
  const headingIds = new Map<string, string>();
  doc.forEach((node) => {
    const attrs = node.attrs as { blockId?: string; pages?: number[]; level?: number };
    if (!attrs.blockId) return;
    ids.push(attrs.blockId);
    pagesOf.set(attrs.blockId, [...(attrs.pages ?? [])]);
    if (node.type.name === 'heading' && attrs.level === 2) headingIds.set(node.textContent, attrs.blockId);
  });
  return { json: doc.toJSON() as unknown, ids, pagesOf, headingIds, words: doc.textContent.split(/\s+/).filter(Boolean).length };
}

const FIXTURE = build();

/** The fixture document, as ProseMirror JSON for `notesSchema`. */
export function mockNotesJson(): unknown {
  return FIXTURE.json;
}

/**
 * The windows that arrive after the doc opens. **None**: an overview is one call (§3.5), with no
 * per-window notes pass. Kept as an export so the mock's ingest path reads the same either way.
 */
export const MOCK_WINDOWS: readonly DocBlockDraft[][] = [];

/** The last block of the fixture. */
export function mockLastBlockId(): string {
  return FIXTURE.ids.at(-1) ?? '';
}

/**
 * A named handle on one fixture block, for the scripted conversation: the first written block
 * (or the `offset`-th) that cites `page`. Headings, the objectives list and the note slots also
 * cite pages, but an agent's line never goes under them, so they are passed over unless nothing
 * else cites the page.
 */
export function mockBlockOnPage(page: number, offset = 0): string {
  const hits = FIXTURE.ids.filter((id) => (FIXTURE.pagesOf.get(id) ?? []).includes(page));
  const content = hits.filter((id) => !SKIP_IDS.has(id));
  const pool = content.length > 0 ? content : hits;
  return pool[Math.min(offset, Math.max(0, pool.length - 1))] ?? FIXTURE.ids[0] ?? '';
}

/** Blocks a scripted line never anchors to: headings, the objectives list, the note slots. */
const SKIP_IDS = (() => {
  const set = new Set<string>();
  docFromJson(FIXTURE.json).forEach((node) => {
    const attrs = node.attrs as { blockId?: string; reason?: string | null };
    if (!attrs.blockId) return;
    if (node.type.name === 'heading' || attrs.reason === NOTE_SLOT_REASON || attrs.reason === 'objectives') set.add(attrs.blockId);
  });
  return set;
})();

/** The heading of the section a fixture block sits in ("Heuristics from relaxed problems"). */
export function mockSectionOf(blockId: string): string | null {
  let section: string | null = null;
  let found: string | null = null;
  docFromJson(FIXTURE.json).forEach((node) => {
    const attrs = node.attrs as { blockId?: string; level?: number };
    if (node.type.name === 'heading' && attrs.level === 2) section = node.textContent;
    if (attrs.blockId === blockId) found = section;
  });
  return found;
}

/** The pages a fixture block cites, or [] for a block the fixture does not have. */
export function mockPagesOf(blockId: string): number[] {
  return [...(FIXTURE.pagesOf.get(blockId) ?? [])];
}

// ── the overview's metadata (§3, §5.3, §6) ─────────────────────────────────────────────────

/** Ellie's greeting and the three starter questions (§6, answer D), as the mockup shows them. */
export const MOCK_GREETING =
  "I've read both sources. The overview is short on purpose. Hover any line and press Explain, or ask me here. Your own notes go under each section.";

export const MOCK_STARTERS = [
  'Why does ignoring delete effects make a problem easier?',
  'How is goal decomposition different from an HTN?',
  'Where does an LLM fit if the planner already works?',
] as const;

/**
 * The overview's metadata, with two recommended blocks (§5.3, answer E) named by their section's
 * heading id. `fingerprint` is the caller's — the sources live in the mock bridge — and is what
 * the out-of-date banner compares the notebook's current one against.
 */
export function mockOverviewMeta(fingerprint: string): OverviewMeta {
  const recommendations: OverviewRecommendation[] = [
    {
      id: 'rec_mock_heuristics',
      headingBlockId: FIXTURE.headingIds.get('Heuristics from relaxed problems') ?? '',
      kind: 'flashcards',
      title: 'Planning heuristics and abstractions',
      description: 'Active recall cards on h_max, h_add, h_FF and when each one is admissible.',
      status: 'offered',
    },
    {
      id: 'rec_mock_htn',
      headingBlockId: FIXTURE.headingIds.get('Hierarchical planning: HTNs and HLAs') ?? '',
      kind: 'diagram',
      title: 'From Go(Home, SIN) to Pay-Taxi',
      description: 'The refinement hierarchy on p. 28 and p. 32, drawn top-down.',
      status: 'offered',
    },
  ];
  return {
    version: 1,
    fingerprint,
    writtenAt: WRITTEN_AT,
    starterQuestions: [...MOCK_STARTERS],
    greeting: MOCK_GREETING,
    recommendations,
    words: FIXTURE.words,
    wordBudget: 350,
  };
}

// ── the objectives the progress bar draws (brief §6, unchanged) ─────────────────────────────

/**
 * The five objectives, with `blockIds` derived from the document by page intersection — T2's own
 * `blocksForPages`, which is what the main process uses, rather than a second rule here. All
 * start empty: a fresh notebook, the state the mockup opens on (State 1).
 *
 * `doc` is optional: before the learner has saved anything the fixture's own document is the
 * authority, and after a save the mock re-derives from the renderer's copy, so a lesson card's
 * **Start** scrolls to a block that is actually in the editor's document.
 */
export function mockObjectives(docJson: unknown = FIXTURE.json): ProgressObjectiveView[] {
  let doc;
  try {
    doc = docFromJson(docJson);
  } catch {
    doc = docFromJson(FIXTURE.json);
  }
  return SEEDS.map((seed) => ({
    objectiveId: seed.objectiveId,
    title: seed.title,
    statement: seed.statement,
    criteria: seed.criteria,
    pages: seed.pages,
    blockIds: blocksForPages(doc, seed.pages),
    fill: 0,
    level: 0 as 0 | 1 | 2 | 3,
    assumedByDeck: false,
    evidence: null,
    lastMovedAt: null,
  }));
}
