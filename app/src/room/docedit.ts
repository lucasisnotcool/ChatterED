/**
 * **The agents edit the doc as the conversation goes** (#48, `docs/research/collab-doc.md` §5).
 *
 * Three triggers, and the brief's own table is the specification:
 *
 * | # | Trigger | Edit |
 * |---|---|---|
 * | 5.1 | The learner asked, and what Ellie answered is **missing from the doc** | she inserts it, with provenance; if the doc already says it, no edit — she points at the block |
 * | 5.2 | Max asks a question the doc **does not already answer** | the question goes in as a **Q block** at the segment it is about |
 * | 5.3 | A Max question is resolved | **Max's correct version** goes in under the Q block, tagged with how it was resolved |
 *
 * Four properties this module is responsible for keeping true.
 *
 * 1. **It never blocks the reply.** The edit is planned *beside* the turn, after the agent's row
 *    has landed, and a failure anywhere in here is swallowed. A doc edit that could fail a turn
 *    would make the document's ambitions the conversation's problem, which is exactly the trade
 *    `progress-tracking.md` §4.6 already refused for the ledger.
 * 2. **Only 5.1 costs a model call.** 5.2 and 5.3 are built in code: the anchor comes from
 *    `blocksForPages` or the thread's block, and Max's correct version is the turn he has already
 *    written. A model call for either would be paying Sonnet to retype a paragraph.
 * 3. **The model is shown the outline and nothing else.** `docPort.outlineNear` is the whole view
 *    (brief §8: *"a structured model call given the doc outline near the anchor"*), and the reply
 *    is a `DocBlockDraft[]` the shared validator checks — never ProseMirror JSON, never an offset.
 * 4. **The guard is not here.** Learner text is protected in the renderer, where the transaction
 *    happens (`shared/doc/guard.ts`, architect §D3). What this module must not do is *pretend* to
 *    enforce it; what it does instead is address blocks, which is what makes the guard's job
 *    decidable.
 */
import type {
  AgentAuthor,
  AgentDocOp,
  AgentDocOpBatch,
  DocBlockDraft,
  DocEditCause,
  OutlineEntry,
  Provenance,
  QResolution,
} from '../shared/doc/types.js';
import { DRAFT_BLOCK_JSON_SCHEMA, validateDrafts } from '../shared/doc/validate.js';
import type { DocPort } from './docport.js';
import { extractJson } from './orchestrator.js';
import type { LLMClient, LlmRequest } from './llm/types.js';

// ── reading the deck out of what an agent said ─────────────────────────────

/**
 * **The pages a turn cited**, from the `p. N` grounds the Tester and the Teacher are both asked
 * for (`attempt-first.md` §3, kept by `collab-doc.md` §4.6).
 *
 * This is where a block's provenance comes from when an agent writes one: §2 makes provenance
 * mandatory on **every** block, and an agent edit is a block like any other. When the turn cited
 * nothing there is no page to claim, so the block carries a `reason` instead — which is the
 * honest half of the same rule, and is what stops an edit inventing a citation.
 */
export function pagesCited(text: string, pageCount = Number.MAX_SAFE_INTEGER): number[] {
  const pages: number[] = [];
  for (const match of text.matchAll(/\bpp?\.\s*(\d{1,4})(?:\s*[–\-—]\s*(\d{1,4}))?/gi)) {
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (!Number.isInteger(from) || from < 1 || from > pageCount) continue;
    const last = Number.isInteger(to) && to >= from && to <= pageCount ? Math.min(to, from + 20) : from;
    for (let p = from; p <= last; p += 1) if (!pages.includes(p)) pages.push(p);
  }
  return pages;
}

/** Provenance for a block an agent wrote: the pages it cited, or why it is here. */
export function provenanceFor(text: string, reason: string, pageCount?: number): Provenance {
  const pages = pagesCited(text, pageCount);
  return { pages, reason: pages.length > 0 ? null : reason };
}

/**
 * An agent turn, split into paragraphs a doc can hold.
 *
 * Deliberately dumb: blank-line separated, `- ` runs folded into one bullet list, nothing else.
 * The alternative is a second model call to reformat prose the model has already written, and the
 * inline subset (`**bold**`, `*em*`, `` `code` ``, `$tex$`) survives verbatim into `inline.ts`
 * because both ends were built against the same closed grammar.
 */
