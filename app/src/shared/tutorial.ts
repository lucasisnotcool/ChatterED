/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A TUTORIAL SHEET IN A NOTEBOOK (2026-10-03, `docs/research/tutorials.md`)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A notebook's sources now have a **role**. A lecture deck is what the overview is written from,
 * as before. A **tutorial** is a problem sheet: it is not summarised into the overview; it becomes
 * its own document, the sheet copied faithfully with an answer slot under every part, shown in a
 * split column beside the notes (or a floating window). It has no chat and no objectives of its
 * own: help comes into the notebook's one chat, from Max, drawing on the lecture notes and slides,
 * and a correct answer fills the notebook's own objectives. **Solutions**, when the learner adds
 * the official ones, are never shown and never read by an agent: they only replace the hidden key.
 *
 * Everything the renderer, main and the room share about it is declared here and frozen in
 * `app/docs/TUTORIAL-CONTRACT.md`. The hidden key types live here too, but the key itself never
 * crosses to the renderer: `TutorialPartView` is all the renderer is ever sent.
 */

import type { FormalCheck } from '../core/planning.js';

export type { FormalCheck } from '../core/planning.js';

// ── Roles ───────────────────────────────────────────────────────────────────────────────────

/**
 * - `lecture` — the default, and what every source added before 2026-10-03 is.
 * - `tutorial` — a problem sheet: its own document beside the notes, never in the overview.
 * - `solutions` — the official answers to a tutorial (`NotebookSourceView.keyFor`): hidden from
 *   the learner's context and the agents', read only to rewrite that tutorial's key.
 */
export type SourceRole = 'lecture' | 'tutorial' | 'solutions';

export const SOURCE_ROLES: readonly SourceRole[] = ['lecture', 'tutorial', 'solutions'];

export function isSourceRole(value: unknown): value is SourceRole {
  return value === 'lecture' || value === 'tutorial' || value === 'solutions';
}

/** The content key of a tutorial's document: `notes_docs.content_sha` for it. */
export function tutorialContentKey(notebookId: string, fileId: string): string {
  return `nb:${notebookId}:tut:${fileId}`;
}

export function parseTutorialContentKey(key: string): { notebookId: string; fileId: string } | null {
  const match = /^nb:(nb_[^:]+):tut:(.+)$/.exec(key);
  return match ? { notebookId: match[1]!, fileId: match[2]! } : null;
}

/**
 * **Who helps with a tutorial part** (Lucas, 3 Oct 2026: *"Max owns, but let's keep this a possible
 * decision point, where we might choose Ellie if it is too hostile to the user (pressure from the
 * sheet + pressure from Max)"*). Max hints and checks; Ellie gives a refresher when it is asked
 * for. One switch, so the call can be reversed without touching the turn code.
 */
export const TUTOR_HELPER: 'max' | 'ellie' = 'max';

// ── The answer a part takes ─────────────────────────────────────────────────────────────────

/**
 * - `text` — an explanation, in paragraphs (Problem 2).
 * - `code` — a formal answer in a code block: a PDDL domain and problem (Problem 1a).
 * - `tree` — a nested list: a search tree, a decomposition (Problem 1b).
 * - `sequence` — a numbered list: a plan (Problem 1c).
 * - `blanks` — fields in the sheet's own line: `Effect: ____` (Problem 3A).
 * - `choice` — tick boxes on the sheet's options: "choose all that apply" (Problem 3B).
 */
export type TutorialAnswerKind = 'text' | 'code' | 'tree' | 'sequence' | 'blanks' | 'choice';

export const ANSWER_KINDS: readonly TutorialAnswerKind[] = ['text', 'code', 'tree', 'sequence', 'blanks', 'choice'];

export function isAnswerKind(value: unknown): value is TutorialAnswerKind {
  return typeof value === 'string' && (ANSWER_KINDS as readonly string[]).includes(value);
}

/** One option of a `choice` part: `i.`, `ii.` … as the sheet numbers them, and its words. */
export interface TutorialOption {
  id: string;
  /** The closed inline subset (`**bold**`, `$tex$`), as every block's text is. */
  text: string;
}

// ── The sheet, as the model reads it (the ingest's output, validated in main) ───────────────

/**
 * Inline text in a sheet block is the notes' closed subset (`**bold**`, `*em*`, `` `code` ``,
 * `$tex$`). A blank is written `{{blank:ID}}` where the sheet has its rule, and only inside a
 * `blanks` part's prompt.
 */
export const BLANK_TOKEN = /\{\{blank:([A-Za-z0-9_.-]+)\}\}/g;

/** A rectangle on a page, in fractions of the page (0..1), top-left origin. */
export interface SheetRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * One block of the sheet. `page` is the page **of the tutorial file** (1-based); the doc builder
 * turns it into a notebook page. `admin` marks the sheet's housekeeping (team sign-up, submission
 * rules): kept, dimmed and folded, never offered as something to answer.
 */
