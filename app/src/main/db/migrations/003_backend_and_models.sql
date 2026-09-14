-- Issue #19 added a second live backend (the local Claude CLI) alongside the API key, and let
-- the learner pick a model per role. From here on "which model said this" is not answerable
-- from the app version alone, so every message row records the backend next to the model id,
-- and every session records the plan it was opened with. Without these columns a transcript
-- exported for the study cannot say whether a turn came from Haiku over the API or Sonnet over
-- the local subscription — which is exactly the comparison the latency and quality claims rest
-- on. Forward-only: 001 and 002 have shipped and are never edited.
ALTER TABLE messages ADD COLUMN backend TEXT;
ALTER TABLE sessions ADD COLUMN llm_backend TEXT;
ALTER TABLE sessions ADD COLUMN agent_model TEXT;
ALTER TABLE sessions ADD COLUMN orchestrator_model TEXT;
