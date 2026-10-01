/**
 * Turning one file on disk into the chunks the full-text index stores (issue #22 decision 2).
 *
 * A PDF becomes one chunk per page, so a search hit can name a page number; Markdown, text and
 * code become a single chunk with `page` null. Nothing here renders, so an image-only PDF
 * yields empty pages rather than an error — that is the "Couldn't read this one — scanned image,
 * maybe?" row in product-design.md §B1, and the row is expected to stay.
 */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MAX_INDEX_BYTES, type FileKind } from './kinds.js';
import { extractPdfText } from './pdf.js';
import type { TextChunk } from './repo.js';

export interface ExtractResult {
  chunks: TextChunk[];
  pageCount: number | null;
  sha256: string;
  size: number;
  mtimeMs: number;
}

/**
 * The copy that goes on the file row when extraction produced nothing usable. Canonical string
 * 1-adjacent: §B1 L213 fixes the wording, and §E4 L1205 says the strings are a design decision,
 * so it is written once, here.
 */
export const NO_TEXT_LAYER = "Couldn't read this one — scanned image, maybe? You can paste the text instead.";
export const TOO_BIG_TO_INDEX = 'Too big to read for search. It still opens in the viewer.';
export const NOT_UTF8 = 'Not text after all — this one is skipped for search.';

/** Bytes that decode as UTF-8 without a replacement character. A .log full of NULs is not text. */
function decodeText(bytes: Buffer): string | null {
  const text = bytes.toString('utf8');
  if (text.includes('�')) return null;
  return text;
}

export async function extractFile(
  absPath: string,
  kind: FileKind,
  opts: {
    /**
     * The size over which a file is not read. The folder vault's `MAX_INDEX_BYTES` by default; a
     * notebook source passes its own ceiling, because a source the learner added on purpose is
     * reading, not a 40 MB log that happened to sit in a folder (a slide PDF with images is
     * easily over 32 MB).
     */
    maxBytes?: number;
  } = {},
): Promise<ExtractResult> {
  const st = await stat(absPath);
  const base = { size: st.size, mtimeMs: Math.round(st.mtimeMs) };

  if (st.size > (opts.maxBytes ?? MAX_INDEX_BYTES)) {
    throw Object.assign(new Error(TOO_BIG_TO_INDEX), { soft: true });
  }

  if (kind === 'pdf') {
    const bytes = await readFile(absPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extracted = await extractPdfText(absPath);
    const chunks = extracted.pages
      .filter((p) => p.text.trim().length > 0)
      .map((p) => ({ page: p.page, body: p.text }));
    if (chunks.length === 0) {
      throw Object.assign(new Error(NO_TEXT_LAYER), { soft: true, pageCount: extracted.pageCount });
    }
    return { chunks, pageCount: extracted.pageCount, sha256, ...base };
  }

  const bytes = await readFile(absPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const text = decodeText(bytes);
  if (text === null) throw Object.assign(new Error(NOT_UTF8), { soft: true });
  return { chunks: [{ page: null, body: text }], pageCount: null, sha256, ...base };
}

/**
 * The text a "Show the room" reference attaches, or that pre-fills session setup.
 *
 * Capped, because it is going into a prompt: the whole point of the page-range picker is that
 * the learner chooses a slide, not a textbook. The cap is applied on a paragraph boundary where
 * one is close enough, so the agents never see a sentence cut mid-word.
 */
export function capText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const hard = text.slice(0, cap);
  const lastBreak = Math.max(hard.lastIndexOf('\n\n'), hard.lastIndexOf('. '));
  return (lastBreak > cap * 0.6 ? hard.slice(0, lastBreak + 1) : hard).trimEnd();
}