export function blocksFromTurn(text: string, prov: Provenance): DocBlockDraft[] {
  const blocks: DocBlockDraft[] = [];
  let bullets: string[] = [];
  const flush = (): void => {
    if (bullets.length === 0) return;
    blocks.push({ kind: 'bullets', items: bullets, prov });
    bullets = [];
  };
  for (const chunk of text.split(/\n{2,}/)) {
    const body = chunk.trim();
    if (body.length === 0) continue;
    const lines = body.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const allBullets = lines.length > 0 && lines.every((l) => /^[-*•]\s+/.test(l));
    if (allBullets) {
      bullets.push(...lines.map((l) => l.replace(/^[-*•]\s+/, '')));
      continue;
    }
    flush();
    blocks.push({ kind: 'paragraph', text: lines.join(' '), prov });
  }
  flush();
  return blocks;
}

// ── 5.1: the answer that was missing from the doc ──────────────────────────

/**
 * The structured reply (brief §5.1). Two shapes, and the *first* is the one the brief cares
 * about: **"if the doc already says it, no edit; she points to the block instead."** Without a way
 * to say that, every answer would append a near-duplicate paragraph and the notes would silt up
 * after ten questions.
 */
export const DOC_EDIT_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['edit'],
  additionalProperties: false,
  properties: {
    edit: {
      type: 'string',
      enum: ['none', 'insert_after', 'append_to_block', 'replace_block'],
      description:
        "'none' when the notes already say this — then set points_to. Otherwise the op to apply.",
    },
    points_to: {
      type: ['string', 'null'],
      description: "With edit='none': the block id that already says it.",
    },
    anchor_block_id: {
      type: ['string', 'null'],
      description: "With edit='insert_after': the block id to insert after.",
    },
    block_id: {
      type: ['string', 'null'],
      description: "With edit='append_to_block' or 'replace_block': the block id to change.",
    },
    text: {
      type: ['string', 'null'],
      description: "With edit='append_to_block': one sentence to add to the end of that block.",
    },
    blocks: (DRAFT_BLOCK_JSON_SCHEMA.properties as Record<string, unknown>).blocks,
    why: { type: 'string', description: 'One sentence, for the log and the Remove · Keep tooltip.' },
  },
};

export interface AnswerEditInput {
  /** The answer Ellie just gave, verbatim. */
  answer: string;
  /** The block the thread hangs off, when it has one (a span thread always does). */
  blockId: string | null;
  /**
   * **A span thread's edit lands at that span's block, and nowhere the planner finds tidier**
   * (interview finding, `docs/research/interviews/findings.md` §6).
   *
   * One interviewee complained specifically of additions landing in the wrong place; all three
   * described answers drifting away from the slide through rounds of clarification. When the
   * learner highlighted a span and asked about *it*, the answer belongs beside it — that is not a
   * judgement a model should be asked to make, because the learner already made it when they
   * highlighted. So the anchor is pinned and only the *content* is planned.
   */
  pinAnchor?: boolean;
  /** The deck's page count, so a citation outside it is dropped rather than trusted. */
  pageCount?: number;
  outline: readonly OutlineEntry[];
}

/** What the planner is shown of the document, and all it is shown. */
export function outlineText(outline: readonly OutlineEntry[]): string {
  if (outline.length === 0) return '(the notes are empty here)';
  return outline
    .map((entry) => {
      const where = entry.pages.length > 0 ? ` [p. ${entry.pages.join(', ')}]` : '';
      const path = entry.path.length > 0 ? `${entry.path.join(' › ')} › ` : '';
      const learner = entry.learnerText ? ' (the learner wrote in this block)' : '';
      return `- ${entry.blockId} — ${entry.kind}: ${path}${entry.text}${where}${learner}`;
    })
    .join('\n');
}

