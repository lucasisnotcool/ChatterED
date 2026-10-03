/**
 * Notes docs for the chunker's tests, built as JSON — the shape `notes_docs.doc_json` holds and
 * the shape `noteChunks` reads. Not a `*.test.ts`, so vitest does not collect it as a suite.
 */

import { NOTE_SLOT_REASON, OBJECTIVES_REASON, type DocAuthor } from '../doc/types.js';

export type J = Record<string, unknown>;

export const text = (value: string, by: DocAuthor = 'ingest'): J => ({
  type: 'text',
  text: value,
  marks: [{ type: 'author', attrs: { by, editId: null, at: 0 } }],
});

const attrs = (blockId: string, pages: number[], reason: string | null = null): J => ({
  blockId,
  pages,
  reason: pages.length > 0 ? reason : (reason ?? 'bridge'),
  objectiveIds: [],
});

export const h = (id: string, level: number, value: string, pages: number[] = [], reason: string | null = null): J => ({
  type: 'heading',
  attrs: { level, ...attrs(id, pages, reason ?? (level === 1 ? 'title' : null)) },
  content: [text(value)],
});

export const p = (id: string, value: string, pages: number[] = [], by: DocAuthor = 'ingest', reason: string | null = null): J => ({
  type: 'paragraph',
  attrs: attrs(id, pages, reason),
  ...(value ? { content: [text(value, by)] } : {}),
});

/** An empty paragraph: the learner's blank line. */
export const blank = (id: string): J => ({ type: 'paragraph', attrs: attrs(id, [], 'bridge') });

/** The empty own-note slot under an overview section. */
export const slot = (id: string, pages: number[]): J => ({ type: 'paragraph', attrs: attrs(id, pages, NOTE_SLOT_REASON) });

export const list = (id: string, items: string[], pages: number[] = [], opts: { ordered?: boolean; by?: DocAuthor } = {}): J => ({
  type: opts.ordered ? 'ordered_list' : 'bullet_list',
  attrs: { ...attrs(id, pages), ...(opts.ordered ? { start: 1 } : {}) },
  content: items.map((item, i) => ({
    type: 'list_item',
    attrs: { blockId: `${id}_li${String(i)}` },
    content: [p(`${id}_p${String(i)}`, item, pages, opts.by ?? 'ingest')],
  })),
});

export const objectives = (id: string, items: string[], pages: number[]): J => ({
  type: 'ordered_list',
  attrs: { ...attrs(id, pages, OBJECTIVES_REASON), start: 1 },
  content: items.map((item, i) => ({
    type: 'list_item',
    attrs: { blockId: `${id}_li${String(i)}` },
    content: [p(`${id}_p${String(i)}`, item, pages)],
  })),
});

export const qBlock = (id: string, children: J[], pages: number[] = []): J => ({
  type: 'q_block',
  attrs: {
    questionId: `q_${id}`,
    askedBy: 'max',
    status: 'resolved',
    resolution: 'you_got_this',
    objectiveId: null,
    ...attrs(id, pages, pages.length > 0 ? null : 'question'),
  },
  content: children,
});

export const table = (
  id: string,
  columns: string[],
  rows: string[][],
  opts: { caption?: string | null; pages?: number[]; rowPages?: number[][] } = {},
): J => {
  const row = (cells: string[], header: boolean, own: number[]): J => ({
    type: 'table_row',
    attrs: { pages: own },
    content: cells.map((c) => ({ type: 'table_cell', attrs: { header }, content: c ? [text(c, 'ellie')] : [] })),
  });
  return {
    type: 'table',
    attrs: { caption: opts.caption ?? null, ...attrs(id, opts.pages ?? [6], 'asked for') },
    content: [row(columns, true, []), ...rows.map((cells, i) => row(cells, false, opts.rowPages?.[i] ?? []))],
  };
};

export const flashcards = (id: string, title: string | null, cards: [string, string, number[]?][], pages: number[] = [6]): J => ({
  type: 'flashcards',
  attrs: { title, ...attrs(id, pages, 'asked for') },
  content: cards.map(([front, back, own]) => ({
    type: 'flashcard',
    attrs: { pages: own ?? [], reason: null },
    content: [
      { type: 'flashcard_front', content: [text(front, 'ellie')] },
      { type: 'flashcard_back', content: [text(back, 'ellie')] },
    ],
  })),
});

export const math = (id: string, tex: string, pages: number[] = [3]): J => ({
  type: 'math_block',
  attrs: { tex, ...attrs(id, pages) },
});

export const figure = (id: string, page: number, caption: string): J => ({
  type: 'slide_figure',
  attrs: { page, rect: null, caption, evidentiary: true, ...attrs(id, [page]) },
});

export const diagram = (id: string, title: string | null, labels: string[], pages: number[] = [6]): J => ({
  type: 'diagram',
  attrs: { layout: 'flow', title, edges: [], ...attrs(id, pages, 'asked for') },
  content: labels.map((label, i) => ({
    type: 'diagram_node',
    attrs: { nodeId: `n${String(i)}`, parent: null, group: null, pages: [], reason: null },
    content: [text(label, 'ellie')],
  })),
});

export const quiz = (id: string, title: string | null, prompt: string, options: [string, boolean][], explain: string): J => ({
  type: 'quiz',
  attrs: { title, ...attrs(id, [6], 'asked for') },
  content: [
    {
      type: 'quiz_question',
      attrs: { qtype: 'mc', pages: [7], reason: null },
      content: [
        { type: 'quiz_prompt', content: [text(prompt, 'ellie')] },
        ...options.map(([o, correct]) => ({ type: 'quiz_option', attrs: { correct }, content: [text(o, 'ellie')] })),
        { type: 'quiz_explain', content: [text(explain, 'ellie')] },
      ],
    },
  ],
});

export const infographic = (id: string, title: string | null, panels: [string, string, string][]): J => ({
  type: 'infographic',
  attrs: { layout: 'steps', title, ...attrs(id, [6], 'asked for') },
  content: panels.map(([value, heading, body]) => ({
    type: 'info_panel',
    attrs: { pages: [], reason: null },
    content: [
      { type: 'info_value', content: value ? [text(value, 'ellie')] : [] },
      { type: 'info_heading', content: [text(heading, 'ellie')] },
      { type: 'info_body', content: [text(body, 'ellie')] },
    ],
  })),
});

export const doc = (...blocks: J[]): J => ({ type: 'doc', content: blocks });

/**
 * A sentence of `n` distinct words, `w1 … wn.`, with a prefix so two runs never collide. It ends
 * in a full stop, so a short one is never taken for a label.
 */
export const wordsOf = (n: number, prefix = 'w'): string =>
  `${Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1)}`).join(' ')}.`;
