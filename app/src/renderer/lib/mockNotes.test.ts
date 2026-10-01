import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { docFromJson } from '../../shared/doc/schema.js';
import { NOTE_SLOT_REASON } from '../../shared/doc/types.js';
import { contextFingerprint, virtualPageCount } from '../../shared/notebook.js';
import {
  MOCK_PAGE_COUNT,
  MOCK_STARTERS,
  MOCK_TITLE,
  fixtureIssueCount,
  mockBlockOnPage,
  mockLastBlockId,
  mockNotesJson,
  mockObjectives,
  mockOverviewMeta,
  mockSources,
} from './mockNotes.js';

/**
 * The fixture is dev scaffolding, so these are not tests of product behaviour. They are the
 * things that would make the scaffolding lie to the tracks building against it: a document the
 * real ingest gate could not have produced, a block with no provenance, a shape that is not the
 * contract's C6, and an objective whose **Start** scrolls to a block that is not there.
 */

function blocks(): Node[] {
  const out: Node[] = [];
  docFromJson(mockNotesJson()).forEach((node) => out.push(node));
  return out;
}

const attrs = (node: Node) => node.attrs as { blockId: string; pages: number[]; reason: string | null; level?: number };

describe('the fixture overview', () => {
  it('survives the real validator with nothing rejected', () => {
    expect(fixtureIssueCount()).toBe(0);
  });

  it('gives every block an id and provenance, on pages the notebook has', () => {
    for (const node of blocks()) {
      expect(attrs(node).blockId).toMatch(/^b_[0-9a-f]{12}$/);
      expect(attrs(node).pages.length > 0 || attrs(node).reason !== null).toBe(true);
      for (const page of attrs(node).pages) expect(page).toBeLessThanOrEqual(MOCK_PAGE_COUNT);
    }
  });

  it('opens in the C6 shape: title, lede, By the end you can, the objectives', () => {
    const [title, lede, by, list] = blocks();
    expect(title!.type.name).toBe('heading');
    expect(attrs(title!)).toMatchObject({ level: 1, reason: 'title' });
    expect(title!.textContent).toBe(MOCK_TITLE);
    expect(lede!.type.name).toBe('paragraph');
    expect(attrs(lede!).pages.length).toBeGreaterThan(0);
    expect(by!.type.name).toBe('heading');
    expect(attrs(by!)).toMatchObject({ level: 3, reason: 'objectives' });
    expect(by!.textContent).toBe('By the end you can');
    expect(list!.type.name).toBe('ordered_list');
    expect(attrs(list!).reason).toBe('objectives');
  });

  it('lists the objectives by title, in tree order (C5)', () => {
    const list = blocks()[3]!;
    const items: string[] = [];
    list.forEach((item) => items.push(item.textContent));
    expect(items).toEqual(mockObjectives().map((o) => o.title));
  });

  it('gives each section a heading, a takeaway, one-item idea lists and a note slot with its pages', () => {
    const body = blocks().slice(4);
    const sections: Node[][] = [];
    for (const node of body) {
      if (node.type.name === 'heading' && attrs(node).level === 2) sections.push([node]);
      else sections.at(-1)!.push(node);
    }
    expect(sections.length).toBeGreaterThanOrEqual(5);
    for (const [heading, takeaway, ...rest] of sections) {
      expect(attrs(heading!).pages.length).toBeGreaterThan(0);
      expect(takeaway!.type.name).toBe('paragraph');
      const slot = rest.at(-1)!;
      expect(slot.type.name).toBe('paragraph');
      expect(slot.textContent).toBe('');
      expect(attrs(slot).reason).toBe(NOTE_SLOT_REASON);
      expect(attrs(slot).pages).toEqual(attrs(heading!).pages);
      for (const ideaNode of rest.slice(0, -1)) {
        expect(ideaNode.type.name).toBe('bullet_list');
        expect(ideaNode.childCount).toBe(1);
        expect(attrs(ideaNode).pages.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries the one blank the deck itself leaves, verbatim, on its page (answer B)', () => {
    const blanks = blocks().filter((n) => n.textContent.includes('____'));
    expect(blanks).toHaveLength(1);
    expect(attrs(blanks[0]!).pages).toEqual([24]);
  });

  it('names blocks the scripted conversation can anchor to, never an empty note slot', () => {
    expect(mockLastBlockId()).toMatch(/^b_[0-9a-f]{12}$/);
    for (const page of [4, 17, 18, 20, 23]) {
      const id = mockBlockOnPage(page);
      const node = blocks().find((n) => attrs(n).blockId === id)!;
      expect(node.textContent.length).toBeGreaterThan(0);
    }
  });
});

describe('the fixture notebook and its overview metadata', () => {
  it('has three sources, two in context, laid end to end', () => {
    const sources = mockSources();
    expect(sources.map((s) => s.enabled)).toEqual([true, true, false]);
    expect(virtualPageCount(sources)).toBe(MOCK_PAGE_COUNT);
  });

  it('carries a greeting, exactly three starters, and recommendations that name real sections', () => {
    const meta = mockOverviewMeta(contextFingerprint(mockSources()));
    expect(meta.greeting.length).toBeGreaterThan(0);
    expect(meta.starterQuestions).toEqual([...MOCK_STARTERS]);
    expect(meta.starterQuestions).toHaveLength(3);
    const headings = new Set(blocks().filter((n) => n.type.name === 'heading').map((n) => attrs(n).blockId));
    expect(meta.recommendations).toHaveLength(2);
    for (const r of meta.recommendations) expect(headings.has(r.headingBlockId)).toBe(true);
    expect(meta.words).toBeLessThanOrEqual(meta.wordBudget + 150);
  });
});

describe('the fixture objectives', () => {
  const objectives = mockObjectives();

  it('gives the bar five objectives, empty: a fresh notebook', () => {
    expect(objectives).toHaveLength(5);
    expect(objectives.every((o) => o.fill === 0 && o.evidence === null)).toBe(true);
  });

  it('points Start at blocks that are actually in the document', () => {
    const ids = new Set(blocks().map((n) => attrs(n).blockId));
    for (const o of objectives) {
      expect(o.blockIds.length).toBeGreaterThan(0);
      for (const id of o.blockIds) expect(ids.has(id)).toBe(true);
    }
  });
});
