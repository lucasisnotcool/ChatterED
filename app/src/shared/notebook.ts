/**
 * **Notebooks: the shapes and the page arithmetic** (`docs/research/notebooks.md`, 2026-10-01).
 *
 * A notebook is a named set of sources the learner added; a source is a file copied into app
 * storage. Declared by the lead on day 0 and frozen — see `app/docs/NOTEBOOK-CONTRACT.md`.
 *
 * **The notebook reads as one virtual deck.** Each source has a fixed `pageBase` (migration 024):
 * its page `n` is the notebook's page `pageBase + n`. Every page number that crosses a module
 * boundary on the doc path — a block's `pages`, an objective's refs, `sectionPagesForBlock`,
 * `notes:pageLines`, `notes:pageImages`, a citation chip — is a **notebook page**. Only the code
 * that opens a source's bytes translates to the source's own page, through `locatePage`. That is
 * what lets the page-keyed machinery of #48 run on several files without knowing there are
 * several.
 *
 * Bases are append-only and never reused, so a notebook page keeps naming the same slide after
 * a source is unticked or removed: a removed source's pages become a gap that `locatePage`
 * reports as `null`, and the chip says the source is gone rather than pointing at another file.
 *
 * Pure: imported by main and by the renderer.
 */

import type { SourceRole } from './tutorial.js';

export type { SourceRole } from './tutorial.js';

/** `nb_<12 hex>`. The id the doc, the room, the tree and the outcomes are keyed on. */
export const NOTEBOOK_ID_PREFIX = 'nb_';

export function isNotebookId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(NOTEBOOK_ID_PREFIX);
}

/**
 * The content key of a notebook: what `notes_docs.content_sha`, `quiz_outcomes.content_sha` and
 * `DocHost.fileBytesKey(id).contentSha` carry for it. Stable for the notebook's life, so the doc
 * and its outcomes survive any change to the set of sources.
 */
export function notebookContentKey(notebookId: string): string {
  return `nb:${notebookId}`;
}

/**
 * What a source is, for display and for how its pages are counted.
 *
 * - `pdf` — a page is a PDF page.
 * - `text` — Markdown, plain text, and Word/RTF converted to text on import. A "page" is a run of
 *   paragraphs of about `TEXT_PAGE_WORDS` words, so a long file still cites to a place.
 * - `image` — one page, the image itself.
 */
export type SourceKind = 'pdf' | 'text' | 'image';

/** About how many words make one "page" of a text source. Set at import; never re-paginated. */
export const TEXT_PAGE_WORDS = 400;

export type SourceStatus = 'reading' | 'ready' | 'failed';

export interface NotebookSourceView {
  /** `files.id` of the managed copy. Also what `openDocument` takes for the source's bytes. */
  fileId: string;
  /** The learner's file name as it was added, extension included. */
  name: string;
  kind: SourceKind;
  /** The source's page 1 is notebook page `pageBase + 1`. */
  pageBase: number;
  pageCount: number;
  /** The checkbox: in this notebook's context (the overview, Ellie and Max) or not. */
  enabled: boolean;
  status: SourceStatus;
  /** Why a source failed, in a sentence the learner can act on. */
  error: string | null;
  addedAt: string;
  /**
   * **What the source is in this notebook** (`docs/research/tutorials.md` §1, migration 028): a
   * `lecture` (the default, and every source added before 2026-10-03), a `tutorial` sheet shown
   * beside the notes, or the `solutions` to one tutorial, hidden from every context.
   */
  role: SourceRole;
  /** For `solutions`: the `fileId` of the tutorial they answer, or null when none is chosen. */
  keyFor: string | null;
}

