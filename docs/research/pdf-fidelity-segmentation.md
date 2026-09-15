# High-fidelity segmentation of lecture slides

**Question.** ChatterED is pivoting to a *flow*: a lecture PDF becomes ONE continuous vertical
document, cut into concept segments the learner can split, merge and reorder, with AI conversation
segments inserted between them. Lucas's constraint, stated today: **the generated segments must map
closely to the original slides — preserve the original slide with high fidelity.**

**Answer, in one line.** Do not convert. **A segment is a crop of the original rendered page**,
never a re-typeset copy; region boundaries come from text geometry you already get free from pdf.js,
corrected by one Claude vision call per page and, finally, by the learner's own split/merge. A
reflowed view is a *second*, optional, clearly-labelled mode — never the default, never the store.

**Status.** Section A is measured on this machine against PDFs in the repo plus a synthetic
Beamer deck built for the purpose. Section B's pdf.js facts are verified against the installed
`pdfjs-dist` 6.3.289 source and type definitions, not from memory. Sources are cited inline;
anything I could not verify is marked **UNVERIFIED**.
Date: 2026-09-15. Repo: `/Users/lohzh/ChatterED`.

Read alongside: `docs/research/pivot-integrated-document.md` §D (four approaches: overlay / convert /
blocks / hybrid) and `docs/research/pivot-spec.md` §A (block + anchor model). **This document does not
overturn those. It refines §D4 (hybrid) from "page images as immutable blocks" to "*page-region crops*
as immutable blocks", which is the same architecture at finer granularity** — and it says why the
finer granularity is safe, which §D could not, because §D had no measurements.

## Contents

