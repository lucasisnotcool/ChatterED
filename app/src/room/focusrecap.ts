/**
 * **Where to look next** (`docs/research/collab-doc.md` §4.8, 2026-10-01).
 *
 * When a sitting goes idle, Ellie posts one message in the doc chat that says where the file
 * stands: what is complete, which questions ended with the answer being shown, which objectives
 * are half filled, and which have not been started. Each item names its pages as `p. N`, which
 * the chat already renders as a link into the notes, so the message is also the way back in.
 *
 * **Written in code, not by a model.** It is a reading of the outcome rows, and a model asked to
 * summarise a learner's record can misstate it: an objective reported as done that is not, or the
 * reverse. The same rows draw the progress bar (`shared/doc/progress.ts`), so this message and the
 * bar cannot disagree. It costs no call, and it can therefore be posted on the closure tick, which
 * must not wait on one (§4.7).
 *
 * **It says nothing about a sitting in which nothing was asked.** A learner who read and left has
 * no performance to be told about, and a list of everything still undone, posted to someone who
 * only read, is a nag.
 *
 * Pure: every input is an argument. The actor decides when; this decides what.
 */

import type { ProgressObjectiveView, QuizOutcome } from '../shared/doc/types.js';

/** How many objectives one line lists before it says how many more there are. */
export const RECAP_LIST_CAP = 3;

/** The rule name on the message row, and what makes "already posted" checkable after a relaunch. */
export const FOCUS_RECAP_RULE = 'rule:focus_recap';

export interface RecapItem {
  objectiveId: string;
  title: string;
  pages: number[];
}

export interface FocusRecap {
  completed: number;
  total: number;
  /** A question on it ended in a release this sitting, and it is not complete. Most urgent. */
  released: RecapItem[];
  /** Half filled: some answer of theirs was marked *Partly there*, and none *Well done*. */
  partial: RecapItem[];
  /** Nothing of theirs on it yet, in deck order. */
  notStarted: RecapItem[];
}

export interface FocusRecapInput {
  /** The file's objectives in deck order, with their fills (`ProgressView.objectives`). */
  objectives: readonly Pick<ProgressObjectiveView, 'objectiveId' | 'title' | 'pages' | 'fill' | 'assumedByDeck'>[];
  /** Every outcome on this file, oldest first. */
  outcomes: readonly Pick<QuizOutcome, 'objectiveId' | 'kind' | 'createdAt'>[];
  /** When the sitting opened, ISO. Outcomes before it are history, not this sitting. */
  since: string;
}

/**
 * The recap, or `null` when there is nothing to say: no objectives yet, or a sitting in which no
 * question was resolved.
 */
export function focusRecap(input: FocusRecapInput): FocusRecap | null {
  const counted = input.objectives.filter((o) => !o.assumedByDeck);
  if (counted.length === 0) return null;
  const inSitting = input.outcomes.filter((o) => o.createdAt >= input.since);
  if (inSitting.length === 0) return null;

  // The last thing that happened on each objective this sitting. A release followed by a verdict
  // on a later question is no longer "the answer was shown".
  const lastKind = new Map<string, QuizOutcome['kind']>();
  for (const outcome of inSitting) {
    if (outcome.objectiveId) lastKind.set(outcome.objectiveId, outcome.kind);
  }

  const item = (o: FocusRecapInput['objectives'][number]): RecapItem => ({
    objectiveId: o.objectiveId,
    title: o.title,
    pages: [...o.pages],
  });
  const released: RecapItem[] = [];
  const partial: RecapItem[] = [];
  const notStarted: RecapItem[] = [];
  for (const objective of counted) {
    if (objective.fill === 1) continue;
    if (lastKind.get(objective.objectiveId) === 'released') released.push(item(objective));
    else if (objective.fill === 0.5) partial.push(item(objective));
    else notStarted.push(item(objective));
  }

  return {
    completed: counted.filter((o) => o.fill === 1).length,
    total: counted.length,
    released,
    partial,
    notStarted,
  };
}

/** `p. 12`, `p. 12–14`, `p. 3, 7`: the forms the chat already links (`aitext.ts` `pageRefs`). */
export function pagesLabel(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].filter((p) => Number.isFinite(p)).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (sorted.length === 1) return `p. ${String(first)}`;
  // A run is written as a range; anything with a gap names its first page, which is where the
  // link should land.
  return last - first === sorted.length - 1 ? `p. ${String(first)}–${String(last)}` : `p. ${String(first)}`;
}

function line(label: string, items: readonly RecapItem[]): string | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, RECAP_LIST_CAP).map((i) => {
    const pages = pagesLabel(i.pages);
    return pages ? `**${i.title}** (${pages})` : `**${i.title}**`;
  });
  const more = items.length - shown.length;
  return `- ${label}: ${shown.join('; ')}${more > 0 ? `; and ${String(more)} more` : ''}`;
}

/**
 * The message, as Ellie posts it. Markdown the chat already renders: bold titles, a short list,
 * and `p. N` page links.
 */
export function focusRecapText(recap: FocusRecap): string {
  const head = `Where this file stands: ${String(recap.completed)} of ${String(recap.total)} objectives complete.`;
  if (recap.completed === recap.total) {
    return `${head} Nothing is left open on it.`;
  }
  const lines = [
    line('Answer shown, worth another try', recap.released),
    line('Partly there', recap.partial),
    line('Not started', recap.notStarted),
  ].filter((l): l is string => l !== null);
  return [head, ...lines, 'Pick one and ask me about it, or press Start on its card in the progress bar.'].join('\n');
}
