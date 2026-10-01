/**
 * **Blocks Ellie generates on request** (`collab-doc.md` §5.7; `notebooks.md` §5.3).
 *
 * Moved out of `docedit.ts` on 2026-10-01 so the generated block types (table, diagram,
 * flashcards, quiz, infographic) can grow in a file of their own while the rules track edits
 * `docedit.ts` beside it (`app/docs/NOTEBOOK-CONTRACT.md`). The code is as it was; only the kind
 * union now comes from `shared/doc/types.ts`.
 */
import type { AgentDocOpBatch, DocBlockDraft, GeneratedBlockKind, OutlineEntry, Provenance } from '../shared/doc/types.js';
import {
  DIAGRAM_DRAFT_JSON_SCHEMA,
  FLASHCARDS_DRAFT_JSON_SCHEMA,
  INFOGRAPHIC_DRAFT_JSON_SCHEMA,
  QUIZ_DRAFT_JSON_SCHEMA,
  TABLE_DRAFT_JSON_SCHEMA,
  validateDiagramDraft,
  validateFlashcardsDraft,
  validateInfographicDraft,
  validateQuizDraft,
  validateTableDraft,
} from '../shared/doc/validate.js';
import { docEditMeta, outlineText, type DocEditDeps } from './docedit.js';
import { extractJson } from './orchestrator.js';
import type { LlmRequest } from './llm/types.js';

// ── §5.7: a table, diagram, deck, quiz or infographic, asked for at a place in the notes ──

/**
 * **What the learner may ask Ellie to draw into the notes** (brief §5.7, 2026-10-01).
 *
 * A `table` compares things along named columns; a `diagram` is nodes with labels and optional
 * arrows, laid out by the renderer (`flow`, `hierarchy`, `compare`, `cycle`). Both are ordinary
 * blocks: real text the learner can edit, provenance on the block and on each row or node, and an
 * agent edit like any other, so Remove · Keep and the guard apply unchanged.
 *
 * **The model is given the section and its slides, and nothing else, and may decline.** A table
 * of a section that compares nothing, or a diagram of a section with one idea in it, is padding
 * with a border round it; `make: false` inserts nothing and says why.
 */
export type { GeneratedBlockKind } from '../shared/doc/types.js';

export interface GenerateBlockInput {
  kind: GeneratedBlockKind;
  /** What it should show, in the learner's words, or null for "whatever fits best". */
  instruction: string | null;
  /** The block the learner was in: the insert point. */
  anchorBlockId: string;
  /** The notes of the section around it, as the outline reads them. */
  section: readonly OutlineEntry[];
  /** The slides that section came from, as text, when they could be resolved. */
  passage?: string | null;
  /** The deck's page count, so a citation outside it is dropped rather than trusted. */
  pageCount?: number;
}

/** How much slide text the call is shown. A section can span several pages. */
export const GENERATE_BLOCK_PASSAGE_CHARS = 6_000;

/**
 * Each kind's reply schema and its validator, in one place. The reply key is the kind's name.
 * A quiz or a deck is a long answer (3 to 12 items, each with prose), so those two get a larger
 * budget than the 2000 that a table or a diagram fits in.
 */
const KIND_SPECS: Record<
  GeneratedBlockKind,
  {
    schema: Record<string, unknown>;
    validate: (raw: unknown, pageCount: number, prov: Provenance) => { draft: DocBlockDraft | null; problems: string[] };
    maxTokens: number;
  }
> = {
  table: { schema: TABLE_DRAFT_JSON_SCHEMA, validate: validateTableDraft, maxTokens: 2000 },
  diagram: { schema: DIAGRAM_DRAFT_JSON_SCHEMA, validate: validateDiagramDraft, maxTokens: 2000 },
  flashcards: { schema: FLASHCARDS_DRAFT_JSON_SCHEMA, validate: validateFlashcardsDraft, maxTokens: 3500 },
  quiz: { schema: QUIZ_DRAFT_JSON_SCHEMA, validate: validateQuizDraft, maxTokens: 4000 },
  infographic: { schema: INFOGRAPHIC_DRAFT_JSON_SCHEMA, validate: validateInfographicDraft, maxTokens: 2500 },
};

