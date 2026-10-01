/**
 * **The agents edit the doc as the conversation goes** (#48, `docs/research/collab-doc.md` §5).
 *
 * Three triggers, and the brief's own table is the specification:
 *
 * | # | Trigger | Edit |
 * |---|---|---|
 * | 5.1 | The learner asked, and what Ellie answered is **missing from the doc** | she inserts it, with provenance; if the doc already says it, no edit — she points at the block |
 * | 5.2 | Max asks a question the doc **does not already answer** | the question goes in as a **Q block** at the segment it is about |
 * | 5.3 | A Max question is **closed** — the learner's *Well done*, or a release | the answer goes in under the Q block, **once**, tagged with how it closed: on *you got this* the learner's own answer (theirs, verbatim) and at most one line of Max's; otherwise the correct answer, written as notes |
 *
 * Four properties this module is responsible for keeping true.
 *
 * 1. **It never blocks the reply.** The edit is planned *beside* the turn, after the agent's row
 *    has landed, and a failure anywhere in here is swallowed. A doc edit that could fail a turn
 *    would make the document's ambitions the conversation's problem, which is exactly the trade
 *    `progress-tracking.md` §4.6 already refused for the ledger.
 * 2. **5.1 and 5.3 cost a model call; 5.2 does not.** 5.2 is built in code: the anchor comes from
 *    the exchange's pages or the thread's block, and the question is the turn Max wrote. 5.3 used
 *    to be built in code too — Max's resolving turn, verbatim — and that is how the notes filled
 *    up with verdicts, second-person marking and follow-up questions (#49). The chat is about the
 *    learner; the notes are about the material. Rewriting one into the other is a model's job,
 *    and it happens once per question.
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
import { UNMARKED_OPENER, VERDICT_OPENERS } from './flow.js';
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
  /**
   * **What the learner asked, and what the slide says** (2026-09-23). Since the doc chat's answer
   * became the short half (`prompts.doc.ts` `ellieAnswersBlock`), the fuller explanation exists
   * nowhere yet — this call writes it, and it cannot write it from a 60-word reply. Null on a turn
   * with no learner question (a lesson Start) or no one page (a deck-scoped ask).
   */
  question?: string | null;
  passage?: string | null;
  page?: number | null;
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

/** How much of the slide the planner is shown. A page, not a deck: the anchor already says where. */
export const ANSWER_EDIT_PASSAGE_CHARS = 2_500;

