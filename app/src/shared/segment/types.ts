/**
 * The segmentation contract (issue #25, issue #31).
 *
 * Every type here is plain data — no Electron, no SQLite, no pdf.js, no DOM. The renderer's
 * flow, the main process's repository and the tests all speak exactly this vocabulary, and
 * `app/docs/SEGMENTS.md` is its prose description.
 *
 * ## Coordinates
 *
 * **Every rectangle in this file is normalised 0–1 against the page box, with `y` measured
 * DOWN from the page top.** That is the crop convention (`pivot-spec.md` §A2: a `box` anchor is
 * `page` + `x0,y0,x1,y1` normalised 0–1) and the canvas convention, so a segment rectangle
 * multiplies straight into `ctx.drawImage(pageCanvas, sx, sy, sw, sh, …)` with no flip.
 *
 * PDF user space is y-**up**; the flip happens once, in the extractor
 * (`src/main/vault/geometry.ts`), and never again. Anything measured in points — a whitespace
 * gap, a snap radius — carries `Pt` in its name and is converted against `PageGeometry.height`.
 */

/** A rectangle on one page, normalised 0–1, y down from the top. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One text item from the pdf.js text layer, as a box. Zero-width items are never here. */
export interface TextBox extends Box {
  /** `TextItem.str`, verbatim. */
  text: string;
  /** `TextItem.height` — pdf.js's font size in points, not the glyph height (§B1.1). */
  fontPt: number;
  /** pdf.js's internal font id (`g_d0_f1`), useful only for grouping. */
  fontName: string;
}

/**
 * A non-text mark: a painted path or an image XObject (§B1.3 Method 1).
 *
 * `'container'` is the third kind and the one that is not in the brief. §B1.3's own merge fuses
 * a slide's panel outlines, table rules and card backgrounds into one huge box; taken as a
 * *figure*, such a box refuses every cut on the page. Measured on the fixture deck, the
 * separation is not subtle — a real figure holds **0–16 %** of its page's text boxes, a panel or
 * a background holds **27–100 %** — so an ink box holding at least `CONTAINER_TEXT_SHARE` of the
 * page's text runs is a container: it is drawn *behind* text, and a cut in a gap between its own
 * lines does not slice a diagram. Only `'path'` and `'image'` block a cut.
 */
export interface InkBox extends Box {
  kind: 'path' | 'image' | 'container';
}

/** Share of a page's text runs an ink box must hold before it is a container, not a figure. */
export const CONTAINER_TEXT_SHARE = 0.25;

/** A tagged-PDF role for one text box, when `getStructTree()` returned anything (§B1.4). */
export interface StructRole {
  /** Index into `PageGeometry.textBoxes`. */
  box: number;
  /** `H1`…`H6`, `P`, `Figure`, `Sect`, … — PowerPoint/Keynote exports only. */
  role: string;
}

/**
 * Everything Stage 1 knows about one page. `width`/`height` are in PDF points at `scale: 1`
 * (the viewport box), and they are the only unnormalised numbers in the whole package.
 */
export interface PageGeometry {
  /** 1-indexed source page number. Survives the Stage 0 build-group merge. */
  page: number;
  width: number;
  height: number;
  textBoxes: TextBox[];
  inkBoxes: InkBox[];
  /** Parallel to `textBoxes`: true where Stage 2 decided the box is repeating slide chrome. */
  chrome: boolean[];
  /** Bonus, from `getStructTree()`. Absent on Beamer and every other untagged PDF. */
  struct?: StructRole[];
  /** Count of `paintImageXObject` ops — the genre router's "image XObjects present" test. */
  imageCount: number;
}

/**
 * A segment: a crop of one rendered page. Exactly the shape issue #25 specifies.
 *
 * `source` records who drew the boundary, which is the Assignment-2 measure the lazy-split
 * brief §2.2 asks for: `'geometry'` is a whole-page segment or an accepted candidate tick,
 * `'learner'` is a free cut or a merge.
 */
export interface Segment {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
  source: 'geometry' | 'learner';
}

