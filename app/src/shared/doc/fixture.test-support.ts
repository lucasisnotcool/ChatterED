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
import type { DocAuthor } from './types.js';

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
