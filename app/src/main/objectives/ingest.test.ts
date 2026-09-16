import { describe, expect, it, vi } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import type { LearningTree } from '../../shared/objectives.js';
import type { LLMClient, LlmRequest } from '../../room/llm/types.js';
import { EMPTY_USAGE } from '../../room/llm/types.js';
import { API_PLAN } from '../../room/llm/models.js';
import type { LocalStore } from '../db/store.js';
import { critique1Tree } from './critique1.js';
import { ensureTree, NEEDS_LIVE_BACKEND, OBJECTIVES_PROMPT_VERSION, treeIsCurrent } from './ingest.js';
import { packFromTree } from './pack.js';

const INPUT = {
  fileId: 'file_1',
  contentSha: 'sha-a',
  title: 'Search and planning',
  outline: 'p. 1 — Intro\np. 2 — A* search',
  text: 'A long deck about search.',
  fileName: 'Lecture-complex v4.0.pdf',
};

function body(count: number, over: Record<string, unknown>[] = []): string {
  const objectives = Array.from({ length: count }, (_, i) => ({
    key: `k${i}`,
    title: `Objective number ${i}`,
    kind: 'objective',
    statement: 'Say the thing.',
    criteria: ['names it', 'says why'],
    quiz_seeds: [`Explain objective ${i}.`],
    refs: [{ page: i + 1 }],
  }));
  return JSON.stringify({ objectives: [...objectives, ...over] });
}

function client(text: string | (() => string | never)): LLMClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    kind: 'claude-cli',
    calls,
    async complete(request) {
      calls.push(request);
      const out = typeof text === 'function' ? text() : text;
      return { text: out, model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
    },
  };
}

function deps(store: LocalStore, llm: LLMClient | null, seen: LearningTree[] = []) {
  return {
    store,
    llm,
    models: API_PLAN,
    mode: (llm && llm.kind !== 'scripted' ? 'live' : 'scripted') as 'live' | 'scripted',
    onTree: (tree: LearningTree) => seen.push(tree),
    now: () => '2026-09-16T12:00:00.000Z',
  };
}

