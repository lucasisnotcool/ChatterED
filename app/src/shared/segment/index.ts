/**
 * **The segmentation contract.** One import for the flow UI, the repository and the tests:
 *
 * ```ts
 * import { segmentDocument, splitSegment, type Segment } from '../../shared/segment/index.js';
 * ```
 *
 * Nothing in this package imports Electron, SQLite, pdf.js or the DOM; `src/main/vault/geometry.ts`
 * is the one module that does, and it exists only to turn a PDF into `PageGeometry[]`.
 *
 * `app/docs/SEGMENTS.md` is the prose version: types, functions, IPC channels, invariants, and
 * the measured candidate cuts per page of the fixture deck.
 */
export * from './types.js';
export {
  EPS,
  PAGE_BOX,
  clamp01,
  columnGutters,
  contains,
  containsPoint,
  mergedLength,
  nearly,
  overlaps,
  pageTokens,
  textCoverage,
  tokens,
  union,
  wordCount,
} from './boxes.js';
export { buildGroups, containment, type BuildResult } from './builds.js';
export { bodyBoxes, markChrome } from './chrome.js';
export { acceptedCuts, candidatesForPage, horizontalCandidates, verticalCandidates } from './cuts.js';
export { genreSignals, noticeFor, routeGenre } from './genre.js';
export { LABEL_CAP, firstLineIn, labelFor, slideTitle } from './labels.js';
export {
  checkPartition,
  mergeSegments,
  reorderSegments,
  snapTo,
  splitSegment,
  wholePageSegments,
  type MergeResult,
  type SplitRequest,
  type SplitResult,
} from './ops.js';
export { segmentDocument } from './pipeline.js';
