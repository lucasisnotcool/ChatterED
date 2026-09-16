/**
 * The learning-objective repository (issue #38, migration 016).
 *
 * Two tables, one file at a time: the tree as the ingest produced it, and one state row per
 * objective the learner has moved. A file with a tree and no state rows is a deck nobody has
 * explained anything about yet, and `states()` returns nothing rather than twenty zeroes — the
 * panel reads a missing row as level 0 (`learning-objectives.md` §2), which keeps the common
 * case free and means a Reset is a DELETE rather than twenty UPDATEs.
 *
 * Everything here is synchronous and does no policy. **What a level means is the ledger's**, and
 * `setLevel` is called from `applyLedgerRules`' own output and from nowhere else; this file
 * decides only where the number is written.
 */
import type { SqlDatabase } from '../driver.js';
import { plain, plainAll } from '../sql.js';
import type {
  LearningObjective,
  LearningObjectiveState,
  LearningTree,
  LearningTreeStatus,
  ObjectiveLevel,
} from '../../../shared/objectives.js';

/** What the ingest hands the repository. `objectives` is empty while the status is `pending`. */
export interface LearningTreeRecord {
  fileId: string;
  contentSha: string;
  promptVersion: number;
  model: string;
  status: LearningTreeStatus;
  generatedAt: string | null;
  error: string | null;
  objectives: LearningObjective[];
}

interface TreeRow {
  file_id: string;
  content_sha: string;
  prompt_version: number;
  model: string;
  status: LearningTreeStatus;
  generated_at: string | null;
  error: string | null;
  json: string;
  created_at: string;
  updated_at: string;
}

interface StateRow {
  objective_id: string;
  file_id: string;
  level: number;
  evidence_message_ids: string;
  last_moved_at: string | null;
  taught_at: string | null;
}

export interface SetLevelInput {
  fileId: string;
  objectiveId: string;
  level: ObjectiveLevel;
  /** The learner's own message ids, appended to whatever is already there, de-duplicated. */
  evidenceMessageIds?: readonly string[];
  movedAt: string;
}

export interface ObjectivesRepo {
  /** The file's tree, or null when no ingest has ever been asked for this file. */
  tree(fileId: string): LearningTree | null;
  /** Insert or replace it, keeping `created_at` from the row that was already there. */
  upsertTree(record: LearningTreeRecord, now: string): LearningTree;
  /** Only the states that exist. A missing row is level 0 and is not invented here. */
  states(fileId: string): LearningObjectiveState[];
  state(fileId: string, objectiveId: string): LearningObjectiveState | null;
  /** Writes a level and its evidence. Returns the row as it now stands, for the event. */
  setLevel(input: SetLevelInput): LearningObjectiveState;
  /** The Teacher taught this objective (§4). Creates the row if the learner never moved it. */
  markTaught(input: { fileId: string; objectiveId: string; at: string }): LearningObjectiveState;
  /** §4's Reset: every state to 0, evidence and `taughtAt` cleared. The tree stays. */
  reset(fileId: string): number;
  /**
   * Regenerate's half of §3 — "keeps the old states where ids still match". Anything whose id
   * is not in the new tree is dropped, because it is about an objective that no longer exists.
   */
  pruneStates(fileId: string, keep: readonly string[]): number;
}

function parseObjectives(json: string): LearningObjective[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as LearningObjective[]) : [];
  } catch {
    // A tree whose json will not parse is a tree that has to be generated again, not a crash on
    // the way to drawing the panel.
    return [];
  }
}

function parseIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toState(row: StateRow): LearningObjectiveState {
  return {
    objectiveId: row.objective_id,
    fileId: row.file_id,
    level: Math.max(0, Math.min(3, row.level)) as ObjectiveLevel,
    evidenceMessageIds: parseIds(row.evidence_message_ids),
    lastMovedAt: row.last_moved_at,
    taughtAt: row.taught_at,
  };
}

function toTree(row: TreeRow): LearningTree {
  const tree: LearningTree = {
    fileId: row.file_id,
    contentSha: row.content_sha,
    // A `pending` tree has not been generated; it still has to carry a timestamp the panel can
    // show, and the moment the ingest started is the honest one.
    generatedAt: row.generated_at ?? row.created_at,
    model: row.model,
    version: row.prompt_version,
    objectives: parseObjectives(row.json),
    status: row.status,
  };
  if (row.error !== null) tree.error = row.error;
  return tree;
}