export function answerEditPrompt(input: AnswerEditInput): string {
  const lines = [
    'You are writing into the learner’s lecture notes the fuller explanation of something they just',
    'asked about. In the chat they were given the short version; the notes are where the rest of it',
    'lives. You answer with the JSON object alone — no prose, no fence.',
    '',
    'THE NOTES AROUND WHERE THEY ASKED',
    outlineText(input.outline),
  ];
  if (input.passage && input.passage.trim().length > 0) {
    const where = typeof input.page === 'number' ? ` (p. ${input.page})` : '';
    lines.push('', `THE SLIDE${where}`, '"""', input.passage.trim().slice(0, ANSWER_EDIT_PASSAGE_CHARS), '"""');
  }
  if (input.question && input.question.trim().length > 0) {
    lines.push('', 'WHAT THEY ASKED', '"""', input.question.trim(), '"""');
  }
  lines.push(
    '',
    'WHAT THE CHAT ALREADY TOLD THEM',
    '"""',
    input.answer,
    '"""',
    '',
    '**Write what the chat left out**: the rigorous version — the formal statement, the conditions,',
    'the properties that matter — and how this slide uses it, in the slide’s own notation. Do not',
    'repeat the chat’s plain explanation or its example; the learner has just read them. **40–150',
    'words**, one or two short paragraphs, or a paragraph and a `math` block. The notes are read',
    'end to end, so the same rule holds here as everywhere in them: say what it teaches, not',
    'everything true about it.',
    '',
    '**If the notes here already carry that fuller explanation, answer',
    '`{"edit":"none","points_to":"<block id>"}`.** Near-duplicate paragraphs are how a set of notes',
    'stops being readable. "Already carries it" means the idea is there, not that the wording',
    'matches — and a block that only states the rule, without the why or the formal version, does',
    'not carry it.',
    '',
    '**Formulas go in a `math` block.** Inline `$...$` is shown as its TeX source, not typeset, so',
    'keep it to a single symbol (`$h$`, `$n$`); anything with a command or a sub/superscript —',
    '`h(n) \\le h^*(n)` — is a `math` block of its own, with a sentence around it saying what it means.',
    '',
    'Write in the notes’ own voice — not a transcript of the chat, no "as I explained", no second',
    'person. Open with the claim itself, not a stock opener ("Formally,", "In summary,", "Note that").',
    'Prefer `insert_after` at the block it belongs beside. Use `append_to_block` for one',
    'sentence that completes a block, and `replace_block` only when the block is actually wrong.',
    '',
    'A block marked "(the learner wrote in this block)" is **theirs**. You may insert after it; you',
    'may not replace it or append to it — that becomes a suggestion they have to accept, which is',
    'not what this turn is for.',
    '',
    'Every block you write needs provenance: `prov.pages` for the slides it comes from (the slide',
    'above, and the `p. N` citations in the chat), or `prov.reason` saying why it is here when no',
    'slide says it. A block with neither is rejected.',
  );
  return lines.join('\n');
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
    max_tokens: 1600,
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
    /**
     * **The page the exchange was on, ahead of any page the question cites** (#49). A follow-up
     * that borrows an example from elsewhere in the deck — the 2026-09-23 SAT question asked on
     * p. 7 about *"the air-cargo domain from p. 4–6"* — cites the example's pages, and was filed
     * there, away from where the learner was reading. Given for `rule:max_followup`, whose
     * exchange is the answer it follows.
     */
    exchangePages?: readonly number[];
    pageCount?: number;
  },
): AgentDocOpBatch | null {
  if (deps.docPort.hasQuestion(input.questionId)) return null;
  const own = pagesCited(input.text, input.pageCount);
  const exchange = [...(input.exchangePages ?? [])];
  const pages = exchange.length > 0 ? exchange : own.length > 0 ? own : [...(input.fallbackPages ?? [])];
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

// ── 5.3: the closed question, with its answer under it ──────────────────────

/**
 * **The resolution, as a batch.** `blocks` is what goes under the question in Max's colour;
 * `learnerAnswer` is the learner's own answer on *you got this*, which `ops.ts` writes in their
 * author mark (`types.ts`, the `resolve_q` op). Either may be empty: a question whose answer
 * could not be had is still closed, and says so in its tag rather than by staying open forever.
 */
export function buildResolveEdit(
  deps: DocEditDeps,
  input: {
    questionId: string;
    resolution: QResolution;
    /** What goes under the question, as notes — never Max's chat turn (#49). */
    text: string;
    /** One display formula, as a `math` block after the text. */
    math?: string | null;
    /** On *you got this*: the learner's answer, verbatim, when it came from the chat. */
    learnerAnswer?: string | null;
    /** Where the provenance comes from when `text` cites no page itself. */
    pages?: readonly number[];
    pageCount?: number;
  },
): AgentDocOpBatch {
  const body = input.text.trim();
  const cited = provenanceFor(body, 'the answer to the question in the notes', input.pageCount);
  const prov: Provenance =
    cited.pages.length === 0 && (input.pages ?? []).length > 0 ? { pages: [...input.pages!], reason: null } : cited;
  const blocks: DocBlockDraft[] = body.length > 0 ? blocksFromTurn(body, prov) : [];
  const tex = input.math?.trim() ?? '';
  if (tex.length > 0) blocks.push({ kind: 'math', tex, prov });
  const learnerAnswer = input.learnerAnswer?.trim() ? input.learnerAnswer.trim() : null;
  return {
    editId: deps.newId('edit'),
    author: 'max',
    cause: 'q_resolved',
    ops: [{ op: 'resolve_q', questionId: input.questionId, resolution: input.resolution, blocks, learnerAnswer }],
    focusBlockId: null,
    why:
      input.resolution === 'you_got_this'
        ? 'You answered this one; your answer is under the question.'
        : input.resolution === 'partly_yours'
          ? 'Part of this was yours; the full answer is under the question.'
          : 'The answer was released, so it is written under the question.',
  };
}

/**
 * The structured reply. Two fields and no drafts: the provenance is the question's and the turn's
 * citations, set in code, so the model is not asked to invent any.
 */
export const RESOLVE_NOTES_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: {
      type: ['string', 'null'],
      description:
        'What goes under the question in the notes, in the notes’ own voice. Null when nothing should be added.',
    },
    math: {
      type: ['string', 'null'],
      description: 'One display formula in TeX, when the answer needs one. Null otherwise.',
    },
  },
};

