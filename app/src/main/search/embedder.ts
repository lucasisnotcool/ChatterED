/**
 * The main-process side of on-device embedding (docs/research/search.md §4).
 *
 * EmbeddingGemma runs in an Electron **utility process** (`embedder-worker.ts`), not here and not
 * in a worker thread: onnxruntime-node is native code, and a crash in it must cost one search,
 * not the app. This module owns that process:
 *
 * - **Lazy.** Nothing is forked until the first embed call, so a learner who never searches never
 *   pays the ~450 MB.
 * - **One request in flight.** The worker runs one batch at a time anyway; keeping the queue here
 *   is what lets a **query jump ahead of queued document batches** (a learner typing must not
 *   wait behind indexing). Documents are sent in batches of DOC_BATCH, so a query waits for at
 *   most the one batch already running.
 * - **Idle shutdown.** After `idleMs` with nothing queued or running the process is killed; the
 *   next call forks a fresh one (load is about 0.7 s).
 * - **Crash handling.** An unexpected exit rejects the request in flight with a clear error and
 *   the queue carries on in a fresh process. A second crash before any request succeeds means
 *   something is wrong with the model or the runtime: everything pending is rejected and
 *   `available()` turns false, so callers fall back to keyword search.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_DIMS, MODEL_FILES, MODEL_ID } from './modelpath.js';

export interface Embedder {
  /** e.g. 'embeddinggemma-300m-q4@<revision>'. Stored with vectors so a model swap forces re-embed. */
  readonly modelId: string;
  /** 768. */
  readonly dims: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
  /** False if the model dir is missing (dev without fetch) → callers fall back to keyword search. */
  available(): boolean;
  dispose(): void;
}

// ── The wire protocol, shared with embedder-worker.ts (type-only import there). ──

export type EmbedKind = 'query' | 'docs';

export type ToWorker =
  | { type: 'init'; modelDir: string }
  | { type: 'embed'; id: number; kind: EmbedKind; texts: string[] };

export type FromWorker =
  | { type: 'ready'; loadMs: number }
  /** `data` is `texts.length × dims` floats, row-major, each row L2-normalised. */
  | { type: 'result'; id: number; dims: number; data: Float32Array }
  | { type: 'error'; id: number; error: string }
  /** The model could not be loaded. Nothing this process is sent will succeed. */
  | { type: 'fatal'; error: string };

/** The part of Electron's `UtilityProcess` this module uses, so tests can hand in a fake. */
export interface EmbedderChild {
  postMessage(message: ToWorker): void;
  on(event: 'message', listener: (message: FromWorker) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export type ForkFn = (modulePath: string, args: string[], options: { serviceName: string }) => EmbedderChild;

/**
 * Texts per message to the worker (and per ONNX batch). Small on purpose: a query typed while a deck is being indexed waits for at most the batch in
 * flight. At ~55 ms a chunk on an M4 Pro, 4 is ~0.2 s; 16 was ~0.9 s, which a learner feels.
 */
export const DOC_BATCH = 4;
export const DEFAULT_IDLE_MS = 5 * 60_000;

const WORKER_PATH = join(__dirname, 'embedder-worker.js');

const electronFork: ForkFn = (modulePath, args, options) => {
  // Required lazily so this module loads under vitest, where 'electron' is just a path string.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { utilityProcess } = require('electron') as typeof import('electron');
  return utilityProcess.fork(modulePath, args, { ...options, stdio: 'inherit' }) as unknown as EmbedderChild;
};

interface Job {
  id: number;
  kind: EmbedKind;
  texts: string[];
  /** Batches of one embedDocuments call share a group, so one failure cancels its siblings. */
  group: number;
  resolve(vectors: Float32Array[]): void;
  reject(err: Error): void;
}

export function createEmbedder(o: { modelDir: string; idleMs?: number; fork?: ForkFn }): Embedder {
  const fork = o.fork ?? electronFork;
  const idleMs = o.idleMs ?? DEFAULT_IDLE_MS;

  const queries: Job[] = [];
  const docs: Job[] = [];
  let inFlight: Job | null = null;
  let child: EmbedderChild | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  let nextGroup = 1;
  /** Unexpected exits since the last successful result. */
  let crashes = 0;
  /** Set once the embedder gives up (model failed to load, or crashed twice running). */
  let broken: Error | null = null;
  let disposed = false;
  let modelPresent = false;

  function hasModel(): boolean {
    // Only a positive answer is cached: a developer may run `npm run models` while the app is up.
    if (!modelPresent) modelPresent = MODEL_FILES.every((f) => existsSync(join(o.modelDir, f)));
    return modelPresent;
  }

  function unavailableError(): Error {
    if (disposed) return new Error('search embedder: disposed');
    if (broken) return broken;
    return new Error(`search embedder: model not found in ${o.modelDir} (run \`npm run models\` in app/)`);
  }

  function clearIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  /** Kill the current process on purpose. Its exit event is then ignored (it is no longer `child`). */
  function stopChild(): void {
    const c = child;
    child = null;
    if (c) c.kill();
  }

  function rejectAll(err: Error): void {
    const all = [...(inFlight ? [inFlight] : []), ...queries.splice(0), ...docs.splice(0)];
    inFlight = null;
    for (const job of all) job.reject(err);
  }

  function giveUp(err: Error): void {
    broken = err;
    clearIdle();
    stopChild();
    rejectAll(err);
  }

  function spawn(): EmbedderChild {
    const c = fork(WORKER_PATH, [], { serviceName: 'ChatterED Search' });
    c.on('message', (msg) => onMessage(c, msg));
    c.on('exit', (code) => onExit(c, code));
    c.postMessage({ type: 'init', modelDir: o.modelDir });
    return c;
  }

  function pump(): void {
    if (disposed || broken || inFlight) return;
    const job = queries.shift() ?? docs.shift();
    if (!job) {
      armIdle();
      return;
    }
    clearIdle();
    if (!child) child = spawn();
    inFlight = job;
    child.postMessage({ type: 'embed', id: job.id, kind: job.kind, texts: job.texts });
  }

  function armIdle(): void {
    if (!child || idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!inFlight && queries.length === 0 && docs.length === 0) stopChild();
    }, idleMs);
    idleTimer.unref?.();
  }

