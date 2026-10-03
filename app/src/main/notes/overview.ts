/**
 * **The learning overview: its prompt, its gate and its shape** (`docs/research/notebooks.md` §3,
 * contract C5 and C6; #58).
 *
 * The notebooks redesign takes the first full pass at the notes away from the AI. What it writes
 * instead is one short overview per notebook, across the ticked sources: a title, a two-to-three
 * sentence lede, four to six objectives ("By the end you can"), and three to eight sections (scaled to the budget), each a
 * heading, a one-line takeaway, two or three cited key ideas and an empty slot for the learner's
 * own note. The rest of the notes grow from what the learner chooses to work on (§0).
 *
 * This file is **pure**: no database, no clock, no model. It holds
 *
 *  - the word budget (§3.2), computed in code because a model asked for "about 350 words" over a
 *    60-page deck writes what it likes, and a ceiling has to be a number it is told;
 *  - the prompt and the JSON schema of the one call (§3.5);
 *  - `validateOverview`, the gate between what the model said and what reaches the doc. It
 *    **repairs before it rejects**, as `shared/doc/validate.ts` does: counts are clamped, pages
 *    outside the notebook or in a gap (a removed source) are dropped, a block left with neither
 *    pages nor a reason goes, and only an overview with no section left at all is refused;
 *  - `overviewDrafts`, the C6 block shape, and `overviewDoc`, which mints the nodes and maps each
 *    recommendation to its section's heading `blockId`.
 *
 * **Scaffolding, not answers** (§3.3) is a prompt rule, and **blanks only where the deck leaves
 * one** (answer B) is a prompt rule with a code check behind it: a `____` in a key idea must sit
 * after words its cited page actually has, or the idea is dropped as an invented blank. The check
 * is a heuristic (a slide's blank has no text of its own to match), so the prompt carries the rule
 * in full and the check only catches the obvious case, a blank after words no cited slide says.
 */
import { createHash } from 'node:crypto';
import type { Node } from 'prosemirror-model';
import type {
  DocBlockDraft,
  GeneratedBlockKind,
  OverviewMeta,
  OverviewRecommendation,
} from '../../shared/doc/types.js';
import { NOTE_SLOT_REASON, OBJECTIVES_REASON } from '../../shared/doc/types.js';
import { notesSchema } from '../../shared/doc/schema.js';
import { draftToNodes } from '../../shared/doc/ops.js';
import { draftWords } from './prompts.js';

/** `OverviewMeta.version`: bumped when the overview's shape changes, so the renderer can tell. */
export const OVERVIEW_META_VERSION = 1;

// ── the budget (§3.2) ─────────────────────────────────────────────────────────────────────────

/** "A floor of about 200". A two-page handout still gets a usable map. */
export const OVERVIEW_BUDGET_FLOOR = 200;
/** "A ceiling of about 600". Past that it is notes again, which is what §0 retired. */
export const OVERVIEW_BUDGET_CEILING = 600;
/**
 * **Scaling gently**: the budget grows with the square root of the sources' words. Calibrated on
 * the brief's own deck, Lecture-complex v4.0 (58 pages), which should get about 350. It was first
 * set from an estimate of 8,800 words of slide text (3.75 x sqrt(8,800) = 352); the live run of
 * 1 Oct 2026 measured the deck's text layer at **4,604 words**, which gave 250, not 350. So
 * 5.2 x sqrt(4,600) = 353. A 1,500-word handout lands on the floor; the ceiling is reached at
 * about 13,300 words, three long decks.
 */
export const OVERVIEW_BUDGET_PER_SQRT_WORD = 5.2;

/** The overview's word ceiling for sources of this many words, rounded to ten. Pure. */
export function overviewWordBudget(sourceWords: number): number {
  const raw = OVERVIEW_BUDGET_PER_SQRT_WORD * Math.sqrt(Math.max(0, sourceWords));
  const rounded = Math.round(raw / 10) * 10;
  return Math.min(OVERVIEW_BUDGET_CEILING, Math.max(OVERVIEW_BUDGET_FLOOR, rounded));
}

/** Per-part word ceilings the prompt states, so a budget the model is given is one it can keep. */
export interface OverviewPartLimits {
  lede: number;
  objective: number;
  heading: number;
  takeaway: number;
  idea: number;
}

/**
 * **The budget, split into limits a writer can keep.** A whole-overview number alone did not hold:
 * told "at most 250 words", Sonnet wrote 788 on Lecture-complex (1 Oct 2026), every key idea a
 * 30-word explanation. What it can keep is a limit per part. The fixed parts (lede 35, five
 * objective titles of 10, six headings of 6, six takeaways of 12) come to about 190 words; the
 * key ideas share the rest, about 2.3 to a section, never under 10 words each (a phrase) nor over
 * 28 (two short sentences). At the brief's 350 that is 11 words an idea.
 */
export function overviewPartLimits(budget: number, genre: SourceGenre = 'slides'): OverviewPartLimits {
  if (genre === 'prose') {
    /**
     * **A paper's parts** (§3.2, amended 2026-10-02). The fixed parts are a longer lede (50), six
     * objective titles of 10, eight headings of 8 and eight takeaways of 20, about 330 words; the
     * ideas share the rest at about three to a section, never under 15 words (a paper's idea names
     * a method or a result, which a phrase cannot) nor over 40.
     */
    const fixed = 50 + 6 * 10 + 8 * 8 + 8 * 20;
    const idea = Math.max(15, Math.min(40, Math.floor((budget - fixed) / (8 * 3))));
    return { lede: 50, objective: 10, heading: 8, takeaway: 20, idea };
  }
  const fixed = 35 + 5 * 10 + 6 * 6 + 6 * 12;
  const idea = Math.max(10, Math.min(28, Math.floor((budget - fixed) / (6 * 2.3))));
  return { lede: 35, objective: 10, heading: 6, takeaway: 12, idea };
}

/** A `[p. N]` page line of `NotebookHost.deckText`, with whatever follows it on the same line. */
const PAGE_LINE = /^\s*\[p\.\s*(\d+)\]\s?(.*)$/;
/** A `=== SOURCE: <name> ===` line. */
const SOURCE_LINE = /^\s*===\s*SOURCE:.*===\s*$/;

