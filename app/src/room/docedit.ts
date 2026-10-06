/**
 * **The agents edit the doc as the conversation goes** (#48, `docs/research/collab-doc.md` §5).
 *
 * Three triggers, and the brief's own table is the specification:
 *
 * | # | Trigger | Edit |
 * |---|---|---|
 * | 5.1 | The learner asked in the doc chat, or pressed **Explain** / **Example** on a block (`notebooks.md` §4.2, which replaces §5.1's 40–150 words) | **one note** of at most `CARD_ADDITION_MAX_WORDS` words (a paragraph, a list, a formula or a table): **into the card's depth** when the block is in a concept card, else under the block, with provenance (`planBlockNote`; §11.2, amended 2026-10-06) |
 * | 5.2 | Max asks a question the doc **does not already answer** | the question alone (`core/quizturn.questionText`, 2026-10-06) goes in as a **Q block** at the segment it is about (after the card when it is in one); the renderer shows it in a side rail while it is open |
 * | 5.3 | A Max question is **closed** — the learner's *Well done*, a release, a closure | the Q block folds into a **self-check chip**, **once**: on *you got this* the learner's own answer (theirs, verbatim), plus since 6 Oct afternoon one sentence of Max's kept as the block's `maxNote` attribute, never as text (decision 12); on a correct blank after a release the learner's answer with a *recall* tag (decision 14); otherwise nothing at all, and the chip says *revisit* (2026-10-06, D4) |
 *
 * Four properties this module is responsible for keeping true.
 *
 * 1. **It never blocks the reply.** The edit is planned *beside* the turn, after the agent's row
 *    has landed, and a failure anywhere in here is swallowed. A doc edit that could fail a turn
 *    would make the document's ambitions the conversation's problem, which is exactly the trade
 *    `progress-tracking.md` §4.6 already refused for the ledger.
 * 2. **5.1 costs a model call (one more when its line runs over); 5.2 and 5.3 do not.** 5.2 is
 *    built in code: the anchor comes from the exchange's pages or the thread's block, and the
 *    question is the turn Max wrote, less its preamble. 5.3 was Max's resolving turn verbatim
 *    until #49, then a 30–100-word answer from a model call (`planResolveEdit`), and since
 *    2026-10-06 (D4, `collab-doc.md` §5.3 amended) it writes no Max words at all: Max wrote 1,406
 *    of one doc's 4,572 words that way, much of it answers the learner had not earned. The chat is
 *    about the learner; the notes are about the material, and the learner's earned answer.
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
  ConceptRole,
  DocBlockDraft,
  DocEditCause,
  OutlineEntry,
  Provenance,
  QResolution,
} from '../shared/doc/types.js';
import { BLOCK_LINE_MAX_WORDS, CARD_ADDITION_MAX_WORDS, CONCEPT_ROLES } from '../shared/doc/types.js';
import { validateTableDraft } from '../shared/doc/validate.js';
import type { DocPort } from './docport.js';
import { UNMARKED_OPENER, VERDICT_OPENERS } from './flow.js';
import { extractJson } from './orchestrator.js';
import type { LLMClient, LlmRequest } from './llm/types.js';
import { wordCount } from './timer.js';
import { answerLeaks } from '../core/answerguard.js';

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

// ── what every doc-edit call shares ────────────────────────────────────────

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

/** How much of the slide a planner is shown. A page, not a deck: the anchor already says where. */
export const ANSWER_EDIT_PASSAGE_CHARS = 2_500;

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

// ── notebooks §4.2: one line under the block (replaces §5.1's 40–150 words) ──

/**
 * **Two outputs, never one squeezed into the other** (`notebooks.md` §4.2, contract C7).
 *
 * Lucas, 1 Oct: *"the answer usually does not fit verbosely into the doc, so need two separate
 * outputs for explaining to user vs. doc edit."* The chat gets Ellie's full answer; the notes get
 * **one sentence of at most `BLOCK_LINE_MAX_WORDS` words**, written to stand on its own, directly
 * under the block it was asked on. This is the call that writes that line, after the chat reply
 * has been released (`actor.#maybeDocEdit`), so the chat never waits on it.
 *
 * It replaces `collab-doc.md` §5.1's planner (`planAnswerEdit`, retired here), which wrote the
 * long half of a short chat answer into the notes, 40–150 words, or pointed at a block that
 * already said it. Both halves of that are gone: the chat answer is whole again, and a block
 * action **always** writes its line (the learner pressed a button asking for it). Only a plain
 * doc-chat question with no block may come back with none, because nothing in the outline may fit.
 *
 * The word limit is **enforced in code**, not asked for and hoped: a reply over the limit is asked
 * for once more, and a second overflow is cut to the last full clause within the limit, never
 * mid-word. The model counts words badly and the limit is the brief's.
 *
 * *Amended 2026-10-06 (`notebooks.md` §11.2):* the one plain line became one **note** of about 120
 * words at most, in the form its content needs (a paragraph, a list, a formula with its symbols, a
 * small table), and in a concept card it goes **into the card's depth** (`card_attach`), extending
 * or replacing one item, never as a new block beside the card. The two outputs stand.
 */
