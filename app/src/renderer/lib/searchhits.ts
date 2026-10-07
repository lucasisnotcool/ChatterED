/**
 * **How a search hit is named in the list** (`docs/research/search.md` §5, §10). Pure, so the
 * wording is tested beside it: a slide by its notebook and slide number, a note by its notebook and
 * section, a tutorial sheet's part by its sheet's short name and the part ("Tutorial 3 · Problem 1
 * Part B"), so the learner can tell a worked tutorial answer from the lecture notes at a glance.
 */
import type { SearchHit } from '../../shared/search/types.js';

/** What the list's filters pick out: everything, the notes, the tutorial sheets, the slides. */
export type HitFilter = 'all' | 'note' | 'tutorial' | 'page';

export function matchesFilter(h: Pick<SearchHit, 'kind' | 'tutorial'>, filter: HitFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'page') return h.kind === 'page';
  if (filter === 'tutorial') return h.kind === 'note' && h.tutorial !== null;
  return h.kind === 'note' && h.tutorial === null;
}

/**
 * A sheet's short name: "Tutorial 2 Week 4: Rational Decision Making" → "Tutorial 2"; a title
 * with no tutorial number is cut to `max` characters.
 */
export function tutorialShortName(title: string, max = 24): string {
  const t = title.trim();
  const numbered = /\b(tutorial|tut)\.?\s*(\d+[a-z]?)\b/i.exec(t);
  if (numbered) return `Tutorial ${numbered[2]!}`;
  if (!t) return 'Tutorial';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "Tutorial 2 · Problem 1 Part B": the sheet, then the part (or the problem, for its stem). */
export function tutorialHitLabel(t: NonNullable<SearchHit['tutorial']>): string {
  return [tutorialShortName(t.title), t.label].filter((s): s is string => Boolean(s)).join(' · ');
}

/** The row's "where" line. */
export function hitWhere(h: SearchHit): string {
  if (h.kind === 'page') return `${h.notebookName} · slide ${String(h.page)}`;
  if (h.tutorial) return `${h.notebookName} › ${tutorialHitLabel(h.tutorial)}`;
  return [h.notebookName, ...h.section].filter(Boolean).join(' › ');
}