/** Words of the sources themselves: the page and source marker lines are not the sources' words. */
export function sourceWordsOf(deckText: string): number {
  let n = 0;
  for (const line of deckText.split('\n')) {
    if (SOURCE_LINE.test(line)) continue;
    const page = PAGE_LINE.exec(line);
    const body = page ? page[2]! : line;
    n += body.split(/\s+/).filter((w) => w.length > 0).length;
  }
  return n;
}

/** Each notebook page's own text, from the deck text the call was given. For the blank check. */
export function pageTextsOf(deckText: string): Map<number, string> {
  const out = new Map<number, string>();
  let page: number | null = null;
  for (const line of deckText.split('\n')) {
    if (SOURCE_LINE.test(line)) {
      page = null;
      continue;
    }
    const marker = PAGE_LINE.exec(line);
    if (marker) {
      page = Number(marker[1]);
      out.set(page, `${out.get(page) ?? ''}${marker[2] ?? ''}\n`);
      continue;
    }
    if (page !== null) out.set(page, `${out.get(page) ?? ''}${line}\n`);
  }
  return out;
}

// ── the kind of source (§3.2, amended 2026-10-02) ─────────────────────────────────────────────

/**
 * **Slides or prose.** The budget above was calibrated on slide decks, at about 80 words a slide;
 * a research paper is about 750 words a page, and on the first one (arXiv 2409.16490, 15 pages)
 * the overview came out at 406 words, the method and results reduced to phrases. Which one a
 * source is, is read off its own text: words per page of body, references left out.
 */
export type SourceGenre = 'slides' | 'prose';

/** Words per page of body at or above which a source reads as prose: slides ~80, a paper ~750. */
export const PROSE_WORDS_PER_PAGE = 300;

/** A line that is only a references heading ("References", "6 Bibliography", "Works Cited"). */
const REFERENCES_LINE = /^\s*(?:\d+(?:\.\d+)*\.?\s+)?(references|bibliography|works cited)\s*$/i;

export interface SourceProfile {
  genre: SourceGenre;
  /** Words of the sources' bodies: what the budget is computed from. */
  bodyWords: number;
  /** Words after a References heading, left out of the budget. */
  referenceWords: number;
  /** Body words per page with any body text, over the prose sources and slide sources together. */
  wordsPerPage: number;
}

function lineWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * **One pass over the deck text**: each source's words, split into body and references, and its
 * own words per page. A references heading counts only in the second half of its source's pages,
 * so a "References" slide in the middle of a lecture does not swallow the rest of it. The
 * notebook is prose when its prose sources carry at least half of its body words. Pure.
 */
export function sourceProfile(deckText: string): SourceProfile {
  type Line = { page: number | null; text: string };
  const sources: Line[][] = [[]];
  let page: number | null = null;
  for (const raw of deckText.split('\n')) {
    if (SOURCE_LINE.test(raw)) {
      sources.push([]);
      page = null;
      continue;
    }
    const marker = PAGE_LINE.exec(raw);
    if (marker) {
      page = Number(marker[1]);
      sources.at(-1)!.push({ page, text: marker[2] ?? '' });
      continue;
    }
    sources.at(-1)!.push({ page, text: raw });
  }

  let bodyWords = 0;
  let referenceWords = 0;
  let proseWords = 0;
  let pagesWithBody = 0;
  for (const lines of sources) {
    const pages = lines.map((l) => l.page).filter((p): p is number => p !== null);
    if (lines.length === 0) continue;
    const first = pages.length > 0 ? Math.min(...pages) : 0;
    const last = pages.length > 0 ? Math.max(...pages) : 0;
    let refsAt = -1;
    lines.forEach((line, i) => {
      if (REFERENCES_LINE.test(line.text) && (line.page ?? first) >= first + (last - first) / 2) refsAt = i;
    });
    let body = 0;
    const bodyPages = new Set<number>();
    lines.forEach((line, i) => {
      const n = lineWords(line.text);
      if (refsAt >= 0 && i >= refsAt) {
        referenceWords += n;
        return;
      }
      body += n;
      if (n > 0 && line.page !== null) bodyPages.add(line.page);
    });
    bodyWords += body;
    pagesWithBody += bodyPages.size;
    if (bodyPages.size > 0 && body / bodyPages.size >= PROSE_WORDS_PER_PAGE) proseWords += body;
  }
  const genre: SourceGenre = bodyWords > 0 && proseWords * 2 >= bodyWords ? 'prose' : 'slides';
  return { genre, bodyWords, referenceWords, wordsPerPage: pagesWithBody > 0 ? Math.round(bodyWords / pagesWithBody) : 0 };
}

/** A paper's budget: about a tenth of its body's words, between these, rounded to ten. */
export const OVERVIEW_PROSE_BUDGET_PER_WORD = 0.1;
export const OVERVIEW_PROSE_BUDGET_FLOOR = 400;
export const OVERVIEW_PROSE_BUDGET_CEILING = 1_200;

export function proseWordBudget(bodyWords: number): number {
  const rounded = Math.round((OVERVIEW_PROSE_BUDGET_PER_WORD * Math.max(0, bodyWords)) / 10) * 10;
  return Math.min(OVERVIEW_PROSE_BUDGET_CEILING, Math.max(OVERVIEW_PROSE_BUDGET_FLOOR, rounded));
}

export interface OverviewPolicy extends SourceProfile {
  budget: number;
  maxSections: number;
  maxIdeas: number;
}

/** **Everything the overview's size follows from**, read off the deck text the call is given. Pure. */
export function overviewPolicy(deckText: string): OverviewPolicy {
  const profile = sourceProfile(deckText);
  if (profile.genre === 'prose') {
    return {
      ...profile,
      budget: proseWordBudget(profile.bodyWords),
      maxSections: OVERVIEW_PROSE_MAX_SECTIONS,
      maxIdeas: OVERVIEW_PROSE_MAX_IDEAS,
    };
  }
  return { ...profile, budget: overviewWordBudget(profile.bodyWords), maxSections: OVERVIEW_MAX_SECTIONS, maxIdeas: OVERVIEW_MAX_IDEAS };
}

// ── the counts (§3.1) ─────────────────────────────────────────────────────────────────────────

