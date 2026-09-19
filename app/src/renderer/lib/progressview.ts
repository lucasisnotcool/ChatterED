/**
 * **The progress bar's arithmetic** (#48, `docs/research/collab-doc.md` §6), pure and tested.
 *
 * The bar replaces the objectives tree panel, which Lucas's own verdict retired: *"not intuitive
 * enough to feel like a tangible goal and reward / completion level"*. What makes a bar feel like
 * a goal rather than a readout is that it is **countable** — one segment per objective, in deck
 * order, each one empty, half or full — so this file's job is to turn a `ProgressView` into that
 * list and into the words beside it, and to do it somewhere a test can check the counting.
 *
 * The fill mapping itself is not decided here: `fill` arrives on the view, derived in the main
 * process by `shared/doc/progress.ts` from the learner's own verdicts (§6, and the contract's E8
 * mapping — level 3 → 1, level 2 → 0.5, else 0). A released answer, Ellie's cue and agreement
 * fill nothing, and nothing in the renderer may quietly disagree with that.
 */
import type { ProgressFill, ProgressObjectiveView, ProgressView } from '../../shared/doc/types.js';

/**
 * One drawn segment of the bar.
 *
 * `assumedByDeck` objectives are **not** segments (§6's cards show them apart, under "The deck
 * assumes you know"): they are not what this lecture is teaching, so counting them would make
 * the bar's denominator a number the deck never promised.
 */
export interface Segment {
  objectiveId: string;
  title: string;
  fill: ProgressFill;
  /** 1-based, for the tooltip and the screen-reader sentence. */
  index: number;
}

export function taughtObjectives(view: ProgressView | null): ProgressObjectiveView[] {
  return (view?.objectives ?? []).filter((o) => !o.assumedByDeck);
}

export function assumedObjectives(view: ProgressView | null): ProgressObjectiveView[] {
  return (view?.objectives ?? []).filter((o) => o.assumedByDeck);
}

export function segments(view: ProgressView | null): Segment[] {
  return taughtObjectives(view).map((o, i) => ({
    objectiveId: o.objectiveId,
    title: o.title,
    fill: o.fill,
    index: i + 1,
  }));
}

/**
 * `3 of 9` — completed over total, both counted over the taught objectives only.
 *
 * Deliberately not the fraction the bar draws: a half-filled segment is visible *in the bar*,
 * and a count that said "3.5 of 9" would be claiming a precision the ledger does not have.
 * `ProgressView.completed` is the main process's own count and is used when it agrees; the
 * recount exists because the bar must stay drawable from `objectives` alone (the mock, a build
 * mid-ingest, or a view that arrived before the totals were recomputed).
 */
export function completedOf(view: ProgressView | null): number {
  return taughtObjectives(view).filter((o) => o.fill === 1).length;
}

export function totalOf(view: ProgressView | null): number {
  return taughtObjectives(view).length;
}

export function countLabel(view: ProgressView | null): string {
  return `${completedOf(view)} of ${totalOf(view)}`;
}

/** What the bar actually fills to, 0–1: half-answers count for half. */
export function fraction(view: ProgressView | null): number {
  const list = taughtObjectives(view);
  if (list.length === 0) return 0;
  return list.reduce((sum, o) => sum + o.fill, 0) / list.length;
}

/** Everything the deck teaches is complete — the one moment worth marking (§6). */
export function isComplete(view: ProgressView | null): boolean {
  const list = taughtObjectives(view);
  return list.length > 0 && list.every((o) => o.fill === 1);
}

/**
 * The status sentence beside the bar. One line, no exclamation mark, and it names the next thing
 * rather than congratulating: this is a document, not a game.
 */
export function statusLine(view: ProgressView | null): string {
  if (!view || view.status === 'pending') return 'Ellie is still reading the deck…';
  if (view.status === 'failed') return 'The objectives could not be read from this deck.';
  const total = totalOf(view);
  if (total === 0) return 'No objectives for this deck yet.';
  if (isComplete(view)) return 'Every objective on this deck is yours.';
  const done = completedOf(view);
  const half = taughtObjectives(view).filter((o) => o.fill === 0.5).length;
  if (done === 0 && half === 0) return 'Nothing answered in your own words yet.';
  if (half > 0) return `${done} complete · ${half} half-answered`;
  return `${done} answered in your own words`;
}

/**
 * The lesson card's one big button (§6).
 *
 * **Start** when nothing has been shown, **Continue** on a half fill — the learner has a
 * follow-up waiting on the same question — and **Review** once it is complete, because pressing
 * it again must not read as "do this over".
 */
export function startLabel(fill: ProgressFill): string {
  if (fill === 1) return 'Review';
  if (fill === 0.5) return 'Continue';
  return 'Start';
}

export function fillWord(fill: ProgressFill): string {
  if (fill === 1) return 'complete';
  if (fill === 0.5) return 'half';
  return 'not started';
}

/** `pp. 12, 15–17` — the slide chips on a lesson card, grouped so nine pages are not nine chips. */
export function pageChips(pages: readonly number[]): string[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  let run: number[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    out.push(run.length === 1 ? `p. ${run[0]}` : `pp. ${run[0]}–${run.at(-1)}`);
    run = [];
  };
  for (const page of sorted) {
    if (run.length > 0 && page !== run.at(-1)! + 1) flush();
    run.push(page);
  }
  flush();
  return out;
}

/**
 * Which segments changed between two views, for the fill animation.
 *
 * Returned as ids rather than as a boolean because the bar animates **the one that moved** —
 * the same shape `store.ledgerPulse` uses for the ledger rail, and for the same reason: a bar
 * that re-animated every segment on every update would be a bar nobody reads.
 */
export function movedObjectives(before: ProgressView | null, after: ProgressView | null): string[] {
  const was = new Map(taughtObjectives(before).map((o) => [o.objectiveId, o.fill]));
  return taughtObjectives(after)
    .filter((o) => was.has(o.objectiveId) && was.get(o.objectiveId) !== o.fill)
    .map((o) => o.objectiveId);
}
