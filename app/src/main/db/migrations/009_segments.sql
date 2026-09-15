-- Issue #25 — the geometry-only segmentation, persisted.
--
-- A note on the number: `pivot-spec.md` §A3 reserved `009_documents_blocks_anchors.sql` for the
-- blocks/anchors model. Segments were built first, so they take 009 and the blocks/anchors
-- migration becomes 010. Nothing in §A3 depends on the number; migrations are forward-only and
-- keyed on `PRAGMA user_version`, so the only rule is that a shipped file is never edited.
--
-- Keyed on `content_sha`, not on a file id, for the reason §C2 gives for caching there: the
-- segmentation is a property of the *bytes*. A deck that is renamed, moved between topic
-- folders, or re-downloaded to a second machine keeps its segments and its learner's cuts; a
-- deck that is re-exported from PowerPoint correctly gets a fresh one.
--
-- **Nothing reflowed is stored here.** `pdf-fidelity-segmentation.md` §C3: a reflowed segment
-- "is a **view**, never a store, never a default". A segment is four numbers and a label; the
-- pixels come from re-rendering the page, which is what makes the fidelity claim true by
-- construction. There is deliberately no `text`, no `html` and no `markdown` column below.
--
-- Local-only, like everything else that touches lecture material (architecture-mac.md §D.3):
-- neither table is in the `outbox` collection enum, so neither can be mirrored.

CREATE TABLE file_segmentations (
  -- sha256 of the file's bytes.
  content_sha TEXT PRIMARY KEY,
  -- The last vault file id this sha was seen at. Provenance only: never a foreign key, because
  -- a re-scan may remove the row and the learner's cuts must survive it.
  file_id     TEXT,
  -- Pages **after** the Stage 0 build-group merge.
  page_count  INTEGER NOT NULL,
  genre       TEXT NOT NULL CHECK (genre IN ('slides','paper-2col','prose','image-only','ink-only')),
  -- The sentence the flow shows above the first card. NULL for slides.
  notice      TEXT,
  -- JSON. `signals` is the genre router's input (words/page, coverage, columns, landscape,
  -- images) — kept because it is a number the Assignment 2 report will want to quote.
  signals     TEXT NOT NULL,
  -- JSON BuildGroup[]: which source pages each kept page subsumed, for the "⏴ N build steps" chip.
  builds      TEXT NOT NULL,
  -- JSON CutCandidate[]: Stage 3's proposals, including the blocked near-misses, so the ticks
  -- and the "won't cut a figure" refusals survive a reopen without re-running pdf.js.
  candidates  TEXT NOT NULL,
  -- JSON {page,width,height}[] in PDF points, so the renderer can convert normalised → canvas
  -- and snap in points without opening the document first.
  page_sizes  TEXT NOT NULL,
  -- Bumped when the pipeline's output would change, which invalidates the cache. Learner edits
  -- are NOT discarded on a bump: see `segments_touched` below.
  pipeline_version INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

-- One row per segment, in flow order. This is the source of truth (`pivot-spec.md` §A3).
CREATE TABLE segments (
  id          TEXT PRIMARY KEY,
  content_sha TEXT NOT NULL REFERENCES file_segmentations(content_sha) ON DELETE CASCADE,
  -- Position in the flow. Contiguous from 0; the only thing `segments:reorder` changes.
  ord         INTEGER NOT NULL,
  -- 1-indexed source page, after the build-group merge.
  page        INTEGER NOT NULL,
  -- Normalised 0–1 against the page box, y **down** from the page top (pivot-spec.md §A2).
  x0          REAL NOT NULL,
  y0          REAL NOT NULL,
  x1          REAL NOT NULL,
  y1          REAL NOT NULL,
  label       TEXT NOT NULL,
  -- Who drew this boundary. The evaluation measure of segmentation-lazy-split.md §2.2 is
  -- accepted proposals vs free cuts, and this column is that measure.
  source      TEXT NOT NULL CHECK (source IN ('geometry','learner')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX segments_by_file ON segments (content_sha, ord);
CREATE INDEX segments_by_page ON segments (content_sha, page);

-- Has the learner touched this document's segmentation? One row, written on the first split,
-- merge, reorder or rename. While it is absent the cached segmentation may be rebuilt freely
-- (a pipeline-version bump, a threshold change); once it is present, a rebuild would throw away
-- the learner's own boundaries, and §C5's "the learner decides" says it must not.
CREATE TABLE segments_touched (
  content_sha TEXT PRIMARY KEY REFERENCES file_segmentations(content_sha) ON DELETE CASCADE,
  touched_at  TEXT NOT NULL
);
