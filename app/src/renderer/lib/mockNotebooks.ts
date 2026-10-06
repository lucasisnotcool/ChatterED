/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING (#58). The notebooks behind `vite dev`: an in-memory
 *  model of what `src/main/notebooks/**` does, so the home grid, the sources
 *  panel and a drop can be built and looked at without Electron.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It keeps main's rules where a renderer could be built against the wrong one: bases are
 * append-only and never reused (`nextPageBase` with the highest base ever used), a source reads
 * in the background and every step is pushed (`reading` → `ready`), a reading source has
 * `pageCount` 0 and gets its fixed `pageBase` only when it is ready, a Keynote file is refused with
 * "export it as a PDF first", the same name twice is a duplicate, removing or deleting asks first
 * (the browser's `confirm` standing in for main's native sheet), and the list sorts by last
 * opened. What it does not have is a disk: a "path" is whatever `pathForFile` gave it, which in
 * the browser is the file's name, and a PDF's page count is made up from the name so a reload
 * draws the same page.
 */

import {
  EXPORT_AS_PDF_EXTENSIONS,
  NOTEBOOK_ID_PREFIX,
  contextFingerprint,
  extensionOf,
  nextPageBase,
  sourceKindFor,
  virtualPageCount,
  type AddSourcesResult,
  type DuplicateResult,
  type NotebookChange,
  type NotebookSourceView,
  type NotebookSummary,
  type NotebookView,
  type SourceRefusal,
} from '../../shared/notebook.js';
import type { SourceRole } from '../../shared/tutorial.js';
import {
  childFolders,
  freshFolderName,
  moveFolderRefusal,
  subtreeFolderIds,
  type FolderView,
} from '../../shared/folders.js';

interface Held {
  id: string;
  name: string;
  sources: NotebookSourceView[];
  /** The highest `pageBase + pageCount` ever used: bases are never reused (C1). */
  highest: number;
  subtitle: string | null;
  fill: number | null;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  folderId?: string | null;
  researchExclude?: boolean;
}

export interface MockNotebookDeps {
  /** `notebook:changed`. */
  push: (change: NotebookChange) => void;
  /** A timer, so a test can drive reading → ready. */
  later: (ms: number, fn: () => void) => void;
  /** Main's native confirm sheet. */
  confirm: (text: string) => boolean;
  now?: () => number;
  /** A notebook's live own-words fill, for the one the mock has objectives for. */
  fillOf?: (notebookId: string) => number | null;
}

/** The last path component: what the learner sees as the file's name. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** A stable small number from a string, so a made-up page count is the same on every reload. */
function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Why a file is not added, before any copy (main's own sentences, in spirit). */
export function refusalFor(name: string, existing: readonly NotebookSourceView[]): SourceRefusal | null {
  const ext = extensionOf(name);
  if (EXPORT_AS_PDF_EXTENSIONS.includes(ext)) {
    return {
      name,
      reason: 'unsupported',
      message: `“${name}” can’t be read here. Export it as a PDF first, then add the PDF.`,
    };
  }
  if (!sourceKindFor(name)) {
    return {
      name,
      reason: 'unsupported',
      message: ext ? `ChatterED can’t read .${ext} files. Add a PDF, Word, Markdown, text or image file.` : `“${name}” has no file type ChatterED can read.`,
    };
  }
  if (existing.some((s) => s.name === name)) {
    return { name, reason: 'duplicate', message: `“${name}” is already in this notebook.` };
  }
  return null;
}

export class MockNotebooks {
  #held = new Map<string, Held>();
  #deps: MockNotebookDeps;

  constructor(deps: MockNotebookDeps) {
    this.#deps = deps;
  }

  #now(): string {
    return new Date(this.#deps.now?.() ?? Date.now()).toISOString();
  }

  /** Put a notebook in as it is, for the fixtures. */
  seed(input: {
    id: string;
    name: string;
    sources: NotebookSourceView[];
    subtitle: string | null;
    fill: number | null;
    updatedAt: string;
    openedAt?: string | null;
  }): void {
    this.#held.set(input.id, {
      id: input.id,
      name: input.name,
      sources: input.sources.map((s) => ({ ...s })),
      highest: virtualPageCount(input.sources),
      subtitle: input.subtitle,
      fill: input.fill,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      openedAt: input.openedAt ?? null,
    });
  }

  has(id: string): boolean {
    return this.#held.has(id);
  }

  view(id: string): NotebookView | null {
    const n = this.#held.get(id);
    if (!n) return null;
    const sources = n.sources.map((s) => ({ ...s }));
    return {
      id: n.id,
      name: n.name,
      sources,
      pageCount: Math.max(n.highest, virtualPageCount(sources)),
      contextFingerprint: contextFingerprint(sources),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  }

  /** Most recently opened first, then most recently edited. */
  list(): NotebookSummary[] {
    const key = (n: Held) => n.openedAt ?? n.updatedAt;
    return [...this.#held.values()]
      .sort((a, b) => key(b).localeCompare(key(a)))
      .map((n) => ({
        id: n.id,
        name: n.name,
        sourceCount: n.sources.length,
        enabledCount: n.sources.filter((s) => s.enabled).length,
        subtitle: n.subtitle,
        fill: this.#deps.fillOf?.(n.id) ?? n.fill,
        updatedAt: n.updatedAt,
        openedAt: n.openedAt,
        folderId: n.folderId ?? null,
        researchExclude: n.researchExclude ?? false,
      }));
  }

  // ── Folders: the same rules as main's service, through `shared/folders.ts` ──
  readonly #folders = new Map<string, FolderView>();

  folders(): FolderView[] {
    return [...this.#folders.values()].map((f) => ({ ...f }));
  }

  #folder(id: string): FolderView {
    const f = this.#folders.get(id);
    if (!f) throw new Error('That folder no longer exists.');
    return f;
  }

  createFolder(input: { name?: string | null; parentId?: string | null }): FolderView {
    const parentId = input.parentId ? this.#folder(input.parentId).id : null;
    const siblings = childFolders(this.folders(), parentId);
    const at = this.#now();
    const id = `fd_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const folder: FolderView = {
      id,
      parentId,
      name: input.name?.trim() || freshFolderName(siblings),
      ord: siblings.length === 0 ? 0 : Math.max(...siblings.map((x) => x.ord)) + 1,
      createdAt: at,
      updatedAt: at,
      researchExclude: false,
    };
    this.#folders.set(id, folder);
    return { ...folder };
  }

  renameFolder(folderId: string, name: string): FolderView {
    const f = this.#folder(folderId);
    if (!name.trim()) throw new Error('A folder needs a name.');
    f.name = name.trim();
    return { ...f };
  }

  moveFolder(folderId: string, parentId: string | null): FolderView {
    const f = this.#folder(folderId);
    const refusal = moveFolderRefusal(this.folders(), folderId, parentId);
    if (refusal) throw new Error(refusal);
    f.parentId = parentId;
    return { ...f };
  }

  // ── Exclude from research data and Duplicate: the mock keeps the flags and copies the cards ──

  setNotebookResearchExclude(notebookId: string, exclude: boolean): NotebookView {
    const n = this.#held.get(notebookId);
    if (!n) throw new Error('That notebook no longer exists.');
    n.researchExclude = exclude;
    return this.view(notebookId)!;
  }

  setFolderResearchExclude(folderId: string, exclude: boolean): FolderView {
    const f = this.#folder(folderId);
    f.researchExclude = exclude;
    return { ...f };
  }

  #copyNotebook(n: Held, name: string, folderId: string | null, researchExclude: boolean): string {
    const id = `nb_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const at = this.#now();
    this.#held.set(id, {
      ...n,
      id,
      name,
      sources: n.sources.map((s) => ({ ...s, fileId: `f_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}` })),
      createdAt: at,
      updatedAt: at,
      openedAt: null,
      fill: null,
      folderId,
      researchExclude,
    });
    return id;
  }

  duplicateNotebook(input: { notebookId: string; name?: string | null; researchExclude?: boolean }): DuplicateResult {
    const n = this.#held.get(input.notebookId);
    if (!n) throw new Error('That notebook no longer exists.');
    const name = input.name?.trim() || `${n.name} (copy)`;
    const researchExclude = input.researchExclude !== false;
    const id = this.#copyNotebook(n, name, n.folderId ?? null, researchExclude);
    return { kind: 'notebook', id, name, notebooks: 1, missingSources: 0, researchExclude };
  }

  duplicateFolder(input: { folderId: string; name?: string | null; researchExclude?: boolean }): DuplicateResult {
    const root = this.#folder(input.folderId);
    const name = input.name?.trim() || `${root.name} (copy)`;
    const researchExclude = input.researchExclude !== false;
    const map = new Map<string, string>();
    let notebooks = 0;
    const walk = (f: FolderView, parentId: string | null, isRoot: boolean) => {
      const copy = this.createFolder({ name: isRoot ? name : f.name, parentId });
      const held = this.#folders.get(copy.id)!;
      held.researchExclude = isRoot ? researchExclude : f.researchExclude;
      map.set(f.id, copy.id);
      for (const n of [...this.#held.values()].filter((x) => x.folderId === f.id)) {
        this.#copyNotebook(n, n.name, copy.id, n.researchExclude ?? false);
        notebooks += 1;
      }
      for (const c of [...this.#folders.values()].filter((x) => x.parentId === f.id && !map.has(x.id) && ![...map.values()].includes(x.id))) {
        walk(c, copy.id, false);
      }
    };
    walk(root, root.parentId, true);
    return { kind: 'folder', id: map.get(root.id)!, name, notebooks, missingSources: 0, researchExclude };
  }

  deleteFolder(folderId: string): { deleted: boolean; movedNotebooks: number; movedFolders: number } {
    const f = this.#folders.get(folderId);
    if (!f) return { deleted: false, movedNotebooks: 0, movedFolders: 0 };
    let movedNotebooks = 0;
    let movedFolders = 0;
    for (const n of this.#held.values()) {
      if (n.folderId !== folderId) continue;
      n.folderId = f.parentId;
      movedNotebooks += 1;
    }
    for (const c of this.#folders.values()) {
      if (c.parentId !== folderId) continue;
      c.parentId = f.parentId;
      movedFolders += 1;
    }
    this.#folders.delete(folderId);
    return { deleted: true, movedNotebooks, movedFolders };
  }

  moveNotebook(notebookId: string, folderId: string | null): NotebookView {
    const n = this.#get(notebookId);
    n.folderId = folderId ? this.#folder(folderId).id : null;
    const view = this.view(n.id)!;
    this.#deps.push({ notebookId: n.id, view });
    return view;
  }

  scopeNotebookIds(folderId: string | null): string[] {
    const inScope = folderId === null ? null : subtreeFolderIds(this.folders(), folderId);
    return [...this.#held.values()].filter((n) => inScope === null || (n.folderId != null && inScope.has(n.folderId))).map((n) => n.id);
  }

  #get(id: string): Held {
    const n = this.#held.get(id);
    if (!n) throw new Error('That notebook no longer exists.');
    return n;
  }

  #changed(n: Held): NotebookView {
    n.updatedAt = this.#now();
    const view = this.view(n.id)!;
    this.#deps.push({ notebookId: n.id, view });
    return view;
  }

  create(input: { name?: string | null; paths?: string[]; folderId?: string | null }): AddSourcesResult {
    const id = `${NOTEBOOK_ID_PREFIX}${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const first = input.paths?.[0];
    const named = input.name?.trim() || (first ? baseName(first).replace(/\.[^.]+$/, '') : '') || 'Untitled notebook';
    const at = this.#now();
    const folderId = input.folderId && this.#folders.has(input.folderId) ? input.folderId : null;
    this.#held.set(id, { id, name: named, sources: [], highest: 0, subtitle: null, fill: null, createdAt: at, updatedAt: at, openedAt: at, folderId });
    if (input.paths && input.paths.length > 0) return this.addSources({ notebookId: id, paths: input.paths });
    return { notebook: this.view(id)!, added: [], refused: [] };
  }

  rename(notebookId: string, name: string): NotebookView {
    const n = this.#get(notebookId);
    n.name = name.trim() || n.name;
    return this.#changed(n);
  }

  delete(notebookId: string): boolean {
    const n = this.#held.get(notebookId);
    if (!n) return false;
    if (!this.#deps.confirm(`Delete “${n.name}”? Its copies of your files are deleted; your originals are not touched.`)) return false;
    this.#held.delete(notebookId);
    this.#deps.push({ notebookId, view: null });
    return true;
  }

  open(notebookId: string): NotebookView {
    const n = this.#get(notebookId);
    n.openedAt = this.#now();
    return this.view(notebookId)!;
  }

  /**
   * Copy files in. Each new source starts `reading` and becomes `ready` a moment later, pushed,
   * as main's background read does; a name with "broken" in it fails, so the failed row can be
   * looked at.
   */
  addSources(input: { notebookId: string; paths: string[] }): AddSourcesResult {
    const n = this.#get(input.notebookId);
    const added: NotebookSourceView[] = [];
    const refused: SourceRefusal[] = [];
    for (const path of input.paths) {
      const name = baseName(path);
      const why = refusalFor(name, [...n.sources, ...added]);
      if (why) {
        refused.push(why);
        continue;
      }
      const kind = sourceKindFor(name)!;
      // Reading: no pages yet, and no base. Main fixes the base when the read is done.
      const source: NotebookSourceView = {
        fileId: `f_${hash(`${n.id}:${name}:${n.highest}:${added.length}`).toString(16).padStart(8, '0')}`,
        name,
        kind,
        pageBase: 0,
        pageCount: 0,
        enabled: true,
        status: 'reading',
        error: null,
        addedAt: this.#now(),
        role: 'lecture',
        keyFor: null,
      };
      added.push(source);
    }
    n.sources.push(...added);
    const notebook = added.length > 0 ? this.#changed(n) : this.view(n.id)!;
    added.forEach((source, i) => {
      this.#deps.later(1400 + i * 700, () => {
        const live = this.#held.get(n.id)?.sources.find((s) => s.fileId === source.fileId);
        if (!live) return;
        const held = this.#held.get(n.id)!;
        if (/broken/i.test(live.name)) {
          live.status = 'failed';
          live.error = 'This file could not be read. It may be damaged or password-protected.';
          live.enabled = false;
        } else {
          const pageCount = live.kind === 'image' ? 1 : live.kind === 'text' ? 1 + (hash(live.name) % 3) : 8 + (hash(live.name) % 33);
          const ready = held.sources.filter((s) => s.status === 'ready');
          live.pageBase = nextPageBase(ready, held.highest);
          live.pageCount = pageCount;
          live.status = 'ready';
          held.highest = Math.max(held.highest, live.pageBase + pageCount);
        }
        this.#changed(held);
      });
    });
    return { notebook, added: added.map((s) => ({ ...s })), refused };
  }

  setEnabled(input: { notebookId: string; fileIds: string[]; enabled: boolean }): NotebookView {
    const n = this.#get(input.notebookId);
    for (const s of n.sources) {
      // A source that failed to read cannot be in context: there is nothing to read.
      if (input.fileIds.includes(s.fileId) && s.status !== 'failed') s.enabled = input.enabled;
    }
    return this.#changed(n);
  }

  /** `notebook:setRole` (tutorials, S1): `keyFor` defaults to the only tutorial, as main's does. */
  setRole(input: { notebookId: string; fileId: string; role: SourceRole; keyFor?: string | null }): NotebookView {
    const n = this.#get(input.notebookId);
    const source = n.sources.find((s) => s.fileId === input.fileId);
    if (source) {
      source.role = input.role;
      const tutorials = n.sources.filter((s) => s.role === 'tutorial' && s.fileId !== input.fileId);
      source.keyFor = input.role === 'solutions' ? (input.keyFor ?? (tutorials.length === 1 ? tutorials[0]!.fileId : null)) : null;
    }
    return this.#changed(n);
  }

  removeSource(input: { notebookId: string; fileId: string }): { removed: boolean; notebook: NotebookView } {
    const n = this.#get(input.notebookId);
    const source = n.sources.find((s) => s.fileId === input.fileId);
    if (!source) return { removed: false, notebook: this.view(n.id)! };
    if (!this.#deps.confirm(`Remove “${source.name}” from this notebook? The copy is deleted; your original is not touched.`)) {
      return { removed: false, notebook: this.view(n.id)! };
    }
    n.sources = n.sources.filter((s) => s.fileId !== input.fileId);
    return { removed: true, notebook: this.#changed(n) };
  }
}
