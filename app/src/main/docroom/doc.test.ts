import { beforeEach, describe, expect, it } from 'vitest';
import { docOf, heading, para } from '../../shared/doc/fixture.test-support.js';
import { notesSchema } from '../../shared/doc/schema.js';
import { fakeHost, objective } from './fakehost.test-support.js';
import {
  blockIdsForObjective,
  lessonBlocks,
  lessonSectionText,
  objectiveForBlock,
  openNotesDoc,
  pagesForBlock,
  pagesOfObjective,
  resetDocCache,
  SECTION_PAGES_CAP,
  sectionPagesForBlock,
} from './doc.js';

function deck() {
  return docOf(
    para('b_1', 'Convexity is about the shape of the set.', 'ingest', null, [1]),
    para('b_2', 'The Hessian test decides it on the interior.', 'ingest', null, [2]),
    para('b_3', 'A bridging note with no slide behind it.', 'ingest', null, []),
    para('b_4', 'Both pages, because the idea spans them.', 'ingest', null, [2, 3]),
  );
}

beforeEach(() => {
  resetDocCache();
});

describe('openNotesDoc', () => {
  it('finds the row by content sha and parses it once per version', () => {
    const { host } = fakeHost({ doc: deck() });
    const first = openNotesDoc(host.db, { contentSha: 'sha-deck' });
    const second = openNotesDoc(host.db, { contentSha: 'sha-deck' });
    expect(first?.row.docId).toBe('doc_deck');
    // The memo is keyed on `(docId, version)`, so the second read is the same node object.
    expect(second?.doc).toBe(first?.doc);
  });

  it('falls back to the file id, and returns null when neither finds a row', () => {
    const { host } = fakeHost({ doc: deck() });
    expect(openNotesDoc(host.db, { contentSha: 'sha-other', fileId: 'f_deck' })?.row.docId).toBe('doc_deck');
    expect(openNotesDoc(host.db, { contentSha: 'sha-other', fileId: 'f_other' })).toBeNull();
  });

  it('reports a document whose JSON will not parse as a row with no doc', () => {
    const { host } = fakeHost();
    host.db
      .prepare(
        `INSERT INTO notes_docs
           (id, content_sha, file_id, title, page_count, version, doc_json, ingest_status,
            ingest_version, created_at, updated_at)
         VALUES ('doc_bad', 'sha-bad', 'f_bad', 'Notes', 1, 1, 'not json', 'ready', 1, 't', 't')`,
      )
      .run({});
    const opened = openNotesDoc(host.db, { contentSha: 'sha-bad' });
    expect(opened?.row.docId).toBe('doc_bad');
    expect(opened?.doc).toBeNull();
  });
});

describe('pagesForBlock', () => {
  it('gives the block’s pages, and nothing for a block with none or an unknown id', () => {
    const doc = deck();
    expect(pagesForBlock(doc, 'b_2')).toEqual([2]);
    expect(pagesForBlock(doc, 'b_4')).toEqual([2, 3]);
    expect(pagesForBlock(doc, 'b_3')).toEqual([]);
    expect(pagesForBlock(doc, 'b_missing')).toEqual([]);
    expect(pagesForBlock(null, 'b_1')).toEqual([]);
  });
});

/** §5.7: a table or diagram is drawn from the slides of the section the cursor is in. */
describe('sectionPagesForBlock', () => {
  const head = (id: string, level: number, pages: number[] = []) =>
    notesSchema.nodes.heading!.create({ level, blockId: id, pages, reason: pages.length > 0 ? null : 'heading', objectiveIds: [] }, notesSchema.text(id));
  const sectioned = () =>
    docOf(
      head('h_title', 1),
      para('b_intro', 'Before any section.', 'ingest', null, [1]),
      head('h_a', 2, [2]),
      para('b_a1', 'First idea.', 'ingest', null, [2, 3]),
      head('h_a_sub', 3, [4]),
      para('b_a2', 'A detail under it.', 'ingest', null, [4]),
      head('h_b', 2, [7]),
      para('b_b1', 'Second idea.', 'ingest', null, [7, 8]),
    );

  it('takes the pages from the heading above the block down to the next heading of that level', () => {
    const doc = sectioned();
    // In section A: its sub-heading's blocks are inside it, section B is not.
    expect(sectionPagesForBlock(doc, 'b_a1')).toEqual([2, 3, 4]);
    expect(sectionPagesForBlock(doc, 'h_a')).toEqual([2, 3, 4]);
    // In the sub-section: only down to the next heading at or above its own level.
    expect(sectionPagesForBlock(doc, 'b_a2')).toEqual([4]);
    expect(sectionPagesForBlock(doc, 'b_b1')).toEqual([7, 8]);
  });

  it('gives nothing for an unknown block or no document', () => {
    expect(sectionPagesForBlock(sectioned(), 'b_missing')).toEqual([]);
    expect(sectionPagesForBlock(null, 'b_a1')).toEqual([]);
  });

  it('caps a long section at the pages nearest the block’s own', () => {
    const doc = docOf(
      head('h_long', 2),
      ...Array.from({ length: 30 }, (_, i) => para(`b_${String(i)}`, `Block ${String(i)}.`, 'ingest', null, [i + 1])),
    );
    const pages = sectionPagesForBlock(doc, 'b_19');
    expect(pages).toHaveLength(SECTION_PAGES_CAP);
    expect(pages).toContain(20);
    expect(Math.min(...pages)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...pages)).toBeLessThanOrEqual(25);
  });
});

