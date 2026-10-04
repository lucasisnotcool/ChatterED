-- 028 — tutorial sheets in a notebook (`docs/research/tutorials.md`, 2026-10-03;
-- `app/docs/TUTORIAL-CONTRACT.md` S1, S3).
--
-- **A source has a role.** `lecture` is what the overview is written from, and what every source
-- added before this build is: the column defaults to it, so an existing notebook reads exactly as
-- it did. `tutorial` is a problem sheet, shown as its own document beside the notes and never
-- summarised into the overview. `solutions` are the official answers to one tutorial (`key_for`,
-- that tutorial's `files.id`): never shown to the learner's context or an agent's, read only to
-- rewrite that tutorial's hidden key. `key_for` is not a foreign key: removing the tutorial leaves
-- the solutions in the notebook, answering nothing, until the learner points them elsewhere.
--
-- **A part's record** (`tutorial_parts`): the hidden key the ingest wrote and code checked, where
-- the part's material is in the notes and the slides, the notebook objectives it exercises, and
-- what the learner has done with it — the last check's verdict, the highest rung of help taken
-- (recorded for the research log, never a discount), the checks run, who decided the verdict
-- (code's simulation or Max's judgement), and when the answer was revealed. Keyed on the
-- tutorial's notes doc and the sheet's own part id (`P3A.i`), which a re-read keeps, so a record
-- survives a re-ingest exactly as the learner's answers do (`carryAnswers`).
--
-- The key is JSON (`PartKey` in `src/shared/tutorial.ts`) and never leaves the main process.
-- 001-027 are not touched.

ALTER TABLE notebook_sources ADD COLUMN role TEXT NOT NULL DEFAULT 'lecture'
  CHECK (role IN ('lecture', 'tutorial', 'solutions'));
ALTER TABLE notebook_sources ADD COLUMN key_for TEXT;

CREATE TABLE tutorial_parts (
  doc_id             TEXT NOT NULL,
  part_id            TEXT NOT NULL,
  key_json           TEXT NOT NULL,
  links_json         TEXT NOT NULL DEFAULT '{"notesBlockIds":[],"pages":[]}',
  objective_ids_json TEXT NOT NULL DEFAULT '[]',
  status             TEXT NOT NULL DEFAULT 'untried'
    CHECK (status IN ('untried', 'working', 'correct', 'partial', 'incorrect', 'revealed')),
  hint_level         INTEGER NOT NULL DEFAULT 0 CHECK (hint_level BETWEEN 0 AND 3),
  attempts           INTEGER NOT NULL DEFAULT 0,
  checked_by         TEXT CHECK (checked_by IN ('simulation', 'model')),
  revealed_at        TEXT,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (doc_id, part_id)
);
