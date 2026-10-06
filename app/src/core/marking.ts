/**
 * **Max's hidden model answer, and marking by meaning** (6 Oct afternoon, items 3 and 17;
 * `notebooks.md` §11.10, which amends §11.4).
 *
 * The 6 Oct sessions on the MDP deck marked by the slide's words. *"$T(s,a,\cdot)$ must be 1, for a
 * given state and action, to be a valid model"* (#41) and *"the agent must take an action… and an
 * action must have an effect, so all must total 1"* (#43) both had the idea, and both were *Partly
 * there*, because the page's word was "probability distribution". The learner was hunting for a
 * word. So when Max asks, he also writes, privately, a short model answer with its one to three
 * essential points, stored with the question the way a tutorial part stores its hidden key. A
 * feedback turn reports which points the learner's answers state, in any wording; **code** turns
 * that into the verdict: all of them is *Well done*.
 *
 * Pure: parsing the structured replies and deciding the verdict. The schemas the model is held to
 * live with the prompts (`room/prompts.doc.ts`); storage is the question's (`room/flow.ts`).
 */

import type { TurnVerdict } from './quizturn.js';

/** At most this many essential points: more is a checklist, and a checklist is word-hunting again. */
export const MAX_KEY_POINTS = 3;

/** What Max wrote privately when he asked. Never shown to the learner before a release. */
export interface ModelAnswer {
  /** The answer in a sentence or three, in the deck's terms. */
  answer: string;
  /** Its essential points, one to `MAX_KEY_POINTS`, each a short clause. */
  points: string[];
}

/** The object between the first `{` and the last `}`: a model may wrap JSON in prose or a fence. */
function jsonObject(raw: string): Record<string, unknown> | null {
  const from = raw.indexOf('{');
  const to = raw.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(from, to + 1));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * **A question turn's structured reply**: `{ text, model_answer, key_points }`. Anything that does
 * not parse, or has no `text`, is the question as plain words with no model answer, so a backend
 * that ignores the schema (the scripted one) still asks its question and is marked as before.
 */
export function parseQuestionReply(raw: string): { text: string; model: ModelAnswer | null } {
  const parsed = jsonObject(raw);
  const question = text(parsed?.text);
  if (parsed === null || question.length === 0) return { text: raw.trim(), model: null };
  const answer = text(parsed.model_answer);
  const points = (Array.isArray(parsed.key_points) ? parsed.key_points : [])
    .map(text)
    .filter((p) => p.length > 0)
    .slice(0, MAX_KEY_POINTS);
  if (answer.length === 0 || points.length === 0) return { text: question, model: null };
  return { text: question, model: { answer, points } };
}

/**
 * **A feedback turn's structured reply**: `{ text, covered }`, where `covered` lists the numbers
 * (from 1) of the points the learner's answers state. Numbers out of range are dropped. A reply
 * that does not parse is plain words with no coverage, and the verdict is read off the words.
 */
export function parseFeedbackReply(raw: string, pointCount: number): { text: string; covered: number[] | null } {
  const parsed = jsonObject(raw);
  const body = text(parsed?.text);
  if (parsed === null || body.length === 0) return { text: raw.trim(), covered: null };
  if (!Array.isArray(parsed.covered)) return { text: body, covered: null };
  const covered = parsed.covered
    .map((n) => (typeof n === 'number' ? n : typeof n === 'string' ? Number.parseInt(n, 10) : Number.NaN))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pointCount);
  return { text: body, covered: [...new Set(covered)].sort((a, b) => a - b) };
}

/**
 * **Taken together** (`followUpBlock`, 2026-10-03): a point the learner stated on an earlier try
 * stays stated. The union, sorted.
 */
export function coveredUnion(before: readonly number[] | null | undefined, now: readonly number[] | null | undefined): number[] {
  return [...new Set([...(before ?? []), ...(now ?? [])])].sort((a, b) => a - b);
}

/** Every point stated. False when there are no points to state. */
export function allCovered(pointCount: number, covered: readonly number[] | null | undefined): boolean {
  if (pointCount <= 0 || !covered) return false;
  for (let n = 1; n <= pointCount; n += 1) if (!covered.includes(n)) return false;
  return true;
}

/**
 * **The verdict, from the points** (item 3). The model proposes which points the answers state;
 * code decides what that earns:
 *
 *  - every point stated, in any wording: **Well done**, whatever the words said;
 *  - some stated: **Partly there**, never *Well done* and never *Not yet*;
 *  - none stated: what the words said, but never *Well done*.
 *
 * With no points to mark against (an older question, a reply that did not parse) it is `stated`
 * unchanged, or `null` when the words said nothing, and the old reading of the first line stands.
 */
export function verdictFromPoints(input: {
  pointCount: number;
  covered: readonly number[] | null | undefined;
  stated: TurnVerdict | null;
}): TurnVerdict | null {
  if (input.pointCount <= 0 || !input.covered) return input.stated;
  if (allCovered(input.pointCount, input.covered)) return 'complete';
  if (input.covered.length > 0) return 'partial';
  return input.stated === 'complete' || input.stated === null ? 'partial' : input.stated;
}

/**
 * **What a release may credit** (item 17): the points the learner's answers stated, by number, for
 * the release prompt to credit and nothing beyond. Empty when none were, and then the release
 * credits nothing.
 */
export function creditedPoints(model: ModelAnswer | null | undefined, covered: readonly number[] | null | undefined): string[] {
  if (!model || !covered) return [];
  return covered.map((n) => model.points[n - 1]).filter((p): p is string => typeof p === 'string');
}
