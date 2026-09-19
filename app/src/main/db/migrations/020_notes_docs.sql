-- The collaborative notes doc (#48, docs/research/collab-doc.md).
--
-- A deck is ingested into AI-written lecture notes; the agents edit them live beside the learner;
-- the learner's own text is never overwritten. These are the tables behind that.
--
-- Keyed on the BYTES, not the vault's file id. `files.id` is re-minted when a rescan sees a moved
-- file (#39), and `learning_trees` is keyed on it and suffers for it; `file_segmentations` (009)
-- and the cost ledger (017) are keyed on `content_sha` with no foreign keys and do not. This
-- follows them: `file_id` columns here are provenance, never a key.

-- The document itself: ProseMirror JSON, read and written whole, versioned for optimistic saves.
CREATE TABLE notes_docs (
  id              TEXT PRIMARY KEY,           -- doc_<12 hex>
  content_sha     TEXT NOT NULL UNIQUE,
  file_id         TEXT,
  title           TEXT NOT NULL,
  page_count      INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 0, -- bumped on every accepted save
  doc_json        TEXT NOT NULL,
  ingest_status   TEXT NOT NULL CHECK (ingest_status IN ('pending','streaming','ready','failed')),
  ingest_version  INTEGER NOT NULL,           -- NOTES_PROMPT_VERSION: the other half of the cache key
  windows_done    INTEGER NOT NULL DEFAULT 0,
  windows_total   INTEGER NOT NULL DEFAULT 0,
  with_images     INTEGER NOT NULL DEFAULT 0,
  -- The ingest's running state between windows (the outline so far, the last block id), so a
  -- window killed for a learner's question, or an app quit mid-ingest, resumes and is not redone.
  ingest_state    TEXT,
  model           TEXT NOT NULL DEFAULT '',
  error           TEXT,
  frozen          INTEGER NOT NULL DEFAULT 0,
  -- 009's `segments_touched` rule: once the learner has edited it, it is never re-ingested over
  -- without an explicit force. Remaining windows still append; they never rewrite.
  learner_touched INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Every agent edit, and what became of it in the renderer (the guard runs there, where the
-- editor is; main records the outcome).
CREATE TABLE notes_doc_edits (
  edit_id      TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL,
  room_id      TEXT,
  author       TEXT NOT NULL CHECK (author IN ('ellie','max')),
  cause        TEXT NOT NULL CHECK (cause IN ('answer_missing','q_block','q_resolved','whisper_insert','suggestion')),
  ops_json     TEXT NOT NULL,
  why          TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('pending','applied','kept','removed','dropped_frozen','rejected_guard')),
  block_ids    TEXT NOT NULL DEFAULT '[]',
  turn_id      TEXT,
  message_id   TEXT,
  objective_id TEXT,
  doc_version  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
CREATE INDEX idx_notes_doc_edits_doc ON notes_doc_edits (doc_id, created_at);

CREATE TABLE notes_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  doc_id        TEXT NOT NULL,
  edit_id       TEXT NOT NULL,
  author        TEXT NOT NULL CHECK (author IN ('ellie','max')),
  block_id      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','accepted','rejected')),
  note          TEXT,
  thread_id     TEXT,
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);
CREATE INDEX idx_notes_suggestions_doc ON notes_suggestions (doc_id, status);

-- The thread registry. A thread id IS a `messages.anchor_id` (migration 010): 'doc' for the doc
-- chat, 'span_<12 hex>' for a Ctrl+E thread. Private threads stay in `whispers`; their row here
-- only records which agent a thread id belongs to.
CREATE TABLE notes_threads (
  thread_id    TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  doc_id       TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('doc','span','private')),
  block_id     TEXT,
  span_quote   TEXT,
  agent_key    TEXT,
  objective_id TEXT,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  PRIMARY KEY (room_id, thread_id)
);
CREATE INDEX idx_notes_threads_doc ON notes_threads (doc_id, kind);

-- What became of each question Max asked. The progress bar is a pure function of these rows
-- (`shared/doc/progress.ts`): a *Well done* on the learner's own words completes an objective, a
-- *Partly there* half-fills it, and a released answer fills nothing (brief §6). The ledger's levels
-- stay as the evidence record beside it.
CREATE TABLE quiz_outcomes (
  id           TEXT PRIMARY KEY,
  content_sha  TEXT NOT NULL,
  room_id      TEXT NOT NULL,
  objective_id TEXT,
  question_id  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('verdict','released')),
  verdict      TEXT CHECK (verdict IN ('complete','partial','not_yet')),
  released_by  TEXT CHECK (released_by IN ('give_up','pass','closure')),
  message_id   TEXT,
  source       TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat','doc_text')),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_quiz_outcomes_sha ON quiz_outcomes (content_sha, objective_id);

-- Which doc blocks carry which objective: a cache of a pure function (page intersection), so a
-- lesson card's Start can scroll without recomputing it on every render.
CREATE TABLE notes_objective_blocks (
  doc_id       TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  block_id     TEXT NOT NULL,
  ord          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_id, objective_id, block_id)
);
