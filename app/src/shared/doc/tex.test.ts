import { describe, expect, it } from 'vitest';
import { displayMathOf, hasMathDelimiters, mathSegments, normaliseTexDelimiters } from './tex.js';

describe('normaliseTexDelimiters', () => {
  it('rewrites the LaTeX delimiters to dollars and leaves everything else alone', () => {
    expect(normaliseTexDelimiters('so \\(h(s) \\le h^*(s)\\) holds')).toBe('so $h(s) \\le h^*(s)$ holds');
    expect(normaliseTexDelimiters('\\[ \\sum_i x_i \\]')).toBe('$$\\sum_i x_i$$');
    expect(normaliseTexDelimiters('costs $5, plainly')).toBe('costs $5, plainly');
  });
});

describe('displayMathOf', () => {
  it('reads a text that is one display formula and nothing else', () => {
    expect(displayMathOf('$$h_{\\max} = 1$$')).toBe('h_{\\max} = 1');
    expect(displayMathOf('  \\[x^2\\] ')).toBe('x^2');
    expect(displayMathOf('so $$x$$ holds')).toBeNull();
    expect(displayMathOf('$$  $$')).toBeNull();
  });
});

describe('mathSegments', () => {
  it('splits a line into text and formulas', () => {
    expect(mathSegments('$h_{\\max}$ = 1, while \\(h_{\\text{add}}\\) = 3')).toEqual([
      { text: 'h_{\\max}', tex: 'h_{\\max}', display: false },
      { text: ' = 1, while ', tex: null, display: false },
      { text: 'h_{\\text{add}}', tex: 'h_{\\text{add}}', display: false },
      { text: ' = 3', tex: null, display: false },
    ]);
  });

  it('marks $$ as display, and reads money as money', () => {
    expect(mathSegments('$$a+b$$')).toEqual([{ text: 'a+b', tex: 'a+b', display: true }]);
    expect(mathSegments('between $5 and $6')).toEqual([{ text: 'between $5 and $6', tex: null, display: false }]);
    expect(hasMathDelimiters('between $5 and $6')).toBe(false);
    expect(hasMathDelimiters('so $x$')).toBe(true);
  });

  it('leaves ** and * as the characters they are', () => {
    expect(mathSegments('**not bold** $a*b$')).toEqual([
      { text: '**not bold** ', tex: null, display: false },
      { text: 'a*b', tex: 'a*b', display: false },
    ]);
  });
});
