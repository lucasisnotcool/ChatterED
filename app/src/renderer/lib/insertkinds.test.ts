import { describe, expect, it } from 'vitest';
import { BLOCK_KINDS, blockKindLabel, declinedLine } from './insertkinds.js';

describe('the Insert menu’s kinds', () => {
  it('offers all five, table and diagram first', () => {
    expect(BLOCK_KINDS).toEqual(['table', 'diagram', 'flashcards', 'quiz', 'infographic']);
    expect(BLOCK_KINDS.map(blockKindLabel)).toEqual(['Table', 'Diagram', 'Flashcards', 'Quiz', 'Infographic']);
  });

  it('has a refusal in Ellie’s words for each, and no two alike', () => {
    const lines = BLOCK_KINDS.map(declinedLine);
    expect(new Set(lines).size).toBe(5);
    for (const line of lines) expect(line.startsWith('Ellie found')).toBe(true);
  });
});
