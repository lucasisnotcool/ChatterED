/**
 * **A re-minted file id adopts what its predecessor left behind** (issue #39).
 *
 * `files.sync` keys a file on `(vault_id, rel_path)`, so the same bytes get a fresh `files.id`
 * whenever the file is renamed or moved (a change of case included), is missing for one scan (an
 * iCloud eviction, an atomic save), or the vault is reopened under a different root string
 * (`vaults.byPath` is an exact match, so a second vault is made and every file in it is new).
 * Everything keyed on the bytes survives that — `notes_docs`, `quiz_outcomes`,
 * `file_segmentations` — but four things are keyed on the id, and without this they are
 * stranded under an id nothing will ask for again:
 *
 *  - `materials.file_id`: `materials.forFile(fileId, sha)` is how a deck's room is reopened, so
 *    a miss is a **second room** (`openOrCreateFlowRoom`, and the doc chat's `roomFor`).
 *  - `learning_trees` (PK `file_id`, migration 016): the objective tree, regenerated at LLM cost.
 *  - `learning_objective_states` (PK `(file_id, objective_id)`): the learner's progress.
 *  - `llm_usage.file_id` (017): the file-level cost view reads it and nothing else.
 *
 * `notes_docs.file_id` and `file_segmentations.file_id` are provenance on sha-keyed rows; they
 * are re-pointed too, so "the newest id these bytes were seen at" stays true. `message_refs`
 * is not: it records what the learner showed a room at the time, and the transcript outlives
 * the file on purpose (006).
 *
 * **Only orphans are adopted.** An id is an orphan when it is not a file of *this* vault any
 * more — deleted by a rescan, or left behind in the vault a different root string made. A live
 * id in this vault is never touched, which is what keeps two copies of one deck in two folders
 * two documents (the reason `forFile` is keyed on both halves). And when this vault already
 * knows a second file with these bytes, nothing is adopted at all: which of the two the orphan
 * was is not knowable, and guessing would merge them.
 *
 * Called from two places, because the bytes of a file id become known at two moments:
 * `files.markIndexed` (the background indexer, which covers a file nobody opens) and
 * `SegmentService.#ensure` (every open, which can run before the indexer reaches a moved file —
 * and is the path that would otherwise mint the second room and regenerate the tree).
 */
import type { SqlDatabase } from '../db/driver.js';
import { MANAGED_VAULT_ID } from './managed.js';

export interface Adoption {
  /** The orphaned ids whose rows now belong to `fileId`. Empty when there was nothing to do. */
  from: string[];
  materials: number;
  usage: number;
  /** Whose tree `fileId` ended up with. `none` when no side had a tree for these bytes. */
  tree: 'adopted' | 'kept' | 'none';
  states: number;
}

const NOTHING: Adoption = { from: [], materials: 0, usage: 0, tree: 'none', states: 0 };

interface StateRow {
  objective_id: string;
  file_id: string;
  level: number;
  evidence_message_ids: string;
  last_moved_at: string | null;
  taught_at: string | null;
}

interface TreeRow {
  file_id: string;
  updated_at: string;
}

let savepointSeq = 0;

/**
 * Re-point every row an orphaned predecessor of `fileId` left behind, for the bytes `sha`.
 * Idempotent: a second call finds no orphans and returns {@link NOTHING}. One savepoint, so it
 * is atomic on its own and still nests inside a caller's transaction.
 */