/**
 * **What the note is, decided by what the exchange uncovered** (`notebooks.md` §4.2, amended
 * 2026-10-02). On the first research paper the learner asked how fine-tuning works; two thirds of
 * Ellie's answer explained what the notes took for granted, and the 25-word line kept the paper's
 * recipe instead, so the notes never showed the gap that was filled. Lucas: the filled gap should
 * be *"evidenced in the doc, so that user can revise"*.
 *
 *  - `background`: the notes assume something they never explain, and Ellie explained it;
 *  - `detail`: the source gives specifics the notes skip, and the answer brought them out;
 *  - `point`: otherwise, the one sentence most worth keeping (the 1 Oct line).
 */
export type NoteKind = 'background' | 'detail' | 'point';
export const NOTE_KINDS: readonly NoteKind[] = ['background', 'detail', 'point'];

/**
 * **One ceiling for every kind: about 120 words** (`notebooks.md` §11.2, amended 2026-10-06). On the
 * MDP study day the learner twice removed Ellie's short line and pasted her full chat answer in its
 * place, and 63% of the words marked as his were her chat answers copied in by hand. The 25-word
 * line and the 90/50/25 limits of 2 Oct are replaced by one addition of at most
 * `CARD_ADDITION_MAX_WORDS`, maths not counted. The kind still decides *what* the note adds.
 */
export const NOTE_MAX_WORDS: Record<NoteKind, number> = {
  background: CARD_ADDITION_MAX_WORDS,
  detail: CARD_ADDITION_MAX_WORDS,
  point: CARD_ADDITION_MAX_WORDS,
};

/**
 * Provenance for a background note (§3.4). Not "the source assumes": on the first paper's run two of
 * three background notes explained what the paper itself covers a page or two away, so the claim
 * the reason makes has to be one that is true either way.
 */
export const BACKGROUND_REASON = 'background Ellie added';

/** The forms a note may take (§11.2: "a list, a formula or a table allowed"). */
export const NOTE_FORMS = ['paragraph', 'bullets', 'numbers', 'math', 'table'] as const;
export type NoteForm = (typeof NOTE_FORMS)[number];

export const BLOCK_NOTE_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['note_kind', 'why'],
  additionalProperties: false,
  properties: {
    note_kind: {
      type: 'string',
      enum: [...NOTE_KINDS],
      description: 'background, detail or point: what the exchange uncovered.',
    },
    blocks: {
      type: 'array',
      description: `The note, as one to four blocks, at most ${CARD_ADDITION_MAX_WORDS} words in all (formulas not counted).`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['form'],
        properties: {
          form: { type: 'string', enum: [...NOTE_FORMS] },
          text: { type: 'string', description: 'paragraph: the text; table: its caption.' },
          items: { type: 'array', items: { type: 'string' }, description: 'bullets and numbers: one string per item.' },
          tex: { type: 'string', description: 'math: the display formula as TeX, without $ delimiters.' },
          columns: { type: 'array', items: { type: 'string' }, description: 'table: 2 to 6 column headings.' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table: one array of cells per row.' },
        },
      },
    },
    line: {
      type: ['string', 'null'],
      description: 'Only when no `blocks` are given: the note as one plain paragraph, or null for no note.',
    },
    role: {
      type: 'string',
      enum: [...CONCEPT_ROLES],
      description: 'Only when the block is in a concept card: the depth item the note belongs in.',
    },
    mode: {
      type: 'string',
      enum: ['extend', 'replace'],
      description: 'Only in a card: extend that item (the default), or replace it with a better one.',
    },
    anchor_block_id: {
      type: ['string', 'null'],
      description: 'Only when no block was given: the block id from the outline the note belongs under, or null.',
    },
    why: { type: 'string', description: 'One short sentence, for the log and the Remove · Keep tooltip.' },
  },
};

/** What the line is about: the two block actions, or an answer in the doc chat. */
export type BlockNoteKind = 'explain' | 'example' | 'answer';

