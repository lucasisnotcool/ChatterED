/**
 * A `NotebookHost` that exists only in a test (#58, track N2).
 *
 * Track N1 builds the real one over the managed vault; until it lands the app's stub returns
 * empties, so the overview is built against the interface and tested against this. It keeps the
 * contract's arithmetic honest by using `shared/notebook.ts` for every page translation, and it
 * writes `deckText` the way the contract specifies it: each ticked, ready source under a
 * `=== SOURCE: <name> ===` line, each page under a `[p. N]` line with N the notebook page.
 *
 * Not a `*.test.ts`, so vitest does not collect it as a suite.
 */
import type { NotebookHost, NotebookSubject, LocatedPage } from '../dochost.js';
import {
  contextFingerprint,
  locatePage,
  notebookContentKey,
  virtualPageCount,
  type NotebookSourceView,
  type SourceKind,
} from '../../shared/notebook.js';
import type { SourceRole } from '../../shared/tutorial.js';

export interface FakeSource {
  fileId: string;
  name: string;
  kind?: SourceKind;
  pageBase: number;
  /** One string per page, local page 1 first. */
  pages: string[];
  enabled?: boolean;
  status?: NotebookSourceView['status'];
  /** Null for a source not read yet. Defaults to `sha-<fileId>`. */
  contentSha?: string | null;
  /** Migration 028: `lecture` by default. */
  role?: SourceRole;
  keyFor?: string | null;
}

export interface FakeNotebook {
  host: NotebookHost;
  id: string;
  sources: FakeSource[];
  /** Force `deckText().truncated`. */
  truncated: boolean;
  subject(): NotebookSubject;
}

export function fakeNotebook(id: string, sources: FakeSource[], name = 'Planning'): FakeNotebook {
  const state: FakeNotebook = {
    id,
    sources,
    truncated: false,
    subject: () => subjectOf(),
    host: undefined as unknown as NotebookHost,
  };

  const views = (): NotebookSourceView[] =>
    state.sources.map((s) => ({
      fileId: s.fileId,
      name: s.name,
      kind: s.kind ?? 'pdf',
      pageBase: s.pageBase,
      pageCount: s.pages.length,
      enabled: s.enabled ?? true,
      status: s.status ?? 'ready',
      error: null,
      addedAt: '2026-10-01T09:00:00.000Z',
      role: s.role ?? 'lecture',
      keyFor: s.keyFor ?? null,
    }));

  const subjectOf = (): NotebookSubject => {
    const list = views();
    return {
      id,
      name,
      contentKey: notebookContentKey(id),
      sources: list,
      pageCount: virtualPageCount(list),
      fingerprint: contextFingerprint(list),
    };
  };

  state.host = {
    subject: (notebookId) => (notebookId === id ? subjectOf() : null),
    deckText: (notebookId, opts) => {
      if (notebookId !== id) return { text: '', truncated: false };
      const roles = opts?.roles ?? ['lecture', 'tutorial'];
      const parts: string[] = [];
      for (const s of state.sources) {
        if ((s.enabled ?? true) === false || (s.status ?? 'ready') !== 'ready') continue;
        const role = s.role ?? 'lecture';
        if (role === 'solutions' || !roles.includes(role)) continue;
        parts.push(`=== SOURCE: ${s.name} ===`);
        s.pages.forEach((text, i) => parts.push(`[p. ${s.pageBase + i + 1}]`, text));
      }
      return { text: parts.join('\n'), truncated: state.truncated };
    },
    textFor: ({ notebookId, pageFrom, pageTo, includeSolutions }) => {
      if (notebookId !== id) return '';
      const out: string[] = [];
      for (let p = pageFrom; p <= pageTo; p += 1) {
        const hit = locatePage(state.sources.map((s) => ({ ...s, pageCount: s.pages.length })), p);
        if (hit && hit.source.role === 'solutions' && includeSolutions !== true) continue;
        if (hit) out.push(hit.source.pages[hit.localPage - 1] ?? '');
      }
      return out.join('\n');
    },
    locate: (notebookId, page): LocatedPage | null => {
      if (notebookId !== id) return null;
      const hit = locatePage(state.sources.map((s) => ({ ...s, pageCount: s.pages.length })), page);
      if (!hit) return null;
      const s = hit.source;
      return {
        fileId: s.fileId,
        localPage: hit.localPage,
        path: `/notebooks/${id}/${s.fileId}-${s.name}`,
        kind: s.kind ?? 'pdf',
        contentSha: s.contentSha === undefined ? `sha-${s.fileId}` : s.contentSha,
      };
    },
  };
  return state;
}

/** `n` pages of plain slide text: "Slide <n>: <topic> …". */
export function slides(n: number, topic = 'planning'): string[] {
  return Array.from({ length: n }, (_, i) => `Slide ${i + 1} about ${topic} and the ideas on page ${i + 1}.`);
}
