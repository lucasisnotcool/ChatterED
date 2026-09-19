/**
 * **Pass 1 of the notes ingest: the deck as structured data** (`docs/research/collab-doc.md` §2).
 *
 * "All original slide text, per page, as structured data." This is that, and it is deliberately
 * *only* that: no model, no judgement about what matters, nothing invented. Every line here is
 * something the PDF's own text layer says, in the order a reader meets it, with the box it
 * occupies and the figure regions it sits beside.
 *
 * It is built on `PageGeometry` (`vault/geometry.ts`) rather than on `extractPdfText`, because
 * pass 2 needs three things the flat text record cannot give:
 *
 *  - **reading order and grouping.** pdf.js emits one item per style run, so "the" "Bellman"
 *    "equation" can be three items; lines have to be rebuilt from baselines or the model reads
 *    a slide as a word salad.
 *  - **the title line**, which `slideTitle()` already lifts from the tagged `H1`–`H6` box or
 *    from the largest font. The lecture's own structure is what the notes' headings must follow,
 *    and this is where that structure is.
 *  - **the figure regions**, already classified figure-vs-container by `classifyInk`. A
 *    `slide_figure` block's `rect` comes from here: pixels of the real page, not a redraw.
 *
 * Chrome (the repeating footer, the slide number) is dropped: `markChrome` has already decided
 * which boxes are chrome, and a page number repeated sixty-six times is not content. The
 * **page numbers are the source PDF's**, so a block's `prov.pages` and a figure's `page` mean
 * what a learner clicking the provenance chip expects.
 *
 * Deterministic, and tested against the committed fixture deck.
 */
import type { Box, InkBox, PageGeometry, TextBox } from '../../shared/segment/types.js';
import type { Rect } from '../../shared/doc/types.js';
import { slideTitle } from '../../shared/segment/labels.js';

/** One rebuilt line of a slide, in reading order. */
export interface NotesTextLine {
  /** The line's text, runs joined. Never empty. */
  text: string;
  /** Normalised 0–1, y down — the same convention as everything else in the app. */
  box: Box;
  /** The largest font size on the line, in points. What distinguishes a heading from body. */
  fontPt: number;
  /** `H1`–`H6`, `P`, `Figure`, … from the tagged PDF, when there is one. */
  role: string | null;
}

/** A figure region: painted ink or an image XObject, never a panel background. */
export interface NotesFigureBox {
  rect: Rect;
  kind: 'path' | 'image';
  /** Share of the page the region covers. The prompt uses it to rank what is worth showing. */
  area: number;
}

/** Everything pass 2 is told about one slide. */
export interface NotesPageExtract {
  /** 1-based, the source PDF's own page number. */
  page: number;
  /** The slide's own title line, or `''` on a page with no text at all. */
  title: string;
  lines: NotesTextLine[];
  figures: NotesFigureBox[];
  /** `paintImageXObject` count — a photo or a pasted screenshot rather than drawn vectors. */
  imageCount: number;
  /** Words on the page, chrome excluded. A near-empty slide is a section divider, not content. */
  words: number;
}

/**
 * Ink covering less of the page than this is a rule, a bullet glyph or a fragment of a border —
 * not a diagram worth cropping into the notes. Measured on the fixture deck: the real diagrams
 * are 8–60 % of their page, the noise is under 1 %.
 */
export const MIN_FIGURE_AREA = 0.012;

/**
 * At most this many figure regions per page in the prompt. A slide with nine candidate regions
 * has a drawn background the classifier let through, and listing all nine teaches the model
 * nothing except that the page is busy.
 */
export const MAX_FIGURES_PER_PAGE = 4;

/** Two boxes are on the same line when their vertical centres are within this share of the line. */
const BASELINE_TOL = 0.55;