export const OVERVIEW_MIN_OBJECTIVES = 4;
export const OVERVIEW_MAX_OBJECTIVES = 6;
export const OVERVIEW_MIN_SECTIONS = 5;
export const OVERVIEW_MAX_SECTIONS = 8;
/** The brief asks for a recommendation on two to four sections; four is kept in code. */
export const OVERVIEW_MAX_RECOMMENDATIONS = 4;

/**
 * **How many sections the budget can carry.** The per-part limits (`overviewPartLimits`) fix a
 * section at about 6 + 12 words of heading and takeaway plus two ideas of 10 to 28 words, so a
 * section costs 38 to 74 words. Add the lede (35) and four objective titles (40) and 200 words
 * holds three sections, not six (a 10-page notes PDF came out at 255 words against 200 with five
 * to eight asked for). So: a budget up to 250 gets three to five; up to 400 gets four to seven;
 * beyond, the brief's five to eight. The ceiling of 8 never moves.
 */
export function overviewSectionRange(budget: number, genre: SourceGenre = 'slides'): { min: number; max: number } {
  if (genre === 'prose') return { min: OVERVIEW_MIN_SECTIONS, max: OVERVIEW_PROSE_MAX_SECTIONS };
  if (budget <= 250) return { min: 3, max: 5 };
  if (budget <= 400) return { min: 4, max: 7 };
  return { min: OVERVIEW_MIN_SECTIONS, max: OVERVIEW_MAX_SECTIONS };
}
export const OVERVIEW_MIN_IDEAS = 2;
export const OVERVIEW_MAX_IDEAS = 3;
/** A paper's sections and ideas (§3.2, amended 2026-10-02): its own sections, up to four ideas each. */
export const OVERVIEW_PROSE_MAX_SECTIONS = 10;
export const OVERVIEW_PROSE_MAX_IDEAS = 4;
export const OVERVIEW_MAX_CRITERIA = 4;
export const OVERVIEW_MAX_QUIZ_SEEDS = 3;
/** Answer D: exactly three, under Ellie's greeting. */
export const OVERVIEW_STARTERS = 3;
export const OVERVIEW_OBJECTIVE_TITLE_WORDS = 12;
export const RECOMMENDATION_TITLE_WORDS = 8;
/** §5.3, answer E. No mind map, and nothing that is an image. */
export const RECOMMENDATION_KINDS: readonly GeneratedBlockKind[] = ['table', 'diagram', 'flashcards', 'quiz', 'infographic'];

/** The blank the deck itself leaves, as the overview writes it (answer B). */
export const BLANK = '____';

/** Provenance reasons the overview's own structural blocks carry (contract C6). */
export { OBJECTIVES_REASON };
export const TITLE_REASON = 'title';
/** A lede whose pages were all invalid still summarises the sources; it says so. */
export const LEDE_REASON = 'summarises the sources';
export const EARLIER_NOTES_HEADING = 'Earlier notes';
export const EARLIER_NOTES_REASON = 'carried over from before the overview was updated';
export const BY_THE_END_HEADING = 'By the end you can';
export const WHAT_COMES_NEXT_HEADING = 'What comes next';

// ── the prompt (§3.3–§3.5) ────────────────────────────────────────────────────────────────────

export const OVERVIEW_SYSTEM = [
  'You are writing a short LEARNING OVERVIEW of a student\'s notebook: the sources they added',
  '(lecture slides, notes, readings), laid end to end. It is the first thing they open. It is not',
  'the notes. The student builds the notes themselves by working through your overview: every line',
  'you write has Explain, Example, Quiz me and Ask buttons beside it, and those are where the',
  'detail goes. Your job is the map, not the territory.',
  '',
  'WHAT IT IS FOR. A student reads it in a few minutes and knows what these sources teach, in what',
  'order, and where on the slides each idea is. Then they choose where to start.',
  '',
  'SCAFFOLDING, NOT ANSWERS. Say what each idea IS and WHERE it is, in plain words. Do not derive',
  'anything, do not work an example, do not walk through a method step by step, and do not solve',
  'an exercise the slides set. Derivations, examples and worked cases are what the student\'s',
  'Explain and Example buttons are for; writing them here takes that work away from the student.',
  '',
  'BLANKS ONLY WHERE THE DECK LEAVES ONE. Some slides leave a blank for the student to fill in',
  '(a line that ends "Max(Cost) =" with nothing after it, a "h_FF : ?"). Where a key idea is about',
  'such a slide, you may reproduce the slide\'s own words VERBATIM with the blank written as ____',
  '(four underscores), and cite that page. NEVER invent a blank: if the slide does not itself leave',
  'it empty, write no ____. A blank the slide does not have is checked for and thrown away.',
  '',
  'THE SHAPE, all of it required unless marked optional:',
  '',
  '- `title`: the sources\' own topic, as the lecturer would name it. Not the file name.',
  '- `lede`: two or three sentences, the whole notebook in brief, with the `pages` it draws on.',
  '- `objectives`: four to six things the student will be able to do, in the order they should',
  '  learn them. Each has a `title` (at most twelve words, a skill or a claim: "Explain why h_max',
  '  is admissible", not "Heuristics"), a one-sentence `statement`, two to four checkable',
  '  `criteria`, up to three `quizSeeds` (questions a tester would actually ask, never yes/no,',
  '  never containing their own answer) and the `pages` that teach it.',
  '- `sections`: as many as the user message says (never more than eight), IN THE SOURCES\' ORDER, ONE PER IDEA, NOT ONE PER SLIDE. Each has a',
  '  `heading` (the lecturer\'s own words where the deck gives them), its `pages`, a one-line',
  '  `takeaway` (the sentence to leave with), and two or three `ideas`, each one short sentence or',
  '  two with its own `pages`. Optionally one `recommendation`: a block the student could add',
  '  under that section, of `kind` table (a comparison the slides make), diagram (a process, a',
  '  hierarchy or a cycle), flashcards (terms and definitions worth recalling), quiz (a few',
  '  questions that check the section) or infographic (a structured visual summary: steps, stat',
  '  callouts, a comparison, rendered from text). A `title` of at most eight words and a one-line',
  '  `description` of what it would hold. Recommend for two to four of the sections, the ones that',
  '  genuinely have that shape (a comparison the slides draw, a process with steps, terms worth',
  '  recalling); the rest carry null. Never a mind map, never an image.',
  '- `next`: optional, only when the sources end on what comes next (the next lecture, an',
  '  assignment, open questions). A short section of the same shape. Otherwise null.',
  '- `greeting`: one line in Ellie\'s voice: a peer who has read the same sources and is about to',
  '  work through them with the student. Warm and plain, not a teacher, no exclamation marks, no',
  '  "Welcome to".',
  '- `starterQuestions`: exactly three questions a student might ask first, each answerable from',
  '  the sources, each about a different section, each under fifteen words. They are shown as',
  '  plain buttons: no markup and no $tex$ in them, symbols written as text (h_max, not $h_{max}$).',
  '',
  'PAGES ARE MANDATORY AND REAL. Every page number is a [p. N] number from the text you are given:',
  'those are the notebook\'s page numbers, already counted across all the sources. Never a page you',
  'were not shown, never one inferred from the content. A key idea with no valid page is thrown',
  'away. Cite the page that says it; usually one or two pages, a short range at most.',
  '',
  'LENGTH IS A CEILING, NOT A TARGET. You are given a word budget for everything you write in the',
  'title, lede, objectives\' titles, headings, takeaways and ideas together, and a word limit for',
  'each part. Keep to both: an overview that runs over is cut in code, last ideas first. A key idea',
  'is a phrase-length sentence that names the idea and where it is, not an explanation of it.',
  'Sources with less to say get less. Never pad. Cut "it is important to note", "this section',
  'covers", "in this lecture".',
  'Never narrate the deck ("this slide shows"). No exam framing ("you will be tested on").',
  '',
  'NOTHING THE SOURCES DO NOT SAY. You may name, connect and phrase; you may not add a fact, a',
  'result, a number or a citation that is not in them.',
  '',
  'INLINE MARKUP is exactly three things: **bold**, *italic* and `code`. No $tex$: the overview',
  'shows inline maths as its raw source, so "$h_{FF}$" would read as h_{FF}. Write a symbol the',
  'way a student would type it, or in Unicode: h_FF, h_max, REACH⁺, ⊆, ≤, 10^405.',
  '',
  'Return the JSON object and nothing else: no preamble, no reasoning before it, no commentary',
  'after it.',
].join('\n');

