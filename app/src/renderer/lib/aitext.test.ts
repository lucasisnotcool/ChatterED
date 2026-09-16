import { describe, expect, it } from 'vitest';
import { aiBody, collapsedLine, paragraphs, plainText } from './aitext.js';

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


describe('the markdown subset (issue #41)', () => {
  it('renders the bold Lucas saw raw in the transcript', () => {
    // Verbatim from the MDP thread: the `**` was on screen as two asterisks.
    const html = paragraphs('1. **Classical planning** handles sequential decisions, but assumes');
    expect(html).toContain('<strong>Classical planning</strong>');
    expect(html).not.toContain('**');
  });

  it('renders the numbered list as a list, not as three paragraphs', () => {
    const html = paragraphs(
      [
        '1. **Non-negativity** — every outcome has probability ≥ 0.',
        '2. **Normalization** — the probabilities sum to exactly 1.',
      ].join('\n'),
    );
    expect(html.startsWith('<ol>')).toBe(true);
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('<strong>Normalization</strong>');
  });

  it('keeps the number a list actually starts at', () => {
    expect(paragraphs('3. third\n4. fourth')).toContain('<ol start="3">');
    expect(paragraphs('1. first')).toContain('<ol>');
  });

  it('renders bulleted lists from -, * and •', () => {
    for (const marker of ['-', '*', '•']) {
      const html = paragraphs(`${marker} one\n${marker} two`);
      expect(html.startsWith('<ul>')).toBe(true);
      expect(html.match(/<li>/g)).toHaveLength(2);
    }
  });

  it('keeps a wrapped list item as one item', () => {
    const html = paragraphs('1. a claim that runs\n   onto a second line\n2. the next one');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('runs<br>onto a second line');
  });

  it('renders italics but not multiplication', () => {
    expect(paragraphs('a *sequence* of decisions')).toContain('<em>sequence</em>');
    expect(paragraphs('the product 3 * 4 * 5')).not.toContain('<em>');
  });

  it('takes bold before italics, so ** is one strong and not two ems', () => {
    const html = paragraphs('**both**');
    expect(html).toBe('<p><strong>both</strong></p>');
  });

  it('leaves everything outside the subset as literal text', () => {
    // No headings, no links, no blockquotes, no code fences, no tables.
    const html = paragraphs('# Heading\n\n[a](http://x)\n\n> quote\n\n`code`');
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('<code');
    expect(html).toContain('# Heading');
    expect(html).toContain('[a](http://x)');
  });

  it('emits no tag a model wrote, however it is dressed up', () => {
    const hostile = [
      '**<img src=x onerror=alert(1)>**',
      '',
      '1. <script>alert(2)</script>',
      '',
      '- <a href="javascript:alert(3)">click</a>',
      '',
      '*<iframe src=evil>*',
      '',
      '$<svg onload=alert(4)>$',
      '',
      '<!-- **still text** -->',
    ].join('\n');
    const html = paragraphs(hostile);
    // `onerror=` and `javascript:` survive as *text*, which is the point: they are escaped, so
    // they are characters on screen and never an attribute. What must not survive is a tag.
    for (const tag of ['<img', '<script', '<a ', '<iframe', '<svg', '<!--']) {
      expect(html).not.toContain(tag);
    }
    expect(html).toContain('&lt;script&gt;');
    // Only the seven tags this file is allowed to emit, plus KaTeX's own (spans and MathML).
    const KATEX = ['span', 'math', 'semantics', 'mrow', 'annotation', 'code'];
    const emitted = new Set([...html.matchAll(/<([a-z][a-z0-9]*)/g)].map((m) => m[1]!));
    for (const tag of emitted) {
      const allowed =
        ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'].includes(tag) ||
        KATEX.includes(tag) ||
        /^m[a-z]+$/.test(tag); // mi, mo, mn, mspace — MathML leaves.
      expect(allowed, `unexpected tag <${tag}>`).toBe(true);
    }
  });

  it('never lets emphasis eat a formula', () => {
    // The `*` here is multiplication inside TeX and must reach KaTeX untouched.
    const html = paragraphs('the rate is $a * b$ per step');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('<em>');
  });

  it('leaves an unclosed marker alone', () => {
    expect(paragraphs('**not closed')).toBe('<p>**not closed</p>');
    expect(paragraphs('a * lone star')).toBe('<p>a * lone star</p>');
  });
});

describe('plainText', () => {
  it('takes the markers off for a text node', () => {
    expect(plainText('**Classical planning** handles *sequences*')).toBe(
      'Classical planning handles sequences',
    );
    expect(plainText('1. first\n- second')).toBe('first\nsecond');
  });

  it('is what a collapsed card shows', () => {
    expect(collapsedLine('**Bold** opener.\n\nmore')).toBe('Bold opener.');
  });
});
