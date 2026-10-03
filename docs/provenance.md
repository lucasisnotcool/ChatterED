# Provenance: who built what

Both of us submit an individual Assignment 2 built on this one app, and the group project is the
same app, so graders need to tell one person's work from the other's (AGENTS.md, hard rule 7).
Git history is the full record. This file adds a row for each significant contribution and for
anything brought in from an individual assignment. Anyone using code they did not write in an
individual assignment says so in that assignment.

| Path | Origin | Author | Entered | Notes |
|---|---|---|---|---|
| `app/` (all of the app up to 2026-10-01), `docs/research/`, `docs/report/` | ChatterED: Lucas's A1 prototype, carried into his A2 | Lucas, with Claude Code | 2026-09-13 onwards | The app both A2s now build on |
| `app/src/core/` | ChatterED, the learner-turn logic both A1 designs share (#54) | Lucas, with Claude Code | 2026-09-26 | Was mirrored to the group repo's `core/` until 2026-10-01; this is now the only copy |
| `docs/report/assignment1-final.md`, `docs/report/figures/` | ChatterED A1 report as submitted (22 Sep 2026) | Lucas | 2026-09-23 | Word for word (the L- evidence) |
| `AGENTS.md`, `SCOPE.md`, `tools/check-scope.sh`, `.github/workflows/scope.yml`, `docs/evidence/`, this file | Team setup, carried over from `lucasisnotcool/cs3249-group` (archived) | Lucas, with Claude Code | 2026-10-01 | Valerie to review |
| `app/sim/` | Simulation harness: the real app headless, a simulated learner with a persona, Claude Code as judge | Lucas, with Claude Code | 2026-10-01 | Shared tooling; run outputs stay outside the repo |
| `app/src/renderer/lib/pm/math.ts`, `matheditor.ts`, `mathpaste.ts`, `app/src/shared/doc/tex.ts` | Maths in the notes: typeset formulas, a MathLive formula editor, copy and paste of TeX | Lucas, with Claude Code | 2026-10-03 | Uses MathLive and mathml-to-latex (MIT), credited in the app's third-party notices |
| `app/src/renderer/lib/pm/slidewindow.ts`, `slidegeom.ts`, `slidestrip.ts`, `components/notes/SlideRegroup.svelte`, `app/src/shared/doc/slidegroups.ts`, migration 025 | Slides beside the notes: floating slide windows with selectable text and crop-to-insert, a hover peek, a slide strip per section, slide-to-section grouping, and drag to regroup | Lucas, with Claude Code | 2026-10-03 | Replaces the slide modal and the carousel |
| `app/src/renderer/lib/pm/image.ts`, `slide_image` in `app/src/shared/doc/schema.ts` | Slide images in line with text: drag, cut and paste, corner resize, crop edited in the slide window | Lucas, with Claude Code | 2026-10-03 | Replaces the block `slide_figure` in the editor |
| `app/src/shared/folders.ts`, `app/src/shared/search/`, `app/src/main/search/`, `app/src/renderer/components/search/`, `lib/searchlayout.ts`, `lib/searchstore.svelte.ts`, `lib/pm/searchhit.ts`, `scripts/fetch-model.mjs`, migrations 026–027, `docs/research/search.md` | Folders on the Notebooks home, and offline semantic search over every notebook's slides and notes (EmbeddingGemma-300m, bundled), with the three-column search page | Lucas, with Claude Code | 2026-10-03 | A user-facing feature, not part of the CUI study. The model is under the Gemma Terms of Use; its NOTICE ships beside it |
| `docs/evidence/N-nudge-a1-report.md` | Nudge A1 report as submitted | Valerie | to add | |
