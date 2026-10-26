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

import {
  toNotebookPage,
  type AddSourcesResult,
  type NotebookSourceView,
  type NotebookSummary,
  type NotebookView,
} from '../../shared/notebook.js';
import type { FolderView } from '../../shared/folders.js';
import { bridge } from './bridge.js';
import { patchList, refusalNotice } from './notebookview.js';

/** How long a transient notice stays on screen. Long enough to read two lines. */
export const TOAST_MS = 4200;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const HOME_FOLDER_KEY = 'chattered.home.folder';

function readHomeFolder(): string | null {
  try {
    return globalThis.localStorage?.getItem(HOME_FOLDER_KEY) || null;
  } catch {
    return null;
  }
}

export class NotebookStore {
  /** The notebook open in the shell, as main last pushed it. Null on the home screen. */
  view: NotebookView | null = $state(null);
  /** The home grid. */
  list: NotebookSummary[] = $state([]);

  // ── Folders (`docs/research/search.md` §1) ──────────────────────────────────────────────
  folders: FolderView[] = $state([]);
  /** The folder the home is showing; null is the top level. Kept per install. */
  folderId: string | null = $state(readHomeFolder());

  setFolder(folderId: string | null): void {
    this.folderId = folderId;
    try {
      if (folderId) globalThis.localStorage?.setItem(HOME_FOLDER_KEY, folderId);
      else globalThis.localStorage?.removeItem(HOME_FOLDER_KEY);
    } catch {
      // A denied store only forgets where the home was.
    }
  }

  async loadFolders(): Promise<void> {
    try {
      this.folders = await bridge().folderList();
      // The folder the home remembered was deleted: the top level.
      if (this.folderId && !this.folders.some((f) => f.id === this.folderId)) this.setFolder(null);
    } catch (err) {
      this.say(message(err));
    }
  }

  /** A new folder inside the one on screen. Returns it so the home can open its name for typing. */
  async createFolder(name?: string): Promise<FolderView | null> {
    try {
      const folder = await bridge().folderCreate({ name: name ?? null, parentId: this.folderId });
      await this.loadFolders();
      return folder;
    } catch (err) {
      this.say(message(err));
      return null;
    }
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    if (!name.trim()) return;
    try {
      await bridge().folderRename({ folderId, name: name.trim() });
      await this.loadFolders();
    } catch (err) {
      this.say(message(err));
    }
  }

  async moveFolder(folderId: string, parentId: string | null): Promise<void> {
    try {
      await bridge().folderMove({ folderId, parentId });
      await this.loadFolders();
    } catch (err) {
      this.say(message(err));
    }
  }

  /** Its notebooks and subfolders move up a level; the toast says where they went. */
  async deleteFolder(folderId: string): Promise<void> {
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const into = this.folders.find((f) => f.id === folder.parentId)?.name ?? 'Notebooks';
    try {
      const result = await bridge().folderDelete({ folderId });
      if (!result.deleted) return;
      if (this.folderId === folderId) this.setFolder(folder.parentId);
      await Promise.all([this.loadFolders(), this.loadList()]);
      const moved = result.movedNotebooks + result.movedFolders;
      this.say(moved === 0 ? `Deleted “${folder.name}”.` : `Deleted “${folder.name}”. What was in it is now in ${into}.`);
    } catch (err) {
      this.say(message(err));
    }
  }

  // ── Exclude from research data (migration 032) and Duplicate ──

  async setNotebookResearchExclude(notebookId: string, exclude: boolean): Promise<void> {
    this.list = this.list.map((n) => (n.id === notebookId ? { ...n, researchExclude: exclude } : n));
    try {
      await bridge().notebookSetResearchExclude({ notebookId, exclude });
    } catch (err) {
      this.say(message(err));
    }
    await this.loadList();
  }

  async setFolderResearchExclude(folderId: string, exclude: boolean): Promise<void> {
    this.folders = this.folders.map((f) => (f.id === folderId ? { ...f, researchExclude: exclude } : f));
    try {
      await bridge().folderSetResearchExclude({ folderId, exclude });
    } catch (err) {
      this.say(message(err));
    }
    await this.loadFolders();
  }

