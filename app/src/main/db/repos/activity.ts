/**
 * **Explain, Example and questions to Ellie, per objective** (migration 030; Lucas's decision of
 * 2026-10-06, D2; questions since migration 031, decision 8 of the afternoon on #67).
 *
 * One row per press Ellie answered, or per question of the learner's she answered on a section,
 * filed against the objective of the line it was on. It is half
 * of what `core/readiness` reads to decide whether to offer "Ready to check this?"; the renderer
 * measures the other half (time on the section, the learner's own words, folds opened).
 *
 * Keyed on `content_sha`, like `quiz_outcomes`, so New Conversation keeps it. No policy here:
 * what counts as ready is the core's.
 */
import type { SqlDatabase } from '../driver.js';
import { plainAll } from '../sql.js';
import type { ObjectiveActivity, ObjectiveActivityKind, ObjectiveActivityView, QuizOutcome } from '../../../shared/doc/types.js';

interface ActivityRow {
  id: string;
  content_sha: string;
  room_id: string;
  objective_id: string;
  kind: ObjectiveActivityKind;
  block_id: string | null;
  created_at: string;
}

export interface ActivityRepo {
  /** Idempotent on `id`. */
  insert(activity: ObjectiveActivity): ObjectiveActivity;
  /** Every press on these bytes, oldest first. */
  forContent(contentSha: string): ObjectiveActivity[];
}

function toActivity(row: ActivityRow): ObjectiveActivity {
  return {
    id: row.id,
    contentSha: row.content_sha,
    roomId: row.room_id,
    objectiveId: row.objective_id,
    kind: row.kind,
    blockId: row.block_id,
    createdAt: row.created_at,
  };
}

export function activityRepo(db: SqlDatabase): ActivityRepo {
  return {
    insert(activity) {
      db.prepare(
        `INSERT INTO objective_activity (id, content_sha, room_id, objective_id, kind, block_id, created_at)
         VALUES (@id, @sha, @room, @objective, @kind, @block, @now)
         ON CONFLICT (id) DO NOTHING`,
      ).run({
        id: activity.id,
        sha: activity.contentSha,
        room: activity.roomId,
        objective: activity.objectiveId,
        kind: activity.kind,
        block: activity.blockId,
        now: activity.createdAt,
      });
      return activity;
    },

    forContent(contentSha) {
      return plainAll(
        db
          .prepare('SELECT * FROM objective_activity WHERE content_sha = @sha ORDER BY created_at, id')
          .all<ActivityRow>({ sha: contentSha }),
      ).map(toActivity);
    },
  };
}

/**
 * **One objective's presses since its last question closed.** "Closed" is its newest outcome row
 * (a verdict or a release), so a question answered or released resets the count: readiness is
 * about what the learner did *after* the last check, which is what stops the immediate re-ask.
 * ISO timestamps compare as strings.
 */
export function activitySince(
  activity: readonly ObjectiveActivity[],
  outcomes: readonly QuizOutcome[],
): ObjectiveActivityView {
  let since: string | null = null;
  for (const o of outcomes) if (since === null || o.createdAt > since) since = o.createdAt;
  let explains = 0;
  let examples = 0;
  let questions = 0;
  for (const a of activity) {
    if (since !== null && a.createdAt <= since) continue;
    if (a.kind === 'explain') explains += 1;
    else if (a.kind === 'example') examples += 1;
    else questions += 1;
  }
  return { explains, examples, questions, since };
}