export interface OverviewPromptInput {
  /** The notebook's name, as the learner gave it. */
  notebookName: string;
  /** The ticked, ready sources' names, in the order added. */
  sourceNames: readonly string[];
  /** `NotebookHost.deckText`, or the condensed outlines of each source (§3.5). */
  deckText: string;
  /** True when `deckText` is the condensed outlines rather than the sources' own text. */
  condensed: boolean;
  /** Words of the sources themselves, for the budget line. */
  sourceWords: number;
  budget: number;
  /** Slides unless the sources read as prose (`overviewPolicy`). */
  genre?: SourceGenre;
  /** The notebook pages whose images are attached, when any are. */
  imagePages: readonly number[];
}

/** The user message for the one overview call. */
export function overviewMessage(input: OverviewPromptInput): string {
  const parts: string[] = [`NOTEBOOK: ${input.notebookName}`];
  parts.push(
    input.sourceNames.length > 1
      ? `SOURCES (${input.sourceNames.length}, in the order added):\n${input.sourceNames.map((n) => `  - ${n}`).join('\n')}`
      : `SOURCE: ${input.sourceNames[0] ?? input.notebookName}`,
  );
  if (input.imagePages.length > 0) {
    parts.push(
      [
        `YOU ALSO HAVE THE PAGE IMAGES of pages ${input.imagePages.join(', ')}: the pages with a`,
        'diagram, a table or a figure on them. Use them to see what the text cannot show (what a',
        'diagram connects, which cells a table compares, whether a slide leaves a blank). The text',
        'below is still the authority on wording.',
      ].join('\n'),
    );
  }
  parts.push(
    [
      input.condensed
        ? 'THE SOURCES, CONDENSED. They were too long to send whole, so each was first outlined on its own. The [p. N] markers are still the notebook\'s real page numbers; cite them.'
        : 'THE SOURCES. Each page starts with its [p. N] line: N is the notebook page to cite. Each source starts with its === SOURCE === line.',
      '',
      input.deckText,
    ].join('\n'),
  );
  const genre = input.genre ?? 'slides';
  const limits = overviewPartLimits(input.budget, genre);
  const range = overviewSectionRange(input.budget, genre);
  if (genre === 'prose') {
    /**
     * **A paper is not a deck** (§3.2, amended 2026-10-02). The system prompt is written for
     * slides; this is the part of the user message that says what changes for prose, and it is the
     * last thing the model reads before it writes.
     */
    parts.push(
      [
        'THESE SOURCES ARE PROSE: a paper or a reading, not slides. Where the instructions say "slides",',
        'read "the paper\'s pages", and in what you write say "the paper", never "the slides".',
        'A paper\'s substance is its problem, its method, its data and its results, so the map has to',
        'show them: name the method\'s components and steps, the datasets, the baselines, the headline',
        'results with their numbers, and the limitations, each with its page. That is still the map: say',
        'what each is and where; do not derive, re-explain or work an example. Sections follow the',
        'paper\'s own sections. Leave the references out.',
      ].join('\n'),
    );
  }
  parts.push(
    `Write the overview now. The sources say about ${input.sourceWords} words;` +
      ` **everything you write is at most ${input.budget} words**, and fewer when they teach less.` +
      ` Four to six objectives, ${range.min} to ${range.max} sections in the sources' order,` +
      (genre === 'prose' ? ' two to four cited ideas each,' : ' two or three cited ideas each,') +
      ' exactly three starter questions.' +
      (genre === 'prose' ? '' : ' Blanks (____) only where a slide itself leaves one.') +
      `\n\nWORD LIMITS, each a ceiling: lede ${limits.lede} words; each objective title ${limits.objective};` +
      ` each heading ${limits.heading}; each takeaway ${limits.takeaway}; each key idea ${limits.idea}.` +
      (genre === 'prose'
        ? ' Three ideas per section is usual; a fourth only where the section has a fourth result or step.'
        : ' Two ideas per section unless the section really needs a third.'),
  );
  return parts.join('\n\n');
}

