/**
 * **Pass 2's prompt: turn a window of slides into lecture notes** (#48, `collab-doc.md` §2).
 *
 * The brief's demand, in one sentence: *cohesive lecture notes that can be read without ever
 * opening the slides*. Everything in here serves that and the four rules under it — provenance
 * on every block, the lecture's own structure as the headings, a figure wherever the layout
 * carries meaning text cannot, and nothing the slides do not support.
 *
 * **What the slides teach, not what they say** (2026-09-23). Version 3 asks for the teaching point
 * of each stretch of slides, organised by idea in the deck's order, under a word budget computed
 * in code (`windowWordBudget`) because a model writing twelve slides at once cannot keep a
 * per-slide count. The notes were first measured at 2.3–3.0× the slides' words; that turned out to
 * be every window stored twice (see `ops.ts` `appendNodes`). Deduplicated, v2 ran 1.13–1.47×, so
 * the gain here is mostly organisation — headings 48 → 25 on Lecture-complex, length 1.14× → 1.08×.
 */
import type { DocBlockDraft } from '../../shared/doc/types.js';
import type { NotesPageExtract } from './extract.js';
import { windowPrompt } from './extract.js';
import type { PageWindow } from './windows.js';

/**
 * Bump when this prompt, or `DRAFT_BLOCK_JSON_SCHEMA`, would produce different notes for the
 * same bytes. Half the cache key alongside `content_sha`: a document ingested under an older
 * prompt is re-ingested on next open rather than silently kept — unless the learner has edited
 * it, in which case their words win and it is left exactly as it is.
 */
export const NOTES_PROMPT_VERSION = 4;

/**
 * **The window ingest's own version**, frozen at 3 when the overview (`overview.ts`, 2026-10-01)
 * took `NOTES_PROMPT_VERSION` to 4. The window ingest still serves a doc keyed on a file rather
 * than a notebook, and must neither re-ingest every #48 doc because the overview's prompt moved
 * nor write a version that would make its own docs look like unfinished overviews.
 */
export const WINDOW_NOTES_VERSION = 3;

