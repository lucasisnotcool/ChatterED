/**
 * **How a query's hits are ranked and built** (`docs/research/search.md` §4–§5). Pure, so the
 * index service (`main/search/index.ts`) and the headless eval (`scripts/search-eval.mjs`) rank
 * exactly alike.
 *
 * Notes, slides and explains are ranked together by cosine similarity (the eval's best system:
 * no keyword fusion, no reranker). A row still waiting for its vector is not left out: those are
 * ranked by keyword and merged in by reciprocal rank. With no query vector, keyword ranks all.
 */
import { explainPlainText } from '../doc/comments.js';
import { keywordScores, stem, tokens } from './keyword.js';
import type { SearchHit } from './types.js';

export const SNIPPET_CHARS = 260;
/** Reciprocal-rank constant for merging the keyword-ranked pending rows in. */
export const RRF_K = 60;

export interface RankRow {
  key: string;
  kind: 'note' | 'page' | 'unit' | 'explain';
  notebookId: string;
  blockIds: string[];
  page: number | null;
  pages: number[];
  section: string[];
  title: string;
  text: string;
  /** What keyword matching reads: an explain row's explain; else the section and the text. */
  match: string;
  vec: Float32Array | null;
}

export interface RankNotebook {
  name: string;
  /** Notes, explain and page rows (not units). */
  rows: RankRow[];
  /** Unit rows by block id (rule 7's highlight). */
  units: Map<string, RankRow>;
  /** Block id → the stored explain comment's body, shown on a hit. */
  explains: ReadonlyMap<string, string>;
}

/** What keyword matching reads for a row: an explain row's explain, else its section and text. */
export function matchText(kind: RankRow['kind'], section: readonly string[], text: string, embedText: string): string {
  if (kind === 'explain') return `${section.join(' ')} ${embedText.slice(embedText.indexOf('\n') + 1)}`;
  return `${section.join(' ')} ${text}`;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function snippetOf(text: string, max = SNIPPET_CHARS): string {
  const flat = text.replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max - 1);
  // Cut mid-word: drop the partial word. Cut at a space: keep every whole word.
  if (flat[max - 1] !== ' ') cut = cut.replace(/\s+\S*$/, '');
  return `${cut.trimEnd()}…`;
}

function stems(text: string): Set<string> {
  return new Set(tokens(text).map(stem));
}

/**
 * Mode `append`'s attribution: a query whose words are in the block's explain and none of them in
 * its notes text was matched through the explain. A heuristic, said so in the UI as "matched".
 */
export function matchedOnlyInExplain(query: string, text: string, explain: string): boolean {
  const q = stems(query);
  if (q.size === 0) return false;
  const inText = stems(text);
  for (const w of q) if (inText.has(w)) return false;
  const inExplain = stems(explainPlainText(explain));
  for (const w of q) if (inExplain.has(w)) return true;
  return false;
}

export interface RankInput {
  query: string;
  qv: Float32Array | null;
  /** The notebooks in scope, by id, in scope order. */
  notebooks: ReadonlyMap<string, RankNotebook>;
  limit: number;
  /** `append` turns on the "matched the explain" attribution of note hits. */
  explainMode?: 'off' | 'append' | 'separate';
}

export interface RankOutput {
  hits: SearchHit[];
  /** Rows in scope still waiting for a vector. */
  pending: number;
  mode: 'semantic' | 'keyword';
}

