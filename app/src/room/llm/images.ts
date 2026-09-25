/**
 * **Slide images, read once and capped** — shared by every API client that sends pixels
 * (#48, `collab-doc.md` §2: the refine pass runs "with the slide images").
 *
 * `LlmRequest.images` carries paths, not bytes (see its doc comment). Each client turns the ones
 * it can send into its own wire shape — Anthropic `image` blocks, OpenAI `image_url` data URLs,
 * Gemini `inline_data` parts — but the three rules are the same everywhere and live here:
 *
 *  1. a media type the providers do not all take is **dropped**, not sent: a rejected request
 *     costs the whole window, a missing slide costs one slide;
 *  2. a page the renderer never delivered is dropped the same way;
 *  3. the running base64 total stops at `IMAGE_BYTES_PER_REQUEST`, so a window loses its last
 *     slides rather than coming back 413 and losing everything. 20 MB of base64 sits under
 *     Anthropic's 32 MB request cap, OpenAI's per-request image budget and Gemini's 20 MB inline
 *     request limit alike — the tightest of the three is the one that binds.
 */
import { readFileSync } from 'node:fs';
import type { LlmRequest } from './types.js';

/** The formats all three providers accept for inline images. */
export const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Base64 characters, across all images of one call. See rule 3 above. */
export const IMAGE_BYTES_PER_REQUEST = 20 * 1024 * 1024;

export interface LoadedImage {
  mime: string;
  /** Base64, no line breaks. */
  data: string;
  page: number;
}

export type ReadFileLike = (path: string) => Buffer;

/** The images this request can carry, in order, within the ceiling. Empty when there are none. */
export function loadImages(
  request: LlmRequest,
  opts: { readFile?: ReadFileLike; allowed?: ReadonlySet<string>; ceiling?: number } = {},
): LoadedImage[] {
  const images = request.images ?? [];
  if (images.length === 0) return [];
  const read = opts.readFile ?? ((p: string) => readFileSync(p));
  const allowed = opts.allowed ?? IMAGE_MEDIA_TYPES;
  const ceiling = opts.ceiling ?? IMAGE_BYTES_PER_REQUEST;
  const out: LoadedImage[] = [];
  let bytes = 0;
  for (const image of images) {
    if (!allowed.has(image.mime)) continue;
    let data: string;
    try {
      data = read(image.path).toString('base64');
    } catch {
      // A page the renderer never delivered is a page this window reads as text only.
      continue;
    }
    bytes += data.length;
    if (bytes > ceiling) break;
    out.push({ mime: image.mime, data, page: image.page });
  }
  return out;
}

/** Index of the last user message — where the window's slide text is, so where its pictures go. */
export function lastUserIndex(request: LlmRequest): number {
  return request.messages.map((m) => m.role).lastIndexOf('user');
}
