-- 017 — `llm_usage`: one row per model call, so "what has this cost" has an answer.
--
-- Lucas asked for a cost counter at app, file and thread level. Until now the only record of a
-- call was `messages.usage` / `turn_decisions.usage` — a JSON blob on the row the call happened
-- to produce — and three whole classes of call produced no row at all: the orchestrator decision
-- when it decides silence, the ledger update, the concept ingest and the objectives ingest. A
-- counter built on `messages` would therefore under-report by exactly the calls nobody sees,
-- which on the CLI path are the expensive ones (`models.ts`: the ingest emits 4,053 output
-- tokens on Sonnet, the ledger 858–1,523).
--
-- **One row per call, written from the one place every call passes through** — the client
-- decorator in `src/main/cost/client.ts`, applied in `backend.createClient()` next to
-- `loggedClient`. Nothing can be missed by forgetting to instrument a new call site, which is
-- the same argument `llm/logged.ts` makes for the log.
--
-- **Two money columns, never added together.** `reported_cost_usd` is the local CLI's own
-- `total_cost_usd` and is NULL on every other backend; `estimated_cost_usd` is this app's
-- arithmetic against the rate card in `src/main/cost/rates.ts`. They disagree by ~1.7× on the
-- one measurement anybody has made (`docs/research/segmentation-cost.md` §UNVERIFIED 6), so
-- collapsing them into one column would be picking a winner this app has no basis to pick.
-- `rate_card` records which card priced the row, so a later price change does not silently
-- rewrite history.
--
-- **No foreign keys**, on 016's precedent and for its reason. A usage row is an accounting fact:
-- it must outlive the room, the material and the vault file row it refers to, and a re-scan that
-- re-mints file ids is not a reason to delete the record of tokens that were really spent.
-- `file_id` and `anchor_id` are therefore plain text, and a null `file_id` means the call
-- belonged to no document — invisible at file level by construction, which is correct.
--
-- **`backfilled`** marks a row reconstructed by `src/main/cost/backfill.ts` from `messages.usage`
-- and `turn_decisions.usage` rather than recorded live. Those rows have no duration and no
-- reported cost, and the summary counts them separately so a panel can say how much of its own
-- history it is inferring.

CREATE TABLE llm_usage (
  id                    TEXT PRIMARY KEY,
  created_at            TEXT NOT NULL,

  -- Attribution. Every one of these may be null: a call made before a room exists (the concept
  -- ingest) has no room, and a deck-level question's anchor is the synthetic 'deck'.
  turn_id               TEXT,
  room_id               TEXT,
  file_id               TEXT,
  anchor_id             TEXT,

  scope                 TEXT NOT NULL,
  model                 TEXT NOT NULL,
  backend               TEXT NOT NULL,

  -- The four counts the provider reported. `input_tokens` excludes both cache columns, exactly
  -- as the Anthropic usage object does.
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens    INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,

  reported_cost_usd     REAL,
  estimated_cost_usd    REAL NOT NULL DEFAULT 0,
  -- The date of the rate card that produced `estimated_cost_usd`, and whether that card had an
  -- exact entry for `model` or fell back.
  rate_card             TEXT NOT NULL DEFAULT '',
  rate_exact            INTEGER NOT NULL DEFAULT 1,

  duration_ms           INTEGER,
  backfilled            INTEGER NOT NULL DEFAULT 0,
  -- 'live' | 'messages' | 'turn_decisions'. Which reconstruction produced a backfilled row.
  source                TEXT NOT NULL DEFAULT 'live'
);

-- The three queries `cost:summary` makes, one index each. App level is a range scan on time;
-- file level adds the file; thread level adds the anchor within a room.
CREATE INDEX idx_llm_usage_created ON llm_usage (created_at);
CREATE INDEX idx_llm_usage_file ON llm_usage (file_id, created_at);
CREATE INDEX idx_llm_usage_anchor ON llm_usage (room_id, anchor_id, created_at);
