-- Issue #22 — the Library becomes a vault: one root folder, learner-promoted topic subfolders,
-- a recursive file index, and a full-text index over what can be read as text.
--
-- Why a vault root rather than the `Watched folders` list of product-design.md §B1 L179: a
-- student keeps one `~/Documents/NUS`-shaped tree, not one folder per module, and the module
-- folders inside it are the topics. `settings.slides_folder` (§F.4 L1247) is left alone and
-- still answers "where did the learner last point us"; it is no longer what the Library reads.
--
-- Local-only by construction. §D.2 L815 and §D.3 L862 already forbid mirroring `file_path` and
-- `extracted_text` ("it is copyrighted lecture material"); every path and every byte of text
-- below is the same class of data, and none of these tables is in the `outbox` collection enum.

CREATE TABLE vaults (
  id           TEXT PRIMARY KEY,
  root_path    TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_scan_at TEXT
);

-- A topic is a subfolder the learner ticked. `rel_path` is POSIX-separated and relative to the
-- vault root; '' is the root itself and is never a topic, because then nothing would be "Other".
CREATE TABLE topics (
  id          TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  rel_path    TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- Optional tie to rooms.module_code, so a session started here lands under the right course.
  module_code TEXT,
  -- From the vault dot palette. product-design.md §C2 rule 2 reserves the three agent hues and
  -- rule 3 reserves indigo, so a topic dot may never be one of those four.
  colour      TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  promoted_at TEXT NOT NULL,
  UNIQUE (vault_id, rel_path)
);

-- One row per readable file found by the scan. `topic_id` NULL means the file is not under any
-- promoted folder — the "Other" bucket, which stays browsable (issue #22 decision 1).
CREATE TABLE files (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  topic_id   TEXT REFERENCES topics(id) ON DELETE SET NULL,
  rel_path   TEXT NOT NULL,
  name       TEXT NOT NULL,
  ext        TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('pdf','markdown','text','code','image','other')),
  size       INTEGER NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  -- Filled only for files that have been text-extracted; the scan itself never hashes, because
  -- hashing a 200 MB tree on every app focus is the difference between a scan and a stall.
  sha256     TEXT,
  page_count INTEGER,
  -- The (size, mtime_ms) the indexer last succeeded on. A mismatch is what makes the re-index
  -- incremental; architecture-mac.md §F.4 L1251 is the same idea for a session's own material.
  indexed_at       TEXT,
  indexed_size     INTEGER,
  indexed_mtime_ms INTEGER,
  index_error      TEXT,
  UNIQUE (vault_id, rel_path)
);

CREATE INDEX files_by_topic ON files (topic_id, name);
CREATE INDEX files_by_kind  ON files (vault_id, kind);
CREATE INDEX files_to_index ON files (vault_id, indexed_at);

-- The full-text index. One row per *page* for a PDF (so a hit can name a page number), one row
-- per file for everything else, with page NULL.
--
-- FTS5 is compiled into better-sqlite3 on both sides of this build
-- (`SELECT sqlite_compileoption_used('ENABLE_FTS5')` = 1, SQLite 3.53.4); it is NOT in Node's
-- built-in node:sqlite, which is why the test driver moved to the Node-ABI build of the same
-- library (src/main/db/driver.ts).
--
-- Deliberately a plain FTS5 table, not `content=`-backed by `files`: an external-content table
-- needs delete triggers to stay in sync, and delete triggers do not fire for ON DELETE CASCADE
-- unless PRAGMA recursive_triggers is on. Re-indexing a file is
-- `DELETE FROM file_text WHERE file_id = ?` followed by inserts, which is explicit and cannot
-- silently drift. The duplicated text is extracted text only — never the PDF bytes.
CREATE VIRTUAL TABLE file_text USING fts5 (
  body,
  name,
  file_id UNINDEXED,
  page    UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
