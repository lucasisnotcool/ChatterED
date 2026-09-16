-- 014 — a room may exist before its concept pack does.
--
-- `whole-file-context.md` §1 defect 2: `room_6a9609d5c6fb` was created while the backend was
-- `scripted`, so `packFor()` handed it the committed **PSD/Hessian** fixture pack — on a 58-page
-- CS4246 planning deck. `pack_provenance = 'fixed'` then survived the switch to the live CLI,
-- and Ellie's prefix and the whole Explanation Ledger have since been scoring a deck about
-- search heuristics against claims about positive semidefinite Hessians.
--
-- The fix is a third provenance. `packFor()` used to have no way to say "none yet": its base
-- was `PSD_HESSIAN_CONVEXITY_V1` and the CHECK below only admitted 'fixed' or 'elicited', so a
-- material without a pack was unrepresentable and the fixture was the fallback for every deck
-- in the world. `'pending'` is that state: no elements, an empty ledger rail that says so, and
-- a background ingest that swaps a real pack in at the next turn.
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt in the documented 12-step
-- order. Every column and both original CHECKs are reproduced verbatim from 001_init.sql, plus
-- `outline` from 013. `PRAGMA foreign_keys` is not touched: the migration runner wraps this in
-- its own transaction and no other table carries a declared FK to `materials`.

CREATE TABLE materials_new (
  id             TEXT PRIMARY KEY,
  module_code    TEXT NOT NULL,
  title          TEXT NOT NULL,
  source_kind    TEXT NOT NULL CHECK (source_kind IN ('pdf_pages','pasted_text')),
  file_path      TEXT,
  file_sha256    TEXT,
  file_mtime     TEXT,
  page_from      INTEGER,
  page_to        INTEGER,
  page_count     INTEGER,
  extracted_text TEXT NOT NULL,
  extract_engine TEXT NOT NULL CHECK (extract_engine IN ('pdfjs','claude-pdf','paste')),
  padding_text   TEXT NOT NULL DEFAULT '',
  concept_pack   TEXT NOT NULL,
  pack_provenance TEXT NOT NULL CHECK (pack_provenance IN ('fixed','elicited','pending')),
  pack_confirmed_at TEXT,
  token_count    INTEGER NOT NULL,
  cache_eligible INTEGER NOT NULL DEFAULT 1,
  prefix_sha256  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  topic_context  TEXT NOT NULL DEFAULT '',
  file_id        TEXT,
  outline        TEXT NOT NULL DEFAULT '',
  CHECK (source_kind <> 'pdf_pages' OR (file_path IS NOT NULL AND page_from IS NOT NULL)),
  CHECK (cache_eligible = 0 OR token_count >= 4096)
);

INSERT INTO materials_new (
  id, module_code, title, source_kind, file_path, file_sha256, file_mtime, page_from, page_to,
  page_count, extracted_text, extract_engine, padding_text, concept_pack, pack_provenance,
  pack_confirmed_at, token_count, cache_eligible, prefix_sha256, created_at, topic_context,
  file_id, outline
)
SELECT
  id, module_code, title, source_kind, file_path, file_sha256, file_mtime, page_from, page_to,
  page_count, extracted_text, extract_engine, padding_text, concept_pack, pack_provenance,
  pack_confirmed_at, token_count, cache_eligible, prefix_sha256, created_at, topic_context,
  file_id, outline
FROM materials;

DROP TABLE materials;
ALTER TABLE materials_new RENAME TO materials;
