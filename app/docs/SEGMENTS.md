# Segments — the contract

**Issue #25 (the flow, geometry-only) and #31 (the genre router). Built 15 Sep 2026.**

The flow opens every page whole and *proposes* cuts as faint ticks in the card gutter. Nothing
is cut until the learner clicks one. There is **no model call anywhere in this path** — stages
0–3 are local, free, offline and deterministic, which is why a deck opens instantly, works with
the network off, and cannot fail on camera (`docs/research/segmentation-lazy-split.md` §2).

This file is the contract for whoever builds the renderer. The code is the authority; where they
disagree, the code is right and this file is a bug.

- **Pure package:** `src/shared/segment/` — one import, `src/shared/segment/index.js`. No
  Electron, no SQLite, no pdf.js, no DOM.
- **The one impure module:** `src/main/vault/geometry.ts` — pdf.js in, `PageGeometry[]` out.
- **The service:** `src/main/vault/segments.ts` — filesystem + cache + SQLite.
- **Persistence:** `src/main/db/migrations/009_segments.sql`, `src/main/db/repos/segments.ts`.
- **Tests:** `src/shared/segment/segment.test.ts` (38), `src/main/vault/geometry.test.ts` (6),
  `src/main/vault/segments.test.ts` (6).

---

## 1. Coordinates — read this first

**Every rectangle is normalised 0–1 against the page box, with `y` measured DOWN from the page
top.** That is the crop convention (`pivot-spec.md` §A2) and the canvas convention, so a segment
multiplies straight into

```js
ctx.drawImage(pageCanvas, s.x0 * W, s.y0 * H, (s.x1 - s.x0) * W, (s.y1 - s.y0) * H, 0, 0, dw, dh);
```

with no flip. PDF user space is y-**up**; the flip happens once, in the extractor, and never
again. Anything measured in points carries `Pt` in its name (`gapPt`, `snapPt`) and is converted
against the page's own `width`/`height` from `SegmentDocumentView.pageSizes`.

---

## 2. Types

```ts
interface Segment {
  page: number;                     // 1-indexed, after the build-group merge
  x0: number; y0: number;           // normalised, y down
  x1: number; y1: number;
  label: string;
  source: 'geometry' | 'learner';   // who drew this boundary
}

interface SegmentView extends Segment {
  id: string;                       // stable across split/merge/reorder — address a card by this
  order: number;                    // contiguous from 0
  buildSteps: number[];             // Stage 0: the "⏴ N build steps" chip
  candidates: CutCandidate[];       // the ticks this card draws
}

interface CutCandidate {
  page: number;
  axis: 'horizontal' | 'vertical';
  at: number;                       // normalised: a y for horizontal, an x for vertical
  gapPt: number;                    // the whitespace gap it sits in, in points
  blockedBy: null | 'figure' | 'title-band' | 'gap-too-small' | 'chrome';
}

type Genre = 'slides' | 'paper-2col' | 'prose' | 'image-only' | 'ink-only';

interface SegmentDocumentView {
  fileId: string;
  contentSha: string;
  genre: Genre;
  notice: string | null;            // null for slides; a sentence above the first card otherwise
  pageCount: number;                // kept pages
  pageSizes: Array<{ page: number; width: number; height: number }>;  // PDF points
  builds: Array<{ page: number; steps: number[] }>;
  segments: SegmentView[];
  refused: { reason: string; message: string } | null;
}
```

`PageGeometry` (`page`, `width`, `height`, `textBoxes[]`, `inkBoxes[]`, `chrome: boolean[]`,
`struct?`, `imageCount`) is the extractor's output. The renderer does **not** need it — it is an
input to the pure stages and is not sent over IPC.

`source` is the Assignment-2 measure. `'geometry'` means the boundary came from a whole-page
segment or from clicking a tick; `'learner'` means a free cut or a merge. The evaluation
question is *accepted proposals vs free cuts*, not a repair count
(`segmentation-lazy-split.md` §2.2), and this one field answers it.

### Ticks

- `blockedBy === null` → draw the tick. Hovering draws the dashed guide across the crop;
  clicking splits.
- `blockedBy !== null` → **do not draw a tick.** These are near-misses, carried so the UI can
  explain a refusal and so a free drag can still snap to a real-but-small gap. `'figure'` is the
  "won't cut a figure" case and is reported at the `y` the learner was aiming at.
- Ticks live **outside the slide pixels** (§C3). Only the active guide is ever drawn over a crop.

