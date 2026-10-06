-- 032 — Exclude from research data (2026-10-07).
--
-- A flag on a folder or a notebook that keeps everything tied to it out of the research export
-- (`main/research/exclude.ts`): its notes docs and their edits, its room and every chat row under
-- it, its objectives, cards and outcomes, its search rows, and the usage rows that name it. A
-- folder's flag covers its whole subtree, nested folders and their notebooks included; the
-- effective set is computed when it is read, never stored, so moving a notebook into or out of an
-- excluded folder changes what is exported with no write here.
--
-- Nothing is deleted from the app's own database. The flag only decides what the export copies.
--
-- Forward-only. 001-031 are not touched.

ALTER TABLE folders ADD COLUMN research_exclude INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notebooks ADD COLUMN research_exclude INTEGER NOT NULL DEFAULT 0;
