-- 026 — folders on the Notebooks home (2026-10-03, `docs/research/search.md` §1).
--
-- A Finder-style tree: a folder holds folders and notebooks, and a notebook sits in exactly one
-- folder or at the top level (`folder_id` NULL). Search's scope is a folder and everything under
-- it, read with a recursive CTE (`main/notebooks/repo.ts` `subtreeNotebookIds`).
--
--   parent_id  NULL at the top level. No ON DELETE action, on purpose: deleting a folder is the
--              service's job, and it first moves the folder's notebooks and subfolders up one level
--              (a folder delete must never take a semester of notes with it). If a bug ever skipped
--              that step, the foreign key refuses the delete instead of cascading.
--   ord        the learner's order among siblings; folders list by `ord`, then name.
--
-- `notebooks.folder_id` gets ON DELETE SET NULL as a second safety net for the same reason: a
-- notebook whose folder somehow vanished shows at the top level, never nowhere. 001-025 are not
-- touched.

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,               -- fd_<12 hex>
  parent_id   TEXT REFERENCES folders(id),
  name        TEXT NOT NULL,
  ord         INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX folders_parent ON folders(parent_id);

ALTER TABLE notebooks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX notebooks_folder ON notebooks(folder_id);