export function answerEditPrompt(input: AnswerEditInput): string {
  return [
    'You are deciding whether the learner’s lecture notes are missing something that was just',
    'explained to them in the chat. You answer with the JSON object alone — no prose, no fence.',
    '',
    'THE NOTES AROUND WHERE THEY ASKED',
    outlineText(input.outline),
    '',
    'WHAT WAS JUST EXPLAINED',
    '"""',
    input.answer,
    '"""',
    '',
    '**If the notes already say this, answer `{"edit":"none","points_to":"<block id>"}`.** That is the',
    'common case and it is the right answer: near-duplicate paragraphs are how a set of notes stops',
    'being readable. "Already says it" means the idea is there, not that the wording matches.',
    '',
    'Otherwise add what is missing, in the notes’ own voice — not a transcript of the chat, no',
    '"as I explained", no second person. Prefer `insert_after` at the block it belongs beside.',
    'Use `append_to_block` for one sentence that completes a block, and `replace_block` only when',
    'the block is actually wrong.',
    '',
    'A block marked "(the learner wrote in this block)" is **theirs**. You may insert after it; you',
    'may not replace it or append to it — that becomes a suggestion they have to accept, which is',
    'not what this turn is for.',
    '',
    'Every block you write needs provenance: `prov.pages` for the slides it comes from (use the',
    '`p. N` citations in the explanation above), or `prov.reason` saying why it is here when no',
    'slide says it. A block with neither is rejected.',
  ].join('\n');
}

export interface DocEditDeps {
  llm: LLMClient;
  docPort: DocPort;
  /** `models.orchestrator` — the same reasoning-capable model the objective ingest uses. */
  model: string;
  newId: (prefix: string) => string;
  roomId: string;
  fileId: string | null;
  anchorId: string | null;
  turnId: string | null;
}

/**
 * The cost metadata every call from here must carry (architect §2). `costScope: 'docedit'` is what
 * lets a learner see what the document cost them as a line of its own, rather than folded into
 * whichever lane it happened to share.
 */
export function docEditMeta(deps: DocEditDeps): LlmRequest['meta'] {
  return {
    scope: 'docedit',
    costScope: 'docedit',
    roomId: deps.roomId,
    fileId: deps.fileId,
    anchorId: deps.anchorId,
    turnId: deps.turnId ?? undefined,
  };
}

/**
 * **5.1.** Returns the batch to emit, or null when nothing should be written — which covers three
 * different things, all of them normal: the doc already says it, the model declined, or the call
 * failed. A caller that cannot tell them apart is fine, because the response to all three is the
 * same: say nothing, edit nothing.
 */
