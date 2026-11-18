import { describe, expect, it } from 'vitest';
import { choiceEvidenceFromText, quoteOnPage, quoteSupportsAnswer } from './solution-evidence.js';

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

describe('an answer sheet numbered "12." whose answers open with the option (CS1010 practice, 2026-11-18)', () => {
  const abcde = [...'ABCDE', 'X'].map((id) => ({ id, text: `${id === 'X' ? 'None of the above' : `0.${id.charCodeAt(0)}`}` }));
  const sheet = [
    'Finals Practice SOLUTIONS', '', 'Loops', '', '1.', 'AY2018/19 Semester 1 Midterm, original Q3', '',
    '  A. Each division is integer division and yields zero.', '', '', '2.', 'AY2020/21 Midterm, original Q1', '',
    '  20503. x=5 and y=200; g(x+y)=20500, then f adds 3.', '', '3.', 'original Q5', '',
    '  A and D. A states when the fee is charged; D the conditions under which it is free.', '', '4.', '',
    '  The output is', '  3.', '  then 4.',
  ].join('\n');

  it('reads the option that leads the answer, for the right question', () => {
    expect(choiceEvidenceFromText(page(sheet), 'P1', 'Question 1', abcde)?.correct).toEqual(['A']);
    expect(choiceEvidenceFromText(page(sheet), 'P3', 'Question 3', abcde)?.correct).toEqual(['A', 'D']);
  });

  it('finds nothing for a question whose answer is not an option, or that is not there', () => {
    expect(choiceEvidenceFromText(page(sheet), 'P2', 'Question 2', abcde)).toBeNull();
    expect(choiceEvidenceFromText(page(sheet), 'P9', 'Question 9', abcde)).toBeNull();
  });

  it('does not take a reprint of the options for an answer', () => {
    const reprint = ['1.', '  A. 0.65', '  B. 0.66', '  C. 0.67'].join('\n');
    expect(choiceEvidenceFromText(page(reprint), 'P1', 'Question 1', abcde)).toBeNull();
  });
});

describe('text evidence for non-choice answers', () => {
  it('requires the quote to support the answer itself', () => {
    expect(quoteSupportsAnswer('The query selects riders with no low ranking result.', 'Select riders with no low ranking result')).toBe(true);
    expect(quoteSupportsAnswer('Question 4 asks for a SQL query.', 'Select riders with no low ranking result')).toBe(false);
    expect(quoteSupportsAnswer('The result is 42.', '42')).toBe(true);
  });

  it('matches a quote across line breaks, and answers made of short tokens', () => {
    const pageText = 'At Line B:\n   i=8, j=0, k=14. The inner loop\n   runs 2, then 4, then 8 times. undefined beha\u00advior';
    expect(quoteOnPage(pageText, 'At Line B: i=8, j=0, k=14. The inner loop runs 2')).toBe(true);
    expect(quoteOnPage(pageText, 'undefined behavior')).toBe(true);
    expect(quoteOnPage(pageText, 'i=9')).toBe(false);
    expect(quoteSupportsAnswer('At Line B: i=8, j=0, k=14.', 'i = 8, j = 0, k = 14')).toBe(true);
    expect(quoteSupportsAnswer('The output is 1 2 4 8 16 (spaces between values).', '1 2 4 8 16')).toBe(true);
    expect(quoteSupportsAnswer('The output is 1 2 4 8 (spaces between values).', '1 2 4 8 16')).toBe(false);
  });
});
