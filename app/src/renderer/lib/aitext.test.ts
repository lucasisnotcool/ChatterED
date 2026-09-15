import { describe, expect, it } from 'vitest';
import { aiBody, collapsedLine, paragraphs } from './aitext.js';

describe('the body of an AI card', () => {
  it('escapes everything that is not maths', () => {
    // A model turn is untrusted text on its way into the DOM. Nothing here may produce a tag.
    const html = paragraphs('Try <img src=x onerror=alert(1)> & see');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
  });

  it('splits on blank lines and keeps a single newline as a break', () => {
    expect(paragraphs('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
  });

  it('typesets inline and display maths with KaTeX', () => {
    expect(paragraphs('the test is $z^T H z \\ge 0$ for all z')).toContain('class="katex"');
    const display = paragraphs('$$\\nabla^2 f(x) \\succeq 0$$');
    expect(display).toContain('katex-display');
  });

  it('leaves a lone dollar sign alone', () => {
    // A price is not a formula, and a delimiter that never closes is not a delimiter.
    const html = paragraphs('it costs $5 to run');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
  });

  it('never lets a tag through inside a formula either', () => {
    const html = paragraphs('$a < b$');
    expect(html).not.toContain('<b>');
  });

  it('splits the hand-back line off at the rule reference.ts writes', () => {
    const body = [
      'A symmetric matrix H is positive semidefinite when zᵀHz ≥ 0 for every vector z.',
      '',
      '───',
      "Now say it back in your own words and I'll tell you what's missing.",
    ].join('\n');
    const parsed = aiBody(body);
    expect(parsed.handBack).toBe("Now say it back in your own words and I'll tell you what's missing.");
    expect(parsed.html).toContain('positive semidefinite');
    expect(parsed.html).not.toContain('say it back');
  });

  it('leaves a turn with no rule whole', () => {
    const parsed = aiBody('PSD where? Your sentence works for a single point.');
    expect(parsed.handBack).toBeNull();
    expect(parsed.html).toContain('single point');
  });

  it('does not split on a bar character used mid-sentence', () => {
    const parsed = aiBody('the boundary ─── is not a rule here');
    expect(parsed.handBack).toBeNull();
  });
});

describe('a collapsed answer card', () => {
  it('shows the first line when it is short', () => {
    expect(collapsedLine('Short answer.\n\nmore')).toBe('Short answer.');
  });

  it('cuts on a word boundary with an ellipsis when it is not', () => {
    const line = collapsedLine('a'.repeat(10) + ' ' + 'b'.repeat(90), 20);
    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(21);
  });

  it('skips leading blank lines', () => {
    expect(collapsedLine('\n\nthe answer')).toBe('the answer');
  });
});
