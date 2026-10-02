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
  | InfographicDraft;

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
}

// ── agent edits ─────────────────────────────────────────────────────────────────────────────

/** How a Max question ended (brief §5.3). Shown as the tag on the resolved Q block. */
export type QResolution = 'you_got_this' | 'partly_yours' | 'released';

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

/** The longest a block action's doc line may be (`notebooks.md` §4.2). Enforced in code. */
export const BLOCK_LINE_MAX_WORDS = 25;

/**
 * **The learner's own-note slot under each overview section** (`notebooks.md` §3.1). An ordinary
 * empty `paragraph` whose `reason` is exactly this string and whose `pages` are the section's,
 * so typing in it maps to the section's objectives like any learner text. The renderer shows a
 * placeholder in it while it is empty and never draws a provenance chip on it. Not a new node:
 * the guard, the author marks and the doc-text path all work on it as they are.
 */
export const NOTE_SLOT_REASON = 'your note';

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
