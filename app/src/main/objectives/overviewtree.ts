/**
 * **A notebook's objective tree is the overview's objectives** (`docs/research/notebooks.md`
 * §3.1, contract C5; #58).
 *
 * "By the end you can" lists four to six objectives, and §3.1 says they *are* the objective
 * tree's top level, so the progress bar keeps its meaning. The overview call writes them (title,
 * statement, criteria, quiz seeds, notebook pages); this turns them into the notebook's
 * `LearningTree` through the same `repairTree` every other tree goes through, with its notebook
 * rules: flat (depth 1), the overview's own cap instead of §3's 6–20, the model's order kept. The
 * ids are minted exactly as for a deck, `sha1(content key + title)`, with the notebook's content
 * key, so an Update overview that keeps an objective's title keeps its progress (`pruneStates`
 * drops only what no longer exists).
 *
 * The whole-deck objective ingest never runs for a notebook (`ingest.ts` refuses one).
 */
import type { LearningObjective } from '../../shared/objectives.js';
import type { LearningTreeRecord } from '../db/repos/objectives.js';
import { repairTree, type RawObjective, type RepairNotes } from './repair.js';

/**
 * The tree's prompt version for a notebook: the overview's. Stored in `learning_trees.
 * prompt_version`, where nothing re-reads it to decide on a re-ingest (only `treeIsCurrent` does,
 * and it is never asked about a notebook).
 */
export const NOTEBOOK_TREE_VERSION = 1;

export interface OverviewObjectiveInput {
  title: string;
  statement: string;
  criteria: readonly string[];
  quizSeeds: readonly string[];
  /** Notebook pages. */
  pages: readonly number[];
}

export function objectivesFromOverview(input: {
  notebookId: string;
  contentKey: string;
  pageCount: number;
  objectives: readonly OverviewObjectiveInput[];
  maxObjectives: number;
}): { objectives: LearningObjective[]; notes: RepairNotes } {
  const raw: RawObjective[] = input.objectives.map((o, i) => ({
    key: `o${i + 1}`,
    title: o.title,
    kind: 'objective',
    statement: o.statement,
    criteria: [...o.criteria],
    quiz_seeds: [...o.quizSeeds],
    refs: o.pages.map((page) => ({ page })),
  }));
  return repairTree({
    fileId: input.notebookId,
    contentSha: input.contentKey,
    raw,
    pageCount: input.pageCount,
    notebook: { maxObjectives: input.maxObjectives },
  });
}

/** The row `ObjectivesRepo.upsertTree` stores for a notebook's ready tree. */
export function notebookTreeRecord(input: {
  notebookId: string;
  contentKey: string;
  model: string;
  generatedAt: string;
  objectives: LearningObjective[];
}): LearningTreeRecord {
  return {
    fileId: input.notebookId,
    contentSha: input.contentKey,
    promptVersion: NOTEBOOK_TREE_VERSION,
    model: input.model,
    status: 'ready',
    generatedAt: input.generatedAt,
    error: null,
    objectives: input.objectives,
  };
}