export type SheetBlock =
  | { type: 'heading'; level: 2 | 3; text: string; page: number; admin?: boolean }
  | { type: 'paragraph'; text: string; page: number; admin?: boolean }
  | { type: 'list'; ordered: boolean; items: string[]; page: number; admin?: boolean }
  | { type: 'math'; tex: string; page: number }
  | { type: 'code'; text: string; page: number }
  /** A figure cropped from the page, shown as the notes show a slide crop. */
  | { type: 'figure'; page: number; rect: SheetRect | null; caption: string }
  | SheetPart;

/** A part: one thing the learner answers. Never nested; a sub-part is its own part. */
export interface SheetPart {
  type: 'part';
  /** The sheet's address for it, stable across a re-read: `P1a`, `P3A.i`, `P3B`. */
  id: string;
  /** How it is named to the learner: "Problem 3 A) i." */
  label: string;
  page: number;
  /** The sheet's words for the part, blanks inline when `answer.kind` is `blanks`. */
  prompt: SheetBlock[];
  answer: SheetAnswer;
}

export type SheetAnswer =
  | { kind: 'text' | 'code' | 'tree' | 'sequence' }
  | { kind: 'blanks'; blanks: string[] }
  | { kind: 'choice'; multi: boolean; options: TutorialOption[] };

export interface TutorialSheet {
  /** "Tutorial 1 Week 3: Real World Planning and Acting". */
  title: string;
  blocks: SheetBlock[];
}

// ── The hidden key (main only; never sent to the renderer) ──────────────────────────────────

/**
 * What the model works out for a part at ingest, checked by code where the problem is formal.
 * Max is given it to hint and to judge from, with the instruction never to say it before a
 * release (Bastani et al. 2025: a tutor holding the answer and the common mistakes, told to hint,
 * removed most of the harm unguarded help did).
 */
export interface PartKey {
  partId: string;
  /** A model answer, in the closed subset. Shown only after a release. */
  answer: string;
  /** For `blanks`: each blank's accepted answers, the first the canonical one. */
  blanks?: Record<string, string[]>;
  /** For `choice`: the option ids that are correct. */
  correct?: string[];
  /** The sub-steps a learner would take, as short labels (subgoal labelling): hint 2's material. */
  steps: string[];
  /** Mistakes a learner is likely to make here, one line each. */
  mistakes: string[];
  /** What a learner must already know, one line each: the refresher's material. */
  prerequisites: string[];
  /** Set when the problem is formal enough for code to decide (`core/planning.ts`). */
  check?: FormalCheck;
  /**
   * `high` when a second, independent pass agreed or code verified the key; `low` when they
   * disagreed. On `low`, Max judges more cautiously and says the official solution may differ.
   */
  confidence: 'high' | 'low';
  /** `model` until official solutions replace it. */
  from: 'model' | 'solutions';
}

/**
 * **Where a part's material is in the notes and the slides** (`tutorials.md` §5): proposed by the
 * model at ingest against the notes' real outline, then filtered in code to block ids that exist
 * and pages that belong to a lecture source. What a hint points at and what a refresher reads.
 */
export interface PartLinks {
  /** Blocks of the notebook's main notes, in document order. */
  notesBlockIds: string[];
  /** Notebook pages of lecture sources. */
  pages: number[];
}

// ── The record of each part (the renderer's view of it) ─────────────────────────────────────

/**
 * - `untried` — nothing written yet.
 * - `working` — written in, not checked.
 * - `correct` / `partial` / `incorrect` — the last check's verdict.
 * - `revealed` — the learner gave up and the key was shown. Fills nothing, as a release never has.
 */
export type TutorialPartStatus = 'untried' | 'working' | 'correct' | 'partial' | 'incorrect' | 'revealed';

/** The rungs of help (`tutorials.md` §4): point, break it down, a worked step. 0 = none taken. */
export type HintLevel = 0 | 1 | 2 | 3;

export const MAX_HINT_LEVEL: HintLevel = 3;

/**
 * Where a part came from: the sheet itself, or (reserved, not yet built) practice the app generated
 * around it — a warm-up, another like it, a stretch, a concept the sheet skips.
 */
export type TutorialPartOrigin = 'sheet' | 'generated';

export interface TutorialPartView {
  partId: string;
  origin: TutorialPartOrigin;
  /** The `tut_part` block's id in the tutorial doc. */
  blockId: string;
  label: string;
  answerKind: TutorialAnswerKind;
  status: TutorialPartStatus;
  /** The highest rung of help taken on it. Recorded; it does not reduce the credit (Lucas, 3 Oct). */
  hintLevel: HintLevel;
  /** Checks run. */
  attempts: number;
  /** Whether the verdict came from code (`simulation`) or from Max's judgement (`model`). */
  checkedBy: 'simulation' | 'model' | null;
  links: PartLinks;
  objectiveIds: string[];
}

