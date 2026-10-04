/**
 * **Check: a part's saved answer, judged** (`docs/research/tutorials.md` §5, §6;
 * `TUTORIAL-CONTRACT.md` S4).
 *
 * The verdict is decided before anyone speaks, in this order:
 *
 *  1. **Code**, where the part is formal: `core/planning` `judgeFormal` simulates the plan, works
 *     out which sequences reach the goal, derives the HLA's schema (`checkedBy: 'simulation'`).
 *     A choice part whose key names its correct options is decided by code the same way.
 *  2. Otherwise **one small model call** against the hidden key (`checkedBy: 'model'`), which
 *     returns the verdict and what is right and missing, never the missing piece itself.
 *
 * Then the part's record (status, one more attempt, who decided), and for `complete` or `partial`
 * one `quiz_outcomes` row per linked objective on the **notebook's** content key, so the bar fills
 * as a Max verdict fills it (full credit, whatever help was used: Lucas, 3 Oct). Then Max voices
 * it in the part's span thread (`actor.tutorialTurn`, kind `feedback`), and a line under the part.
 */
import { judgeFormal } from '../../core/planning.js';
import { statusAfterCheck } from '../../core/tutor.js';
import type { QuizVerdict3 } from '../../shared/doc/types.js';
import { notebookContentKey } from '../../shared/notebook.js';
import type { TutorialCheckInput, TutorialCheckResult } from '../../shared/tutorial.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { log } from '../log.js';
import { newId } from '../sessions.js';
import { callJson, nowOf, pushView, tutorialActor, type TutorialDeps } from './context.js';
import { answerText, dropThread, partMaterial, partThread, promptInContext, resolvePart, threadObjective, type ResolvedPart } from './part.js';
import { JUDGE_JSON_SCHEMA, JUDGE_SYSTEM, judgeMessage } from './prompt.js';
import { tutorialRepo } from './repo.js';
import { partStatus } from './view.js';

export const JUDGE_MAX_TOKENS = 800;

export interface Judgement {
  verdict: QuizVerdict3;
  checkedBy: 'simulation' | 'model';
  detail: string;
}

/** The `questionId` a tutorial part's outcome rows carry. */
export function tutorialQuestionId(fileId: string, partId: string): string {
  return `tut:${fileId}:${partId}`;
}

/** A choice part decided by its key's correct options: all of them and nothing else is complete. */
export function judgeChoice(picked: readonly string[], correct: readonly string[], multi: boolean): Judgement {
  const right = new Set(correct);
  const hits = picked.filter((id) => right.has(id)).length;
  const wrong = picked.length - hits;
  const missing = correct.length - hits;
  const verdict: QuizVerdict3 =
    wrong === 0 && missing === 0 ? 'complete' : multi && wrong === 0 && hits > 0 ? 'partial' : 'not_yet';
  const detail =
    verdict === 'complete'
      ? 'Every correct option is ticked, and nothing else.'
      : `${hits} of the ticked option${picked.length === 1 ? ' is' : 's are'} right${wrong > 0 ? `, ${wrong} ${wrong === 1 ? 'is' : 'are'} not` : ''}${missing > 0 ? `, and ${missing} correct option${missing === 1 ? ' is' : 's are'} not ticked` : ''}.`;
  return { verdict, checkedBy: 'simulation', detail };
}

/**
 * The scripted backend's judgement, so a scripted sitting can check a free-text part: the share
 * of the key's content words the answer uses. Never used with a live model.
 */
export function judgeByOverlap(answer: string, key: string): Judgement {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const want = words(key);
  const got = words(answer);
  const share = want.size === 0 ? 0 : [...want].filter((w) => got.has(w)).length / want.size;
  const verdict: QuizVerdict3 = share >= 0.6 ? 'complete' : share >= 0.25 ? 'partial' : 'not_yet';
  return { verdict, checkedBy: 'model', detail: `The answer shares ${Math.round(share * 100)}% of the key's terms.` };
}

export async function judgePart(deps: TutorialDeps, notebookId: string, resolved: ResolvedPart): Promise<Judgement> {
  const { answer, part } = resolved;
  const key = part.key;
  /**
   * **A failed plan is evidence, not a verdict** (live run, 3 Oct 2026). A `sequences` or
   * `hla_schema` check is the sheet's own problem restated, so code decides it either way. A `plan`
   * check runs on a *domain the model wrote*, and the model's modelling can differ from the
   * sheet's assumptions: on Tutorial 1 it left `Clear(Table)` deletable, so the sheet's own
   * `Move(A, B, Table)` plan failed at its second step. A plan the simulation accepts is accepted;
   * one it rejects goes to the judge with the simulation's account beside it.
   */
  let simulation: string | null = null;
  if (key.check) {
    try {
      const formal = judgeFormal(key.check, { text: answer.text, blanks: answer.blanks, picked: answer.picked });
      if (formal && (key.check.type !== 'plan' || formal.verdict === 'complete' || !deps.llm(notebookId))) {
        return { verdict: formal.verdict, checkedBy: 'simulation', detail: formal.detail };
      }
      if (formal) simulation = formal.detail;
    } catch (err) {
      log().warn('tutorial.check.formal_threw', { part_id: part.partId, cause: (err as Error).message.slice(0, 200) });
    }
  }
  if (answer.kind === 'choice' && key.correct && key.correct.length > 0 && key.confidence === 'high') {
    // Partial credit needs a right tick, no wrong one, and a right one missing: on a one-answer
    // part that cannot happen, so `multi` is safe to assume here.
    return judgeChoice(answer.picked, key.correct, true);
  }
  const llm = deps.llm(notebookId);
  if (!llm) return judgeByOverlap(answerText(answer), [key.answer, ...Object.values(key.blanks ?? {}).flat()].join(' '));
  const raw = (await callJson(
    deps,
    llm,
    {
      model: deps.models().orchestrator,
      max_tokens: JUDGE_MAX_TOKENS,
      system: [{ type: 'text', text: JUDGE_SYSTEM }],
      messages: [
        {
          role: 'user',
          content: judgeMessage({
            label: answer.label,
            prompt: promptInContext(answer),
            kind: answer.kind,
            answer: answerText(answer),
            simulation,
            key: {
              answer: key.answer,
              steps: key.steps,
              mistakes: key.mistakes,
              confidence: key.confidence,
              ...(key.blanks ? { blanks: key.blanks } : {}),
              ...(key.correct ? { correct: key.correct } : {}),
            },
          }),
        },
      ],
      jsonSchema: JUDGE_JSON_SCHEMA,
      meta: { scope: 'notes', costScope: 'notes', fileId: notebookId },
    },
    'tutorial.judge',
  )) as { verdict?: unknown; detail?: unknown };
  const verdict: QuizVerdict3 =
    raw.verdict === 'complete' || raw.verdict === 'partial' || raw.verdict === 'not_yet' ? raw.verdict : 'not_yet';
  return { verdict, checkedBy: 'model', detail: typeof raw.detail === 'string' ? raw.detail.trim() : '' };
}

