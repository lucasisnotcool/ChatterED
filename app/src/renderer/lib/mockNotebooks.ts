/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING (#58). The notebooks behind `vite dev`: an in-memory
 *  model of what `src/main/notebooks/**` does, so the home grid, the sources
 *  panel and a drop can be built and looked at without Electron.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It keeps main's rules where a renderer could be built against the wrong one: bases are
 * append-only and never reused (`nextPageBase` with the highest base ever used), a source reads
 * in the background and every step is pushed (`reading` → `ready`), a Keynote file is refused with
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
  type NotebookChange,
  type NotebookSourceView,
  type NotebookSummary,
  type NotebookView,
  type SourceRefusal,
} from '../../shared/notebook.js';

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
      }));
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

  create(input: { name?: string | null; paths?: string[] }): AddSourcesResult {
    const id = `${NOTEBOOK_ID_PREFIX}${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const first = input.paths?.[0];
    const named = input.name?.trim() || (first ? baseName(first).replace(/\.[^.]+$/, '') : '') || 'Untitled notebook';
    const at = this.#now();
    this.#held.set(id, { id, name: named, sources: [], highest: 0, subtitle: null, fill: null, createdAt: at, updatedAt: at, openedAt: at });
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
      const pageCount = kind === 'image' ? 1 : kind === 'text' ? 1 + (hash(name) % 3) : 8 + (hash(name) % 33);
      const pageBase = nextPageBase([...n.sources, ...added], n.highest);
      const source: NotebookSourceView = {
        fileId: `f_${hash(`${n.id}:${name}:${pageBase}`).toString(16).padStart(8, '0')}`,
        name,
        kind,
        pageBase,
        pageCount,
        enabled: true,
        status: 'reading',
        error: null,
        addedAt: this.#now(),
      };
      n.highest = Math.max(n.highest, pageBase + pageCount);
      added.push(source);
    }
    n.sources.push(...added);
    const notebook = added.length > 0 ? this.#changed(n) : this.view(n.id)!;
    added.forEach((source, i) => {
      this.#deps.later(1400 + i * 700, () => {
        const live = this.#held.get(n.id)?.sources.find((s) => s.fileId === source.fileId);
        if (!live) return;
        if (/broken/i.test(live.name)) {
          live.status = 'failed';
          live.error = 'This file could not be read. It may be damaged or password-protected.';
          live.enabled = false;
        } else {
          live.status = 'ready';
        }
        this.#changed(this.#held.get(n.id)!);
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
