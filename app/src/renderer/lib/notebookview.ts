/**
 * **The shell's words and arithmetic for notebooks** (`docs/research/notebooks.md` §1, §2, §6).
 *
 * Pure, so it is tested without a DOM: what a source row says under its name, what the All box
 * shows, the chat header's *Using 2 of 3 sources*, a home card's second line, Ellie's greeting
 * when the overview has none, and how a pushed `NotebookView` patches the home grid. The
 * components (`NotebookHome`, `SourcesPanel`, `DocChat`) only lay these out.
 */

import {
  extensionOf,
  type NotebookSourceView,
  type NotebookSummary,
  type NotebookView,
  type SourceRefusal,
} from '../../shared/notebook.js';
import { childFolders, subtreeFolderIds, type FolderView } from '../../shared/folders.js';
import type { OverviewMeta } from '../../shared/doc/types.js';

type ContextSource = Pick<NotebookSourceView, 'enabled' | 'status'>;

/** A source counts as context when it is ticked **and** read: a reading source is not yet. */
export function inContext(source: ContextSource): boolean {
  return source.enabled && source.status === 'ready';
}

/**
 * The chat header's chip, and the sources panel's count (§2): *Using 2 of 3 sources*. The
 * numerator is what Ellie and Max actually read — ticked and ready — over every source the
 * notebook has, ticked or not, so a source still reading lowers the first number until it is in.
 */
export function contextLine(sources: readonly ContextSource[]): string {
  const total = sources.length;
  if (total === 0) return 'No sources yet';
  const using = sources.filter(inContext).length;
  return `Using ${using} of ${total} ${total === 1 ? 'source' : 'sources'}`;
}

/** The sources panel's own count, shorter because it sits beside the column's title. */
export function inUseLine(sources: readonly ContextSource[]): string {
  if (sources.length === 0) return '';
  return `${sources.filter((s) => s.enabled).length} of ${sources.length} in use`;
}

/**
 * **All** (§2): checked when every source is ticked, indeterminate when some are, and a click
 * ticks everything unless everything is already ticked.
 */
export function allState(sources: readonly Pick<NotebookSourceView, 'enabled'>[]): {
  checked: boolean;
  indeterminate: boolean;
  /** What a click on All sets every source to. */
  next: boolean;
} {
  const on = sources.filter((s) => s.enabled).length;
  const every = sources.length > 0 && on === sources.length;
  return { checked: every, indeterminate: on > 0 && !every, next: !every };
}

/** The file-type badge on a source row: `PDF`, `DOCX`, `MD`, `PNG`. At most four letters. */
export function typeBadge(name: string): string {
  const ext = extensionOf(name);
  return ext ? ext.toUpperCase().slice(0, 4) : 'FILE';
}

/** Which tint the badge takes: slides and PDFs, documents, or plain text and images. */
export function badgeTone(name: string): 'pdf' | 'doc' | 'plain' {
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'rtf', 'ppt', 'pptx', 'key', 'pages', 'odt', 'odp'].includes(ext)) return 'doc';
  return 'plain';
}

/**
 * What a source row says under its name: *59 pages · ready*, *Reading…*, *Couldn't read it*,
 * and *· not in use* when it is unticked. A text source's pages are parts of about 400 words
 * (`TEXT_PAGE_WORDS`), so it says parts; an image is one picture and says so.
 */
export function sourceMeta(source: Pick<NotebookSourceView, 'kind' | 'pageCount' | 'status' | 'enabled'>): string {
  if (source.status === 'reading') return 'Reading…';
  if (source.status === 'failed') return 'Couldn’t read it';
  const n = source.pageCount;
  const size =
    source.kind === 'image'
      ? 'image'
      : source.kind === 'text'
        ? `${n} ${n === 1 ? 'part' : 'parts'}`
        : `${n} ${n === 1 ? 'page' : 'pages'}`;
  return `${size} · ${source.enabled ? 'ready' : 'not in use'}`;
}

/** *edited today*, *yesterday*, *3 days ago*, *last week*, *2 Sep*. */
export function editedAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const days = Math.round(day(now) - day(then));
  if (days <= 0) return 'edited today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A home card's second line: *3 sources · edited today*. */
export function cardLine(summary: Pick<NotebookSummary, 'sourceCount' | 'updatedAt'>, now: number): string {
  const n = summary.sourceCount;
  const count = n === 0 ? 'No sources' : `${n} ${n === 1 ? 'source' : 'sources'}`;
  const when = editedAgo(summary.updatedAt, now);
  return when ? `${count} · ${when}` : count;
}

/** The own-words fill as a bar width, `0%` before there is a tree. */
export function fillWidth(fill: number | null): string {
  const f = fill === null || !Number.isFinite(fill) ? 0 : Math.min(1, Math.max(0, fill));
  return `${Math.round(f * 100)}%`;
}