export async function checkPart(deps: TutorialDeps, input: TutorialCheckInput): Promise<TutorialCheckResult> {
  const resolved = resolvePart(deps, input);
  if (!resolved) return { accepted: false, reason: 'no_doc', status: null, threadId: null };
  const before = partStatus(resolved.part, resolved.answer);
  if (resolved.answer.empty) return { accepted: false, reason: 'empty', status: before, threadId: null };

  let judged: Judgement;
  try {
    judged = await judgePart(deps, input.notebookId, resolved);
  } catch (err) {
    log().error('tutorial.check.judge_failed', { part_id: input.partId, cause: (err as Error).message.slice(0, 200) });
    throw new Error("Max couldn't check this answer just now. Try Check again in a moment.");
  }
  const status = statusAfterCheck(judged.verdict);
  const now = nowOf(deps);
  const parts = tutorialRepo(deps.db);
  if (!parts.part(resolved.record.id, input.partId)) {
    parts.landParts(resolved.record.id, [{ partId: input.partId, key: resolved.part.key, links: resolved.part.links, objectiveIds: [] }], now);
  }
  const updated = parts.recordCheck(resolved.record.id, input.partId, { status, checkedBy: judged.checkedBy }, now);

  // A check is a learner action: it opens the room, as a first message does.
  const { roomId, actor } = await deps.openRoom(input.notebookId);
  if (judged.verdict !== 'not_yet' && resolved.part.objectiveIds.length > 0) {
    const outcomes = outcomesRepo(deps.db);
    for (const objectiveId of resolved.part.objectiveIds) {
      outcomes.insert({
        id: newId('qo'),
        contentSha: notebookContentKey(input.notebookId),
        roomId,
        objectiveId,
        questionId: tutorialQuestionId(input.fileId, input.partId),
        kind: 'verdict',
        verdict: judged.verdict,
        releasedBy: null,
        messageId: null,
        source: 'doc_text',
        attemptIndex: updated?.attempts ?? null,
        ownWords: null,
        form: 'open',
        createdAt: now,
      });
    }
    deps.onOutcome?.(input.notebookId);
  }
  log().info('tutorial.check', {
    notebook_id: input.notebookId,
    file_id: input.fileId,
    part_id: input.partId,
    verdict: judged.verdict,
    checked_by: judged.checkedBy,
    attempts: updated?.attempts ?? null,
    hint_level: resolved.part.hintLevel,
    key_confidence: resolved.part.key.confidence,
    key_from: resolved.part.key.from,
  });
  pushView(deps, input.notebookId, input.fileId);

  // Max voices it. The verdict stands whether or not he can speak now.
  const tutor = tutorialActor(actor);
  if (!tutor) {
    log().warn('tutorial.check.no_actor_turn', { part_id: input.partId });
    return { accepted: true, reason: null, status, threadId: null };
  }
  const objectiveId = threadObjective(resolved.part);
  const thread = partThread(deps, { roomId, resolved, objectiveId, now });
  const started = await tutor.tutorialTurn({
    kind: 'feedback',
    level: resolved.part.hintLevel,
    docId: resolved.record.id,
    contentKey: resolved.contentKey,
    partId: input.partId,
    partBlockId: resolved.answer.blockId,
    label: resolved.answer.label,
    anchorId: thread.threadId,
    prompt: promptInContext(resolved.answer),
    answer: answerText(resolved.answer),
    key: resolved.part.key,
    verdict: judged,
    ...partMaterial(deps, input.notebookId, resolved.part),
    objectiveId,
  });
  if (!started.accepted) {
    if (thread.created) dropThread(deps, roomId, thread.threadId);
    // The verdict is recorded and on the part; only Max's words are missing.
    return { accepted: true, reason: started.reason === 'busy' ? 'busy' : null, status, threadId: thread.created ? null : thread.threadId };
  }
  deps.persistFlow();
  void started.turn.catch(() => undefined).then(() => deps.persistFlow());
  return { accepted: true, reason: null, status, threadId: started.threadId || thread.threadId };
}
