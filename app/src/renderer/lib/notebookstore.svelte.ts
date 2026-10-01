/**
 * **The open notebook, for the renderer** (`docs/research/notebooks.md`). Declared by the lead on
 * day 0 (`app/docs/NOTEBOOK-CONTRACT.md`); **track N5 owns this file** and fills it in.
 *
 * Two tracks read it and must not need anything else: the shell (the home grid, the sources
 * panel, the breadcrumb, the chat's "Using 2 of 3 sources") and the editor (citation labels and
 * which source a notebook page's slide comes from, through `shared/notebook.ts`). The fields
 * `view`, `list` and `id` are the frozen surface; the methods below are N5's additions.
 *
 * **It holds nothing authoritative.** `view` is whatever main last returned or pushed on
 * `notebook:changed`; every change the learner makes goes to main and comes back as a view, so a
 * checkbox that main refused springs back rather than lying. Refusals and failures do not throw:
 * they land in `toast` (a dropped Keynote file, a duplicate, a file with no path on disk), which
 * the shell draws for a few seconds, because a refused file is information, not an error.
 *
 * **Why it does not import `store.svelte.ts`**, for the reason `chatstore.svelte.ts` gives: that
 * module hosts this one, and a cycle through a `$state` class bites at module-init time. Opening
 * the chat and progress stores with the notebook id is therefore `store.openNotebook`'s job.
 */

import type { AddSourcesResult, NotebookSummary, NotebookView } from '../../shared/notebook.js';
import { bridge } from './bridge.js';
import { patchList, refusalNotice } from './notebookview.js';

/** How long a transient notice stays on screen. Long enough to read two lines. */
export const TOAST_MS = 4200;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class NotebookStore {
  /** The notebook open in the shell, as main last pushed it. Null on the home screen. */
  view: NotebookView | null = $state(null);
  /** The home grid. */
  list: NotebookSummary[] = $state([]);

  /** The open notebook's id: what the doc, chat and progress stores are opened with. */
  get id(): string | null {
    return this.view?.id ?? null;
  }

  // ── N5 additions ──────────────────────────────────────────────────────────────────────────

  /** The home grid has been asked for once (so the empty state is not drawn before it lands). */
  listed = $state(false);
  /** A create or an add is in flight: the button says so, and a second press waits. */
  busy = $state(false);
  /** A transient line: a refusal, a failure. `token` restarts the timer on a repeat. */
  toast: { text: string; token: number } | null = $state(null);

  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #unsubscribe: (() => void) | null = null;

  /** Show a line for `TOAST_MS`. Also what the shell calls for a drop it refused itself. */
  say(text: string | null): void {
    if (!text) return;
    this.toast = { text, token: (this.toast?.token ?? 0) + 1 };
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => {
      this.toast = null;
    }, TOAST_MS);
  }

  /**
   * Listen to `notebook:changed` once, for the life of the window. A change to the open notebook
   * replaces `view` (a source read, a checkbox from another window, a rename); every change
   * patches its card on the home grid. A notebook deleted while open leaves `view` null, and the
   * shell's route goes home on that.
   */
  subscribe(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = bridge().onNotebookChanged((change) => {
      if (this.view && change.notebookId === this.view.id) this.view = change.view;
      const patched = patchList(this.list, change.notebookId, change.view);
      this.list = patched.list;
      if (!patched.known) void this.loadList();
    });
  }

  async loadList(): Promise<void> {
    try {
      this.list = await bridge().notebookList();
    } catch (err) {
      this.say(message(err));
    } finally {
      this.listed = true;
    }
  }

  /** The learner opened it: main stamps `opened_at` and returns the view. Null on failure. */
  async open(notebookId: string): Promise<NotebookView | null> {
    try {
      const view = await bridge().notebookOpen({ notebookId });
      this.view = view;
      return view;
    } catch (err) {
      this.say(message(err));
      return null;
    }
  }

  close(): void {
    this.view = null;
  }

  /**
   * A new notebook, from files (a drop on the home, the picker) or empty. Returns the new view
   * for the caller to open, or null when nothing was made. Refusals are said; the files that did
   * go in are the notebook's sources either way.
   */
  async create(paths: string[] = []): Promise<NotebookView | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const result = await bridge().notebookCreate({ paths: [...paths] });
      this.say(refusalNotice(result.refused));
      void this.loadList();
      return result.notebook;
    } catch (err) {
      this.say(message(err));
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** New notebook: the picker first; cancelling it makes nothing. */
  async pickAndCreate(): Promise<NotebookView | null> {
    const picked = await this.#pick();
    if (!picked || picked.length === 0) return null;
    return this.create(picked);
  }

  /** Copy files into the open notebook (§1). Each then reads in the background, pushed. */
  async addSources(paths: string[]): Promise<AddSourcesResult | null> {
    const notebookId = this.id;
    if (!notebookId || paths.length === 0 || this.busy) return null;
    this.busy = true;
    try {
      const result = await bridge().notebookAddSources({ notebookId, paths: [...paths] });
      if (this.id === notebookId) this.view = result.notebook;
      this.say(refusalNotice(result.refused));
      return result;
    } catch (err) {
      this.say(message(err));
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** **Add sources**: the picker, into the open notebook. */
  async pickAndAdd(): Promise<void> {
    if (!this.id) return;
    const picked = await this.#pick();
    if (picked && picked.length > 0) await this.addSources(picked);
  }

  /** A checkbox, or **All** with every file id (§2). */
  async setEnabled(fileIds: string[], enabled: boolean): Promise<void> {
    const notebookId = this.id;
    if (!notebookId || fileIds.length === 0) return;
    try {
      const view = await bridge().notebookSetEnabled({ notebookId, fileIds: [...fileIds], enabled });
      if (this.id === notebookId) this.view = view;
    } catch (err) {
      this.say(message(err));
    }
  }

  /** The row's ×. Main asks the learner first; a cancel comes back `removed: false`. */
  async remove(fileId: string): Promise<void> {
    const notebookId = this.id;
    if (!notebookId) return;
    try {
      const result = await bridge().notebookRemoveSource({ notebookId, fileId });
      if (this.id === notebookId) this.view = result.notebook;
    } catch (err) {
      this.say(message(err));
    }
  }

  /** Rename from the breadcrumb or a card's menu. A blank name is not sent. */
  async rename(notebookId: string, name: string): Promise<void> {
    const clean = name.trim();
    if (clean.length === 0) return;
    try {
      const view = await bridge().notebookRename({ notebookId, name: clean });
      if (this.view?.id === notebookId) this.view = view;
      this.list = patchList(this.list, notebookId, view).list;
    } catch (err) {
      this.say(message(err));
    }
  }

  /** Delete from a card's menu. Main confirms with a native sheet; true when it went. */
  async deleteNotebook(notebookId: string): Promise<boolean> {
    try {
      const { deleted } = await bridge().notebookDelete({ notebookId });
      if (deleted) {
        this.list = this.list.filter((n) => n.id !== notebookId);
        if (this.view?.id === notebookId) this.view = null;
      }
      return deleted;
    } catch (err) {
      this.say(message(err));
      return false;
    }
  }

  async #pick(): Promise<string[] | null> {
    try {
      return (await bridge().notebookPickFiles()).paths;
    } catch (err) {
      this.say(message(err));
      return null;
    }
  }
}
