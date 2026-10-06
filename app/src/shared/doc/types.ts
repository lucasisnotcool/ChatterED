/**
 * **The collaborative notes doc — the shared contract** (`docs/research/collab-doc.md`, #48).
 *
 * Types only, and it imports nothing but types, so `src/main`, `src/room` and the renderer can all
 * use it. The ProseMirror side (schema, ops, guard, suggestions, validation) lives in the sibling
 * modules and may import `prosemirror-*`; this file may not.
 *
 * **Frozen after day 0.** Five tracks build against these shapes in parallel. A change here goes
 * through the lead as one batched edit — see `app/docs/COLLAB-CONTRACT.md`.
 */

import type { FlowQuizView } from '../types.js';
import type { OwnWordsShares } from '../../core/ownwords.js';
import type { QuestionForm } from '../../core/pitch.js';

// ── who wrote what ──────────────────────────────────────────────────────────────────────────

/** The `author` mark's `by`. `ingest` is the two-pass notes ingest; `user` is the learner. */
export type DocAuthor = 'ingest' | 'ellie' | 'max' | 'user';
export type AgentAuthor = 'ellie' | 'max';

/** The doc chat's `anchorId`. A thread id IS a `messages.anchor_id` — there is no second key. */
export const DOC_ANCHOR_ID = 'doc';
export type ThreadKind = 'doc' | 'span' | 'private';

/** Span threads are `span_<12 hex>`. */
export const SPAN_THREAD_PREFIX = 'span_';

// ── provenance ──────────────────────────────────────────────────────────────────────────────

/**
 * Mandatory on every block (brief §2): the pages it came from, or the reason it is here when no
 * slide says it, or both. **Neither ⇒ the block is rejected by validation.**
 */
export interface Provenance {
  /**
   * 1-based page numbers of the source deck. In a notebook (`docs/research/notebooks.md`) these
   * are **notebook pages**: the sources laid end to end at their fixed bases
   * (`shared/notebook.ts` `locatePage` turns one back into a source and its own page).
   */
  pages: number[];
  reason: string | null;
}

/** A region of a page. Normalised 0–1, y **down** from the page top (as `vault/geometry.ts`). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ── what a model writes ─────────────────────────────────────────────────────────────────────

/**
 * What the ingest and the doc-edit call produce. Turned into ProseMirror nodes by `ops.ts`
 * (`draftToNodes`) and `validate.ts` (`draftsToDocJson`); a model is never shown or asked for
 * ProseMirror JSON.
 *
 * `text` and `items[]` use the closed inline subset of `renderer/lib/aitext.ts`: `**bold**`,
 * `*em*`, `` `code` `` and `$tex$`. Nothing else is markup.
 */
export type DocBlockDraft =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; prov: Provenance }
  | { kind: 'paragraph'; text: string; prov: Provenance }
  | { kind: 'bullets' | 'numbers'; items: string[]; prov: Provenance }
  | { kind: 'code'; text: string; lang?: string; prov: Provenance }
  | { kind: 'math'; tex: string; prov: Provenance }
  /** An evidentiary slide or region, shown inline as a crop of the rendered page (brief §3). */
  | { kind: 'figure'; page: number; rect: Rect | null; caption: string; prov: Provenance }
  | TableDraft
  | DiagramDraft
  | FlashcardsDraft
  | QuizDraft
  | InfographicDraft
  | ConceptDraft;

// ── concept cards (2026-10-06, notebooks.md §11.2, decision D1) ─────────────────────

/**
 * **What one item of a card's depth is for**, and the order the depth is read in. A card's core
 * line is always visible; its depth is folded under it and opens in place, reading intuition →
 * equation (with its "where" list) → steps → example → table → figure → result → pitfall → note.
 *
 *  - `intuition` and `pitfall` are never on the slides: they always carry a `reason` (§3.4).
 *  - `equation` is a math block followed by a "where" list, one symbol per line.
 *  - `steps` is an algorithm as a numbered list; `table` a comparison the slide draws.
 *  - `figure` is a slide image (a crop of the page), for a concept whose slide is mostly a figure.
 *  - `result` is a result the deck relies on whose proof the notes leave out (an appendix proof).
 *  - `note` is anything else, and what an agent's addition is filed as when nothing else fits.
 */
