/**
 * **Pass 2's prompt: turn a window of slides into lecture notes** (#48, `collab-doc.md` §2).
 *
 * The brief's demand, in one sentence: *cohesive lecture notes that can be read without ever
 * opening the slides*. Everything in here serves that and the four rules under it — provenance
 * on every block, the lecture's own structure as the headings, a figure wherever the layout
 * carries meaning text cannot, and nothing the slides do not support.
 *
 * The prompt is deliberately about **what notes are**, not about the JSON: the shape is enforced
 * by `DRAFT_BLOCK_JSON_SCHEMA` and repaired by `validateDrafts`, so spending the prompt on field
 * descriptions would be spending it twice. What a schema cannot say is "not a bullet
 * transcription", and that is the whole difficulty of this call.
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
export const NOTES_PROMPT_VERSION = 1;

export const NOTES_SYSTEM = [
  'You are writing the lecture notes for one lecture, from the lecturer\'s own slides.',
  '',
  'THE ONE TEST YOUR OUTPUT MUST PASS. A student who never opens the slides must be able to',
  'read your notes and learn the lecture from them. Not a summary of the lecture — the lecture,',
  'written out. A slide that says only "Bellman equation" and a formula becomes a paragraph that',
  'says what the Bellman equation is, what each symbol means, and why the lecturer put it there.',
  '',
  'So:',
  '',
  '- **Write prose, not a bullet transcription.** A slide\'s bullets are the lecturer\'s speaking',
  '  notes; the notes you write are what they said. Turn three fragments into two or three real',
  '  sentences that connect them. Use a bullet list only where the content genuinely is a list —',
  '  a set of named cases, the steps of an algorithm, the properties of a definition — and even',
  '  then introduce it with a sentence first.',
  '- **Follow the lecture\'s own structure.** The headings are the deck\'s sections, in the deck\'s',
  '  order, in the lecturer\'s own words where the deck gives them. Do not invent a structure the',
  '  lecture does not have, and do not put a heading on every slide: several slides that develop',
  '  one idea are one section.',
  '- **Do not compress.** Length lives here. If the window is ten slides of real content, the',
  '  notes for it are long. Covering ten slides in six sentences is a failure, not concision.',
  '- **Do not narrate the deck.** Never write "this slide shows", "the lecturer then explains",',
  '  "as we saw on the previous slide". Write the material itself.',
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
  'is too sparse to write from, say less about it rather than filling it in.',
  '',
  'Return the JSON object and nothing else: no preamble, no reasoning before it, no commentary',
  'after it.',
].join('\n');

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
        'here: do not repeat a section, do not re-introduce the lecture, and keep the same voice',
        'and the same level of detail.',
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

  parts.push(
    `Write the notes for pages ${input.window.from}–${input.window.to} now, as \`blocks\`.` +
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
