/**
 * Progress IPC bodies (#48, brief §6). **Track T6 owns this file** — the lead placed only the hook.
 * Channels: `progress:get`, `progress:start`. See `app/docs/COLLAB-CONTRACT.md`.
 *
 * **The bar is a pure function of `quiz_outcomes`.** Not of the ledger's levels: the ledger scores
 * whether an explanation was *defended*, which is a different and slower claim than "Max said
 * *Well done* to something you wrote", and the brief's §6 names the second one. The ledger's level
 * rides along as `level` — the evidence record beside the fill, exactly as §6 says — and the
 * learner's own sentence rides along as `evidence`, because the ledger's rule R1 (only the
 * learner's verbatim words are evidence) is the reason any of this is trustworthy.
 *
 * `assumedByDeck` objectives are **in the list and out of the total**: they are prerequisites the
 * deck never teaches, so counting them would make a fully-understood deck read as two thirds done.
 */

import { DOC_ANCHOR_ID } from '../../shared/doc/types.js';
import type { ProgressObjectiveView, ProgressView, QuizOutcome } from '../../shared/doc/types.js';
import type { LearningObjective } from '../../shared/objectives.js';
import type { DocHost, IpcHandle } from '../dochost.js';
import { outcomesRepo } from '../db/repos/outcomes.js';
import { threadsRepo } from '../db/repos/threads.js';
import { docActor, requireActorMethod } from './actorport.js';
import { blockIdsForObjective, notesDocRow, openNotesDoc, pagesOfObjective } from './doc.js';
/**
 * **Stand-in for T2's `progressFill`** (`src/shared/doc/progress.ts`), which has not landed yet.
 *
 * The rule is the brief's §6, stated once: a *Well done* on the learner's own words fills the
 * objective, a *Partly there* half-fills it, and everything else — *Not yet.*, a released answer
 * (give-up, Pass or closure), Ellie's cue, agreement — fills nothing. Best verdict wins, because
 * an objective the learner has since answered fully is not un-learned by an earlier *Not yet*.
 *
 * Delete this and import T2's the moment the file exists; the contract names it as the one
 * definition, and two of them is exactly the drift this comment exists to make visible.
 */
function progressFill(outcomes: readonly QuizOutcome[]): 0 | 0.5 | 1 {
  let fill: 0 | 0.5 | 1 = 0;
  for (const outcome of outcomes) {
    if (outcome.kind !== 'verdict') continue;
    if (outcome.verdict === 'complete') return 1;
    if (outcome.verdict === 'partial') fill = 0.5;
  }
  return fill;
}

/** The outcome that earned an objective its fill: the best verdict, and the earliest of those. */
function bestOutcome(outcomes: readonly QuizOutcome[]): QuizOutcome | null {
  const rank = (o: QuizOutcome): number =>
    o.kind === 'verdict' && o.verdict === 'complete' ? 2 : o.kind === 'verdict' && o.verdict === 'partial' ? 1 : 0;
  let best: QuizOutcome | null = null;
  for (const o of outcomes) {
    if (rank(o) === 0) continue;
    if (!best || rank(o) > rank(best)) best = o;
  }
  return best;
}

/**
 * Build the whole view. Exported so `emitProgress` and the handler share one definition, and so
 * the unit tests can drive it with a fake host instead of an IPC round trip.
 */
export async function buildProgress(host: DocHost, fileId: string): Promise<ProgressView> {
  const tree = host.objectivesTree(fileId);
  // The tree is what the bar draws; if it is missing or stale, ask for it (self-guarding, never
  // awaited) and report `none` this time round. The `objectives.tree` event brings the renderer back.
  if (!tree || tree.status !== 'ready') host.ensureObjectives(fileId);

  let contentSha: string | null = null;
  try {
    contentSha = (await host.fileBytesKey(fileId)).contentSha;
  } catch {
    // A file whose bytes cannot be read still has a bar; it is simply empty.
    contentSha = null;
  }

  const docRow = notesDocRow(host.db, { contentSha, fileId });
  const opened = docRow ? openNotesDoc(host.db, { contentSha: docRow.contentSha }) : null;
  const doc = opened?.doc ?? null;

  const outcomes = contentSha ? outcomesRepo(host.db).forContent(contentSha) : [];
  const byObjective = new Map<string, QuizOutcome[]>();
  for (const outcome of outcomes) {
    if (!outcome.objectiveId) continue;
    const list = byObjective.get(outcome.objectiveId);
    if (list) list.push(outcome);
    else byObjective.set(outcome.objectiveId, [outcome]);
  }

  const states = new Map(host.objectivesStates(fileId).map((s) => [s.objectiveId, s]));
  const objectives: LearningObjective[] = tree ? [...tree.objectives].sort((a, b) => a.order - b.order) : [];

  const views: ProgressObjectiveView[] = objectives.map((objective) => {
    const mine = byObjective.get(objective.id) ?? [];
    const fill = progressFill(mine);
    const best = bestOutcome(mine);
    const state = states.get(objective.id);
    return {
      objectiveId: objective.id,
      title: objective.title,
      statement: objective.statement,
      criteria: objective.criteria,
      pages: pagesOfObjective(objective),
      blockIds: blockIdsForObjective(host.db, doc, docRow?.docId ?? null, objective),
      fill,
      level: state?.level ?? 0,
      assumedByDeck: objective.assumedByDeck,
      // The learner's own words, read back from the message the verdict was on — never the
      // agent's summary of them (`progress-tracking.md` §4.4 R1).
      evidence: best?.messageId ? (host.store.messages.get(best.messageId)?.body ?? null) : null,
      lastMovedAt: best?.createdAt ?? state?.lastMovedAt ?? null,
    };
  });

  const counted = views.filter((v) => !v.assumedByDeck);
  const total = counted.length;
  const completed = counted.filter((v) => v.fill === 1).length;
  const sum = counted.reduce((acc, v) => acc + v.fill, 0);

  return {
    fileId,
    docId: docRow?.docId ?? null,
    status: tree ? tree.status : 'none',
    completed,
    total,
    fraction: total === 0 ? 0 : sum / total,
    objectives: views,
  };
}

