/**
 * Stages 0–3, wired together (`pdf-fidelity-segmentation.md` §C2, in the lazy form issue #25
 * adopted). Stage 4 — the Claude vision call — is **not here and not in A1**: it moved out of
 * the import path entirely, which removes the only API dependency, the only per-page cost and
 * the most visible failure mode from the deadline path (`segmentation-lazy-split.md` §5).
 *
 * Runs once per file at import, keyed on `content_sha`, cached in SQLite, never repeated on
 * reopen. Local, free, offline, and deterministic: the same bytes give the same segmentation.
 */
import { buildGroups } from './builds.js';
import { markChrome } from './chrome.js';
import { candidatesForPage } from './cuts.js';
import { genreSignals, noticeFor, routeGenre } from './genre.js';
import { wholePageSegments } from './ops.js';
import { DEFAULTS, type PageGeometry, type Segmentation, type SegmentOptions } from './types.js';

export function segmentDocument(
  raw: PageGeometry[],
  opts: Partial<SegmentOptions> = {},
): Segmentation {
  const o = { ...DEFAULTS, ...opts };

  // Stage 0 first, so every later stage counts *slides*, not build steps. Chrome share and
  // words-per-page would both be skewed by a deck that repeats one slide four times.
  const { kept, builds } = buildGroups(raw, o);
  // Stage 2 — chrome is a document-level judgement, so it runs before Stage 3 reads a page.
  const pages = markChrome(kept, o);

  const signals = genreSignals(pages);
  const genre = routeGenre(signals);

  // Issue #25 decision 5: only slides produce candidates in A1. The other genres are not
  // *wrong*, they are unbuilt — §D2/§D4 show full-width cuts on a paper mostly measure the
  // footer, and a well-set book page has no whitespace at all.
  const candidates = genre === 'slides' ? pages.flatMap((p) => candidatesForPage(p, o)) : [];

  return {
    genre,
    signals,
    notice: noticeFor(genre),
    pages,
    builds,
    segments: wholePageSegments(pages),
    candidates,
  };
}
