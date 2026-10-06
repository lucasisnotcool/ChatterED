/**
 * **Scoring for the headless search eval** (`scripts/search-eval.mjs`; `docs/research/search.md`
 * §7–§8 step 6). Pure: reading the queries file, deciding which hit is correct, and the metrics.
 *
 * A hit is correct when it is in the query's notebook and its pages intersect the query's gold
 * pages. Metrics: **S@1** (the top hit is correct), **S@5** (a correct hit is in the top five),
 * **MRR** (mean of 1 / rank of the first correct hit, 0 when none is), and **N@1** (the top
 * *notes* hit is correct: what the notes column opens on).
 */
import type { SearchHit } from './types.js';

export interface EvalQuery {
  id: string;
  /** The notebook id, resolved from the file's `notebook` or `slug`. */
  notebook: string;
  query: string;
  gold_pages: number[];
  kind: string;
}

export interface Metrics {
  n: number;
  s1: number;
  s5: number;
  mrr: number;
  n1: number;
}

export interface Scored {
  id: string;
  kind: string;
  query: string;
  /** 1-based rank of the first correct hit, or null. */
  rank: number | null;
  /** 1-based rank, among notes hits only, of the first correct one, or null. */
  noteRank: number | null;
  /** Whether a correct hit in the top five came from an explain. */
  viaExplain: boolean;
}

/** `slug=nb_1,other=nb_2` → `{ slug: 'nb_1', other: 'nb_2' }`. */
export function parseMapArg(arg: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of arg.split(',')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const k = pair.slice(0, at).trim();
    const v = pair.slice(at + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/**
 * The queries file → queries with notebook ids. Each entry names its notebook by `notebook` or
 * `slug`, resolved through `map` first, then as a notebook id, then as an exact notebook name.
 * An entry that cannot be resolved or is malformed is reported, not guessed.
 */
export function resolveQueries(
  raw: unknown,
  map: Readonly<Record<string, string>>,
  notebooks: readonly { id: string; name: string }[],
): { queries: EvalQuery[]; errors: string[] } {
  const errors: string[] = [];
  const queries: EvalQuery[] = [];
  if (!Array.isArray(raw)) return { queries, errors: ['the queries file must hold a JSON array'] };
  const ids = new Set(notebooks.map((n) => n.id));
  const byName = new Map(notebooks.map((n) => [n.name, n.id]));
  (raw as unknown[]).forEach((entry, i) => {
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const id = typeof e.id === 'string' || typeof e.id === 'number' ? String(e.id) : `#${String(i + 1)}`;
    const ref = typeof e.notebook === 'string' ? e.notebook : typeof e.slug === 'string' ? e.slug : '';
    const query = typeof e.query === 'string' ? e.query.trim() : '';
    const gold = Array.isArray(e.gold_pages) ? (e.gold_pages as unknown[]).filter((p): p is number => typeof p === 'number' && Number.isInteger(p)) : [];
    if (!query || gold.length === 0) return void errors.push(`${id}: needs a query and gold_pages`);
    const notebook = map[ref] ?? (ids.has(ref) ? ref : byName.get(ref));
    if (!notebook || !ids.has(notebook)) return void errors.push(`${id}: no notebook for "${ref}" (use --map ${ref || 'slug'}=nb_…)`);
    queries.push({ id, notebook, query, gold_pages: gold, kind: typeof e.kind === 'string' && e.kind ? e.kind : 'unspecified' });
  });
  return { queries, errors };
}

export function isCorrect(hit: Pick<SearchHit, 'notebookId' | 'pages'>, q: Pick<EvalQuery, 'notebook' | 'gold_pages'>): boolean {
  return hit.notebookId === q.notebook && hit.pages.some((p) => q.gold_pages.includes(p));
}

export function scoreQuery(q: EvalQuery, hits: readonly SearchHit[]): Scored {
  const at = hits.findIndex((h) => isCorrect(h, q));
  const notes = hits.filter((h) => h.kind === 'note');
  const noteAt = notes.findIndex((h) => isCorrect(h, q));
  return {
    id: q.id,
    kind: q.kind,
    query: q.query,
    rank: at < 0 ? null : at + 1,
    noteRank: noteAt < 0 ? null : noteAt + 1,
    viaExplain: hits.slice(0, 5).some((h) => h.via === 'explain' && isCorrect(h, q)),
  };
}

function metrics(rows: readonly Scored[]): Metrics {
  const n = rows.length;
  if (n === 0) return { n, s1: 0, s5: 0, mrr: 0, n1: 0 };
  const share = (f: (r: Scored) => boolean): number => rows.filter(f).length / n;
  return {
    n,
    s1: share((r) => r.rank === 1),
    s5: share((r) => r.rank !== null && r.rank <= 5),
    mrr: rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n,
    n1: share((r) => r.noteRank === 1),
  };
}

export function summarise(rows: readonly Scored[]): { all: Metrics; byKind: Record<string, Metrics> } {
  const kinds = [...new Set(rows.map((r) => r.kind))].sort();
  return { all: metrics(rows), byKind: Object.fromEntries(kinds.map((k) => [k, metrics(rows.filter((r) => r.kind === k))])) };
}

/** A fixed-width table: one line per group, `all` first. */
export function formatSummary(s: { all: Metrics; byKind: Record<string, Metrics> }, label: string): string {
  const f = (x: number): string => x.toFixed(3).replace(/^0/, '');
  const line = (name: string, m: Metrics): string =>
    `${name.padEnd(18)} ${String(m.n).padStart(4)}  ${f(m.s1).padStart(5)}  ${f(m.s5).padStart(5)}  ${f(m.mrr).padStart(5)}  ${f(m.n1).padStart(5)}`;
  return [
    label,
    `${'kind'.padEnd(18)} ${'n'.padStart(4)}  ${'S@1'.padStart(5)}  ${'S@5'.padStart(5)}  ${'MRR'.padStart(5)}  ${'N@1'.padStart(5)}`,
    line('all', s.all),
    ...Object.entries(s.byKind).map(([k, m]) => line(k, m)),
  ].join('\n');
}
