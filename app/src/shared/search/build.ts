/**
 * **Everything one notebook puts in the search index** (`docs/research/search.md` §2–§3, §10): its
 * notes doc's chunks and block units, its tutorial sheets' docs' (2026-10-07), its explain chunks
 * (mode `separate`), and one chunk per page of each ready source. Pure, so the index service
 * (`main/search/index.ts`) and the headless eval (`scripts/search-eval.mjs`) build exactly the same
 * rows.
 */
import { noteChunks, pageChunks, tutorialChunks } from './chunk.js';
import type { ExplainMode } from './types.js';

export type IndexRowKind = 'note' | 'page' | 'unit' | 'explain';

/** One `search_chunks` row, before it has a vector. */
export interface IndexRow {
  key: string;
  kind: IndexRowKind;
  blockIds: string[];
  page: number | null;
  pages: number[];
  section: string[];
  title: string;
  text: string;
  embedText: string;
  hash: string;
}

export interface NotebookInput {
  notebookId: string;
  /** The notes doc (`doc_json`, string or parsed) and the title its headers use. */
  doc: { docJson: unknown; title: string } | null;
  /** In the notebook's order. Only `ready` sources are indexed. */
  sources: { displayName: string; pageBase: number; status: string; pages: { page: number; body: string }[] }[];
  /**
   * The notebook's tutorial sheets' docs (`TUTORIAL-CONTRACT.md` S2), in the sources' order: each
   * a `notes_docs` row of its own, chunked by `tutorialChunks`. Omitted or empty: none indexed
   * (the eval's `--no-tutorials`).
   */
  tutorials?: { fileId: string; docJson: unknown; title: string }[];
  /** Block id → explain comment as plain text (`explainPlainText`), the notes' and the sheets'. */
  explains?: ReadonlyMap<string, string>;
  explainMode?: ExplainMode;
}

export function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

export function notebookRows(input: NotebookInput): IndexRow[] {
  const { notebookId } = input;
  const rows: IndexRow[] = [];
  if (input.doc) {
    const title = input.doc.title;
    const { chunks, units } = noteChunks(input.doc.docJson, {
      notebookId,
      title,
      ...(input.explains ? { explains: input.explains } : {}),
      ...(input.explainMode ? { explainMode: input.explainMode } : {}),
    });
    const byBlock = new Map<string, (typeof chunks)[number]>();
    for (const c of chunks) {
      rows.push({ key: c.key, kind: c.kind === 'explain' ? 'explain' : 'note', blockIds: c.blockIds, page: null, pages: c.pages, section: c.section, title, text: c.text, embedText: c.embedText, hash: c.hash });
      if (c.kind === 'note') for (const b of c.blockIds) if (!byBlock.has(b)) byBlock.set(b, c);
    }
    for (const u of units) {
      const owner = byBlock.get(u.blockId);
      rows.push({ key: `unit:${notebookId}:${u.blockId}`, kind: 'unit', blockIds: [u.blockId], page: null, pages: owner?.pages ?? [], section: owner?.section ?? [], title, text: u.text, embedText: u.embedText, hash: u.hash });
    }
  }
  const unitKeys = new Set(rows.filter((r) => r.kind === 'unit').map((r) => r.key));
  for (const t of input.tutorials ?? []) {
    const { chunks, units } = tutorialChunks(t.docJson, {
      notebookId,
      fileId: t.fileId,
      title: t.title,
      ...(input.explains ? { explains: input.explains } : {}),
      ...(input.explainMode ? { explainMode: input.explainMode } : {}),
    });
    const byBlock = new Map<string, (typeof chunks)[number]>();
    for (const c of chunks) {
      rows.push({ key: c.key, kind: c.kind === 'explain' ? 'explain' : 'note', blockIds: c.blockIds, page: null, pages: c.pages, section: c.section, title: t.title, text: c.text, embedText: c.embedText, hash: c.hash });
      if (c.kind === 'note') for (const b of c.blockIds) if (!byBlock.has(b)) byBlock.set(b, c);
    }
    for (const u of units) {
      // Block ids are unique per doc, not per notebook: a clash with another doc's keeps the first.
      const key = `unit:${notebookId}:${u.blockId}`;
      if (unitKeys.has(key)) continue;
      unitKeys.add(key);
      const owner = byBlock.get(u.blockId);
      rows.push({ key, kind: 'unit', blockIds: [u.blockId], page: null, pages: owner?.pages ?? [], section: owner?.section ?? [], title: t.title, text: u.text, embedText: u.embedText, hash: u.hash });
    }
  }
  for (const s of input.sources) {
    if (s.status !== 'ready') continue;
    const title = stripExt(s.displayName);
    const pages = s.pages.map((r) => ({ page: s.pageBase + r.page, text: r.body }));
    for (const c of pageChunks(pages, { notebookId, title })) {
      rows.push({ key: c.key, kind: 'page', blockIds: [], page: c.page, pages: c.pages, section: [title], title, text: c.text, embedText: c.embedText, hash: c.hash });
    }
  }
  return rows;
}
