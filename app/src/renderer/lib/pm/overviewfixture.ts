/**
 * **A learning overview to look at and to test against** (contract C6), with its notebook of two
 * sources and a progress view. Used by the editor's tests and the notes dev harness; never by the
 * app. The content follows the mockup the owner approved (CS4246 week 2, planning), cut down.
 *
 * Pages are **notebook pages** (C1): the lecture PDF is pages 1–52 (`pageBase` 0), the Markdown
 * notes are pages 53–55 (`pageBase` 52), so a chip on page 53 reads `Week 2 notes §1`.
 */
import type { NotebookSourceView, NotebookView } from '../../../shared/notebook.js';
import { contextFingerprint } from '../../../shared/notebook.js';
import { NOTE_SLOT_REASON, type OverviewMeta, type ProgressView } from '../../../shared/doc/types.js';

export const FIXTURE_NOTEBOOK_ID = 'nb_0123456789ab';
export const FIXTURE_DOC_ID = 'doc_overview_fixture';

type Json = Record<string, unknown>;

function attrs(blockId: string, pages: number[], reason: string | null = null): Json {
  return { blockId, pages, reason, objectiveIds: [] };
}

function text(value: string): Json[] {
  return value ? [{ type: 'text', text: value, marks: [{ type: 'author', attrs: { by: 'ingest', editId: null, at: 0 } }] }] : [];
}

function heading(blockId: string, level: number, value: string, pages: number[], reason: string | null = null): Json {
  return { type: 'heading', attrs: { ...attrs(blockId, pages, reason), level }, content: text(value) };
}

function para(blockId: string, value: string, pages: number[], reason: string | null = null): Json {
  const node: Json = { type: 'paragraph', attrs: attrs(blockId, pages, reason) };
  const content = text(value);
  if (content.length > 0) node.content = content;
  return node;
}

function item(value: string): Json {
  return { type: 'list_item', attrs: { blockId: '' }, content: [{ type: 'paragraph', attrs: attrs('', []), content: text(value) }] };
}

function idea(blockId: string, value: string, pages: number[]): Json {
  return { type: 'bullet_list', attrs: attrs(blockId, pages), content: [item(value)] };
}

function slot(blockId: string, pages: number[]): Json {
  return para(blockId, '', pages, NOTE_SLOT_REASON);
}

export const FIXTURE_OBJECTIVES = [
  'Model a planning problem in PDDL: domain versus problem',
  'Derive and compare h_max, h_add and h_FF',
  'Use abstraction and decomposition to cut search',
  'Name four ways LLMs assist a symbolic planner',
];

/** The doc, as `NotesDocView.doc` carries it. */
export function fixtureOverviewDoc(): Json {
  return {
    type: 'doc',
    content: [
      heading('b_title', 1, 'Real World Planning and Acting', [], 'title'),
      para(
        'b_lede',
        'A classical planner models a problem as states, actions and a goal, written in PDDL, and searches for a plan. This lecture covers how to keep that search tractable: relaxed heuristics, abstraction, and LLMs.',
        [2, 3],
      ),
      heading('b_obj_h', 3, 'By the end you can', [], 'objectives'),
      {
        type: 'ordered_list',
        attrs: { ...attrs('b_obj', [3, 10, 20, 44], 'objectives'), start: 1 },
        content: FIXTURE_OBJECTIVES.map(item),
      },
      heading('b_s1', 2, 'Classical planning in one page', [3, 4, 5, 6, 7]),
      para('b_s1_take', 'A plan is a path of actions from the initial state to a goal state.', [3]),
      idea(
        'b_s1_i1',
        'PDDL splits a task into a domain (predicates, and actions with preconditions and effects) and a problem (objects, initial state, goal).',
        [4, 5],
      ),
      idea('b_s1_i2', 'Search forward or backward, or encode the task as SAT, where the heuristic is implicit in the branching.', [7, 53]),
      slot('b_s1_note', [3, 4, 5, 6, 7]),
      heading('b_s2', 2, 'Heuristics from relaxed problems', [10, 17, 18]),
      para('b_s2_take', 'Solve an easier version of the problem, and use its cost as the estimate.', [10]),
      idea('b_s2_i1', 'Relax by ignoring delete effects, so that facts never become false.', [16, 17]),
      idea('b_s2_i2', 'h_max takes the largest subgoal cost, which is admissible but weak; h_add sums them, which is not always admissible.', [17]),
      idea('b_s2_i3', 'h_FF counts the actions in a greedily built relaxed plan. It is inadmissible, and the standard choice for greedy best-first search.', [18]),
      slot('b_s2_note', [10, 17, 18]),
      heading('b_s3', 2, 'Abstraction and goal decomposition', [22, 23, 24]),
      para('b_s3_take', 'Search a smaller problem, or split the goal, and then map the result back.', [22]),
      idea('b_s3_i1', 'Max(Cost) = ____ and Sum(Cost) = ____ for two independent subgoals.', [24]),
      slot('b_s3_note', [22, 23, 24]),
    ],
  };
}

