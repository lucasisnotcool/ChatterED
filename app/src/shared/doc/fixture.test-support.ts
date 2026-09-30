/**
 * Test fixtures for the notes document model — a hand-built doc, and the two-line ceremony for
 * turning one into an `EditorState`.
 *
 * Hand-built rather than loaded from a file on purpose: every test in this directory is about a
 * specific arrangement of authors and marks, and a fixture you can read in the same screen as
 * the assertion is the difference between a failing test that tells you what broke and one that
 * sends you to a JSON blob.
 *
 * Not a `*.test.ts`, so vitest does not collect it as a suite.
 */

import type { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { inlineToNodes } from './inline.js';
import { authorMark, notesSchema } from './schema.js';
import type { DiagramEdge, DiagramLayout, DocAuthor } from './types.js';

export const AT = 1_758_000_000_000;

export function stateOf(doc: Node): EditorState {
  return EditorState.create({ schema: notesSchema, doc });
}

/** A paragraph whose text is one author's. */
export function para(
  blockId: string,
  text: string,
  by: DocAuthor = 'ingest',
  editId: string | null = null,
  pages: number[] = [],
): Node {
  return notesSchema.nodes.paragraph!.create(
    { blockId, pages, reason: pages.length > 0 ? null : 'bridge', objectiveIds: [] },
    text.length > 0 ? inlineToNodes(notesSchema, text, by, editId, AT) : null,
  );
}

/** A paragraph stitched out of several authors' spans, in order. */
export function mixed(
  blockId: string,
  parts: { text: string; by: DocAuthor; editId?: string | null }[],
  pages: number[] = [1],
): Node {
  const content = parts.map((part) =>
    notesSchema.text(part.text, [authorMark(part.by, part.editId ?? null, AT)]),
  );
  return notesSchema.nodes.paragraph!.create({ blockId, pages, reason: null, objectiveIds: [] }, content);
}

export function heading(blockId: string, level: 1 | 2 | 3, text: string, pages: number[] = []): Node {
  return notesSchema.nodes.heading!.create(
    { blockId, level, pages, reason: pages.length > 0 ? null : 'title', objectiveIds: [] },
    inlineToNodes(notesSchema, text, 'ingest', null, AT),
  );
}

/** Cell or label content: a string in one author's hand, or spans stitched from several. */
export type Spans = string | { text: string; by: DocAuthor; editId?: string | null }[];

function inlineOf(content: Spans, by: DocAuthor, editId: string | null): Node[] {
  if (typeof content === 'string') {
    return content.length > 0 ? inlineToNodes(notesSchema, content, by, editId, AT) : [];
  }
  return content.map((part) => notesSchema.text(part.text, [authorMark(part.by, part.editId ?? null, AT)]));
}

/** A table: a heading row from `columns`, then `rows`. `rowPages[i]` is row i's own provenance. */
export function table(
  blockId: string,
  columns: string[],
  rows: Spans[][],
  opts: { by?: DocAuthor; editId?: string | null; pages?: number[]; caption?: string | null; rowPages?: number[][] } = {},
): Node {
  const { by = 'ellie', editId = null, pages = [6], caption = null, rowPages = [] } = opts;
  const { table: t, table_row: tr, table_cell: td } = notesSchema.nodes;
  const row = (cells: Spans[], header: boolean, own: number[]): Node =>
    tr!.create({ pages: own }, cells.map((cell) => td!.create({ header }, inlineOf(cell, by, editId))));
  return t!.create({ blockId, pages, reason: pages.length > 0 ? null : 'asked for', objectiveIds: [], caption }, [
    row(columns, true, []),
    ...rows.map((cells, i) => row(cells, false, rowPages[i] ?? [])),
  ]);
}

export function diagram(
  blockId: string,
  nodes: { id: string; label: Spans; parent?: string | null; group?: string | null; pages?: number[] }[],
  opts: {
    layout?: DiagramLayout;
    title?: string | null;
    edges?: DiagramEdge[];
    by?: DocAuthor;
    editId?: string | null;
    pages?: number[];
  } = {},
): Node {
  const { layout = 'flow', title = null, edges = [], by = 'ellie', editId = null, pages = [6] } = opts;
  return notesSchema.nodes.diagram!.create(
    { blockId, pages, reason: pages.length > 0 ? null : 'asked for', objectiveIds: [], layout, title, edges },
    nodes.map((n) =>
      notesSchema.nodes.diagram_node!.create(
        { nodeId: n.id, parent: n.parent ?? null, group: n.group ?? null, pages: n.pages ?? [], reason: null },
        inlineOf(n.label, by, editId),
      ),
    ),
  );
}

export function docOf(...blocks: Node[]): Node {
  return notesSchema.nodes.doc!.create(null, blocks);
}

/**
 * The standard fixture: a titled section with three ingest paragraphs, one of which the learner
 * has written the middle of.
 *
 * ```
 * # Planning                               (b_title)
 * Classical planning assumes…              (b_1, ingest, p. 4)
 * ## Value iteration                       (b_h2)
 * The Bellman update is…                   (b_2, ingest, p. 5)
 * Ellie wrote this. I wrote this. Ellie.   (b_mix, ingest + user + ingest)
 * ```
 */
export function fixtureDoc(): Node {
  return docOf(
    heading('b_title', 1, 'Planning'),
    para('b_1', 'Classical planning assumes a **deterministic** world.', 'ingest', null, [4]),
    heading('b_h2', 2, 'Value iteration', [5]),
    para('b_2', 'The Bellman update is $v(s)$ applied until it stops moving.', 'ingest', null, [5]),
    mixed('b_mix', [
      { text: 'Ellie wrote this. ', by: 'ingest' },
      { text: 'I think it converges because of the contraction.', by: 'user' },
      { text: ' Ellie again.', by: 'ingest' },
    ]),
  );
}
