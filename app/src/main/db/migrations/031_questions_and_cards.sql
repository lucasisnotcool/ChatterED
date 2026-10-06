-- 031 — Questions to Ellie count toward readiness; a verdict knows its concept card
-- (Lucas's decisions of 6 Oct afternoon, 8 and 9, recorded on #67; `docs/research/notebooks.md`
-- §11.10.4).
--
-- **8. A question to Ellie about a section** counts toward "Ready to check this?" as Explain and
-- Example do. In the Lecture-sdm session of 6 Oct, five questions to Ellie about one section
-- (reinforcement learning's set-up) counted for nothing. They are filed in `objective_activity`
-- (030) as kind `question`. SQLite cannot widen a CHECK in place, so the table is rebuilt: create,
-- copy, DROP, RENAME, with the index made again. The runner turns foreign keys off around it
-- (`migrations.ts`); nothing references this table, and 029's no-DELETE triggers are on the chat
-- tables, not on this one, so there is no trigger to recreate.
--
-- **9. A topic is done only when every concept card it covers has a *Well done*.** One *Well
-- done* on value iteration completed a topic that also covers policy iteration, which had ended
-- in a give-up. To count per card, a verdict has to know which card its question was about. The
-- question's Q block says so (`q_block.cardId`), but the learner may remove a Q block, and the
-- credit must not go with it, so the card is copied onto the outcome row when it is written.
-- NULL on every row written before this, and on a question that was not about a card; the reader
-- then falls back to the Q block, or counts the row toward no card.
--
-- Forward-only. 001-030 are not touched.

CREATE TABLE objective_activity_031 (
  id           TEXT PRIMARY KEY,
  content_sha  TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('explain','example','question')),
  block_id     TEXT,
  created_at   TEXT NOT NULL
);
INSERT INTO objective_activity_031 (id, content_sha, room_id, objective_id, kind, block_id, created_at)
  SELECT id, content_sha, room_id, objective_id, kind, block_id, created_at FROM objective_activity;
DROP TABLE objective_activity;
ALTER TABLE objective_activity_031 RENAME TO objective_activity;
CREATE INDEX idx_objective_activity_sha ON objective_activity (content_sha, objective_id);

ALTER TABLE quiz_outcomes ADD COLUMN card_id TEXT;
