/**
 * The Markdown pipeline (issue #22 decision 3). These are the rules that make `{@html}` safe in
 * MarkdownViewer.svelte, so they are asserted rather than trusted.
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, headings, highlightSource, renderMarkdown } from './markdown.js';

describe('renderMarkdown — what must never reach the DOM', () => {
  it('drops a raw <script> from the source instead of rendering it', () => {
    const html = renderMarkdown('before\n\n<script>alert(1)</script>\n\nafter');
    expect(html).not.toMatch(/<script/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('after');
  });

  it('neutralises an inline event handler smuggled through raw HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    // The whole tag is escaped, so `onerror=` survives as visible text and not as an attribute:
    // what must not exist is a real `<img`, and there is none.
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('renders a link as inert text carrying its destination in the title', () => {
    const html = renderMarkdown('[the paper](javascript:alert(1))');
    expect(html).not.toMatch(/<a /);
    expect(html).toContain('dead-link');
    expect(html).toContain('the paper');
  });

  it('does not fetch an image, local or remote', () => {
    const html = renderMarkdown('![figure](../../secret.png)');
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('dead-image');
  });

  it('escapes the text inside a fenced block with no language', () => {
    const html = renderMarkdown('```\n<b>not bold</b>\n```');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>not bold');
  });
});

describe('renderMarkdown — what must reach the DOM', () => {
  it('renders headings, lists and tables', () => {
    const html = renderMarkdown('# Convexity\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toMatch(/<h1 id="convexity">Convexity<\/h1>/);
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table>');
  });

  it('renders inline maths with KaTeX', () => {
    const html = renderMarkdown('The Hessian $\\nabla^2 f \\succeq 0$ everywhere.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('everywhere');
  });

  it('renders display maths as its own block', () => {
    const html = renderMarkdown('$$\n\\frac{\\partial^2 f}{\\partial x^2}\n$$');
    expect(html).toContain('math-display');
    expect(html).toContain('katex-display');
  });

  it('leaves money alone — $5 and $6 is not a formula', () => {
    const html = renderMarkdown('It cost $5 and then $6.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
  });

  it('leaves a dollar inside a code span alone', () => {
    const html = renderMarkdown('Run `echo $HOME` first.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$HOME');
  });

  it('shows a broken formula as its own source rather than an error card', () => {
    const html = renderMarkdown('$\\notacommand{x}$');
    expect(html).toContain('katex'); // KaTeX renders the error inline with throwOnError: false
    expect(html).not.toMatch(/ParseError/);
  });

  it('highlights a fenced block whose language it knows', () => {
    const html = renderMarkdown('```python\nx = 1\n```');
    expect(html).toContain('language-python');
    expect(html).toContain('hljs-');
  });
});

describe('headings', () => {
  it('produces the outline with stable slugs', () => {
    expect(headings('# One\n\n## Two things!\n\ntext\n\n### Three')).toEqual([
      { depth: 1, text: 'One', id: 'one' },
      { depth: 2, text: 'Two things!', id: 'two-things' },
      { depth: 3, text: 'Three', id: 'three' },
    ]);
  });

  it('never produces an empty id', () => {
    expect(headings('# ???')[0]!.id).toBe('section');
  });
});

describe('highlightSource', () => {
  it('uses the extension when highlight.js knows it', () => {
    expect(highlightSource('const x = 1;', 'js')).toContain('hljs-');
  });

  it('falls back to auto-detection rather than throwing on an unknown extension', () => {
    expect(() => highlightSource('some text', 'zzz')).not.toThrow();
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could close a tag or an attribute', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});