- [A. The fidelity problem, stated precisely](#a-the-fidelity-problem-stated-precisely)
- [B. Approach catalogue, with evidence](#b-approach-catalogue-with-evidence)
- [C. Recommendation for ChatterED](#c-recommendation-for-chattered)
- [D. Mockup brief](#d-mockup-brief)
- [E. Risks and open questions](#e-risks-and-open-questions)

---

## A. The fidelity problem, stated precisely

### A0. The shape of the problem

"Fidelity" is doing two jobs in Lucas's sentence and they must be separated, because one is free and
the other is nearly impossible.

1. **Visual fidelity** — the segment *looks like* the slide: same fonts, same kerning, same diagram,
   same highlight, same colour. **This is free if you never re-render from semantics.** pdf.js already
   draws the page correctly; a crop of a correct raster is a correct raster.
2. **Semantic fidelity** — the segment *is* the slide's meaning, recovered as structured content you
   could reflow, restyle, search, or feed to a model as LaTeX. **This is the research problem**, and on
   slides it is the *worst-case* of that research problem.

Every converter in §B2 buys (2) by spending (1). The whole recommendation in §C is: **buy (1)
outright, and buy as much of (2) as is cheap, and never let a failure of (2) damage (1).**

The reason this is even tractable is a fact the measurements below make concrete:

> **The geometry is exact. The semantics are not.** pdf.js hands you the position of every glyph to
> sub-point precision, and hands you a string for those glyphs that is, on maths, frequently wrong.
> Segmentation is a geometry problem. Conversion is a semantics problem. Do the geometry one.

### A1. What actually breaks — measured, on this machine

Two decks were measured. Neither is MA3236, which is not in the repo; §A4 says what that changes.

**Deck 1 — a real slide deck in the repo.**
`Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`
7 pages, 959.76 × 540 pt (16:9), `Producer: macOS Version 26.0 Quartz PDFContext`,
`Tagged: yes`, 11 embedded subset fonts (Aptos, Cambria, Consolas).

**Deck 2 — a synthetic Beamer deck** built here with `pdflatex` (TeX Live, `\documentclass[aspectratio=169]{beamer}`,
`amsmath`, `tikz`) to stand in for MA3236-style maths slides. Source and PDF are in the scratchpad;
the `.tex` is reproduced in §A5 so the result can be re-run.

#### A1.1 Slides are mostly *not text*, and papers are

The single most useful number. `pdftotext -bbox-layout` gives a bounding box for every block; the
table is the fraction of page area covered by the union of those boxes.

| Document | words/page | text blocks/page | poppler "flows"/page | **page area covered by text boxes** |
|---|---|---|---|---|
| ACM paper, 2-column (`3757633.pdf`, pp. 2–7) | 585–677 | 4–10 | 4–7 | **62–66 %** |
| Real slide deck, p. 5 (densest) | 153 | 22 | 21 | 40.6 % |
| Real slide deck, p. 4 (2-col + screenshot) | 140 | 15 | 4 | 27.2 % |
| Real slide deck, p. 3 (diagram slide) | 59 | 12 | 9 | **9.7 %** |
| Beamer maths, KKT page | 74 | 10 | 7 | 13.1 % |
| Beamer TikZ figure page | 14 | 7 | 6 | **2.2 %** |

Read that last row again. On a TikZ figure slide, **97.8 % of the page carries no text at all** — the
axes, the shaded feasible region, the arrows are vector operators with no textual representation
whatsoever. A text-extraction pipeline reproduces that slide as the three words `x2`,
`feasible region`, `x1`. A crop of the rendering reproduces it exactly.

This is the empirical core of the argument. *For papers, text ≈ the document. For slides, text is a
minority of the document* — and the majority that is not text is precisely the part students find
hardest and most want to ask about.

#### A1.2 Maths becomes glyph soup — and it is worse than "unformatted"

The Beamer deck's KKT page contains `\sum_{i=1}^{m} \lambda_i \nabla g_i(x^\star)` and
`\frac{\partial\mathcal{L}}{\partial x_j}` and a 2×2 `pmatrix`. Verbatim `pdftotext` output:

```
KKT conditions

P
⋆
Stationarity: ∇f (x ⋆ ) + m
i=1 λi ∇gi (x ⋆ ) = 0
Complementary slackness: λi gi (x ⋆ ) = 0
so either λi = 0 or the constraint is active
m

X
∂L
= cj −
aij yi ,
∂xj
i=1



σ11 σ12
Σ=
σ21 σ22
```

Five distinct, independently fatal failures, each named:

1. **Summation signs become letters.** The two `∑` glyphs came out as `P` and `X`. These are Computer
   Modern Extension (CMEX) glyphs whose encoding has no reliable `ToUnicode` mapping, so the extractor
   falls back to the glyph name / StandardEncoding slot. *This is not a missing character — it is a
   plausible wrong character*, which is much worse: it survives every downstream sanity check.
2. **Limits detach from their operator.** The upper limit `m` landed at the end of the *previous*
   line; the lower limit `i=1` starts the *next* one. The sum is no longer recoverable even by a
   careful human reader of the text.
3. **Fractions lose their bar and split across lines.** `∂L` and `∂xj` are three lines apart with
   `= cj −` between them. The fraction rule is a filled rectangle — a vector operator, not text — so
   it vanishes silently.
4. **Matrix delimiters vanish.** The big parentheses of `pmatrix` are CMEX glyphs; the rows `σ11 σ12`
   / `σ21 σ22` survive, stripped of any sign that they are a matrix.
5. **Sub/superscripts flatten into the baseline.** `x^\star` → `x ⋆`, `\lambda_i` → `λi`,
   `B^{-1}` → `B −1`. `c_B^\top B^{-1} N` → `cB⊤ B −1 N`. Once flattened, `B −1` and `B − 1` are
   indistinguishable.

**The geometry, by contrast, is perfect.** Same page, `-bbox-layout`:

```xml
<word xMin="140.797" yMin="87.087" xMax="152.313" yMax="94.068">P</word>      <!-- the ∑ -->
<word xMin="152.313" yMin="85.147" xMax="159.038" yMax="92.224">m</word>      <!-- upper limit -->
<word xMin="152.313" yMin="93.399" xMax="165.943" yMax="100.476">i=1</word>   <!-- lower limit -->
<word xMin="168.257" yMin="88.134" xMax="174.620" yMax="97.821">λ</word>
<word xMin="174.621" yMin="91.878" xMax="176.641" yMax="98.955">i</word>      <!-- subscript: baseline +3.7pt -->
```

The `∑` is in exactly the right place. Its limits are stacked above and below it, to three decimal
places. The subscript `i` sits 3.74 pt below `λ`'s baseline and is 30 % smaller. **Everything needed
to draw a correct equation is present; everything needed to *read* one is missing.** A crop needs only
the former.

#### A1.3 Reading order breaks on free-floating slide layouts

Real deck, page 3 (rendered and inspected): two rounded panels, HUMAN-HUMAN above HUMAN-AI, each with
vector figure-icons and five floating speech bubbles. Visual order of the top panel's bubbles is
left→right: *"Is there something wrong with the slide?"*, *"Yeah, I cannot see the screen too!"*,
*"Sorry, I think there's something wrong.."*, *"Oh! Thanks for the catch!"*.

`pdftotext` emits them in this order:

```
“Sorry, I think there’s something wrong..”      (3rd visually)
“Is there something wrong with the slide?”      (1st)
“Oh! Thanks for the catch!”                     (4th)
“Yeah, I cannot see the screen too!”            (2nd)
```

The narrative — a sequence, with an arrow drawn between stages — is destroyed. And the arrow itself,
which *is* the claim the slide makes, has no text representation at all. A converter can only ever
give you a bag of quotations. The crop gives you the argument.

#### A1.4 Two-column slides and text baked into screenshots

Real deck, page 4: title + highlighted lead line, then a full-bleed 1700 × 1349 screenshot of an app
on the left and a numbered bulleted argument on the right, with a 6 pt Consolas citation underneath.

- The screenshot is a raster image (`pdfimages -list`: page 4, 1700 × 1349, ICC, with an `smask`).
  **None of its text appears in the text layer** — verified: the extracted page text jumps straight
  from `Agent did not need interjection…` to `Silent Whispering (Dennis et al., 2010):`. A converter
  either drops the screenshot's content entirely or OCRs it and invents some. A crop keeps it, pixel
  for pixel, including the green callout box the author drew on it.
- The **yellow highlight** on the word *disruptive* is a filled rectangle drawn behind the text. It is
  not a property of the text run; convert to Markdown and it is gone. It is an authorial emphasis — a
  thing the lecturer *did* — and losing it loses meaning.
- Poppler merged the two columns into **4 flows** on this page while giving page 5 **21 flows**. Flow
  grouping is unstable across slides of the same deck, so it cannot be a segmentation primitive by
  itself (§A2).

#### A1.5 Animation builds duplicate slides — and this one is specific to the flow concept

The Beamer deck has **4 frames** and produces **6 PDF pages**, because one frame uses `\item<1->`,
`\item<2->`, `\item<3->`. Extracted:

| PDF page | text |
|---|---|
| 3 | `Simplex, built up` / `Start at a basic feasible solution xB = B −1 b` |
| 4 | …the same, **plus** `Price out: c̄N = cN − cB⊤ B −1 N` |
| 5 | …the same, **plus** `If c̄N ≥ 0, stop: optimal.` |

All three carry the footline `3/1` — Beamer's own frame number, which correctly says *these are one
frame*. The concept segmenter must see one concept, not three, and must show the **last** page of the
build (the complete one), not the first. Getting this wrong is the most visible possible failure of
the flow concept: the learner scrolls and sees the same slide three times, growing.

Detection is cheap and should be built on day one: pages are a build group when they share a page
size and the **earlier page's text is a prefix-subset of the later page's** (≥ 95 % token containment
and no tokens lost). Keep the last; keep the others addressable behind an *"⏴ 3 build steps"* control.
Beamer's `\setbeamertemplate{frame number}` footline gives a second, independent signal for free when
it is present. **UNVERIFIED** that the same containment test works on PowerPoint appear-animations,
which usually do *not* export as separate pages at all (PowerPoint's *Save as PDF* flattens a slide to
one page and drops the animation entirely) — so this is a Beamer/`pdfpc` problem more than a
PowerPoint one. Note the asymmetry cuts the other way too: PowerPoint flattening means an
appear-animation slide arrives with *all* its content visible at once, which is what we want.

#### A1.6 Slide chrome repeats on every page

The Beamer footline (`MA3236-style Optimisation` · `September 15, 2026` · `3/1`) and headline appear
on all 6 pages; the real deck has a running title band on pages 2–7. Any segmenter that treats the
page as a flat list of blocks will emit a "concept segment" containing only the footer. The fix is
trivial and must not be skipped: **a block whose text repeats verbatim at the same (x, y) on ≥ 60 % of
pages is chrome** — excluded from segmentation, included in the crop (because it is part of how the
slide looks). Docling exposes the same idea as a `content_layer` flag (§B2).

#### A1.7 Fonts and speaker notes

- **Fonts.** All 11 fonts in the real deck are **embedded and subsetted** (`emb yes sub yes`) — Aptos,
  Cambria, Consolas. A converter that emits HTML/Markdown must either re-embed the subset (pdf2htmlEX
  does; §B3) or substitute, and substitution changes line-breaking, which changes where a bullet wraps,
  which changes the visual rhythm the lecturer composed. Rendering sidesteps the entire question.
- **Speaker notes.** Neither deck carries them: `pdfinfo` reports no embedded-notes stream, and
  PowerPoint's *Save as PDF* writes notes only if you explicitly choose the "Notes Pages" layout, in
  which case the note becomes *page text below a shrunken slide image* and is indistinguishable from
  slide content to any text-based tool. Beamer's `\note{}` with `\setbeameroption{show notes on second
  screen}` emits notes as **extra pages of double width**. Both cases are detectable by page geometry
  (a page whose aspect ratio differs from the deck's mode) and both must be detected, or the flow will
  contain a "concept" that is really the lecturer's private crib sheet. **Partly UNVERIFIED** — I could
  not test either export on this machine.

### A2. Why poppler's own block grouping is not a segmentation

Tempting shortcut: `pdftotext -bbox-layout` already returns `<flow>` and `<block>` — use those as
segments. The measurements say no.

- Flow count per slide in the real deck: **4, 17, 9, 4, 21, 12, 14**. Page 2 has 17 flows for 115
  words. Three side-by-side one-word labels — `Text-based`, `Task-oriented`, `Agentic` — became
  **three separate flows**. Poppler's flow heuristic is tuned for running prose in columns; on slide
  layouts it fragments into tag-sized pieces.
- Blocks are more stable (7–22/slide) and are the right *raw material*, but a concept on a slide is
  typically **title + 3–6 blocks + a figure** — a merge, not a block.
- And no block-based method can ever see the figure, because figures are not blocks. Any segmenter
  built only on text boxes will draw a boundary straight through a diagram.

**Conclusion carried into §C:** text blocks give you *candidate horizontal cut lines* and nothing more.
The cut lines must be validated against where the ink is — including non-text ink.

### A3. The problem restated as three requirements

1. **R1 — A segment must never be re-typeset.** Any pipeline whose output is glyphs re-laid-out by us
   fails §A1.2 the first time it meets a `\sum`, and fails visibly, on the exact content the learner
   opened the app to understand.
2. **R2 — A segment boundary must respect non-text ink.** 2.2–40 % text coverage means boundaries
   derived from text alone will cut figures in half (§A1.1, §A2).
3. **R3 — The learner must be able to fix boundaries in one gesture.** Nothing in §B gets slide
   segmentation right every time. The correction loop is not a fallback; it is part of the design, and
   it is cheap *only if a boundary is a number in page space* (§C5).

### A4. What I could not measure, and what it would change

- **MA3236 (or any real maths-heavy lecture deck) is not in the repo.** The Beamer deck in §A1.2 is
  synthetic and I wrote it, which means I chose the equations. It is representative of `amsmath` +
  Computer Modern output — the `∑`→`P` failure is a property of CMEX encoding, not of my choices —
  but the *density* of maths, the presence of hand-drawn annotations, and whether the lecturer's
  slides are Beamer, PowerPoint-with-equation-editor, or scanned iPad notes are all unknown.
  **Get one real MA3236 deck before Day 2 and re-run §A1.1's coverage measurement on it.** It is a
  ten-minute check and it is the single highest-value piece of missing evidence in this document.
- **PowerPoint equations** (OMML → PDF) encode differently from `amsmath` and may carry usable
  `ToUnicode`. **UNVERIFIED.** If they do, inline maths in PowerPoint decks extracts better than §A1.2
  suggests. It changes nothing about display equations, matrices, or figures.
- **Scanned / photographed slides** have no text layer at all. Everything geometric in §C degrades to
  "the whole page is one segment" — which is still correct, still faithful, and still usable. Good
  failure mode.

### A5. Reproducing the measurements

```sh
SRC="Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf"
pdfinfo  "$SRC"                      # producer, tagged, page size
pdffonts "$SRC"                      # embedded + subsetted
pdfimages -list "$SRC"               # the page-4 screenshot: 1700x1349, raster
pdftotext -f 3 -l 4 "$SRC" -         # scrambled reading order (§A1.3)
pdftotext -bbox-layout "$SRC" out.html   # exact geometry (§A1.2)
pdftoppm  -r 80 -f 3 -l 4 -png "$SRC" slide
```

The synthetic Beamer deck (`deck.tex`) is 4 frames: an `align` with `\max_y b^\top y`; a KKT frame
with `\sum`, `\frac{\partial\mathcal L}{\partial x_j}` and a `pmatrix`; an overlay frame with
`\item<1->`/`<2->`/`<3->`; and a TikZ axes-plus-shaded-polygon figure. Build with
`pdflatex -interaction=nonstopmode deck.tex`. The coverage script is 20 lines of Python that unions
`<block>` boxes onto a 200 × 200 grid.

---

## B. Approach catalogue, with evidence

Five families. Only the first satisfies R1 (§A3) by construction; the rest buy semantics by
spending pixels. Read this section as *"which of these can I use as an **index** over the pixels"*,
not *"which of these replaces the pixels"* — that reframing is the whole of §C.

### B1. Render-and-crop — fidelity by construction

**The claim.** Render the page once with pdf.js, exactly as ChatterED already does. A segment is a
**rectangle in PDF page space**. The UI shows that rectangle of that rendering. Fidelity is not
achieved, it is *tautological*: the pixels are pdf.js's own pixels, and pdf.js is the same renderer
Firefox ships to hundreds of millions of users.

Everything below was verified against the copy of **`pdfjs-dist` 6.3.289** installed at
`app/node_modules/pdfjs-dist` — not from memory, and not from the web.

#### B1.1 What the text layer gives you

`page.getTextContent()` returns `items: Array<TextItem | TextMarkedContent>`. In 6.3.289
(`types/src/display/api.d.ts:312`) a `TextItem` is exactly:

```ts
type TextItem = {
  str: string;            // text content
  dir: string;            // 'ttb' | 'ltr' | 'rtl'
  transform: Array<any>;  // [a, b, c, d, e, f]
  width: number;          // in device space
  height: number;         // in device space
  fontName: string;       // pdf.js's internal font id, keys into TextContent.styles
  hasEOL: boolean;
};
```

Measured on the real deck, page 3, at `scale: 1` (so device space == PDF user space, y-up):

```
{ str:"/btw as a whisper", transform:[31.73,0,0,31.73,50.623,477.63], width:262.12, height:31.73, fontName:"g_d0_f1" }
{ str:"",                   transform:[12.265,0,0,12.265,155.27,416.9], width:0,     height:0,     hasEOL:true }
{ str:"“Is there something",transform:[12.265,0,0,12.265,155.27,416.9], width:126.16, height:12.265 }
```

So the arithmetic for a page-space box, for the common unrotated case (`b == c == 0`):

```ts
const [a, b, c, d, e, f] = item.transform;
// (e, f) is the BASELINE origin, y measured up from the page bottom.
const x0 = e, x1 = e + item.width;
const y1 = f + item.height;                 // approx. ascent top; height == font size when a==d
const y0 = f - item.height * 0.25;          // descender allowance; pdf.js's own text layer
                                            // instead measures the font's real ascent (below)
```

Three warnings, all of which cost a debugging hour if you learn them late:

- **`height` is the font size, not the glyph height.** pdf.js's own `TextLayer` does better: it keeps
  a `#ascentCache` and calls `#getAscent(fontFamily, style, lang)` to measure the real ascent through a
  scratch 2-D context (`types/src/display/text_layer.d.ts`). For *segment boundaries* the crude
  version is fine — you are cutting between lines, not tracing glyphs.
- **Zero-width items with `hasEOL: true` exist** (see the middle item above) and must be skipped, not
  given a box. `app/src/main/vault/pdf.ts` already skips non-string items; it does *not* skip
  zero-width ones, and it should.
- **`item.width` is in *device* space.** At `scale: 1` that equals user space, which is why every
  geometric computation must be done on a `scale: 1` viewport and only *then* mapped to the canvas.

#### B1.2 The text layer API changed — use `TextLayer`, not `renderTextLayer`

Confirmed by reading `types/src/pdf.d.ts:69`, the full export list of 6.3.289. **`renderTextLayer` is
not exported. `TextLayer` is.** Also exported and useful: `setLayerDimensions`, `OutputScale`,
`PixelsPerInch`, `Util`, `OPS`, `normalizeUnicode`.

```ts
import { TextLayer, setLayerDimensions } from 'pdfjs-dist';

const viewport = page.getViewport({ scale });
setLayerDimensions(div, viewport);          // sets width/height AND the --scale-factor CSS var
const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
await layer.render();
// layer.textDivs : HTMLElement[]   — one span per text item, absolutely positioned
// layer.textContentItemsStr : string[]  — parallel array of the items' `str`
// layer.update({ viewport })       — re-layout on zoom without re-extracting
// layer.cancel()                   — on unmount
```

`setLayerDimensions` is what writes `--scale-factor` onto the container; the text layer's CSS sizes
every span in `calc(var(--scale-factor) * Npx)`, so **if you position the layer yourself and forget
that variable, every span renders at the wrong size and selection silently misaligns.** Use the
helper.

Also note two API removals in v6 that older tutorials still show:
- **`viewport.convertToViewportRectangle` is gone.** `page_viewport.d.ts` exposes only
  `convertToViewportPoint(x, y)` and `convertToPdfPoint(x, y)`. Convert two corners and normalise.
- **The SVG backend is gone.** `SVGGraphics` is absent from the v6 export list. There is no
  supported vector-DOM rendering path in pdf.js any more; canvas is the only backend. Any plan that
  said "render to SVG so segments are crisp at any zoom" is dead — re-render the canvas at the new
  scale instead, which `PdfViewer.svelte` already does on zoom (line ~300, "a scale change
  invalidates every bitmap").

`viewport` in v6 also carries `userUnit` alongside `scale`, `rotation`, `transform`, `width`,
`height`. `transform` for the real deck at `scale: 1` is `[1, 0, 0, -1, 0, 540]` — the y-flip, and
the reason every stored rectangle must be normalised 0–1 against the page box exactly as
`pivot-spec.md` §A2 already specifies.

#### B1.3 Finding non-text ink — two working methods, both measured

R2 (§A3) needs figure regions, and figures are invisible to the text layer. Two routes, both tested
here on the real deck.

**Method 1 — walk `getOperatorList()` yourself.** Maintain a CTM stack over `OPS.save` /
`OPS.restore` / `OPS.transform`, and take a box from each `OPS.constructPath` and
`OPS.paintImageXObject`. In v6 `constructPath`'s third argument is a **`Float32Array(4)` min/max
box** in path space — note the type: `Array.isArray()` on it returns `false`, which cost me a
debugging cycle and will cost you one.

```ts
const a = ops.argsArray[i];              // OPS.constructPath
const [x0, y0, x1, y1] = a[2];           // Float32Array(4), NOT a plain array
```

Measured output, after clipping to the page, dropping boxes smaller than 3 pt or larger than 95 % of
the page (those are clip rects and backgrounds), de-duplicating, and union-merging boxes within 8 pt:

| Page | merged non-text-ink regions (PDF space, y-up) | what they are |
|---|---|---|
| Real deck p. 3 | `x[143..817] y[27..459]`, 675 × 433 | the two panels + icons + arrows, as one figure |
| Real deck p. 4 | `x[300..377] y[439..462]`, 77 × 22 | **the yellow highlight behind "disruptive"** |
| Real deck p. 4 | `x[0..557] y[0..415]`, 557 × 415 | the app screenshot (as an `img` box) |
| Beamer p. 6 | `x[0..454] y[228..255]` | the Madrid headline bar (chrome) |
| Beamer p. 6 | `x[19..104] y[83..154]`, 85 × 71 | **the TikZ axes + shaded feasible region** |
| Beamer p. 6 | `x[0..454] y[0..16]` | the footline (chrome) |

It found the figure on both decks and found the highlight — the exact authorial emphasis §A1.4 said
a converter loses. Raw path counts before filtering: 145 on real-deck p. 3, 25 on the TikZ page.
Two caveats that matter: the 8 pt merge gap fused the *two* panels on p. 3 into one region (a tighter
gap, or a projection-profile split, separates them); and a `\frac` rule is ~0.4 pt tall, so a
`height > 3 pt` filter drops it — which is correct here (you do not want a fraction bar treated as a
figure) but is the kind of threshold that must be tuned against a real deck, not guessed.

**Method 2 — let pdf.js record the boxes for you (better, and almost undocumented).** v6.3.289 adds
three options to `page.render()` (`types/src/display/api.d.ts:472–486`):

```ts
recordImages?: boolean;      // "Record the location of images in the PDF"
recordOperations?: boolean;  // "Record the dependencies and bounding boxes of all PDF
                             //  operations that render onto the canvas."
operationsFilter?: (index: number) => boolean;
```

After the render promise resolves, the results land on the page proxy as `page.recordedBBoxes` and
`page.imageCoordinates` (`build/pdf.mjs:15894–15907`). These come from a `CanvasBBoxTracker`
constructed with the actual canvas (`build/pdf.mjs:7208`), so the boxes are computed **by the real
rasteriser, in canvas space, respecting clipping** — strictly better than the hand-rolled CTM walk,
and it accounts for the clip-rect noise that Method 1 has to filter out.

One limitation, from the source: the tracker stores boxes as a `Uint8ClampedArray` view over a
`Uint32Array`, **four bytes per operation** — each coordinate quantised to 0–255 of the canvas
(`#initializeBBoxes`, `build/pdf.mjs:7229`). On a 1000 px canvas that is ~4 px of granularity.
Ample for *segment boundaries*; useless for a tight crop of one glyph. It also requires a real
canvas, so it is a **renderer-process** technique — which suits ChatterED, whose rendering is in the
renderer anyway. **Partly UNVERIFIED:** I read the implementation but could not execute it, because
running it under Node needs `@napi-rs/canvas`, which this project deliberately does not install
(`vault/pdf.ts` comments say so).

**Recommendation:** ship Method 1 (works today, no canvas, runs in main or renderer, measured above);
keep Method 2 as the upgrade once there is a page canvas to hand.

#### B1.4 Tagged PDF: a real, free structure signal on PowerPoint exports

`pdfinfo` says the real deck is `Tagged: yes` — and `page.getStructTree()` **works**, which I did not
expect. Verbatim, page 3:

```json
{"children":[{"role":"Document","children":[{"role":"Sect","children":[
  {"role":"Figure","children":[{"type":"content","id":"p36R_mc0"}],"alt":""},
  {"role":"Sect","children":[{"role":"H2","children":[{"type":"content","id":"p36R_mc1"}]}]},
  {"role":"Figure","children":[{"type":"content","id":"p36R_mc3"}],"alt":"Teacher with solid fill"},
  {"role":"Sect","children":[{"role":"P","children":[{"type":"content","id":"p36R_mc5"}]}]}, …
```

What this is worth:

- **Roles for free**: `H2` marks the slide title, `P` marks body text, `Figure` marks each graphic —
  and PowerPoint's auto-generated **alt text is present** (`"Teacher with solid fill"`), which is a
  free caption for a figure region and a free input to a concept label.
- **`Sect` groups** are PowerPoint's shape/placeholder grouping — a genuine, authored hint about which
  blocks belong together, which is *exactly* the thing §A2 said poppler's flows fail to give.
- **The catch:** the tree's leaves are `{type:"content", id:"p36R_mcN"}` — **marked-content ids, not
  boxes.** To get geometry you must call `getTextContent({ includeMarkedContent: true })` and
  correlate the `beginMarkedContentProps` items against those ids, and `Figure` nodes have no text at
  all, so their boxes must still come from §B1.3.
- **The bigger catch:** the Beamer deck is `Tagged: no`. **LaTeX/Beamer output is untagged by
  default**, so this signal is present on PowerPoint/Keynote exports and absent on exactly the
  maths-heavy decks that need help most. Treat it as a bonus, never as the mechanism.

#### B1.5 Cost of rendering, and how to display many crops of one page

`PdfViewer.svelte` already renders at `scale × min(2, devicePixelRatio)` into a per-page canvas and
releases backing stores by setting `width = height = 0` (line ~271) — the correct idiom, already
there. A 16:9 slide at 960 × 540 pt, `scale: 1`, DPR 2 is 1920 × 1080 × 4 B ≈ **8.3 MB per page**, so
a 40-slide deck fully resident is ~330 MB: the existing `IntersectionObserver` lazy render is not an
optimisation, it is a requirement, and it carries over unchanged.

Three ways to show N crops of one page canvas, in increasing order of how much I would trust them:

1. **One canvas per segment, `ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, dw, dh)`.** Simple,
   independent, each segment owns its bitmap. Costs one bitmap per segment, so the whole page is
   resident twice. **Use this.**
2. **One shared page canvas, N wrapper `div`s with `overflow: hidden` and the canvas offset by
   negative margins.** Zero extra memory — but a `<canvas>` element cannot be in two places in the
   DOM at once, so this only works if each segment gets its own canvas anyway, or if you switch to
   `background-image` off a `canvas.toDataURL()`/blob, which re-encodes the page and defeats the
   point.
3. **`createImageBitmap(pageCanvas, sx, sy, sw, sh)` per segment**, then `drawImage` the bitmap.
   Crops on the GPU, transferable, and `ImageBitmap.close()` frees deterministically. Best at scale,
   one more concept to get wrong. Worth it later, not in seven days.

Chromium's canvas limit is far above anything a slide needs (per-dimension in the tens of thousands
of pixels, with a total-area cap), so a single 16:9 page at DPR 2–3 is never near it; pdf.js's own
viewer exposes `maxCanvasPixels`/`maxCanvasDim` knobs for the pathological cases
(`types/web/pdf_page_view.d.ts:62`). **UNVERIFIED:** exact Chromium limits for the Electron version
in use — do not rely on a number, rely on the fact that slides are small.

#### B1.6 Verdict on B1

| | |
|---|---|
| Visual fidelity | **perfect, by construction** |
| Semantic fidelity | whatever the text layer gives — good on prose, bad on maths (§A1.2) |
| Figures | **kept, as pixels** — the only approach that keeps them at all without a separate model |
| Runs locally | it is already running locally; zero new dependencies |
| Cost | zero — no API, no per-page fee |
| Effort | small — it is `PdfViewer.svelte` plus a rectangle |
| Fails when | the source is a scanned image (degrades to one segment/page — a *good* failure) |

### B2. Structure extraction with provenance — as an index, never as the document

The honest framing for this family: **nothing here improves fidelity; the best of them improve your
*index* over the pixels.** `pivot-integrated-document.md` §D2 already priced them and concluded
"right answer for a notes app, wrong answer for the next seven days". Three things have sharpened
since, and they sharpen it in the same direction.

**Sharpening 1 — the slide penalty is now measured, not assumed.** §D2 flagged the slide failure
modes as "partly UNVERIFIED — extrapolated, because a slides benchmark does not appear to exist."
One does: **OmniDocBench** (CVPR'25) reports per-document-type edit distance, and the slide column is
brutal — lower is better:

| Tool | slides | papers (textbook/academic) | penalty |
|---|---|---|---|
| MinerU | 0.124 | 0.025 | **5×** |
| Mathpix | 0.22 | 0.091 | 2.4× |
| Marker | 0.34 | 0.059 | **5.8×** |
| Nougat | 0.958 | 0.214 | 4.5× (and 0.958 is "unusable") |
| Qwen2-VL-72B (general VLM) | 0.061 | — | best on slides |

Two conclusions, both load-bearing. (a) **Every specialist converter degrades 2.4–6× on slides**, and
the ranking changes — Marker, best overall on olmOCR-bench, is *second worst* here. (b) **A general
vision model beats all of them on slides**, which is the empirical argument for §B5 and for §C.

**Sharpening 2 — the layout models were never trained on slides.** DocLayNet, DocBank and M6Doc
contain no slide decks. DocLayout-YOLO's own benchmark, **DocStructBench**, has four subsets —
Academic, Textbook, Market Analysis, Financial — and again **no slides**
([arXiv 2410.12628](https://arxiv.org/abs/2410.12628), [repo](https://github.com/opendatalab/DocLayout-YOLO)).
It is fast (85.5 FPS) and has an `Isolated Formula` class, which is tempting; it is out of
distribution on our corpus. The slide-native datasets are **SPaSe** (WACV'19, 2,000 slides, 25
pixel-level classes) and **RealSlide/SynSlide** (ICDAR'25,
[arXiv 2506.23605](https://arxiv.org/abs/2506.23605), CC BY 4.0, 16 classes including `Equation`) —
and RealSlide's best reported detector is **mAP ≈ 38.8 (YOLOv9)**. *Slide element detection is an
open research problem with sub-40 mAP.* Building ChatterED's fidelity guarantee on top of that would
be malpractice. Building a *hint* on top of it is fine, which is what §C does.

**Sharpening 3 — what each tool actually returns.** Condensed; the commercial four were verified by a
sub-agent against current pricing and API docs, the open four are from §D2's benchmark round-up plus
the two repo checks below.

- **Docling** (IBM, **MIT**, runs on arm64 macOS). The only one whose *entire* data model is
  provenance: a `DoclingDocument` splits content into `texts` / `tables` / `pictures` /
  `key_value_items` plus `body` / **`furniture`** / `groups` trees, and carries "layout information
  (i.e. bounding boxes) for all items" and "provenance information"
  ([docs](https://docling-project.github.io/docling/concepts/docling_document/),
  [arXiv 2408.09869](https://arxiv.org/abs/2408.09869)). The `furniture` tree *is* the header/footer
  separation §A1.6 needs. Weakest OCR of the three (olmOCR-bench 50.3), best structure, CPU-capable.
  **This is the one to revisit for A2, as an anchor oracle.**
- **Marker** ([datalab-to/marker](https://github.com/datalab-to/marker)) — **and §D2's licence note
  needs correcting**: the *code* is **Apache 2.0**, and only the *model weights* carry a modified
  OpenRAIL-M that is "free for research, personal use, and startups under $5M funding/revenue".
  For a student prototype that is permissive; for ChatterED's stated commercial intent it is a
  future licensing conversation, not a present blocker. JSON mode emits 4-corner `polygon` per block;
  equations come out as `$$`-fenced LaTeX; **works on MPS**. Ranked best on papers, second-worst on
  slides.
- **MinerU** — best maths of the open three (formula CDM 88.46) and **best open tool on slides**
  (0.124), ~0.54 pg/s. AGPL. A real candidate for a batch "maths index" pass, and the AGPL is the
  reason it must stay a separate process you shell out to, never a linked library.
- **Nougat** — 0.958 on slides. Superseded on every axis. Do not start here.
- **LlamaParse** — `items[]` with `bbox {x, y, w, h}` in PDF points; word/line-level boxes only on
  the dearer tiers; `images_to_save` gives layout crops. **$0.00125–0.056/page.** Cloud only.
- **Adobe PDF Extract** — `Bounds [l,b,r,t]` and per-glyph `CharBounds`; figures as PNG; free 500
  transactions/month (1 transaction = 5 pages). **No maths support at all** — disqualified for this
  corpus.
- **Mathpix** — the maths ceiling. `lines.json` gives a `cnt` polygon plus a real type taxonomy
  (`math`, `text`, `table`, `diagram`, `chart`, `figure_label`…) **with per-region confidence**;
  figures as CDN crops (30-day expiry). **$0.005/page realtime, $0.0015 batch**, $19.99 setup. Cloud
  only. §D2's warning stands and is the one that matters pedagogically: it *normalises* unusual-but-
  valid notation into standard LaTeX — plausible and wrong, which in a learning tool is the worst
  possible error class.
- **Azure Document Intelligence** (`prebuilt-layout`, 2024-11-30) — 8-number `polygon`,
  `features=formulas` returns **per-equation LaTeX + polygon + span**, `output=figures` returns crops.
  Best grounding-plus-maths combination of the commercial four. **$0.016/page** with formulas; F0 free
  tier is 500 pages/month but only the first 2 pages per request. Container is x64 only — **no Apple
  Silicon**. Its `paragraphs` over-fragment slides, same disease as poppler's flows.
- **Unstructured** — `hi_res` gives `metadata.coordinates`; no maths story; the licence has moved
  around. Nothing it offers is not better offered above. **UNVERIFIED** current terms.
- **Grobid** — a TEI model of a *scholarly article*: header, abstract, sections, bibliography. A slide
  deck has none of those. Useless here, in one line, as requested.
- **Baselines worth knowing:** `pdftotext -bbox-layout` (poppler, GPL) gives block/line/word boxes
  with zero setup and is what §A was measured with; **PyMuPDF** gives richer per-span boxes and
  drawing extraction but is **AGPL**, which for a distributed Electron app is a real constraint;
  **pdfplumber** (MIT) gives per-character boxes in pure Python. All three are *geometry*, which is
  the part pdf.js already gives us in-process — so none of them earn a Python runtime in the bundle.

**Verdict.** Unchanged from §D2 and now better evidenced: **not the A1 document.** Docling (MIT,
local, provenance-native) and MinerU (best open on slides and maths) are the two to revisit for A2 —
as a *sidecar index* over crops, exactly the "anchor oracle" idea §D2 floated.

### B3. pdf2htmlEX-style faithful HTML — right fidelity, wrong affordance

pdf2htmlEX subsets every embedded font to WOFF and emits absolutely-positioned elements with
generated CSS classes for x-position, y-position, font, size and colour. The result is close to
pixel-exact in a browser and is genuinely the most faithful *HTML* conversion that exists.

It is still wrong here, for a reason that has nothing to do with fidelity:

- **The output has fidelity but no structure.** A bullet is not a list item; it is a positioned run
  next to a positioned glyph. There is no node that means "this concept". Segmenting it is the same
  geometry problem as §B1 — except now you have also inherited a second document format, a font
  pipeline and a build dependency.
- **Editing it is hard by design.** Every element is positioned absolutely against a page box; change
  one line's text and nothing reflows, because nothing was ever in flow. Insert an AI segment and it
  overlaps whatever was at those coordinates. The properties that make it faithful are precisely the
  properties that make it unmodifiable — which is item (0) of Lucas's own list ("high ability to
  modify") failing.
- **Maths is still positioned glyphs.** §A1.2's `∑`→`P` is unchanged; it is now a `<div>` that says
  `P`. Faithful to the pixel, wrong to the reader, and wrong to any model you feed it to.
- **Size and maintenance.** Output inflates substantially versus the PDF (embedded fonts plus a CSS
  class per distinct position), and the project has been low-activity for years.
  **UNVERIFIED** — I did not re-check the repo's 2026 state.

**The useful lesson, though, is a positive one:** pdf2htmlEX proves that *if* you want fidelity, you
end up storing positions and original glyph outlines. ChatterED can have that for free by keeping the
PDF and letting pdf.js do it — which is §B1. pdf2htmlEX is §B1 with an extra format in between.

### B4. Liquid Mode and reader-reflow — prior art, and a cautionary tale

- **Adobe Acrobat Liquid Mode** is the flagship attempt: an AI pipeline (Adobe Sensei) that infers
  headings, lists and tables and *reflows* a PDF for phone reading, with collapsible outline and
  adjustable text size. Two facts define its relevance. It shipped **mobile-only** and page-limited
  (documents beyond a few hundred pages are refused), and Adobe's own guidance has always been that
  it works best on text-dense documents and degrades on complex layouts. **UNVERIFIED** whether it
  is still actively supported in 2026 — there have been credible reports of deprecation, and I could
  not confirm either way. Either answer supports the same conclusion: **the best-resourced attempt at
  PDF reflow in the industry shipped it as a secondary, opt-in mode with caveats, never as the
  default view.** That is precisely the status §C gives the reflow mode.
- **Apple** offers no PDF reflow in Preview or Books on macOS; Books reflows EPUB, and PDFs stay
  paginated. **UNVERIFIED** for the very latest OS.
- **Edge / Word "open PDF in Word"** re-typesets, loses layout, and is widely disliked for exactly
  the maths and figure reasons in §A1. **Kindle's** PDF conversion is the same trade.
- The accessibility framing is worth one line in the report: **WCAG 2.2 SC 1.4.10 Reflow** requires
  content to reflow to 320 CSS px without two-dimensional scrolling
  ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)). A crop-based flow does **not**
  satisfy 1.4.10 for the slide pixels — which is an honest limitation to state, and the reason the
  reflow mode in §C should exist at all rather than being cut entirely.

### B5. LLM-vision segmentation — the right tool for *boundaries*, not for *content*

The finding that makes this family interesting is the one from §B2: on OmniDocBench slides, a general
VLM (Qwen2-VL-72B, 0.061) beat every specialist converter, the best of which managed 0.124. Slides
are out of distribution for layout models and *in* distribution for general vision models, because
slides look like the rest of the visual internet.

**What to ask for, and what not to.** Ask for **boundaries and labels**; never ask for **content**.
A hallucinated concept label is a cosmetic error the learner fixes by typing. A hallucinated equation
is a wrong thing taught to a student, and §A1.2 shows the model's *input* text is already corrupted,
so it would be hallucinating from bad evidence. This is the single most important design line in the
document:

> **The vision model proposes cuts. The renderer supplies pixels. The model never supplies content
> that is presented as the slide's.**

**Prompt shape.** The literature convergence is clear and simple. **LumberChunker** (EMNLP'24) frames
chunking as *"name the index at which the content shifts"* — give the model enumerated units and ask
which index begins a new topic, rather than asking for free-form spans. Applied here: enumerate the
text blocks you already have from §B1.1 (with their boxes), attach the page image, and ask which
block indices start a new concept. That converts an unreliable coordinate-regression task into a
reliable **selection over candidates you computed yourself** — and it means the returned boundary is
*exactly* a block edge you measured, so it is correct by construction even when the model's spatial
sense is poor. **Do this rather than asking for raw bounding boxes.** It sidesteps the whole
question of LLM bbox accuracy, which is the weakest link in this family.

Corroborating: **PPTBench / AutoPresent** find MLLMs read slides well but **cannot reproduce spatial
arrangement** — read, yes; place, not reliably. **Slide Gestalt** (CHI'23, Google) is the closest
prior art to what ChatterED wants: it recovers a deck's hierarchy by detecting agenda slides,
detecting repeated template structure, and **neurally grouping consecutive slides** into sections.
Its inputs are the two signals §A1.5 and §A1.6 identified independently — repeated chrome, and
consecutive-slide similarity. Also relevant: **Slide2Lecture** ([arXiv 2409.07372](https://arxiv.org/abs/2409.07372)),
**Slide2Text** ([arXiv 2503.17710](https://arxiv.org/abs/2503.17710)), **SlideAgent** (ACL'26, a
global→page→element index — structurally the same three-tier idea as §C), and Deck Q&A
(window-plan → synthesise → annotate → reconcile).

**And the gap that justifies the learner-correction loop:** there is **no benchmark with
ground-truth concept boundaries for slide decks.** Nobody knows what the right answer is, including
us. A design that assumes the machine gets boundaries right is unfalsifiable *and* unbuildable; a
design in which the learner adjusts them is honest, and is a better CUI besides (Koala §7.2, learner
controls — `pivot-integrated-document.md` §B4).

**Cost.** Anthropic's image token estimate is `width × height / 750`, with a recommended long edge of
~1568 px. A 16:9 slide at 1568 × 882 ≈ **1,844 tokens** per page image; add ~500 tokens of enumerated
block text and a ~150-token JSON reply. For a 40-slide deck that is roughly **95 K input tokens and
6 K output**, once, at ingest. On Haiku-class pricing that is cents; on Sonnet-class, a fraction of a
dollar. **Either way the dominant cost is that it is one call per page at import — so it must be
cached in SQLite against the content hash and never repeated on reopen.**
Load the `claude-api` skill before writing the call; do not take model ids or prices from this
document (per `CLAUDE.md`). **UNVERIFIED:** current per-MTok prices, which I did not fetch.

**Reliability.** Force the schema with a tool definition rather than parsing prose, and store the
model's own confidence per boundary so the UI can mark a low-confidence cut for review (§C4). The
`Slide Gestalt`-style structural signals give you a free cross-check: if the model proposes three
concepts on a page whose text blocks form one visual column with one title, distrust it.

---

## C. Recommendation for ChatterED

### C0. The recommendation in five sentences

1. **A segment is a crop of the original rendered page, and there is no code path that re-typesets
   slide content.** Fidelity stops being a quality target and becomes an invariant.
2. **Boundaries come from geometry first** — text-block boxes (§B1.1) plus non-text-ink boxes
   (§B1.3), collapsed into horizontal cut lines in page space.
3. **One Claude vision call per page refines those cuts** by *choosing among them* (LumberChunker
   framing, §B5), returning indices and a confidence — never content, never raw coordinates.
4. **The learner's split/merge is the correction loop**, and it is cheap because a boundary is one
   number in page space.
5. **A reflowed view exists as an explicitly-labelled secondary mode**, off by default, carrying a
   visible fidelity warning — and nothing is ever stored in reflowed form.

This is `pivot-integrated-document.md` §D4 (hybrid) at finer granularity: **§D4 said "page images as
immutable blocks"; this says "page-*region* crops as immutable blocks."** Same architecture, same
safeguard S5 ("the slide is the arbiter" encoded in the data model — there is no operation that edits
a crop), same `pivot-spec.md` §A anchor model. The only schema change is that a `page` block gains a
rectangle. That is a one-line addition to migration 009, which has not shipped yet.

### C1. Why this and not the alternatives, in the specific circumstances

The circumstances are unusual and they narrow the field hard:

- **Electron + `pdfjs-dist` 6.3.289 already in place**, with lazy per-page canvas rendering, DPR
  handling and backing-store release already written and already reviewed (`PdfViewer.svelte`).
  §B1 is ~90 % carried over; §B2 throws it away and adds a Python runtime to an app distributed as an
  unsigned DMG.
- **Solo developer, seven days to Assignment 1.** §B2 and §B3 are distribution projects.
- **Maths-heavy slides.** §A1.2 is not a risk, it is a certainty: the first `\sum` breaks any
  re-typesetting path, visibly, in the demo.
- **Claude API available, vision-capable.** The one place a model genuinely outperforms the
  specialists on this corpus is *slide understanding* (§B2, OmniDocBench), and the cheapest possible
  use of that strength is boundary selection.
- **The report has to argue a design position.** "We never re-typeset the lecturer's slide" is a
  defensible design principle with an evidence base (§A) and a safeguard behind it (S5). "We ran a
  converter and it mostly worked" is not.

### C2. The pipeline, concretely

Run once per file at import, keyed on `content_sha`, cached in SQLite, never repeated on reopen.

**Stage 0 — build groups (§A1.5).** Merge progressive-reveal pages *before* anything else. Pages are
one build when page size matches and the earlier page's tokens are a subset of the later's (≥ 95 %
containment, no tokens lost). **Keep the last page of the build** — the complete one. Record the
others so the UI can offer *"⏴ 3 build steps"*. Skipping this stage produces the single most visible
failure of the flow concept: the same slide three times, growing.

**Stage 1 — page geometry (free, in-process, no network).** For each kept page, at `scale: 1`:
- text items → boxes (§B1.1), zero-width items dropped;
- non-text ink → merged boxes (§B1.3 Method 1);
- `getStructTree()` if the PDF is tagged → roles and alt text, as a bonus (§B1.4);
- everything normalised 0–1 against the page box, per `pivot-spec.md` §A2.

**Stage 2 — chrome removal (§A1.6).** A box whose text repeats verbatim at the same normalised
position on ≥ 60 % of pages is chrome: **excluded from boundary detection, included in every crop**
(it is part of how the slide looks). The same test kills Beamer footlines, running titles and slide
numbers with one rule.

**Stage 3 — candidate cut lines.** Sort remaining boxes by `y`. A candidate cut is a horizontal line
in page space that (a) lies in a vertical gap between boxes, (b) crosses **no** non-text-ink box, and
(c) is below the title band. Condition (b) is R2 (§A3) and is what stops a cut slicing a diagram in
half. Typically 2–6 candidates per slide; often zero, and **zero is a correct answer** — that slide is
one concept and the segment is the whole page.

**Stage 4 — one Claude vision call per page.** Send the page image (long edge ~1568 px) plus the
enumerated candidate cuts with their neighbouring text. Ask, via a forced tool schema: *which
candidate cuts are real concept boundaries, a ≤ 6-word label per resulting segment, and a confidence
0–1 per boundary.* The model **selects from cuts we computed**, so every accepted boundary is
geometrically valid by construction even if the model's spatial reasoning is poor (§B5). Cache the
reply against `content_sha`. Degrade to Stage 3's geometry on any API failure — the app must open a
deck with the network off.

**Stage 5 — the flow.** Segments in page order, each a rectangle plus a label plus a confidence.
The learner splits, merges, reorders, and inserts AI conversation segments between them.

**What runs when the network is down or the API fails:** stages 0–3 and 5. The flow still works; the
labels are the slide titles from the text layer instead of the model's; boundaries are
geometry-only. **This fallback must be built first and demoed once**, because it is also the video's
insurance (`pivot-spec.md` §D6 has the same instinct about `ScriptedClient`).

### C3. What the learner actually sees

**A crop segment looks like the slide, because it is the slide.** Same Aptos and Cambria, same yellow
highlight behind *disruptive*, same arrow between the two panels, same screenshot with the
author's green callout box on it, same equation with a real `∑` and real limits stacked above and
below. Not similar — identical, at the pixel. A learner who has the deck open in Preview on the other
monitor can compare and find nothing different.

Concretely, a segment card is:

- the crop itself, full-bleed, at the flow's content width (~760 px, per the earlier mockups) — the
  crop scales to width, which is safe because it is one slide's region and slides are wide;
- a thin label strip above it (the concept name, editable, and a page chip "p. 10");
- segment chrome only *outside* the crop's bounds — a left drag handle, a right split/merge affordance,
  the "+ Ask here" line below. **Nothing is ever drawn on top of the slide pixels** except the split
  guide while the learner is actively splitting (§C5) and the selection highlight.

**A reflowed segment looks like a web page and says so.** Different typeface (the app's UI font,
deliberately not the slide's), left-aligned running text, maths rendered as whatever the text layer
gave — which on the KKT slide is `P ... i=1 λi ∇gi (x ⋆ ) = 0`. It carries a warning band, not a
badge: *"Reflowed text — maths and figures may be wrong. Show the original."* Its purpose is
accessibility and small windows (§B4, WCAG 1.4.10), and search/selection when the crop is awkward.
It is a **view**, never a store, never a default, and it is the last thing to build.

**"Original pages" stays one click away, and it is the same rendering.** The toggle in the earlier
mockups flips the flow from segment order to page order. It is cheap precisely because segments are
crops of pages: the toggle does not re-render, re-parse or re-fetch anything — it changes which
rectangle each card displays (the segment's box, or the full page box) and which order they are in.
On a per-segment basis, hovering the page chip should show the source page with the segment's
rectangle outlined on it (§D2). **The learner should never be more than one gesture from the
unsegmented, unmodified page**, and that gesture should be visibly instant, because instantaneity is
itself evidence that nothing was converted.

### C4. How AI segments differ — and why this is a safeguard, not a style choice

An AI segment is **typeset by ChatterED**. It is the one thing in the flow that is *not* a crop, and
it must be impossible to mistake for one. `pivot-integrated-document.md` §D4 makes the argument in
data-model terms (S5: an agent cannot edit ground truth because there is no operation that edits
ground truth); the visual layer must make the same claim legible.

The request was that an AI summary is "rendered in the slide's voice". Take that as **register, not
disguise**: it may adopt the deck's vocabulary, its notation conventions, its level of formality —
it may not adopt its *appearance*.

Four separations, in order of how much work they do:

1. **Typography.** AI segments are set in the app's UI font on the app's background. Crops carry the
   slide's fonts and the slide's background. On the real deck this is Aptos/Cambria-on-white versus
   the UI font — obvious at a glance, at any zoom, in a screenshot, in the video.
2. **Edge.** A crop is a full-bleed rectangle with a hairline border, like a photograph. An AI
   segment is inset, with the conversation's own left rule and the agent's colour. The crop is an
   *object*; the AI segment is *annotation around it*.
3. **Attribution.** Every AI segment carries the agent's name and avatar (Ellie / Max / Theo / the
   `reference` voice) in its header. A crop carries a page chip. These never appear on the same card.
4. **The never-rule, stated once and enforced in code:** *no AI-generated text is ever rendered in a
   slide's fonts, on a slide's background, or inside a crop's bounds.* If an agent's answer needs to
   point at a region, it draws a **callout arrow to the crop** and lives outside it.

For maths inside an AI segment: typeset it properly (KaTeX/MathJax) and let it look like the app,
**not** like Computer Modern. Matching Beamer's typeface would make agent-written maths visually
indistinguishable from the lecturer's — which is the exact confusion S5 exists to prevent, and in a
maths module it is the confusion with the highest cost.

### C5. Split and merge on crops

This is the part that is *easier* on crops than on any other representation, and it is worth saying
so in the report.

- **A segment is `{page, y_top, y_bottom}`** (plus optional `x` bounds for a genuinely two-column
  slide), normalised 0–1 against the page box. Segments on a page partition it: adjacent segments
  share an edge.
- **Split** = insert one new horizontal boundary in page space. The learner drags a line across the
  crop; it snaps to the nearest candidate cut from Stage 3 (within ~8 pt) so the common case lands in
  a real gap, and snapping can be overridden. Two segments result; the boundary is one number. **No
  re-render** — both new cards draw from the same page canvas at different source rectangles.
- **Merge** = union of adjacent boxes. For two segments on the same page it is
  `y_top = min, y_bottom = max` — one card, one crop, still a crop of the original. For segments on
  *different* pages, a merged segment is an ordered list of crops shown as one card (do not try to
  composite them into one image: different pages may differ in size, and a seam would be a visible
  lie about the source).
- **Reorder** moves cards in the flow and never moves pixels within a page.
- **Invariants worth asserting in a test**, in the spirit of the existing whisper-leak canary:
  every page is fully covered by its segments (no orphaned strip of slide), segments never overlap,
  and **every split/merge is reversible** — because the operation only ever changes numbers, the
  original page box is always recoverable, which is the structural form of "the slide is the arbiter".

### C6. The figure that belongs to two concepts

This case is common on real decks — including page 10 of the CS4246 deck, where one grid-world
figure labelled (a)/(b) sits above two separate bullet groups, "Transition model" and "Markovian
assumption", and the figure carries no text blocks at all so no text-derived cut can see it.

**Rule: a figure is never cut, and never duplicated as pixels. It is *shared*.**

Three mechanisms, in the order the pipeline should try them:

1. **Prefer a vertical cut.** If the figure sits beside the text (the common two-column slide), the
   concept boundary is a *vertical* line and each segment keeps its own column — figure with one,
   bullets with the other. Stage 3 should propose vertical candidates too, using the same
   crosses-no-ink test on the x-axis. On a two-column slide this resolves the problem completely and
   is the cheapest possible answer.
2. **If the figure genuinely spans both concepts, make it its own segment**, sitting above them in
   the flow, and mark the two following segments as *referring* to it. The UI keeps the figure
   sticky at the top of the viewport while the learner scrolls through both — the figure stays
   visible exactly as long as it is relevant, which is better than either duplicating it or hiding it.
   This is also the honest reading of such a slide: the lecturer drew one figure and then said two
   things about it.
3. **Never** produce two segments whose crops both include the figure. It doubles the deck's visual
   length, it makes "which of these is the real one?" a question the learner has to ask, and on a
   build-heavy deck it compounds with §A1.5 into a flow twice as long as the lecture.

The `anchors` table already supports this without a schema change: a figure segment is one anchor;
the two concept segments each carry their own anchor; a `refers_to` relation between them is an
ordinary row. **UNVERIFIED** whether the sticky behaviour feels right — it is the one interaction
here I would want to see running before committing to it, and it is a strong thing to put in front of
an interview participant.

### C7. Seven days, and what to cut

Mapped onto `pivot-spec.md` §E's existing plan, this **replaces** Day 1's box-select-only ambition
with box-select plus automatic segmentation, and adds nothing to Days 3–7.

| | |
|---|---|
| **Day 1** | Stage 1 geometry in `vault/pdf.ts` (text boxes — the file already walks `transform`; add the width/height arithmetic and drop zero-width items) + Stage 0 build-group detection. Both are pure functions over data the file already has, so both are unit-testable with no PDF fixtures beyond the two decks in §A. |
| **Day 2** | Stage 3 candidate cuts + Stage 2 chrome removal + the crop renderer in `PdfViewer.svelte` (`drawImage` with a source rect — §B1.5 option 1). **The flow is visible and faithful at the end of Day 2, with no model involved.** |
| **Day 3** | Split/merge/reorder (§C5), and the "Original pages" toggle. **This is the gate:** if the flow with geometry-only boundaries plus learner correction feels good here, everything after is upside. If it does not, the fallback is `pivot-spec.md` §E-F, unchanged. |
| **Day 4** | Stage 4, the vision call, behind a cache and a feature flag, with the geometry-only path still the fallback on any error. |
| **Days 5–7** | Unchanged from §E: demo path, record, report buffer. |

**Cut first, in this order:** the reflow mode (§C3) — it is a nice-to-have and it is the only piece
that can go wrong in a way that undermines the fidelity claim; then the vision call (Stage 4), whose
absence costs label quality and nothing else; then vertical cuts (§C6 mechanism 1), falling back to
whole-page segments on two-column slides. **Never cut:** Stage 0 build groups, Stage 2 chrome
removal, and split/merge. Those three are what make the flow look deliberate rather than broken.

### C8. What this does *not* solve, stated plainly

- **Search and anchoring inside maths still use corrupted text** (§A1.2). ⌘F for "sum over i" will
  not find the summation. This is unchanged by any choice in this document short of paying Mathpix or
  Azure, and it should be stated as a known limitation rather than papered over. `region_text` being
  empty or wrong on a maths region is normal (`pivot-spec.md` §A2 already says so).
- **A crop cannot reflow** (§B4, WCAG 1.4.10). At a narrow window a slide crop scales down or scrolls
  horizontally. The reflow mode is the mitigation and it is a partial one.
- **Concept boundaries have no ground truth** (§B5). "Accuracy" is not measurable here; the honest
  evaluation question is *how often does the learner adjust a boundary*, which is measurable, is a
  genuinely interesting result for the report, and should be logged from Day 3.

---

## D. Mockup brief

**Use one source page throughout: page 10 of the CS4246 deck** — title, a grid-world figure labelled
(a)/(b), a "Transition model" bullet group with maths glyphs, a "Markovian assumption" bullet group.
It is the ideal specimen because it contains the two-column case, the figure-shared-by-two-concepts
case (§C6) and real maths, all on one slide the reader can verify against.

**The one thing every artboard must make obvious at a glance:** *these pixels came out of the PDF.*
Three drawing devices do that work, and they should be used consistently:
**(i)** the crop is **full-bleed inside its card** — no padding, no rounded corners on the image, the
slide's own white/background running edge to edge, so the card frames the slide rather than
containing a picture of it;
**(ii)** the slide's **own typeface is visibly different** from every piece of app chrome around it;
**(iii)** the crop's edges land **mid-gutter on the slide**, and the cut edge is left slightly
ragged-honest — a crop that ends exactly at a tidy boundary looks re-drawn; a crop that ends in the
slide's real whitespace looks *cut*.

### D1. Artboard 1 — "The flow" (the hero)

1. 760 px column, three stacked segment cards from page 10, in reading order.
2. Card A: crop of the title + grid-world figure. Card B: crop of the "Transition model" bullets,
   maths glyphs intact. Card C: crop of "Markovian assumption".
3. Each card: thin label strip *above* the crop — concept name (left), page chip "p. 10" (right).
4. The crop below it, full-bleed, hairline 1 px border, no radius on the image itself.
5. Drag handle in the left gutter, outside the crop. Split affordance in the right gutter.
6. Between cards, the faint "+ Ask here" line from the earlier mockups.
7. Top-right of the flow: the "Original pages" toggle, unpressed.
8. **Draw the slide's real fonts and the real figure. If the mockup's "crop" is set in the UI font, the whole artboard argues the opposite of the point.**

### D2. Artboard 2 — "Compare with original" (the fidelity proof)

1. Same card B ("Transition model"), hovered.
2. The page chip has expanded into a floating panel, anchored to it, ~280 px wide.
3. The panel holds a **thumbnail of the whole page 10**, rendered identically, not a wireframe.
4. On that thumbnail, the segment's rectangle is drawn as a bright outline, the rest dimmed ~40 %.
5. Caption under the thumbnail: "Region of page 10 · nothing has been re-typeset."
6. A small "Open page" link in the panel's corner.
7. The card beneath stays fully visible — the panel overlaps the gutter, never the crop.
8. **This artboard is the argument.** Dimmed-page-plus-bright-rectangle is the single clearest way to say *the segment is a region of this, not a copy of this.*

### D3. Artboard 3 — "Splitting a crop"

1. One tall card: the whole of page 10 as a single crop, mid-split.
2. The learner's horizontal split line drawn **across the crop**, snapped into the gutter between the figure and the "Transition model" heading.
3. The line is the only thing ever drawn on top of slide pixels — make it unmistakably a tool: 2 px, app accent colour, with a grab dot at each end.
4. Two faint tick marks at the other candidate cuts (§C2 Stage 3), showing the snap targets.
5. A tiny readout by the cursor: "Split here — p. 10, 46 %".
6. Above the line, a ghosted label field pre-filled with the proposed concept name.
7. Greyed, crossed-out ghost line drawn *through the figure* with a small "won't cut a figure" note — this shows R2 visually and takes two seconds to read.
8. Merge, inset small: two adjacent cards with their shared edge highlighted and a "⤺ Merge" chip on it.

### D4. Artboard 4 — "AI segment beside a crop" (the distinction)

1. Card B (crop, "Transition model") on top, unchanged and full-bleed.
2. Directly below, an AI segment answering a question about it — Ellie or the `reference` voice.
3. Make all four separations from §C4 visible simultaneously: **UI font** (not the slide's), **inset** with a left rule in the agent's colour, **agent name + avatar** in its header, **app background** (a faint tint, so it is clearly not paper).
4. Include one equation in the AI segment set in the app's maths style — visibly *not* Computer Modern / not the slide's maths.
5. A short callout arrow from the AI segment's header up to a region of the crop above it — pointing at the slide, never drawn inside it.
6. A "Written by ChatterED · from p. 10" micro-label in the AI segment's footer.
7. No page chip on the AI segment; no avatar on the crop. The two card types must share zero chrome.
8. Put them adjacent and at the same width — the reader should be able to tell them apart from across the room, without reading a word.

### D5. Artboard 5 (optional) — "Reflowed mode, with its warning"

1. Same two concepts, same flow position, reflow toggle switched on.
2. Running text in the app's UI font, left-aligned, comfortable measure.
3. A persistent amber warning band at the top of the reflowed region: "Reflowed text — maths and figures may be wrong."
4. Show the KKT-style damage honestly in the body: a summation rendered as a stray `P`, limits detached onto their own line.
5. Where the figure was, a placeholder tile reading "Figure — view original", not a reconstruction.
6. A prominent "Show original" button, visually heavier than the reflow toggle that got you here.
7. Draw it slightly less attractive than Artboards 1–4. It is the lesser mode and should look it.
8. **Its job in the deck is to be the contrast that makes Artboard 1 land**, so put it last and keep it small.

---

## E. Risks and open questions

1. **No real MA3236/CS4246-style maths deck was measured.** §A1.2 is a synthetic Beamer deck I wrote,
   so I chose the equations. The `∑`→`P` failure is a property of CMEX encoding rather than of my
   choices, but density, hand-annotation and export toolchain are unknown. **Action: run §A1.1's
   coverage measurement on one real lecture deck before Day 2.** Ten minutes; highest-value missing
   evidence in this document. *(Partly retired — the coordinator reports clean text blocks and a
   text-free figure region on CS4246 p. 10, which is consistent with everything here.)*
2. **Concept boundaries have no ground truth, for anyone** (§B5 — no benchmark exists; RealSlide's
   best slide-element detector is mAP ≈ 38.8). We cannot claim accuracy and should not try. The
   design absorbs this by making learner correction primary, but it means **the evaluation question
   must be reframed** from "is the segmentation right?" to "how often does the learner adjust it, and
   does adjusting feel like authorship or like repair?" — decide this before the interviews, not
   after.
3. **The whole plan assumes slides, one concept per region.** A deck that is one dense equation
   derivation per page, or a deck of scanned handwriting, degrades to one segment per page. That is a
   *correct and faithful* outcome, but it is also a flow that looks exactly like the old page viewer —
   i.e. the pivot's visible value disappears on the worst-case corpus. **Open question: is
   one-segment-per-page an acceptable demo, or does the video need a deck chosen to segment well?**
   Choosing the deck is legitimate; not noticing you chose it is not.
4. **Progressive-build detection (§A1.5) is the highest-risk small component.** Get it wrong and the
   flow shows the same slide three times — the most visible possible failure, and it happens on
   Beamer decks specifically, i.e. maths modules. The containment test is simple but untested on real
   builds, and **UNVERIFIED** on PowerPoint (which usually flattens animations, making this a
   Beamer-only problem — but "usually" is doing work in that sentence).
5. **`recordOperations` (§B1.3 Method 2) is read-but-not-run.** It is the better figure-detection
   route and its bboxes are quantised to 8 bits per coordinate, which I believe is sufficient for
   boundaries but did not execute. Method 1 is measured and works; do not put Method 2 on the
   critical path until it has been run once in the renderer.
6. **Licensing drifts under the commercial intent.** Marker's code is Apache 2.0 but its *weights*
   are OpenRAIL-M-restricted above $5M revenue; MinerU is AGPL; PyMuPDF is AGPL. None is on the A1
   path, so none bites now — but the A2 "anchor oracle" idea (§B2) walks straight into it. **Docling
   is MIT and is the only one of the three with no licensing tail**, which is a reason to prefer it
   for A2 beyond its provenance model.

---

### Appendix — what this document does not settle

It does not settle the **save format** (unchanged: `pivot-spec.md` §A3 — SQLite as source of truth,
sidecar as derived mirror), the **anchor cascade** (unchanged: §A2, Hypothesis's model), or **which
agents write into which segments** (`pivot-spec.md` §B). It settles one question only: *what a
segment is made of.* The answer is **pixels from the original page, addressed by a rectangle** — and
everything else in the pivot spec continues to work unchanged on top of that, because a rectangle in
page space is exactly what the `anchors` table was already designed to store.
