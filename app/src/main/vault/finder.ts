/**
 * The ⌘K finder's matcher (issue #22 decision 2): fuzzy filename and path matching.
 *
 * Pure and dependency-free. A subsequence match with a positional bonus, which is the shape
 * every editor's "go to file" uses, because it is what makes `ma3236wk4` find
 * `MA3236/Week 4/lecture-notes.pdf` without the learner typing a path separator.
 *
 * Scoring, highest first:
 *   - consecutive matched characters are worth more than scattered ones (a run bonus), so
 *     `hess` beats `h…e…s…s` spread across the path;
 *   - a match at a word boundary (start, after a space, '-', '_', '.', '/') scores extra, which
 *     is what makes an acronym query work;
 *   - a hit in the file *name* outranks the same hit in a parent directory, because the learner
 *     is looking for a file.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the haystack that were matched, for highlighting. */
  positions: number[];
}

const BOUNDARY = new Set([' ', '-', '_', '.', '/', '(', ')', '[', ']']);

function isBoundaryStart(haystack: string, i: number): boolean {
  if (i === 0) return true;
  const prev = haystack[i - 1];
  return prev !== undefined && BOUNDARY.has(prev);
}

/**
 * Greedy left-to-right subsequence match. Greedy is wrong in the worst case (it can take an
 * early character that strands a later one) but it is linear, and the queries here are short
 * enough that the failure is theoretical: the fallback below re-runs from each later start.
 */
function matchOnce(haystack: string, needle: string, from: number): FuzzyMatch | null {
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let run = 0;
  let at = from;
  for (const ch of lowerNeedle) {
    const found = lowerHay.indexOf(ch, at);
    if (found === -1) return null;
    const consecutive = positions.length > 0 && found === positions[positions.length - 1]! + 1;
    run = consecutive ? run + 1 : 0;
    score += 1 + run * 3;
    if (isBoundaryStart(haystack, found)) score += 4;
    if (haystack[found] === needle[positions.length] && needle[positions.length] !== lowerNeedle[positions.length]) {
      score += 1; // an exact-case hit on a capital the learner actually typed
    }
    positions.push(found);
    at = found + 1;
  }
  // Short haystacks win ties: 'notes.md' should beat 'my-other-long-notes-file.md'.
  score += Math.max(0, 24 - haystack.length) / 4;
  return { score, positions };
}

export function fuzzyMatch(haystack: string, needle: string): FuzzyMatch | null {
  if (needle.length === 0) return { score: 0, positions: [] };
  if (needle.length > haystack.length) return null;
  let best = matchOnce(haystack, needle, 0);
  // One retry from the position after the first match, which is enough to fix the common
  // greedy failure (`ab` against `a-b-ab`) without turning this into a full DP.
  if (best && best.positions.length > 0) {
    const retry = matchOnce(haystack, needle, best.positions[0]! + 1);
    if (retry && retry.score > best.score) best = retry;
  }
  return best;
}

export interface FinderCandidate {
  id: string;
  name: string;
  relPath: string;
}

export interface FinderHit<T extends FinderCandidate = FinderCandidate> {
  item: T;
  score: number;
  /** Positions into `relPath`, for highlighting the path in the palette. */
  positions: number[];
}

/**
 * Rank candidates for a ⌘K query. A name match is scored on the name and then given a flat
 * bonus, so `slides.pdf` in a deep folder still beats a directory that merely contains the
 * letters; the reported positions are always relative to `relPath`, because that is what the
 * palette renders.
 */
export function rankFiles<T extends FinderCandidate>(items: T[], query: string, limit = 40): FinderHit<T>[] {
  const q = query.trim();
  if (q.length === 0) return [];
  const hits: FinderHit<T>[] = [];
  for (const item of items) {
    const onPath = fuzzyMatch(item.relPath, q);
    const onName = fuzzyMatch(item.name, q);
    if (!onPath && !onName) continue;
    const offset = item.relPath.length - item.name.length;
    const nameScore = onName ? onName.score + 12 : -Infinity;
    const pathScore = onPath ? onPath.score : -Infinity;
    if (nameScore >= pathScore && onName) {
      hits.push({ item, score: nameScore, positions: onName.positions.map((p) => p + offset) });
    } else if (onPath) {
      hits.push({ item, score: pathScore, positions: onPath.positions });
    }
  }
  hits.sort((a, b) => b.score - a.score || (a.item.relPath < b.item.relPath ? -1 : 1));
  return hits.slice(0, limit);
}
