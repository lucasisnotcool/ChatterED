-- 024 — notebooks replace the folder vault (`docs/research/notebooks.md`, 2026-10-01).
--
-- A notebook is a named set of sources the learner added. A source is a file COPIED into app
-- storage (brief §1, answer C), so the original can move or vanish without breaking anything.
--
-- **A source is still a `files` row.** Everything downstream of a file id (the FTS index, page
-- geometry, segments, `textFor`, the #39 adoption, the cost and research joins) keeps working,
-- because the copies live under one synthetic "managed" vault whose root is the app's notebook
-- store. `notebook_sources.file_id` is that row's id.
--
-- **The notebook reads as one virtual deck.** Each source gets a fixed `page_base` when it is
-- added: its page 1 is the notebook's page `page_base + 1`. Bases are append-only (a new source
-- starts after the highest page any source of this notebook ever used) and never change, so a
-- block's `pages`, an objective's refs and an outcome's mapping stay valid when a source is
-- unticked, re-ticked or removed. This is what lets the page-keyed machinery of #48 (provenance,
-- `blocksForPages`, the notes map, section pages) work on a notebook unchanged. The helpers that
-- translate between the two numberings are pure, in `src/shared/notebook.ts`.
--
-- The notes doc, the room, the objective tree and the outcomes of a notebook are keyed on the
-- notebook id where they were keyed on a file id, and on the content key 'nb:<notebook id>' where
-- they were keyed on a content sha.

CREATE TABLE notebooks (
  id             TEXT PRIMARY KEY,            -- nb_<12 hex>
  name           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  opened_at      TEXT,
  -- Set on the notebooks made from a pre-024 notes doc (brief §1, "existing work is kept"), so
  -- the one-time import is idempotent: a file that already has a notebook is not imported again.
  legacy_file_id TEXT UNIQUE
);
CREATE INDEX idx_notebooks_recent ON notebooks (opened_at DESC, updated_at DESC);

CREATE TABLE notebook_sources (
  file_id       TEXT PRIMARY KEY,             -- files.id of the managed copy
  notebook_id   TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  -- The name the learner's file had when it was added, shown in the sources panel. The copy on
  -- disk may carry a prefix to keep names unique.
  display_name  TEXT NOT NULL,
  page_base     INTEGER NOT NULL,
  page_count    INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,   -- the checkbox: in this notebook's context or not
  ord           INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','ready','failed')),
  error         TEXT,
  added_at      TEXT NOT NULL
);
CREATE INDEX idx_notebook_sources_nb ON notebook_sources (notebook_id, ord);

-- The overview's own metadata, which is not document content (brief §5.3, §6): the starter
-- questions under Ellie's greeting, each section's recommended block, and the fingerprint of the
-- ticked sources it was written from (so the doc can say "the overview doesn't cover it yet").
-- JSON shape: `OverviewMeta` in `src/shared/doc/types.ts`. NULL on a pre-024 doc.
ALTER TABLE notes_docs ADD COLUMN overview_json TEXT;

-- `block_action` (brief §4.2): the one-line doc edit beside an Explain or Example, and Ellie's
-- one-line edit after any doc-chat question. Widening a CHECK means a rebuild (see 014 and the
-- note in `migrations.ts`); the columns and their order are 020's, unchanged.
CREATE TABLE notes_doc_edits_024 (
  edit_id      TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL,
  room_id      TEXT,
  author       TEXT NOT NULL CHECK (author IN ('ellie','max')),
  cause        TEXT NOT NULL CHECK (cause IN ('answer_missing','q_block','q_resolved','whisper_insert','suggestion','block_action')),
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
INSERT INTO notes_doc_edits_024
  SELECT edit_id, doc_id, room_id, author, cause, ops_json, why, status, block_ids, turn_id,
         message_id, objective_id, doc_version, created_at, resolved_at
  FROM notes_doc_edits;
DROP TABLE notes_doc_edits;
ALTER TABLE notes_doc_edits_024 RENAME TO notes_doc_edits;
CREATE INDEX idx_notes_doc_edits_doc ON notes_doc_edits (doc_id, created_at);