export type ConceptRole =
  | 'intuition'
  | 'equation'
  | 'steps'
  | 'example'
  | 'table'
  | 'figure'
  | 'result'
  | 'pitfall'
  | 'note';

export const CONCEPT_ROLES: readonly ConceptRole[] = [
  'intuition',
  'equation',
  'steps',
  'example',
  'table',
  'figure',
  'result',
  'pitfall',
  'note',
];

/** One item of a card's depth: blocks of the ordinary kinds (never another card), with provenance. */
export interface ConceptItemDraft {
  role: ConceptRole;
  blocks: DocBlockDraft[];
  prov: Provenance;
}

/**
 * **A concept card** (D1): one per idea, not one per slide. `term` is the idea's name (what the
 * outline, the search index and a self-check chip call it); `core` is the always-visible line,
 * the term in bold and a one-sentence definition; `depth` is folded under it.
 */
export interface ConceptDraft {
  kind: 'concept';
  term: string;
  core: string;
  depth: ConceptItemDraft[];
  prov: Provenance;
}

/**
 * A comparison table (2026-10-01). `columns` are the headings; every row has one cell per column.
 * Cell text is the inline subset. Checked by `validateTableDraft`, never by `validateDrafts`: the
 * ingest does not write tables.
 */
export interface TableDraft {
  kind: 'table';
  caption?: string | null;
  columns: string[];
  rows: { cells: string[]; pages?: number[] }[];
  prov: Provenance;
}

export type DiagramLayout = 'flow' | 'hierarchy' | 'compare' | 'cycle';

/** An edge between two diagram nodes, by their ids. Stored on the `diagram` node's `edges` attr. */
export interface DiagramEdge {
  from: string;
  to: string;
  label: string | null;
}

/**
 * An editable diagram (2026-10-01): labelled nodes and optional edges, laid out in code by the
 * renderer. `parent` is for `hierarchy`, `group` (the column heading a node sits under) for
 * `compare`. Checked by `validateDiagramDraft`.
 */
export interface DiagramDraft {
  kind: 'diagram';
  layout: DiagramLayout;
  title?: string | null;
  nodes: { id: string; label: string; parent?: string | null; group?: string | null; pages?: number[] }[];
  edges?: { from: string; to: string; label?: string | null }[];
  prov: Provenance;
}

export type InfographicLayout = 'timeline' | 'steps' | 'stats' | 'compare';
export type QuizQuestionType = 'mc' | 'short';

/**
 * A short deck of flashcards (2026-10-01, notebooks §5.3): a front and a back each, both real
 * editable text. The back is held until the learner flips the card (view chrome, never saved).
 * Checked by `validateFlashcardsDraft`; the ingest never writes one.
 */
export interface FlashcardsDraft {
  kind: 'flashcards';
  title?: string | null;
  cards: { front: string; back: string; pages?: number[] }[];
  prov: Provenance;
}

/**
 * A quiz of three to five questions. `mc` carries 3 to 4 `options`, exactly one `correct`;
 * `short` carries none. `explain` is the answer and why, held back until the learner answers.
 * Checked by `validateQuizDraft`.
 */
export interface QuizDraft {
  kind: 'quiz';
  title?: string | null;
  questions: {
    type: QuizQuestionType;
    prompt: string;
    options?: { text: string; correct: boolean }[];
    explain: string;
    pages?: number[];
  }[];
  prov: Provenance;
}

/**
 * A structured visual summary, as data: panels with an optional big `value` (a year, a number),
 * a heading and a body, rendered in code per `layout`. No image is ever generated (C9). Checked by
 * `validateInfographicDraft`.
 */
export interface InfographicDraft {
  kind: 'infographic';
  layout: InfographicLayout;
  title?: string | null;
  panels: { value?: string | null; heading: string; body: string; pages?: number[] }[];
  prov: Provenance;
}

/** A `flashcards` node read back (`flashcardsSpec`), sides as plain text. */
export interface FlashcardsSpec {
  title: string | null;
  cards: { front: string; back: string; pages: number[] }[];
}

