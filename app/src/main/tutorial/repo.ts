/**
 * **A tutorial part's record** (migration 028 `tutorial_parts`; `TUTORIAL-CONTRACT.md` S3).
 *
 * One row per part of a tutorial's document, keyed on the doc and the sheet's own part id, which
 * a re-read keeps. Two halves with different owners:
 *
 *  - **What the ingest wrote**: the hidden key, the links into the notes and the slides, the
 *    objectives. Replaced whole by a re-read (`landParts`) and by official solutions (`setKey`).
 *  - **What the learner did**: the last verdict, the highest rung of help, the checks run, who
 *    decided, when the answer was revealed. Never touched by a re-read: a learner who re-reads a
 *    sheet keeps their record, as they keep their answers (`carryAnswers`).
 *
 * The key never leaves the main process; `view.ts` is what the renderer is sent.
 */
import type { SqlDatabase } from '../db/driver.js';
import { plain, plainAll } from '../db/sql.js';
import type { HintLevel, PartKey, PartLinks, TutorialPartStatus } from '../../shared/tutorial.js';

export interface PartRecord {
  docId: string;
  partId: string;
  key: PartKey;
  links: PartLinks;
  objectiveIds: string[];
  status: TutorialPartStatus;
  hintLevel: HintLevel;
  attempts: number;
  checkedBy: 'simulation' | 'model' | null;
  revealedAt: string | null;
  updatedAt: string;
}

/** What one part's ingest produced. */
export interface LandedPart {
  partId: string;
  key: PartKey;
  links: PartLinks;
  objectiveIds: string[];
}

interface Row {
  doc_id: string;
  part_id: string;
  key_json: string;
  links_json: string;
  objective_ids_json: string;
  status: TutorialPartStatus;
  hint_level: number;
  attempts: number;
  checked_by: 'simulation' | 'model' | null;
  revealed_at: string | null;
  updated_at: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function hintLevel(n: number): HintLevel {
  return n >= 3 ? 3 : n <= 0 ? 0 : (Math.floor(n) as HintLevel);
}

function toRecord(row: Row): PartRecord {
  const links = parse<Partial<PartLinks>>(row.links_json, {});
  return {
    docId: row.doc_id,
    partId: row.part_id,
    key: parse<PartKey>(row.key_json, {
      partId: row.part_id,
      answer: '',
      steps: [],
      mistakes: [],
      prerequisites: [],
      confidence: 'low',
      from: 'model',
    }),
    links: {
      notesBlockIds: Array.isArray(links.notesBlockIds) ? links.notesBlockIds : [],
      pages: Array.isArray(links.pages) ? links.pages : [],
    },
    objectiveIds: parse<string[]>(row.objective_ids_json, []),
    status: row.status,
    hintLevel: hintLevel(row.hint_level),
    attempts: row.attempts,
    checkedBy: row.checked_by,
    revealedAt: row.revealed_at,
    updatedAt: row.updated_at,
  };
}

export interface TutorialRepo {
  parts(docId: string): PartRecord[];
  part(docId: string, partId: string): PartRecord | null;
  /**
   * A (re-)read's keys, links and objectives, upserted by part id. The learner's half of a row
   * that already exists is kept. Rows of parts the new reading lacks are kept too: they are the
   * research log of what the learner did, and the view lists only the parts in the document.
   */
  landParts(docId: string, parts: readonly LandedPart[], now: string): void;
  /** Official solutions (or a re-check) rewrote the key. */
  setKey(docId: string, partId: string, key: PartKey, now: string): void;
  /** A check ran: the verdict's status, one more attempt, and who decided. */
  recordCheck(docId: string, partId: string, input: { status: TutorialPartStatus; checkedBy: 'simulation' | 'model' }, now: string): PartRecord | null;
  /** The highest rung of help taken; never lowered. */
  raiseHint(docId: string, partId: string, level: HintLevel, now: string): void;
  /** The learner gave up: status `revealed`, stamped. */
  reveal(docId: string, partId: string, now: string): void;
}

export function tutorialRepo(db: SqlDatabase): TutorialRepo {
  const read = (docId: string, partId: string): Row | undefined =>
    plain(db.prepare('SELECT * FROM tutorial_parts WHERE doc_id = @d AND part_id = @p').get<Row>({ d: docId, p: partId }));

  return {
    parts: (docId) =>
      plainAll(db.prepare('SELECT * FROM tutorial_parts WHERE doc_id = @d ORDER BY part_id').all<Row>({ d: docId })).map(toRecord),

    part(docId, partId) {
      const row = read(docId, partId);
      return row ? toRecord(row) : null;
    },

    landParts(docId, parts, now) {
      const stmt = db.prepare(
        `INSERT INTO tutorial_parts (doc_id, part_id, key_json, links_json, objective_ids_json, updated_at)
         VALUES (@d, @p, @key, @links, @objectives, @now)
         ON CONFLICT (doc_id, part_id) DO UPDATE SET
           key_json = excluded.key_json,
           links_json = excluded.links_json,
           objective_ids_json = excluded.objective_ids_json,
           updated_at = excluded.updated_at`,
      );
      for (const part of parts) {
        stmt.run({
          d: docId,
          p: part.partId,
          key: JSON.stringify(part.key),
          links: JSON.stringify(part.links),
          objectives: JSON.stringify(part.objectiveIds),
          now,
        });
      }
    },

    setKey(docId, partId, key, now) {
      db.prepare('UPDATE tutorial_parts SET key_json = @key, updated_at = @now WHERE doc_id = @d AND part_id = @p').run({
        d: docId,
        p: partId,
        key: JSON.stringify(key),
        now,
      });
    },

    recordCheck(docId, partId, input, now) {
      db.prepare(
        `UPDATE tutorial_parts
            SET status = @status, checked_by = @by, attempts = attempts + 1, updated_at = @now
          WHERE doc_id = @d AND part_id = @p`,
      ).run({ d: docId, p: partId, status: input.status, by: input.checkedBy, now });
      const row = read(docId, partId);
      return row ? toRecord(row) : null;
    },

    raiseHint(docId, partId, level, now) {
      db.prepare(
        `UPDATE tutorial_parts SET hint_level = MAX(hint_level, @level), updated_at = @now
          WHERE doc_id = @d AND part_id = @p`,
      ).run({ d: docId, p: partId, level, now });
    },

    reveal(docId, partId, now) {
      db.prepare(
        `UPDATE tutorial_parts SET status = 'revealed', revealed_at = COALESCE(revealed_at, @now), updated_at = @now
          WHERE doc_id = @d AND part_id = @p`,
      ).run({ d: docId, p: partId, now });
    },
  };
}
