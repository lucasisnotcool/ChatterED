-- 012 — a message says how it was produced, not just what it says.
--
-- cui-standards-audit.md §6: `AiSegment` gives author, role word and a `by rule` tag, and omits
-- the model, the backend and the TTFT stamp that the old room's `Message.svelte` has had all
-- along. "In a research prototype that can silently be answering from `ScriptedClient`, a turn
-- that does not say which backend produced it is a claim about a model that never ran."
--
-- `model` and `backend` were already columns (003). The two that were not:
--
--   total_ms    turn start → this row: what the learner actually waited, which is the only
--               latency number that describes their experience. `latency_target_ms` is the
--               floor the app chose and `ttft_actual_ms` is when text first became visible;
--               neither says when the turn ended.
--   decided_by  who chose this speaker — `rule:teacher_answers`, `rule:handoff`, `model:sonnet`.
--               It is on `turn_decisions` already, but reaching it from a message means a join
--               through a column (`turn_decision_id`) that has never been written, and the
--               debug drawer and the card both want it per message.
--
-- Nullable, because every message written before this build has no honest value for either, and
-- a zero would read as "instant". Forward-only; 001-011 are not touched.

ALTER TABLE messages ADD COLUMN total_ms INTEGER;
ALTER TABLE messages ADD COLUMN decided_by TEXT;