export const NOTES_SYSTEM = [
  'You are writing the lecture notes for one lecture, from the lecturer\'s own slides.',
  '',
  'WHAT THE NOTES ARE FOR. A student opens them to learn what this lecture is trying to teach, and',
  'comes back to them to find it again. They are not a transcript of the slides and not a textbook',
  'chapter on the topic. For every stretch of slides, work out what the lecturer is trying to get',
  'across — the idea, the definition, the method, the result, the reason it matters — and write',
  'that, organised so a student can take it in.',
  '',
  'THE TWO TESTS YOUR OUTPUT MUST PASS, and it must pass both.',
  '',
  '1. **A student who reads only the notes comes away with what the lecture teaches.** The ideas,',
  '   what their terms mean, how the methods work and why they matter — not every example, aside',
  '   and bullet the slides happen to carry.',
  '2. **A student actually reads them to the end.** This is the harder test and the one notes',
  '   usually fail. Interviewed students say AI-written help is too long and not pitched at them,',
  '   and that they can tell at a glance they are not going to finish it. A note nobody finishes',
  '   teaches nothing, so length is a cost, not a virtue.',
  '',
  'ORGANISE BY IDEA, IN THE DECK\'S ORDER.',
  '',
  '- **A section is one idea, not one slide.** Several slides that develop one idea are one section',
  '  with one heading. A slide never gets its own heading just because it is a slide. Keep the',
  '  deck\'s order, and use the lecturer\'s own words for headings where the deck gives them.',
  '- **Each section opens with its takeaway**: the one or two sentences a student should leave',
  '  with. Then only what that takeaway needs — what its terms mean, how it works, one example if',
  '  the slides give one — and stop. Never build up to the point.',
  '- **Plain words before jargon.** Say what a term means the first time you use it, in ordinary',
  '  language, then use the term. Never use a term the lecture has not defined and you have not.',
  '- **Write prose, not a bullet transcription.** A slide\'s bullets are the lecturer\'s speaking',
  '  notes; the notes you write are what they were teaching. Use a bullet list only where the',
  '  content genuinely is a list — named cases, the steps of an algorithm, the parts of a',
  '  definition — and keep each item to a line.',
  '',
  'WHAT TO LEAVE OUT.',
  '',
  '- **Slides that teach nothing**: title, agenda, roadmap, recap, section-divider, "questions?",',
  '  admin and reading-list slides. A heading at most, and usually not even that.',
  '- **Repetition.** Several examples of one point: keep the clearest. A point the notes already',
  '  made on an earlier slide: do not make it again.',
  '- **What the slides mention without teaching**: a passing name, a teaser for a later lecture.',
  '- **Padding.** Cut "it is important to note", "as we can see", "this section covers", "in this',
  '  lecture we will". Do not restate a heading as a sentence. No introduction to a section and no',
  '  summary of one.',
  '- **Narrating the deck.** Never write "this slide shows", "the lecturer then explains", "the',
  '  section opens with", "as we saw on the previous slide". Write the material itself.',
  '- **Exam framing.** Never write "you will be tested on", "for the exam", "make sure you',
  '  remember". These are notes on what the lecture teaches, not advice about assessment.',
  '',
  'LENGTH. Each window comes with a word budget, worked out from how much its slides actually say.',
  'It is a **ceiling, not a target**: most windows need less, and a window of mostly title and',
  'divider slides needs very little. Paragraphs are 2–4 sentences; if an idea needs more, it needs a',
  'second paragraph, not a longer one.',
  '',
  'PROVENANCE IS MANDATORY ON EVERY BLOCK. Every block carries `prov`, and it must have at least',
  'one of:',
  '',
  '- `pages`: the 1-based pages of THIS deck the content came from. Usually one or two. Never a',
  '  page this window was not given, and never a page number you inferred from the content.',
  '- `reason`: one short phrase saying why the block is here when no slide says it — you are',
  '  allowed to add a bridging sentence, a definition the lecture assumes, or a transition, and',
  '  when you do you must say so: `"bridges p. 12 and p. 13"`, `"defines a term the deck assumes"`.',
  '',
  'A block with neither is rejected and thrown away. Bridging material is welcome and is the',
  'reason the notes read as notes; unmarked bridging material is a lie about where it came from.',
  '',
  'FIGURES. Some slides carry their meaning in the layout: a diagram, a flow chart, a table, a',
  'worked derivation laid out in steps, an architecture, a plotted curve. Text cannot carry those,',
  'and a student reading the notes alone must see them. For each one, emit a `figure` block at the',
  'point in the notes where it belongs:',
  '',
  '- `page` is the slide to show. `rect` is one of the FIGURE REGIONS listed under that slide,',
  '  copied exactly — or omit `rect` to show the whole slide, which is usually right when the',
  '  whole slide is the diagram.',
  '- `caption` is one line saying what it shows, and the prose around it still has to explain the',
  '  idea. A figure supplements the notes; it never replaces them.',
  '- **Do not emit a figure for a decorative slide**: a title slide, a section divider, a photo,',
  '  a logo, a slide whose only graphic is a background or a border. If the words you have',
  '  written already carry the whole idea, there is no figure.',
  '',
  'Most decks have a handful of genuinely evidentiary slides, not one per page. Be selective:',
  'a figure on every slide is the same failure as a figure on none.',
  '',
  'MATHS. Inline maths is `$...$` and a standalone equation is a `math` block with the TeX in',
  '`tex` (no `$` delimiters). Symbols the slide uses must keep the slide\'s own notation.',
  '',
  'INLINE MARKUP is exactly four things: `**bold**`, `*italic*`, `` `code` `` and `$tex$`.',
  'Nothing else is markup — no headings inside text, no links, no HTML.',
  '',
  'NEVER INVENT CONTENT THE SLIDES DO NOT SUPPORT. You may explain, connect, define and phrase;',
  'you may not add a fact, a result, a citation or a number that is not in the deck. If a slide',
  'is too sparse to write from, say less about it rather than filling it in. Saying less is',
  'always allowed; padding a thin slide is the failure the second test is about.',
  '',
  'Return the JSON object and nothing else: no preamble, no reasoning before it, no commentary',
  'after it.',
].join('\n');

