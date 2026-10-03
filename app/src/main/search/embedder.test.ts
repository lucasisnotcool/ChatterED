import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createEmbedder,
  DOC_BATCH,
  type EmbedderChild,
  type ForkFn,
  type FromWorker,
  type ToWorker,
} from './embedder.js';
import { MODEL_DIMS, MODEL_FILES, MODEL_ID } from './modelpath.js';

/** A model folder with every file the embedder checks for (empty: the fake never reads them). */
function modelDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'embed-')), 'embeddinggemma-300m');
  for (const f of MODEL_FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), '');
  }
  return dir;
}

class FakeChild implements EmbedderChild {
  sent: ToWorker[] = [];
  killed = false;
  #onMessage: ((m: FromWorker) => void) | null = null;
  #onExit: ((code: number) => void) | null = null;

  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }
  on(event: 'message' | 'exit', listener: ((m: FromWorker) => void) | ((code: number) => void)): this {
    if (event === 'message') this.#onMessage = listener as (m: FromWorker) => void;
    else this.#onExit = listener as (code: number) => void;
    return this;
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }

  /** The embed requests sent so far. */
  get embeds(): Extract<ToWorker, { type: 'embed' }>[] {
    return this.sent.filter((m): m is Extract<ToWorker, { type: 'embed' }> => m.type === 'embed');
  }
  /** Answer the latest embed request: row i is filled with `seed + i`. */
  answer(seed = 0): void {
    const req = this.embeds.at(-1)!;
    const data = new Float32Array(req.texts.length * MODEL_DIMS);
    for (let i = 0; i < req.texts.length; i++) data.fill(seed + i, i * MODEL_DIMS, (i + 1) * MODEL_DIMS);
    this.#onMessage!({ type: 'result', id: req.id, dims: MODEL_DIMS, data });
  }
  fail(error: string): void {
    this.#onMessage!({ type: 'error', id: this.embeds.at(-1)!.id, error });
  }
  send(m: FromWorker): void {
    this.#onMessage!(m);
  }
  crash(code = 134): void {
    this.#onExit!(code);
  }
}

function setup(idleMs?: number) {
  const children: FakeChild[] = [];
  const fork: ForkFn = vi.fn(() => {
    const c = new FakeChild();
    children.push(c);
    return c;
  });
  const dir = modelDir();
  const embedder = createEmbedder({ modelDir: dir, fork, ...(idleMs ? { idleMs } : {}) });
  return { embedder, children, fork, dir, last: () => children.at(-1)! };
}

