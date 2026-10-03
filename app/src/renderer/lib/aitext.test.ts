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
    const html = paragraphs('# Heading\n\n[a](http://x)\n\n> quote\n\n```\nfenced\n```');
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('<pre');
    expect(html).toContain('# Heading');
    expect(html).toContain('[a](http://x)');
  });

  /**
   * **Inline code** (#49). House rule 9 asks for no backtick code, and some turns use it anyway;
   * printed raw, the backticks read as noise around the one term that mattered. So a single-line
   * `` `span` `` is a `<code>`, escaped like everything else, and nothing inside it is emphasis or
   * maths.
   */
  it('renders an inline `code` span as <code>, with its contents escaped and literal', () => {
    expect(paragraphs('the fluent `At(c, a)` holds')).toBe('<p>the fluent <code>At(c, a)</code> holds</p>');
    expect(paragraphs('`<img src=x onerror=alert(1)>`')).toBe(
      '<p><code>&lt;img src=x onerror=alert(1)&gt;</code></p>',
    );
    // Code wins over what is inside it: no emphasis and no maths.
    expect(paragraphs('`a *b* c` and `$x$`')).toBe('<p><code>a *b* c</code> and <code>$x$</code></p>');
    // A lone or unclosed backtick is a character, and a span does not cross a line.
    expect(paragraphs('it’s a ` alone')).toBe('<p>it’s a ` alone</p>');
    expect(paragraphs('`open\nclosed`')).toBe('<p>`open<br>closed`</p>');
  });

  it('keeps a citation clickable when a model wrote it in backticks', () => {
    const html = paragraphs('see `p. 3: "no tools"`', { pages: [3] });
    expect(html).toContain('<code>');
    expect(html).toContain('data-page="3"');
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
        ['p', 'br', 'strong', 'em', 'code', 'ul', 'ol', 'li'].includes(tag) ||
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
    expect(plainText('the fluent `At(c, a)` holds')).toBe('the fluent At(c, a) holds');
  });

  it('is what a collapsed card shows', () => {
    expect(collapsedLine('**Bold** opener.\n\nmore')).toBe('Bold opener.');
  });
});

/**
 * The Tester's grounds, made checkable (issue #47, `attempt-first.md` §3).
 *
 * The behaviour is a nice-to-have; the safety property is not. `pages` is the only thing that can
 * turn on the one extra tag this module emits, and what lands in the attribute is a parsed integer
 * and never a substring of the model's turn.
 */
describe('a p. N the deck actually has', () => {
  const pages = [1, 3, 5, 12];

  it('writes nothing at all without pages', () => {
    expect(paragraphs('the deck settles it at p. 3')).toBe('<p>the deck settles it at p. 3</p>');
  });

  it('links every shape the prompt asks for', () => {
    for (const written of ['p. 3', 'p.3', 'page 3', 'pp. 3', 'P. 3']) {
      const html = paragraphs(`settled at ${written}: "no tools"`, { pages });
      expect(html).toContain('data-page="3"');
      // The learner's own wording is kept, so the link matches what Max wrote.
      expect(html).toContain(`>${written}<`);
    }
  });

  it('leaves a citation to a page this document does not have as plain text', () => {
    const html = paragraphs('as p. 7 has it', { pages });
    expect(html).not.toContain('data-page');
    expect(html).toContain('as p. 7 has it');
  });

  it('links inside a list item and a bolded span', () => {
    expect(paragraphs('- what was missing, per p. 5', { pages })).toContain('data-page="5"');
    expect(paragraphs('**p. 12** settles it', { pages })).toContain('data-page="12"');
  });

  it('leaves maths alone', () => {
    // `p.3` inside TeX is not a citation, and the formula must reach KaTeX untouched.
    const html = paragraphs('the bound is $p. 3 \\le x$', { pages });
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('data-page');
  });

  it('puts only an integer in the attribute, whatever the model wrote', () => {
    // A model-written quote, angle brackets and all, next to a citation.
    const html = paragraphs('p. 3: "<script>alert(1)</script> is not in the deck"', { pages });
    expect(html).toContain('data-page="3"');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script');
    // Four digits is a page number; five is not a page this or any deck has.
    expect(paragraphs('p. 30000', { pages })).not.toContain('data-page');
  });

  it('is the only tag added, and it is a button with no href', () => {
    const html = paragraphs('grounded at p. 1 and p. 5', { pages });
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).not.toContain('href');
    expect(html).toContain('type="button"');
  });

  it('carries through aiBody, which is what the card calls', () => {
    const body = aiBody('what landed, per p. 5', { pages });
    expect(body.html).toContain('data-page="5"');
  });
});

/** 2026-10-03: the LaTeX delimiters reached the learner raw, and money could become a formula. */
describe('maths in a chat turn', () => {
  it('typesets \\(…\\) and \\[…\\] as it does $…$ and $$…$$', () => {
    const html = paragraphs('so \\(h_{\\max}\\) is admissible:\n\n\\[h(s) \\le h^*(s)\\]');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\(');
    expect(html).not.toContain('\\[');
  });

  it('reads "$5 and $6" as money', () => {
    const html = paragraphs('It costs $5 and $6 to check.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5 and $6');
  });
});