/** The system prompt of a condensing call (§3.5): one source, outlined on its own. */
export const CONDENSE_SYSTEM = [
  'You are outlining ONE source of a student\'s notebook so that a later step can write a short',
  'overview across several sources. Keep every idea the source teaches, in its order, as terse',
  'lines. Keep the lecturer\'s own headings. Every line starts with the [p. N] marker of the page it',
  'came from, copied exactly from the input: those are the notebook\'s page numbers and they must',
  'survive. Where a slide leaves a blank for the student (a line ending "=" with nothing after it,',
  'a "?"), keep that line verbatim. Drop title, agenda, recap and admin pages. No commentary. Plain',
  'text, no JSON.',
].join('\n');

export function condenseMessage(input: { sourceName: string; text: string; words: number }): string {
  return [
    `SOURCE: ${input.sourceName}`,
    '',
    input.text,
    '',
    `Outline this source in at most ${input.words} words, every line starting with its [p. N] marker.`,
  ].join('\n');
}

/** How many words a condensed source may take: enough to keep its ideas, a tenth of its length. */
export function condenseWords(sourceWords: number): number {
  return Math.max(300, Math.min(2_500, Math.round(sourceWords / 10 / 50) * 50));
}

const PAGES_SCHEMA = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  description: 'Notebook pages, from the [p. N] markers. Never a page you were not shown.',
};

/**
 * The one call's JSON schema. Strict enough to say the shape, loose enough that a near-miss comes
 * back as something `validateOverview` can repair: the counts are in the prompt and enforced in
 * code, not here, because a schema that rejects a seventh objective costs the whole overview.
 */
export const OVERVIEW_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'lede', 'objectives', 'sections', 'greeting', 'starterQuestions'],
  properties: {
    title: { type: 'string', description: 'The sources\' own topic.' },
    lede: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'pages'],
      properties: { text: { type: 'string', description: 'Two or three sentences.' }, pages: PAGES_SCHEMA },
    },
    objectives: {
      type: 'array',
      description: 'Four to six, in learning order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'statement', 'criteria', 'quizSeeds', 'pages'],
        properties: {
          title: { type: 'string', description: 'At most twelve words: a skill or a claim.' },
          statement: { type: 'string' },
          criteria: { type: 'array', items: { type: 'string' }, description: 'Two to four, checkable.' },
          quizSeeds: { type: 'array', items: { type: 'string' }, description: 'Up to three question stems.' },
          pages: PAGES_SCHEMA,
        },
      },
    },
    sections: {
      type: 'array',
      description: 'Five to eight, in the sources\' order, one per idea.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'pages', 'takeaway', 'ideas'],
        properties: {
          heading: { type: 'string' },
          pages: PAGES_SCHEMA,
          takeaway: { type: 'string', description: 'One line.' },
          ideas: {
            type: 'array',
            description: 'Two or three.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'pages'],
              properties: { text: { type: 'string' }, pages: PAGES_SCHEMA },
            },
          },
          recommendation: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['kind', 'title', 'description'],
            properties: {
              kind: { type: 'string', enum: [...RECOMMENDATION_KINDS] },
              title: { type: 'string', description: 'At most eight words.' },
              description: { type: 'string', description: 'One line: what it would hold.' },
            },
          },
        },
      },
    },
    next: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['heading', 'pages', 'takeaway', 'ideas'],
      properties: {
        heading: { type: 'string' },
        pages: PAGES_SCHEMA,
        takeaway: { type: 'string' },
        ideas: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'pages'],
            properties: { text: { type: 'string' }, pages: PAGES_SCHEMA },
          },
        },
      },
    },
    greeting: { type: 'string', description: 'One line, Ellie, a peer.' },
    starterQuestions: { type: 'array', items: { type: 'string' }, description: 'Exactly three.' },
  },
};

// ── the gate ──────────────────────────────────────────────────────────────────────────────────

export interface OverviewIdea {
  text: string;
  pages: number[];
}

export interface OverviewRecommendationDraft {
  kind: GeneratedBlockKind;
  title: string;
  description: string;
}

export interface OverviewSection {
  heading: string;
  /** Never empty: a section with no valid page anywhere is dropped. */
  pages: number[];
  takeaway: string;
  ideas: OverviewIdea[];
  recommendation: OverviewRecommendationDraft | null;
  /** The optional last "what comes next" section. Never carries a recommendation. */
  next: boolean;
}

export interface OverviewObjective {
  title: string;
  statement: string;
  criteria: string[];
  quizSeeds: string[];
  pages: number[];
}

export interface ValidOverview {
  title: string;
  lede: { text: string; pages: number[] };
  objectives: OverviewObjective[];
  sections: OverviewSection[];
  greeting: string;
  starterQuestions: string[];
}

/** Every repair, counted, for the `notes.overview` log line. */
export interface OverviewRepairs {
  pagesDropped: number;
  ideasDropped: number;
  inventedBlanks: number;
  sectionsDropped: number;
  sectionsOverCap: number;
  objectivesDropped: number;
  objectivesOverCap: number;
  recommendationsDropped: number;
  startersFilled: number;
  startersCut: number;
  greetingFilled: boolean;
  titleFilled: boolean;
}

export interface ValidateOverviewContext {
  /** The notebook's virtual page count. */
  pageCount: number;
  /** False for a page in a gap (a removed source): `NotebookHost.locate` is null for it. */
  pageExists(page: number): boolean;
  /** Each page's own text, for the blank check. Absent ⟹ the check is skipped. */
  pageTexts?: ReadonlyMap<number, string>;
  /** The title when the model gave none: the notebook's name. */
  fallbackTitle: string;
  /** `OverviewPolicy.maxSections` and `.maxIdeas`; the slide caps when absent. */
  maxSections?: number;
  maxIdeas?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Trimmed, whitespace folded. Never markup-stripped: the inline subset is the doc's. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\s\u00a0]+/g, ' ').trim() : '';
}

function capWords(value: string, max: number): string {
  const words = value.split(' ').filter((w) => w.length > 0);
  return words.length <= max ? value : words.slice(0, max).join(' ');
}

/**
 * The greeting and the starter questions are drawn as plain text (a button, Ellie's first line),
 * where `$h_{max}$` reads as exactly that (live run, 1 Oct 2026). The prompt asks for none; this
 * takes off what still comes: maths delimiters (`$h_{max}$` → `h_max`) and the inline markup.
 */
