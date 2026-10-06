-- 034 — Exclusion from research data outlives deletion (2026-10-07).
--
-- Deleting a notebook keeps its notes docs (`nb:<id>`), its room, its chat and its outcomes as the
-- record (`NotebookService.delete`), but its `notebooks` row goes, and with it the flag migration
-- 032 put there. Without this table, the kept record of a notebook the learner had excluded would
-- be exported again the moment the notebook was deleted.
--
-- **research_excluded_deleted.** The ids of a notebook that was excluded (its own mark or a
-- folder's) at the moment it was deleted, and of the source files it had then, so the export can
-- still follow the keys from them (`main/research/exclude.ts`). Written by the delete, never
-- cleared: a deleted notebook can no longer be unmarked.
--
--   id     a notebook id (`nb_…`) or a `files.id` (`f_…`)
--   kind   'notebook' or 'file'
--   at     when the delete recorded it
--
-- A deleted *folder* needs no row: its notebooks and subfolders move up a level and take its mark
-- with them as their own (`NotebookService.deleteFolder`).
--
-- The export removes this table from its snapshot. Forward-only. 001-033 are not touched.

CREATE TABLE research_excluded_deleted (
  id    TEXT PRIMARY KEY,
  kind  TEXT NOT NULL CHECK (kind IN ('notebook', 'file')),
  at    TEXT NOT NULL
);