describe('the live ingest', () => {
  it('writes pending before it asks, then ready with the tree', async () => {
    const { store } = openTestDb();
    const seen: LearningTree[] = [];
    const llm = client(body(7));
    expect(await ensureTree(deps(store, llm, seen), INPUT)).toBe(true);

    expect(seen.map((t) => t.status)).toEqual(['pending', 'ready']);
    const tree = store.objectives.tree('file_1')!;
    expect(tree.status).toBe('ready');
    expect(tree.objectives).toHaveLength(7);
    expect(tree.version).toBe(OBJECTIVES_PROMPT_VERSION);
    expect(tree.objectives[0]!.fileId).toBe('file_1');
  });

  /**
   * §3: the deck's title, its outline and its whole text. And the background lane — a minute of
   * Sonnet nobody is waiting for must never be a minute a learner is (`claude-cli.ts`).
   */
  it('sends the title, the outline and the whole deck, on the background lane', async () => {
    const { store } = openTestDb();
    const llm = client(body(6));
    await ensureTree(deps(store, llm), INPUT);
    const request = llm.calls[0]!;
    expect(request.meta.scope).toBe('ingest');
    expect(request.model).toBe(API_PLAN.orchestrator);
    expect(request.jsonSchema).toBeDefined();
    expect(request.messages[0]!.content).toContain('Search and planning');
    expect(request.messages[0]!.content).toContain('p. 2 — A* search');
    expect(request.messages[0]!.content).toContain('A long deck about search.');
  });

  it('is cached on the sha and the prompt version — a reopen asks nothing', async () => {
    const { store } = openTestDb();
    const llm = client(body(6));
    await ensureTree(deps(store, llm), INPUT);
    expect(await ensureTree(deps(store, llm), INPUT)).toBe(false);
    expect(llm.calls).toHaveLength(1);
  });

  it('re-reads a deck whose bytes changed', async () => {
    const { store } = openTestDb();
    const llm = client(body(6));
    await ensureTree(deps(store, llm), INPUT);
    await ensureTree(deps(store, llm), { ...INPUT, contentSha: 'sha-b' });
    expect(llm.calls).toHaveLength(2);
    expect(store.objectives.tree('file_1')!.contentSha).toBe('sha-b');
  });

  /** §3's Regenerate: keeps the states whose ids still match, drops the rest. */
  it('regenerating keeps the states whose ids survived', async () => {
    const { store } = openTestDb();
    const llm = client(body(6));
    await ensureTree(deps(store, llm), INPUT);
    const kept = store.objectives.tree('file_1')!.objectives[0]!.id;
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: kept, level: 2, movedAt: 'T' });
    store.objectives.setLevel({ fileId: 'file_1', objectiveId: 'about-something-else', level: 3, movedAt: 'T' });

    await ensureTree(deps(store, llm), INPUT, { force: true });
    expect(store.objectives.states('file_1').map((s) => s.objectiveId)).toEqual([kept]);
    expect(store.objectives.state('file_1', kept)!.level).toBe(2);
  });

  it('records a failure with its reason, and the next open tries again', async () => {
    const { store } = openTestDb();
    const seen: LearningTree[] = [];
    let first = true;
    const llm = client(() => {
      if (first) {
        first = false;
        throw new Error('the CLI exited 1: no output');
      }
      return body(6);
    });
    expect(await ensureTree(deps(store, llm, seen), INPUT)).toBe(false);
    const failed = store.objectives.tree('file_1')!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('exited 1');

    expect(await ensureTree(deps(store, llm, seen), INPUT)).toBe(true);
    expect(store.objectives.tree('file_1')!.status).toBe('ready');
  });

  /** Pre-emption is not a failure: the learner's question took the lane, and pending is where it started. */
  it('leaves a pre-empted ingest pending, with no error', async () => {
    const { store } = openTestDb();
    const llm = client(() => {
      const err = new Error('stopped');
      err.name = 'CliPreemptedError';
      throw err;
    });
    expect(await ensureTree(deps(store, llm), INPUT)).toBe(false);
    const tree = store.objectives.tree('file_1')!;
    expect(tree.status).toBe('pending');
    expect(tree.error).toBeUndefined();
  });

  it('fails rather than storing an empty tree', async () => {
    const { store } = openTestDb();
    const llm = client(JSON.stringify({ objectives: [] }));
    await ensureTree(deps(store, llm), INPUT);
    expect(store.objectives.tree('file_1')!.status).toBe('failed');
  });

  it('unwraps an object a model wrapped in prose', async () => {
    const { store } = openTestDb();
    const llm = client(`Here is the tree:\n\n${body(6)}\n\nHope that helps.`);
    await ensureTree(deps(store, llm), INPUT);
    expect(store.objectives.tree('file_1')!.status).toBe('ready');
  });
});

describe('the scripted backend', () => {
  it('gives the fixture deck its committed tree', async () => {
    const { store } = openTestDb();
    const seen: LearningTree[] = [];
    expect(
      await ensureTree(deps(store, null, seen), {
        ...INPUT,
        fileName: 'A0282987E_LohZhengLucas_Critique1_slides (1).pdf',
      }),
    ).toBe(true);
    const tree = store.objectives.tree('file_1')!;
    expect(tree.status).toBe('ready');
    expect(tree.objectives).toHaveLength(8);
    expect(tree.objectives.filter((o) => o.assumedByDeck)).toHaveLength(2);
    expect(seen).toHaveLength(1);
  });

  it('leaves every other deck pending, and says why', async () => {
    const { store } = openTestDb();
    expect(await ensureTree(deps(store, null), INPUT)).toBe(false);
    const tree = store.objectives.tree('file_1')!;
    expect(tree.status).toBe('pending');
    expect(tree.error).toBe(NEEDS_LIVE_BACKEND);
    expect(tree.objectives).toEqual([]);
  });

  it('does not rewrite the same pending note on every reopen', async () => {
    const { store } = openTestDb();
    const seen: LearningTree[] = [];
    await ensureTree(deps(store, null, seen), INPUT);
    await ensureTree(deps(store, null, seen), INPUT);
    expect(seen).toHaveLength(1);
  });
});