function source(partial: Partial<NotebookSourceView> & Pick<NotebookSourceView, 'fileId' | 'name' | 'kind' | 'pageBase' | 'pageCount'>): NotebookSourceView {
  return { enabled: true, status: 'ready', error: null, addedAt: '2026-10-01T09:00:00.000Z', role: 'lecture', keyFor: null, ...partial };
}

/** The notebook: a lecture PDF and a Markdown file, both ticked. */
export function fixtureNotebook(extra: NotebookSourceView[] = []): NotebookView {
  const sources = [
    source({ fileId: 'file_lecture', name: 'Lecture-complex v4.0.pdf', kind: 'pdf', pageBase: 0, pageCount: 52 }),
    source({ fileId: 'file_notes', name: 'Week 2 notes.md', kind: 'text', pageBase: 52, pageCount: 3 }),
    ...extra,
  ];
  return {
    id: FIXTURE_NOTEBOOK_ID,
    name: 'CS4246 · Week 2 Planning',
    sources,
    pageCount: Math.max(...sources.map((s) => s.pageBase + s.pageCount)),
    contextFingerprint: contextFingerprint(sources),
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };
}

/** A third source the learner adds after the overview was written: the out-of-date banner. */
export function fixtureNewSource(): NotebookSourceView {
  return source({ fileId: 'file_reading', name: 'Russell & Norvig ch11.pdf', kind: 'pdf', pageBase: 55, pageCount: 30 });
}

export function fixtureOverviewMeta(): OverviewMeta {
  return {
    version: 1,
    fingerprint: fixtureNotebook().contextFingerprint,
    writtenAt: '2026-10-01T09:05:00.000Z',
    greeting: "I've read both sources. Where would you like to start?",
    starterQuestions: [
      'Why is h_FF inadmissible?',
      'What does ignoring delete effects buy us?',
      'How is a domain different from a problem in PDDL?',
    ],
    recommendations: [
      {
        id: 'rec_s2',
        headingBlockId: 'b_s2',
        kind: 'flashcards',
        title: 'Relaxed-plan heuristics',
        description: 'Active recall cards on h_max, h_add and h_FF: what each counts and whether it is admissible.',
        status: 'offered',
      },
      {
        id: 'rec_s3',
        headingBlockId: 'b_s3',
        kind: 'table',
        title: 'Max versus Sum',
        description: 'When each subgoal estimate is admissible, and how interactions break it.',
        status: 'dismissed',
      },
    ],
    words: 214,
    wordBudget: 350,
  };
}

/** The four objectives, in tree order, one half done and one complete. */
export function fixtureProgress(): ProgressView {
  const fills: (0 | 0.5 | 1)[] = [1, 0.5, 0, 0];
  return {
    fileId: FIXTURE_NOTEBOOK_ID,
    docId: FIXTURE_DOC_ID,
    status: 'ready',
    completed: 1,
    total: 4,
    fraction: 1.5 / 4,
    objectives: FIXTURE_OBJECTIVES.map((title, i) => ({
      objectiveId: `o_${String(i + 1)}`,
      title,
      statement: title,
      criteria: [],
      pages: [],
      blockIds: [],
      fill: fills[i]!,
      level: fills[i] === 1 ? 3 : fills[i] === 0.5 ? 2 : 0,
      assumedByDeck: false,
      evidence: null,
      lastMovedAt: null,
    })),
  };
}

/** The Markdown source's text, cut into its three pages by `paginateText`. */
export const FIXTURE_NOTES_TEXT = [
  '# Week 2 notes\n\nSAT planning encodes the plan as a propositional formula over a fixed horizon. The solver branches on variables, so there is no explicit heuristic, but its variable ordering plays the same role.',
  'Relaxed problems: drop the delete lists and every action only adds facts. The relaxed plan is then easy to find greedily, and its length is h_FF.',
  'Decomposition: Max(Cost) is admissible; Sum(Cost) is exact only when the subgoals do not interact.',
].join('\n\n');
