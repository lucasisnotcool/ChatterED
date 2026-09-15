# Lazy splitting: propose cuts, split only on click

*2026-09-15. Companion to `pdf-fidelity-segmentation.md` (what a segment is made of) and
`segmentation-cost.md` / `segmentation-genres.md` (what the pipeline costs, and how it behaves off
slides). This note answers one question Lucas raised on seeing the v3 mockups: what changes if the
flow does **not** split pages at import, and instead shows each page whole with proposed cut lines
that split only when the learner clicks them?*

## 1. What "lazy" means, precisely

| | Eager (v3 mockup, `pdf-fidelity-segmentation.md` §C2) | Lazy (this note) |
|---|---|---|
| Initial state of the flow | pages already cut into concept crops, labelled by the vision call | one segment per page (after build-group merge), whole-page crop |
| Where cuts come from | geometry candidates (Stage 3) **selected** by one vision call per page (Stage 4) at import | geometry candidates (Stage 3) shown as **proposed cut ticks**; nothing selected until clicked |
| Model involvement at open | one call per page, cached | none |
| Segment label | model's ≤ 6-word label | slide title from the text layer; after a split, the sub-segment's first text line — both editable |
| Merge | common — repairs an over-eager cut | rare — nothing was cut the learner did not ask for |
| Split | drag a guide; snaps to a candidate | click a tick (instant, snapped by construction); drag for a free cut |

Everything else is unchanged: crops of the rendered page, never re-typeset; Stage 0 build groups
and Stage 2 chrome removal still run (they decide *what counts as a page* and *which gaps are real*,
and both are free and local); AI chat segments, reorder, cross-page merge, the "Original pages"
toggle and the compare-on-hover proof all work on whole-page segments exactly as on sub-page ones.

## 2. What it buys

1. **Import becomes free and instant.** Stage 4 is the only network stage and the only stage with
   a per-page price. Removing it from the import path means a 200-page reading opens as fast as it
   renders, works with the network off, and never spends the CLI subscription's usage window on
   pages the learner will not look at. (`segmentation-cost.md` prices the difference.)
2. **Every boundary is authored.** The fidelity brief already concluded that concept boundaries
   have no ground truth (§B5, §E-2) and reframed evaluation from "was the segmentation right?" to
   "how often does the learner adjust it?" Lazy mode makes that reframing structural: the learner
   never repairs a machine cut, so the log is a clean record of *accepted proposals* versus *free
   cuts*, which is a better Assignment 2 measure than a repair count.
3. **The fidelity demo gets stronger, not weaker.** In the video the viewer watches a whole slide,
   sees a tick, clicks it, and the slide divides in place with no re-render. That is a visible proof
   that the pixels were never converted. An already-segmented flow asks the viewer to take it on
   trust.
4. **The worst-case corpus stops being a failure.** Risk 3 in the fidelity brief was that a dense
   maths deck or a scan degrades to one segment per page and "looks like the old viewer". In lazy
   mode that is simply the normal starting state of every deck, so nothing looks broken.
5. **Merge almost disappears from the A1 build.** Same-page merge is still needed to undo a split,
   but the cross-page merge card (an ordered list of crops in one card) can move to A2.

## 3. What it costs

1. **The first impression is a page viewer with ticks.** This is the real risk. The flow must
   look *different* from `PdfViewer.svelte` within seconds, or the pivot's visible value is gone.
   What does that work: the build-group merge (a Beamer deck of 60 pages opens as 22 slides with
   "⏴ 3 build steps" chips), the "+ Ask here" line under every card, the drag handles, and the tick
   affordance itself. The mockup's Main artboard should be redrawn to show this state honestly.
2. **Labels are weaker.** Slide titles are usually good labels for whole-page segments; first-line
   labels after a split are mediocre. The learner can type, and the vision call can be reintroduced
   later as an on-demand "Suggest names" or "Suggest cuts for this page" action.
3. **Questions about a region need a region.** In eager mode the learner asks under a concept crop.
   In lazy mode a whole-page segment may hold three concepts; "Ask here" then needs either a split
   first, or a drag-to-select region on the crop that anchors the answer to a rectangle
   (`pivot-spec.md` §A already models region anchors). Recommend the second: selecting a region
   should *offer* to split at the nearest ticks, not require it.
4. **Two-column slides get no automatic vertical cut.** Ticks are horizontal. A vertical tick in
   the column gutter is the same computation rotated (fidelity brief §C6) and can be a tick too, but
   it is easy to defer.

## 4. Interaction details worth fixing now

- **Ticks live outside the pixels.** The never-draw-on-slide rule (§C3) holds: a tick is a short
  mark in the card's gutter at the candidate's `y`; hovering it draws the full dashed guide across
  the crop; clicking splits. Only the active guide is ever drawn over slide pixels.
- **Tick strength encodes evidence.** Geometry-only ticks are faint. If the vision call is ever
  run for a page (on demand, or in the background for the visible page ± 2), its accepted cuts are
  drawn stronger and get a hover label. The model never splits anything; it only changes how
  confident a tick looks. This keeps the fidelity brief's line intact: *the model proposes cuts,
  the renderer supplies pixels, the learner decides.*
- **Free cuts snap, then release.** Dragging a guide snaps to a tick within ~8 pt; holding a
  modifier releases the snap. A cut through a figure is refused with the "won't cut a figure"
  message already in the Split artboard.
- **Split is undoable and merge is its inverse.** Both are one number in page space (§C5), so
  the undo stack is trivial and should exist from Day 3.

## 5. Recommendation

Adopt lazy splitting as the default and the Assignment 1 scope. Concretely, relative to
`pdf-fidelity-segmentation.md` §C7: Day 1 and Day 2 are unchanged (geometry, build groups, chrome,
candidate cuts, crop renderer), Day 3 builds tick-click split, same-page merge, reorder and the
Original-pages toggle, and **Day 4's vision call moves out of A1 entirely**. That removes the only
API dependency, the only per-page cost, the CLI-vision question (see `segmentation-cost.md`), and
the most visible failure mode (wrong automatic cuts) from the deadline path. The vision pass returns
in A2 as an optional, per-page, on-demand suggestion that strengthens ticks and proposes names.

The one thing to verify before committing to it is the first-impression risk in §3.1: redraw the
hero artboard in the lazy state and judge whether a whole-slide flow with ticks, build chips and
"+ Ask here" lines reads as a new kind of document or as a viewer. If it reads as a viewer, the
cheapest fix is not the vision call but a default "auto-split at the strongest geometric gaps" that
only fires when a gap is unambiguous (a title band followed by a single large whitespace gap), which
is still free and local.