export function adoptOrphanedFileRows(db: SqlDatabase, fileId: string, sha: string): Adoption {
  const file = db.prepare('SELECT id, vault_id FROM files WHERE id = @f').get<{ id: string; vault_id: string }>({
    f: fileId,
  });
  if (!file) return NOTHING;
  // A notebook source (`managed.ts`) is a deliberate copy, keyed on its notebook rather than on
  // its bytes, and never a re-mint of anything. It adopts nothing; and since the orphan query
  // below only ever looks outside the adopting file's own vault, a folder-vault file must not
  // adopt a notebook's rows either — those are keyed on `nb:<id>`, not a sha, so it cannot.
  if (file.vault_id === MANAGED_VAULT_ID) return NOTHING;

  // A second known copy of these bytes in this vault: ambiguous, so adopt nothing.
  const twin = db
    .prepare('SELECT 1 AS x FROM files WHERE vault_id = @v AND sha256 = @s AND id <> @f LIMIT 1')
    .get<{ x: number }>({ v: file.vault_id, s: sha, f: fileId });
  if (twin) return NOTHING;

  const orphans = db
    .prepare(
      `SELECT DISTINCT file_id AS id FROM (
         SELECT file_id FROM materials          WHERE file_sha256 = @s
         UNION SELECT file_id FROM learning_trees     WHERE content_sha = @s
         UNION SELECT file_id FROM notes_docs         WHERE content_sha = @s
         UNION SELECT file_id FROM file_segmentations WHERE content_sha = @s
       )
       WHERE file_id IS NOT NULL
         AND file_id <> @f
         AND file_id NOT IN (SELECT id FROM files WHERE vault_id = @v)
       ORDER BY file_id`,
    )
    .all<{ id: string }>({ s: sha, f: fileId, v: file.vault_id })
    .map((r) => r.id);
  if (orphans.length === 0) return NOTHING;

  // Bound parameters for `IN (...)`: one per orphan. There are rarely more than two.
  const params: Record<string, unknown> = { f: fileId, s: sha };
  orphans.forEach((id, i) => (params[`o${i}`] = id));
  const inList = `(${orphans.map((_, i) => `@o${i}`).join(', ')})`;

  const sp = `adopt_orphans_${(savepointSeq += 1)}`;
  db.exec(`SAVEPOINT ${sp}`);
  try {
    const materials = db.prepare(`UPDATE materials SET file_id = @f WHERE file_id IN ${inList}`).run(params).changes;
    const usage = db.prepare(`UPDATE llm_usage SET file_id = @f WHERE file_id IN ${inList}`).run(params).changes;
    db.prepare(`UPDATE notes_docs SET file_id = @f WHERE content_sha = @s AND file_id IN ${inList}`).run(params);
    db.prepare(`UPDATE file_segmentations SET file_id = @f WHERE content_sha = @s AND file_id IN ${inList}`).run(
      params,
    );

    // ── Progress: merged per objective, never dropped. ──────────────────────────────────────
    // Objective ids are derived from (content_sha, title) (`objectives/repair.ts`), so the same
    // objective under the orphan and under the new id is the same row, and the two can simply be
    // folded: the higher level, the union of the evidence, the later timestamps. That is kinder
    // than either side winning outright — a learner who explained something under either id did
    // explain it.
    const all = db
      .prepare(`SELECT * FROM learning_objective_states WHERE file_id = @f OR file_id IN ${inList}`)
      .all<StateRow>(params);
    const newHasProgress = all.some((r) => r.file_id === fileId && hasProgress(r));
    const merged = new Map<string, StateRow>();
    for (const r of all) {
      const prev = merged.get(r.objective_id);
      merged.set(r.objective_id, prev ? fold(prev, r) : { ...r });
    }
    db.prepare(`DELETE FROM learning_objective_states WHERE file_id = @f OR file_id IN ${inList}`).run(params);
    const insert = db.prepare(
      `INSERT INTO learning_objective_states
         (objective_id, file_id, level, evidence_message_ids, last_moved_at, taught_at)
       VALUES (@o, @f, @level, @ids, @moved, @taught)`,
    );
    for (const r of merged.values()) {
      insert.run({
        o: r.objective_id,
        f: fileId,
        level: r.level,
        ids: r.evidence_message_ids,
        moved: r.last_moved_at,
        taught: r.taught_at,
      });
    }

    // ── The tree: one per file id (PK), so a collision needs a winner. ──────────────────────
    // The new id keeps its own tree **only if it already carries learner progress**: then its
    // states were earned against that tree's objectives and swapping the tree underneath them
    // would orphan them in the panel. Otherwise the new id is a fresh re-mint whose tree (if the
    // open raced the adoption) is a duplicate of the orphan's for the same bytes, and the orphan's
    // tree is the one the moved progress was earned against — so it wins. Either way the losing
    // trees *for these bytes* are deleted: they describe the same deck, nothing can reach them,
    // and left behind they would be adopted again by the next copy. An orphan's tree for other
    // bytes (the deck was edited before it moved) is left alone.
    const ownTree = db.prepare('SELECT file_id, updated_at FROM learning_trees WHERE file_id = @f').get<TreeRow>(params);
    const orphanTrees = db
      .prepare(
        `SELECT file_id, updated_at FROM learning_trees
          WHERE content_sha = @s AND file_id IN ${inList}
          ORDER BY updated_at DESC, file_id`,
      )
      .all<TreeRow>(params);
    let tree: Adoption['tree'] = ownTree ? 'kept' : 'none';
    const winner = orphanTrees[0];
    if (winner && !(ownTree && newHasProgress)) {
      db.prepare('DELETE FROM learning_trees WHERE file_id = @f').run(params);
      db.prepare('UPDATE learning_trees SET file_id = @f WHERE file_id = @w').run({ f: fileId, w: winner.file_id });
      tree = 'adopted';
    }
    db.prepare(`DELETE FROM learning_trees WHERE content_sha = @s AND file_id IN ${inList}`).run(params);

    db.exec(`RELEASE ${sp}`);
    return { from: orphans, materials, usage, tree, states: merged.size };
  } catch (err) {
    db.exec(`ROLLBACK TO ${sp}`);
    db.exec(`RELEASE ${sp}`);
    throw err;
  }
}

function hasProgress(r: StateRow): boolean {
  return r.level > 0 || r.taught_at !== null;
}

function fold(a: StateRow, b: StateRow): StateRow {
  const ids = [...new Set([...parseIds(a.evidence_message_ids), ...parseIds(b.evidence_message_ids)])];
  return {
    ...a,
    level: Math.max(a.level, b.level),
    evidence_message_ids: JSON.stringify(ids),
    last_moved_at: later(a.last_moved_at, b.last_moved_at),
    taught_at: later(a.taught_at, b.taught_at),
  };
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function parseIds(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