export type TutorialStatus = 'pending' | 'ready' | 'failed';

/** One tutorial of a notebook, as the split column and the sources panel draw it. */
export interface TutorialView {
  notebookId: string;
  /** The tutorial source's `files.id`. */
  fileId: string;
  /** Its document, once ingested. */
  docId: string | null;
  contentKey: string;
  title: string;
  status: TutorialStatus;
  error: string | null;
  parts: TutorialPartView[];
  /** Whether the official solutions are in (`from: 'solutions'` on every key). */
  hasSolutions: boolean;
  /**
   * **What the lecture teaches that no part of the sheet exercises** (Lucas, 3 Oct 2026: practice
   * is generated only on demand, but the gaps are advertised so the learner can decide). The
   * notebook's objectives that are taught (cited to lecture pages, not assumed by the deck) and
   * that no part's `objectiveIds` include. Computed at ingest; nothing is generated from it.
   */
  gaps: TutorialGap[];
}

export interface TutorialGap {
  objectiveId: string;
  title: string;
  /** Lecture pages the objective is taught on. */
  pages: number[];
}

/** Parts done: `correct` ones, over every part. "Parts 4 / 9". */
export function partsDone(view: Pick<TutorialView, 'parts'>): { done: number; total: number } {
  return { done: view.parts.filter((p) => p.status === 'correct').length, total: view.parts.length };
}

// ── IPC (channels in `shared/ipc.ts`) ───────────────────────────────────────────────────────

/** `tutorial:list` — every tutorial of a notebook, ingested or not. */
export interface TutorialListInput {
  notebookId: string;
}

/** `tutorial:ingest` — read the sheet into its document (the renderer has sent the page images). */
export interface TutorialIngestInput {
  notebookId: string;
  fileId: string;
  /** Read it again even though a document exists (the learner's answers carry over by part id). */
  force?: boolean;
}

/** `tutorial:check` — judge the part's current answer, as the saved document holds it. */
export interface TutorialCheckInput {
  notebookId: string;
  fileId: string;
  partId: string;
}

export interface TutorialCheckResult {
  accepted: boolean;
  /** Why not: no document yet, Max is mid-turn, nothing written in the part. */
  reason: 'no_doc' | 'busy' | 'empty' | null;
  status: TutorialPartStatus | null;
  /** The span thread the chat focuses, where Max's feedback lands. */
  threadId: string | null;
}

/**
 * `tutorial:help` — ask for help on a part.
 * - `hint` — the next rung (point → break it down → a worked step), Max's (`TUTOR_HELPER`).
 * - `refresher` — the prerequisite, from the lecture notes and slides; Ellie's.
 * - `reveal` — give up: the key's answer, then Max asks for one line on why.
 */
export interface TutorialHelpInput {
  notebookId: string;
  fileId: string;
  partId: string;
  kind: 'hint' | 'refresher' | 'reveal';
}

export interface TutorialHelpResult {
  accepted: boolean;
  reason: 'no_doc' | 'busy' | 'question_open' | 'top' | null;
  /** The rung this help was, for `hint`. */
  level: HintLevel | null;
  threadId: string | null;
}

/** `notebook:setRole` — what a source is in this notebook. */
export interface SetSourceRoleInput {
  notebookId: string;
  fileId: string;
  role: SourceRole;
  /** For `solutions`: the tutorial they answer. Null picks the only tutorial, when there is one. */
  keyFor?: string | null;
}

/** Pushed on `tutorial:changed` whenever a tutorial's document or a part's record changed. */
export interface TutorialChange {
  notebookId: string;
  view: TutorialView | null;
  fileId: string;
}

// ── Recognising a problem sheet ─────────────────────────────────────────────────────────────

const SHEET_NAME = /\b(tut(orial)?s?|problem[ _-]?sets?|worksheets?|exercises?|homework|hw\d*|assignments?|labs?|psets?)\b/i;
const SOLUTION_NAME = /\b(solutions?|answers?|answer[ _-]?key|sol(n|ns)?|suggested[ _-]?answers?)\b/i;
const PART_HEADING = /^\s*(problem|question|exercise|task|q)\s*\d+\b/gim;

/**
 * **What role a newly read source most likely has**, from its file name and its text. A guess the
 * learner can change in one click (the sources panel's menu), so it errs towards `lecture`: a deck
 * mistaken for a tutorial would vanish from the overview, which is worse than the reverse.
 */
export function guessSourceRole(name: string, text: string): SourceRole {
  const bare = name.replace(/[+_]/g, ' ');
  if (SOLUTION_NAME.test(bare) && SHEET_NAME.test(bare)) return 'solutions';
  const headings = text.match(PART_HEADING)?.length ?? 0;
  if (SHEET_NAME.test(bare) && (headings >= 1 || text.length < 20_000)) return 'tutorial';
  if (headings >= 3 && text.length < 30_000) return 'tutorial';
  return 'lecture';
}
