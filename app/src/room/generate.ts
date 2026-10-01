/**
 * **Blocks Ellie generates on request** (`collab-doc.md` §5.7; `notebooks.md` §5.3).
 *
 * Moved out of `docedit.ts` on 2026-10-01 so the generated block types (table, diagram,
 * flashcards, quiz, infographic) can grow in a file of their own while the rules track edits
 * `docedit.ts` beside it (`app/docs/NOTEBOOK-CONTRACT.md`). The code is as it was; only the kind
 * union now comes from `shared/doc/types.ts`.
 */
import type { AgentDocOpBatch, GeneratedBlockKind, OutlineEntry, Provenance } from '../shared/doc/types.js';
import {
  DIAGRAM_DRAFT_JSON_SCHEMA,
  TABLE_DRAFT_JSON_SCHEMA,
  validateDiagramDraft,
  validateTableDraft,
} from '../shared/doc/validate.js';
import { docEditMeta, outlineText, type DocEditDeps } from './docedit.js';
import { extractJson } from './orchestrator.js';
import type { LlmRequest } from './llm/types.js';

// ── §5.7: a table or a diagram, asked for at a place in the notes ──────────

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

function generateReplySchema(kind: GeneratedBlockKind): Record<string, unknown> {
  // Nested, so its own `$schema` key comes off: one dialect declaration, at the root.
  const { $schema: _dialect, ...draft } = kind === 'table' ? TABLE_DRAFT_JSON_SCHEMA : DIAGRAM_DRAFT_JSON_SCHEMA;
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
  if (input.kind === 'table') {
    lines.push(
      '',
      '**A comparison table.** Rows are the things being compared and columns are what they are',
      'compared on; the first column names the thing. 2 to 6 columns, at most 12 rows, and every row',
      'has exactly one cell per column. A cell is a few words, not a sentence: a term, a value, a',
      'yes or no, a short phrase. Leave a cell empty ("") when neither the notes nor the slides say;',
      'never fill one from general knowledge. Give each row the slide pages it came from.',
    );
  } else {
    lines.push(
      '',
      '**A diagram, as nodes and arrows.** Choose the layout that fits what the section says:',
      '`flow` for steps in an order (an edge from each step to the next); `hierarchy` for a thing',
      'and its kinds or parts (each node but the root names its `parent`); `compare` for two to',
      'four alternatives side by side (each node names the `group`, the alternative, it belongs',
      'under); `cycle` for a loop that returns to its start (edges in order, the last back to the',
      'first). 3 to 12 nodes. A label is at most eight words and is the slide’s own term where it',
      'has one. Label an edge only when the relation is not obvious. Give each node the slide pages',
      'it came from. Draw what the section says, not everything true about the topic.',
    );
  }
  lines.push(
    '',
    `**If this section has nothing worth a ${input.kind}, answer \`{"make": false, "why": "…"}\`.**`,
    input.kind === 'table'
      ? 'A section that compares fewer than two things, or on fewer than two properties, has no table in it.'
      : 'A section with a single idea and no order, parts or alternatives has no diagram in it.',
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
  // Day-0 stub for the kinds the blocks track is building (NOTEBOOK-CONTRACT.md, track N4).
  if (input.kind !== 'table' && input.kind !== 'diagram') {
    return { batch: null, reason: 'invalid', problems: [`${input.kind} is not built yet`] };
  }
  const request: LlmRequest = {
    model: deps.model,
    max_tokens: 2000,
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
  const checked =
    input.kind === 'table'
      ? validateTableDraft(parsed.table, pageCount, prov)
      : validateDiagramDraft(parsed.diagram, pageCount, prov);
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

