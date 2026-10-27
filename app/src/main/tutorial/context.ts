/**
 * **What the tutorial module needs from the app**, and the reads every step shares
 * (`TUTORIAL-CONTRACT.md` S2–S6). `ipc.ts` builds `TutorialDeps` from `DocHost`; the tests build
 * it from a database and a fake actor. Nothing here writes.
 */
import type { Node } from 'prosemirror-model';
import type { LLMClient, LlmRequest } from '../../room/llm/types.js';
import type { ModelPlan } from '../../room/llm/models.js';
import type { SqlDatabase } from '../db/driver.js';
import type { NotebookHost, NotebookSubject } from '../dochost.js';
import type { PageGeometry } from '../../shared/segment/types.js';
import type { LearningTree } from '../../shared/objectives.js';
import { locatePage, notebookContentKey, type NotebookSourceView } from '../../shared/notebook.js';
import { tutorialContentKey, type TutorialChange, type TutorialView } from '../../shared/tutorial.js';
import { notesRepo, type NotesDocRecord } from '../db/repos/notes.js';
import { log } from '../log.js';
import { WINDOW_ERROR_RETRIES, WINDOW_PREEMPT_RETRIES, WINDOW_REQUEUE_MS } from '../notes/ingest.js';
import { tutorialRepo } from './repo.js';
import { parsedDoc, tutorialView } from './view.js';

/**
 * **The actor's tutorial turn** (S5, workstream E). Declared here structurally, as
 * `docroom/actorport.ts` declared the collab-doc methods while they were being built, so main
 * compiles against the contract and fails with a name when the method is missing.
 */
export interface TutorialTurnInput {
  kind: 'hint' | 'refresher' | 'feedback' | 'reveal' | 'reply';
  level: 0 | 1 | 2 | 3;
  docId: string;
  contentKey: string;
  partId: string;
  partBlockId: string;
  label: string;
  anchorId: string;
  prompt: string;
  answer: string;
  key: import('../../shared/tutorial.js').PartKey;
  /** `reply` only (2026-10-04, `reply.ts`): the learner's own words. */
  learnerText?: string;
  /** The part was shown, so a `reply` may discuss its answer. */
  revealed?: boolean;
  verdict?: { verdict: 'complete' | 'partial' | 'not_yet'; checkedBy: 'simulation' | 'model'; detail: string };
  /** For choice feedback, code owns every option-specific claim in Max's final message. */
  choice?: { picked: string[]; correct: string[] };
  notes: { blockId: string; heading: string | null; text: string }[];
  slides: { page: number; label: string; text: string }[];
  objectiveId: string | null;
}

export interface TutorialTurnStart {
  accepted: boolean;
  /** `question_open` is passed through if the actor ever says it. */
  reason: 'busy' | 'no_doc' | 'question_open' | null;
  threadId: string;
  turn: Promise<void>;
}

export interface TutorialActor {
  tutorialTurn(input: TutorialTurnInput): Promise<TutorialTurnStart>;
}

export function tutorialActor(actor: unknown): TutorialActor | null {
  const fn = (actor as { tutorialTurn?: unknown } | null)?.tutorialTurn;
  return typeof fn === 'function' ? (actor as TutorialActor) : null;
}

export interface TutorialDeps {
  db: SqlDatabase;
  notebooks: NotebookHost;
  userDataDir: string;
  /** The overview's client for this notebook; null for the scripted backend. */
  llm(notebookId: string): LLMClient | null;
  models(): ModelPlan;
  /** One pdf.js pass per source (`vault/pagecache.ts`): the figure candidates. */
  geometry(input: { filePath: string; contentSha: string }): Promise<PageGeometry[]>;
  objectivesTree(notebookId: string): LearningTree | null;
  /** `tutorial:changed`. */
  push(change: TutorialChange): void;
  /** The notebook's room, opened (a check or a help is a learner action). */
  openRoom(notebookId: string): Promise<{ roomId: string; actor: unknown }>;
  persistFlow(): void;
  /** An outcome row was written on the notebook: recompute and push the bar. */
  onOutcome?(notebookId: string): void;
  now?(): string;
  /** Tests: the wait before a pre-empted call asks for the lane again. */
  requeueMs?: number;
}