/** A segment as it crosses IPC: identified, ordered, and told which ticks to draw. */
export interface SegmentView extends Segment {
  /** Stable across split/merge/reorder; the renderer addresses a segment by this. */
  id: string;
  /** Position in the flow. Contiguous from 0, and the only thing `segments:reorder` changes. */
  order: number;
  /** Stage 0: the earlier build pages this one stands for. Empty on a normal page. */
  buildSteps: number[];
  /** Stage 3 candidates falling strictly inside this segment. Ticks, in card-gutter order. */
  candidates: CutCandidate[];
}

/** Why a geometrically real gap is not offered as a cut. `null` on an accepted candidate. */
export type CutBlock =
  /** The line crosses a figure — the "won't cut a figure" refusal (§C6 rule, §A3 R2). */
  | 'figure'
  /** Above the title band; cutting there separates a slide title from its own slide. */
  | 'title-band'
  /** A real gap, but under `G`. Kept so a free cut can still snap to it. */
  | 'gap-too-small'
  /** The gap only exists because a footline or slide number was excluded (Stage 2). */
  | 'chrome';

/**
 * One proposed cut line in page space. `at` is normalised: a `y` for a horizontal cut, an `x`
 * for a vertical one (§C6's column gutter — "the same computation rotated").
 */
export interface CutCandidate {
  page: number;
  axis: 'horizontal' | 'vertical';
  at: number;
  /** The whitespace gap this line sits in the middle of, in PDF points. */
  gapPt: number;
  /** `null` when the candidate is offered. A reason string when it is a near-miss. */
  blockedBy: CutBlock | null;
}

/**
 * Stage 0. `page` is the page that is **kept** — the last, complete one — and `steps` are the
 * earlier pages it subsumes, in order. `steps.length` is the "⏴ N build steps" chip.
 */
export interface BuildGroup {
  page: number;
  steps: number[];
}

/** The genre router's verdict (`segmentation-genres.md` §H, issue #31). */
export type Genre = 'slides' | 'paper-2col' | 'prose' | 'image-only' | 'ink-only';

/** The measurements the router decides on, exposed so a test can assert the inputs. */
export interface GenreSignals {
  /** Median words per kept page. */
  wordsPerPage: number;
  /** Median fraction of the page area under the union of text boxes. */
  textCoverage: number;
  /** Median number of x-clusters (columns) across kept pages. */
  columns: number;
  /** True when the median page is wider than it is tall. */
  landscape: boolean;
  /** Total `paintImageXObject` ops across kept pages. */
  images: number;
}

/** What the whole pipeline returns for one file. */
export interface Segmentation {
  genre: Genre;
  signals: GenreSignals;
  /**
   * `null` for slides. Otherwise the sentence the flow shows above the first card
   * (`segmentation-genres.md` §H: "say it in the UI").
   */
  notice: string | null;
  /** The kept pages, with `chrome` filled in by Stage 2. */
  pages: PageGeometry[];
  /** Non-empty only where a page subsumed build steps. */
  builds: BuildGroup[];
  /** One whole-page segment per kept page, in page order. Lazy split: nothing is cut yet. */
  segments: Segment[];
  /** Stage 3. Empty for every genre but `'slides'` (issue #25 decision 5). */
  candidates: CutCandidate[];
}

/** The tuning constants. Overridable so a test can pin them and a genre can move them. */
export interface SegmentOptions {
  /** Minimum whitespace gap for a candidate cut, in points. 16 pt is a *slides* constant (§D3). */
  gapPt: number;
  /** Gaps at or above this, but under `gapPt`, come back as `blockedBy: 'gap-too-small'`. */
  nearMissPt: number;
  /** Cuts above this normalised y are `blockedBy: 'title-band'`. §C2 stage 3 condition (c). */
  titleBand: number;
  /** Share of pages a verbatim box must repeat on to be chrome. §C2 stage 2. */
  chromeShare: number;
  /** Token containment above which an earlier page is a build step of a later one. §C2 stage 0. */
  buildContainment: number;
  /** Free-cut snap radius, in points. §C5 / lazy-split §4. */
  snapPt: number;
}

export const DEFAULTS: SegmentOptions = {
  gapPt: 16,
  nearMissPt: 8,
  titleBand: 0.12,
  chromeShare: 0.6,
  buildContainment: 0.95,
  snapPt: 8,
};
