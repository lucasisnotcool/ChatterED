/**
 * **Flashcards, a quiz and an infographic, asked for on request** (`generate.ts`; notebooks §5.3).
 * `docedit.test.ts` holds the table and the diagram, the precedent; this is the same contract for
 * the three that followed: one schema-bound call, a validated draft, provenance set in code, and
 * a decline that inserts nothing.
 */
import { describe, expect, it } from 'vitest';
import type { OutlineEntry } from '../shared/doc/types.js';
import type { DocEditDeps } from './docedit.js';
import { generateBlockPrompt, planGeneratedBlock, type GenerateBlockInput } from './generate.js';
import { NO_DOC } from './docport.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';

const SECTION: OutlineEntry[] = [
  { blockId: 'b_1', kind: 'heading', path: [], text: 'Heuristics', pages: [4, 5], learnerText: false, questionId: null },
  { blockId: 'b_2', kind: 'paragraph', path: ['Heuristics'], text: 'An admissible heuristic never overestimates.', pages: [4], learnerText: false, questionId: null },
];

function deps(reply: unknown): DocEditDeps & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let n = 0;
  const llm: LLMClient = {
    kind: 'scripted',
    async complete(request) {
      requests.push(request);
      return { text: JSON.stringify(reply), model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
    },
  };
  return {
    llm,
    docPort: { ...NO_DOC, docId: () => 'doc_1' },
    model: 'claude-sonnet-5',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    roomId: 'room_1',
    fileId: 'f_1',
    anchorId: 'doc',
    turnId: 'turn_1',
    requests,
  };
}

const input = (kind: GenerateBlockInput['kind']): GenerateBlockInput => ({
  kind,
  instruction: null,
  anchorBlockId: 'b_2',
  section: SECTION,
  passage: 'Slide 4: admissible heuristics never overestimate.',
  pageCount: 10,
});

const REPLIES = {
  flashcards: {
    make: true,
    why: 'Three terms to recall.',
    flashcards: {
      title: 'Heuristic terms',
      cards: [
        { front: 'Admissible', back: 'Never overestimates.', pages: [4] },
        { front: 'Consistent', back: 'Obeys the triangle inequality.', pages: [99] },
        { front: 'f(n)', back: 'g(n) + h(n)' },
      ],
    },
  },
  quiz: {
    make: true,
    why: 'Checks the idea.',
    quiz: {
      questions: [
        { type: 'mc', prompt: 'Which never overestimates?', options: ['Manhattan', 'Double it', 'Random'], answer: 1, explanation: 'Manhattan is admissible.' },
        { type: 'short', prompt: 'Why admissible?', explanation: 'Optimality.' },
        { type: 'short', prompt: 'What is f?', explanation: 'g + h.' },
      ],
    },
  },
  infographic: {
    make: true,
    why: 'A short history.',
    infographic: {
      layout: 'timeline',
      panels: [
        { value: '1968', heading: 'A*', body: 'Published.' },
        { value: '1985', heading: 'IDA*', body: 'Linear space.' },
        { value: '1990', heading: 'PDBs', body: 'Better h.' },
      ],
    },
  },
} as const;

describe.each(['flashcards', 'quiz', 'infographic'] as const)('planGeneratedBlock — %s', (kind) => {
  it('inserts a validated draft after the anchor, as Ellie’s edit, with the section’s pages', async () => {
    const { batch, reason } = await planGeneratedBlock(deps(REPLIES[kind]), input(kind));
    expect(reason).toBe('inserted');
    expect(batch).toMatchObject({ author: 'ellie', cause: 'answer_missing', focusBlockId: 'b_2' });
    expect(batch!.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_2' });
    const draft = (batch!.ops[0] as { blocks: { kind: string; prov: { pages: number[] } }[] }).blocks[0]!;
    expect(draft.kind).toBe(kind);
    expect(draft.prov.pages).toEqual([4, 5]);
  });

  it('inserts nothing when the model declines', async () => {
    const out = await planGeneratedBlock(deps({ make: false, why: 'Nothing here.' }), input(kind));
    expect(out).toEqual({ batch: null, reason: 'declined', problems: [] });
  });

  it('inserts nothing when the reply fails validation, and says why', async () => {
    const out = await planGeneratedBlock(deps({ make: true, why: 'x', [kind]: {} }), input(kind));
    expect(out.batch).toBeNull();
    expect(out.reason).toBe('invalid');
    expect(out.problems.length).toBeGreaterThan(0);
  });

  it('asks with a schema keyed by the kind, a bigger budget than a table, and the decline rule', async () => {
    const d = deps(REPLIES[kind]);
    await planGeneratedBlock(d, input(kind));
    const request = d.requests[0]!;
    expect(Object.keys((request.jsonSchema as { properties: object }).properties)).toEqual(['make', 'why', kind]);
    expect(request.max_tokens).toBeGreaterThan(2000);
    const prompt = request.system[0]!.text;
    expect(prompt).toContain('"make": false');
    expect(prompt).toContain('An admissible heuristic never overestimates.');
    expect(prompt).toContain('Slide 4: admissible');
    expect(prompt).toContain('Every term in it must appear');
  });
});

describe('the prompts', () => {
  it('say what each block is', () => {
    expect(generateBlockPrompt(input('flashcards'))).toContain('3 to 12 cards');
    expect(generateBlockPrompt(input('quiz'))).toContain('`answer` is its 1-based number');
    const info = generateBlockPrompt(input('infographic'));
    for (const layout of ['`timeline`', '`steps`', '`stats`', '`compare`']) expect(info).toContain(layout);
    expect(info).toContain('text only');
  });

  it('cut the slides at the passage budget', () => {
    const long = generateBlockPrompt({ ...input('quiz'), passage: 'x'.repeat(20_000) });
    expect(long.length).toBeLessThan(10_000);
  });

  it('drops a card citing a page outside the deck, and logs it', async () => {
    const out = await planGeneratedBlock(deps(REPLIES.flashcards), input('flashcards'));
    expect(out.problems.join()).toContain('outside the deck');
    const cards = (out.batch!.ops[0] as { blocks: { cards: { pages: number[] }[] }[] }).blocks[0]!.cards;
    expect(cards[1]!.pages).toEqual([]);
  });
});
