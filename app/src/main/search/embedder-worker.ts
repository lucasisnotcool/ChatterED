/**
 * The embedding utility process (forked by `embedder.ts`; docs/research/search.md §4).
 *
 * Loads EmbeddingGemma's tokenizer and q4 ONNX model once from the bundled folder, then answers
 * `embed` requests one at a time with L2-normalised 768-d vectors. It never touches the network:
 * `allowRemoteModels` is off and the only model path is the bundled one.
 *
 * Uses the model's own `sentence_embedding` output (AutoModel + AutoTokenizer). The
 * feature-extraction pipeline's mean pooling would skip EmbeddingGemma's Dense projection and
 * give different, worse vectors.
 *
 * `@huggingface/transformers` ships a CommonJS build for Node (`transformers.node.cjs`), so the
 * `import()` below, which tsc compiles to `require()`, loads it directly. It is loaded inside a
 * try so that a broken install becomes a `fatal` message rather than a silent exit.
 */
import { basename, dirname } from 'node:path';
import type { EmbedKind, FromWorker, ToWorker } from './embedder.js';
import { DOC_PREFIX, MAX_LENGTH, MODEL_DTYPE, QUERY_PREFIX } from './modelpath.js';

interface ParentPort {
  on(event: 'message', listener: (e: { data: ToWorker }) => void): void;
  postMessage(message: FromWorker): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!port) throw new Error('embedder-worker must run in an Electron utility process');

type Embed = (kind: EmbedKind, texts: string[]) => Promise<{ dims: number; data: Float32Array }>;

async function load(modelDir: string): Promise<Embed> {
  const { AutoModel, AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  // transformers.js resolves a model id against localModelPath: <parent>/<name>/config.json.
  env.localModelPath = dirname(modelDir);
  env.cacheDir = dirname(modelDir);
  const id = basename(modelDir);
  const tokenizer = await AutoTokenizer.from_pretrained(id, { local_files_only: true });
  const model = await AutoModel.from_pretrained(id, { dtype: MODEL_DTYPE, device: 'cpu', local_files_only: true });

  return async (kind, texts) => {
    const prefix = kind === 'query' ? QUERY_PREFIX : DOC_PREFIX;
    const inputs = await tokenizer(
      texts.map((t) => prefix + t),
      { padding: true, truncation: true, max_length: MAX_LENGTH },
    );
    const out = (await model(inputs)) as { sentence_embedding?: Tensorish };
    if (!out.sentence_embedding) throw new Error('the model returned no sentence_embedding output');
    const normed = out.sentence_embedding.normalize(2, -1);
    const dims = normed.dims[normed.dims.length - 1]!;
    // A fresh Float32Array so the message carries exactly these floats, not an ORT-owned buffer.
    return { dims, data: Float32Array.from(normed.data as Float32Array) };
  };
}

interface Tensorish {
  normalize(p: number, dim: number): Tensorish;
  dims: number[];
  data: ArrayLike<number>;
}

let ready: Promise<Embed> | null = null;
/** Requests run strictly one after another, whatever the parent sends. */
let chain: Promise<void> = Promise.resolve();

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

port.on('message', ({ data: msg }) => {
  if (msg.type === 'init') {
    if (ready) return;
    const t0 = performance.now();
    ready = load(msg.modelDir);
    ready.then(
      () => port.postMessage({ type: 'ready', loadMs: Math.round(performance.now() - t0) }),
      (err: unknown) => port.postMessage({ type: 'fatal', error: errorText(err) }),
    );
    return;
  }
  if (msg.type === 'embed') {
    const { id, kind, texts } = msg;
    chain = chain.then(async () => {
      if (!ready) {
        port.postMessage({ type: 'error', id, error: 'embed before init' });
        return;
      }
      let embed: Embed;
      try {
        embed = await ready;
      } catch {
        return; // already reported as fatal
      }
      try {
        const { dims, data } = await embed(kind, texts);
        port.postMessage({ type: 'result', id, dims, data });
      } catch (err) {
        port.postMessage({ type: 'error', id, error: errorText(err) });
      }
    });
  }
});