/** Let promise callbacks run. */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('createEmbedder', () => {
  it('reports the model id and dims, and forks nothing until first use', () => {
    const { embedder, fork } = setup();
    expect(embedder.modelId).toBe(MODEL_ID);
    expect(embedder.modelId).toMatch(/^embeddinggemma-300m-q4@[0-9a-f]{40}$/);
    expect(embedder.dims).toBe(768);
    expect(embedder.available()).toBe(true);
    expect(fork).not.toHaveBeenCalled();
  });

  it('forks on first use, sends init with the model dir, and returns one vector per text', async () => {
    const { embedder, last, dir } = setup();
    const p = embedder.embedDocuments(['a', 'b', 'c']);
    expect(last().sent[0]).toEqual({ type: 'init', modelDir: dir });
    expect(last().embeds[0]).toMatchObject({ kind: 'docs', texts: ['a', 'b', 'c'] });
    last().answer(1);
    const vs = await p;
    expect(vs).toHaveLength(3);
    expect(vs.map((v) => v[0])).toEqual([1, 2, 3]);
    expect(vs.every((v) => v instanceof Float32Array && v.length === MODEL_DIMS)).toBe(true);
    // Independent arrays, not views into one shared buffer.
    expect(vs[0]!.buffer).not.toBe(vs[1]!.buffer);
  });

  it('returns [] for no documents without forking', async () => {
    const { embedder, fork } = setup();
    expect(await embedder.embedDocuments([])).toEqual([]);
    expect(fork).not.toHaveBeenCalled();
  });

  it('splits documents into batches of DOC_BATCH, one in flight at a time, in order', async () => {
    const { embedder, last } = setup();
    const texts = Array.from({ length: DOC_BATCH * 2 + 3 }, (_, i) => `t${i}`);
    const p = embedder.embedDocuments(texts);
    expect(last().embeds).toHaveLength(1);
    expect(last().embeds[0]!.texts).toHaveLength(DOC_BATCH);
    last().answer(0);
    expect(last().embeds).toHaveLength(2);
    expect(last().embeds[1]!.texts[0]).toBe(`t${DOC_BATCH}`);
    last().answer(100);
    expect(last().embeds[2]!.texts).toHaveLength(3);
    last().answer(200);
    const vs = await p;
    expect(vs).toHaveLength(texts.length);
    expect(vs[DOC_BATCH]![0]).toBe(100);
    expect(vs.at(-1)![0]).toBe(202);
  });

  it('lets a query jump ahead of queued document batches', async () => {
    const { embedder, last } = setup();
    const docs = embedder.embedDocuments(Array.from({ length: DOC_BATCH * 3 }, (_, i) => `d${i}`));
    const query = embedder.embedQuery('hueristic');
    // The first doc batch was already running; the query goes next, before batches 2 and 3.
    expect(last().embeds.map((e) => e.kind)).toEqual(['docs']);
    last().answer(0);
    expect(last().embeds.map((e) => e.kind)).toEqual(['docs', 'query']);
    expect(last().embeds[1]!.texts).toEqual(['hueristic']);
    last().answer(7);
    expect((await query)[0]).toBe(7);
    last().answer(0);
    last().answer(0);
    expect(await docs).toHaveLength(DOC_BATCH * 3);
    expect(last().embeds.map((e) => e.kind)).toEqual(['docs', 'query', 'docs', 'docs']);
  });

  it('rejects a failed batch and drops the unsent batches of the same call, but not others', async () => {
    const { embedder, last } = setup();
    const a = embedder.embedDocuments(Array.from({ length: DOC_BATCH * 2 }, () => 'a'));
    const b = embedder.embedDocuments(['b']);
    last().fail('tokenizer exploded');
    await expect(a).rejects.toThrow(/tokenizer exploded/);
    // a's second batch was dropped; b is next.
    expect(last().embeds.at(-1)!.texts).toEqual(['b']);
    last().answer(5);
    expect((await b)[0]![0]).toBe(5);
  });

  describe('idle shutdown', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('kills the process after idleMs with nothing to do, and forks a fresh one on next use', async () => {
      const { embedder, children, last } = setup(1000);
      const p = embedder.embedQuery('q');
      last().answer();
      await p;
      vi.advanceTimersByTime(999);
      expect(children[0]!.killed).toBe(false);
      vi.advanceTimersByTime(1);
      expect(children[0]!.killed).toBe(true);
      // The killed process's exit is expected, not a crash.
      children[0]!.crash(0);
      const q = embedder.embedQuery('again');
      expect(children).toHaveLength(2);
      last().answer(3);
      expect((await q)[0]).toBe(3);
      expect(embedder.available()).toBe(true);
    });

    it('does not kill while work is queued, and restarts the clock after each request', async () => {
      const { embedder, children, last } = setup(1000);
      const p1 = embedder.embedQuery('q1');
      vi.advanceTimersByTime(5000); // running for a long time is not idle
      expect(children[0]!.killed).toBe(false);
      last().answer();
      await p1;
      vi.advanceTimersByTime(600);
      const p2 = embedder.embedQuery('q2');
      vi.advanceTimersByTime(600);
      last().answer();
      await p2;
      vi.advanceTimersByTime(600);
      expect(children[0]!.killed).toBe(false);
      vi.advanceTimersByTime(400);
      expect(children[0]!.killed).toBe(true);
    });
  });

  it('on a crash, rejects the request in flight and runs the rest in a fresh process', async () => {
    const { embedder, children } = setup();
    const a = embedder.embedQuery('a');
    const b = embedder.embedDocuments(['b']);
    children[0]!.crash(139);
    await expect(a).rejects.toThrow(/exited unexpectedly \(code 139\)/);
    expect(children).toHaveLength(2);
    expect(children[1]!.sent[0]!.type).toBe('init');
    expect(children[1]!.embeds[0]!.texts).toEqual(['b']);
    children[1]!.answer(4);
    expect((await b)[0]![0]).toBe(4);
    expect(embedder.available()).toBe(true);
  });

  it('a crash with nothing pending restarts lazily, on the next call', async () => {
    const { embedder, children } = setup();
    const a = embedder.embedQuery('a');
    children[0]!.answer();
    await a;
    children[0]!.crash();
    expect(children).toHaveLength(1);
    const b = embedder.embedQuery('b');
    expect(children).toHaveLength(2);
    children[1]!.answer(2);
    expect((await b)[0]).toBe(2);
  });

  it('a second crash before any success gives up: everything rejects and it is unavailable', async () => {
    const { embedder, children } = setup();
    const a = embedder.embedQuery('a');
    const b = embedder.embedQuery('b');
    const c = embedder.embedDocuments(['c']);
    children[0]!.crash();
    await expect(a).rejects.toThrow(/exited unexpectedly/);
    children[1]!.crash();
    await expect(b).rejects.toThrow(/twice in a row/);
    await expect(c).rejects.toThrow(/twice in a row/);
    expect(embedder.available()).toBe(false);
    await expect(embedder.embedQuery('d')).rejects.toThrow(/twice in a row/);
    expect(children).toHaveLength(2);
  });

  it('a success between crashes resets the budget', async () => {
    const { embedder, children } = setup();
    const a = embedder.embedQuery('a');
    children[0]!.crash();
    await expect(a).rejects.toThrow();
    const b = embedder.embedQuery('b');
    children[1]!.answer();
    await b;
    const c = embedder.embedQuery('c');
    children[1]!.crash();
    await expect(c).rejects.toThrow(/exited unexpectedly/);
    expect(embedder.available()).toBe(true);
  });

  it('a model that fails to load makes it unavailable and rejects what is pending', async () => {
    const { embedder, children } = setup();
    const a = embedder.embedQuery('a');
    children[0]!.send({ type: 'fatal', error: 'protobuf parsing failed' });
    await expect(a).rejects.toThrow(/failed to load: protobuf parsing failed/);
    expect(children[0]!.killed).toBe(true);
    expect(embedder.available()).toBe(false);
  });

  it('a missing model dir is unavailable and never forks', async () => {
    const fork = vi.fn<ForkFn>();
    const embedder = createEmbedder({ modelDir: join(tmpdir(), 'no-such-model-dir-xyz'), fork });
    expect(embedder.available()).toBe(false);
    await expect(embedder.embedQuery('q')).rejects.toThrow(/model not found .*npm run models/);
    await expect(embedder.embedDocuments(['d'])).rejects.toThrow(/model not found/);
    expect(fork).not.toHaveBeenCalled();
  });

  it('a partly fetched model dir is unavailable', () => {
    const fork = vi.fn<ForkFn>();
    const dir = mkdtempSync(join(tmpdir(), 'embed-partial-'));
    writeFileSync(join(dir, 'config.json'), '{}');
    expect(createEmbedder({ modelDir: dir, fork }).available()).toBe(false);
  });

  it('dispose kills the process, rejects pending work, and refuses new work', async () => {
    const { embedder, children } = setup();
    const a = embedder.embedQuery('a');
    const b = embedder.embedDocuments(['b']);
    embedder.dispose();
    await expect(a).rejects.toThrow(/disposed/);
    await expect(b).rejects.toThrow(/disposed/);
    expect(children[0]!.killed).toBe(true);
    children[0]!.crash(0); // its exit is ignored
    expect(embedder.available()).toBe(false);
    await expect(embedder.embedQuery('c')).rejects.toThrow(/disposed/);
    await flush();
    expect(children).toHaveLength(1);
  });

  it('rejects a reply of the wrong shape instead of returning garbage', async () => {
    const { embedder, last } = setup();
    const p = embedder.embedDocuments(['a', 'b']);
    last().send({ type: 'result', id: last().embeds[0]!.id, dims: MODEL_DIMS, data: new Float32Array(MODEL_DIMS) });
    await expect(p).rejects.toThrow(/expected 2×768 floats/);
  });
});
