/**
 * **Keyword scoring for search's fallback** (`docs/research/search.md` §4): used only for chunks
 * whose vectors are not built yet (a deck still being indexed), or when the embedding model is
 * unavailable. Pure BM25 over the chunks it is given, with the eval's typo expansion.
 *
 * Typo expansion: a query word is kept, and joined by any word in the corpus within one or two
 * edits (by length) that is in at least two chunks and five times as common. Not "corrected only when unknown":
 * the learner's own notes contain "HUERISTICS", so "hueristic" is a known word that still needs
 * "heuristic" beside it.
 */

const STOP = new Set(
  'a an the of to in on for and or is are was be by with how what why when which does do vs versus this that it its as at from into about can i my me we you your'.split(' '),
);

export function tokens(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => !STOP.has(w));
}

/** Damerau-Levenshtein (optimal string alignment), stopping early past `cap`. */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** A light English stem so "heuristics" meets "heuristic" and "refining" meets "refine". */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  return w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '');
}

/** The query's words plus their frequent near-spellings from `vocab` (word → document count). */
export function expandQuery(query: string, vocab: ReadonlyMap<string, number>): string[] {
  const out: string[] = [];
  for (const w of tokens(query)) {
    out.push(w);
    if (w.length < 5) continue;
    const own = vocab.get(w) ?? 0;
    const cap = w.length < 8 ? 1 : 2;
    for (const [v, n] of vocab) {
      if (v === w || n < Math.max(2, 5 * own) || v[0] !== w[0] || Math.abs(v.length - w.length) > cap) continue;
      if (editDistance(w, v, cap) <= cap) out.push(v);
    }
  }
  return out;
}

/** BM25 (k1 1.2, b 0.75) of each text against the query, in the texts' order. */
export function keywordScores(query: string, texts: readonly string[]): number[] {
  const docs = texts.map((t) => tokens(t));
  const vocab = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) vocab.set(w, (vocab.get(w) ?? 0) + 1);
  const terms = [...new Set(expandQuery(query, vocab).map(stem))];
  const stemmed = docs.map((d) => d.map(stem));
  const df = new Map<string, number>();
  for (const d of stemmed) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  const avg = stemmed.reduce((s, d) => s + d.length, 0) / Math.max(1, n);
  return stemmed.map((d) => {
    let score = 0;
    for (const t of terms) {
      const f = d.filter((w) => w === t).length;
      if (f === 0) continue;
      const k = df.get(t) ?? 0;
      const idf = Math.log(1 + (n - k + 0.5) / (k + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / Math.max(1, avg)));
    }
    return score;
  });
}
