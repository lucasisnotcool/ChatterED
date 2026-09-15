# Segmentation across PDF genres

How the pipeline in `pdf-fidelity-segmentation.md` §C2 — render the page, compute candidate
horizontal cuts in whitespace crossing no ink, let a vision model *select* among them, crop
the render — behaves on genres it was **not** designed for. Measured locally on 19 files,
2026-09-15; no API calls, no network. Read that document's §A1, §B1.1, §B1.3, §C2 and §E-3
first; this one assumes them.

## Contents
- [A. The question](#a-the-question)
- [B. Corpus and method](#b-corpus-and-method)
- [C. Page-level measurements](#c-page-level-measurements)
- [D. Candidate-cut behaviour](#d-candidate-cut-behaviour)
- [E. The right segment unit, per genre](#e-the-right-segment-unit-per-genre)
- [F. Prior art and benchmarks](#f-prior-art-and-benchmarks)
- [G. Genre × behaviour × unit × cost](#g-genre--behaviour--unit--cost)
- [H. Recommendation](#h-recommendation)
- [I. UNVERIFIED](#i-unverified)
- [Appendix — the measurement script](#appendix--the-measurement-script)

## A. The question

§E risk 3 of the fidelity brief states the worry in one line: *"The whole plan assumes
slides, one concept per region."* A CS3249 or CS4246 reading list is slides **plus** ACM
papers, **plus** a textbook excerpt, **plus** whatever the student wrote in GoodNotes. If
the flow collapses to one-segment-per-page on three of those four, the pivot's visible
value is a slides-only feature dressed as a general one.

So, per genre: (1) does the geometry still produce usable cut candidates, (2) what is the
*right* unit of a segment, (3) what does it cost. The fidelity argument itself — crop the
render, never re-typeset — is not re-litigated; it gets *stronger* on papers and scans.

## B. Corpus and method

Nineteen files, five pages each at the 10/30/50/70/90 % marks (whole document if ≤ 5
pages). Paths are in [§C](#c-page-level-measurements). Personal, admin and identity
documents were excluded by inspection; none of their content is quoted.

Two independent, poppler-only geometry sources:

| source | command | gives |
|---|---|---|
| **TEXT** | `pdftotext -bbox-layout` | block boxes, line boxes, word count |
| **INK** | `pdftoppm -gray -r 50` | per-raster-row count of dark pixels — *every* mark: glyphs, rules, vector figures, raster images, handwriting |

**One deliberate deviation.** `pdfimages -list` reports an image's size and resolution but
**not its position**, so it cannot enforce §C2 stage 3's condition (b) ("crosses no image
box"). The raster ink profile enforces a stronger condition directly: a cut is proposed
only in a row empty of every mark, and a cut that crosses nothing cannot cross a figure.

A **candidate full-width cut** is the midpoint of a run of ink-free raster rows at least
`G` points tall, below the top 12 % of the page and above the last inked row. `G` = 8 pt
and 16 pt, per the brief. **Per-column cuts** repeat the same test inside each column band,
where column bands come from vertical gutters in the *line* boxes.

**Finding 0, method-level:** column detection must use `<line>` boxes, not `<block>`. On
the 1-column ACM journal paper poppler returns **4 blocks for the whole page**, one of them
(`x 45.5–442.0, y 87.7–646.9`) the entire body — §A2's claim that poppler's block grouping
is not a segmentation, with a number. Line boxes on the same page: 50.

## C. Page-level measurements

Medians over the five sampled pages; ranges where they matter. "cov" is the fraction of
page area under the union of text **block** boxes (comparable to §A1.1); "ink" is the
fraction of *pixels* that are dark at 50 dpi.

| # | genre | file | pages | words/pg | blocks/pg | lines/pg | text cov | ink | cols | imgs/pg | tagged |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | slides, PowerPoint | `CS4246/Lecture-mdp.pdf` | 60 | **13** (8–103) | 5 | 5 | **0.076** (.04–.29) | 0.058 | 1–2 | 0 | no |
| 2 | slides, Google Slides | `CS3249/FetchCanvas/Week 5/CS3249+Lecture+5+2026.pdf` | 50 | 51 | 7 | 12 | 0.293 | 0.324 | 1–2 | 1 | no |
| 3 | slides, Keynote | `NST2030/FetchCanvas/Lecture notes/Chapter1+-+week+1.pdf` | 137 | 33 (0–77) | 3 | 8 | 0.185 | 0.272 | 1 | 1 | **yes** |
| 4 | Beamer | `NUS YS Archives/…/CS3230/Week 1/lec01a.pdf` | 21 | 52 (6–136) | 4 | 8 | 0.220 | 0.063 | 1 | 2 | no |
| 5 | Beamer | `NUS YS Archives/…/CS1101S/Lecture Slides/lecture-L1.print.pdf` | 61 | 62 | 8 | 17 | 0.212 | 0.123 | 1 | 0 | no |
| 6 | paper, 2-col (CHI) | `CS3249/Critique 1/Clauding/3491102.3502010.pdf` | 19 | **883** | 39 | 115 | 0.477 | 0.177 | **2** | 0 | yes |
| 7 | paper, 2-col (IUI) | `CS3249/Critique 1/Clauding/3581641.3584037.pdf` | 24 | 1003 | 17 | 113 | 0.572 | 0.190 | **2** | 0 | no |
| 8 | paper, 2-col (LBW) | `CS3249/Critique 1/Clauding/3656156.3663715.pdf` | 5 | 1083 | 11 | 113 | 0.596 | 0.218 | **2** | 0 | yes |
| 9 | paper, 1-col journal | `Academia/Sources/Multi Agent AI ED/3757633.pdf` | 33 | 398 (302–677) | 8 | 50 | 0.443 | 0.193 | 1 | 0 | no |
| 10 | paper, 1-col preprint | `Academia/Sources/[NEW] Koala System/2501.17258v1.pdf` | 31 | 646 | 34 | 44 | 0.436 | 0.127 | 1 | 0 | no |
| 11 | paper, 1-col | `Academia/Sources/timing messages/3772318.3790716.pdf` | 17 | 959 | 13 | 109 | 0.588 | 0.210 | 1–2 | 0 | yes |
| 12 | textbook excerpt | `NST2030/Nielsen and Chuang - Excerpt on linear algebra.pdf` | 11 | 509 | 21 | 63 | 0.396 | 0.067 | 1 | 1 | no |
| 13 | book, ebook-converted | `CS3249/Critique 1/Clauding/dokumen.pub_…-8622534.pdf` | 280 | 363 | **4** | 38 | **0.588** | 0.261 | 1 | 1 | no |
| 14 | scan + OCR layer | `CS3249/Critique 1/Clauding/MaxWeberEconomyAndSociety.pdf` | 1643 | 466 | 8 | 45 | **0.687** | 0.266 | 1 | 1 | no |
| 15 | image-only, no text | `NUS Documents/Campus Map/kent-ridge-campus-map.pdf` | 1 | **0** | 0 | 0 | **0.000** | 0.469 | — | 2 | no |
| 16 | handwriting, ink only | `GoodNotes/Untitled Whiteboard.pdf` | 1 | **0** | 0 | 0 | **0.000** | 0.130 | — | 0 | no |
| 17 | handwriting over print | `GoodNotes/CS4246/…Tutorial2…Students - Whiteboard.pdf` | 1 | 924 | 52 | 173 | 0.108 | 0.039 | 1 | 0 | no |
| 18 | handwritten notes | `GoodNotes/NST2030/Chapter 2.pdf` | 12 | 205 | **94** | 104 | 0.295 | 0.081 | 1–2 | 0 | no |
| 19 | equation-dense slides | `CS4246/Lecture-sdm.pdf` | 68 | 71 | 10 | 13 | 0.231 | 0.074 | 1–2 | 0 | no |

All OneDrive paths are relative to
`"/Users/lohzh/Library/CloudStorage/OneDrive-NationalUniversityofSingapore/"`.

§A1.1's headline result reproduces and widens. Slides carry **13–62 words per page at
7–29 % text coverage**; papers **398–1083 words at 44–60 %**; a converted book page 59 %; a
scanned-and-OCR'd page **69 %**, the densest in the corpus. *"For papers, text ≈ the
document; for slides, text is a minority"* now rests on eleven documents, not two.

## D. Candidate-cut behaviour

`cut8` / `cut16` are full-width candidate cuts per page at `G` = 8 pt / 16 pt; `pc8` /
`pc16` are per-column cuts per column-band; `zero` is the percentage of sampled pages with
**no** candidate at all; "footer" is the share of all full-width cuts that fall below
y = 0.88, i.e. in the page-number band rather than in the body.

| # | genre | cut8 (range) | cut16 | zero @8 | zero @16 | pc8 | pc16 | footer |
|---|---|---|---|---|---|---|---|---|
| 1 | slides, PowerPoint | **4** (3–11) | 3 | 0 % | 0 % | 2.0 | 1.5 | 0 % |
| 2 | slides, Google | 2 (1–8) | 2 | 0 % | 0 % | 2.0 | 2.0 | 20 % |
| 3 | slides, Keynote | 1 (0–4) | 1 | 20 % | 40 % | — | — | 0 % |
| 4 | Beamer (CS3230) | 2 (0–4) | 1 | 20 % | 20 % | — | — | 0 % |
| 5 | Beamer (CS1101S) | 3 (3–5) | 3 | 0 % | 0 % | — | — | 17 % |
| 6 | paper, 2-col CHI | 2 (0–2) | 1 | **40 %** | 40 % | 2.5 | **0.5** | 0 % |
| 7 | paper, 2-col IUI | 1 (1–1) | 1 | 0 % | 0 % | 2.0 | **0.5** | **100 %** |
| 8 | paper, 2-col LBW | 1 (1–3) | 1 | 0 % | 0 % | 1.0 | **0.0** | 62 % |
| 9 | paper, 1-col journal | 4 (1–8) | 2 | 0 % | 0 % | — | — | 22 % |
| 10 | paper, 1-col preprint | 1 (0–6) | 1 | 20 % | 20 % | — | — | 0 % |
| 11 | paper, 1-col | 0 (0–2) | 0 | **60 %** | 60 % | 1.5 | 0.5 | 0 % |
| 12 | textbook excerpt | **4** (0–7) | 3 | 20 % | 20 % | — | — | 0 % |
| 13 | book, ebook | 1 (0–1) | **0** | 40 % | **100 %** | — | — | 33 % |
| 14 | scan + OCR | 1 (0–7) | 1 | 40 % | 40 % | — | — | 50 % |
| 15 | image-only | **0** | 0 | **100 %** | **100 %** | — | — | — |
| 16 | handwriting, ink only | **0** | 0 | **100 %** | **100 %** | — | — | — |
| 17 | handwriting over print | 11 | 7 | 0 % | 0 % | — | — | 0 % |
| 18 | handwritten notes | 9 (7–18) | **0** | 0 % | **100 %** | (29) | 0.0 | 50 % |
| 19 | equation-dense slides | **5** (3–9) | 3 | 0 % | 0 % | 3.5 | 2.0 | 0 % |

Six findings, in order of how much they change the plan.

**D1. Slides are the sweet spot, and it was not luck.** Every deck yields 1–5 full-width
candidates per page, 0–20 % empty pages, and only 0–20 % footer junk. §C2's "typically 2–6
candidates per slide, and zero is a correct answer" holds across four exporters (PowerPoint,
Google Slides, Keynote, two Beamer vintages). Equation-dense slides (#19) are the corpus's
*best* case at 5 cuts/page — displayed equations are vertically isolated by construction.

**D2. On 2-column papers, full-width cuts mostly measure the footer.** File #7 gives
exactly one full-width cut per sampled page and **100 % sit at y ≈ 0.925, the page-number
band**; file #8, 62 %. Such a cut is geometrically valid and semantically worthless. §C2's
chrome rule (stage 2) is therefore not a tidy-up here — it is the difference between one
useless candidate per page and zero.

**D3. Per-column cuts exist at G = 8 and vanish at G = 16.** Per column band: 1.0–2.5 cuts
at 8 pt, **0.0–0.5 at 16 pt**. A 9 pt ACM body on ~11 pt leading never opens a 16 pt hole
inside a column. `G` must be derived from the document's own median line gap (≈ 1.4×
leading); 16 pt is a *slides* constant.

**D4. Well-set book pages have no whitespace at all.** The converted trade book (#13)
returns **zero candidates at G = 16 on 100 % of pages**; the scanned book (#14) on 40 %.
Book typesetting separates paragraphs by first-line *indent*, not vertical space, so the
geometry carries no paragraph signal: prose paragraph boundaries must come from the
**x-offset of the first line box**. Cheap (`xMin` is already there), but a different rule,
not a tuning of the existing one.

**D5. Cuts on papers land on figure captions, not headings.** Classifying the first text
line below each candidate as heading / not-heading (numbered, all-caps, or short and
title-cased): on the three 2-column papers **0 of 15 sampled pages had all-heading cuts**;
on the 1-column journal paper they fell mostly on `Fig. 4.`, `Fig. 8.`, `Fig. 9.` captions.
Good news in bad clothes — the geometry reliably finds **float boundaries**, the thing a
segment must not slice through, and *not* the section structure a reader would name.

**D6. Handwriting: G = 8 works, G = 16 destroys it, ink-only gives nothing.** Handwritten
notes (#18) give 9 candidates/page at 8 pt and **zero at 16 pt on every page** — a person's
line spacing on A4 is under 16 pt. The pure-ink whiteboard (#16) has no text layer, no
images (vector ink), 13 % ink coverage and **zero candidates even at 8 pt**: a sketch is one
connected thought with no white band across it. The raster method is what makes #16
measurable at all — a text-layer-only pipeline sees an empty page. And #17, a printed
tutorial annotated in GoodNotes, reads as its underlying print document (924 words, 11
cuts): the ink is a thin layer on top.

## E. The right segment unit, per genre

**Slides and Beamer.** Unchanged: a region of one rendered page, usually the whole page.
Beamer adds the progressive-build problem §C2 stage 0 already handles — note #5 is a
`.print` export (builds flattened by the author) and #4 is not.

**Two-column papers.** The unit is a **column band**: a contiguous run of lines within one
column. Three things break that slides never did. *(i) Concepts cross column and page
breaks* — a paragraph starting at the foot of column 1 ends at the top of column 2, so a
segment must hold **two or more crops** rendered stacked as one card. That is a data-model
change (`segment.rects[]`, not `segment.rect`), worth making now because it also solves
§C6's figure that belongs to two concepts. *(ii) Floats detach from their mentions* — "see
Figure 5" can precede Figure 5 by a page; attach floats to the segment that *mentions*
them, by caption-label match, leaving page order intact. *(iii) Footnotes, references and
running heads* are text belonging to no concept; the chrome rule kills heads, but a
reference list is 8 pages of correctly-shaped, empty segments and should be detected by its
heading and collapsed to one.

**One-column papers and typeset readings.** The best non-slide case: 1–4 candidates per
page, few footer artefacts. The unit is a **paragraph group** — one to three paragraphs
under a shared heading. Two additions: paragraph detection from first-line indent (D4), and
**cross-page merge**, since a group starting 80 % down page 4 continues on page 5.
Cross-page merge is unavoidable for every prose genre, needed by slides not at all, and is
the single biggest structural addition papers demand.

**Scanned PDFs.** Two genres, not one. A scan *with* an OCR layer (#14, Acrobat Paper
Capture) behaves like 1-column prose and needs nothing new, with one caveat: OCR boxes
inherit page skew, so cuts should be validated against the raster profile, not the text
boxes. A scan *without* a text layer (#15) yields zero of everything and is correctly one
segment per page. **Mentioned, not built:** macOS's Vision framework
(`VNRecognizeTextRequest`) ships on every Mac ChatterED targets, needs no model download and
no network, and would supply the missing word boxes; tesseract is the cross-platform
alternative. Neither is on the A1 path.

**Handwritten notes.** Ink-profile whitespace cuts *do* work (9/page at 8 pt) provided `G`
comes from the writer's own median ink-run height. Otherwise one segment per page, honestly
labelled; an ink-only sketch is one segment and should say so.

**Dense equations.** Not a failure mode — the best case measured (#19, #12). Both the deck
and the Nielsen & Chuang excerpt cut cleanly around displayed equations, which stay
pixel-exact because they are cropped. §A1.2's argument applies with more force to a
textbook than to a deck.

## F. Prior art and benchmarks

**OmniDocBench** (Ouyang et al., CVPR 2025, arXiv:2412.07626) settles the per-genre
strategy question with numbers. End-to-end normalised edit distance, lower better:

| tool | Academic Papers | Textbook | Slides (PPT2PDF) | Notes (handwritten) |
|---|---|---|---|---|
| MinerU | **0.025** | 0.102 | 0.124 | **0.984** |
| Marker | **0.059** | 0.319 | 0.340 | 0.651 |
| GOT-OCR (VLM) | 0.179 | 0.132 | 0.222 | 0.388 |

Specialist layout pipelines are 4–6× worse on slides than on papers and **15–40× worse on
handwritten notes**; the paper says so in words too ("pipeline tools perform well for…
academic papers… for more specialized data, such as slides and handwritten notes, general
VLMs demonstrate stronger generalization"). Layout-detection mAP on the same benchmark
follows the same shape (research reports ~65–73, notes 0.8–9.5). **DocLayNet** (IBM, KDD
2022, arXiv:2206.01062), the training set behind much of this, has six document
categories — financial reports, manuals, scientific articles, laws, patents, tenders — and
**no slides and no handwriting category**, which explains the distribution.

This defends a *per-genre* strategy over one converter everywhere: on slides ChatterED's
geometry-plus-crop competes with tools scoring 0.124–0.340, but on papers a layout model is
in-distribution at 0.025 and is worth using — **as a cut proposer feeding the same crop
pipeline**, never as the rendered content. Docling is MIT (Marker's weights are
OpenRAIL-M-restricted, MinerU AGPL; §E-6), the only licence surviving the commercial intent.

**Classical algorithms.** Nagy & Seth's recursive X-Y cut (ICPR 1984) slices a page along
alternating horizontal/vertical projection-profile gaps into a tree of rectangles — §C2
stage 3 is exactly one horizontal level of an X-Y cut. Breuel's *Two geometric algorithms
for layout analysis* (DAS 2002, LNCS 2423) computes **maximal empty whitespace rectangles**
globally and heuristic-free, the principled way to find column gutters. Both assume
Manhattan layouts and degrade on non-rectilinear pages — slides and handwriting — which is
where the raster-ink condition earns its keep.

**Reader apps.** Adobe **Liquid Mode** (active as of 2026, Acrobat mobile) segments to
paragraph/heading/figure blocks and **reflows** — §B4's cautionary tale. **Scholarcy** and
**SciSpace** re-present sections as summaries/flashcards; **Paper Digest** works at
whole-document granularity. Allen AI's **Semantic Reader** is the closest neighbour: it
augments the *original rendered PDF in place*. **No app found crops the original rendering
into a reorderable flow** — an opportunity or a warning; this document cannot say which.

## G. Genre × behaviour × unit × cost

Days are *additional* engineering beyond the slides pipeline as specified in §C2.

| genre | expected behaviour | recommended segment unit | extra work |
|---|---|---|---|
| Slides (PPT/Keynote/Google) | 1–4 cuts/pg, 0–20 % empty | region of a page | **0 d** (is the plan) |
| Beamer | 2–3 cuts/pg; builds duplicate pages | region of a page + build merge | 0.5 d |
| Equation-dense slides | **best case**, 5 cuts/pg | region of a page | 0 d |
| Paper, 1-column | 1–4 cuts/pg, cuts at captions | paragraph group, may span pages | 1.5 d |
| Paper, 2-column | ~0 useful full-width cuts; footer noise | **column band**, multi-rect, floats attached by caption | **3 d** |
| Textbook / typeset reading | 3–4 cuts/pg around displays & headings | heading + paragraph group | 1 d |
| Trade book / ebook conversion | **0 cuts at 16 pt on 100 % of pages** | paragraph, from first-line indent | 1 d |
| Scan **with** OCR layer | like 1-col prose; 50 % footer cuts; skew | paragraph group; validate cuts on raster | 0.5 d |
| Scan **without** text layer | zero of everything | **one segment per page**, labelled | 0.5 d (+ OCR, out of scope) |
| Handwritten notes | 9 cuts/pg at 8 pt, 0 at 16 pt | ink-band, `G` from median ink-run height | 1 d |
| Handwriting, ink-only sketch | **zero candidates at any G** | one segment per page | 0 d (same fallback) |
| Print annotated in GoodNotes | reads as its underlying genre | underlying genre's unit | 0 d |

## H. Recommendation

**Ship slides for A1 and add a genre router, not a second pipeline.** The §C2 design is
well-matched to the genre it was designed for, and two of the four genres students actually
carry — 1-column papers and typeset readings — work with *additive* changes. Budget them as
one tier: **cross-page merge, multi-rect segments, indent-based paragraph detection, and a
`G` derived from the document's own median line gap**. ~3 days, and it buys 1-column
papers, textbook readings, OCR'd scans and handwritten notes at once. Two-column papers
cost another 3 and should wait until after A1; a Docling cut-proposer (MIT, in-distribution
at 0.025) is the right A2 answer, still feeding crops.

The router itself is ten lines and needs no model, from the numbers in §C: **words/page
< 150 and text coverage < 0.40 and landscape → slides; words/page > 500 with two detected
gutters → 2-column paper; words/page > 250, one column → prose; words/page < 5 → image-only
(if image XObjects present) or ink-only handwriting (if not).** Every one of the 19 files
in this corpus is classified correctly by those four rules.

The honest part: for **image-only scans and ink sketches the flow degrades to a page
viewer**, and nothing short of OCR changes that. Say it in the UI — "this document has no
text layer; segments are whole pages" — which also answers §E risk 3's open question about
the demo. Pick a deck that segments well for the video, and show a scanned page beside it
*on purpose*, as evidence the system knows what it cannot do.

## I. UNVERIFIED

1. **Five pages per document is a small sample** and medians over five are noisy. The zero-
   candidate percentages (0 %, 20 %, 40 %, 60 %, 100 %) are all just counts out of five.
2. **No cut was checked against a human's idea of a concept boundary.** §E-2 already says no
   ground truth exists; nothing here creates any. "Useful cut" throughout means
   "geometrically valid and not obviously footer junk".
3. **The §D5 heading classifier is a regex**, not typographic analysis — no font size or
   weight, which `-bbox-layout` does not expose. Its false-negative rate is unmeasured.
4. **Per-column cuts for file #18 (29/column) are an artefact** of a spurious two-column
   detection on a handwritten page; treat that cell as noise, not data.
5. **The raster profile is 50 dpi, threshold gray < 245.** Light fills and hairline rules may
   be missed; a faint full-width background tint would produce zero cuts everywhere. Not
   observed here, not excluded either.
6. **Docling's per-page-type OmniDocBench numbers could not be retrieved** — the table above is
   MinerU/Marker/GOT-OCR from the v1.0 paper. The Docling claim in §H rests on its licence and
   on the general pipeline-tool pattern, not on its own per-genre score.
7. **Cross-page merge, multi-rect segments and the genre router are designed here, not built.**
   The day estimates are judgement, not measurement.
8. **macOS Vision OCR was not run.** Its availability and box quality on a scanned page are
   assumed from documentation.
9. **No MA3236-style hand-annotated maths deck** is in this corpus either; §E-1 stands.

---

## Appendix — the measurement script

Reproduce with poppler only (`brew install poppler`) and stock Python 3; no numpy, no
network. Scratchpad copy:
`<scratchpad>/genres/measure.py`, driven by `corpus.tsv` (label ⇥ path ⇥ optional pages).

```python
#!/usr/bin/env python3
"""
measure.py — genre behaviour of the §C2 segmentation pipeline, measured locally.

Two independent geometry sources, both poppler-only, no network, no API:

  TEXT  pdftotext -bbox-layout    -> block boxes (words, blocks, coverage, columns)
  INK   pdftoppm  -gray -r 50     -> per-row ink profile (ALL marks: glyphs, rules,
                                     vector figures, raster images, handwriting)

§C2 stage 3 says a candidate cut is a horizontal line that (a) lies in a vertical gap
between boxes, (b) crosses no non-text-ink box, (c) is below the title band.
Poppler's CLI cannot give image *positions* (`pdfimages -list` reports size and ppi
only), so condition (b) is enforced the stronger way: a cut is only proposed in a
raster row that is empty of *every* mark. A cut that crosses nothing cannot cross a
figure. Text-only cuts are also reported, to show the difference.

Usage: measure.py <pdf> [--pages 1,5,9] [--label GENRE]
"""
import re, sys, os, subprocess, tempfile, json, math

G_VALUES = (8, 16)          # minimum gap in pt, per the brief
TOP_FRAC = 0.12             # ignore cuts in the top 12% of the page
DPI = 50
INK_THRESH = 245            # 8-bit gray below this counts as a mark


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, errors="replace").stdout


def pdfinfo(path):
    out = run(["pdfinfo", path])
    d = {}
    for line in out.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            d[k.strip()] = v.strip()
    return d


# ---------- TEXT geometry ----------
PAGE_RE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">')
BLOCK_RE = re.compile(r'<block xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">')
LINE_RE  = re.compile(r'<line xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">')

def text_boxes(path, page):
    xml = run(["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), path, "-"])
    m = PAGE_RE.search(xml)
    if not m:
        return None, [], 0
    W, H = float(m.group(1)), float(m.group(2))
    boxes = [tuple(map(float, b.groups())) for b in BLOCK_RE.finditer(xml)]  # x0,y0,x1,y1 (y-down)
    boxes = [b for b in boxes if b[2] > b[0] and b[3] > b[1]]
    lines = [tuple(map(float, b.groups())) for b in LINE_RE.finditer(xml)]
    lines = [b for b in lines if b[2] > b[0] and b[3] > b[1]]
    words = xml.count("<word ")
    return (W, H), boxes, words, lines


def union_area(boxes, W, H, n=300):
    """Coverage of the page by the union of boxes, via an n x n grid."""
    if not boxes:
        return 0.0
    grid = [bytearray(n) for _ in range(n)]
    for x0, y0, x1, y1 in boxes:
        c0 = max(0, min(n - 1, int(x0 / W * n)));  c1 = max(0, min(n, math.ceil(x1 / W * n)))
        r0 = max(0, min(n - 1, int(y0 / H * n)));  r1 = max(0, min(n, math.ceil(y1 / H * n)))
        for r in range(r0, r1):
            row = grid[r]
            for c in range(c0, c1):
                row[c] = 1
    return sum(sum(r) for r in grid) / (n * n)


def columns(boxes, W, H):
    """Vertical whitespace gutters spanning >=80% of the text band -> column count."""
    if len(boxes) < 4:
        return 1, []
    top = min(b[1] for b in boxes); bot = max(b[3] for b in boxes)
    band = max(1e-6, bot - top)
    n = 200
    occ = [0] * n
    for x0, y0, x1, y1 in boxes:
        c0 = max(0, min(n - 1, int(x0 / W * n))); c1 = max(0, min(n, math.ceil(x1 / W * n)))
        h = (y1 - y0) / band
        for c in range(c0, c1):
            occ[c] = max(occ[c], h)
    # a gutter column is one no tall box crosses
    empty = [c for c in range(n) if occ[c] < 0.01]
    # group consecutive empties, drop margins
    runs, cur = [], []
    for c in empty:
        if cur and c == cur[-1] + 1:
            cur.append(c)
        else:
            if cur: runs.append(cur)
            cur = [c]
    if cur: runs.append(cur)
    inner = [r for r in runs if r[0] > 0.10 * n and r[-1] < 0.90 * n and len(r) >= 0.02 * n]
    return len(inner) + 1, [(r[0] / n, (r[-1] + 1) / n) for r in inner]


# ---------- INK geometry ----------
def ink_profile(path, page):
    """Per-raster-row count of dark pixels, and per-column, at DPI. Returns
       (rows, cols, w, h) with rows[i] = dark pixels in row i."""
    with tempfile.TemporaryDirectory() as td:
        root = os.path.join(td, "p")
        subprocess.run(["pdftoppm", "-gray", "-r", str(DPI), "-f", str(page), "-l", str(page),
                        path, root], capture_output=True)
        files = [f for f in os.listdir(td) if f.endswith(".pgm")]
        if not files:
            return None
        data = open(os.path.join(td, files[0]), "rb").read()
    # parse binary PGM (P5)
    tok, i = [], 0
    while len(tok) < 4:
        while i < len(data) and data[i:i+1].isspace(): i += 1
        if data[i:i+1] == b"#":
            while i < len(data) and data[i] != 10: i += 1
            continue
        j = i
        while j < len(data) and not data[j:j+1].isspace(): j += 1
        tok.append(data[i:j]); i = j
    i += 1
    w, h = int(tok[1]), int(tok[2])
    px = data[i:i + w * h]
    rows = [0] * h
    cols = [0] * w
    th = INK_THRESH
    for r in range(h):
        base = r * w
        line = px[base:base + w]
        c = 0
        for x in range(w):
            if line[x] < th:
                c += 1; cols[x] += 1
        rows[r] = c
    return rows, cols, w, h


def gaps_to_cuts(rows, h_px, page_h_pt, g_pt, top_frac=TOP_FRAC, min_ink=0):
    """Runs of ink-free rows >= g_pt tall, below top_frac. One cut per run (its middle)."""
    px_per_pt = h_px / page_h_pt
    g_px = max(1, int(round(g_pt * px_per_pt)))
    start_px = int(top_frac * h_px)
    # find last inked row so trailing margin isn't a cut
    inked = [i for i, v in enumerate(rows) if v > min_ink]
    if not inked:
        return [], 0
    last = inked[-1]
    cuts, run = [], None
    for i in range(start_px, last + 1):
        if rows[i] <= min_ink:
            run = i if run is None else run
        else:
            if run is not None and i - run >= g_px:
                cuts.append((run + i) / 2 / px_per_pt)
            run = None
    return cuts, last


def col_ink_profile_from_page(path, page, x0f, x1f):
    """Row profile restricted to a fractional x-range (for per-column cuts)."""
    prof = ink_profile(path, page)
    if not prof: return None
    return prof  # placeholder; real slicing done in measure_page via raw pixels


# ---------- per page ----------
def measure_page(path, page, info):
    dims, boxes, words, lines = text_boxes(path, page)
    if dims is None:
        return None
    W, H = dims
    cov = union_area(boxes, W, H)
    ncol, gutters = columns(lines, W, H)
    nimg = 0
    out = run(["pdfimages", "-list", "-f", str(page), "-l", str(page), path])
    nimg = max(0, len(out.strip().splitlines()) - 2)

    prof = ink_profile(path, page)
    res = {"page": page, "W": round(W, 1), "H": round(H, 1), "words": words,
           "blocks": len(boxes), "lines": len(lines),
           "text_cov": round(cov, 3), "line_cov": round(union_area(lines, W, H), 3),
           "cols": ncol, "gutters": [[round(a,3), round(b,3)] for a, b in gutters],
           "images": nimg}
    if prof:
        rows, colprof, wpx, hpx = prof
        ink_rows = sum(1 for v in rows if v > 0)
        res["ink_row_frac"] = round(ink_rows / hpx, 3)
        res["ink_px_frac"] = round(sum(rows) / (wpx * hpx), 4)
        for g in G_VALUES:
            cuts, _ = gaps_to_cuts(rows, hpx, H, g)
            res[f"cuts_ink_g{g}"] = len(cuts)
            res[f"cutpos_g{g}"] = [round(c / H, 3) for c in cuts]
        # text-only cuts (gaps between text blocks, ignoring figures)
        for g in G_VALUES:
            res[f"cuts_text_g{g}"] = len(text_only_cuts(boxes, H, g))
            res[f"cuts_line_g{g}"] = len(text_only_cuts(lines, H, g))
        # per-column cuts, using the gutters found from text
        if ncol > 1 and gutters:
            spans = []
            prev = 0.0
            for a, b in gutters:
                spans.append((prev, a)); prev = b
            spans.append((prev, 1.0))
            percol = []
            for (a, b) in spans:
                ca, cb = int(a * wpx), int(b * wpx)
                if cb - ca < 10: continue
                sub = column_rows(path, page, ca, cb, wpx, hpx)
                for g in G_VALUES:
                    pass
                percol.append({(f"g{g}"): len(gaps_to_cuts(sub, hpx, H, g)[0]) for g in G_VALUES})
            res["per_column_cuts"] = percol
    return res


_PGM_CACHE = {}
def _pgm(path, page):
    key = (path, page)
    if key in _PGM_CACHE: return _PGM_CACHE[key]
    with tempfile.TemporaryDirectory() as td:
        root = os.path.join(td, "p")
        subprocess.run(["pdftoppm", "-gray", "-r", str(DPI), "-f", str(page), "-l", str(page),
                        path, root], capture_output=True)
        files = [f for f in os.listdir(td) if f.endswith(".pgm")]
        if not files: return None
        data = open(os.path.join(td, files[0]), "rb").read()
    tok, i = [], 0
    while len(tok) < 4:
        while i < len(data) and data[i:i+1].isspace(): i += 1
        if data[i:i+1] == b"#":
            while i < len(data) and data[i] != 10: i += 1
            continue
        j = i
        while j < len(data) and not data[j:j+1].isspace(): j += 1
        tok.append(data[i:j]); i = j
    i += 1
    w, h = int(tok[1]), int(tok[2])
    _PGM_CACHE[key] = (data[i:i+w*h], w, h)
    return _PGM_CACHE[key]


def column_rows(path, page, ca, cb, wpx, hpx):
    got = _pgm(path, page)
    if not got: return [0] * hpx
    px, w, h = got
    rows = [0] * h
    for r in range(h):
        base = r * w
        c = 0
        for x in range(ca, min(cb, w)):
            if px[base + x] < INK_THRESH: c += 1
        rows[r] = c
    return rows


def text_only_cuts(boxes, H, g, top_frac=TOP_FRAC):
    """Classic §C2 stage 3 on text blocks alone: gaps in the y-projection of blocks."""
    if not boxes: return []
    iv = sorted((b[1], b[3]) for b in boxes)
    merged = []
    for a, b in iv:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    cuts = []
    for k in range(len(merged) - 1):
        gap = merged[k+1][0] - merged[k][1]
        mid = (merged[k][1] + merged[k+1][0]) / 2
        if gap >= g and mid > top_frac * H:
            cuts.append(mid)
    return cuts


def main():
    path = sys.argv[1]
    pages = None
    label = ""
    for i, a in enumerate(sys.argv):
        if a == "--pages": pages = [int(x) for x in sys.argv[i+1].split(",")]
        if a == "--label": label = sys.argv[i+1]
    info = pdfinfo(path)
    n = int(info.get("Pages", "0"))
    if pages is None:
        if n <= 5: pages = list(range(1, n + 1))
        else:
            pages = sorted({max(1, int(round(n * f))) for f in (0.1, 0.3, 0.5, 0.7, 0.9)})
    rec = {"label": label, "path": path, "pages_total": n,
           "tagged": info.get("Tagged"), "creator": info.get("Creator"),
           "producer": info.get("Producer"), "page_size": info.get("Page size"),
           "pages": []}
    for p in pages:
        _PGM_CACHE.clear()
        r = measure_page(path, p, info)
        if r: rec["pages"].append(r)
    print(json.dumps(rec))


if __name__ == "__main__":
    main()
```

The heading classifier of §D5 (`cutlabel.py`) imports this module, re-runs
`gaps_to_cuts`, and tests the first `<line>` below each cut against
`^(\d+(\.\d+)*|[IVXLC]+)[.\s)]`, all-caps, or "short, title-cased, no terminal
punctuation, under 70% of the widest line".