/** A gap wider than this many spaces' worth of the font is a real space between runs. */
const RUN_GAP_EM = 0.18;

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function unionBox(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
 * Join two runs pdf.js emitted separately.
 *
 * A style change mid-word (`*f*(x)`) leaves two boxes touching, and inserting a space there
 * corrupts a formula; a gap of a word's width is a real space. The threshold is in *ems* of the
 * run's own font, so it holds on a 40 pt title and on 9 pt body text alike.
 */
function joinRuns(left: { text: string; box: Box; emWidth: number }, right: TextBox): string {
  const gap = right.x0 - left.box.x1;
  const needsSpace = gap > left.emWidth * RUN_GAP_EM;
  const a = left.text;
  const b = right.text;
  if (!needsSpace) return a + b;
  return a.endsWith(' ') || b.startsWith(' ') ? a + b : `${a} ${b}`;
}

/**
 * Rebuild the lines of one page.
 *
 * Sorted top-to-bottom then left-to-right, grouped by baseline. Two-column slides come out
 * interleaved by this, which is a known limitation and the honest one: a column detector that
 * guesses wrong reorders a paragraph silently, whereas an interleaved line is visible in the
 * extraction and the model still has the page's boxes to reason from. `columnGutters` in
 * `shared/segment/boxes.ts` is the upgrade if the demo deck ever needs it.
 */
export function pageLines(page: PageGeometry): NotesTextLine[] {
  const roleFor = new Map<number, string>();
  for (const s of page.struct ?? []) roleFor.set(s.box, s.role);

  const body = page.textBoxes
    .map((box, i) => ({ box, i }))
    .filter(({ box, i }) => page.chrome[i] !== true && box.text.trim() !== '')
    .sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);

  const lines: NotesTextLine[] = [];
  let current: { text: string; box: Box; fontPt: number; role: string | null; emWidth: number } | null = null;

  for (const { box, i } of body) {
    const height = Math.max(box.y1 - box.y0, 1e-4);
    const emWidth = Math.max((box.x1 - box.x0) / Math.max(box.text.length, 1), 1e-5);
    const role = roleFor.get(i) ?? null;
    if (current !== null) {
      const centre = (box.y0 + box.y1) / 2;
      const currentCentre = (current.box.y0 + current.box.y1) / 2;
      const tol = Math.max(current.box.y1 - current.box.y0, height) * BASELINE_TOL;
      if (Math.abs(centre - currentCentre) <= tol) {
        current.text = joinRuns(current, box);
        current.box = unionBox(current.box, box);
        current.fontPt = Math.max(current.fontPt, box.fontPt);
        // A tagged role anywhere on the line is the line's role: PowerPoint tags the title box,
        // and a style change inside it must not lose the tag.
        current.role = current.role ?? role;
        current.emWidth = emWidth;
        continue;
      }
      lines.push({ text: tidy(current.text), box: current.box, fontPt: current.fontPt, role: current.role });
    }
    current = { text: box.text, box: { ...box }, fontPt: box.fontPt, role, emWidth };
  }
  if (current !== null) {
    lines.push({ text: tidy(current.text), box: current.box, fontPt: current.fontPt, role: current.role });
  }
  return lines.filter((l) => l.text.length > 0);
}

/** The figure regions of one page, biggest first, noise and containers dropped. */
export function pageFigures(page: PageGeometry): NotesFigureBox[] {
  return page.inkBoxes
    .filter((ink: InkBox) => ink.kind !== 'container')
    .map((ink) => ({
      rect: { x0: round3(ink.x0), y0: round3(ink.y0), x1: round3(ink.x1), y1: round3(ink.y1) },
      kind: ink.kind as 'path' | 'image',
      area: round3((ink.x1 - ink.x0) * (ink.y1 - ink.y0)),
    }))
    .filter((f) => f.area >= MIN_FIGURE_AREA)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_FIGURES_PER_PAGE);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Pass 1, whole deck. Pure over the geometry, so it is testable without pdf.js. */
export function extractNotesPages(pages: readonly PageGeometry[]): NotesPageExtract[] {
  return pages.map((page) => {
    const lines = pageLines(page);
    return {
      page: page.page,
      title: slideTitle(page),
      lines,
      figures: pageFigures(page),
      imageCount: page.imageCount,
      words: lines.reduce((n, l) => n + l.text.split(/\s+/).filter((w) => w.length > 0).length, 0),
    };
  });
}

/**
 * One page, as the refine prompt sees it.
 *
 * Plain text and not JSON, on purpose: this is the *input* half of a call whose *output* is
 * schema-bound, and a model reads a slide faster than it reads a slide's serialisation. The
 * figure line is the one piece of geometry that goes in, because a `figure` block's `rect` has
 * to be one of these numbers — the model may choose a region, it may not invent one.
 */
export function pagePrompt(page: NotesPageExtract): string {
  const head = page.title.length > 0 ? `[p. ${page.page}] ${page.title}` : `[p. ${page.page}]`;
  const body = page.lines
    // The title line is already the header; repeating it verbatim wastes tokens and invites the
    // model to write it twice.
    .filter((l) => tidy(l.text) !== tidy(page.title))
    .map((l) => l.text);
  const figures = page.figures.map(
    (f, i) =>
      `  region ${i + 1}: ${f.kind} rect=[${f.rect.x0}, ${f.rect.y0}, ${f.rect.x1}, ${f.rect.y1}] (${Math.round(f.area * 100)}% of the slide)`,
  );
  const parts = [head, ...body.map((l) => `  ${l}`)];
  if (figures.length > 0) parts.push('  FIGURE REGIONS ON THIS SLIDE:', ...figures);
  if (body.length === 0 && figures.length === 0) parts.push('  (no text layer on this slide)');
  return parts.join('\n');
}

/** The pages of one window, as one block of prompt text. */
export function windowPrompt(pages: readonly NotesPageExtract[]): string {
  return pages.map(pagePrompt).join('\n\n');
}