/** A `quiz` node read back (`quizSpec`). `correct` is the index in `options`, or null for a `short` question. */
export interface QuizSpec {
  title: string | null;
  questions: {
    type: QuizQuestionType;
    prompt: string;
    options: string[];
    correct: number | null;
    explain: string;
    pages: number[];
  }[];
}

/** An `infographic` node read back (`infographicSpec`). */
export interface InfographicSpec {
  layout: InfographicLayout;
  title: string | null;
  panels: { value: string; heading: string; body: string; pages: number[] }[];
}

/** A `table` node read back as plain text (`tableGrid`). */
export interface TableGrid {
  caption: string | null;
  columns: string[];
  rows: string[][];
}

/** A `diagram` node read back (`diagramSpec`): what a layout needs, with labels as plain text. */
export interface DiagramSpec {
  layout: DiagramLayout;
  title: string | null;
  nodes: { id: string; label: string; parent: string | null; group: string | null; pages: number[] }[];
  edges: DiagramEdge[];
}

/** One line of the document as a prompt sees it. The only view of the doc a model is given. */
export interface OutlineEntry {
  blockId: string;
  kind: string;
  /** The headings above this block, outermost first. */
  path: string[];
  /** The block's text, truncated (`docOutline` decides how far). */
  text: string;
  pages: number[];
  /** True when any of the block's text carries `author.by === 'user'`. */
  learnerText: boolean;
  /** Set on a `q_block`. */
  questionId: string | null;
  /**
   * The concept card the block belongs to (D1, 2026-10-06): the card's own `blockId` on the card,
   * on its core line, on each depth item and on everything inside one. Absent outside a card.
   */
  cardId?: string;
  /** On a card's depth item, and on the blocks inside one: which item it is. */
  role?: ConceptRole;
}

// ── agent edits ─────────────────────────────────────────────────────────────────────────────

/**
 * How a Max question ended (brief §5.3). Shown on the resolved question's self-check chip.
 *
 * `revisit` (2026-10-06, D4): closed by a correct fill-in-the-blank. One recalled term is not an
 * answer the learner earned, so the chip says *revisit*, never *you got this*; the same chip label
 * goes on `partly_yours` and `released` (`collab-doc.md` §5.3, amended 2026-10-06).
 *
 * `recall` (6 Oct afternoon, decision 14 on #67; `notebooks.md` §11.10.6): a **correct**
 * fill-in-the-blank after a release. The chip shows the learner's answer with a small *recall*
 * tag; it fills no progress and is never called *revisit*. Workstream X1 owns when it is set
 * (`room/flow.ts`); the chip only draws it.
 */
export type QResolution = 'you_got_this' | 'partly_yours' | 'released' | 'revisit' | 'recall';

/**
 * **Agents address blocks, never offsets.** There is no position anywhere in this union, by
 * construction (brief §8).
 */
export type AgentDocOp =
  | { op: 'insert_after'; anchorBlockId: string; blocks: DocBlockDraft[] }
  | { op: 'insert_before'; anchorBlockId: string; blocks: DocBlockDraft[] }
  | { op: 'replace_block'; blockId: string; blocks: DocBlockDraft[] }
  | { op: 'append_to_block'; blockId: string; text: string }
  | { op: 'remove_block'; blockId: string }
  /** Max's question, written in as a Q block at the segment it is about (brief §5.2). */
  | {
      op: 'insert_q';
      anchorBlockId: string;
      questionId: string;
      objectiveId: string | null;
      text: string;
      prov: Provenance;
    }
  /**
   * The question's answer, written under the Q block (brief §5.3). The Q block stays.
   *
   * `learnerAnswer` (#49, additive): on *you got this*, the learner's own answer from the chat,
   * verbatim. It goes in **authored by them** — it is their words — so the guard protects it like
   * anything they typed, and it carries no `editId`, so Remove · Keep on Max's edit never touches
   * it. `blocks` is then at most Max's one-line completion. A second `resolve_q` on a question
   * already resolved is a no-op.
   */
  | {
      op: 'resolve_q';
      questionId: string;
      resolution: QResolution;
      blocks: DocBlockDraft[];
      learnerAnswer?: string | null;
      /**
       * **Max's one sentence for the chip** (6 Oct afternoon, decision 12 on #67;
       * `notebooks.md` §11.10.5), on *you got this* only: supplied by his *Well done* turn and
       * validated in code (`core/chipnote.ts`: one sentence, a word cap, nothing addressed to the
       * learner). Stored as the Q block's `maxNote` attribute, never as text, so it is never in
       * the learner's spans, the outline or the search index, and the chip draws it as his.
       */
      maxNote?: string | null;
    }
  /**
   * **An addition to a concept card's depth** (D1, 2026-10-06): Ellie as co-author. `extend` adds
   * the blocks at the end of the card's first item of that `role` (or makes the item, in reading
   * order, when the card has none); `replace` swaps that item for one holding the blocks. A
   * `replace` of an item the learner wrote in becomes an `extend`: their words stay (§5.4).
   */
  | {
      op: 'card_attach';
      cardBlockId: string;
      role: ConceptRole;
      mode: 'extend' | 'replace';
      blocks: DocBlockDraft[];
      prov: Provenance;
    };

