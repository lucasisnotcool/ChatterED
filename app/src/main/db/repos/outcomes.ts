/**
 * What became of each question Max asked (#48, migration 020 `quiz_outcomes`).
 *
 * **The progress bar is a pure function of these rows** (brief §6): a *Well done* on the learner's
 * own words fills an objective, a *Partly there* half-fills it, and a released answer fills
 * nothing. The arithmetic is `shared/doc/progress.ts`; this file only stores and reads.
 *
 * Keyed on `content_sha`, not on `file_id`: `files.id` is re-minted when a rescan sees a moved
 * file (#39), and what a learner demonstrated is a property of the bytes they demonstrated it
 * about. `room_id` rides along so a sitting can be reconstructed, but nothing reads by it as a
 * key — a second room on the same deck continues the same progress, which is the intent.
 *
 * No policy here. Whether a verdict counts, and for which objective, is the ledger's and the
 * orchestrator's; this file decides only where the row is written.
 */
import type { SqlDatabase } from '../driver.js';
import { plainAll } from '../sql.js';
import type { QuizOutcome } from '../../../shared/doc/types.js';

interface OutcomeRow {
  id: string;
  content_sha: string;
  room_id: string;
  objective_id: string | null;
  question_id: string;
  kind: 'verdict' | 'released';
  verdict: QuizOutcome['verdict'];
  released_by: QuizOutcome['releasedBy'];
  message_id: string | null;
  source: 'chat' | 'doc_text';
  attempt_index: number | null;
  own_words_block: number | null;
  own_words_cue: number | null;
  own_words_question: number | null;
  form: QuizOutcome['form'];
  created_at: string;
}

export interface OutcomesRepo {
  /** Idempotent on `id`: a retried write records the outcome once. */
  insert(outcome: QuizOutcome): QuizOutcome;
  /** Every outcome for these bytes, oldest first. The whole input to the progress bar. */
  forContent(contentSha: string): QuizOutcome[];
  /**
   * One objective's outcomes. `null` asks for the outcomes that were never attributed to an
   * objective — they exist (a question about the deck at large), and they fill nothing, so the
   * bar ignores them; a report that wants to count them can still find them.
   */
  forObjective(contentSha: string, objectiveId: string | null): QuizOutcome[];
  forRoom(roomId: string): QuizOutcome[];
  /** The outcome a question ended on, if it has ended. */
  forQuestion(contentSha: string, questionId: string): QuizOutcome[];
}

function toOutcome(row: OutcomeRow): QuizOutcome {
  return {
    id: row.id,
    contentSha: row.content_sha,
    roomId: row.room_id,
    objectiveId: row.objective_id,
    questionId: row.question_id,
    kind: row.kind,
    verdict: row.verdict,
    releasedBy: row.released_by,
    messageId: row.message_id,
    source: row.source,
    attemptIndex: row.attempt_index,
    // Three nullable columns, one nullable object: a row with no measurable answer has `null`
    // here rather than three nulls wrapped in a shape that reads as "measured, and all zero".
    ownWords:
      row.own_words_block === null && row.own_words_cue === null && row.own_words_question === null
        ? null
        : { block: row.own_words_block, cue: row.own_words_cue, question: row.own_words_question },
    // NULL is a row from before migration 023, and every question before it was an open one.
    form: row.form === 'cloze' ? 'cloze' : 'open',
    createdAt: row.created_at,
  };
}

export function outcomesRepo(db: SqlDatabase): OutcomesRepo {
  const all = (sql: string, params: Record<string, string | null>): QuizOutcome[] =>
    plainAll(db.prepare(sql).all<OutcomeRow>(params)).map(toOutcome);

  return {
    insert(outcome) {
      db.prepare(
        `INSERT INTO quiz_outcomes
           (id, content_sha, room_id, objective_id, question_id, kind, verdict, released_by,
            message_id, source, attempt_index, own_words_block, own_words_cue,
            own_words_question, form, created_at)
         VALUES (@id, @sha, @room, @objective, @question, @kind, @verdict, @released, @message,
                 @source, @attempt, @owBlock, @owCue, @owQuestion, @form, @now)
         ON CONFLICT (id) DO NOTHING`,
      ).run({
        id: outcome.id,
        sha: outcome.contentSha,
        room: outcome.roomId,
        objective: outcome.objectiveId,
        question: outcome.questionId,
        kind: outcome.kind,
        verdict: outcome.verdict,
        released: outcome.releasedBy,
        message: outcome.messageId,
        source: outcome.source,
        attempt: outcome.attemptIndex,
        owBlock: outcome.ownWords?.block ?? null,
        owCue: outcome.ownWords?.cue ?? null,
        owQuestion: outcome.ownWords?.question ?? null,
        form: outcome.form ?? null,
        now: outcome.createdAt,
      });
      return outcome;
    },

    forContent(contentSha) {
      return all('SELECT * FROM quiz_outcomes WHERE content_sha = @sha ORDER BY created_at, id', {
        sha: contentSha,
      });
    },

    forObjective(contentSha, objectiveId) {
      // Two statements rather than one with `IS`: SQLite's `=` never matches NULL, and a query
      // that silently returns nothing for the unattributed case is the kind of empty the caller
      // cannot tell from "there were none".
      const sql =
        objectiveId === null
          ? `SELECT * FROM quiz_outcomes
              WHERE content_sha = @sha AND objective_id IS NULL ORDER BY created_at, id`
          : `SELECT * FROM quiz_outcomes
              WHERE content_sha = @sha AND objective_id = @o ORDER BY created_at, id`;
      return all(sql, objectiveId === null ? { sha: contentSha } : { sha: contentSha, o: objectiveId });
    },

    forRoom(roomId) {
      return all('SELECT * FROM quiz_outcomes WHERE room_id = @r ORDER BY created_at, id', { r: roomId });
    },

    forQuestion(contentSha, questionId) {
      return all(
        'SELECT * FROM quiz_outcomes WHERE content_sha = @sha AND question_id = @q ORDER BY created_at, id',
        { sha: contentSha, q: questionId },
      );
    },
  };
}
