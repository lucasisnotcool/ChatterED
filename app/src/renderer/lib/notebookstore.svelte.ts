/**
 * **The open notebook, for the renderer** (`docs/research/notebooks.md`). Declared by the lead on
 * day 0 (`app/docs/NOTEBOOK-CONTRACT.md`); **track N5 owns this file** and fills it in.
 *
 * Two tracks read it and must not need anything else: the shell (the home grid, the sources
 * panel, the breadcrumb, the chat's "Using 2 of 3 sources") and the editor (citation labels and
 * which source a notebook page's slide comes from, through `shared/notebook.ts`). The fields
 * below are the frozen surface; N5 may add methods but not rename or remove these.
 */

import type { NotebookSummary, NotebookView } from '../../shared/notebook.js';

export class NotebookStore {
  /** The notebook open in the shell, as main last pushed it. Null on the home screen. */
  view: NotebookView | null = $state(null);
  /** The home grid. */
  list: NotebookSummary[] = $state([]);

  /** The open notebook's id: what the doc, chat and progress stores are opened with. */
  get id(): string | null {
    return this.view?.id ?? null;
  }
}
