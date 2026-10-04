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
 *    Notebooks home, which turns a drop into a new notebook, and the open notebook's sources
 *    column, which turns it into new sources. Since 2026-10-04 the notes and the tutorial sheet
 *    are zones too, for **images only** (`createImageDrop`): the image goes into the sheet where
 *    it was dropped. A zone is any element marked `data-dropzone` (and everything inside it); the guard
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

/** The part of a `DragEvent` a drop zone reads. */
export interface ZoneDragEvent {
  dataTransfer: {
    types: Iterable<string>;
    dropEffect?: string;
    files?: Iterable<{ name: string }> | null;
    /** While the drag is in the air the files cannot be read, but each item's MIME type can. */
    items?: Iterable<{ kind: string; type: string }> | null;
  } | null;
  preventDefault(): void;
  stopPropagation?(): void;
}

/**
 * **A drop zone's four handlers** (`dragenter`, `dragover`, `dragleave`, `drop`), for an element
 * marked `data-dropzone`.
 *
 * `dragenter` and `dragleave` fire for every child the pointer crosses, so "is a drag over me"
 * is a depth count, not a boolean: entering a child is +1 before leaving the parent is −1, and
 * the overlay would flicker on every row of the sources panel otherwise. Only drags that carry
 * files count; a text drag over the zone is left to the editor and the guard. The handlers
 * `stopPropagation` on a files drop, so a zone nested in another (the sources panel's box inside
 * the notebook window) takes the drop once.
 */
export function createFileDrop<F extends { name: string }>(options: {
  onover: (over: boolean) => void;
  ondrop: (files: F[]) => void;
}): {
  dragenter: (e: ZoneDragEvent) => void;
  dragover: (e: ZoneDragEvent) => void;
  dragleave: (e: ZoneDragEvent) => void;
  drop: (e: ZoneDragEvent) => void;
} {
  let depth = 0;
  const files = (e: ZoneDragEvent) => carriesFiles(e.dataTransfer?.types);
  return {
    dragenter(e) {
      if (!files(e)) return;
      e.preventDefault();
      depth += 1;
      if (depth === 1) options.onover(true);
    },
    dragover(e) {
      if (!files(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    },
    dragleave(e) {
      if (!files(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) options.onover(false);
    },
    drop(e) {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation?.();
      depth = 0;
      options.onover(false);
      options.ondrop([...((e.dataTransfer?.files ?? []) as Iterable<F>)]);
    },
  };
}

// ── images into a sheet (2026-10-04) ────────────────────────────────────────────────────────────

/** The image types a notebook takes as a source (`SOURCE_EXTENSIONS`: png, jpg, gif, webp). */
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/**
 * Does a drag still in the air carry at least one image? Read from `items`, whose MIME types are
 * known before the drop. `null` when the drag cannot say (no `items`): the drop decides then.
 */
export function carriesImage(items: Iterable<{ kind: string; type: string }> | null | undefined): boolean | null {
  if (!items) return null;
  for (const item of items) if (item.kind === 'file' && IMAGE_TYPES.has(item.type.toLowerCase())) return true;
  return false;
}

/** The dropped files that are images a notebook takes, by type or, failing that, by extension. */
export function imageFiles<F extends { name: string; type?: string }>(files: Iterable<F> | null | undefined): F[] {
  const out: F[] = [];
  for (const file of files ?? []) {
    const type = (file.type ?? '').toLowerCase();
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (IMAGE_TYPES.has(type) || (type === '' && IMAGE_EXTENSIONS.has(ext))) out.push(file);
  }
  return out;
}

/** What a sheet says when files that are not images are dropped on it. */
export const NOT_AN_IMAGE_NOTICE = 'Only images can be dropped into the notes. To add a file as a source, drop it on Sources.';

/**
 * **A sheet's drop handlers** (the notes, the tutorial): an image dropped on it is put into it, at
 * the place it was dropped; anything else is refused there, with a "not allowed" cursor while it
 * is dragged and a line saying where files go. A sheet is a drop zone (`data-dropzone`), so the
 * guard stands aside and these must `preventDefault` every files drag themselves, or Chromium
 * would open the file in place of the app.
 *
 * `onover` says what is over the sheet: `'image'` (outline it), `'refused'` (other files: say where
 * they go, because with a "not allowed" cursor Chromium never fires the drop, so a line on drop
 * would never show) or null. `accept` is false while the sheet cannot take an image (no document
 * on screen yet).
 */
export function createImageDrop<F extends { name: string; type?: string }>(options: {
  accept: () => boolean;
  onover: (over: 'image' | 'refused' | null) => void;
  ondrop: (images: F[], at: { x: number; y: number; target: EventTarget | null }) => void;
  onrefuse: (notice: string) => void;
}): {
  dragenter: (e: ZoneDragEvent) => void;
  dragover: (e: ZoneDragEvent) => void;
  dragleave: (e: ZoneDragEvent) => void;
  drop: (e: ZoneDragEvent & { clientX: number; clientY: number; target: EventTarget | null }) => void;
} {
  let depth = 0;
  let current: 'image' | 'refused' | null = null;
  const set = (state: 'image' | 'refused' | null): void => {
    if (state === current) return;
    current = state;
    options.onover(state);
  };
  /**
   * `dragover` repeats every few dozen ms while a drag is over the zone. A drag cancelled with
   * Esc, or one that leaves the window fast, may send no `dragleave`, so a pause in them clears
   * the outline and the hint rather than leaving them up.
   */
  let idle: ReturnType<typeof setTimeout> | null = null;
  const stillOver = (): void => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      depth = 0;
      set(null);
    }, 400);
  };
  const gone = (): void => {
    if (idle) clearTimeout(idle);
    idle = null;
    depth = 0;
    set(null);
  };
  const files = (e: ZoneDragEvent) => carriesFiles(e.dataTransfer?.types);
  const wanted = (e: ZoneDragEvent) => options.accept() && carriesImage(e.dataTransfer?.items) !== false;
  return {
    dragenter(e) {
      if (!files(e)) return;
      e.preventDefault();
      depth += 1;
      if (depth === 1) set(wanted(e) ? 'image' : options.accept() ? 'refused' : null);
      stillOver();
    },
    dragover(e) {
      if (!files(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = wanted(e) ? 'copy' : 'none';
      stillOver();
    },
    dragleave(e) {
      if (!files(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) gone();
    },
    drop(e) {
      if (!files(e)) return;
      e.preventDefault();
      e.stopPropagation?.();
      gone();
      if (!options.accept()) return;
      const images = imageFiles([...((e.dataTransfer?.files ?? []) as Iterable<F>)]);
      if (images.length === 0) {
        options.onrefuse(NOT_AN_IMAGE_NOTICE);
        return;
      }
      options.ondrop(images, { x: e.clientX, y: e.clientY, target: e.target });
    },
  };
}

/**
 * **Where a dropped image goes**: after the top-level block whose top is the last one above the
 * drop point, so a drop on a paragraph lands under it and a drop in the margin beside the last
 * line lands at the end. Null above the first block (the caller's fallback decides). `blocks` are
 * the sheet's top-level blocks in order, with their block ids and their tops on screen.
 */
export function dropAnchor(blocks: readonly { id: string | null; top: number }[], y: number): string | null {
  let anchor: string | null = null;
  for (const block of blocks) {
    if (block.top > y) break;
    if (block.id) anchor = block.id;
  }
  return anchor;
}