export interface BlockNoteInput {
  kind: BlockNoteKind;
  /** Ellie's chat reply, verbatim: the substance the line is distilled from. */
  answer: string;
  /**
   * The block the line goes under. A block action and a span thread always have one; a plain
   * doc-chat question has none, and then the planner picks one from the outline, or none.
   */
  blockId: string | null;
  /** What the learner asked, on a doc-chat answer. */
  question?: string | null;
  /** The slide text of the block's pages, resolved by main. */
  passage?: string | null;
  page?: number | null;
  outline: readonly OutlineEntry[];
  /** The deck's (notebook's) page count, so a citation outside it is dropped. */
  pageCount?: number;
  /**
   * **Max's question is open** (2026-10-06 afternoon, decision 6): the note must not hold its
   * answer. `keyPoints` is its hidden key when it has one; a note that states a point is held back
   * (`held`), checked in code (`core/answerguard.ts`).
   */
  openQuestion?: { text: string; keyPoints: readonly string[] } | null;
}

export type BlockNoteOutcome =
  /** Written as the model gave it. */
  | 'written'
  /** Over the limit twice, and cut to the last full clause within it. */
  | 'trimmed'
  /** The model's line could not be had; the first sentence of the chat answer that could stand in notes was used. */
  | 'fallback'
  /** A doc-chat answer, and nothing in the outline fits: no line, which is allowed there. */
  | 'declined'
  /** No block to put it under, or nothing usable at all. */
  | 'none'
  /** It stated part of the answer to Max's open question, so nothing was written (decision 6). */
  | 'held';

const WHAT_HAPPENED: Record<BlockNoteKind, string> = {
  explain: 'Ellie has just explained this block in the chat.',
  example:
    'Ellie has just worked an example of this block in the chat. Unless it uncovered a gap, its note is **the example in brief**, as a detail: what the case is and what it shows, with its numbers.',
  answer: 'The learner asked a question in the chat and Ellie answered it there in full.',
};

/**
 * **The card a note goes into** (§11.2, amended 2026-10-06), read off the outline: the card's own
 * row and the rows of its depth items. `docOutlineNear` always carries the whole of the anchor's
 * card, so this is complete whenever the anchor is in one. Null outside a card.
 */
export interface NoteCard {
  cardId: string;
  term: string;
  items: { blockId: string; role: ConceptRole; text: string; learnerText: boolean }[];
  /** The role of the item the anchor is in, when it is in one. */
  anchorRole: ConceptRole | null;
}

export function noteCard(outline: readonly OutlineEntry[], anchorBlockId: string | null): NoteCard | null {
  if (anchorBlockId === null) return null;
  const anchor = outline.find((e) => e.blockId === anchorBlockId);
  const cardId = anchor?.cardId;
  if (!cardId) return null;
  const card = outline.find((e) => e.blockId === cardId);
  const items = outline
    .filter((e) => e.cardId === cardId && e.kind === 'concept_item' && e.role !== undefined)
    .map((e) => ({ blockId: e.blockId, role: e.role!, text: e.text, learnerText: e.learnerText }));
  return {
    cardId,
    term: (card?.text ?? '').split(':')[0]!.trim(),
    items,
    anchorRole: anchor?.role ?? null,
  };
}

/** The role a note goes into when the model names none: where it was asked, else by the action. */
function defaultRole(kind: BlockNoteKind, card: NoteCard): ConceptRole {
  if (card.anchorRole) return card.anchorRole;
  return kind === 'example' ? 'example' : kind === 'explain' ? 'intuition' : 'note';
}