---

## 3. IPC

All five return a complete `SegmentDocumentView`. A refused operation returns the view
**unchanged** with `refused` set — it never throws, so there is no try/catch around a gesture.

| Channel | `window.chattered.…` | Input |
|---|---|---|
| `segments:get` | `getSegments` | `{ fileId }` |
| `segments:split` | `splitSegment` | `{ fileId, segmentId, at, axis?, free? }` |
| `segments:merge` | `mergeSegments` | `{ fileId, segmentIds: [a, b] }` |
| `segments:reorder` | `reorderSegments` | `{ fileId, segmentId, toIndex }` |
| `segments:rename` | `renameSegment` | `{ fileId, segmentId, label }` |

- `at` is normalised on the cut's own axis. `axis` defaults to `'horizontal'`.
- `free: true` releases the snap (the modifier key). Without it, the cut snaps to the nearest
  candidate within **8 pt**, and a snapped cut is recorded as `source: 'geometry'`.
- A cut that would cross a figure is refused **even when `free`**.
- `merge` is same-page and adjacent-only for now. Cross-page merge (an ordered list of crops in
  one card) is A2.
- The sentences in `refused.message` come from `refusalMessage()` in
  `shared/segment/types.ts` — use them verbatim rather than writing your own.

---

## 4. Pure functions worth calling from the renderer

The renderer should do its own snapping *preview* with the same arithmetic the main process
uses, so the guide lands where the split will:

```ts
import {
  snapTo, checkPartition, acceptedCuts, labelFor, DEFAULTS,
} from '../../shared/segment/index.js';

const snapped = snapTo(y, 'horizontal', segment.candidates, pageHeightPt, DEFAULTS.snapPt);
```

`splitSegment`, `mergeSegments`, `reorderSegments` and `wholePageSegments` are exported too, and
are what the service itself calls — use them for an optimistic local update, then reconcile with
the view the channel returns.

---

## 5. Invariants (asserted in tests, in the spirit of the whisper-leak canary)

`checkPartition(segments, pages)` returns the violations and `[]` when all three hold. It is
called after **every** operation in the tests, and the renderer may call it in a dev assertion.

1. **Every page is fully covered by its segments.** No orphaned strip of slide.
2. **Segments never overlap.**
3. **Split and merge are inverses.** Both only ever change numbers, so the original page box is
   always recoverable — the structural form of *the slide is the arbiter* (§C5).

Two more, enforced by the service rather than by geometry:

4. **A segment id is stable.** Splitting keeps the cut segment's id for the upper half and mints
   one for the lower; reordering and renaming mint nothing.
5. **A touched document is never recomputed.** Once the learner has split, merged, reordered or
   renamed anything, `segments_touched` is written and the pipeline never runs for those bytes
   again, not even across a pipeline-version bump. SQLite is the source of truth
   (`pivot-spec.md` §A3).

---

## 6. The pipeline

Run once per file, keyed on `content_sha`, cached in SQLite, never repeated on reopen.

| Stage | What it does | Where |
|---|---|---|
| **0 — build groups** | Consecutive same-size pages whose earlier tokens are ≥ 95 % contained in the later page collapse onto the **last** page. The others become `buildSteps`. | `builds.ts` |
| **1 — geometry** | Text items → boxes (zero-width `hasEOL` items dropped); non-text ink via a CTM walk over `getOperatorList`; tagged struct roles if present. | `main/vault/geometry.ts` |
| **2 — chrome** | Text repeating verbatim at the same normalised position on ≥ 60 % of pages is chrome: **excluded from cut detection, included in every crop.** | `chrome.ts` |
| **3 — candidate cuts** | Horizontal lines in whitespace gaps ≥ `G` (16 pt for slides) crossing no ink and below the title band (top 12 %); one vertical candidate when the body text below the title band forms exactly two x-clusters (§C6). | `cuts.ts` |
| **4 — vision** | **Not built. Not in A1.** It returns in A2 as an on-demand "suggest cuts / suggest names" that only strengthens ticks. | — |

### The container rule — the one thing not in the briefs

§B1.3's 8 pt ink merge fuses a slide's panel outlines, table rules and card backgrounds into one
page-sized box. Read as a *figure*, such a box refuses every cut on the page: measured, 5 of the
fixture's 7 pages went to zero candidates.

Measured on the fixture deck, the separation is not subtle:

