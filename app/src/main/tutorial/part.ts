/**
 * **One part, as a check or a help needs it** (`TUTORIAL-CONTRACT.md` S4–S6): the saved
 * document's answer, the part's record and key, its span thread, and the lecture material it is
 * linked to. Shared by `check.ts` and `help.ts`.
 */
import type { Node } from 'prosemirror-model';
import { blockPos, docOutline } from '../../shared/doc/schema.js';
import { blockToInline } from '../../shared/doc/inline.js';
import { SPAN_THREAD_PREFIX } from '../../shared/doc/types.js';
import { partAnswers, type PartAnswer } from '../../shared/doc/tutorialdoc.js';
import { tutorialContentKey, type PartKey } from '../../shared/tutorial.js';
import type { NotesDocRecord } from '../db/repos/notes.js';
import { threadsRepo } from '../db/repos/threads.js';
import { newId } from '../sessions.js';
import { capText, lecturePageTest, notebookDoc, tutorialRecord, type TutorialDeps, type TutorialTurnInput } from './context.js';
import { slideLabel } from './ingest.js';
import { tutorialRepo, type PartRecord } from './repo.js';
import { parsedDoc } from './view.js';

/** How much of the part a thread's chip quotes. */
const QUOTE_CAP = 240;
/** The most linked notes blocks and slides a turn is given, and how much of each. */
export const CONTEXT_MAX_NOTES = 6;
export const CONTEXT_MAX_SLIDES = 8;
const NOTE_CHARS = 1_200;
const SLIDE_CHARS = 1_500;

export interface ResolvedPart {
  record: NotesDocRecord;
  doc: Node;
  answer: PartAnswer;
  part: PartRecord;
  contentKey: string;
}

/** The tutorial's saved doc and the part in it, or null (no doc yet, or no such part). */
export function resolvePart(deps: TutorialDeps, input: { notebookId: string; fileId: string; partId: string }): ResolvedPart | null {
  const record = tutorialRecord(deps, input.notebookId, input.fileId);
  if (!record || record.ingestStatus !== 'ready') return null;
  const doc = parsedDoc(record);
  if (!doc) return null;
  const answer = partAnswers(doc).find((a) => a.partId === input.partId);
  if (!answer || !answer.blockId) return null;
  const part =
    tutorialRepo(deps.db).part(record.id, input.partId) ??
    // A part with no record (written by hand, or a row lost): an empty, low-confidence key.
    emptyRecord(record.id, input.partId);
  return { record, doc, answer, part, contentKey: tutorialContentKey(input.notebookId, input.fileId) };
}

function emptyRecord(docId: string, partId: string): PartRecord {
  const key: PartKey = { partId, answer: '', steps: [], mistakes: [], prerequisites: [], confidence: 'low', from: 'model' };
  return {
    docId,
    partId,
    key,
    links: { notesBlockIds: [], pages: [] },
    objectiveIds: [],
    status: 'untried',
    hintLevel: 0,
    attempts: 0,
    checkedBy: null,
    revealedAt: null,
    updatedAt: '',
  };
}

/** The answer as text, as Max is shown it: the slot, the blanks, or the ticks. */
export function answerText(answer: PartAnswer): string {
  if (answer.kind === 'blanks') {
    return Object.entries(answer.blanks)
      .map(([id, v]) => `${id}: ${v || '(empty)'}`)
      .join('\n');
  }
  if (answer.kind === 'choice') {
    const byId = new Map(answer.options.map((o) => [o.id, o.text]));
    return answer.picked.map((id) => `(${id}) ${byId.get(id) ?? ''}`.trim()).join('\n');
  }
  return answer.text;
}

/**
 * The part's span thread: the one already on its block in this room, else a new one anchored to
 * the part's block in the **tutorial** doc. `created` says it is new, so a refused turn can take
 * it away again (as `notes:blockAction` does).
 */
export function partThread(
  deps: TutorialDeps,
  input: { roomId: string; resolved: ResolvedPart; objectiveId: string | null; now: string },
): { threadId: string; created: boolean } {
  const repo = threadsRepo(deps.db);
  const existing = repo.forBlock(input.roomId, input.resolved.answer.blockId);
  if (existing) return { threadId: existing.threadId, created: false };
  const threadId = newId(SPAN_THREAD_PREFIX.replace(/_$/, ''));
  const quote = [input.resolved.answer.label, input.resolved.answer.prompt].filter(Boolean).join(' — ').replace(/\s+/g, ' ');
  repo.createSpanThread({
    roomId: input.roomId,
    docId: input.resolved.record.id,
    threadId,
    blockId: input.resolved.answer.blockId,
    quote: capText(quote, QUOTE_CAP),
    objectiveId: input.objectiveId,
    now: input.now,
  });
  return { threadId, created: true };
}

export function dropThread(deps: TutorialDeps, roomId: string, threadId: string): void {
  threadsRepo(deps.db).remove(roomId, threadId);
}

/** The single objective a part exercises, for the thread; null when it is none or several. */
export function threadObjective(part: PartRecord): string | null {
  return part.objectiveIds.length === 1 ? part.objectiveIds[0]! : null;
}

/**
 * **What a help or a feedback turn is drawn from** (`tutorials.md` §4: always the lecture notes
 * and slides, never the sheet alone): the linked notes blocks' text from the notebook's own doc,
 * with the heading above each, and the linked pages' text, lecture sources only, each labelled as
 * its citation chip reads.
 */
export function partMaterial(
  deps: TutorialDeps,
  notebookId: string,
  part: Pick<PartRecord, 'links'>,
): Pick<TutorialTurnInput, 'notes' | 'slides'> {
  const notes: TutorialTurnInput['notes'] = [];
  const doc = notebookDoc(deps, notebookId);
  if (doc) {
    const paths = new Map(docOutline(doc).map((e) => [e.blockId, e.path]));
    for (const blockId of part.links.notesBlockIds.slice(0, CONTEXT_MAX_NOTES)) {
      const hit = blockPos(doc, blockId);
      if (!hit) continue;
      const text = hit.node.isTextblock ? blockToInline(hit.node) : hit.node.textContent;
      const path = paths.get(blockId) ?? [];
      const heading = hit.node.type.name === 'heading' ? null : (path[path.length - 1] ?? null);
      notes.push({ blockId, heading, text: capText(text, NOTE_CHARS) });
    }
  }
  const subject = deps.notebooks.subject(notebookId);
  const isLecture = lecturePageTest(subject);
  const slides: TutorialTurnInput['slides'] = [];
  if (subject) {
    for (const page of part.links.pages.filter(isLecture).slice(0, CONTEXT_MAX_SLIDES)) {
      const text = deps.notebooks.textFor({ notebookId, pageFrom: page, pageTo: page });
      slides.push({ page, label: slideLabel(subject, page), text: capText(text, SLIDE_CHARS) });
    }
  }
  return { notes, slides };
}

/**
 * The part's words with the problem they belong to above them: what the judge and Max are shown,
 * so a part that says only "Show a valid plan" is read with the stem's assumptions.
 */
export function promptInContext(answer: Pick<PartAnswer, 'prompt' | 'context'>): string {
  if (!answer.context.trim()) return answer.prompt;
  return `THE PROBLEM, as the sheet sets it out before this part:\n${answer.context}\n\nTHIS PART:\n${answer.prompt}`;
}
