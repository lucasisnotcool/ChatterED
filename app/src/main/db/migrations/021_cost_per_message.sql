-- **Per-message cost** (#42 item B, on top of the collab-doc pivot of #48).
--
-- The ledger (017) records one row per model call and can already answer "what did this app /
-- this document / this thread cost". It cannot answer the question a learner actually asks,
-- which is *"what did **that** cost?"* with a finger on one card in the chat — because the join
-- from a call to the message it produced did not exist.
--
-- It nearly did. Every call inside an agent turn already carries `llm_usage.turn_id`, the
-- actor's correlation id (`#runAgentTurn`'s `PendingTurn.id`) — the decision, the ledger coding,
-- the generation and the doc-edit planner all file under it. The missing half was on the other
-- side: the message row the turn wrote kept no record of which turn wrote it, so the id was a
-- correlation key with only one end attached.
--
--   turn_id on messages  ⟶  llm_usage.turn_id  ⟶  every call made on that message's behalf
--
-- That is the whole of item B. A message's cost is `SUM` over the calls sharing its turn, which
-- is why this is one column and not a new table: the fact was already recorded, twice, and only
-- needed somewhere to meet.
--
-- `whispers.turn_id` is the same column for the private threads (#48 §4.6). A whisper turn is
-- not a `#runAgentTurn` turn — it takes no floor, runs no orchestrator and updates no ledger —
-- so its id is minted by `#whisper()` itself and is deliberately in the same namespace, because
-- from the ledger's point of view "which reply did this call write" is one question.
--
-- Both are nullable and stay nullable. Every message written before this build has no turn id
-- and never will; a per-message meter that is absent on a historical card is honest, and a
-- backfill that guessed by timestamp would be the opposite.

ALTER TABLE messages ADD COLUMN turn_id TEXT;
ALTER TABLE whispers ADD COLUMN turn_id TEXT;

-- **What happened to the call** (#42's known gap, closed).
--
-- Until now a call that threw recorded nothing at all: the CLI kills its child before the
-- `result` message and the API stream never reaches `finalMessage()`, so `costedClient` never
-- ran. Every total was therefore a floor, and — worse — it was a floor that got quietly *better*
-- the more a session went wrong, because the failed calls vanished instead of being counted.
--
-- Now the decorator records the call either way and says which it was:
--   'ok'        — returned normally.
--   'error'     — threw. Tokens are whatever the backend managed to report before it did.
--   'aborted'   — the learner pressed Stop (`LlmAbortedError`). Not a failure.
--   'preempted' — the notes lane was killed to let a learner's click through
--                 (`CliPreemptedError`), and `notes/ingest.ts` re-queued that window. The row
--                 that follows is a *second* call for the same work, which is exactly why this
--                 has to be visible: without it the re-queue looks like a cost the ingest
--                 invented.
--
-- A failed row often carries zero tokens, and that is not the same as not being there: "11 calls,
-- 2 of them killed" is a different fact from "9 calls". `DEFAULT 'ok'` makes every row written
-- before today read as what it was.
ALTER TABLE llm_usage ADD COLUMN outcome TEXT NOT NULL DEFAULT 'ok';

-- The per-message join, and the analytics page's failure panel. Both are lookups by a key that
-- had no index: `turn_id` was written and never queried until now.
CREATE INDEX idx_llm_usage_turn ON llm_usage (turn_id);
CREATE INDEX idx_messages_turn ON messages (turn_id);