/**
 * **Patch the home grid from a pushed notebook** (`notebook:changed`), so the card behind the
 * open notebook is right when the learner goes back, without re-asking for the whole list. A
 * deleted notebook (`view === null`) leaves the grid. A notebook the grid has never seen is not
 * invented here — its subtitle and fill are main's to compute — so the caller reloads the list.
 */
export function patchList(
  list: readonly NotebookSummary[],
  notebookId: string,
  view: NotebookView | null,
): { list: NotebookSummary[]; known: boolean } {
  const i = list.findIndex((n) => n.id === notebookId);
  if (i < 0) return { list: [...list], known: view === null };
  if (view === null) return { list: list.filter((n) => n.id !== notebookId), known: true };
  const next = [...list];
  next[i] = {
    ...list[i]!,
    name: view.name,
    sourceCount: view.sources.length,
    enabledCount: view.sources.filter((s) => s.enabled).length,
    updatedAt: view.updatedAt,
  };
  return { list: next, known: true };
}

/**
 * One line for a batch of refusals. Main writes each `message` for the learner already
 * ("Keynote files can't be read. Export it as a PDF first."); one refusal is that message, and
 * several are the first one and a count, so the toast stays one line.
 */
export function refusalNotice(refused: readonly SourceRefusal[]): string | null {
  if (refused.length === 0) return null;
  const first = refused[0]!.message || `“${refused[0]!.name}” was not added.`;
  if (refused.length === 1) return first;
  return `${first} (${refused.length - 1} more not added.)`;
}

// ── Ellie's greeting (§6, contract C10) ─────────────────────────────────────────────────────

/**
 * What Ellie says on an empty doc chat when the overview has not written her greeting yet (an
 * overview still being written, or a doc from before migration 024). Static, like the real one:
 * no model call and no room until the learner acts (C10).
 */
export const FALLBACK_GREETING =
  'The overview is short on purpose. Hover any line and press Explain, or ask me here. Your own notes go under each section.';

/** The composer's placeholder on the doc chat while no question is open (§6). */
export const NOTEBOOK_ASK_PLACEHOLDER = 'Ask about this notebook, or @Ellie / @Max…';

/**
 * The greeting and the starter questions the empty doc chat draws. Read **defensively**: the
 * overview may be absent, or a hand-edited row may carry the wrong shapes, and the chat must
 * still open. At most three starters, blank ones dropped, the order the overview gave.
 */
export function greetingOf(overview: unknown): { greeting: string; starters: string[] } {
  const o = (overview && typeof overview === 'object' ? overview : {}) as Partial<OverviewMeta>;
  const greeting = typeof o.greeting === 'string' && o.greeting.trim().length > 0 ? o.greeting.trim() : FALLBACK_GREETING;
  const starters = (Array.isArray(o.starterQuestions) ? o.starterQuestions : [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, 3);
  return { greeting, starters };
}

// ── Folders on the home (`docs/research/search.md` §1) ─────────────────────────────────────

/** The notebooks shown in a folder (null: the top level), in the list's order. */
export function notebooksIn(list: readonly NotebookSummary[], folderId: string | null): NotebookSummary[] {
  return list.filter((n) => (n.folderId ?? null) === folderId);
}

/** How many notebooks a folder holds, its subfolders included: the count on its tile. */
export function folderNotebookCount(
  folders: readonly FolderView[],
  list: readonly NotebookSummary[],
  folderId: string,
): number {
  const inside = subtreeFolderIds(folders, folderId);
  return list.filter((n) => n.folderId !== null && inside.has(n.folderId)).length;
}

export interface MoveTarget {
  /** Null is the top level. */
  folderId: string | null;
  label: string;
  depth: number;
}

/**
 * "Move to…": the top level, then every folder as an indented tree. For a folder being moved,
 * itself and everything under it are left out (a folder cannot go inside itself), and so is the
 * place it already is.
 */
export function moveTargets(folders: readonly FolderView[], moving: { folderId?: string; currentParent: string | null }): MoveTarget[] {
  const blocked = moving.folderId ? subtreeFolderIds(folders, moving.folderId) : new Set<string>();
  const out: MoveTarget[] = [];
  if (moving.currentParent !== null) out.push({ folderId: null, label: 'Notebooks (top level)', depth: 0 });
  const walk = (parentId: string | null, depth: number): void => {
    for (const f of childFolders(folders, parentId)) {
      if (blocked.has(f.id)) continue;
      if (f.id !== moving.currentParent) out.push({ folderId: f.id, label: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Every folder as an indented tree, for the search scope menu. */
export function folderTree(folders: readonly FolderView[]): MoveTarget[] {
  const out: MoveTarget[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const f of childFolders(folders, parentId)) {
      out.push({ folderId: f.id, label: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