export async function planAnswerEdit(
  deps: DocEditDeps,
  input: AnswerEditInput,
): Promise<{ batch: AgentDocOpBatch | null; pointsTo: string | null }> {
  const request: LlmRequest = {
    model: deps.model,
    max_tokens: 1200,
    system: [{ type: 'text', text: answerEditPrompt(input) }],
    messages: [{ role: 'user', content: 'Answer with the JSON object.' }],
    jsonSchema: DOC_EDIT_SCHEMA,
    meta: docEditMeta(deps),
  };
  const result = await deps.llm.complete(request);
  const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
  const edit = typeof parsed.edit === 'string' ? parsed.edit : 'none';
  const why = typeof parsed.why === 'string' && parsed.why.trim().length > 0 ? parsed.why.trim() : 'Ellie added what the notes were missing.';
  if (edit === 'none') {
    return { batch: null, pointsTo: typeof parsed.points_to === 'string' ? parsed.points_to : null };
  }

  const { blocks } = validateDrafts(parsed, input.pageCount ?? Number.MAX_SAFE_INTEGER);
  const anchorBlockId =
    input.pinAnchor === true && input.blockId !== null
      ? input.blockId
      : ((typeof parsed.anchor_block_id === 'string' ? parsed.anchor_block_id : null) ??
        (typeof parsed.block_id === 'string' ? parsed.block_id : null) ??
        input.blockId ??
        input.outline.at(-1)?.blockId ??
        null);
  if (anchorBlockId === null) return { batch: null, pointsTo: null };
  // A pinned anchor is the learner's own highlight, so the only op that can honour it is one that
  // adds beside it: replacing or appending to the span they asked about is not "answering here".
  const pinned = input.pinAnchor === true && input.blockId !== null;

  /**
   * **Learner text is worked around, not through** (brief §5.4).
   *
   * The renderer's guard already handles this correctly — `replace_block` over learner text
   * becomes an inline suggestion, `append_to_block` is relocated after the block — so nothing is
   * unsafe without this. What it saves is the *surprise*: an answer that was merely missing should
   * not arrive as an Accept · Reject on something the learner wrote. So a target the outline marks
   * as theirs is downgraded to `insert_after` here, where the reason can be stated, and §6's
   * `buildSuggestionEdit` stays the only deliberate producer of a suggestion.
   */
  const targetIsLearners = pinned || input.outline.some((e) => e.blockId === anchorBlockId && e.learnerText);

  let op: AgentDocOp | null = null;
  if (!targetIsLearners && edit === 'append_to_block' && typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
    op = { op: 'append_to_block', blockId: anchorBlockId, text: parsed.text.trim() };
  } else if (edit === 'append_to_block' && typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
    op = {
      op: 'insert_after',
      anchorBlockId,
      blocks: [{ kind: 'paragraph', text: parsed.text.trim(), prov: provenanceFor(input.answer, 'added beside the learner’s own note', input.pageCount) }],
    };
  } else if (blocks.length > 0) {
    op =
      edit === 'replace_block' && !targetIsLearners
        ? { op: 'replace_block', blockId: anchorBlockId, blocks }
        : { op: 'insert_after', anchorBlockId, blocks };
  }
  if (op === null) return { batch: null, pointsTo: null };

  return {
    batch: {
      editId: deps.newId('edit'),
      author: 'ellie',
      cause: 'answer_missing',
      ops: [op],
      focusBlockId: anchorBlockId,
      why,
    },
    pointsTo: null,
  };
}

// ── 5.2: Max's question, written in as a Q block ───────────────────────────

/**
 * **No model call.** The question is the turn Max has just written, the anchor is the segment it
 * is about, and "which segment" is a page intersection the doc port already answers. The one
 * judgement the brief asks for — *"a question the doc does not already answer"* — is served here
 * by the one check code can make honestly: the Q block is not already in the document. Whether the
 * prose nearby happens to answer it is a semantic call, and paying for one on every question would
 * put a model call in front of the fastest turn in the loop. Recorded as a limitation rather than
 * quietly approximated.
 */
export function buildQuestionEdit(
  deps: DocEditDeps,
  input: {
    questionId: string;
    objectiveId: string | null;
    /** Max's question turn, verbatim. */
    text: string;
    /** The thread's block, when it has one. */
    blockId: string | null;
    /**
     * **Where the exchange was, when Max's own question does not say.**
     *
     * A follow-up rarely re-cites the page Ellie just quoted — it says "and what happens then?"
     * — so on its own text alone the page intersection is empty and the anchor falls all the way
     * through to the last entry of the outline, i.e. the end of the notes. The live run of 20 Sep
     * put a red Q block about page 2 under the last bullet of page 7. These are the pages the
     * answer it follows cited, and they are used only when the question cites none of its own.
     */
    fallbackPages?: readonly number[];
    pageCount?: number;
  },
): AgentDocOpBatch | null {
  if (deps.docPort.hasQuestion(input.questionId)) return null;
  const own = pagesCited(input.text, input.pageCount);
  const pages = own.length > 0 ? own : [...(input.fallbackPages ?? [])];
  const anchorBlockId =
    input.blockId ?? deps.docPort.blocksForPages(pages).at(-1) ?? deps.docPort.outlineNear({ blockId: null, pages }).at(-1)?.blockId ?? null;
  if (anchorBlockId === null) return null;
  return {
    editId: deps.newId('edit'),
    author: 'max',
    cause: 'q_block',
    ops: [
      {
        op: 'insert_q',
        anchorBlockId,
        questionId: input.questionId,
        objectiveId: input.objectiveId,
        text: input.text.trim(),
        prov: provenanceFor(input.text, 'a question Max asked about this part of the notes', input.pageCount),
      },
    ],
    focusBlockId: anchorBlockId,
    why: 'Max asked a question about this part of the notes.',
  };
}

