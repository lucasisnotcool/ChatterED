/**
 * **An image dropped on a sheet** (2026-10-04): the notes or a tutorial sheet. One place for both
 * panes, so the two behave alike.
 *
 * Files go in as sources only on the sources column (`ThreeColumn`). On a sheet, an image is put
 * where it was dropped: it is added to the notebook as an image source (`NotebookStore.addImage`,
 * which waits for main to read it), then inserted as that page, in line, after the block it was
 * dropped on (`dropAnchor`). Anything that is not an image is refused there with a line that says
 * where files go.
 */
import { bridge } from './bridge.js';
import { createImageDrop, dropAnchor, filesToPaths, noPathNotice } from './dropguard.js';
import type { DocStore } from './docstore.svelte.js';
import type { NotebookStore } from './notebookstore.svelte.js';

/** The sheet's top-level blocks under the scroller the drop landed in, with their tops on screen. */
function blocksUnder(target: EventTarget | null): { id: string | null; top: number }[] {
  const el = target as Element | null;
  // The view the drop landed in: with the tutorial split, the top view is a second editor.
  const scroller = el && typeof el.closest === 'function' ? el.closest('.nd-scroll') : null;
  const blocks = scroller?.querySelectorAll<HTMLElement>('.ProseMirror > *') ?? [];
  return [...blocks].map((block) => ({
    // A container (a Q block, a tutorial part) may carry its id on a child; `insertDroppedImage`
    // then puts the image after the whole container.
    id: block.getAttribute('data-block-id') ?? block.querySelector('[data-block-id]')?.getAttribute('data-block-id') ?? null,
    top: block.getBoundingClientRect().top,
  }));
}

export function sheetImageDrop(options: {
  doc: DocStore;
  notebook: NotebookStore;
  /** False while the sheet has no document on screen. */
  accept: () => boolean;
  onover: (over: 'image' | 'refused' | null) => void;
}) {
  const { doc, notebook } = options;
  return createImageDrop<File>({
    accept: options.accept,
    onover: options.onover,
    onrefuse: (notice) => notebook.say(notice),
    ondrop: (images, at) => {
      const anchor = dropAnchor(blocksUnder(at.target), at.y);
      const { paths, refused } = filesToPaths(images, (f) => bridge().pathForFile(f));
      notebook.say(noPathNotice(refused));
      const names = new Map(images.map((f) => [bridge().pathForFile(f), f.name]));
      void (async () => {
        let after = anchor;
        // One at a time, in the order dropped: each goes after the one before it.
        for (const path of paths) {
          const page = await notebook.addImage(path, names.get(path) ?? path.split('/').pop() ?? '');
          if (page === null) continue;
          after = doc.insertDroppedImage(page, after) ?? after;
        }
      })();
    },
  });
}
