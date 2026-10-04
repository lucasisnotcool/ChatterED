/**
 * **Help on a part: a hint, a refresher, or the answer** (`docs/research/tutorials.md` §4, §6;
 * `TUTORIAL-CONTRACT.md` S6).
 *
 *  - **Hint** climbs the ladder one rung per press (`core/tutor` `nextHintLevel`: point → break
 *    it down → a worked step); at the top it is refused with `top`, and the learner has Show
 *    answer. The rung is recorded only once the actor has taken the turn.
 *  - **Refresher** keeps the rung: Ellie on the prerequisite.
 *  - **Reveal** keeps the rung, marks the part `revealed` and writes one `released` outcome row
 *    per linked objective, which fills nothing, as a release never has.
 *
 * Every one is drawn from the lecture: the part's linked notes blocks and slides (`part.ts`),
 * handed to the actor's tutorial turn (S5) in the part's span thread.
 */
import { nextHintLevel } from '../../core/tutor.js';
import { notebookContentKey } from '../../shared/notebook.js';
import type { HintLevel, TutorialHelpInput, TutorialHelpResult } from '../../shared/tutorial.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { log } from '../log.js';
import { newId } from '../sessions.js';
import { nowOf, pushView, tutorialActor, type TutorialDeps } from './context.js';
import { tutorialQuestionId } from './check.js';
import { answerText, dropThread, partMaterial, partThread, promptInContext, resolvePart, threadObjective } from './part.js';
import { tutorialRepo } from './repo.js';

export async function helpPart(deps: TutorialDeps, input: TutorialHelpInput): Promise<TutorialHelpResult> {
  const resolved = resolvePart(deps, input);
  if (!resolved) return { accepted: false, reason: 'no_doc', level: null, threadId: null };
  if (input.kind !== 'hint' && input.kind !== 'refresher' && input.kind !== 'reveal') {
    throw new Error(`Unknown help: ${String(input.kind)}`);
  }

  let level: HintLevel = resolved.part.hintLevel;
  if (input.kind === 'hint') {
    const next = nextHintLevel(resolved.part.hintLevel);
    if ('top' in next) return { accepted: false, reason: 'top', level: resolved.part.hintLevel, threadId: null };
    level = next.level;
  }

  const { roomId, actor } = await deps.openRoom(input.notebookId);
  const tutor = tutorialActor(actor);
  if (!tutor) throw new Error('RoomActor.tutorialTurn is not available yet (workstream E, TUTORIAL-CONTRACT S5)');
  const now = nowOf(deps);
  const objectiveId = threadObjective(resolved.part);
  const thread = partThread(deps, { roomId, resolved, objectiveId, now });
  let started: Awaited<ReturnType<typeof tutor.tutorialTurn>>;
  try {
    started = await tutor.tutorialTurn({
      kind: input.kind,
      level,
      docId: resolved.record.id,
      contentKey: resolved.contentKey,
      partId: input.partId,
      partBlockId: resolved.answer.blockId,
      label: resolved.answer.label,
      anchorId: thread.threadId,
      prompt: promptInContext(resolved.answer),
      answer: resolved.answer.empty ? '' : answerText(resolved.answer),
      key: resolved.part.key,
      ...partMaterial(deps, input.notebookId, resolved.part),
      objectiveId,
    });
  } catch (err) {
    if (thread.created) dropThread(deps, roomId, thread.threadId);
    throw err;
  }
  if (!started.accepted) {
    if (thread.created) dropThread(deps, roomId, thread.threadId);
    const reason = started.reason === 'question_open' ? 'question_open' : started.reason === 'no_doc' ? 'no_doc' : 'busy';
    return { accepted: false, reason, level: null, threadId: thread.created ? null : thread.threadId };
  }

  // Recorded once the turn is taken: a refused press is not help the learner had.
  const parts = tutorialRepo(deps.db);
  if (!parts.part(resolved.record.id, input.partId)) {
    parts.landParts(resolved.record.id, [{ partId: input.partId, key: resolved.part.key, links: resolved.part.links, objectiveIds: [] }], now);
  }
  if (input.kind === 'hint') parts.raiseHint(resolved.record.id, input.partId, level, now);
  if (input.kind === 'reveal') {
    parts.reveal(resolved.record.id, input.partId, now);
    if (resolved.part.objectiveIds.length > 0) {
      const outcomes = outcomesRepo(deps.db);
      for (const id of resolved.part.objectiveIds) {
        outcomes.insert({
          id: newId('qo'),
          contentSha: notebookContentKey(input.notebookId),
          roomId,
          objectiveId: id,
          questionId: tutorialQuestionId(input.fileId, input.partId),
          kind: 'released',
          verdict: null,
          releasedBy: 'give_up',
          messageId: null,
          source: 'doc_text',
          attemptIndex: null,
          ownWords: null,
          form: 'open',
          createdAt: now,
        });
      }
      deps.onOutcome?.(input.notebookId);
    }
  }
  log().info('tutorial.help', {
    notebook_id: input.notebookId,
    file_id: input.fileId,
    part_id: input.partId,
    kind: input.kind,
    level,
    linked_notes: resolved.part.links.notesBlockIds.length,
    linked_pages: resolved.part.links.pages.length,
  });
  deps.persistFlow();
  void started.turn.catch(() => undefined).then(() => deps.persistFlow());
  pushView(deps, input.notebookId, input.fileId);
  return { accepted: true, reason: null, level: input.kind === 'hint' ? level : null, threadId: started.threadId || thread.threadId };
}