| ink box | share of the page's text runs it holds |
|---|---|
| page 4's screenshot, page 1's icon, page 6's lower panel | 0 %, 13 %, 16 % |
| page 3's two panels, page 2's card, page 6's left panel, page 5's background | 44 %, 52 %, 44 %, 51 %, 100 % |

So an ink box holding ≥ **25 %** (`CONTAINER_TEXT_SHARE`) of its page's text runs is a
`'container'` — drawn *behind* text — and does not block a cut. Only `'path'` and `'image'` do.

### Labels

Slide title from the text layer: the tagged `H1`–`H6` box if the PDF is tagged (PowerPoint marks
the title `H2`), otherwise the largest font, tie-broken topmost. After a split, a sub-segment
takes its **first text line**. Both are editable, and `segments:rename` is a learner edit like
any other.

### The genre router (§H, issue #31)

```
words/page < 5                                       → image-only (if image XObjects) else ink-only
words/page < 150 and coverage < 0.40 and landscape   → slides
words/page > 500 and ≥ 2 columns                     → paper-2col
words/page > 250                                     → prose
otherwise                                            → prose
```

Only `'slides'` produces candidates in A1. Everything else opens as whole-page segments with a
notice. Two readings of §H had to be fixed to make it executable, and both are argued in
`genre.ts`: "two detected gutters" is read as *two columns*, and the fallback is `'prose'`
because a misroute there costs a notice, never a wrong cut.

---

## 7. Measured on the fixture deck

`Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf` — 7 pages,
959.76 × 540 pt (16:9), PowerPoint, tagged. Pinned in `geometry.test.ts`, so a threshold change
tells you which page moved.

Router signals: **119 words/page, 0.235 text coverage, 1 column, landscape, 2 image XObjects →
`slides`**. No build groups (no progressive reveals) and no chrome (no master footline).

| page | accepted cuts | at | blocked | reasons | title |
|---|---|---|---|---|---|
| 1 | **4** | y 0.510, 0.634, 0.747, 0.833 | 0 | — | `/btw` |
| 2 | **2** | y 0.306, 0.451 | 2 | figure | `“Use /btw to ask a question about your current work` |
| 3 | **3** | y 0.377, 0.535, 0.792 | 3 | gap-too-small | `/btw as a whisper` |
| 4 | **0** | — | 13 | figure, gap-too-small | `/btw vs. texting in a meeting (or, students chatting with lecturer is talking)` |
| 5 | **2** | y 0.240, 0.842 | 0 | — | `Limit Tests of /btw show it adheres to Claude Code’s specs` |
| 6 | **3** | y 0.494, 0.634, **x 0.482** | 1 | figure | `/btw removes context penalty, encourages user participation` |
| 7 | **4** | y 0.317, 0.673, 0.757, **x 0.824** | 3 | figure, gap-too-small | `From silent whispering to speaking up at meeting` |

**18 accepted candidates over 7 pages, 0–4 per page, one empty page (14 %).**
`segmentation-genres.md` §D1 measured 1–5 per page with 0–20 % empty across four exporters, so
this deck sits inside that range.

Page 4 is §C6's case, and it behaves exactly as §C6 predicts: a full-height screenshot beside a
bullet list, so every horizontal cut is refused as `'figure'`, and the only remaining proposal is
a **vertical** one — itself refused, because this deck's gutter falls over the screenshot. Page 6
is the case where the vertical cut *works*: two panels, gutter at x 0.482, offered.

---

## 8. Not built, and known limits

- **Stage 4, the vision pass.** Out of A1 by decision (issue #25 decision 4).
- **Cross-page merge.** Same-page only; A2 (`segmentation-lazy-split.md` §2.5).
- **Non-slide genres get whole pages and a notice.** Papers, readings, scans and handwriting are
  tracked in their own Assignment-2 issues. `G` is a *slides* constant (16 pt); §D3 says it must
  be derived from the document's own median line gap before prose is worth attempting.
- **Rotated text.** A text item with a non-zero shear (`transform[1]`/`[2]`) gets an
  axis-aligned box computed from its baseline and width, which is wrong for vertical or rotated
  runs. Not observed on any deck in the corpus; **unverified** beyond that.
- **Method 2 for ink** (`recordOperations` on `page.render()`, §B1.3) is strictly better and
  needs a real canvas. When the renderer has a page canvas to hand, it can replace the CTM walk.
- **Slide numbers are not chrome.** "3" then "4" does not repeat verbatim. Correct here — a
  digit in a corner opens no gap a cut could use — but it means a page-number box is a body box.