function generateReplySchema(kind: GeneratedBlockKind): Record<string, unknown> {
  // Nested, so its own `$schema` key comes off: one dialect declaration, at the root.
  const { $schema: _dialect, ...draft } = KIND_SPECS[kind].schema;
  void _dialect;
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['make', 'why'],
    additionalProperties: false,
    properties: {
      make: {
        type: 'boolean',
        description: `false when this section has nothing worth a ${kind}; then leave "${kind}" out.`,
      },
      why: { type: 'string', description: 'One sentence: what it shows, or why there is nothing to show.' },
      [kind]: draft,
    },
  };
}


/** What each block is, and how to build it from the section. */
const KIND_BRIEFS: Record<GeneratedBlockKind, readonly string[]> = {
  table: [
    '**A comparison table.** Rows are the things being compared and columns are what they are',
    'compared on; the first column names the thing. 2 to 6 columns, at most 12 rows, and every row',
    'has exactly one cell per column. A cell is a few words, not a sentence: a term, a value, a',
    'yes or no, a short phrase. Leave a cell empty ("") when neither the notes nor the slides say;',
    'never fill one from general knowledge. Give each row the slide pages it came from.',
  ],
  diagram: [
    '**A diagram, as nodes and arrows.** Choose the layout that fits what the section says:',
    '`flow` for steps in an order (an edge from each step to the next); `hierarchy` for a thing',
    'and its kinds or parts (each node but the root names its `parent`); `compare` for two to',
    'four alternatives side by side (each node names the `group`, the alternative, it belongs',
    'under); `cycle` for a loop that returns to its start (edges in order, the last back to the',
    'first). 3 to 12 nodes. A label is at most eight words and is the slide’s own term where it',
    'has one. Label an edge only when the relation is not obvious. Give each node the slide pages',
    'it came from. Draw what the section says, not everything true about the topic.',
  ],
  flashcards: [
    '**A deck of flashcards.** 3 to 12 cards, each a front and a back, for what a learner should',
    'be able to recall: a term and its meaning, a question and its answer, a formula and what it',
    'computes. A front is short and has one answer; a back is the answer in a sentence or less,',
    'in the slides’ own words. One idea to a card; no two cards that give each other away. Give',
    'each card the slide pages it came from.',
  ],
  quiz: [
    '**A short quiz.** 3 to 5 questions that check understanding of this section, not recall of',
    'wording. Use `mc` (multiple choice) where there is one clearly right answer: 3 or 4 options,',
    'one right (`answer` is its 1-based number), the others plausible mistakes a learner could make,',
    'all about the same length. Use `short` where the learner should answer in their own words;',
    'give no options. For both, `explanation` is the answer and why, drawn from the slides; it is',
    'held back until the learner has answered, so the prompt must not give it away. Give each',
    'question the slide pages it came from.',
  ],
  infographic: [
    '**An infographic, as data.** It is a titled set of 3 to 8 panels that the app draws; you',
    'write only the words. Choose the layout the section supports: `timeline` for dated or ordered',
    'stops (each panel’s `value` is its date or stage); `steps` for a process (no value); `stats`',
    'for figures worth a callout (each panel’s `value` is the number, with its unit); `compare`',
    'for two to four alternatives side by side (the heading names the alternative, no value). A',
    'heading is a few words; a body is one or two sentences from the slides. Give each panel the',
    'slide pages it came from. Never describe a picture: this is text only.',
  ],
};

