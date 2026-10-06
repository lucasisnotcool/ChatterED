/**
 * **Folders on the Notebooks home** (`docs/research/search.md` §1, 2026-10-03): the tree's shape
 * and the rules every side agrees on. Pure, so main, the renderer and the mock bridge share one
 * reading of "inside", "above" and "would make a loop".
 *
 * A Finder-style tree. A folder holds folders and notebooks; a notebook sits in exactly one folder
 * or at the top level. `parentId` / `folderId` null is the top level. Search's scope is a folder
 * and everything under it (`subtreeFolderIds`).
 */

/** `fd_<12 hex>`. */
export const FOLDER_ID_PREFIX = 'fd_';

export const DEFAULT_FOLDER_NAME = 'Untitled folder';
export const MAX_FOLDER_NAME_CHARS = 120;

export function isFolderId(id: unknown): id is string {
  return typeof id === 'string' && /^fd_[A-Za-z0-9]+$/.test(id);
}

export interface FolderView {
  id: string;
  name: string;
  /** Null at the top level. */
  parentId: string | null;
  /** The learner's order among siblings. */
  ord: number;
  createdAt: string;
  updatedAt: string;
  /**
   * **Exclude from research data** (migration 032): the folder's own mark. It covers every folder
   * and notebook under it; `researchExcludedFolderIds` gives the effective set.
   */
  researchExclude: boolean;
}

type Tree = readonly Pick<FolderView, 'id' | 'parentId'>[];

/** Root first, `folderId` last; empty for the top level. Stops at a loop or a missing parent. */
export function folderPath<T extends Pick<FolderView, 'id' | 'parentId'>>(folders: readonly T[], folderId: string | null): T[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: T[] = [];
  const seen = new Set<string>();
  let at = folderId ? byId.get(folderId) : undefined;
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    out.unshift(at);
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return out;
}

/** `folderId` and every folder below it. For the top level (null), every folder. */
export function subtreeFolderIds(folders: Tree, folderId: string | null): Set<string> {
  if (folderId === null) return new Set(folders.map((f) => f.id));
  const children = new Map<string | null, string[]>();
  for (const f of folders) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f.id]);
  const out = new Set<string>();
  const stack = [folderId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/**
 * Why a folder cannot move under `parentId`, or null when it can. A folder cannot go inside
 * itself or anything below it, which is the only way a tree grows a loop.
 */
export function moveFolderRefusal(folders: Tree, folderId: string, parentId: string | null): string | null {
  if (parentId === null) return null;
  if (!folders.some((f) => f.id === parentId)) return 'That folder no longer exists.';
  if (subtreeFolderIds(folders, folderId).has(parentId)) return 'A folder cannot go inside itself.';
  return null;
}

/** Children of `parentId` in display order: the learner's `ord`, then name, then id. */
export function childFolders<T extends FolderView>(folders: readonly T[], parentId: string | null): T[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.ord - b.ord || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

/** A name that is not already a sibling's: "Untitled folder", then "Untitled folder 2", … */
export function freshFolderName(siblings: readonly Pick<FolderView, 'name'>[], base = DEFAULT_FOLDER_NAME): string {
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/**
 * **Exclude from research data**, effective (migration 032): every folder marked, and every folder
 * under one. The same reading as main's `research/exclude.ts`, for the home's markers.
 */
export function researchExcludedFolderIds(folders: readonly Pick<FolderView, 'id' | 'parentId' | 'researchExclude'>[]): Set<string> {
  const out = new Set<string>();
  for (const f of folders) if (f.researchExclude) for (const id of subtreeFolderIds(folders, f.id)) out.add(id);
  return out;
}

/**
 * Why an item is left out of the research data: its own mark (`'own'`), the nearest marked folder
 * above it, or null when it is in. For a folder, pass its parent as `folderId`.
 */
export function researchExclusionOf(
  folders: readonly Pick<FolderView, 'id' | 'parentId' | 'researchExclude' | 'name'>[],
  item: { researchExclude: boolean; folderId: string | null },
): { by: 'own' } | { by: 'folder'; folderId: string; name: string } | null {
  if (item.researchExclude) return { by: 'own' };
  const path = folderPath(folders, item.folderId);
  for (let i = path.length - 1; i >= 0; i--) {
    const f = path[i]!;
    if (f.researchExclude) return { by: 'folder', folderId: f.id, name: f.name };
  }
  return null;
}