/**
 * **The most words one page may add to the notes' budget**, and the least a page must say before
 * it adds any. The ceiling is v2's own "60–90 words per content slide"; the multiplier lets a
 * terse slide be explained rather than restated; the floor is what makes a title or divider slide
 * cost nothing.
 */
export const PAGE_BUDGET_MAX = 90;
export const PAGE_BUDGET_PER_SLIDE_WORD = 1.2;
export const PAGE_BUDGET_MIN_SLIDE_WORDS = 12;
/** A near-wordless page with a drawn figure still needs a caption and a sentence. */
export const PAGE_BUDGET_FIGURE_ONLY = 30;

/** One page's share of the budget. Pure, so the arithmetic is testable without a model. */
export function pageWordBudget(page: Pick<NotesPageExtract, 'words' | 'figures'>): number {
  if (page.words < PAGE_BUDGET_MIN_SLIDE_WORDS) return page.figures.length > 0 ? PAGE_BUDGET_FIGURE_ONLY : 0;
  return Math.min(PAGE_BUDGET_MAX, Math.round(page.words * PAGE_BUDGET_PER_SLIDE_WORD));
}

/** A window's word ceiling: the pages' shares, rounded to ten, and never below one paragraph. */
export function windowWordBudget(pages: readonly Pick<NotesPageExtract, 'words' | 'figures'>[]): number {
  const sum = pages.reduce((n, p) => n + pageWordBudget(p), 0);
  return Math.max(60, Math.round(sum / 10) * 10);
}

/** Words in a set of drafted blocks — the other half of the `notes.window` log's ratio. */
export function draftWords(blocks: readonly DocBlockDraft[]): number {
  const count = (t: string): number => t.split(/\s+/).filter((w) => w.length > 0).length;
  return blocks.reduce((n, b) => {
    switch (b.kind) {
      case 'heading':
      case 'paragraph':
      case 'code':
        return n + count(b.text);
      case 'bullets':
      case 'numbers':
        return n + b.items.reduce((m, i) => m + count(i), 0);
      case 'figure':
        return n + count(b.caption);
      case 'math':
        return n;
      // The ingest writes neither (`validateDrafts` rejects both); counted for completeness.
      case 'table':
        return n + b.columns.concat(b.rows.flatMap((r) => r.cells)).reduce((m, c) => m + count(c), 0);
      case 'diagram':
        return n + b.nodes.reduce((m, node) => m + count(node.label), 0);
      default:
        // A block kind this switch does not know yet (other tracks add kinds): count the words
        // of any text it carries, wherever it is nested, rather than failing to compile.
        return n + looseWords(b as unknown, count);
    }
  }, 0);
}

/** Words in every string under `text`, `items`, `caption`, `label`, `title` or nested arrays/objects. */
function looseWords(v: unknown, count: (t: string) => number, depth = 0): number {
  if (depth > 6 || v === null || v === undefined) return 0;
  if (typeof v === 'string') return count(v);
  if (Array.isArray(v)) return v.reduce((m: number, x) => m + looseWords(x, count, depth + 1), 0);
  if (typeof v !== 'object') return 0;
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    // Skip identifiers and structural fields; only prose counts.
    if (k === 'kind' || k === 'reason' || k === 'id' || k === 'pages' || k === 'src' || k === 'lang') continue;
    n += looseWords(x, count, depth + 1);
  }
  return n;
}

