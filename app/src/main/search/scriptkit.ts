/**
 * **What the headless scripts use of the app's own code** (`scripts/import-comments.mjs`,
 * `scripts/search-eval.mjs`). The scripts run under plain Node with the app quit; they bundle this
 * entry with Rolldown (`scripts/lib/loadts.mjs`) so they chunk, rank, embed and import with
 * exactly the code the app runs, not a copy of it.
 */
export { notebookRows, stripExt } from '../../shared/search/build.js';
export { matchText, rankQuery } from '../../shared/search/rank.js';
export { hashText } from '../../shared/search/chunk.js';
export { EXPLAIN_MODES, parseExplainMode } from '../../shared/search/types.js';
export { explainPlainText } from '../../shared/doc/comments.js';
export { formatSummary, parseMapArg, resolveQueries, scoreQuery, summarise } from '../../shared/search/evalscore.js';
export { importComments, parseJsonl } from '../db/repos/comments.js';
export { DOC_PREFIX, MAX_LENGTH, MODEL_DIMS, MODEL_DTYPE, MODEL_ID, MODEL_NAME, QUERY_PREFIX } from './modelpath.js';