export function blockNotePrompt(input: BlockNoteInput, retry?: { line: string; words: number; max: number }): string {
  const block = input.blockId === null ? null : (input.outline.find((e) => e.blockId === input.blockId) ?? null);
  const card = noteCard(input.outline, input.blockId);
  const lines = [
    `You are adding ONE note to the learner’s notes. ${WHAT_HAPPENED[input.kind]} The chat keeps the full`,
    'answer; the notes keep what the learner will need when they revise from them weeks later.',
    'You answer with the JSON object alone — no prose, no fence.',
  ];
  if (input.blockId !== null) {
    lines.push(
      '',
      card ? `THE BLOCK IT WAS ASKED ON (${input.blockId})` : `THE BLOCK IT GOES DIRECTLY UNDER (${input.blockId})`,
      '"""',
      block?.text ?? '(not in the outline)',
      '"""',
    );
  }
  if (card) {
    lines.push(
      '',
      `THE CONCEPT CARD IT GOES INTO (“${card.term}”). The notes are concept cards: a core line, and a`,
      'depth folded under it in this order: intuition, equation (a formula and a "where" list), steps,',
      'example, table, figure, result, pitfall, note. Your note goes INTO this card’s depth. It now holds:',
      ...(card.items.length > 0
        ? card.items.map((i) => `- ${i.role}${i.learnerText ? ' (the learner wrote in this item)' : ''}: ${i.text}`)
        : ['- (nothing yet: the core line only)']),
      '',
      'Set `role` to the item it belongs in. `mode` "extend" adds it at the end of that item (or starts',
      'the item when the card has none); "replace" swaps the item for yours, only when yours says',
      'everything the item says, better. An item the learner wrote in is never replaced.',
      'Never repeat what the card already says: add what it lacks.',
    );
  }
  lines.push('', 'THE NOTES AROUND IT', outlineText(input.outline));
  if (input.passage && input.passage.trim().length > 0) {
    const where = typeof input.page === 'number' ? ` (p. ${input.page})` : '';
    lines.push('', `THE SOURCE PAGE${where}`, '"""', input.passage.trim().slice(0, ANSWER_EDIT_PASSAGE_CHARS), '"""');
  }
  if (input.question && input.question.trim().length > 0) {
    lines.push('', 'WHAT THEY ASKED', '"""', input.question.trim(), '"""');
  }
  if (input.openQuestion && input.openQuestion.text.trim().length > 0) {
    lines.push(
      '',
      'MAX HAS A QUESTION OPEN FOR THE LEARNER, AND ITS ANSWER IS THEIRS TO FIND',
      '"""',
      input.openQuestion.text.trim().slice(0, 600),
      '"""',
      'The note must not hold its answer or any piece of it, in any wording. Note the idea Ellie',
      'explained, not the answer to that question.',
    );
  }
  lines.push(
    '',
    'WHAT ELLIE SAID IN THE CHAT',
    '"""',
    input.answer.trim(),
    '"""',
    '',
    'WHAT KIND OF NOTE: decide from what this exchange uncovered, in this order.',
    '- **background**: the question or the answer shows the notes assume something they never explain',
    '  (a term, a method, a prerequisite), and Ellie explained it. Write that explanation as a',
    '  self-contained note: what it is and how it works, so that someone revising who still lacks the',
    '  background can follow the notes. Take it from what Ellie said, not from your own knowledge. If',
    '  the learner asked what something is, or how it works "in general", this is the kind.',
    '- **detail**: the source gives specifics the notes skip, and the answer brought them out (an',
    '  equation and what its terms are, settings, numbers, the steps of a method, a worked case).',
    '  Write the specifics themselves, not a sentence about them.',
    '- **point**: otherwise, the point most worth keeping, in a sentence or two.',
    'Never restate the block or the notes around it: what the notes already say is not the note.',
    '',
    'HOW IT READS',
    `- At most ${CARD_ADDITION_MAX_WORDS} words in all, formulas not counted. It is counted, and a longer note is cut.`,
    '  Use what the substance needs: most notes are 30 to 80 words.',
    '- Its shape follows its content (`blocks`): a paragraph; a list (`bullets`, or `numbers` for',
    '  steps); a formula as its own `math` block followed by a list giving each symbol in English; a',
    '  small `table` for a comparison. Up to four blocks.',
    '- It stands in the notes on its own, read weeks later: no "as I said", "as above", "here" or',
    '  "this example"; no second person; no question; no mention of Ellie, Max, the chat or the learner.',
    '- No page citation in it (the notes show the page beside it), no heading.',
    '- Maths is typeset: write a symbol or a short formula as TeX between single dollars, inline in the',
    '  sentence (`$h_{\\max}$`, `$U(s) = R(s) + \\gamma \\max_a Q(s,a)$`); a longer one as a `math` block.',
    '- Open with the substance itself, not a stock opener ("In summary,", "Note that", "Key point:").',
  );
  if (input.blockId === null) {
    lines.push(
      '',
      'No block was named. Put the id of the block in the outline the note belongs directly under in',
      '`anchor_block_id`. If nothing in the outline is about what was asked, answer',
      '`{"blocks": [], "line": null, "anchor_block_id": null, "why": "…"}`: a note is optional here, and',
      'one filed under the wrong block is worse than none. A block marked "(the learner wrote in this',
      'block)" may be chosen; the note goes after it and never changes it.',
    );
  }
  if (retry) {
    lines.push(
      '',
      `YOUR LAST NOTE WAS ${retry.words} WORDS, OVER ITS LIMIT OF ${retry.max}:`,
      '"""',
      retry.line,
      '"""',
      `Write it again, same kind, in at most ${retry.max} words. Keep the substance; drop the rest.`,
    );
  }
  return lines.join('\n');
}

