import { describe, expect, it } from 'vitest';
import { docFromJson } from '../../shared/doc/schema.js';
import { validateDrafts } from '../../shared/doc/validate.js';
import {
  MOCK_PAGE_COUNT,
  MOCK_WINDOWS,
  fixtureIssueCount,
  mockBlockOnPage,
  mockLastBlockId,
  mockNotesJson,
  mockObjectives,
} from './mockNotes.js';

/**
 * The fixture is dev scaffolding, so these are not tests of product behaviour — they are the
 * three things that would make the scaffolding lie: a document the real ingest could not have
 * produced, a block with no provenance, and an objective whose **Start** scrolls to a block that
 * is not in the document.
 */
describe('the fixture notes document', () => {
  it('survives the real validator with nothing rejected', () => {
    expect(fixtureIssueCount()).toBe(0);
    for (const window of MOCK_WINDOWS) {
      expect(validateDrafts(window, MOCK_PAGE_COUNT).issues).toEqual([]);
    }
  });

  it('parses as a document the schema accepts, and every block carries provenance', () => {
    const doc = docFromJson(mockNotesJson());
    expect(doc.childCount).toBeGreaterThan(15);
    doc.forEach((node) => {
      const attrs = node.attrs as { blockId: string; pages: number[]; reason: string | null };
      expect(attrs.blockId).toMatch(/^b_[0-9a-f]{12}$/);
      expect(attrs.pages.length > 0 || attrs.reason !== null).toBe(true);
      for (const page of attrs.pages) expect(page).toBeLessThanOrEqual(MOCK_PAGE_COUNT);
    });
  });

  it('shows one evidentiary slide inline', () => {
    const doc = docFromJson(mockNotesJson());
    const figures: string[] = [];
    doc.forEach((node) => {
      if (node.type.name === 'slide_figure') figures.push(node.attrs.caption as string);
    });
    expect(figures).toHaveLength(1);
  });

  it('names blocks the scripted conversation can anchor to', () => {
    expect(mockLastBlockId()).toMatch(/^b_[0-9a-f]{12}$/);
    expect(mockBlockOnPage(22)).toMatch(/^b_[0-9a-f]{12}$/);
    expect(mockBlockOnPage(34)).toMatch(/^b_[0-9a-f]{12}$/);
  });
});

describe('the fixture objectives', () => {
  const objectives = mockObjectives();

  it('gives the bar nine objectives to draw and one the deck assumes', () => {
    expect(objectives.filter((o) => !o.assumedByDeck)).toHaveLength(9);
    expect(objectives.filter((o) => o.assumedByDeck)).toHaveLength(1);
  });

  it('starts part-way through, which is the state worth looking at', () => {
    expect(objectives.filter((o) => o.fill === 1)).toHaveLength(2);
    expect(objectives.filter((o) => o.fill === 0.5)).toHaveLength(1);
  });

  it('only ever carries evidence where the learner earned the fill', () => {
    for (const o of objectives) {
      if (o.fill === 0) expect(o.evidence).toBeNull();
      else expect(o.evidence).toBeTruthy();
    }
  });

  it('points Start at blocks that are actually in the document', () => {
    const ids = new Set<string>();
    docFromJson(mockNotesJson()).forEach((node) => {
      const id = (node.attrs as { blockId?: string }).blockId;
      if (id) ids.add(id);
    });
    // No id is ever invented…
    for (const o of objectives) for (const id of o.blockIds) expect(ids.has(id)).toBe(true);
    // …and every objective the *opened* document covers resolves. The last one is taught on the
    // pages window 2 brings, whose ids the renderer mints — so it resolves only after that
    // window has landed and been saved back, which is exactly what `notesSave` re-derives.
    const resolved = objectives.filter((o) => !o.assumedByDeck && o.blockIds.length > 0);
    expect(resolved).toHaveLength(8);
    expect(objectives.find((o) => o.objectiveId === 'obj-woz')?.blockIds).toEqual([]);
  });
});
