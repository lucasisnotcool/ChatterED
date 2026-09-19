/**
 * **Where the slide images live** (#48, `collab-doc.md` §2).
 *
 * Main cannot rasterise a PDF: `vault/pdf.ts` loads pdf.js with no canvas, and there is no
 * canvas anywhere outside the renderer. So the renderer renders each page once at a modest
 * width and sends the bytes over `notes:pageImages` **before** it asks for the ingest, and this
 * module is where they land: `<userData>/notes-pages/<content_sha>/p-<n>.jpg`.
 *
 * Three properties matter:
 *
 *  - **Keyed on the bytes**, like everything else about a notes doc (#39). The same deck opened
 *    from two folders shares one directory and is rendered once.
 *  - **Files, not memory.** A 66-page deck is tens of megabytes of JPEG; holding it in the main
 *    process for the length of an ingest, on top of the geometry, is a cost with no payer. And
 *    the CLI backend can only be handed a *path* — see `claude-cli.ts` `argsFor`.
 *  - **Entirely optional.** An ingest with no images runs on structured text and geometry alone
 *    (`NotesIngestView.withImages` says which happened). Nothing here throws at the ingest: a
 *    page that is missing is a page that window does not see.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageImage } from '../../shared/doc/types.js';

/** The directory the renderer's images for one deck live in. */
export function pageImageDir(userDataDir: string, contentSha: string): string {
  return join(userDataDir, 'notes-pages', contentSha);
}

function extensionFor(mime: string): string {
  return mime === 'image/png' ? 'png' : 'jpg';
}

function mimeFor(file: string): 'image/jpeg' | 'image/png' | null {
  if (file.endsWith('.jpg')) return 'image/jpeg';
  if (file.endsWith('.png')) return 'image/png';
  return null;
}

/**
 * Write a batch of pages. Returns how many landed.
 *
 * A page that fails to write is skipped rather than thrown: the renderer sends these in
 * batches while the learner is already looking at the file, and one unwritable page must not
 * fail the batch, let alone the ingest that follows it.
 */
export async function storePageImages(
  dir: string,
  images: readonly PageImage[],
): Promise<{ stored: number }> {
  if (images.length === 0) return { stored: 0 };
  await mkdir(dir, { recursive: true });
  let stored = 0;
  for (const image of images) {
    if (!Number.isInteger(image.page) || image.page < 1) continue;
    try {
      await writeFile(join(dir, `p-${image.page}.${extensionFor(image.mime)}`), image.bytes);
      stored += 1;
    } catch {
      continue;
    }
  }
  return { stored };
}

/** One page image on disk, in the shape `LlmRequest.images` takes. */
export interface StoredPageImage {
  path: string;
  mime: string;
  page: number;
}

/**
 * The images for a set of pages, in page order. Pages with no image are simply absent — the
 * window then runs on whatever it does have, which may be nothing.
 */
export async function pageImagesFor(
  dir: string,
  pages: readonly number[],
): Promise<StoredPageImage[]> {
  const wanted = new Set(pages);
  const out: StoredPageImage[] = [];
  for (const page of [...wanted].sort((a, b) => a - b)) {
    for (const ext of ['jpg', 'png'] as const) {
      const path = join(dir, `p-${page}.${ext}`);
      try {
        await stat(path);
        out.push({ path, mime: ext === 'png' ? 'image/png' : 'image/jpeg', page });
        break;
      } catch {
        continue;
      }
    }
  }
  return out;
}

/** How many pages have an image. What decides `NotesIngestView.withImages` before window 1. */
export async function countPageImages(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((f) => f.startsWith('p-') && mimeFor(f) !== null).length;
  } catch {
    return 0;
  }
}

/**
 * Drop a deck's images. Called on a forced re-ingest, so a deck re-rendered at a different width
 * does not leave half the pages at the old one.
 */
export async function clearPageImages(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