describe('the fixture tree', () => {
  const tree = critique1Tree('file_1');

  it('is six objectives and two prerequisites the deck assumes', () => {
    expect(tree.filter((o) => o.kind === 'objective')).toHaveLength(6);
    const assumed = tree.filter((o) => o.assumedByDeck);
    expect(assumed.map((o) => o.title)).toEqual([
      'What a session’s context is',
      'What steering a coding agent means',
    ]);
    expect(assumed.every((o) => o.refs.length === 0)).toBe(true);
  });

  it('refs only pages that exist in a seven-page deck, and every objective has one', () => {
    for (const objective of tree.filter((o) => o.kind === 'objective')) {
      expect(objective.refs.length).toBeGreaterThan(0);
      for (const ref of objective.refs) expect(ref.page).toBeGreaterThanOrEqual(1);
      for (const ref of objective.refs) expect(ref.page).toBeLessThanOrEqual(7);
    }
  });

  it('has resolvable, acyclic edges and a quiz seed on every node', () => {
    const ids = new Set(tree.map((o) => o.id));
    for (const objective of tree) {
      expect(objective.quizSeeds.length).toBeGreaterThan(0);
      if (objective.parentId !== null) expect(ids.has(objective.parentId)).toBe(true);
      for (const id of objective.requires) {
        expect(ids.has(id)).toBe(true);
        expect(tree.find((o) => o.id === id)!.requires).not.toContain(objective.id);
      }
    }
  });
});

describe('treeIsCurrent', () => {
  it('is false for null, for other bytes, and for a tree that is not ready', () => {
    const base: LearningTree = {
      fileId: 'f',
      contentSha: 'sha-a',
      generatedAt: 'T',
      model: 'sonnet',
      version: OBJECTIVES_PROMPT_VERSION,
      objectives: critique1Tree('f'),
      status: 'ready',
    };
    expect(treeIsCurrent(null, 'sha-a')).toBe(false);
    expect(treeIsCurrent(base, 'sha-a')).toBe(true);
    expect(treeIsCurrent(base, 'sha-b')).toBe(false);
    expect(treeIsCurrent({ ...base, version: 99 }, 'sha-a')).toBe(false);
    expect(treeIsCurrent({ ...base, status: 'pending' }, 'sha-a')).toBe(false);
    expect(treeIsCurrent({ ...base, objectives: [] }, 'sha-a')).toBe(false);
  });
});

describe('the pack, derived from the tree', () => {
  const tree: LearningTree = {
    fileId: 'f',
    contentSha: 'sha-a',
    generatedAt: 'T',
    model: 'sonnet',
    version: 1,
    objectives: critique1Tree('f'),
    status: 'ready',
  };

  /**
   * The reconciliation in one assertion: element id **is** objective id, so `applyLedgerRules`
   * scores objectives without knowing it does, and the states are a mirror of rows that already
   * carry the right ids.
   */
  it('is one element per node, keyed on the objective’s own id', () => {
    const pack = packFromTree(tree, 'Critique 1');
    expect(pack.elements.map((e) => e.id)).toEqual(tree.objectives.map((o) => o.id));
  });

  it('puts the objective’s criteria at level 2, which is the rung the panel calls online', () => {
    const pack = packFromTree(tree, 'Critique 1');
    const element = pack.elements.find((e) => e.id === tree.objectives[0]!.id)!;
    expect(element.criteria['2']).toContain(tree.objectives[0]!.criteria[0]!);
  });

  it('carries the quiz seeds for the Tester and invents no misconceptions', () => {
    const pack = packFromTree(tree, 'Critique 1');
    for (const element of pack.elements) {
      expect(element.misconceptions).toEqual([]);
      expect(element.quiz_seeds!.length).toBeGreaterThan(0);
      expect(element.probe_seeds.clarification).toBe(element.quiz_seeds![0]);
      expect(element.learner_label.split(' ').length).toBeLessThanOrEqual(8);
    }
  });

  it('includes the prerequisites — a node that can never light is decoration', () => {
    const pack = packFromTree(tree, 'Critique 1');
    const assumed = tree.objectives.filter((o) => o.assumedByDeck);
    for (const node of assumed) expect(pack.elements.some((e) => e.id === node.id)).toBe(true);
  });

  it('orders the elements the way the deck does', () => {
    const shuffled = { ...tree, objectives: [...tree.objectives].reverse() };
    const pack = packFromTree(shuffled, 'Critique 1');
    expect(pack.elements.map((e) => e.id)).toEqual(
      [...tree.objectives].sort((a, b) => a.order - b.order).map((o) => o.id),
    );
  });
});

describe('the in-flight guard', () => {
  it('will not start a second ingest for a file while one is running', async () => {
    const { store } = openTestDb();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = vi.fn();
    const llm: LLMClient = {
      kind: 'claude-cli',
      async complete(request) {
        calls();
        await gate;
        return { text: body(6), model: request.model, usage: EMPTY_USAGE, ttftMs: 1 };
      },
    };
    const first = ensureTree(deps(store, llm), INPUT);
    const second = ensureTree(deps(store, llm), INPUT);
    expect(await second).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