export type DocEditCause =
  | 'answer_missing' // §5.1
  | 'q_block' // §5.2
  | 'q_resolved' // §5.3
  | 'whisper_insert' // §4.1 "insert into the document"
  | 'suggestion' // §5.4 — a conflict with learner text, re-expressed
  /**
   * `notebooks.md` §4.2: the one line (≤ `BLOCK_LINE_MAX_WORDS` words) Ellie writes under a
   * block beside an Explain or an Example, and after any doc-chat question. Migration 024.
   */
  | 'block_action';

export interface AgentDocOpBatch {
  editId: string;
  author: AgentAuthor;
  cause: DocEditCause;
  ops: AgentDocOp[];
  /** Where the doc should scroll if the learner is not typing. */
  focusBlockId: string | null;
  /** One sentence: for the log, and for the Remove · Keep control's tooltip. */
  why: string;
  /**
   * Only on `cause: 'suggestion'` that targets learner text directly (brief §6: Max's correction
   * of something the learner wrote in the doc). The renderer expresses it as `suggest_del` over
   * the quoted learner text and `suggest_ins` of `replacement`.
   */
  suggestion?: { blockId: string; quote: string; replacement: string; note: string; threadId: string | null };
}

export type DocEditStatus = 'applied' | 'kept' | 'removed' | 'dropped_frozen' | 'rejected_guard';