export function rankQuery(input: RankInput): RankOutput {
  const { qv, query: q, notebooks, limit } = input;
  const rows = [...notebooks.values()].flatMap((n) => n.rows);
  const score = new Map<string, number>();
  let ranked: RankRow[];
  const pending = rows.filter((r) => !r.vec);
  if (qv) {
    const dense = rows.filter((r) => r.vec).map((r) => ({ r, s: dot(qv, r.vec!) }));
    dense.sort((a, b) => b.s - a.s);
    for (const d of dense) score.set(d.r.key, d.s);
    if (pending.length === 0) {
      ranked = dense.map((d) => d.r);
    } else {
      // Rows still waiting for a vector join by keyword, merged by reciprocal rank.
      const kw = keywordScores(q, pending.map((r) => r.match));
      const lexical = pending.map((r, i) => ({ r, s: kw[i]! })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      const rrf = new Map<RankRow, number>();
      dense.forEach((d, i) => rrf.set(d.r, 1 / (RRF_K + i + 1)));
      lexical.forEach((d, i) => rrf.set(d.r, (rrf.get(d.r) ?? 0) + 1 / (RRF_K + i + 1)));
      ranked = [...rrf.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
    }
  } else {
    const kw = keywordScores(q, rows.map((r) => r.match));
    const lexical = rows.map((r, i) => ({ r, s: kw[i]! })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    for (const d of lexical) score.set(d.r.key, d.s);
    ranked = lexical.map((d) => d.r);
  }

  const pageScore = (notebookId: string, page: number): number => score.get(`page:${notebookId}:${page}`) ?? -Infinity;
  const bestPage = (row: RankRow): number | null =>
    row.pages.length === 0 ? null : row.pages.reduce((best, p) => (pageScore(row.notebookId, p) > pageScore(row.notebookId, best) ? p : best), row.pages[0]!);
  const bestUnit = (row: RankRow): RankRow | null => {
    const units = row.blockIds.map((b) => notebooks.get(row.notebookId)!.units.get(b)).filter((u): u is RankRow => !!u);
    if (units.length === 0) return null;
    // A learner's label ("PREREQ: HUERISTICS") heads the group; it is never the answer to show
    // while the group has a block with something in it.
    const real = units.filter((u) => u.text.split(/\s+/).filter(Boolean).length > 5);
    const pool = real.length > 0 ? real : units;
    if (!qv) return pool[0]!;
    return pool.reduce((best, u) => ((u.vec ? dot(qv, u.vec) : -1) > (best.vec ? dot(qv, best.vec) : -1) ? u : best));
  };
  const explainOf = (notebookId: string, blockId: string | null): string | null =>
    blockId ? (notebooks.get(notebookId)?.explains.get(blockId) ?? null) : null;

  const hits: SearchHit[] = [];
  const seenPageText = new Map<string, SearchHit>();
  /**
   * A block's explain and the note chunk that holds it are one hit, whichever ranked first. An
   * explain's block is mapped to the note chunks whose blocks contain it (a list item's comment to
   * its list's chunk, through the member it names), and the dedupe keys on those chunks as well as
   * on the block. `<notebook> <block>` of the note and explain hits so far, and the keys of the
   * note chunks either kind has claimed. (Two rows of one table stay two hits, as they always were.)
   */
  const noteBlocks = new Set<string>();
  const explainBlocks = new Set<string>();
  const noteChunks = new Set<string>();
  const explainChunks = new Set<string>();
  for (const row of ranked) {
    if (hits.length >= limit) break;
    const held = notebooks.get(row.notebookId)!;
    const notebookName = held.name;
    if (row.kind === 'page') {
      // The same slide in two decks of the scope is one hit, "also in" the other.
      const twin = seenPageText.get(row.text);
      if (twin) {
        twin.alsoIn.push({ notebookId: row.notebookId, notebookName, page: row.page! });
        continue;
      }
      // The notes that cite this page: the best-scoring note chunk of the notebook that does.
      const citing = held.rows
        .filter((r) => r.kind === 'note' && r.pages.includes(row.page!))
        .sort((a, b) => (score.get(b.key) ?? -Infinity) - (score.get(a.key) ?? -Infinity))[0];
      const unit = citing ? bestUnit(citing) : null;
      const blockId = unit?.blockIds[0] ?? citing?.blockIds[0] ?? null;
      const hit: SearchHit = {
        key: row.key,
        kind: 'page',
        notebookId: row.notebookId,
        notebookName,
        title: row.title,
        section: row.section,
        snippet: snippetOf(row.text.split('\n').slice(1).join('\n') || row.text),
        heading: row.text.split('\n')[0] ?? '',
        score: score.get(row.key) ?? 0,
        page: row.page,
        blockId,
        blockIds: citing?.blockIds ?? [],
        pages: row.pages,
        alsoIn: [],
        via: 'text',
        explain: explainOf(row.notebookId, blockId),
      };
      seenPageText.set(row.text, hit);
      hits.push(hit);
      continue;
    }
    if (row.kind === 'explain') {
      // The commented block, then (a list's item) the group member that holds it.
      const blockId = row.blockIds[0]!;
      const member = row.blockIds[1] ?? blockId;
      const seen = `${row.notebookId} ${blockId}`;
      const owners = held.rows.filter((r) => r.kind === 'note' && (r.blockIds.includes(member) || r.blockIds.includes(blockId)));
      if (noteBlocks.has(seen) || explainBlocks.has(seen) || owners.some((o) => noteChunks.has(o.key))) continue;
      explainBlocks.add(seen);
      for (const o of owners) explainChunks.add(o.key);
      const owner = owners.find((r) => r.blockIds.includes(member));
      hits.push({
        key: row.key,
        kind: 'note',
        notebookId: row.notebookId,
        notebookName,
        title: row.title,
        section: row.section,
        snippet: snippetOf(row.text),
        heading: row.section.at(-1) ?? row.title,
        score: score.get(row.key) ?? 0,
        page: bestPage(row),
        blockId,
        blockIds: owner?.blockIds ?? [member],
        pages: row.pages,
        alsoIn: [],
        via: 'explain',
        explain: explainOf(row.notebookId, blockId),
      });
      continue;
    }
    const unit = bestUnit(row);
    const blockId = unit?.blockIds[0] ?? row.blockIds[0] ?? null;
    const seen = `${row.notebookId} ${blockId ?? row.key}`;
    if (explainBlocks.has(seen) || explainChunks.has(row.key)) continue;
    noteBlocks.add(seen);
    noteChunks.add(row.key);
    const text = unit?.text ?? row.text;
    const explain = explainOf(row.notebookId, blockId);
    hits.push({
      key: row.key,
      kind: 'note',
      notebookId: row.notebookId,
      notebookName,
      title: row.title,
      section: row.section,
      snippet: snippetOf(text),
      heading: row.section.at(-1) ?? row.title,
      score: score.get(row.key) ?? 0,
      // The slide this note came from: of its provenance pages, the one the query matches best.
      page: bestPage(row),
      blockId,
      blockIds: row.blockIds,
      pages: row.pages,
      alsoIn: [],
      via: input.explainMode === 'append' && explain && matchedOnlyInExplain(q, `${row.section.join(' ')} ${text}`, explain) ? 'explain' : 'text',
      explain,
    });
  }
  return { hits, pending: pending.length, mode: qv ? 'semantic' : 'keyword' };
}