  /** A deep copy beside it, excluded from research data. The toast names the copy. */
  async duplicate(kind: 'notebook' | 'folder', id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const out =
        kind === 'notebook'
          ? await bridge().notebookDuplicate({ notebookId: id, researchExclude: true })
          : await bridge().folderDuplicate({ folderId: id, researchExclude: true });
      await this.loadList();
      const missing = out.missingSources > 0 ? ` ${out.missingSources} source file(s) were missing and could not be copied.` : '';
      this.say(`Made “${out.name}”, excluded from research data.${missing}`);
    } catch (err) {
      this.say(message(err));
    } finally {
      this.busy = false;
    }
  }

  async moveNotebook(notebookId: string, folderId: string | null): Promise<void> {
    const before = this.list.find((n) => n.id === notebookId);
    if (!before || before.folderId === folderId) return;
    // Moved on screen at once; the list is reloaded from main after.
    this.list = this.list.map((n) => (n.id === notebookId ? { ...n, folderId } : n));
    try {
      await bridge().notebookMove({ notebookId, folderId });
    } catch (err) {
      this.say(message(err));
    }
    await this.loadList();
  }

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
      // Folders come with the list: every place that refreshes the home refreshes both.
      const [list] = await Promise.all([bridge().notebookList(), this.loadFolders()]);
      this.list = list;
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
  async create(paths: string[] = [], name?: string): Promise<NotebookView | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const result = await bridge().notebookCreate({ paths: [...paths], folderId: this.folderId, name });
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

  /**
   * **An image dropped into the notes or a tutorial sheet** (2026-10-04). It becomes a source, as
   * it would dropped on Sources, because an image in a sheet is a page of the notebook: a
   * `slide_image` cites a notebook page, so the picture keeps its provenance and opens in a slide
   * window like any other. Resolves to that page once main has read the source and fixed its
   * base (`service.ts`: a base is set at `ready`, not at add), or null when it did not go in,
   * which is said in a line. An image that is already a source goes in again from its page
   * rather than being refused as a duplicate.
   */
  async addImage(path: string, name: string): Promise<number | null> {
    const notebookId = this.id;
    if (!notebookId) return null;
    let result: AddSourcesResult;
    try {
      result = await bridge().notebookAddSources({ notebookId, paths: [path] });
    } catch (err) {
      this.say(message(err));
      return null;
    }
    if (this.id !== notebookId) return null;
    this.view = result.notebook;
    const added = result.added[0];
    if (!added) {
      if (result.refused[0]?.reason === 'duplicate') {
        const same = result.notebook.sources.find((s) => s.kind === 'image' && s.name === name && s.status === 'ready');
        if (same) return toNotebookPage(same, 1);
      }
      this.say(refusalNotice(result.refused));
      return null;
    }
    const read = await this.#whenRead(notebookId, added.fileId);
    return read ? toNotebookPage(read, 1) : null;
  }

  /**
   * A source just added, once it is `ready` (its pushes land in `view`), or null if it failed,
   * went, or the notebook closed. An image reads in well under a second; the minute is a ceiling
   * for a queue that is still busy with a long PDF dropped just before it.
   */
  #whenRead(notebookId: string, fileId: string, timeoutMs = 60_000): Promise<NotebookSourceView | null> {
    const started = Date.now();
    return new Promise((resolve) => {
      const check = (): boolean => {
        const source = this.view?.id === notebookId ? this.view.sources.find((s) => s.fileId === fileId) : undefined;
        if (!source) {
          resolve(null);
          return true;
        }
        if (source.status === 'ready') {
          resolve($state.snapshot(source) as NotebookSourceView);
          return true;
        }
        if (source.status === 'failed') {
          this.say(source.error ?? `“${source.name}” could not be read.`);
          resolve(null);
          return true;
        }
        if (Date.now() - started > timeoutMs) {
          this.say(`“${source.name}” is taking a while to read. It is in Sources already; drop it here again once it is ready.`);
          resolve(null);
          return true;
        }
        return false;
      };
      if (check()) return;
      const timer = setInterval(() => {
        if (check()) clearInterval(timer);
      }, 150);
    });
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