export interface NotebookView {
  id: string;
  name: string;
  /** In the order they were added. */
  sources: NotebookSourceView[];
  /** Notebook pages in use: the highest `pageBase + pageCount` of any source, present or past. */
  pageCount: number;
  /** `contextFingerprint(sources)`, so the renderer can compare it to the overview's. */
  contextFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

/** One card on the Notebooks home. */
export interface NotebookSummary {
  id: string;
  name: string;
  sourceCount: number;
  enabledCount: number;
  /** The overview's title once there is one ("Real World Planning and Acting"), else null. */
  subtitle: string | null;
  /** Objectives completed over objectives counted, 0..1; null before there is a tree. */
  fill: number | null;
  updatedAt: string;
  openedAt: string | null;
  /** The folder it sits in (`shared/folders.ts`), or null at the top level. */
  folderId: string | null;
  /**
   * Its own "Exclude from research data" mark (migration 032). A folder's mark covers it too;
   * `researchExclusionOf` in `shared/folders.ts` reads both.
   */
  researchExclude: boolean;
}

/** What `notebook:duplicate` and `folder:duplicate` return to the renderer. */
export interface DuplicateResult {
  kind: 'notebook' | 'folder';
  /** The copy's id: `nb_…` or `fd_…`. */
  id: string;
  name: string;
  /** Notebooks copied (1 for a notebook). */
  notebooks: number;
  /** Sources whose file was not on disk: their rows are copied, their bytes could not be. */
  missingSources: number;
  researchExclude: boolean;
}

/** Pushed on `notebook:changed` whenever a notebook or one of its sources changed. */
export interface NotebookChange {
  notebookId: string;
  /** The notebook as it now is, or null when it was deleted. */
  view: NotebookView | null;
}

/** Why a file was not added. One per refused file; the rest of a drop still goes in. */
export interface SourceRefusal {
  name: string;
  reason:
    /** Keynote and PowerPoint: there is no converter on the machine. "Export it as a PDF first." */
    | 'unsupported'
    /** Over `MAX_SOURCE_BYTES`. */
    | 'too_big'
    /** The same bytes are already a source of this notebook. */
    | 'duplicate'
    /** It could not be read or copied. */
    | 'unreadable';
  message: string;
}

export interface AddSourcesResult {
  notebook: NotebookView;
  added: NotebookSourceView[];
  refused: SourceRefusal[];
}

/** The same ceiling the vault had (`vault/kinds.ts` MAX_FILE_BYTES). */
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

/** Lower-case extensions, without the dot, that a notebook accepts, and the kind each becomes. */
export const SOURCE_EXTENSIONS: Readonly<Record<string, SourceKind>> = {
  pdf: 'pdf',
  md: 'text',
  markdown: 'text',
  txt: 'text',
  text: 'text',
  // Converted to text on import with macOS `textutil`, which ships with the OS.
  docx: 'text',
  doc: 'text',
  rtf: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
};

/** Recognised but refused with "export it as a PDF first": no converter ships with macOS. */
export const EXPORT_AS_PDF_EXTENSIONS: readonly string[] = ['ppt', 'pptx', 'key', 'pages', 'odp', 'odt'];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function sourceKindFor(name: string): SourceKind | null {
  return SOURCE_EXTENSIONS[extensionOf(name)] ?? null;
}

// ── The page arithmetic ─────────────────────────────────────────────────────────────────────

/** Notebook pages in use: the end of the highest source. 0 for a notebook with no sources. */
export function virtualPageCount(sources: readonly Pick<NotebookSourceView, 'pageBase' | 'pageCount'>[]): number {
  let max = 0;
  for (const s of sources) max = Math.max(max, s.pageBase + s.pageCount);
  return max;
}

/** The `pageBase` the next source added to this notebook gets. */
export function nextPageBase(
  sources: readonly Pick<NotebookSourceView, 'pageBase' | 'pageCount'>[],
  highestEverUsed = 0,
): number {
  return Math.max(virtualPageCount(sources), highestEverUsed);
}

export function toNotebookPage(source: Pick<NotebookSourceView, 'pageBase'>, localPage: number): number {
  return source.pageBase + localPage;
}

/**
 * Which source a notebook page belongs to, and its page number in that source. Null for a page
 * in a gap (a removed source) or out of range. Disabled sources are still found: a citation to
 * an unticked source still opens it.
 */
export function locatePage<S extends Pick<NotebookSourceView, 'pageBase' | 'pageCount'>>(
  sources: readonly S[],
  notebookPage: number,
): { source: S; localPage: number } | null {
  if (!Number.isInteger(notebookPage) || notebookPage < 1) return null;
  for (const source of sources) {
    const local = notebookPage - source.pageBase;
    if (local >= 1 && local <= source.pageCount) return { source, localPage: local };
  }
  return null;
}

/** The notebook pages a source occupies, in order. */
export function pagesOfSource(source: Pick<NotebookSourceView, 'pageBase' | 'pageCount'>): number[] {
  return Array.from({ length: source.pageCount }, (_, i) => source.pageBase + i + 1);
}

/**
 * A fingerprint of what is in context: the ticked, ready sources and their bases. Two calls on
 * the same set give the same string in any order. Stored on the overview as what it was written
 * from (`OverviewMeta.fingerprint`), and compared to tell the learner it is out of date.
 *
 * **Lecture sources only, by default** (`tutorials.md` §1): a tutorial or its solutions are not
 * the overview's to cover, so adding or retyping one must not raise the "not covered" banner. A
 * source with no `role` (a view from before migration 028) counts as a lecture. `roles` widens it
 * for a caller that fingerprints another context (the room's is lecture and tutorial).
 */
export function contextFingerprint(
  sources: readonly (Pick<NotebookSourceView, 'fileId' | 'pageBase' | 'enabled' | 'status'> & { role?: SourceRole })[],
  roles: readonly SourceRole[] = ['lecture'],
): string {
  return sources
    .filter((s) => s.enabled && s.status === 'ready' && roles.includes(s.role ?? 'lecture'))
    .map((s) => `${s.fileId}@${s.pageBase}`)
    .sort()
    .join(',');
}

// ── Citations ───────────────────────────────────────────────────────────────────────────────

/** "Lecture-complex v4.0.pdf" → "Lecture-complex v4.0", shortened to `max` characters. */
export function shortSourceName(name: string, max = 22): string {
  const ext = extensionOf(name);
  const bare = ext ? name.slice(0, -(ext.length + 1)) : name;
  const trimmed = bare.trim() || name;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** [3, 7, 8, 9] → "3, 7–9". */
export function pageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].filter((p) => Number.isInteger(p)).sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j === i ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return runs.join(', ');
}