export interface ResolveNotesInput {
  resolution: QResolution;
  question: string;
  /** Max's resolving turn in the chat, when there was one. Substance to take, not a voice to copy. */
  turn: string | null;
  /** On *you got this*: the learner's answer, which the notes will show verbatim above this. */
  learnerAnswer: string | null;
  /** What a correct demonstration contains — the objective's criteria, for the closure fallback. */
  criteria?: readonly string[];
  passage?: string | null;
  page?: number | null;
}

export function resolveNotesPrompt(input: ResolveNotesInput): string {
  const lines = [
    'A question was asked about the learner’s lecture notes, and it is now closed. You are writing',
    'what goes under it in the notes. You answer with the JSON object alone — no prose, no fence.',
    '',
    'THE QUESTION',
    '"""',
    input.question.trim(),
    '"""',
  ];
  if (input.passage && input.passage.trim().length > 0) {
    const where = typeof input.page === 'number' ? ` (p. ${input.page})` : '';
    lines.push('', `THE SLIDE${where}`, '"""', input.passage.trim().slice(0, ANSWER_EDIT_PASSAGE_CHARS), '"""');
  }
  if (input.turn && input.turn.trim().length > 0) {
    lines.push(
      '',
      'WHAT THE TESTER SAID IN THE CHAT WHEN IT CLOSED',
      '(it talks to the learner and marks them; take the substance, never the voice)',
      '"""',
      input.turn.trim(),
      '"""',
    );
  }
  const criteria = (input.criteria ?? []).filter((c) => c.trim().length > 0);
  if (criteria.length > 0) {
    lines.push('', 'A CORRECT ANSWER CONTAINS', ...criteria.map((c) => `- ${c}`));
  }
  if (input.resolution === 'you_got_this' && input.learnerAnswer) {
    lines.push(
      '',
      'THE LEARNER ANSWERED IT CORRECTLY, AND THEIR ANSWER GOES IN THE NOTES VERBATIM, AS THEIRS:',
      '"""',
      input.learnerAnswer.trim(),
      '"""',
      '',
      '**Their answer is the entry.** Add at most **one sentence** under it, and only if the answer',
      'leaves out or misstates something the correct answer needs — the missing condition, the',
      'term the slide uses. If it is complete as it stands, answer `{"text":null}`. Never restate',
      'what they wrote, never praise it, never say what they did.',
    );
  } else {
    lines.push(
      '',
      '**Write the correct answer to the question**, complete, **30–100 words**: one short',
      'paragraph, and a formula in `math` if the answer needs one.',
    );
  }
  lines.push(
    '',
    'This is the notes, not the chat. So:',
    '- No verdict ("Well done", "Partly there", "Not yet"), and no marking of anyone.',
    '- No second person, and no mention of the learner, an attempt, the tester or Ellie.',
    '- No question, anywhere.',
    '- No page citations in the text; the notes carry provenance separately.',
    '- Inline `$...$` only for a single symbol; anything larger goes in `math`.',
    '- Open with the answer itself, not a stock opener.',
  );
  return lines.join('\n');
}

/**
 * **The fallback, when the call cannot be had.** Code, and conservative on purpose: it keeps
 * only the sentences of Max's turn that could stand in notes — no verdict opener, nothing in the
 * second person, no question, nothing about Ellie — and gives up (empty) when too little is left
 * to be an answer. Worse than the call; better than the turn verbatim, which is what #49 was.
 */