export function objectivesRepo(db: SqlDatabase): ObjectivesRepo {
  const readState = (fileId: string, objectiveId: string): StateRow | undefined =>
    plain(
      db
        .prepare('SELECT * FROM learning_objective_states WHERE file_id = @f AND objective_id = @o')
        .get<StateRow>({ f: fileId, o: objectiveId }),
    );

  const ensureRow = (fileId: string, objectiveId: string): StateRow => {
    const existing = readState(fileId, objectiveId);
    if (existing) return existing;
    db.prepare(
      `INSERT INTO learning_objective_states (objective_id, file_id, level, evidence_message_ids)
       VALUES (@o, @f, 0, '[]')`,
    ).run({ o: objectiveId, f: fileId });
    return readState(fileId, objectiveId)!;
  };

  return {
    tree(fileId) {
      const row = plain(
        db.prepare('SELECT * FROM learning_trees WHERE file_id = @f').get<TreeRow>({ f: fileId }),
      );
      return row ? toTree(row) : null;
    },

    upsertTree(record, now) {
      db.prepare(
        `INSERT INTO learning_trees
           (file_id, content_sha, prompt_version, model, status, generated_at, error, json,
            created_at, updated_at)
         VALUES (@file, @sha, @version, @model, @status, @generated, @error, @json, @now, @now)
         ON CONFLICT (file_id) DO UPDATE SET
           content_sha = @sha, prompt_version = @version, model = @model, status = @status,
           generated_at = @generated, error = @error, json = @json, updated_at = @now`,
      ).run({
        file: record.fileId,
        sha: record.contentSha,
        version: record.promptVersion,
        model: record.model,
        status: record.status,
        generated: record.generatedAt,
        error: record.error,
        json: JSON.stringify(record.objectives),
        now,
      });
      return this.tree(record.fileId)!;
    },

    states(fileId) {
      return plainAll(
        db
          .prepare('SELECT * FROM learning_objective_states WHERE file_id = @f ORDER BY objective_id')
          .all<StateRow>({ f: fileId }),
      ).map(toState);
    },

    state(fileId, objectiveId) {
      const row = readState(fileId, objectiveId);
      return row ? toState(row) : null;
    },

    setLevel(input) {
      const before = ensureRow(input.fileId, input.objectiveId);
      // Append, never replace: the evidence is the list of the learner's own messages that have
      // moved this node, and a level 3 that threw away the sentence that earned level 2 would
      // make the hover card lie about what was said.
      const ids = [...new Set([...parseIds(before.evidence_message_ids), ...(input.evidenceMessageIds ?? [])])];
      db.prepare(
        `UPDATE learning_objective_states
            SET level = @level, evidence_message_ids = @ids, last_moved_at = @at
          WHERE file_id = @f AND objective_id = @o`,
      ).run({ level: input.level, ids: JSON.stringify(ids), at: input.movedAt, f: input.fileId, o: input.objectiveId });
      return toState(readState(input.fileId, input.objectiveId)!);
    },

    markTaught(input) {
      ensureRow(input.fileId, input.objectiveId);
      db.prepare(
        'UPDATE learning_objective_states SET taught_at = @at WHERE file_id = @f AND objective_id = @o',
      ).run({ at: input.at, f: input.fileId, o: input.objectiveId });
      return toState(readState(input.fileId, input.objectiveId)!);
    },

    reset(fileId) {
      // A DELETE, not twenty UPDATEs to zero: a missing row *is* level 0 everywhere that reads
      // one, so this leaves exactly the state a deck that has never been explained is in.
      return db.prepare('DELETE FROM learning_objective_states WHERE file_id = @f').run({ f: fileId }).changes;
    },

    pruneStates(fileId, keep) {
      const kept = new Set(keep);
      let dropped = 0;
      for (const row of plainAll(
        db
          .prepare('SELECT objective_id FROM learning_objective_states WHERE file_id = @f')
          .all<{ objective_id: string }>({ f: fileId }),
      )) {
        if (kept.has(row.objective_id)) continue;
        db.prepare(
          'DELETE FROM learning_objective_states WHERE file_id = @f AND objective_id = @o',
        ).run({ f: fileId, o: row.objective_id });
        dropped += 1;
      }
      return dropped;
    },
  };
}