export function plainLine(value: string): string {
  return value
    .replace(/\$([^$]+)\$/g, (_, tex: string) => tex.replace(/_\{([^{}]*)\}/g, '_$1').replace(/\^\{([^{}]*)\}/g, '^$1').replace(/\\/g, ''))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Three or more underscores are the blank, written one way (answer B). */
function normaliseBlanks(value: string): string {
  return value.replace(/_{3,}/g, BLANK);
}

/** Lower-case letters, digits and the few symbols a slide's blank sits after; everything else a space. */
function matchable(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[*`$]/g, '')
    .replace(/[^\p{L}\p{N}=:?()+\-<>]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A line of a slide that leaves something for the student: it ends on "=", "?" or a run of underscores. */
const BLANK_LINE = /(=|\?|_{2,})\s*$/m;

/**
 * **Is this blank the deck's own?** Two things must hold. A page the idea cites must itself leave
 * a blank somewhere (a line ending "=", "?" or "__"): a slide that prints everything in full has
 * no blank to carry. And the **two** words before each `____` must appear, in order, in the text
 * of a cited page: a slide that leaves "Max(Cost) = " blank has "Max(Cost) =" in its text.
 *
 * Two, not four: the live run of 1 Oct 2026 (Lecture-complex p. 24) had the model write the
 * slide's own blank inside its own sentence ("…the blocks example, Max(Cost) = ____"), and four
 * words reached back past the slide's words into the model's, so the deck's one real blank was
 * thrown away as invented. The page-must-leave-a-blank test is what keeps the shorter window
 * from passing an invented blank after two common words. Still a heuristic: the prompt carries
 * the rule in full.
 */
export function blankIsTheDecks(idea: OverviewIdea, pageTexts: ReadonlyMap<number, string>): boolean {
  const pieces = idea.text.split(BLANK);
  if (pieces.length < 2) return true;
  const raw = idea.pages.map((p) => pageTexts.get(p) ?? '').join('\n');
  if (!BLANK_LINE.test(raw)) return false;
  const cited = idea.pages.map((p) => matchable(pageTexts.get(p) ?? '')).join(' \n ');
  if (cited.trim().length === 0) return false;
  for (let i = 0; i < pieces.length - 1; i += 1) {
    const before = matchable(pieces[i]!).split(' ').filter((w) => w.length > 0).slice(-2).join(' ');
    // A blank with nothing before it ("____ is the cost of…") cannot be matched; the page leaving
    // a blank, checked above, is all there is to go on.
    if (before.length === 0) continue;
    if (!cited.includes(before)) return false;
  }
  return true;
}

/**
 * The model's overview, checked against the notebook the learner has. Returns null only when no
 * section survives, which is the one case with nothing to show.
 */
export function validateOverview(
  raw: unknown,
  ctx: ValidateOverviewContext,
): { overview: ValidOverview | null; repairs: OverviewRepairs } {
  const repairs: OverviewRepairs = {
    pagesDropped: 0,
    ideasDropped: 0,
    inventedBlanks: 0,
    sectionsDropped: 0,
    sectionsOverCap: 0,
    objectivesDropped: 0,
    objectivesOverCap: 0,
    recommendationsDropped: 0,
    startersFilled: 0,
    startersCut: 0,
    greetingFilled: false,
    titleFilled: false,
  };
  const root = asRecord(raw) ?? {};

  const pagesOf = (value: unknown): number[] => {
    const out: number[] = [];
    for (const p of Array.isArray(value) ? value : []) {
      const n = typeof p === 'number' ? Math.trunc(p) : Number.NaN;
      if (Number.isInteger(n) && n >= 1 && n <= ctx.pageCount && ctx.pageExists(n)) {
        if (!out.includes(n)) out.push(n);
      } else {
        repairs.pagesDropped += 1;
      }
    }
    return out.sort((a, b) => a - b);
  };

  const ideasOf = (value: unknown): OverviewIdea[] => {
    const out: OverviewIdea[] = [];
    for (const item of Array.isArray(value) ? value : []) {
      const record = asRecord(item);
      const body = normaliseBlanks(text(record?.text));
      const pages = pagesOf(record?.pages);
      // §3.4: a key idea is cited or it is not in the overview.
      if (body.length === 0 || pages.length === 0) {
        repairs.ideasDropped += 1;
        continue;
      }
      const idea = { text: body, pages };
      if (ctx.pageTexts && !blankIsTheDecks(idea, ctx.pageTexts)) {
        repairs.inventedBlanks += 1;
        repairs.ideasDropped += 1;
        continue;
      }
      if (out.length === (ctx.maxIdeas ?? OVERVIEW_MAX_IDEAS)) {
        repairs.ideasDropped += 1;
        continue;
      }
      out.push(idea);
    }
    return out;
  };

  /** A takeaway or a lede may not carry a blank: blanks are a key idea's, with its page. */
  const noBlank = (value: string): string => {
    if (!value.includes(BLANK)) return value;
    repairs.inventedBlanks += 1;
    return value.replace(new RegExp(`\\s*${BLANK}\\s*`, 'g'), ' … ').replace(/\s+/g, ' ').trim();
  };

  const sectionOf = (value: unknown, next: boolean): OverviewSection | null => {
    const record = asRecord(value);
    if (!record) return null;
    const heading = text(record.heading) || (next ? WHAT_COMES_NEXT_HEADING : '');
    const ideas = ideasOf(record.ideas);
    const own = pagesOf(record.pages);
    const pages = [...new Set([...own, ...ideas.flatMap((i) => i.pages)])].sort((a, b) => a - b);
    const takeaway = noBlank(normaliseBlanks(text(record.takeaway)));
    if (heading.length === 0 || pages.length === 0 || (ideas.length === 0 && takeaway.length === 0)) return null;
    let recommendation: OverviewRecommendationDraft | null = null;
    const rec = asRecord(record.recommendation);
    if (rec && !next) {
      const kind = text(rec.kind) as GeneratedBlockKind;
      const title = capWords(text(rec.title), RECOMMENDATION_TITLE_WORDS);
      const description = text(rec.description).split(/(?<=[.!?])\s/)[0] ?? '';
      if (RECOMMENDATION_KINDS.includes(kind) && title.length > 0 && description.length > 0) {
        recommendation = { kind, title, description };
      } else {
        repairs.recommendationsDropped += 1;
      }
    } else if (rec && next) {
      repairs.recommendationsDropped += 1;
    }
    return { heading, pages, takeaway, ideas, recommendation, next };
  };

  // ── sections, then the optional last one ──
  const sections: OverviewSection[] = [];
  for (const value of Array.isArray(root.sections) ? root.sections : []) {
    const section = sectionOf(value, false);
    if (!section) {
      repairs.sectionsDropped += 1;
      continue;
    }
    if (sections.length === (ctx.maxSections ?? OVERVIEW_MAX_SECTIONS)) {
      repairs.sectionsOverCap += 1;
      continue;
    }
    sections.push(section);
  }
  const next = root.next ? sectionOf(root.next, true) : null;
  if (root.next && !next) repairs.sectionsDropped += 1;

  // The brief's "two to four": a model that recommends on five or six is cut to four in code,
  // keeping a spread of kinds first (no kind twice while another is on offer), then section order.
  const withRec = sections.flatMap((section, i) => (section.recommendation ? [i] : []));
  if (withRec.length > OVERVIEW_MAX_RECOMMENDATIONS) {
    const kept = new Set<number>();
    const kinds = new Set<GeneratedBlockKind>();
    for (const i of withRec) {
      if (kept.size === OVERVIEW_MAX_RECOMMENDATIONS) break;
      const kind = sections[i]!.recommendation!.kind;
      if (kinds.has(kind)) continue;
      kinds.add(kind);
      kept.add(i);
    }
    for (const i of withRec) {
      if (kept.size === OVERVIEW_MAX_RECOMMENDATIONS) break;
      kept.add(i);
    }
    for (const i of withRec) {
      if (kept.has(i)) continue;
      sections[i] = { ...sections[i]!, recommendation: null };
      repairs.recommendationsDropped += 1;
    }
  }

  // ── objectives ──
  const objectives: OverviewObjective[] = [];
  const seenTitles = new Set<string>();
  for (const value of Array.isArray(root.objectives) ? root.objectives : []) {
    const record = asRecord(value);
    const title = capWords(text(record?.title), OVERVIEW_OBJECTIVE_TITLE_WORDS);
    const pages = pagesOf(record?.pages);
    const key = title.toLowerCase();
    // An objective with no page is one the progress bar could never map to a block.
    if (!record || title.length === 0 || pages.length === 0 || seenTitles.has(key)) {
      repairs.objectivesDropped += 1;
      continue;
    }
    if (objectives.length === OVERVIEW_MAX_OBJECTIVES) {
      repairs.objectivesOverCap += 1;
      continue;
    }
    seenTitles.add(key);
    const list = (v: unknown, cap: number): string[] =>
      [...new Set((Array.isArray(v) ? v : []).map(text).filter((s) => s.length > 0))].slice(0, cap);
    objectives.push({
      title,
      statement: text(record.statement) || title,
      criteria: list(record.criteria, OVERVIEW_MAX_CRITERIA),
      quizSeeds: list(record.quizSeeds, OVERVIEW_MAX_QUIZ_SEEDS),
      pages,
    });
  }

  if (sections.length === 0) return { overview: null, repairs };

  // ── the lede ──
  const lede = asRecord(root.lede);
  const ledeText = noBlank(normaliseBlanks(text(lede?.text ?? root.lede)));
  const ledePages = pagesOf(lede?.pages);

  // ── the chat's half (§6): a greeting and exactly three starters ──
  let greeting = plainLine(text(typeof root.greeting === 'string' ? root.greeting.trim().split('\n')[0] : ''));
  if (greeting.length === 0) {
    greeting = 'I have read these sources too. Where do you want to start?';
    repairs.greetingFilled = true;
  }
  const starters = [
    ...new Set(
      (Array.isArray(root.starterQuestions) ? root.starterQuestions : [])
        .map((q) => plainLine(text(q)))
        .filter((s) => s.length > 0),
    ),
  ];
  if (starters.length > OVERVIEW_STARTERS) repairs.startersCut = starters.length - OVERVIEW_STARTERS;
  const starterQuestions = starters.slice(0, OVERVIEW_STARTERS);
  // Filled from the objectives' own quiz seeds first (questions the sources answer by
  // construction), then from the section headings.
  const fillers = [
    ...objectives.flatMap((o) => o.quizSeeds),
    ...sections.map((s) => `What is the main point of “${s.heading}”?`),
  ];
  for (const filler of fillers) {
    if (starterQuestions.length >= OVERVIEW_STARTERS) break;
    if (starterQuestions.includes(filler)) continue;
    starterQuestions.push(filler);
    repairs.startersFilled += 1;
  }

  let title = text(root.title);
  if (title.length === 0) {
    title = ctx.fallbackTitle.trim() || 'Overview';
    repairs.titleFilled = true;
  }

  return {
    overview: {
      title,
      lede: { text: ledeText, pages: ledePages },
      objectives,
      sections: next ? [...sections, next] : sections,
      greeting,
      starterQuestions,
    },
    repairs,
  };
}

// ── the C6 shape ──────────────────────────────────────────────────────────────────────────────

/** Where each section's heading sits in the drafts, so its `blockId` can be read after minting. */
export interface OverviewDraftPlan {
  drafts: DocBlockDraft[];
  /** `drafts` index of each section's H2, in `overview.sections` order. */
  sectionHeadings: number[];
  /** `drafts` index of each section's your-note slot. */
  noteSlots: number[];
}

/**
 * **Contract C6**, block by block:
 *
 * title H1 (`reason: 'title'`) · lede paragraph (its pages) · H3 "By the end you can"
 * (`reason: 'objectives'`) · the objectives as one numbered list (`reason: 'objectives'`, pages
 * the union) whose items are `objectiveTitles` **in tree order** · then per section: H2 (the
 * section's pages) · the takeaway paragraph · each key idea as its **own one-item bullet list**
 * (so each has its own pages, chip and toolbar) · the empty your-note slot
 * (`reason: NOTE_SLOT_REASON`, the section's pages).
 *
 * `objectiveTitles` is passed in rather than read from the overview because the list must be the
 * stored tree's, after `repairTree` has had its say.
 */
export function overviewDrafts(overview: ValidOverview, objectiveTitles: readonly string[]): OverviewDraftPlan {
  const drafts: DocBlockDraft[] = [];
  const sectionHeadings: number[] = [];
  const noteSlots: number[] = [];

  drafts.push({ kind: 'heading', level: 1, text: overview.title, prov: { pages: [], reason: TITLE_REASON } });
  if (overview.lede.text.length > 0) {
    drafts.push({
      kind: 'paragraph',
      text: overview.lede.text,
      prov: overview.lede.pages.length > 0 ? { pages: [...overview.lede.pages], reason: null } : { pages: [], reason: LEDE_REASON },
    });
  }
  if (objectiveTitles.length > 0) {
    const union = [...new Set(overview.objectives.flatMap((o) => o.pages))].sort((a, b) => a - b);
    drafts.push({ kind: 'heading', level: 3, text: BY_THE_END_HEADING, prov: { pages: [], reason: OBJECTIVES_REASON } });
    drafts.push({ kind: 'numbers', items: [...objectiveTitles], prov: { pages: union, reason: OBJECTIVES_REASON } });
  }
  for (const section of overview.sections) {
    sectionHeadings.push(drafts.length);
    drafts.push({ kind: 'heading', level: 2, text: section.heading, prov: { pages: [...section.pages], reason: null } });
    if (section.takeaway.length > 0) {
      drafts.push({ kind: 'paragraph', text: section.takeaway, prov: { pages: [...section.pages], reason: null } });
    }
    for (const idea of section.ideas) {
      drafts.push({ kind: 'bullets', items: [idea.text], prov: { pages: [...idea.pages], reason: null } });
    }
    noteSlots.push(drafts.length);
    drafts.push({ kind: 'paragraph', text: '', prov: { pages: [...section.pages], reason: NOTE_SLOT_REASON } });
  }
  return { drafts, sectionHeadings, noteSlots };
}

/** Words the overview writes, title excluded: the number logged against the budget. */
export function overviewWords(drafts: readonly DocBlockDraft[]): number {
  return draftWords(drafts.filter((d) => !(d.kind === 'heading' && d.prov.reason === TITLE_REASON)));
}

/** How far over the budget an overview may land before its third ideas are cut: a ceiling, loosely. */
export const OVERVIEW_BUDGET_SLACK = 1.1;

/**
 * **The ceiling, kept in code** (§3.2: "It is a ceiling"). When the model runs over the budget
 * by more than the slack, the third key idea of a section goes, last section first, until the
 * overview fits or every section is down to two (the brief's floor of ideas). Nothing else is cut:
 * a takeaway, a heading or an objective is the overview's frame, and a section's first two ideas
 * are what it is. Pure; returns how many ideas went, for the log line.
 */
export function fitOverview(overview: ValidOverview, budget: number): { overview: ValidOverview; ideasCut: number } {
  const titles = overview.objectives.map((o) => o.title);
  const words = (o: ValidOverview): number => overviewWords(overviewDrafts(o, titles).drafts);
  let current = overview;
  let ideasCut = 0;
  for (let i = current.sections.length - 1; i >= 0 && words(current) > budget * OVERVIEW_BUDGET_SLACK; i -= 1) {
    const section = current.sections[i]!;
    if (section.ideas.length <= OVERVIEW_MIN_IDEAS) continue;
    const sections = [...current.sections];
    sections[i] = { ...section, ideas: section.ideas.slice(0, OVERVIEW_MIN_IDEAS) };
    ideasCut += section.ideas.length - OVERVIEW_MIN_IDEAS;
    current = { ...current, sections };
  }
  return { overview: current, ideasCut };
}

export interface MintedOverview {
  /** Top-level nodes, title first. */
  nodes: Node[];
  /** Each section's heading `blockId`, in section order. */
  headingIds: string[];
  /** Each section's your-note slot `blockId`, in section order. */
  slotIds: string[];
  words: number;
}

/**
 * The drafts, minted one by one, so a section's heading is found by index rather than by
 * searching text. `draftToNodes` accepts an empty paragraph with a reason (it only skips an empty
 * *list*), so the slot is minted the same way as every other block.
 */
export function mintOverview(overview: ValidOverview, objectiveTitles: readonly string[]): MintedOverview {
  const plan = overviewDrafts(overview, objectiveTitles);
  const nodes = plan.drafts.map((draft) => {
    const minted = draftToNodes(notesSchema, [draft], 'ingest', null);
    if (minted.length !== 1) throw new Error(`overview: a ${draft.kind} block did not mint`);
    return minted[0]!;
  });
  const idOf = (i: number): string => (nodes[i]!.attrs as { blockId: string }).blockId;
  return {
    nodes,
    headingIds: plan.sectionHeadings.map(idOf),
    slotIds: plan.noteSlots.map(idOf),
    words: overviewWords(plan.drafts),
  };
}

/** `rec_<12 hex>`, stable for a heading and a kind, so a re-read of the same doc keeps its ids. */
export function recommendationId(headingBlockId: string, kind: GeneratedBlockKind): string {
  return `rec_${createHash('sha1').update(`${headingBlockId}\u0000${kind}`).digest('hex').slice(0, 12)}`;
}

/** The recommendations, each on its section's heading, all `offered`. */
export function recommendationsFor(
  overview: ValidOverview,
  headingIds: readonly string[],
): OverviewRecommendation[] {
  const out: OverviewRecommendation[] = [];
  overview.sections.forEach((section, i) => {
    const headingBlockId = headingIds[i];
    if (!section.recommendation || !headingBlockId) return;
    out.push({
      id: recommendationId(headingBlockId, section.recommendation.kind),
      headingBlockId,
      kind: section.recommendation.kind,
      title: section.recommendation.title,
      description: section.recommendation.description,
      status: 'offered',
    });
  });
  return out;
}

export function overviewMeta(input: {
  overview: ValidOverview;
  headingIds: readonly string[];
  fingerprint: string;
  writtenAt: string;
  words: number;
  wordBudget: number;
  genre?: SourceGenre;
}): OverviewMeta {
  return {
    version: OVERVIEW_META_VERSION,
    fingerprint: input.fingerprint,
    writtenAt: input.writtenAt,
    starterQuestions: [...input.overview.starterQuestions],
    greeting: input.overview.greeting,
    recommendations: recommendationsFor(input.overview, input.headingIds),
    words: input.words,
    wordBudget: input.wordBudget,
    ...(input.genre ? { genre: input.genre } : {}),
  };
}
