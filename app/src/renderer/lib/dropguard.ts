/**
 * **Nothing dropped on the window replaces the app** (release review P0-3).
 *
 * Chromium's default for a file dropped on a page — the obvious gesture in a PDF-study app — is to
 * navigate to it: the whole app would be replaced by the PDF viewer, with no Reload in the
 * packaged menu. Main refuses the navigation too (`main/security.ts`); this stops it here first,
 * and gives the drag a "not allowed" cursor instead of a "copy" one.
 *
 * What still works, because it is what the notes editor supports:
 *  - **ProseMirror's own drops**: moving a selection or a block inside the document, and text or
 *    HTML dragged in from elsewhere. ProseMirror's handlers run on the editor's DOM before this
 *    window-level listener, and it `preventDefault`s the drops it takes itself. The schema has no
 *    image or file node, so a file is not one of them.
 *  - **Text dropped into an input or a textarea** (the chat composer), which is the browser's own
 *    default and harmless.
 *
 *  - **Files dropped on a drop zone** (`docs/research/notebooks.md` §1, 2026-10-01): the
 *    Notebooks home and the open notebook's window, which turn a drop into a new notebook or new
 *    sources. A zone is any element marked `data-dropzone` (and everything inside it); the guard
 *    stands aside there entirely, and the zone's own `dragover`/`drop` handlers take the event,
 *    `preventDefault` it and read the paths with `filesToPaths`. Standing aside rather than
 *    half-handling is deliberate: the guard runs after the zone (bubble phase, on the window), and
 *    a guard that still set `dropEffect = 'none'` would turn the zone's "copy" cursor back into
 *    "not allowed" on every frame of the drag.
 *
 * What is refused: **any drag that carries files**, anywhere that is not a drop zone (the title
 * bar, the nav rail, Settings), and text or links dropped anywhere that is not an editable field.
 * A text drag over a drop zone is still refused unless it is over an editable field: a zone takes
 * files, not words.
 */

/** The attribute that marks a drop zone. The value is ignored; its presence is the mark. */
export const DROP_ZONE_ATTR = 'data-dropzone';

export interface DropTargetLike {
  /** `HTMLElement.isContentEditable`, or the element is an `<input>`/`<textarea>`. */
  editable: boolean;
  /** The target is, or is inside, an element marked `data-dropzone`. */
  dropzone?: boolean;
}

/** True when the default drop behaviour must be prevented. `types` is `DataTransfer.types`. */
export function blockDrop(types: readonly string[] | null | undefined, target: DropTargetLike): boolean {
  const list = types ?? [];
  if (list.includes('Files')) return target.dropzone !== true;
  return !target.editable;
}

/** Does a drag carry files (from Finder, a browser download)? `types` is `DataTransfer.types`. */
export function carriesFiles(types: Iterable<string> | null | undefined): boolean {
  if (!types) return false;
  for (const t of types) if (t === 'Files') return true;
  return false;
}

/**
 * **A drop's files, as absolute paths** — the shape `notebookCreate` / `notebookAddSources` take.
 *
 * Electron's sandboxed renderer has no `File.path`; `bridge().pathForFile` asks the preload's
 * `webUtils.getPathForFile`, and it returns an empty string for a file that has no path on disk
 * (an image dragged out of a browser's memory, a mail attachment that was never saved). Those are
 * not guessed at or silently dropped: they come back by name in `refused`, so the zone can say
 * which ones did not go in and why.
 */
export function filesToPaths<F extends { name: string }>(
  files: Iterable<F> | null | undefined,
  pathFor: (file: F) => string,
): { paths: string[]; refused: string[] } {
  const paths: string[] = [];
  const refused: string[] = [];
  for (const file of files ?? []) {
    let path = '';
    try {
      path = pathFor(file) ?? '';
    } catch {
      path = '';
    }
    if (path.trim().length > 0) {
      if (!paths.includes(path)) paths.push(path);
    } else {
      refused.push(file.name || 'A file');
    }
  }
  return { paths, refused };
}

/** The sentence for files that had no path on disk. Null when there were none. */
export function noPathNotice(refused: readonly string[]): string | null {
  if (refused.length === 0) return null;
  const which = refused.length === 1 ? `“${refused[0]}”` : `${refused.length} files`;
  return `${which} could not be added: save ${refused.length === 1 ? 'it' : 'them'} to your Mac first, then drop ${refused.length === 1 ? 'it' : 'them'} again.`;
}

function inDropZone(target: EventTarget | null): boolean {
  const el = target as { closest?: (s: string) => unknown } | null;
  if (!el || typeof el !== 'object' || typeof el.closest !== 'function') return false;
  return el.closest(`[${DROP_ZONE_ATTR}]`) != null;
}

function editable(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null;
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable === true) return true;
  const tag = (el.tagName ?? '').toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    const type = ((el as unknown as HTMLInputElement).type ?? 'text').toLowerCase();
    return ['text', 'search', 'url', 'email', 'password', ''].includes(type);
  }
  return false;
}

/** Installed once, from `main.ts`, in the bubble phase, so ProseMirror sees every drop first. */
export function installDropGuard(target: Pick<Window, 'addEventListener'>): void {
  const guard = (event: DragEvent) => {
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
    if (!blockDrop(types, { editable: editable(event.target), dropzone: inDropZone(event.target) })) return;
    event.preventDefault();
    if (event.dataTransfer && event.type === 'dragover') event.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragover', guard as EventListener);
  target.addEventListener('drop', guard as EventListener);
}
