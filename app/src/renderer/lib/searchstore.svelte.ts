/**
 * **The search page's state** (`docs/research/search.md` §5): the query, its hits, which hit is
 * picked, which hit each column shows, the three columns' layout and the scope.
 *
 * Kept when the learner leaves the page: coming back shows the same query, the same hit and the
 * same columns. The layout is kept per install in `localStorage`, like the notebook shell's.
 */
import type { SearchHit, SearchResult, SearchStatus } from '../../shared/search/types.js';
import { bridge } from './bridge.js';
import { readColumns, type SearchColumns } from './searchlayout.js';
import { matchesFilter, type HitFilter } from './searchhits.js';

export type { HitFilter };

const COLUMNS_KEY = 'chattered.search.columns';
/** Typing settles this long before a query goes: one query per pause, not per key. */
export const QUERY_DEBOUNCE_MS = 80;

function readStored(): SearchColumns {
  try {
    const raw = globalThis.localStorage?.getItem(COLUMNS_KEY);
    return readColumns(raw ? JSON.parse(raw) : null);
  } catch {
    return readColumns(null);
  }
}

/** What each column shows: a picked hit drives both; before a pick, each shows its own best. */
export function shownHits(hits: readonly SearchHit[], picked: string | null): { slide: SearchHit | null; note: SearchHit | null } {
  const sel = picked ? (hits.find((h) => h.key === picked) ?? null) : null;
  if (sel) return { slide: sel.page !== null ? sel : null, note: sel.blockId !== null ? sel : null };
  // Before a pick: the best-matching slide (Lucas, 3 Oct) and the best notes hit.
  const slide = hits.find((h) => h.kind === 'page') ?? hits.find((h) => h.page !== null) ?? null;
  const note = hits.find((h) => h.kind === 'note') ?? hits.find((h) => h.blockId !== null) ?? null;
  return { slide, note };
}

export class SearchStore {
  query = $state('');
  result: SearchResult | null = $state(null);
  status: SearchStatus | null = $state(null);
  /** The picked hit's key; null shows each column's own best. */
  picked: string | null = $state(null);
  filter: HitFilter = $state('all');
  /** The scope: a folder and everything under it, null for every notebook. */
  folderId: string | null = $state(null);
  columns: SearchColumns = $state(readStored());
  searching = $state(false);
  error: string | null = $state(null);

  #seq = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  get hits(): SearchHit[] {
    const all = this.result?.hits ?? [];
    return this.filter === 'all' ? all : all.filter((h) => matchesFilter(h, this.filter));
  }

  get shown(): { slide: SearchHit | null; note: SearchHit | null } {
    return shownHits(this.result?.hits ?? [], this.picked);
  }

  setQuery(text: string): void {
    this.query = text;
    this.picked = null;
    if (this.#timer) clearTimeout(this.#timer);
    if (text.trim().length === 0) {
      this.#seq += 1;
      this.result = null;
      this.searching = false;
      return;
    }
    this.#timer = setTimeout(() => void this.run(), QUERY_DEBOUNCE_MS);
  }

  /** Run the query now. A newer one supersedes it: a stale answer is dropped, never shown. */
  async run(): Promise<void> {
    const q = this.query.trim();
    if (!q) return;
    const seq = (this.#seq += 1);
    this.searching = true;
    try {
      const result = await bridge().searchQuery({ query: q, folderId: this.folderId });
      if (seq !== this.#seq) return;
      this.result = result;
      this.error = null;
      if (this.picked && !result.hits.some((h) => h.key === this.picked)) this.picked = null;
    } catch (err) {
      if (seq === this.#seq) this.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === this.#seq) this.searching = false;
    }
  }

  async refreshStatus(): Promise<void> {
    try {
      this.status = await bridge().searchStatus({ folderId: this.folderId });
    } catch {
      this.status = null;
    }
  }

  setScope(folderId: string | null): void {
    if (this.folderId === folderId) return;
    this.folderId = folderId;
    this.picked = null;
    void this.refreshStatus();
    if (this.query.trim()) void this.run();
  }

  pick(key: string | null): void {
    this.picked = key;
  }

  /** ↑/↓ through the visible hits; ↑ from the first goes back to "nothing picked". */
  step(dir: 1 | -1): void {
    const hits = this.hits;
    if (hits.length === 0) return;
    const at = this.picked ? hits.findIndex((h) => h.key === this.picked) : -1;
    const next = at + dir;
    this.picked = next < 0 ? null : hits[Math.min(hits.length - 1, next)]!.key;
  }

  setFilter(filter: HitFilter): void {
    this.filter = filter;
    if (this.picked && !this.hits.some((h) => h.key === this.picked)) this.picked = null;
  }

  setColumns(patch: Partial<SearchColumns>): void {
    this.columns = { ...this.columns, ...patch };
    try {
      globalThis.localStorage?.setItem(COLUMNS_KEY, JSON.stringify(this.columns));
    } catch {
      // A denied store only forgets the layout.
    }
  }

  toggle(column: 'slides' | 'notes' | 'hits'): void {
    this.setColumns({ [column]: !this.columns[column] });
  }
}