export interface DocEditRecord {
  editId: string;
  docId: string;
  author: AgentAuthor;
  cause: DocEditCause;
  ops: AgentDocOp[];
  status: DocEditStatus;
  /** Blocks the edit created or touched: what Remove undoes, and what the colour is on. */
  blockIds: string[];
  why: string;
  turnId: string | null;
  messageId: string | null;
  objectiveId: string | null;
  docVersion: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Suggestion {
  suggestionId: string;
  docId: string;
  editId: string;
  author: AgentAuthor;
  blockId: string;
  status: 'open' | 'accepted' | 'rejected';
  /** One sentence shown beside Accept · Reject. Never the whole correction. */
  note: string | null;
  /** The span thread the feedback lives in, when there is one (brief §6). */
  threadId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ── views over IPC ──────────────────────────────────────────────────────────────────────────

export type NotesIngestStatus = 'none' | 'pending' | 'streaming' | 'ready' | 'failed';

export interface NotesIngestView {
  status: NotesIngestStatus;
  windowsDone: number;
  windowsTotal: number;
  /** True when the refine pass is being given page images (brief §2), false for text + geometry. */
  withImages: boolean;
  error: string | null;
}

export interface NotesDocView {
  docId: string;
  fileId: string;
  contentSha: string;
  title: string;
  pageCount: number;
  version: number;
  /** ProseMirror JSON for `notesSchema`. */
  doc: unknown;
  ingest: NotesIngestView;
  frozen: boolean;
  /** Status `applied` only: the edits that still wear their colour. */
  edits: DocEditRecord[];
  /** Status `open` only. */
  suggestions: Suggestion[];
  /** The overview's metadata (`notebooks.md` §3, §5.3, §6). Null on a pre-024 doc. */
  overview: OverviewMeta | null;
}

// ── the learning overview (`docs/research/notebooks.md`, 2026-10-01) ──────────────────────────

/**
 * The longest a block action's one *line* may be (`notebooks.md` §4.2): the 1 Oct line, still the
 * ceiling on a `point` note and on Max's lines. Enforced in code.
 */
export const BLOCK_LINE_MAX_WORDS = 25;

/**
 * **The ceiling on one of Ellie's additions to the notes** (`notebooks.md` §4.2 as amended
 * 2026-10-06, D1): about 120 words, a list, a formula or a table allowed, in place of the one
 * plain 25-word line. Words of maths (a formula block) are not counted, as the slide-word budget
 * leaves them out. Enforced in code.
 */
export const CARD_ADDITION_MAX_WORDS = 120;

/**
 * **The learner's own-note slot under each overview section** (`notebooks.md` §3.1). An ordinary
 * empty `paragraph` whose `reason` is exactly this string and whose `pages` are the section's,
 * so typing in it maps to the section's objectives like any learner text. The renderer shows a
 * placeholder in it while it is empty and never draws a provenance chip on it. Not a new node:
 * the guard, the author marks and the doc-text path all work on it as they are.
 */
export const NOTE_SLOT_REASON = 'your note';

/**
 * **The overview's "By the end you can" heading and list** (contract C6). The list is cited to the
 * union of every objective's pages, so it is a table of contents for the file, not notes from
 * any one page: `blocksForPages` leaves it out, or it would be the first block of every objective.
 */
export const OBJECTIVES_REASON = 'objectives';

/** Every block type Ellie can generate on request (Insert, or a section's recommendation). */
export type GeneratedBlockKind = 'table' | 'diagram' | 'flashcards' | 'quiz' | 'infographic';

/** The four per-block actions (`notebooks.md` §4.1). `ask` never reaches main: it opens the composer. */
export type BlockActionKind = 'explain' | 'example' | 'quiz' | 'ask';

/**
 * **A section's recommended block** (`notebooks.md` §5.3): a card under the section naming the
 * type, a title, and one line of what it would hold, with Add. Written with the overview; costs
 * nothing until the learner adds it. Not document content: it lives in `OverviewMeta`.
 */
export interface OverviewRecommendation {
  /** Stable id, for marking it added or dismissed. */
  id: string;
  /** The section's heading block: the card is drawn at the end of that section. */
  headingBlockId: string;
  kind: GeneratedBlockKind;
  /** "Planning heuristics and abstractions". At most about 8 words. */
  title: string;
  /** "Active recall cards on h_max, h_add, h_FF…". One line. Sent as the generation instruction. */
  description: string;
  status: 'offered' | 'added' | 'dismissed';
}

export interface OverviewMeta {
  /** Bumped when the overview's shape changes, so the renderer can tell an old one. */
  version: number;
  /** `contextFingerprint` of the sources it was written from (`shared/notebook.ts`). */
  fingerprint: string;
  /** ISO time it was written. */
  writtenAt: string;
  /** Exactly three (`notebooks.md` §6, answer D), shown under Ellie's greeting. */
  starterQuestions: string[];
  /** Ellie's one-line greeting above them. */
  greeting: string;
  recommendations: OverviewRecommendation[];
  /** Words written against the computed budget (§3.2), for the log and the Usage page. */
  words: number;
  wordBudget: number;
  /** Which budget policy it was written under (§3.2, amended 2026-10-02). Absent before then. */
  genre?: 'slides' | 'prose';
  /**
   * `cards` for notes written as concept cards (D1, 2026-10-06); `map` (or absent) for the short
   * overview of key-idea bullets. A doc written as a map keeps rendering as one.
   */
  form?: 'map' | 'cards';
  /** On `cards`: words of the always-visible layer (title excluded), against `coreBudget` (§3.2). */
  coreWords?: number;
  coreBudget?: number;
}

export interface ThreadView {
  /** === `messages.anchor_id` for `doc` and `span`; the whisper thread id for `private`. */
  threadId: string;
  kind: ThreadKind;
  /** `span` only. */
  blockId: string | null;
  quote: string | null;
  /** `private` only: `'ellie' | 'max'`. */
  agentKey: AgentAuthor | null;
  messageIds: string[];
  lastSeenSeq: number;
  /** Max's open (or just-closed) question in this thread. One open question per file (§4.2). */
  quiz: DocQuizView | null;
  createdAt: string;
}

/** `FlowQuizView`, plus what the collab doc adds. */
export interface DocQuizView extends FlowQuizView {
  questionId: string;
  objectiveId: string | null;
  /** True once Ellie's cue has been given on this question (it fires once, §4.3). */
  cueGiven: boolean;
  /** How it ended, or null while open. */
  resolution: QResolution | null;
  open: boolean;
  /** `cloze` when the open question is a fill-in-the-blank (§4.5). Absent on an `open` one. */
  form?: QuestionForm;
}

/** One private turn. Private threads live in the `whispers` table, not in `messages`. */
export interface PrivateTurnView {
  id: string;
  role: 'learner' | 'agent';
  agentKey: AgentAuthor;
  text: string;
  createdAt: string;
  /** Set once "insert into the document" has been used on it. */
  insertedEditId: string | null;
}

/**
 * **Regenerate Notes** (2026-09-23). `confirmed` is the learner's answer to main's confirm sheet;
 * only then does the renderer re-send the page images and start the forced ingest. `refused:
 * 'busy'` is a deck still being written, where no sheet was shown.
 */
export interface NotesRegenerateResult {
  confirmed: boolean;
  refused: 'busy' | null;
  view: NotesDocView | null;
}

/** **New Conversation** (2026-09-23). `reset` is false when there was no room to reset. */
export interface ChatResetResult {
  confirmed: boolean;
  reset: boolean;
}

export interface ChatView {
  roomId: string | null;
  fileId: string;
  threads: ThreadView[];
}

// ── progress (brief §6) ─────────────────────────────────────────────────────────────────────

/** Max's verdict on a learner attempt. `not_yet` is new: "Not yet." fills nothing. */
export type QuizVerdict3 = 'complete' | 'partial' | 'not_yet';

export interface ProgressObjectiveView {
  objectiveId: string;
  title: string;
  statement: string;
  criteria: string[];
  pages: number[];
  /** The doc blocks that carry it (page intersection, plus any ingest hint). First = Start's target. */
  blockIds: string[];
  /**
   * 1 on a *Well done* on the learner's own words (chat or doc text); 0.5 on *Partly there*; else
   * 0. A released answer, Ellie's cue and agreement fill nothing. Derived by `progressFill()`.
   */
  fill: 0 | 0.5 | 1;
  /** The ledger's level, kept as the evidence record behind the fill. */
  level: 0 | 1 | 2 | 3;
  assumedByDeck: boolean;
  /** The learner's own sentence that earned the fill, verbatim, when there is one. */
  evidence: string | null;
  lastMovedAt: string | null;
  /**
   * **What the learner asked for on it since its last question closed** (2026-10-06, D2): Explain
   * and Example presses on its lines, from `objective_activity` (migration 030), which outlives a
   * room, so New Conversation keeps it. `since` is when that last question closed (its newest
   * outcome row), or null when none has. Half of `core/readiness`'s input; the renderer measures
   * the rest. Absent from a main built before this.
   */
  activity?: ObjectiveActivityView;
  /**
   * **The concept cards the objective covers, and which have a *Well done*** (6 Oct afternoon,
   * decision 9 on #67; `notebooks.md` §11.10.4). In document order. The objective is complete
   * only when every one is done (`topicFill`); until then it is partly done. Empty for an
   * objective whose blocks hold no card (a tutorial part's, a prose source's, an older doc's),
   * which fills as before. The readiness offer asks about the first card not yet done. Absent
   * from a main built before this.
   */
  cards?: ObjectiveCardView[];
}

/** One concept card an objective covers (decision 9). */
export interface ObjectiveCardView {
  cardId: string;
  term: string;
  /** An own-words *Well done* on a question about this card is on record. */
  done: boolean;
}

/**
 * One objective's Explain, Example and question count since its last question closed (D2;
 * questions to Ellie since 6 Oct afternoon, decision 8 on #67). `questions` is absent from a main
 * built before it.
 */
export interface ObjectiveActivityView {
  explains: number;
  examples: number;
  questions?: number;
  since: string | null;
}

/**
 * One Explain or Example press, or one question to Ellie answered on the section (decision 8),
 * filed against the objective of the line it was on (D2).
 */
export type ObjectiveActivityKind = 'explain' | 'example' | 'question';

export interface ObjectiveActivity {
  id: string;
  contentSha: string;
  roomId: string;
  objectiveId: string;
  kind: ObjectiveActivityKind;
  blockId: string | null;
  createdAt: string;
}

export interface ProgressView {
  fileId: string;
  docId: string | null;
  /** `none` until the objective tree has been derived from the slides. */
  status: 'none' | 'pending' | 'ready' | 'failed';
  completed: number;
  total: number;
  /** Sum of fills / total, 0–1: what the bar draws. */
  fraction: number;
  objectives: ProgressObjectiveView[];
}

/** One persisted outcome of a Max question (`quiz_outcomes`, migration 020). */
export interface QuizOutcome {
  id: string;
  contentSha: string;
  roomId: string;
  objectiveId: string | null;
  questionId: string;
  kind: 'verdict' | 'released';
  verdict: QuizVerdict3 | null;
  /** `give_up` | `pass` | `closure`, on `released`. */
  releasedBy: 'give_up' | 'pass' | 'closure' | null;
  /** The learner message (chat, or the synthetic `doc_text` message) the verdict was on. */
  messageId: string | null;
  source: 'chat' | 'doc_text';
  /**
   * **Which attempt at this question the verdict marked**, 1-based (migration 022,
   * `measurement.md` M2). `>= 2` is a revision, which is the second clause of the learning goal
   * and the one behaviour the observed sessions never produced (0 of 17 attempts was a second
   * try). `null` on rows written before 022, and on `released`, which marks no attempt.
   */
  attemptIndex: number | null;
  /**
   * **How much of the answer was the learner's own words** (`core/ownwords.ts`, M3). Three
   * shares, against the anchored block, Ellie's cue and Max's question. A flag, never a gate:
   * `progressFill` does not read it and no fill is withheld on it. `null` where the verdict
   * marked nothing measurable.
   */
  ownWords: OwnWordsShares | null;
  /**
   * **The form of the question the row is about** (migration 023, brief §4.5 as amended
   * 2026-10-01). `cloze` is a fill-in-the-blank, asked after a release; its verdicts are recorded
   * and `progressFill` skips them, because one recalled term is not the learner's own words about
   * the objective. Absent or `null` on rows written before 023, which were all `open`.
   */
  form?: QuestionForm | null;
  /**
   * **The concept card the question was about** (migration 031; 6 Oct afternoon, decision 9 on
   * #67): copied from its Q block (`q_block.cardId`) when the row is written, so removing the
   * chip never takes the credit with it. Absent or `null` on older rows and on a question about
   * no card; the progress view then reads the Q block, or counts the row toward no card.
   */
  cardId?: string | null;
  createdAt: string;
}

/** Pure: the fill an objective has earned from its outcomes. Body in `progress.ts`. */
export type ProgressFill = 0 | 0.5 | 1;

// ── mentions (brief §4.2) ───────────────────────────────────────────────────────────────────

/** `@Ellie …` / `@Max …`, case-insensitive, anywhere in the text; the first one wins. */
export interface Mention {
  agent: AgentAuthor;
  /** The text with the mention removed and whitespace tidied. */
  rest: string;
}

// ── page images for the refine pass (brief §2) ──────────────────────────────────────────────

/**
 * Main cannot rasterise a PDF (no canvas outside the renderer), so the renderer renders each page
 * once at a modest width and hands the bytes over before the ingest starts. Optional: an ingest
 * with no images runs on structured text + geometry alone.
 */
export interface PageImage {
  page: number;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: Uint8Array;
}