type CiteSource = Pick<NotebookSourceView, 'name' | 'kind' | 'pageBase' | 'pageCount'>;

/**
 * **A provenance chip's words for notebook pages.** One source in the notebook: `p. 3, 7–9`, as
 * the chip has always read. More than one: the source's short name in front of each group,
 * `Lecture p. 17 · Notes p. 3`. A text source's pages are parts, `§2`; an image is its name.
 * Pages in a gap read `removed source`. Empty input reads ''.
 */
export function citationLabel(sources: readonly CiteSource[], pages: readonly number[]): string {
  if (pages.length === 0) return '';
  const named = sources.length > 1;
  const groups = new Map<CiteSource | null, number[]>();
  for (const p of [...new Set(pages)].sort((a, b) => a - b)) {
    const hit = locatePage(sources, p);
    const key = hit ? hit.source : null;
    const list = groups.get(key) ?? [];
    list.push(hit ? hit.localPage : p);
    groups.set(key, list);
  }
  const parts: string[] = [];
  for (const [source, locals] of groups) {
    if (!source) {
      parts.push('removed source');
      continue;
    }
    const where =
      source.kind === 'image' ? '' : source.kind === 'text' ? `§${pageRanges(locals)}` : `p. ${pageRanges(locals)}`;
    const label = named ? [shortSourceName(source.name, 24), where].filter(Boolean).join(' ') : where || source.name;
    parts.push(label);
  }
  return parts.join(' · ');
}