/**
 * Recompute and push `progress.updated`.
 *
 * Called after anything of T6's that can move the bar, and — once T1 exports it — from
 * `subscribeOutcomes`, which is the real trigger: the outcome that fills an objective is written
 * by the actor's `DocPort.recordOutcome`, several turns away from any handler here.
 */
export async function emitProgress(host: DocHost, fileId: string): Promise<void> {
  try {
    const room = await host.roomForFile(fileId);
    host.emit({ type: 'progress.updated', roomId: room?.roomId ?? null, fileId, progress: await buildProgress(host, fileId) });
  } catch {
    // The bar is a read; failing to push one is never worth failing the action that moved it.
  }
}

/**
 * Subscribe to the outcomes the actor records, so the bar moves when a verdict lands rather than
 * when the renderer next asks.
 *
 * T1 owns `notes/docport.ts` and has not exported `subscribeOutcomes` yet, so this reaches for it
 * defensively and does nothing if it is not there. It is a `void import` rather than a static one
 * for exactly that reason: a static import of a name that does not exist does not compile, and
 * this track does not get to edit T1's file to add it.
 */
export function subscribeOutcomes(host: DocHost): void {
  void (async () => {
    try {
      const port = (await import('../notes/docport.js')) as unknown as {
        subscribeOutcomes?: (fn: (outcome: { roomId?: string | null; fileId?: string | null }) => void) => unknown;
      };
      if (typeof port.subscribeOutcomes !== 'function') return;
      port.subscribeOutcomes((outcome) => {
        const fileId = outcome.fileId ?? (outcome.roomId ? host.fileForRoom(outcome.roomId) : null);
        if (fileId) void emitProgress(host, fileId);
      });
    } catch {
      // Not wired yet. The handlers below still emit after their own writes.
    }
  })();
}

export function registerProgressIpc(host: DocHost, handle: IpcHandle): void {
  subscribeOutcomes(host);

  handle<{ fileId: string }>('progress:get', async (input) => buildProgress(host, input.fileId));

  /**
   * A lesson card's **Start** (brief §6): one press, three things.
   *
   * Ellie's message and the prompt to ask are the actor's (`startLesson`); the scroll is the
   * renderer's, and it needs a target, so the objective's first block comes back with the call
   * rather than being looked up again on the other side of the IPC boundary.
   *
   * **This creates the room**, like the first chat message does: pressing Start is asking to be
   * taught, and a lesson with nowhere to happen is not one.
   */
  handle<{ fileId: string; objectiveId: string }>('progress:start', async (input) => {
    const tree = host.objectivesTree(input.fileId);
    const objective = tree?.objectives.find((o) => o.id === input.objectiveId) ?? null;
    if (!objective) throw new Error(`No objective ${input.objectiveId} on ${input.fileId}`);

    const { roomId, actor } = await host.openFlowRoom(input.fileId);
    const contentSha = await host.fileBytesKey(input.fileId).then(
      (k) => k.contentSha,
      () => null,
    );
    const docRow = notesDocRow(host.db, { contentSha, fileId: input.fileId });
    const doc = docRow ? openNotesDoc(host.db, { contentSha: docRow.contentSha })?.doc ?? null : null;
    const blockId = blockIdsForObjective(host.db, doc, docRow?.docId ?? null, objective)[0] ?? null;

    threadsRepo(host.db).ensureDocThread({
      roomId,
      docId: docRow?.docId ?? null,
      threadId: DOC_ANCHOR_ID,
      now: new Date().toISOString(),
    });

    const target = docActor(actor);
    try {
      await requireActorMethod(target, 'startLesson').call(target, {
        objectiveId: objective.id,
        anchorId: DOC_ANCHOR_ID,
        blockId,
      });
    } finally {
      host.persistFlow();
    }
    return { roomId, threadId: DOC_ANCHOR_ID, blockId };
  });
}