export function nowOf(deps: Pick<TutorialDeps, 'now'>): string {
  return (deps.now ?? (() => new Date().toISOString()))();
}

/** A tutorial source of this notebook, or null. */
export function tutorialSource(subject: NotebookSubject | null, fileId: string): NotebookSourceView | null {
  const source = subject?.sources.find((s) => s.fileId === fileId) ?? null;
  return source && source.role === 'tutorial' ? source : null;
}

/** Whether a notebook page is a page of a lecture source, present now. */
export function lecturePageTest(subject: NotebookSubject | null): (page: number) => boolean {
  const sources = subject?.sources ?? [];
  return (page) => {
    const hit = locatePage(sources, page);
    return hit !== null && hit.source.role === 'lecture' && hit.source.status === 'ready';
  };
}

/** The notebook's own notes doc, parsed (what parts link into). */
export function notebookDoc(deps: Pick<TutorialDeps, 'db'>, notebookId: string): Node | null {
  return parsedDoc(notesRepo(deps.db).byContentSha(notebookContentKey(notebookId)));
}

export function tutorialRecord(deps: Pick<TutorialDeps, 'db'>, notebookId: string, fileId: string): NotesDocRecord | null {
  return notesRepo(deps.db).byContentSha(tutorialContentKey(notebookId, fileId));
}

/** The view of one tutorial now, or null when the source is no longer a tutorial here. */
export function viewOf(deps: TutorialDeps, notebookId: string, fileId: string): TutorialView | null {
  const subject = deps.notebooks.subject(notebookId);
  const source = tutorialSource(subject, fileId);
  if (!source) return null;
  const record = tutorialRecord(deps, notebookId, fileId);
  return tutorialView({
    notebookId,
    source,
    record,
    records: record ? tutorialRepo(deps.db).parts(record.id) : [],
    objectives: deps.objectivesTree(notebookId)?.objectives ?? [],
    isLecturePage: lecturePageTest(subject),
    hasLinkedSolutions: subject?.sources.some((s) => s.role === 'solutions' && s.keyFor === fileId && s.status === 'ready') ?? false,
  });
}

/** Every tutorial of a notebook, in the order the sources were added. */
export function listViews(deps: TutorialDeps, notebookId: string): TutorialView[] {
  const subject = deps.notebooks.subject(notebookId);
  if (!subject) return [];
  return subject.sources
    .filter((s) => s.role === 'tutorial')
    .map((s) => viewOf(deps, notebookId, s.fileId))
    .filter((v): v is TutorialView => v !== null);
}

/** Push the tutorial as it is now. */
export function pushView(deps: TutorialDeps, notebookId: string, fileId: string): TutorialView | null {
  const view = viewOf(deps, notebookId, fileId);
  deps.push({ notebookId, fileId, view });
  return view;
}

// ── one model call ─────────────────────────────────────────────────────────────────────────

export class Yielded extends Error {
  constructor() {
    super('Max stopped reading the sheet to answer you. Retry to finish it.');
    this.name = 'Yielded';
  }
}

/** One schema-bound call with the overview's retry rules; the answer's JSON object, parsed. */
export async function callJson(deps: TutorialDeps, llm: LLMClient, request: LlmRequest, label: string): Promise<unknown> {
  let preempted = 0;
  let errors = 0;
  for (;;) {
    try {
      const result = await llm.complete(request);
      return JSON.parse(extractJsonObject(result.text)) as unknown;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'CliPreemptedError') {
        preempted += 1;
        if (preempted > WINDOW_PREEMPT_RETRIES) throw new Yielded();
        await new Promise((r) => setTimeout(r, deps.requeueMs ?? WINDOW_REQUEUE_MS));
        continue;
      }
      if (error.name === 'LlmAbortedError') throw error;
      errors += 1;
      if (errors > WINDOW_ERROR_RETRIES) throw error;
      log().warn('tutorial.call.retry', { call: label, cause: error.message.slice(0, 200) });
    }
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}

/** Cap a passage for a prompt. */
export function capText(text: string, at: number): string {
  const t = text.trim();
  return t.length <= at ? t : `${t.slice(0, at - 1)}…`;
}