describe('objectiveForBlock', () => {
  const doc = deck();

  it('maps a block to the one objective whose refs its pages meet', () => {
    const tree = {
      fileId: 'f_deck',
      contentSha: 'sha-deck',
      generatedAt: 't',
      model: 'm',
      version: 1,
      status: 'ready' as const,
      objectives: [objective('o1', { refs: [{ page: 1 }] }), objective('o2', { refs: [{ page: 2 }] })],
    };
    expect(objectiveForBlock(tree, doc, 'b_1')).toBe('o1');
    expect(objectiveForBlock(tree, doc, 'b_2')).toBe('o2');
  });

  it('refuses to guess when two objectives claim the block’s pages', () => {
    const tree = {
      fileId: 'f_deck',
      contentSha: 'sha-deck',
      generatedAt: 't',
      model: 'm',
      version: 1,
      status: 'ready' as const,
      objectives: [objective('o1', { refs: [{ page: 2 }] }), objective('o2', { refs: [{ page: 2 }] })],
    };
    // Attributing the learner's sentence to one of two is the ledger's verbatim rule broken at
    // the other end: they were not writing about "whichever came first".
    expect(objectiveForBlock(tree, doc, 'b_2')).toBeNull();
  });

  it('is null for a block with no pages, and for a file with no tree', () => {
    const tree = {
      fileId: 'f_deck',
      contentSha: 'sha-deck',
      generatedAt: 't',
      model: 'm',
      version: 1,
      status: 'ready' as const,
      objectives: [objective('o1', { refs: [{ page: 1 }] })],
    };
    expect(objectiveForBlock(tree, doc, 'b_3')).toBeNull();
    expect(objectiveForBlock(null, doc, 'b_1')).toBeNull();
  });
});

describe('blockIdsForObjective', () => {
  it('reads the cached mapping in its recorded order when there is one', () => {
    const { host } = fakeHost({ doc: deck() });
    for (const [blockId, ord] of [
      ['b_4', 1],
      ['b_2', 0],
    ] as const) {
      host.db
        .prepare(
          `INSERT INTO notes_objective_blocks (doc_id, objective_id, block_id, ord)
           VALUES ('doc_deck', 'o2', @b, @o)`,
        )
        .run({ b: blockId, o: ord });
    }
    const doc = openNotesDoc(host.db, { contentSha: 'sha-deck' })!.doc;
    expect(blockIdsForObjective(host.db, doc, 'doc_deck', objective('o2', { refs: [{ page: 2 }] }))).toEqual([
      'b_2',
      'b_4',
    ]);
  });

  it('recomputes the page intersection when the cache is empty, so Start still has a target', () => {
    const { host } = fakeHost({ doc: deck() });
    const doc = openNotesDoc(host.db, { contentSha: 'sha-deck' })!.doc;
    expect(blockIdsForObjective(host.db, doc, 'doc_deck', objective('o2', { refs: [{ page: 2 }] }))).toEqual([
      'b_2',
      'b_4',
    ]);
    expect(blockIdsForObjective(host.db, doc, 'doc_deck', objective('o9', { refs: [] }))).toEqual([]);
  });
});

/** The overview's "By the end you can" list: cited to every objective's pages (contract C6). */
function objectivesList(blockId: string, pages: number[]) {
  return notesSchema.nodes.paragraph!.create(
    { blockId, pages, reason: 'objectives', objectiveIds: [] },
    notesSchema.text('Describe a planning problem. Compare heuristics.'),
  );
}

