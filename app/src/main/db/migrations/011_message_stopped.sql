-- 011 — a message can say the learner stopped it mid-sentence.
--
-- Stop (cui-standards-audit.md §2(e), issue #34) keeps whatever text had already arrived as the
-- message rather than throwing it away: the learner watched several sentences land, and a thread
-- that then contains none of them is the app deciding their reading did not happen. But a partial
-- is not a considered turn, and a transcript that cannot tell the two apart is a transcript the
-- A1 analysis cannot trust — `ttft_actual_ms` and `latency_target_ms` on a stopped row describe a
-- turn nobody let finish.
--
-- Deliberately a flag on `messages` and not a new table: it is one bit about one row, it must
-- travel with the row into the research export, and the row already carries every other fact
-- about how the turn was produced (model, backend, the two latency columns).
--
-- 0 for every message written before this build, which is true: nothing could be stopped.
-- Forward-only; 001-010 are not touched.

ALTER TABLE messages ADD COLUMN stopped INTEGER NOT NULL DEFAULT 0;