/** Page markers the model was told not to write, taken out: the chip says it. */
function stripPageMarkers(text: string): string {
  return text
    .replace(/\s*[([]\s*pp?\.\s*\d{1,4}(?:\s*[–\-—]\s*\d{1,4})?\s*[)\]]/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/**
 * **Cut a line to `max` words at the last full clause, never mid-word** (`notebooks.md` §4.2).
 *
 * Words are counted the way the rest of the room counts them (`timer.wordCount`: a token with a
 * letter or a digit). A clause ends at `,` `;` `:` `.` `!` `?` or before a dash. A clause cut that
 * would leave fewer than a third of the budget is a fragment rather than a line, so the cut then
 * falls at the last whole word within the limit and says so with an ellipsis.
 */
export function trimToWords(line: string, max: number = BLOCK_LINE_MAX_WORDS): string {
  const text = line.trim().replace(/\s+/g, ' ');
  if (wordCount(text) <= max) return text;
  const tokens = text.split(' ');
  let counted = 0;
  let lastWithin = -1;
  let clauseEnd = -1;
  let clauseWords = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (/[a-z0-9]/i.test(token)) counted += 1;
    if (counted > max) break;
    lastWithin = i;
    const next = tokens[i + 1] ?? '';
    if (/[,;:.!?]["”’)]*$/.test(token) || /^[—–-]+$/.test(next)) {
      clauseEnd = i;
      clauseWords = counted;
    }
  }
  if (clauseEnd >= 0 && clauseWords >= Math.ceil(max / 3)) {
    const kept = tokens.slice(0, clauseEnd + 1).join(' ').replace(/[,;:—–-]+$/, '').trim();
    return /[.!?]["”’)]*$/.test(kept) ? kept : `${kept}.`;
  }
  const kept = tokens.slice(0, lastWithin + 1).join(' ').replace(/[,;:—–-]+$/, '').trim();
  return `${kept}…`;
}

/** The first sentence of a turn that could stand in notes, cut to the limit. Empty when there is none. */
export function fallbackNoteLine(answer: string): string {
  const kept = notesFromTurn(answer);
  if (kept.length === 0) return '';
  const first = kept.split(/(?<=[.!?])\s+(?=[A-Z*`$“"(])/)[0] ?? '';
  return first.trim().length === 0 ? '' : trimToWords(stripPageMarkers(first));
}

/**
 * Read a reply's paragraph, or null when there is no usable one (absent, empty, a question). A
 * background or detail note of several sentences may mention a question mark in passing; only a
 * point is refused for carrying one.
 */
function readLine(raw: unknown, kind: NoteKind = 'point'): string | null {
  if (typeof raw !== 'string') return null;
  const line = stripPageMarkers(raw.replace(/\s+/g, ' ').trim());
  if (line.length === 0) return null;
  if (kind === 'point' ? line.includes('?') : /\?\s*$/.test(line)) return null;
  return line;
}

/** Words of a note as the ceiling counts them: prose only, formulas out (§11.2). */
export function noteWords(blocks: readonly DocBlockDraft[]): number {
  const count = (t: string): number => wordCount(t.replace(/\$[^$]*\$/g, ' '));
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'paragraph') n += count(b.text);
    else if (b.kind === 'bullets' || b.kind === 'numbers') n += b.items.reduce((m, i) => m + count(i), 0);
    else if (b.kind === 'table') n += count([b.caption ?? '', ...b.columns, ...b.rows.flatMap((r) => r.cells)].join(' '));
  }
  return n;
}

/**
 * **A reply's note, as blocks** (§11.2): its `blocks` in the forms allowed, each checked, or its
 * `line` as one paragraph. A table goes through the shared table gate; a paragraph that is a
 * question is not a note. At most four blocks. `prov` is a placeholder the caller replaces.
 */
function readNote(parsed: Record<string, unknown>, kind: NoteKind): DocBlockDraft[] {
  const prov: Provenance = { pages: [], reason: 'pending' };
  const out: DocBlockDraft[] = [];
  const raw = Array.isArray(parsed.blocks) ? (parsed.blocks as unknown[]) : [];
  for (const item of raw) {
    if (out.length === 4) break;
    const b = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    if (!b) continue;
    const strings = (v: unknown): string[] =>
      (Array.isArray(v) ? v : []).map((s) => (typeof s === 'string' ? stripPageMarkers(s.replace(/\s+/g, ' ').trim()) : '')).filter((s) => s.length > 0);
    switch (b.form) {
      case 'paragraph': {
        const text = readLine(b.text, kind === 'point' && raw.length === 1 ? 'point' : 'detail');
        if (text) out.push({ kind: 'paragraph', text, prov });
        break;
      }
      case 'bullets':
      case 'numbers': {
        const items = strings(b.items);
        if (items.length > 0) out.push({ kind: b.form, items, prov });
        break;
      }
      case 'math': {
        const tex = typeof b.tex === 'string' ? b.tex.trim().replace(/^\$\$?|\$\$?$/g, '').trim() : '';
        if (tex.length > 0) out.push({ kind: 'math', tex, prov });
        break;
      }
      case 'table': {
        const { draft } = validateTableDraft({ caption: b.text ?? null, columns: b.columns, rows: b.rows }, Number.MAX_SAFE_INTEGER, { pages: [], reason: 'pending' });
        if (draft) out.push(draft);
        break;
      }
      default:
        break;
    }
  }
  if (out.length > 0) return out;
  const line = readLine(parsed.line, kind);
  return line === null ? [] : [{ kind: 'paragraph', text: line, prov }];
}

/** The note cut to `max` words: trailing blocks go first, then a lone paragraph or list is trimmed. */
function cutNote(blocks: DocBlockDraft[], max: number): DocBlockDraft[] {
  let out = [...blocks];
  while (out.length > 1 && noteWords(out) > max) out = out.slice(0, -1);
  if (noteWords(out) <= max) return out;
  const only = out[0]!;
  if (only.kind === 'paragraph') return [{ ...only, text: trimToWords(only.text, max) }];
  if (only.kind === 'bullets' || only.kind === 'numbers') {
    const items: string[] = [];
    for (const item of only.items) {
      if (noteWords([{ ...only, items: [...items, item] }]) > max) break;
      items.push(item);
    }
    return [{ ...only, items: items.length > 0 ? items : [trimToWords(only.items[0]!, max)] }];
  }
  return out;
}

/** A note on one line, for the retry prompt and the log. */
function noteText(blocks: readonly DocBlockDraft[]): string {
  return blocks
    .map((b) =>
      b.kind === 'paragraph' ? b.text : b.kind === 'bullets' || b.kind === 'numbers' ? b.items.join(' · ') : b.kind === 'math' ? `$$${b.tex}$$` : b.kind === 'table' ? b.columns.join(' | ') : '',
    )
    .join(' ');
}

/**
 * **The note, as a batch** (`notebooks.md` §4.2, and §11.2 as amended 2026-10-06). Never throws: a
 * call that fails, or a reply that cannot be read, falls back on a block action to the first
 * sentence of the chat answer that could stand in notes (`notesFromTurn`'s filter), because the
 * learner pressed a button that promised a note; on a doc-chat answer it writes nothing, which the
 * brief allows there.
 *
 * **In a concept card the note goes into the card** (`card_attach`): into the item the model names
 * (or, when it names none, the item the block is in, else intuition for Explain, example for
 * Example, a note for an answer), extending it or, when the model says its version is better,
 * replacing it; the op itself holds a replace of learner-written text to an extend. Outside a card
 * (a paper's overview, a map, the learner's own blocks) it goes under the block, as before, but in
 * the same richer forms.
 *
 * Provenance, in order: the pages the note itself cites, else the block's own pages, else the
 * pages the chat answer cited, else a reason — never neither (§3.4).
 */
export async function planBlockNote(
  deps: DocEditDeps,
  input: BlockNoteInput,
): Promise<{ batch: AgentDocOpBatch | null; outcome: BlockNoteOutcome; words: number; retried: boolean; noteKind: NoteKind; card: boolean }> {
  const actionOnBlock = input.kind !== 'answer' && input.blockId !== null;
  const ask = async (retry?: { line: string; words: number; max: number }) => {
    const request: LlmRequest = {
      model: deps.model,
      max_tokens: 1_500,
      system: [{ type: 'text', text: blockNotePrompt(input, retry) }],
      messages: [{ role: 'user', content: 'Answer with the JSON object.' }],
      jsonSchema: BLOCK_NOTE_SCHEMA,
      meta: { ...docEditMeta(deps), scriptCue: `block_note:${input.kind}` },
    };
    const result = await deps.llm.complete(request);
    return JSON.parse(extractJson(result.text)) as Record<string, unknown>;
  };

  let parsed: Record<string, unknown> | null = null;
  let blocks: DocBlockDraft[] = [];
  let outcome: BlockNoteOutcome = 'written';
  let retried = false;
  let noteKind: NoteKind = 'point';
  try {
    parsed = await ask();
    noteKind = NOTE_KINDS.includes(parsed.note_kind as NoteKind) ? (parsed.note_kind as NoteKind) : 'point';
    const max = NOTE_MAX_WORDS[noteKind];
    blocks = readNote(parsed, noteKind);
    if (blocks.length > 0 && noteWords(blocks) > max) {
      retried = true;
      const first = blocks;
      try {
        const again = await ask({ line: noteText(first), words: noteWords(first), max });
        const next = readNote(again, noteKind);
        blocks = next.length > 0 ? next : first;
      } catch {
        blocks = first;
      }
      if (noteWords(blocks) > max) {
        blocks = cutNote(blocks, max);
        outcome = 'trimmed';
      }
    }
  } catch {
    parsed = null;
    blocks = [];
  }

  // The anchor: the block that was named, or the planner's pick from the outline for a doc-chat
  // question that named none. A pick that is not in the outline is not trusted.
  const picked = typeof parsed?.anchor_block_id === 'string' ? parsed.anchor_block_id : null;
  const anchorBlockId =
    input.blockId ?? underHeading(deps, picked !== null && input.outline.some((e) => e.blockId === picked) ? picked : null, input.outline);

  if (blocks.length === 0) {
    if (!actionOnBlock) return { batch: null, outcome: parsed === null ? 'none' : 'declined', words: 0, retried, noteKind, card: false };
    const line = fallbackNoteLine(input.answer);
    outcome = 'fallback';
    noteKind = 'point';
    if (line.length === 0) return { batch: null, outcome: 'none', words: 0, retried, noteKind, card: false };
    blocks = [{ kind: 'paragraph', text: line, prov: { pages: [], reason: 'pending' } }];
  }
  if (anchorBlockId === null) return { batch: null, outcome: input.blockId === null ? 'declined' : 'none', words: 0, retried, noteKind, card: false };
  // Decision 6: a note that states the open question's answer is not written, button or not.
  const key = input.openQuestion?.keyPoints ?? [];
  if (key.length > 0 && answerLeaks(noteText(blocks), key).length > 0) {
    return { batch: null, outcome: 'held', words: noteWords(blocks), retried, noteKind, card: false };
  }

  const cited = JSON.stringify(parsed?.blocks ?? '') + (typeof parsed?.line === 'string' ? parsed.line : '');
  const own = pagesCited(cited, input.pageCount);
  const blockPages = input.outline.find((e) => e.blockId === anchorBlockId)?.pages ?? [];
  const answerPages = pagesCited(input.answer, input.pageCount);
  // A background note is Ellie's explanation rather than the source's text, so it is not cited to
  // the source's pages unless it names one itself: the reason says where it came from (§3.4).
  const prov: Provenance =
    own.length > 0
      ? { pages: own, reason: null }
      : noteKind === 'background'
        ? { pages: [], reason: BACKGROUND_REASON }
        : blockPages.length > 0
        ? { pages: [...blockPages], reason: null }
        : answerPages.length > 0
          ? { pages: answerPages, reason: null }
          : { pages: [], reason: input.kind === 'example' ? 'an example Ellie gave' : 'a point Ellie added from her answer' };
  const drafts = blocks.map((b) => ({ ...b, prov }) as DocBlockDraft);
  const why =
    typeof parsed?.why === 'string' && parsed.why.trim().length > 0
      ? parsed.why.trim()
      : input.kind === 'example'
        ? 'Ellie added the example in brief.'
        : 'Ellie added the point most worth keeping.';

  const card = noteCard(input.outline, anchorBlockId);
  const op: AgentDocOp = card
    ? {
        op: 'card_attach',
        cardBlockId: card.cardId,
        role: (CONCEPT_ROLES as readonly unknown[]).includes(parsed?.role) ? (parsed!.role as ConceptRole) : defaultRole(input.kind, card),
        mode: parsed?.mode === 'replace' ? 'replace' : 'extend',
        blocks: drafts,
        prov,
      }
    : { op: 'insert_after', anchorBlockId, blocks: drafts };
  return {
    batch: {
      editId: deps.newId('edit'),
      author: 'ellie',
      cause: 'block_action',
      ops: [op],
      focusBlockId: anchorBlockId,
      why,
    },
    outcome,
    words: noteWords(blocks),
    retried,
    noteKind,
    card: card !== null,
  };
}

/**
 * **A line is never filed between a heading and what it heads.** A doc-chat question with no
 * page is planned against the table of contents (`docOutlineNear` with no anchor), so the planner
 * often picks a section's heading, and the line went in straight under the H2, above the
 * section's takeaway (live run, 1 Oct 2026: "Added one line under that heading."). On an
 * overview the takeaway is the line that says what the section is (C6), so the line goes under
 * the first block of the section instead. A heading with nothing under it, or another heading
 * next, keeps the pick.
 */
function underHeading(deps: DocEditDeps, picked: string | null, outline: readonly OutlineEntry[]): string | null {
  if (picked === null) return null;
  if (outline.find((e) => e.blockId === picked)?.kind !== 'heading') return picked;
  const near = deps.docPort.outlineNear({ blockId: picked }, 1);
  const at = near.findIndex((e) => e.blockId === picked);
  const next = at >= 0 ? near[at + 1] : undefined;
  return next && next.kind !== 'heading' && next.questionId === null ? next.blockId : picked;
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
        prov: questionProvenance(deps, input.text, input.blockId, input.pageCount),
      },
    ],
    focusBlockId: anchorBlockId,
    why: 'Max asked a question about this part of the notes.',
  };
}

/**
 * The Q block's provenance: the pages Max's question cites, or else **the pages of the block it
 * was asked on**. Quiz me (`notebooks.md` §4.1) asks about one line, and the question rarely
 * repeats that line's page ("In your own words, what does REACH(s,h) contain?"), so on its text
 * alone the block read "added: a question Max asked about this part of the notes" with no page,
 * under a line cited to p. 38 (live run, 1 Oct 2026). The line's pages are what the question is
 * about, so they are honest provenance; a question with neither still carries the reason.
 */
function questionProvenance(deps: DocEditDeps, text: string, blockId: string | null, pageCount?: number): Provenance {
  const own = provenanceFor(text, 'a question Max asked about this part of the notes', pageCount);
  if (own.pages.length > 0 || blockId === null) return own;
  const pages = deps.docPort.outlineNear({ blockId }, 0).find((e) => e.blockId === blockId)?.pages ?? [];
  return pages.length > 0 ? { pages: [...pages], reason: null } : own;
}

/**
 * **The block a doc edit went to**: the card it was attached to, or the block it was placed by or
 * changed. A question asked in the doc chat has no block of its own, so this is where it is filed
 * for readiness (decision 8 of 6 Oct afternoon, #67). Null for a batch with no such op.
 */
export function noteAnchorOf(batch: AgentDocOpBatch): string | null {
  for (const op of batch.ops) {
    switch (op.op) {
      case 'card_attach':
        return op.cardBlockId;
      case 'insert_after':
      case 'insert_before':
        return op.anchorBlockId;
      case 'replace_block':
      case 'append_to_block':
        return op.blockId;
      default:
        break;
    }
  }
  return null;
}

// ── 5.3: the closed question, with its answer under it ──────────────────────

/**
 * **The resolution, as a batch.** `learnerAnswer` is the learner's own answer on *you got this*,
 * which `ops.ts` writes in their author mark (`types.ts`, the `resolve_q` op). `text` and `math`
 * are what would go under the question in Max's colour; since 2026-10-06 (D4) the actor passes
 * neither, and a question closes into its chip with the learner's answer or with nothing.
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
    /**
     * On *you got this*: Max's one sentence for the chip (decision 12 of 6 Oct afternoon, #67),
     * already checked by `core/chipnote.ts`. Kept off any other resolution.
     */
    maxNote?: string | null;
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
  const maxNote = input.resolution === 'you_got_this' && input.maxNote?.trim() ? input.maxNote.trim() : null;
  return {
    editId: deps.newId('edit'),
    author: 'max',
    cause: 'q_resolved',
    ops: [
      {
        op: 'resolve_q',
        questionId: input.questionId,
        resolution: input.resolution,
        blocks,
        learnerAnswer,
        ...(maxNote !== null ? { maxNote } : {}),
      },
    ],
    focusBlockId: null,
    why:
      input.resolution === 'you_got_this'
        ? 'You answered this one; your answer is kept with the question.'
        : input.resolution === 'recall'
          ? 'You recalled the term; your answer is kept with the question.'
          : 'This one is marked to revisit; the answer is in the chat.',
  };
}

/**
 * **The sentences of a turn that could stand in notes.** Code, and conservative on purpose: it keeps
 * only the sentences of an agent's turn that could stand in notes — no verdict opener, nothing in the
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