describe('the objectives list is not an objective’s block (live run, 3 Oct 2026)', () => {
  it('is left out of the page intersection, though it cites every page', () => {
    const { host } = fakeHost({ doc: deck() });
    const doc = docOf(objectivesList('b_obj', [1, 2, 3]), ...deck().children);
    expect(blockIdsForObjective(host.db, doc, null, objective('o2', { refs: [{ page: 2 }] }))).toEqual(['b_2', 'b_4']);
  });
});

describe('lessonBlocks', () => {
  const sectioned = () =>
    docOf(
      objectivesList('b_obj', [1, 2, 3]),
      // An agent's line filed under the list before the fix, which inherited its pages.
      para('b_stray', 'A note that picked up every page.', 'ellie', null, [1, 2, 3]),
      heading('h_pddl', 2, 'Classical planning in PDDL', [2, 3]),
      para('b_take', 'A domain plus a problem is searched for a plan.', 'ingest', null, [2, 3]),
      para('b_idea', 'Air cargo split into domain and problem.', 'ingest', null, [2]),
    );

  it('scrolls to the objective’s first section heading and files under the block below it', () => {
    expect(lessonBlocks(sectioned(), ['b_stray', 'h_pddl', 'b_take', 'b_idea'])).toEqual({
      scrollTo: 'h_pddl',
      anchor: 'b_take',
    });
  });

  it('looks past a Q block already under the heading', () => {
    const doc = docOf(
      heading('h_pddl', 2, 'Classical planning in PDDL', [2]),
      notesSchema.nodes.q_block!.create({ blockId: 'q_old', questionId: 'q1', askedBy: 'max', status: 'open' }, [
        para('q_old_p', 'An earlier question?', 'max'),
      ]),
      para('b_take', 'The takeaway.', 'ingest', null, [2]),
    );
    expect(lessonBlocks(doc, ['h_pddl', 'b_take'])).toEqual({ scrollTo: 'h_pddl', anchor: 'b_take' });
  });

  it('keeps the heading when another heading follows it', () => {
    const doc = docOf(heading('h_a', 2, 'A', [2]), heading('h_b', 2, 'B', [3]));
    expect(lessonBlocks(doc, ['h_a'])).toEqual({ scrollTo: 'h_a', anchor: 'h_a' });
  });

  it('falls back to the first block when no heading carries the objective', () => {
    expect(lessonBlocks(deck(), ['b_2', 'b_4'])).toEqual({ scrollTo: 'b_2', anchor: 'b_2' });
    expect(lessonBlocks(deck(), [])).toEqual({ scrollTo: null, anchor: null });
  });
});

describe('pagesOfObjective', () => {
  it('deduplicates and sorts the refs’ pages', () => {
    expect(pagesOfObjective(objective('o', { refs: [{ page: 4 }, { page: 2 }, { page: 4 }] }))).toEqual([2, 4]);
  });
});

describe('lessonSectionText (D2, 2026-10-06)', () => {
  it('is the heading and the blocks under it, up to the next heading, without questions', () => {
    const doc = docOf(
      heading('h_a', 2, 'Classical planning in PDDL', [2]),
      para('b_take', 'A domain plus a problem is searched for a plan.', 'ingest', null, [2]),
      notesSchema.nodes.q_block!.create({ blockId: 'q_old', questionId: 'q1', askedBy: 'max', status: 'open' }, [
        para('q_old_p', 'An earlier question?', 'max'),
      ]),
      heading('h_a2', 3, 'Air cargo', [2]),
      para('b_idea', 'Air cargo split into domain and problem.', 'ingest', null, [2]),
      heading('h_b', 2, 'Search', [4]),
      para('b_next', 'Not this section.', 'ingest', null, [4]),
    );
    expect(lessonSectionText(doc, ['h_a', 'b_take'])).toBe(
      'Classical planning in PDDL\nA domain plus a problem is searched for a plan.\nAir cargo\nAir cargo split into domain and problem.',
    );
  });

  it('falls back to the objective’s own blocks when it has no heading', () => {
    expect(lessonSectionText(deck(), ['b_1', 'b_2'])).toBe(
      'Convexity is about the shape of the set.\nThe Hessian test decides it on the interior.',
    );
    expect(lessonSectionText(null, ['b_1'])).toBe('');
  });
});
