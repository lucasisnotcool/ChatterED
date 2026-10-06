/**
 * Where the bundled embedding model lives, and which build of it this code expects
 * (docs/research/search.md §4).
 *
 * The model is EmbeddingGemma-300m, ONNX q4, from `onnx-community/embeddinggemma-300m-ONNX`
 * pinned at MODEL_REVISION. It is never downloaded at runtime: `scripts/fetch-model.mjs` puts it
 * in `app/models/embeddinggemma-300m/` at build time, and electron-builder copies that folder to
 * `Contents/Resources/models/` (`extraResources`). Search works offline from the first launch.
 *
 * Keep MODEL_REPO and MODEL_REVISION in step with scripts/fetch-model.mjs (modelpath.test.ts
 * checks it). Changing the revision changes MODEL_ID, which is stored beside every vector, so
 * stored vectors from the old build are re-embedded rather than compared against new ones.
 */
import { join } from 'node:path';

export const MODEL_NAME = 'embeddinggemma-300m';
export const MODEL_REPO = 'onnx-community/embeddinggemma-300m-ONNX';
export const MODEL_REVISION = '5090578d9565bb06545b4552f76e6bc2c93e4a66';
export const MODEL_DTYPE = 'q4';
export const MODEL_DIMS = 768;
export const MODEL_ID = `${MODEL_NAME}-${MODEL_DTYPE}@${MODEL_REVISION}`;

/**
 * EmbeddingGemma's prompts (search.md §4) and the token cap, used by the worker and by the
 * headless eval (`scripts/search-eval.mjs`), so both embed exactly alike.
 */
export const QUERY_PREFIX = 'task: search result | query: ';
export const DOC_PREFIX = 'title: none | text: ';
export const MAX_LENGTH = 512;

/** The files the worker reads. If any is missing the embedder reports itself unavailable. */
export const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  `onnx/model_${MODEL_DTYPE}.onnx`,
  `onnx/model_${MODEL_DTYPE}.onnx_data`,
] as const;

export interface ModelPathInput {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** `process.resourcesPath` (Contents/Resources in a packaged app). */
  resourcesPath: string;
  /** `app.getAppPath()`: the folder holding package.json (`app/`) under `npm run dev`. */
  appPath: string;
}

/** Packaged: `Resources/models/embeddinggemma-300m`. Dev: `app/models/embeddinggemma-300m`. */
export function resolveModelDir(o: ModelPathInput): string {
  return o.packaged ? join(o.resourcesPath, 'models', MODEL_NAME) : join(o.appPath, 'models', MODEL_NAME);
}