export function notesFromTurn(turn: string | null, names: readonly string[] = ['Ellie', 'Max']): string {
  if (!turn) return '';
  let text = turn.trim();
  // `Not marked.` (#49) is never resolved into the notes, but a fallback must not be the one to leak it.
  for (const opener of [...VERDICT_OPENERS, UNMARKED_OPENER]) {
    const bare = opener.replace(/\.$/, '');
    text = text.replace(new RegExp(`^[\\s*_>]*${bare}\\.?[\\s*_]*`, 'i'), '');
  }
  // Second person is the learner; first person is the tester talking ("let me address it").
  const person = /\b(you|your|yours|you're|you've|yourself|I|I'm|I'll|I'd|me|my|let me)\b/i;
  const agents = new RegExp(`\\b(${names.map((n) => n.replace(/[^\w]/g, '')).join('|')})\\b`, 'i');
  const kept = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z*`$“"(])/))
    .map((sentence) => sentence.trim())
    // Under four words is an interjection ("Fair enough.", "Close."), not a sentence of an answer.
    .filter((sentence) => sentence.split(/\s+/).length >= 4)
    .filter((sentence) => !sentence.includes('?') && !person.test(sentence) && !agents.test(sentence))
    // About the exchange rather than the material. Narrow on purpose: "the question itself becomes
    // visible" is content in a deck about side channels.
    .filter((sentence) => !/\b(attempt|answer(ed)? (it|this)|(fair|good|reasonable|this|that) question|the question (also )?asked)\b/i.test(sentence))
    // Marking, even when it is not addressed to anyone: "is reasonable", "that part is missing".
    .filter((sentence) => !/\b(reasonable|missing|not quite|close but|correctly|well done|partly there|not yet|not marked)\b/i.test(sentence));
  const out = kept.join(' ').trim();
  return out.split(/\s+/).filter((w) => w.length > 0).length >= 8 ? out : '';
}

/**
 * **5.3.** One call per question, when it closes: the learner's *Well done*, or a release.
 *
 * Never throws for a bad reply: a reply that cannot be read falls back to `notesFromTurn`, and a
 * question that has neither still resolves — tag only — because the alternative is a Q block that
 * says *open* forever about a question the app has closed.
 */
export async function planResolveEdit(
  deps: DocEditDeps,
  input: ResolveNotesInput & {
    questionId: string;
    /** The Q block's pages: provenance when the answer cites none. */
    pages?: readonly number[];
    pageCount?: number;
  },
): Promise<{ batch: AgentDocOpBatch; via: 'model' | 'fallback' | 'none' }> {
  const quoted = input.resolution === 'you_got_this' ? input.learnerAnswer : null;
  let text: string | null = null;
  let math: string | null = null;
  let answered = false;
  try {
    const result = await deps.llm.complete({
      model: deps.model,
      max_tokens: 900,
      system: [{ type: 'text', text: resolveNotesPrompt(input) }],
      messages: [{ role: 'user', content: 'Answer with the JSON object.' }],
      jsonSchema: RESOLVE_NOTES_SCHEMA,
      meta: docEditMeta(deps),
    });
    const parsed = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
    if ('text' in parsed) {
      answered = true;
      text = typeof parsed.text === 'string' && parsed.text.trim().length > 0 ? parsed.text.trim() : null;
      math = typeof parsed.math === 'string' && parsed.math.trim().length > 0 ? parsed.math.trim() : null;
    }
  } catch {
    // The fallback below; the caller logs which path it took.
  }
  // On *you got this* the learner's answer is the entry, so a failed call loses nothing but the
  // optional completion line — Max's praise is not a fallback for it.
  const fallback = !answered && quoted === null ? notesFromTurn(input.turn) : '';
  const batch = buildResolveEdit(deps, {
    questionId: input.questionId,
    resolution: input.resolution,
    text: text ?? fallback,
    math,
    learnerAnswer: quoted,
    pages: input.pages,
    pageCount: input.pageCount,
  });
  return { batch, via: answered ? 'model' : fallback.length > 0 ? 'fallback' : 'none' };
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
/**
 * **Find the model's quote in the learner's own words, or the nearest thing that is really there.**
 *
 * §5.4's suggestion is a *replacement of a range of their text*, so the quote has to be locatable
 * character for character; the prompt says so twice. Models paraphrase anyway — they normalise a
 * quote mark, drop a stray space, extend to a clause boundary — and the old behaviour was to
 * return `null` and say nothing, which is how the live run of 20 Sep produced a correction in the
 * chat ("replace … with …") and no suggestion in the document at all.
 *
 * Three ways, in descending confidence, and never anything that is not a substring of their text:
 *
 *  1. `verbatim` — it is there as given.
 *  2. `trimmed` — the longest run of the model's quote that *is* there, found by walking the ends
 *     in. Guarded: it has to be at least 12 characters and most of what the model asked for, so a
 *     shared "the" can never become the suggestion.
 *  3. `sentence` — the sentence of their text that overlaps the quote most, when the model clearly
 *     meant one sentence and rewrote it. Only when their text is one or two sentences, where
 *     "which sentence" is not a guess.
 */
export type QuoteMatch = 'verbatim' | 'trimmed' | 'sentence';

export function locateQuote(text: string, raw: string): { quote: string; how: QuoteMatch } | null {
  const quote = raw.trim();
  if (quote.length === 0) return null;
  if (text.includes(quote)) return { quote, how: 'verbatim' };

  // The longest substring of the model's quote that is present, by shrinking from either end.
  let best = '';
  for (let start = 0; start < quote.length; start++) {
    for (let end = quote.length; end > start + best.length; end--) {
      const run = quote.slice(start, end).trim();
      if (run.length > best.length && text.includes(run)) best = run;
    }
  }
  if (best.length >= 12 && best.length >= quote.length * 0.4) return { quote: best, how: 'trimmed' };

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length > 0 && sentences.length <= 2) {
    const words = new Set(quote.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const scored = sentences
      .map((sentence) => {
        const own = sentence.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        const hits = own.filter((w) => words.has(w)).length;
        return { sentence, share: own.length === 0 ? 0 : hits / own.length };
      })
      .sort((a, b) => b.share - a.share);
    const top = scored[0];
    if (top && top.share >= 0.3) return { quote: top.sentence, how: 'sentence' };
  }
  return null;
}

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
  const located = locateQuote(input.text, input.quote);
  if (!located) return null;
  if (input.replacement.trim().length === 0) return null;
  const quote = located.quote;
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
 * Plan a correction to the learner's own doc text, or decide there is none.
 *
 * **The reason comes back with it.** `null` used to cover "nothing to correct", "the quote was
 * not verbatim" and "the call failed" alike — three different facts, indistinguishable in the
 * log, and the live run of 20 Sep spent its budget finding out which one had happened. The
 * caller logs `reason`; no learner text goes with it, only lengths.
 */
export type SuggestionReason = 'suggested' | 'declined' | 'not_located' | 'no_replacement';

export interface SuggestionPlan {
  batch: AgentDocOpBatch | null;
  reason: SuggestionReason;
  /** How the quote was found, when it was. For the log: a run of `sentence` means retune. */
  how: QuoteMatch | null;
  quoteChars: number;
}

export async function planSuggestionEdit(
  deps: DocEditDeps,
  input: { blockId: string; text: string; feedback: string; threadId: string | null },
): Promise<SuggestionPlan> {
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
  if (parsed.suggest !== true) return { batch: null, reason: 'declined', how: null, quoteChars: 0 };

  const quote = typeof parsed.quote === 'string' ? parsed.quote : '';
  const replacement = typeof parsed.replacement === 'string' ? parsed.replacement : '';
  const located = locateQuote(input.text, quote);
  if (!located) return { batch: null, reason: 'not_located', how: null, quoteChars: quote.trim().length };
  if (replacement.trim().length === 0) {
    return { batch: null, reason: 'no_replacement', how: located.how, quoteChars: located.quote.length };
  }
  const batch = buildSuggestionEdit(deps, {
    blockId: input.blockId,
    text: input.text,
    quote,
    replacement,
    note: typeof parsed.note === 'string' ? parsed.note : '',
    threadId: input.threadId,
  });
  return {
    batch,
    reason: batch ? 'suggested' : 'not_located',
    how: located.how,
    quoteChars: located.quote.length,
  };
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
  'block_action',
];
