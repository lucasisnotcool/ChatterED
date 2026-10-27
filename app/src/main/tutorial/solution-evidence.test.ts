import { describe, expect, it } from 'vitest';
import { choiceEvidenceFromText, quoteSupportsAnswer } from './solution-evidence.js';

const options = 'ABCDEFGH'.split('').map((id) => ({ id, text: `Relation ${id} attribute ${id.toLowerCase()}key` }));
const page = (text: string) => [{ fileId: 'answers', page: 1, text }];

describe('official choice evidence', () => {
  it('reads the de-identified PDF text glyph artifact for Q1 and stops at Q2', () => {
    const text = ['Question #: 1', ...options.map((o) => `${'ADG'.includes(o.id) ? '3' : ''}${o.id}. ${o.text}`),
      'Question #: 2', '3B. unrelated'].join('\n');
    expect(choiceEvidenceFromText(page(text), 'P1', 'Question 1', options)).toEqual({
      fileId: 'answers', page: 1, correct: ['A', 'D', 'G'], method: 'text',
    });
  });

  it('accepts a fully listed page with normal checkmarks or an explicit answer line', () => {
    const marked = ['Question 1', ...options.map((o) => `${'ADG'.includes(o.id) ? '✓' : ''}${o.id}. ${o.text}`)].join('\n');
    expect(choiceEvidenceFromText(page(marked), 'P1', 'Question 1', options)?.correct).toEqual(['A', 'D', 'G']);
    expect(choiceEvidenceFromText(page(`Question 1\n${options.map((o) => `${o.id}. ${o.text}`).join('\n')}\nAnswer: A, D, G\nQuestion 2\nAnswer: B`), 'P1', 'Question 1', options)?.correct).toEqual(['A', 'D', 'G']);
  });

  it('refuses absent, incomplete, or invalid evidence', () => {
    expect(choiceEvidenceFromText(page('Question 2\nAnswer: A, D, G'), 'P1', 'Question 1', options)).toBeNull();
    expect(choiceEvidenceFromText(page('Question 1\n✓A. unrelated\n✓D. unrelated'), 'P1', 'Question 1', options)).toBeNull();
    expect(choiceEvidenceFromText(page('Question 1\nAnswer: A, Z'), 'P1', 'Question 1', options)).toBeNull();
    expect(choiceEvidenceFromText(page('Question 1\n✓A. Other subject\nB. Other subject\nC. Other subject\nD. Other subject\nE. Other subject\nF. Other subject\nG. Other subject\nH. Other subject'), 'P1', 'Question 1', options)).toBeNull();
  });
});

describe('text evidence for non-choice answers', () => {
  it('requires the quote to support the answer itself', () => {
    expect(quoteSupportsAnswer('The query selects riders with no low ranking result.', 'Select riders with no low ranking result')).toBe(true);
    expect(quoteSupportsAnswer('Question 4 asks for a SQL query.', 'Select riders with no low ranking result')).toBe(false);
    expect(quoteSupportsAnswer('The result is 42.', '42')).toBe(true);
  });
});
