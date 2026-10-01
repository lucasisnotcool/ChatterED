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
import type { LearningObjective, LearningObjectiveState } from '../../shared/objectives.js';
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

/** One learner state an Update overview carries from an objective that is gone to its successor. */
export interface StateCarry {
  from: LearningObjectiveState;
  toId: string;
}

/**
 * **Progress survives an Update overview** (§2, §7). An update rewrites the objectives, and an
 * objective whose title the model words differently gets a new id (`sha1(content key + title)`),
 * so `pruneStates` dropped the learner's progress on it: in the live run of 1 Oct 2026 a half
 * fill earned by answering Max in their own words went back to zero when a second source was
 * added and the overview updated (`states_dropped: 2`). The learner's own words are the one
 * thing in the notebook nobody else can write again.
 *
 * So each state that moved (a level, or taught) and whose objective is gone is carried to the
 * new objective that teaches the same pages: the most page overlap (Jaccard over the refs), the
 * earlier objective on a tie, none when no page is shared. An objective with the same id keeps
 * its state already and is not here. Pure; the caller writes the levels and then prunes.
 */
export function carryStates(
  before: readonly LearningObjective[],
  after: readonly LearningObjective[],
  states: readonly LearningObjectiveState[],
): StateCarry[] {
  const keep = new Set(after.map((o) => o.id));
  const pagesOf = (o: LearningObjective): Set<number> => new Set(o.refs.map((r) => r.page));
  const out: StateCarry[] = [];
  for (const state of states) {
    if (keep.has(state.objectiveId)) continue;
    if (state.level === 0 && state.taughtAt === null) continue;
    const old = before.find((o) => o.id === state.objectiveId);
    if (!old) continue;
    const mine = pagesOf(old);
    let best: { id: string; score: number } | null = null;
    for (const candidate of after) {
      const theirs = pagesOf(candidate);
      const shared = [...mine].filter((p) => theirs.has(p)).length;
      if (shared === 0) continue;
      const score = shared / new Set([...mine, ...theirs]).size;
      if (!best || score > best.score) best = { id: candidate.id, score };
    }
    if (best) out.push({ from: state, toId: best.id });
  }
  return out;
}
