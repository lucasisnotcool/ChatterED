/**
 * **A typed reply in a part's thread, and the sheet's guard** (2026-10-04, from Lucas dogfooding
 * Tutorial 1; `docs/research/tutorials.md` §4).
 *
 * Hint, Refresher, Check and Show answer each got a tutor turn with the part, the answer slot, the
 * key behind its guard and the part's lecture links. A reply the learner *typed* in the same
 * thread got none of it: it went to `rule:ellie_answers`, who could not see their answer, answered
 * in full, and filed a line into the lecture notes. Two things here put that right:
 *
 *  - `replyInPart`: a message sent into a thread on a part (the part's own, or a line inside it) is
 *    a `reply` tutor turn, built exactly as a Help is, with the learner's words as its row and the
 *    answer slot read as it is now. Max answers it; it writes nothing into the sheet.
 *  - `tutorialPartStates`: every part of the notebook's tutorials, whether it is still the
 *    learner's to solve, and the blocks inside it, for the actor's guard on every other turn
 *    (`prompts.tutor.sheetGuardBlock`) and for its rule that no answer line lands inside one.
 */
import type { Node } from 'prosemirror-model';
import { parseTutorialContentKey, tutorialContentKey } from '../../shared/tutorial.js';
import { notesRepo } from '../db/repos/notes.js';
import { log } from '../log.js';
import { tutorialActor, tutorialSource, type TutorialDeps } from './context.js';
import { answerText, partMaterial, promptInContext, resolvePart } from './part.js';
import { tutorialRepo } from './repo.js';
import { parsedDoc } from './view.js';

/** One part, as the actor's guard reads it. */
export interface TutorialPartState {
  contentKey: string;
  partId: string;
  label: string;
  /** Correct, or shown: no longer the learner's to solve. */
  solved: boolean;
  /** The part's own block id and every block id inside it. */
  blockIds: string[];
}

/** Each `tut_part` at the top of a sheet: its id, label, and the block ids inside it. */
export function partsOf(doc: Node): { partId: string; label: string; blockIds: string[] }[] {
  const out: { partId: string; label: string; blockIds: string[] }[] = [];
  doc.forEach((node) => {
    if (node.type.name !== 'tut_part') return;
    const blockIds: string[] = [];
    const own = node.attrs.blockId as string | undefined;
    if (own) blockIds.push(own);
    node.descendants((child) => {
      const id = child.attrs.blockId as string | undefined;
      if (typeof id === 'string' && id) blockIds.push(id);
      return true;
    });
    out.push({ partId: node.attrs.partId as string, label: (node.attrs.label as string) || (node.attrs.partId as string), blockIds });
  });
  return out;
}

/** Every part of every tutorial in the notebook, with whether it is still the learner's to solve. */
export function tutorialPartStates(deps: TutorialDeps, notebookId: string): TutorialPartState[] {
  const subject = deps.notebooks.subject(notebookId);
  if (!subject) return [];
  const notes = notesRepo(deps.db);
  const repo = tutorialRepo(deps.db);
  const out: TutorialPartState[] = [];
  for (const source of subject.sources) {
    if (source.role !== 'tutorial') continue;
    const contentKey = tutorialContentKey(notebookId, source.fileId);
    const record = notes.byContentSha(contentKey);
    const doc = parsedDoc(record);
    if (!record || !doc) continue;
    const status = new Map(repo.parts(record.id).map((p) => [p.partId, p.status]));
    for (const part of partsOf(doc)) {
      const s = status.get(part.partId);
      out.push({ contentKey, ...part, solved: s === 'correct' || s === 'revealed' });
    }
  }
  return out;
}

/** What `chat:send` hands over about the thread a message went into. */
export interface PartReplyInput {
  roomId: string;
  threadId: string;
  /** The thread's document: a tutorial's `notes_docs.id`, or anything else (then not routed). */
  docId: string | null;
  /** The block the thread is anchored on. */
  blockId: string | null;
  text: string;
}

/** How long a reply waits for a turn already running in the room before it gives the floor back. */
const BUSY_WAIT_MS = 20_000;
const BUSY_STEP_MS = 250;

/**
 * Route a typed message to the part's tutor, when its thread is on a part of a tutorial. Returns
 * false when it is not such a thread (or the room never came free), and `chat:send` then sends it
 * as it always has.
 */
export async function replyInPart(deps: TutorialDeps, input: PartReplyInput, actor: unknown): Promise<boolean> {
  if (!input.docId || !input.blockId || input.text.trim().length === 0) return false;
  const record = notesRepo(deps.db).byId(input.docId);
  const key = record ? parseTutorialContentKey(record.contentSha) : null;
  if (!record || !key) return false;
  if (!tutorialSource(deps.notebooks.subject(key.notebookId), key.fileId)) return false;
  const doc = parsedDoc(record);
  const part = doc ? partsOf(doc).find((p) => p.blockIds.includes(input.blockId!)) : undefined;
  if (!part) return false;
  const resolved = resolvePart(deps, { notebookId: key.notebookId, fileId: key.fileId, partId: part.partId });
  const tutor = tutorialActor(actor);
  if (!resolved || !tutor) return false;

  const turnInput = {
    kind: 'reply' as const,
    level: resolved.part.hintLevel,
    docId: resolved.record.id,
    contentKey: resolved.contentKey,
    partId: part.partId,
    partBlockId: resolved.answer.blockId,
    label: resolved.answer.label,
    anchorId: input.threadId,
    prompt: promptInContext(resolved.answer),
    // Read now, so the reply sees what is in the slot at the moment they wrote.
    answer: resolved.answer.empty ? '' : answerText(resolved.answer),
    key: resolved.part.key,
    learnerText: input.text,
    revealed: resolved.part.status === 'revealed',
    ...partMaterial(deps, key.notebookId, resolved.part),
    objectiveId: null,
  };

  const started = Date.now();
  for (;;) {
    const start = await tutor.tutorialTurn(turnInput);
    if (start.accepted) {
      log().info('tutorial.reply', { notebook_id: key.notebookId, file_id: key.fileId, part_id: part.partId, chars: input.text.length });
      deps.persistFlow();
      void start.turn.catch(() => undefined).then(() => deps.persistFlow());
      return true;
    }
    if (start.reason !== 'busy' || Date.now() - started > BUSY_WAIT_MS) {
      log().warn('tutorial.reply_not_routed', { part_id: part.partId, reason: start.reason });
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, BUSY_STEP_MS));
  }
}