// ── 5.3: the resolved question, with Max's correct version under it ────────

/**
 * **No model call either.** Max's correct version is the turn he has just given — the feedback's
 * correction, or the released answer — and retyping it through a second model would be paying for
 * a paraphrase of something already written, with a fresh chance to contradict it.
 *
 * `resolution` is `qResolutionOf(quiz)`: *you got this* on a *Well done*, *partly yours* on a
 * question that closed while partial, *released* on any of the three releases (brief §5.3).
 */
export function buildResolveEdit(
  deps: DocEditDeps,
  input: {
    questionId: string;
    resolution: QResolution;
    /** Max's resolving turn, verbatim. */
    text: string;
    pageCount?: number;
  },
): AgentDocOpBatch | null {
  const body = input.text.trim();
  if (body.length === 0) return null;
  const prov = provenanceFor(body, 'Max’s answer to the question in the notes', input.pageCount);
  const blocks = blocksFromTurn(body, prov);
  if (blocks.length === 0) return null;
  return {
    editId: deps.newId('edit'),
    author: 'max',
    cause: 'q_resolved',
    ops: [{ op: 'resolve_q', questionId: input.questionId, resolution: input.resolution, blocks }],
    focusBlockId: null,
    why:
      input.resolution === 'you_got_this'
        ? 'The learner answered this one; Max’s version is under it for the record.'
        : input.resolution === 'partly_yours'
          ? 'Part of this was the learner’s; Max completed it.'
          : 'The answer was released, so it is written under the question.',
  };
}

// ── §6: a correction to the learner's own doc text, as a suggestion ────────

/**
 * **The one place a suggestion arises naturally** (brief §6, architect §E2).
 *
 * The learner wrote in the doc, Max marked it, and the text itself needs changing. That is the one
 * case where the correct edit *is* an edit to learner-authored text — so it is expressed as a
 * suggestion with `quote` and `replacement`, and the renderer draws it strikethrough-plus-insert
 * with Accept · Reject.
 *
 * **`quote` must be a verbatim substring of the learner's text**, and that is checked here rather
 * than hoped for: a suggestion whose quote is a paraphrase cannot be located in the document, so
 * it would silently become nothing. Same discipline as ledger rule 1, and for the same reason.
 */
export function buildSuggestionEdit(
  deps: DocEditDeps,
  input: {
    blockId: string;
    /** The learner's own text, verbatim, as it reached the assessor. */
    text: string;
    quote: string;
    replacement: string;
    note: string;
    threadId: string | null;
  },
): AgentDocOpBatch | null {
  const quote = input.quote.trim();
  if (quote.length === 0 || !input.text.includes(quote)) return null;
  if (input.replacement.trim().length === 0) return null;
  return {
    editId: deps.newId('edit'),
    author: 'max',
    cause: 'suggestion',
    ops: [],
    focusBlockId: input.blockId,
    why: input.note.trim() || 'Max suggested a correction to what you wrote.',
    suggestion: {
      blockId: input.blockId,
      quote,
      replacement: input.replacement.trim(),
      note: input.note.trim(),
      threadId: input.threadId,
    },
  };
}

/**
 * **The one structured call on the suggestion path** (brief §6).
 *
 * Max has just marked what the learner wrote in the document, and his feedback says what is
 * wrong with it in prose. Turning that into a Google-Docs suggestion needs two things prose does
 * not carry: **which of their words** to strike, character for character, and what to put in
 * their place. Asking for them as fields is the same discipline as `ELLIE_CUE_SCHEMA` — a fact
 * the renderer has to locate in a document may not be a sentence a model wrote around it.
 *
 * `none` is the common answer and the right one: most feedback is about what is missing rather
 * than about what is wrong, and a suggestion on text that was fine is the app correcting the
 * learner for sport.
 */
export const SUGGESTION_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['suggest'],
  additionalProperties: false,
  properties: {
    suggest: {
      type: 'boolean',
      description: 'False unless the learner’s own words are wrong and have to change.',
    },
    quote: {
      type: ['string', 'null'],
      description:
        'The part of THEIR text to replace, copied character for character out of it. Not a paraphrase.',
    },
    replacement: { type: ['string', 'null'], description: 'What it should read instead.' },
    note: { type: ['string', 'null'], description: 'One sentence beside Accept · Reject. Never the whole correction.' },
  },
};

