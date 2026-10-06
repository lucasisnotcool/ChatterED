-- 033 — Stored comments on notes blocks, and search chunks made from them (2026-10-07).
--
-- **block_comments.** A notes block (a paragraph, a list item, a maths block, a table, a concept
-- card's core line or an item's content) can carry a stored comment. The one kind so far is
-- 'explain': what Ellie would answer if the learner pressed Explain on that line, written ahead
-- of time so it can be read **offline** (an open-book exam). Comments live beside `doc_json`,
-- never inside it, so the learner's document, its `version` and its saves are untouched.
--
--   doc_id     notes_docs.id. Deleting the doc deletes its comments.
--   block_id   the block's `blockId` attr. Not checked against the doc here: a block the learner
--              deletes leaves its comment unread, and an undo brings both back.
--   body       the inline markup subset (**bold**, *italic*, `code`, $tex$), paragraphs and lists
--              as the chat renders them (`renderer/lib/aitext.ts`).
--   text_sha   a hash of the block text the comment was written for, as the writer computed it.
--              Stored for provenance; the app treats it as opaque.
--   model      the model that wrote it.
--
-- **search_chunks** gains the kind 'explain': a comment embedded as a chunk of its own that
-- resolves to its block (`shared/search/chunk.ts`, mode `separate`). SQLite cannot widen a CHECK
-- in place, so the table is rebuilt (create, copy, DROP, RENAME, indexes again), keeping every
-- vector. Nothing references it.
--
-- Forward-only. 001-031 are not touched (032 is reserved by another branch).

CREATE TABLE block_comments (
  doc_id      TEXT NOT NULL REFERENCES notes_docs(id) ON DELETE CASCADE,
  block_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('explain')),
  body        TEXT NOT NULL,
  text_sha    TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (doc_id, block_id, kind)
);

CREATE TABLE search_chunks_033 (
  key          TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('note', 'page', 'unit', 'explain')),
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
INSERT INTO search_chunks_033 (key, notebook_id, kind, block_ids, page, pages, section, title, text, embed_text, hash, model_id, vec, updated_at)
  SELECT key, notebook_id, kind, block_ids, page, pages, section, title, text, embed_text, hash, model_id, vec, updated_at FROM search_chunks;
DROP TABLE search_chunks;
ALTER TABLE search_chunks_033 RENAME TO search_chunks;
CREATE INDEX search_chunks_notebook ON search_chunks(notebook_id, kind);
CREATE INDEX search_chunks_pending ON search_chunks(vec) WHERE vec IS NULL;