/** What the ingest knows when it asks for one window. */
export interface WindowPromptInput {
  /** The deck's title, as the flow names it. */
  title: string;
  window: PageWindow;
  /** Which window this is, and of how many, so the model knows where it stands in the lecture. */
  index: number;
  total: number;
  /** The pages of this window, from pass 1. */
  pages: readonly NotesPageExtract[];
  /**
   * The headings written so far, as a running outline. It is derived from the document, not
   * asked of the model: a model-written outline can drift from what it actually wrote, and the
   * document is the thing that is true.
   */
  outlineSoFar: string;
  /** True when the slide images for this window are going with the call. */
  withImages: boolean;
  /** The deck's learning objectives, when the tree happens to be ready. A hint, never a plan. */
  objectives?: readonly { id: string; title: string }[];
}

/** The user message for one window. */
export function windowMessage(input: WindowPromptInput): string {
  const parts: string[] = [`LECTURE: ${input.title}`];

  if (input.outlineSoFar.trim().length > 0) {
    parts.push(
      [
        'THE NOTES SO FAR (the headings you have already written for this lecture). Continue from',
        'here: do not repeat a section, do not re-introduce the lecture, and keep the same voice.',
        'Keep to this window\'s own budget, however long the earlier windows ran.',
        '',
        input.outlineSoFar.trim(),
      ].join('\n'),
    );
  } else {
    parts.push(
      'These are the opening slides. Begin the notes here — no preamble about what the lecture' +
        ' will cover, just the material.',
    );
  }

  if (input.objectives && input.objectives.length > 0) {
    parts.push(
      [
        'WHAT THIS LECTURE TEACHES (derived separately from the whole deck). Use it only to judge',
        'what matters; it is not an outline to follow and you must not write about anything this',
        'window\'s slides do not cover.',
        '',
        ...input.objectives.map((o) => `  - ${o.title}`),
      ].join('\n'),
    );
  }

  if (input.withImages) {
    parts.push(
      [
        'YOU HAVE THE SLIDE IMAGES for these pages as well as the text below. Use them for what',
        'the text cannot show: which slides are diagrams, how a figure is laid out, what a table',
        'contains, and which region of a slide a figure block should crop to. The text below is',
        'still the authority on wording — the images are how you see the slide.',
      ].join('\n'),
    );
  }

  parts.push(
    [
      `THE SLIDES — window ${input.index + 1} of ${input.total}, pages ${input.window.from}–${input.window.to}.`,
      'Each slide is its page number, its title line, its text lines in reading order, and the',
      'figure regions found on it. A two-column or diagram slide may read as interleaved',
      'fragments; that is the slide being a picture, and it is usually a slide that wants a figure.',
      '',
      windowPrompt(input.pages),
    ].join('\n'),
  );

  const budget = windowWordBudget(input.pages);
  const slideWords = input.pages.reduce((n, p) => n + p.words, 0);
  parts.push(
    `Write the notes for pages ${input.window.from}–${input.window.to} now, as \`blocks\`.` +
      ` These slides say about ${slideWords} words; **your notes for them are at most ${budget} words**,` +
      ' headings and captions included, and fewer when the slides teach less.' +
      ' One heading per idea, not per slide; each section opens with its takeaway.' +
      ' Every block needs its `prov`.',
  );

  return parts.join('\n\n');
}

/**
 * The running outline, from the blocks a window produced.
 *
 * Headings only, with their level, which is what "the notes so far" has to be: enough for the
 * next window to continue the structure, small enough that window nine is not paying for
 * eight windows of prose.
 */
export function outlineLines(blocks: readonly DocBlockDraft[]): string[] {
  return blocks
    .filter((b): b is Extract<DocBlockDraft, { kind: 'heading' }> => b.kind === 'heading')
    .map((b) => `${'#'.repeat(b.level)} ${b.text}`);
}
