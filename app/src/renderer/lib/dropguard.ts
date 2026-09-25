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
 * What is refused: **any drag that carries files**, anywhere (Finder, a browser download), and
 * text or links dropped anywhere that is not an editable field.
 */

export interface DropTargetLike {
  /** `HTMLElement.isContentEditable`, or the element is an `<input>`/`<textarea>`. */
  editable: boolean;
}

/** True when the default drop behaviour must be prevented. `types` is `DataTransfer.types`. */
export function blockDrop(types: readonly string[] | null | undefined, target: DropTargetLike): boolean {
  const list = types ?? [];
  if (list.includes('Files')) return true;
  return !target.editable;
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
    if (!blockDrop(types, { editable: editable(event.target) })) return;
    event.preventDefault();
    if (event.dataTransfer && event.type === 'dragover') event.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragover', guard as EventListener);
  target.addEventListener('drop', guard as EventListener);
}