  function onMessage(c: EmbedderChild, msg: FromWorker): void {
    if (c !== child) return;
    if (msg.type === 'ready') return;
    if (msg.type === 'fatal') {
      giveUp(new Error(`search embedder: the model failed to load: ${msg.error}`));
      return;
    }
    const job = inFlight;
    if (!job || job.id !== msg.id) return;
    inFlight = null;
    if (msg.type === 'error') {
      failJob(job, new Error(`search embedder: ${msg.error}`));
    } else {
      crashes = 0;
      try {
        job.resolve(split(msg.data, msg.dims, job.texts.length));
      } catch (err) {
        failJob(job, err as Error);
      }
    }
    pump();
  }

  function onExit(c: EmbedderChild, code: number): void {
    if (c !== child) return; // one we killed on purpose
    child = null;
    clearIdle();
    crashes += 1;
    const err = new Error(`search embedder: the embedding process exited unexpectedly (code ${code})`);
    if (crashes > 1) {
      giveUp(new Error(`${err.message}, twice in a row; search falls back to keywords`));
      return;
    }
    const job = inFlight;
    inFlight = null;
    if (job) failJob(job, err);
    pump(); // the rest of the queue goes to a fresh process
  }

  /** Reject a job and drop the not-yet-sent batches of the same embedDocuments call. */
  function failJob(job: Job, err: Error): void {
    job.reject(err);
    for (let i = docs.length - 1; i >= 0; i--) {
      if (docs[i]!.group === job.group) docs.splice(i, 1)[0]!.reject(err);
    }
  }

  function enqueue(kind: EmbedKind, texts: string[], group: number): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      const job: Job = { id: nextId++, kind, texts, group, resolve, reject };
      (kind === 'query' ? queries : docs).push(job);
      pump();
    });
  }

  function check(): void {
    if (disposed || broken || !hasModel()) throw unavailableError();
  }

  return {
    modelId: MODEL_ID,
    dims: MODEL_DIMS,

    async embedDocuments(texts) {
      check();
      if (texts.length === 0) return [];
      const group = nextGroup++;
      const batches: Promise<Float32Array[]>[] = [];
      for (let i = 0; i < texts.length; i += DOC_BATCH) {
        batches.push(enqueue('docs', texts.slice(i, i + DOC_BATCH), group));
      }
      return (await Promise.all(batches)).flat();
    },

    async embedQuery(text) {
      check();
      const [v] = await enqueue('query', [text], nextGroup++);
      return v!;
    },

    available() {
      return !disposed && !broken && hasModel();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearIdle();
      stopChild();
      rejectAll(unavailableError());
    },
  };
}

/** One flat row-major buffer → one independent Float32Array per text. */
function split(data: Float32Array, dims: number, n: number): Float32Array[] {
  if (dims !== MODEL_DIMS || data.length !== n * dims) {
    throw new Error(`search embedder: expected ${n}×${dims} floats, got ${data.length}`);
  }
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) out.push(data.slice(i * dims, (i + 1) * dims));
  return out;
}
