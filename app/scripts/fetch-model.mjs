// Downloads the search embedding model into app/models/embeddinggemma-300m/ (gitignored), where
// electron-builder's `extraResources` picks it up and ships it inside the app. Search therefore
// works offline from the first launch; the app never downloads a model at runtime
// (docs/research/search.md §4).
//
// EmbeddingGemma-300m, ONNX q4, from onnx-community/embeddinggemma-300m-ONNX at a pinned commit.
// Every file is checked against the sha256 recorded below, so a changed upstream file fails the
// build instead of shipping. Idempotent: a file already present with the right hash is not
// fetched again, so `npm run build` costs one hash pass (about a second) after the first run.
//
//   node scripts/fetch-model.mjs            # into app/models/embeddinggemma-300m
//   node scripts/fetch-model.mjs --dest DIR # somewhere else (a test, a cache)
//
// Keep REPO and REVISION in step with src/main/search/modelpath.ts (its test checks this).
// No dependencies beyond Node >= 22.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const REPO = 'onnx-community/embeddinggemma-300m-ONNX';
const REVISION = '5090578d9565bb06545b4552f76e6bc2c93e4a66';

/** path in the repo → [bytes, sha256]. From the HF API (`?blobs=true`) and checked by download. */
const FILES = {
  'config.json': [1765, '6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b'],
  'tokenizer.json': [20323312, '4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47'],
  'tokenizer_config.json': [1156830, '3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a'],
  'special_tokens_map.json': [662, '2f7b0adf4fb469770bb1490e3e35df87b1dc578246c5e7e6fc76ecf33213a397'],
  'added_tokens.json': [35, '50b2f405ba56a26d4913fd772089992252d7f942123cc0a034d96424221ba946'],
  'onnx/model_q4.onnx': [519322, 'ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043'],
  'onnx/model_q4.onnx_data': [196725760, '599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02'],
  // The model card, shipped with the model as part of its notice.
  'README.md': [18721, 'fa2c412692dbd5b7ccba2cf6d316b3b58c2642c64e50fa4eee1fc75d95629f0e'],
};

// Gemma Terms of Use §3.1: redistributed copies carry this notice, in a "Notice" text file.
const NOTICE = `Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms

This folder holds EmbeddingGemma-300m (Google DeepMind), as converted to ONNX (q4) by
onnx-community: https://huggingface.co/${REPO}, revision ${REVISION}.
It is redistributed unmodified. README.md in this folder is that repository's model card.

Gemma Terms of Use:            https://ai.google.dev/gemma/terms
Gemma Prohibited Use Policy:   https://ai.google.dev/gemma/prohibited_use_policy

Use of this model is subject to the use restrictions in the Gemma Terms of Use (section 3.2)
and the Gemma Prohibited Use Policy.
`;

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destArg = process.argv.indexOf('--dest');
const dest = destArg > 0 ? resolve(process.argv[destArg + 1]) : join(appDir, 'models', 'embeddinggemma-300m');

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function verified(path, [bytes, sum]) {
  return existsSync(path) && statSync(path).size === bytes && (await sha256(path)) === sum;
}

async function download(file, expect) {
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
  const out = join(dest, file);
  const part = `${out}.part`;
  mkdirSync(dirname(out), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`[model] GET ${url}: HTTP ${res.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const tap = async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      bytes += chunk.length;
      yield chunk;
    }
  };
  try {
    await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(part));
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
  const sum = hash.digest('hex');
  if (bytes !== expect[0] || sum !== expect[1]) {
    rmSync(part, { force: true });
    throw new Error(`[model] ${file}: got ${bytes} bytes sha256 ${sum}, expected ${expect[0]} bytes sha256 ${expect[1]}`);
  }
  renameSync(part, out);
}

let fetched = 0;
for (const [file, expect] of Object.entries(FILES)) {
  const path = join(dest, file);
  if (await verified(path, expect)) continue;
  const mb = (expect[0] / 1e6).toFixed(1);
  console.log(`[model] fetching ${file} (${mb} MB)`);
  await download(file, expect);
  fetched += 1;
}
const noticePath = join(dest, 'NOTICE');
if (!existsSync(noticePath) || readFileSync(noticePath, 'utf8') !== NOTICE) writeFileSync(noticePath, NOTICE);
console.log(
  fetched === 0
    ? `[model] ${REPO}@${REVISION.slice(0, 7)} present and verified in ${dest}`
    : `[model] fetched ${fetched} file(s); ${REPO}@${REVISION.slice(0, 7)} verified in ${dest}`,
);
