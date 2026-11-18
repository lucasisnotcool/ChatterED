/** A multiple-choice option that is a code listing is shown as code (`tutorialviews.ts`). */
import { describe, expect, it } from 'vitest';
import { codeOption } from './tutorialviews.js';

describe('an option that is code', () => {
  it('keeps the lines of a listing, fenced or not', () => {
    expect(codeOption('```c\nif (a) {\n    return 1;\n}\n```')).toBe('if (a) {\n    return 1;\n}');
    expect(codeOption('return (!a && b && c);\nreturn x;')).toBe('return (!a && b && c);\nreturn x;');
  });

  it('leaves an ordinary option to the inline renderer', () => {
    expect(codeOption('0.25')).toBeNull();
    expect(codeOption('None of the above options are correct.')).toBeNull();
    expect(codeOption('`return (!a && b && c);`')).toBeNull();
  });
});
