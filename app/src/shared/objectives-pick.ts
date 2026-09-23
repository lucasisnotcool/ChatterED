/**
 * **Which objective the next question is about** (issue #47, `docs/research/attempt-first.md`
 * §2.1, §2.4).
 *
 * One pure function, in `shared/` because both halves of the app need the same answer: the main
 * process calls it to decide what Max asks when the learner presses **+ Try this**, and the
 * renderer may call it to say which objective the line is about before it is pressed. Two
 * implementations of "which objective" is two things that can disagree in front of the learner.
 *
 * The rule, and where each clause comes from:
 *
 *  1. **The objectives the card teaches** — a ref with the card's `segmentId`, else a ref on the
 *     card's page. Identical to `objectivesForSegment` in `renderer/lib/objectives.ts`, which is
 *     the strip of glyphs already drawn on that card: the question has to be about something the
 *     learner can see they are being tested on.
 *  2. **Lowest ledger level first**, deck `order` as the tie-break. This is the form response
 *     behind the whole brief — *"I could not track my learning progress, so I prompted it to ask
 *     questions based on my weaknesses"* (R6) — as a button: a missed objective comes round again,
 *     and a landed one gives way to the next.
 *  3. **Fallback: the nearest objective earlier in the deck.** A card can teach nothing the tree
 *     names (a title slide, a figure, a page of references) and the line should still work, on
 *     something the learner has already been taken through.
 *  4. `null` only when the tree has no objectives at all, which is when the line is disabled.
 */
import type { LearningObjective, LearningObjectiveState, ObjectiveLevel } from './objectives.js';

/**
 * What the pick reads of an objective. A `Pick` rather than the whole shape since #49, so the
 * room actor — which is handed the tree's objectives as a callback, not as `LearningObjective`s —
 * can call the same function rather than keep a second policy for "which objective".
 */
export type PickableObjective = Pick<LearningObjective, 'id' | 'order' | 'refs'>;

/**
 * Where the learner is. `segmentId` is `null` in the notes doc (#48), which has no segments: the
 * page alone decides, which is what a ref with no `segmentId` already meant.
 */
export interface PickCard {
  segmentId: string | null;
  page: number;
}

export interface ObjectivePickInput {
  objectives: readonly PickableObjective[];
  /** The file's states. A missing state is level 0 — untouched, and therefore first in line. */
  states: readonly Pick<LearningObjectiveState, 'objectiveId' | 'level'>[];
  /**
   * The card the learner pressed the line on. `null` for the deck-level line, where nothing is
   * nearer than anything else and the pick is simply the lowest level in the deck.
   */
  card: PickCard | null;
}

export interface ObjectivePick {
  objectiveId: string;
  level: ObjectiveLevel;
  /** `taught_here` when the card teaches it, `nearest_earlier` / `nearest` when it does not. */
  reason: 'taught_here' | 'nearest_earlier' | 'nearest' | 'lowest_in_deck';
}

function levelOf(states: ObjectivePickInput['states'], id: string): ObjectiveLevel {
  return states.find((s) => s.objectiveId === id)?.level ?? 0;
}

/** §2.1's first clause, and `objectivesForSegment`'s filter, written once. */
export function teachesCard(objective: PickableObjective, card: PickCard): boolean {
  return objective.refs.some((r) =>
    r.segmentId && card.segmentId !== null ? r.segmentId === card.segmentId : r.page === card.page,
  );
}

/** Lowest level first, then deck order. The whole of clause 2. */
function byLevelThenOrder(
  states: ObjectivePickInput['states'],
): (a: PickableObjective, b: PickableObjective) => number {
  return (a, b) => {
    const byLevel = levelOf(states, a.id) - levelOf(states, b.id);
    return byLevel !== 0 ? byLevel : a.order - b.order;
  };
}

/** The ref page nearest the card from **before** it, or null when the objective has none. */
function nearestPageAtOrBefore(objective: PickableObjective, page: number): number | null {
  const pages = objective.refs.map((r) => r.page).filter((p) => p <= page);
  return pages.length === 0 ? null : Math.max(...pages);
}

function distanceToCard(objective: PickableObjective, page: number): number {
  const distances = objective.refs.map((r) => Math.abs(r.page - page));
  return distances.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...distances);
}

export function pickObjectiveForCard(input: ObjectivePickInput): ObjectivePick | null {
  const objectives = input.objectives.filter((o) => o.id.trim().length > 0);
  if (objectives.length === 0) return null;
  const sort = byLevelThenOrder(input.states);
  const pick = (o: PickableObjective, reason: ObjectivePick['reason']): ObjectivePick => ({
    objectiveId: o.id,
    level: levelOf(input.states, o.id),
    reason,
  });

  if (input.card === null) {
    return pick([...objectives].sort(sort)[0]!, 'lowest_in_deck');
  }
  const card = input.card;

  const taught = objectives.filter((o) => teachesCard(o, card)).sort(sort);
  if (taught.length > 0) return pick(taught[0]!, 'taught_here');

  /**
   * **Earlier in the deck, and as near as possible.** Among the objectives that have a ref at or
   * before this page, keep the ones whose nearest such page is the latest — those are the pages the
   * learner has just read — and then apply clause 2 inside that group.
   */
  const earlier = objectives
    .map((o) => ({ o, page: nearestPageAtOrBefore(o, card.page) }))
    .filter((e): e is { o: PickableObjective; page: number } => e.page !== null);
  if (earlier.length > 0) {
    const nearestPage = Math.max(...earlier.map((e) => e.page));
    const group = earlier.filter((e) => e.page === nearestPage).map((e) => e.o).sort(sort);
    return pick(group[0]!, 'nearest_earlier');
  }

  /**
   * **Nothing earlier**, which happens on the first slides of a deck whose first objective is a
   * page or two in. §2.1 stops at "the nearest objective by page earlier in the deck"; a disabled
   * line on page 1 of a deck that has a perfectly good tree would be a worse reading of it than
   * looking forward by the same measure, so this falls forward and says so in `reason`.
   */
  const forward = [...objectives].sort((a, b) => {
    const byDistance = distanceToCard(a, card.page) - distanceToCard(b, card.page);
    return byDistance !== 0 ? byDistance : sort(a, b);
  });
  return pick(forward[0]!, 'nearest');
}
