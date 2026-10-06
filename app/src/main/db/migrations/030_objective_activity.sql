-- 030 — Explain and Example, filed against the objective of the line they were pressed on
-- (Lucas's decision of 2026-10-06, D2; `docs/research/notebooks.md` §5.2 and `collab-doc.md` §6,
-- amended 2026-10-06).
--
-- Max no longer asks on a lesson's Start. The app offers "Ready to check this?" on a section once
-- the learner has worked on it, and that is decided in code (`core/readiness.ts`) from signals the
-- learner produced: one of them is pressing Explain or Example on the section's lines. Until now
-- the objective was passed in with the press and only logged, so nothing could read it back.
--
-- Keyed on `content_sha`, as `quiz_outcomes` is (020): what a learner asked to be taught is a
-- property of the bytes they were reading, and a second room on the same deck (New Conversation)
-- continues it. `room_id` rides along so a sitting can be reconstructed. One row per press that
-- Ellie actually answered.
--
-- Forward-only. 001-029 are not touched.

CREATE TABLE objective_activity (
  id           TEXT PRIMARY KEY,
  content_sha  TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('explain','example')),
  block_id     TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_objective_activity_sha ON objective_activity (content_sha, objective_id);
