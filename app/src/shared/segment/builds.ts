/**
 * Stage 0 — build groups (`pdf-fidelity-segmentation.md` §A1.5, §C2).
 *
 * A progressive-reveal deck writes the same slide three times, growing. Left alone that is
 * "the single most visible failure of the flow concept: the same slide three times, growing".
 *
 * Two consecutive pages are one build when the page box matches and the **earlier** page's
 * tokens are contained in the later page's at ≥ 95 %. Containment, not equality: a build step
 * may lose a "(cont.)" or gain a bullet, but it may not lose content — a page whose words
 * vanish on the next page is a new slide, not a build step.
 *
 * The **last** page of a run is kept, because it is the complete one.
 */
import { pageTokens } from './boxes.js';
import { DEFAULTS, type BuildGroup, type PageGeometry } from './types.js';

/** Page boxes are equal if both dimensions agree to within a point. */
function sameSize(a: PageGeometry, b: PageGeometry): boolean {
  return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/**
 * Fraction of `earlier`'s tokens that also appear in `later`, counted with multiplicity so
 * that a slide repeating one word ten times cannot be swallowed by a slide using it once.
 *
 * An empty earlier page is contained in anything (1) — a title page with no text followed by
 * its filled-in twin is exactly the build case.
 */
export function containment(earlier: string[], later: string[]): number {
  if (earlier.length === 0) return 1;
  const pool = new Map<string, number>();
  for (const t of later) pool.set(t, (pool.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of earlier) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      pool.set(t, left - 1);
      hit += 1;
    }
  }
  return hit / earlier.length;
}

export interface BuildResult {
  /** The pages to keep, in order, unchanged. */
  kept: PageGeometry[];
  /** One entry per kept page that subsumed at least one earlier page. */
  builds: BuildGroup[];
}

export function buildGroups(
  pages: PageGeometry[],
  opts: { buildContainment?: number } = {},
): BuildResult {
  const threshold = opts.buildContainment ?? DEFAULTS.buildContainment;
  const kept: PageGeometry[] = [];
  const builds: BuildGroup[] = [];
  if (pages.length === 0) return { kept, builds };

  const toks = pages.map(pageTokens);
  let runStart = 0;

  const close = (endExclusive: number): void => {
    const last = pages[endExclusive - 1]!;
    kept.push(last);
    if (endExclusive - runStart > 1) {
      builds.push({
        page: last.page,
        steps: pages.slice(runStart, endExclusive - 1).map((p) => p.page),
      });
    }
  };

  for (let i = 1; i < pages.length; i += 1) {
    const prev = pages[i - 1]!;
    const cur = pages[i]!;
    const isStep =
      sameSize(prev, cur) &&
      toks[i]!.length >= toks[i - 1]!.length &&
      containment(toks[i - 1]!, toks[i]!) >= threshold;
    if (!isStep) {
      close(i);
      runStart = i;
    }
  }
  close(pages.length);
  return { kept, builds };
}
