-- 025 — the learner's moves of a slide between the notes' slide strips (2026-10-03).
--
-- Which section of the notes a slide belongs to is computed, not stored: `shared/doc/slidegroups.ts`
-- is a pure function of the document, the pages and their text, rerun on every doc change, so a
-- retitled heading or a moved block regroups the slides with no write. What it cannot compute is a
-- learner's judgement that p. 19 belongs with *Heuristics* after all. That, and only that, is a
-- row here: one per page the learner has moved, applied over the computed groups last.
--
--   group_key    the section's heading `blockId`, or 'opening' / 'other' for the two strips that
--                are not sections.
--   group_title  the heading's text when the move was made. An Update overview or a Regenerate
--                mints new block ids, so `group_key` stops matching; the move is then remapped to
--                the section whose heading has this text, or ignored if there is none. This is why
--                `clearForRegenerate` leaves these rows alone.
--
-- `page` is a notebook page for a notebook's doc (the same numbering as every block's `pages`).
-- No foreign key, like the other per-doc tables of 020: nothing deletes a `notes_docs` row (a
-- Regenerate keeps the row and replaces its doc). 001-024 are not touched.

CREATE TABLE notes_slide_groups (
  doc_id      TEXT NOT NULL,
  page        INTEGER NOT NULL,
  group_key   TEXT NOT NULL,
  group_title TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL,
  PRIMARY KEY (doc_id, page)
);