export function suggestionPrompt(input: { text: string; feedback: string }): string {
  return [
    'The learner wrote this in their own lecture notes:',
    '"""',
    input.text,
    '"""',
    '',
    'The tester has just marked it:',
    '"""',
    input.feedback,
    '"""',
    '',
    'Does **their own wording** have to change for the notes to be correct? Answer with the JSON',
    'object alone — no prose, no fence.',
    '',
    'Answer `{"suggest":false}` unless something they wrote is actually **wrong**. Missing is not',
    'wrong: an incomplete note is still their note, and the rest belongs in the conversation or in',
    'a block added beside it. Only a claim that is false earns a suggestion.',
    '',
    'When it does: `quote` must be copied **character for character** out of their text above — the',
    'shortest run that contains the error — because it has to be found in the document. A',
    'paraphrase cannot be, and the suggestion silently becomes nothing. `replacement` is what that',
    'run should read instead, in their register, not yours. `note` is one sentence saying why.',
  ].join('\n');
}

/**
 * Plan a correction to the learner's own doc text, or decide there is none. Returns the batch
 * ready to emit; `null` covers "nothing to correct", "the quote was not verbatim" and "the call
 * failed", all of which the caller answers the same way.
 */
export async function planSuggestionEdit(
  deps: DocEditDeps,
  input: { blockId: string; text: string; feedback: string; threadId: string | null },
): Promise<AgentDocOpBatch | null> {
  const request: LlmRequest = {
    model: deps.model,
    max_tokens: 600,
    system: [{ type: 'text', text: suggestionPrompt(input) }],
    messages: [{ role: 'user', content: 'Answer with the JSON object.' }],
    jsonSchema: SUGGESTION_SCHEMA,
    meta: docEditMeta(deps),
  };
  const result = await deps.llm.complete(request);
  const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
  if (parsed.suggest !== true) return null;
  return buildSuggestionEdit(deps, {
    blockId: input.blockId,
    text: input.text,
    quote: typeof parsed.quote === 'string' ? parsed.quote : '',
    replacement: typeof parsed.replacement === 'string' ? parsed.replacement : '',
    note: typeof parsed.note === 'string' ? parsed.note : '',
    threadId: input.threadId,
  });
}

// ── "insert into the document", from a private thread ──────────────────────

/**
 * **The whisper's one path from private to shared** (brief §4.1, issue #16's surviving half).
 *
 * The learner read something in a private thread, decided it belongs in the notes, and pressed the
 * button. It is the *learner's* act — which is why it is a plain code-built insert with no model
 * call and no judgement about whether the doc already says it: they have already made that call,
 * and second-guessing it would make the private channel less useful than the public one.
 */
export function buildWhisperInsert(
  deps: DocEditDeps,
  input: { author: AgentAuthor; text: string; anchorBlockId: string | null; pageCount?: number },
): AgentDocOpBatch | null {
  const body = input.text.trim();
  if (body.length === 0) return null;
  const anchorBlockId =
    input.anchorBlockId ?? deps.docPort.outlineNear({ blockId: null }).at(-1)?.blockId ?? null;
  if (anchorBlockId === null) return null;
  const prov = provenanceFor(body, 'the learner asked for this to be added from a private thread', input.pageCount);
  const blocks = blocksFromTurn(body, prov);
  if (blocks.length === 0) return null;
  return {
    editId: deps.newId('edit'),
    author: input.author,
    cause: 'whisper_insert',
    ops: [{ op: 'insert_after', anchorBlockId, blocks }],
    focusBlockId: anchorBlockId,
    why: 'The learner inserted this from a private thread.',
  };
}

/** The causes this module produces, for the log and for the tests that enumerate them. */
export const DOC_EDIT_CAUSES: readonly DocEditCause[] = [
  'answer_missing',
  'q_block',
  'q_resolved',
  'whisper_insert',
  'suggestion',
];
