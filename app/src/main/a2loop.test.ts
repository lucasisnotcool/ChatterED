import { describe, expect, it } from 'vitest';
import { a2Loop, pageTextOf } from './ipc.js';

describe('a2Loop: which question loop this build runs', () => {
  it('runs Max’s follow-up by default, with every guard on', () => {
    expect(a2Loop({})).toEqual({ maxFollowsUp: true, legacyGuardsOff: false, semanticGuard: true });
  });

  it('CHATTERED_MAX_ON_REQUEST=1 restores Max asking only when asked', () => {
    expect(a2Loop({ CHATTERED_MAX_ON_REQUEST: '1' }).maxFollowsUp).toBe(false);
    expect(a2Loop({ CHATTERED_MAX_ON_REQUEST: '0' }).maxFollowsUp).toBe(true);
  });

  it('CHATTERED_SEMANTIC_GUARD=0 leaves Ellie’s guard lexical only', () => {
    expect(a2Loop({ CHATTERED_SEMANTIC_GUARD: '0' }).semanticGuard).toBe(false);
  });

  it('CHATTERED_LEGACY_GUARDS_OFF=1 switches the 6 Oct checks off, and nothing else does', () => {
    expect(a2Loop({ CHATTERED_LEGACY_GUARDS_OFF: '1' }).legacyGuardsOff).toBe(true);
    expect(a2Loop({ CHATTERED_LEGACY_GUARDS_OFF: 'yes' }).legacyGuardsOff).toBe(false);
  });
});

describe('pageTextOf: the deck by page, for the citation check', () => {
  it('splits the extracted text on its page markers', () => {
    const page = pageTextOf('=== SOURCE: deck.pdf ===\n\n[p. 1]\nTitle slide\n\n[p. 2]\nRepair strategies\nOptions\n')!;
    expect(page(1)).toBe('Title slide');
    expect(page(2)).toBe('Repair strategies\nOptions');
    expect(page(3)).toBeNull();
  });
  it('is undefined for text with no page markers', () => {
    expect(pageTextOf('pasted text with no pages')).toBeUndefined();
  });
});