const DECLINE_RULES: Record<GeneratedBlockKind, string> = {
  table: 'A section that compares fewer than two things, or on fewer than two properties, has no table in it.',
  diagram: 'A section with a single idea and no order, parts or alternatives has no diagram in it.',
  flashcards: 'A section with fewer than three things worth remembering has no deck in it.',
  quiz: 'A section too thin to ask three different questions about has no quiz in it.',
  infographic:
    'A section with no sequence, process, figures or alternatives to lay out, or fewer than three panels’ worth, has no infographic in it.',
};

export function generateBlockPrompt(input: GenerateBlockInput): string {
  const lines = [
    `You are adding one ${input.kind} to the learner’s lecture notes, at a place they chose. It is`,
    'built only from the section of the notes below and the slides that section came from. You',
    'answer with the JSON object alone — no prose, no fence.',
    '',
    'THE SECTION OF THE NOTES',
    outlineText(input.section),
  ];
  if (input.passage && input.passage.trim().length > 0) {
    lines.push('', 'THE SLIDES IT CAME FROM', '"""', input.passage.trim().slice(0, GENERATE_BLOCK_PASSAGE_CHARS), '"""');
  }
  if (input.instruction && input.instruction.trim().length > 0) {
    lines.push('', 'WHAT THE LEARNER ASKED IT TO SHOW', '"""', input.instruction.trim(), '"""');
  }
  lines.push('', ...KIND_BRIEFS[input.kind]);
  lines.push(
    '',
    `**If this section has nothing worth a ${input.kind}, answer \`{"make": false, "why": "…"}\`.**`,
    DECLINE_RULES[input.kind],
    'Every term in it must appear in the section or the slides above.',
  );
  return lines.join('\n');
}

export type GeneratedBlockReason = 'inserted' | 'declined' | 'invalid';

/**
 * **§5.7.** One schema-bound call; the reply is validated by the same module that validates the
 * ingest's drafts (`shared/doc/validate.ts`), and a reply that does not pass inserts nothing.
 * Provenance is set in code: the pages the rows or nodes cite when they cite any, otherwise the
 * section's own pages, otherwise a reason, so a block can never arrive without it (§2).
 */
export async function planGeneratedBlock(
  deps: DocEditDeps,
  input: GenerateBlockInput,
): Promise<{ batch: AgentDocOpBatch | null; reason: GeneratedBlockReason; problems: string[] }> {
  const spec = KIND_SPECS[input.kind];
  const request: LlmRequest = {
    model: deps.model,
    max_tokens: spec.maxTokens,
    system: [{ type: 'text', text: generateBlockPrompt(input) }],
    messages: [{ role: 'user', content: 'Answer with the JSON object.' }],
    jsonSchema: generateReplySchema(input.kind),
    meta: docEditMeta(deps),
  };
  const result = await deps.llm.complete(request);
  const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
  if (parsed.make !== true) return { batch: null, reason: 'declined', problems: [] };

  const pageCount = input.pageCount ?? Number.MAX_SAFE_INTEGER;
  const sectionPages = [...new Set(input.section.flatMap((e) => e.pages))]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((x, y) => x - y);
  const prov: Provenance =
    sectionPages.length > 0
      ? { pages: sectionPages, reason: null }
      : { pages: [], reason: `a ${input.kind} of this section of the notes` };
  const checked = spec.validate(parsed[input.kind], pageCount, prov);
  if (checked.draft === null) return { batch: null, reason: 'invalid', problems: checked.problems };

  const why =
    typeof parsed.why === 'string' && parsed.why.trim().length > 0
      ? parsed.why.trim()
      : `Ellie drew this ${input.kind} from the section, because you asked for one.`;
  return {
    batch: {
      editId: deps.newId('edit'),
      author: 'ellie',
      // The notes were missing it and the learner said so: the same cause §5.1 files under.
      cause: 'answer_missing',
      ops: [{ op: 'insert_after', anchorBlockId: input.anchorBlockId, blocks: [checked.draft] }],
      focusBlockId: input.anchorBlockId,
      why,
    },
    reason: 'inserted',
    problems: checked.problems,
  };
}

