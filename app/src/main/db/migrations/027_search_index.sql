-- 027 — the semantic search index (2026-10-03, `docs/research/search.md` §3-§4).
--
-- One row per chunk the chunker (`shared/search/chunk.ts`) makes of a notebook: a group of notes
-- blocks ('note'), one slide or page ('page'), or one notes block on its own ('unit', used only to
-- pick which block of a group to highlight). Rows are derived data: they can always be rebuilt
-- from `notes_docs` and `file_text`, so nothing here is a record and nothing references it.
--
--   key        the chunker's stable key, e.g. `note:<notebook>:<first block>`.
--   hash       FNV-1a of the text that was embedded. A chunk whose hash and model are unchanged
--              keeps its vector across edits elsewhere in the doc.
--   vec        Float32 little-endian, 768 values; NULL until the embedding process has done it.
--   model_id   the model and revision that wrote `vec`. A new model re-embeds everything.
--
-- `search_state` is per notebook: the doc version and the sources' signature the rows were made
-- from, so a check of "is this notebook's index current?" is one row, not a re-chunk.
-- 001-026 are not touched.

CREATE TABLE search_chunks (
  key          TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('note', 'page', 'unit')),
  block_ids    TEXT NOT NULL DEFAULT '[]',
  page         INTEGER,
  pages        TEXT NOT NULL DEFAULT '[]',
  section      TEXT NOT NULL DEFAULT '[]',
  title        TEXT NOT NULL DEFAULT '',
  text         TEXT NOT NULL,
  embed_text   TEXT NOT NULL,
  hash         TEXT NOT NULL,
  model_id     TEXT,
  vec          BLOB,
  updated_at   TEXT NOT NULL
);
CREATE INDEX search_chunks_notebook ON search_chunks(notebook_id, kind);
CREATE INDEX search_chunks_pending ON search_chunks(vec) WHERE vec IS NULL;

CREATE TABLE search_state (
  notebook_id  TEXT PRIMARY KEY,
  doc_version  INTEGER NOT NULL DEFAULT -1,
  sources_sig  TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);
