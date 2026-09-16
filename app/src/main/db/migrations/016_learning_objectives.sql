-- 016 — the learning-objective tree, per file, and the states the ledger moves.
--
-- `docs/research/learning-objectives.md` §2: "One tree per file replaces one pack per room: a
-- room opened on a file reads the file's tree; the ledger writes the file's states. Rooms on the
-- same file share progress, which is what *tracked per file* means."
--
-- **Why per file and not per session.** `ledger_state` is keyed on `session_id`, which is right
-- for what it is — a transcript's judgement of a sitting. An objective is not a sitting: the
-- learner who explained the Bellman equation on Tuesday has explained it on Thursday too, and a
-- panel that forgot it because the sitting closed would be lying about what they can do. So the
-- ledger stays session-scoped and authoritative about *evidence*, and these two tables are the
-- file-scoped projection of it. Nothing is computed twice: `setLevel` is written from
-- `applyLedgerRules`' own output and from nowhere else.
--
-- **`json` holds the objectives.** They are a tree of 6–20 nodes with arrays on every one of
-- them, read whole and written whole, and never queried by field — the same reasoning that put
-- `file_segmentations.builds` and `concept_pack` in a TEXT column rather than in four more
-- tables. The columns beside it are exactly what *is* queried: the cache key (`content_sha` +
-- `prompt_version`), the status the panel renders, and the model for the footer.
--
-- **`messages.objective_id`** is §5's click path (issue #38 item 5): an Ask opened from a node
-- carries the node, so an explanation given in that thread is attributable to what the learner
-- clicked. A column on `messages` rather than a table of its own is the smallest change that
-- works — anchors have no table, and the thread is already a set of messages sharing an
-- `anchor_id`. Nullable, and null on every message not opened from the panel.
--
-- No foreign keys to `vault_files`: a tree outlives a rescan that re-mints file rows, and a tree
-- whose file has genuinely gone is a row nobody reads rather than a delete cascade nobody asked
-- for. Forward-only; 001–015 are not touched.

CREATE TABLE learning_trees (
  file_id        TEXT PRIMARY KEY,
  content_sha    TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  model          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
  generated_at   TEXT,
  error          TEXT,
  json           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE learning_objective_states (
  objective_id         TEXT NOT NULL,
  file_id              TEXT NOT NULL,
  -- 0 untouched, 1 stated, 2 justified (online), 3 defended. The ledger's 0–4 clamped at 3,
  -- which is a clamp and not a re-scaling: `levelToState()` already calls >= 3 `defended`.
  level                INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
  -- The learner's OWN messages, json array. Rule 1 of the ledger is what puts an id in here.
  evidence_message_ids TEXT NOT NULL DEFAULT '[]',
  last_moved_at        TEXT,
  taught_at            TEXT,
  PRIMARY KEY (file_id, objective_id)
);

CREATE INDEX idx_objective_states_file ON learning_objective_states (file_id);

ALTER TABLE messages ADD COLUMN objective_id TEXT;
