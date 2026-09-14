import { describe, expect, it } from 'vitest';
import { SNIPPET_CLOSE, SNIPPET_OPEN, splitSnippet } from './snippet.js';

const wrap = (s: string) => `${SNIPPET_OPEN}${s}${SNIPPET_CLOSE}`;

describe('splitSnippet', () => {
  it('splits an FTS5 snippet into plain and matched runs', () => {
    expect(splitSnippet(`the ${wrap('Challenger')} agent asked`)).toEqual([
      { text: 'the ', match: false },
      { text: 'Challenger', match: true },
      { text: ' agent asked', match: false },
    ]);
  });

  it('handles several matches and a leading match', () => {
    expect(splitSnippet(`${wrap('a')} b ${wrap('c')}`).filter((r) => r.match).map((r) => r.text)).toEqual(['a', 'c']);
  });

  it('passes an unmarked snippet straight through', () => {
    expect(splitSnippet('nothing marked here')).toEqual([{ text: 'nothing marked here', match: false }]);
    expect(splitSnippet('')).toEqual([]);
  });

  it('does not lose text when a delimiter is unbalanced', () => {
    // Defensive: the delimiters are ours, but a truncated snippet must never drop characters.
    expect(splitSnippet(`open ${SNIPPET_OPEN}but never closed`).map((r) => r.text).join('')).toContain(
      'but never closed',
    );
  });

  it('uses characters that cannot appear in a document', () => {
    // Private Use Area. If these ever became '<' and '>' the renderer would be injecting
    // whatever is in the learner's files into its own DOM.
    expect(SNIPPET_OPEN.codePointAt(0)).toBeGreaterThanOrEqual(0xe000);
    expect(SNIPPET_CLOSE.codePointAt(0)).toBeLessThanOrEqual(0xf8ff);
  });
});
