-- 010 — a message can say which segment of the document it is anchored to.
--
-- The flow's threads hang off segments, not off a single room transcript: "+ Ask here" inserts
-- a REFERENCE card between two crops, and the Teacher's thread opens underneath it
-- (pivot-spec.md §B1, flow-build-plan.md §4.3). Without this column every message belongs to
-- the whole room and the REFERENCE gate — neither agent may post into *that* thread until the
-- learner presses "Explain it back" — has nothing to be scoped to.
--
-- Deliberately one nullable TEXT column and one index, and deliberately NOT a foreign key to
-- the segments table: segments are produced by the geometry pipeline (migration 009) and are
-- recomputed on re-open, while a transcript outlives the cut it was made against. The same
-- reasoning already used for message_refs.file_id — "the transcript outlives the file".
--
-- A message with anchor_id IS NULL is a room-level message, which is every message written
-- before this build. Forward-only: 001-009 are not touched.

ALTER TABLE messages ADD COLUMN anchor_id TEXT;

CREATE INDEX idx_messages_anchor ON messages (room_id, anchor_id, seq);
