/**
 * **`notes:pageTexts`: every page's own text, for the slide strips** (2026-10-03).
 *
 * `shared/doc/slidegroups.ts` decides which section of the notes each slide belongs to, and the
 * rules that place a slide nobody cited (a section divider, a References page, a summary) read the
 * slide's words. The renderer has the rendered pages but not their text, so it asks for all of it
 * once per file and keeps it: one call, not one per page like `notes:pageLines`.
 *
 * **The text the vault already indexed** (`file_text`, one row per page, written when a source
 * became ready), the same rows `NotebookHost.textFor` and the room's outline read: no pdf.js, no
 * file read, a single indexed scan per source. A notebook's pages come back as **notebook pages**
 * (each source's own page plus its fixed base), every page of every source whatever its tick, so
 * a slide strip is grouped the same whether or not its source is in context. A page with no text
 * (an image source, a scanned slide, a source still being read) is an empty string, so the
 * renderer can tell "no words" from "not asked".
 */
import type { SqlDatabase } from '../db/driver.js';
import { IPC } from '../../shared/ipc.js';
import { isNotebookId } from '../../shared/notebook.js';
import type { DocHost, IpcHandle } from '../dochost.js';
import { notebooksRepo } from '../notebooks/repo.js';
import { createVaultRepo } from '../vault/repo.js';

/** One source as `notebookPageTexts` needs it: where it sits and what was indexed from it. */
export interface SourcePageRows {
  pageBase: number;
  pageCount: number;
  /** `files.kind`: an image source has no text to read. */
  kind: string | null;
  /** `file_text` rows, the source's own page numbers. A null page is a non-paged chunk. */
  rows: readonly { page: number | null; body: string }[];
}

/**
 * The sources laid end to end, as notebook pages. Pure. Every page in a source's range is present
 * (empty when it has no text); a row outside the source's own range (a re-read that found fewer
 * pages) is dropped rather than spilling into the next source's pages.
 */
export function notebookPageTexts(sources: readonly SourcePageRows[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const source of sources) {
    if (source.pageCount < 1) continue;
    for (let local = 1; local <= source.pageCount; local += 1) out[source.pageBase + local] = '';
    if (source.kind === 'image') continue;
    for (const row of source.rows) {
      if (row.page === null || row.page < 1 || row.page > source.pageCount) continue;
      const page = source.pageBase + row.page;
      out[page] = out[page] ? `${out[page]}\n${row.body.trim()}` : row.body.trim();
    }
  }
  return out;
}

/** A file's or a notebook's page texts, from the index. Unknown ids give an empty record. */
export function pageTextsFor(db: SqlDatabase, fileId: string): Record<number, string> {
  const vault = createVaultRepo(db);
  if (!isNotebookId(fileId)) {
    const rows = vault.text.pages(fileId, null, null).filter((r) => r.page !== null);
    const pageCount = rows.reduce((max, r) => Math.max(max, r.page ?? 0), 0);
    return notebookPageTexts([{ pageBase: 0, pageCount, kind: null, rows }]);
  }
  return notebookPageTexts(
    notebooksRepo(db)
      .sources(fileId)
      .map((record) => ({
        pageBase: record.page_base,
        pageCount: record.page_count,
        kind: record.file_kind,
        rows: record.file_kind === 'image' ? [] : vault.text.pages(record.file_id, null, null),
      })),
  );
}

export function registerPageTextsIpc(host: Pick<DocHost, 'db'>, handle: IpcHandle): void {
  handle<{ fileId: string }>(IPC.notesPageTexts, ({ fileId }) => {
    if (typeof fileId !== 'string' || fileId === '') return {};
    return pageTextsFor(host.db, fileId);
  });
}
